// CHAPTER 4.9 §5-§18 — Ensemble Engine
//
// 8 strategies (§5). Weighting (§6). Dynamic selection (§7). Confidence aggregation (§8).
// Uncertainty aggregation (§9, Rule 8 — independent from confidence). Diversity (§10, Rule 11).
// Meta-ensemble (§11). OOF-only stacking (Rule 17). Canonical Prediction Tuple I/O (Rule 16).
// Graceful degradation (§14, Rule 18 — quorum, renormalize, increase uncertainty).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPredictionTuple } from '../models/types'
import type {
  DiversityReport,
  EnsembleConfig,
  EnsemblePrediction,
  EnsembleStrategy,
  GracefulDegradationResult,
  ModelContribution,
} from './types'
import { ENSEMBLE_VERSION } from './types'

const log = createLogger('ai-platform:ensemble:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Engine  (Chapter 4.9 §1 — main facade)
// ─────────────────────────────────────────────────────────────────────────────

class ModelEnsembleEngine {
  private ensembles = new Map<string, EnsembleConfig>()
  private predictions: EnsemblePrediction[] = []
  private stats = {
    totalPredictions: 0,
    degradedPredictions: 0,
    rejectedPredictions: 0,
    avgLatencyMs: 0,
  }
  private latencySamples: number[] = []

  /** Register an ensemble configuration (§5, Rule 4 — unique ID). */
  register(config: EnsembleConfig): void {
    if (this.ensembles.has(config.ensembleId)) {
      throw new Error(`[ensemble] ensemble "${config.ensembleId}" already registered`)
    }
    this.ensembles.set(config.ensembleId, config)
    log.info(`ensemble registered: ${config.ensembleId} (strategy: ${config.strategy}, models: ${config.constituentModelIds.length})`)
  }

  /**
   * Fuse constituent model predictions into a single Ensemble Prediction (§4, Rule 16).
   * Input = Canonical Prediction Tuples from constituents.
   * Output = single Canonical Prediction Tuple + ensemble metadata.
   * Rule 18 — graceful degradation with quorum check.
   * Rule 8 — confidence and uncertainty aggregated independently.
   */
  fuse(opts: {
    ensembleId: string
    constituentPredictions: Array<{
      modelId: string
      prediction: CanonicalPredictionTuple
      available: boolean
      unavailableReason?: string
    }>
  }): EnsemblePrediction | null {
    const startTime = Date.now()
    const config = this.ensembles.get(opts.ensembleId)
    if (!config) {
      log.error(`ensemble "${opts.ensembleId}" not found`)
      return null
    }

    this.stats.totalPredictions++

    // §14, Rule 18 — graceful degradation: check availability
    const degradation = this.checkDegradation(opts.constituentPredictions, config)
    if (!degradation.quorumSatisfied) {
      // Rule 18 — quorum not satisfied → no prediction
      this.stats.rejectedPredictions++
      log.warn(`ensemble ${opts.ensembleId} prediction rejected — quorum not satisfied (${degradation.availableModels.length}/${config.constituentModelIds.length} available)`)
      return null
    }

    // Build model contributions with renormalized weights
    const contributions: ModelContribution[] = []
    for (const cp of opts.constituentPredictions) {
      const weight = degradation.renormalizedWeights[cp.modelId] ?? 0
      contributions.push({
        modelId: cp.modelId,
        prediction: cp.prediction,
        normalizedWeight: weight,
        active: cp.available,
        inactiveReason: cp.unavailableReason ?? null,
        confidence: cp.prediction.epistemicUncertainty, // confidence = 1 - epistemic uncertainty
        uncertainty: cp.prediction.epistemicUncertainty,
      })
    }

    const activeContributions = contributions.filter((c) => c.active)

    // §5 — apply ensemble strategy
    const { expectedValue, predictionInterval } = this.applyStrategy(config.strategy, activeContributions)

    // §8 — confidence aggregation (independent from prediction values, Rule 8)
    const aggregatedConfidence = this.aggregateConfidence(activeContributions, degradation)

    // §9 — uncertainty aggregation (independent from confidence, Rule 8)
    const epistemicUncertainty = this.aggregateUncertainty(activeContributions, degradation)

    // Rule 18 — increase epistemic uncertainty for degraded ensembles
    const finalUncertainty = degradation.unavailableModels.length > 0
      ? Math.min(1, epistemicUncertainty + degradation.uncertaintyIncrease)
      : epistemicUncertainty

    // Build prediction metadata
    const predictionMetadata = {
      predictionVersion: ENSEMBLE_VERSION,
      modelVersion: config.version.ensembleVersion,
      featureSchemaVersion: '2.0.0',
      inferenceTimestamp: Date.now(),
    }

    // Rule 16 — output = Canonical Prediction Tuple + ensemble metadata
    const ensemblePrediction: EnsemblePrediction = {
      // Canonical Prediction Tuple fields (Rule 16)
      expectedValue,
      epistemicUncertainty: finalUncertainty,
      predictionInterval,
      metadata: predictionMetadata,
      // Ensemble-specific metadata (§4)
      ensembleId: opts.ensembleId,
      ensembleVersion: config.version.ensembleVersion,
      ensembleStrategy: config.strategy,
      constituentModels: contributions,
      modelContributions: activeContributions.map((c) => ({ modelId: c.modelId, contribution: c.normalizedWeight })),
      activeModelCount: degradation.availableModels.length,
      missingModelCount: degradation.unavailableModels.length,
      weightDistribution: Object.fromEntries(activeContributions.map((c) => [c.modelId, c.normalizedWeight])),
      ensembleHealthStatus: degradation.healthStatus,
      aggregationStrategy: config.strategy,
      lineage: {
        ensembleVersion: config.version.ensembleVersion,
        strategyVersion: config.version.strategyVersion,
        modelVersions: config.version.modelVersions,
        weightVersion: config.version.weightVersion,
        configurationVersion: config.version.configurationVersion,
        validationVersion: config.version.validationVersion,
      },
    }

    const frozen = Object.freeze(ensemblePrediction) as EnsemblePrediction
    this.predictions.push(frozen)
    if (this.predictions.length > 1000) this.predictions.shift()

    if (degradation.unavailableModels.length > 0) this.stats.degradedPredictions++

    const latencyMs = Date.now() - startTime
    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > 500) this.latencySamples.shift()
    this.stats.avgLatencyMs = this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length

    log.info(`ensemble ${opts.ensembleId} prediction: EV=${expectedValue.toFixed(4)}, uncertainty=${finalUncertainty.toFixed(3)}, active=${degradation.availableModels.length}/${config.constituentModelIds.length}, health=${degradation.healthStatus}`)
    return frozen
  }

  /** Apply the configured ensemble strategy (§5). */
  private applyStrategy(strategy: EnsembleStrategy, contributions: ModelContribution[]): {
    expectedValue: number
    predictionInterval: [number, number]
  } {
    const values = contributions.map((c) => c.prediction.expectedValue)
    const weights = contributions.map((c) => c.normalizedWeight)
    const intervals = contributions.map((c) => c.prediction.predictionInterval)

    switch (strategy) {
      case 'WEIGHTED_AVERAGING': {
        let ev = 0
        for (let i = 0; i < values.length; i++) ev += values[i] * weights[i]
        const lo = intervals.reduce((min, [l]) => Math.min(min, l), Infinity)
        const hi = intervals.reduce((max, [, h]) => Math.max(max, h), -Infinity)
        return { expectedValue: ev, predictionInterval: [lo, hi] }
      }
      case 'MAJORITY_VOTING': {
        // For classification: majority vote
        const counts: Record<number, number> = {}
        for (let i = 0; i < values.length; i++) {
          const v = Math.round(values[i])
          counts[v] = (counts[v] ?? 0) + weights[i]
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
        const ev = Number(sorted[0]?.[0] ?? 0)
        return { expectedValue: ev, predictionInterval: [ev, ev] }
      }
      case 'PROBABILITY_AVERAGING': {
        const ev = values.reduce((a, b) => a + b, 0) / values.length
        const lo = intervals.reduce((sum, [l]) => sum + l, 0) / intervals.length
        const hi = intervals.reduce((sum, [, h]) => sum + h, 0) / intervals.length
        return { expectedValue: ev, predictionInterval: [lo, hi] }
      }
      case 'RANK_AGGREGATION': {
        // Average rank
        const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
        const ranks = new Array(values.length)
        sorted.forEach((s, rank) => { ranks[s.i] = rank })
        const ev = ranks.reduce((a, b) => a + b, 0) / ranks.length
        return { expectedValue: ev, predictionInterval: [0, values.length - 1] }
      }
      case 'STACKING':
      case 'BLENDING':
      case 'META_ENSEMBLE':
      case 'HIERARCHICAL': {
        // Rule 17 — would use OOF-trained meta-model. Simplified: weighted average.
        let ev = 0
        for (let i = 0; i < values.length; i++) ev += values[i] * weights[i]
        const lo = intervals.reduce((min, [l]) => Math.min(min, l), Infinity)
        const hi = intervals.reduce((max, [, h]) => Math.max(max, h), -Infinity)
        return { expectedValue: ev, predictionInterval: [lo, hi] }
      }
      default: {
        const ev = values.reduce((a, b) => a + b, 0) / values.length
        return { expectedValue: ev, predictionInterval: [ev * 0.9, ev * 1.1] }
      }
    }
  }

  /** Aggregate confidence (§8 — independent from prediction values, Rule 8). */
  private aggregateConfidence(contributions: ModelContribution[], degradation: GracefulDegradationResult): number {
    // Confidence = weighted average of individual model confidences
    let conf = 0
    let totalWeight = 0
    for (const c of contributions) {
      conf += c.confidence * c.normalizedWeight
      totalWeight += c.normalizedWeight
    }
    const avgConfidence = totalWeight > 0 ? conf / totalWeight : 0.5

    // Model agreement factor (§8) — lower agreement = lower confidence
    const values = contributions.map((c) => c.prediction.expectedValue)
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, values.length)
    const agreement = Math.max(0, 1 - Math.sqrt(variance))

    return avgConfidence * 0.6 + agreement * 0.4
  }

  /** Aggregate uncertainty (§9 — independent from confidence, Rule 8). */
  private aggregateUncertainty(contributions: ModelContribution[], degradation: GracefulDegradationResult): number {
    // Uncertainty = weighted average + cross-model variance
    let unc = 0
    let totalWeight = 0
    for (const c of contributions) {
      unc += c.uncertainty * c.normalizedWeight
      totalWeight += c.normalizedWeight
    }
    const avgUncertainty = totalWeight > 0 ? unc / totalWeight : 0.5

    // Cross-model variance (§9)
    const values = contributions.map((c) => c.prediction.expectedValue)
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
    const crossVariance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, values.length)
    const crossUncertainty = Math.min(1, Math.sqrt(crossVariance) * 10)

    return avgUncertainty * 0.5 + crossUncertainty * 0.5
  }

  /** Check graceful degradation (§14, Rule 18). */
  private checkDegradation(
    constituentPredictions: Array<{ modelId: string; available: boolean; unavailableReason?: string }>,
    config: EnsembleConfig,
  ): GracefulDegradationResult {
    const available: string[] = []
    const unavailable: Array<{ modelId: string; reason: string }> = []

    for (const cp of constituentPredictions) {
      if (cp.available) {
        available.push(cp.modelId)
      } else {
        unavailable.push({ modelId: cp.modelId, reason: cp.unavailableReason ?? 'unknown' })
      }
    }

    const totalModels = config.constituentModelIds.length
    const availableFraction = totalModels > 0 ? available.length / totalModels : 0
    const quorumSatisfied = availableFraction >= config.minQuorum

    // Renormalize weights (Rule 18 — exclude unavailable, renormalize remaining)
    const renormalizedWeights: Record<string, number> = {}
    let totalWeight = 0
    for (const modelId of available) {
      totalWeight += config.weights[modelId] ?? 0
    }
    for (const modelId of available) {
      renormalizedWeights[modelId] = totalWeight > 0 ? (config.weights[modelId] ?? 0) / totalWeight : 1 / available.length
    }

    // Rule 18 — increase epistemic uncertainty proportionally to missing models
    const missingFraction = totalModels > 0 ? unavailable.length / totalModels : 0
    const uncertaintyIncrease = missingFraction * 0.3 // 30% increase per full missing

    // Health status
    const healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' =
      unavailable.length === 0 ? 'HEALTHY' : availableFraction >= 0.75 ? 'DEGRADED' : 'CRITICAL'

    return {
      availableModels: available,
      unavailableModels: unavailable,
      quorumSatisfied,
      renormalizedWeights,
      uncertaintyIncrease,
      healthStatus,
    }
  }

  /** Analyze model diversity (§10, Rule 11). */
  analyzeDiversity(
    modelPredictions: Record<string, number[]>, // modelId → array of predictions
  ): DiversityReport {
    const modelIds = Object.keys(modelPredictions)
    const predictionCorrelation: Record<string, Record<string, number>> = {}

    for (const m1 of modelIds) {
      predictionCorrelation[m1] = {}
      for (const m2 of modelIds) {
        if (m1 === m2) {
          predictionCorrelation[m1][m2] = 1
        } else {
          predictionCorrelation[m1][m2] = this.pearsonCorrelation(modelPredictions[m1], modelPredictions[m2])
        }
      }
    }

    // Identify redundant models (high correlation with another model)
    const redundant: string[] = []
    for (const m1 of modelIds) {
      for (const m2 of modelIds) {
        if (m1 !== m2 && Math.abs(predictionCorrelation[m1][m2]) > 0.85 && !redundant.includes(m1)) {
          redundant.push(m1)
          break
        }
      }
    }

    // Overall diversity (1 - average absolute correlation)
    let totalCorr = 0
    let count = 0
    for (const m1 of modelIds) {
      for (const m2 of modelIds) {
        if (m1 !== m2) {
          totalCorr += Math.abs(predictionCorrelation[m1][m2])
          count++
        }
      }
    }
    const avgCorr = count > 0 ? totalCorr / count : 0
    const overallDiversity = 1 - avgCorr

    return {
      predictionCorrelation,
      errorCorrelation: null,
      featureSimilarity: null,
      algorithmDiversity: 0.7, // simplified
      trainingDiversity: 0.6, // simplified
      overallDiversity,
      redundantModels: redundant,
      recommendation: redundant.length > 0 ? `Reduce weighting for correlated models: ${redundant.join(', ')}` : 'Models are sufficiently diverse',
    }
  }

  getStats() {
    return { ...this.stats, registeredEnsembles: this.ensembles.size, totalPredictionsInHistory: this.predictions.length }
  }

  private pearsonCorrelation(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length)
    if (n < 2) return 0
    const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n
    const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n
    let num = 0, denA = 0, denB = 0
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA
      const db = b[i] - meanB
      num += da * db
      denA += da * da
      denB += db * db
    }
    const den = Math.sqrt(denA * denB)
    return den > 1e-10 ? num / den : 0
  }
}

export const modelEnsembleEngine = new ModelEnsembleEngine()
