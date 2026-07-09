// CHAPTER 2.5 §8 — Market Drift Detection
// CHAPTER 2.5 §9 — Feature Drift Detection
// CHAPTER 2.5 §10 — Model Drift Detection
// CHAPTER 2.5 §10.1 — Model Decay Policy
//
// Market drift (§8): volatility shifts, liquidity changes, structural breaks,
//   sentiment changes, correlation changes, feature distribution changes.
// Feature drift (§9): distribution shifts, missing value increases, abnormal
//   ranges, feature correlations, feature quality.
// Model drift (§10): compare expected vs observed performance → deviation
//   analysis → governance decision (Continue/Recalibrate/Retrain/Suspend/Retire).
// Model decay (§10.1): configurable deviation limits → governance actions
//   (alert, reduce confidence, suspend, observe, retire).

import { createLogger } from '../../domains/01-core-infrastructure'
import { performanceMonitor, type RollingPerformanceMetrics } from './performance-monitoring'
import { predictionTraceability } from './prediction-traceability'
import { aiModelRegistry } from './model-lifecycle'
import { governanceAlerts, type AlertSeverity } from './governance-alerts'

const log = createLogger('ai-governance:drift')

// ─────────────────────────────────────────────────────────────────────────────
// Drift detection result types
// ─────────────────────────────────────────────────────────────────────────────

export type DriftType = 'MARKET' | 'FEATURE' | 'MODEL'
export type DriftSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface DriftDetectionResult {
  type: DriftType
  severity: DriftSeverity
  component: string
  metric: string
  expected: number
  observed: number
  deviation: number
  detectedAt: number
  description: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Market drift detector  (Chapter 2.5 §8)
// ─────────────────────────────────────────────────────────────────────────────

interface MarketBaseline {
  averageVolatility: number
  averageLiquidity: number
  averageSentiment: number
  averageCorrelation: number
  establishedAt: number
}

class MarketDriftDetector {
  private baseline: MarketBaseline | null = null
  private history: DriftDetectionResult[] = []
  private readonly historyLimit = 500

  /** Establish the market baseline (call after sufficient data accumulates). */
  setBaseline(baseline: MarketBaseline): void {
    this.baseline = baseline
    log.info(`market baseline established: vol=${baseline.averageVolatility.toFixed(3)}, liq=${baseline.averageLiquidity.toFixed(3)}, sentiment=${baseline.averageSentiment.toFixed(2)}`)
  }

  /** Detect market drift (§8) against the baseline. */
  detect(current: {
    volatility: number
    liquidity: number
    sentiment: number
    correlation: number
  }): DriftDetectionResult[] {
    if (!this.baseline) return []
    const results: DriftDetectionResult[] = []

    // Volatility shift (§8)
    const volDeviation = Math.abs(current.volatility - this.baseline.averageVolatility) / Math.max(0.001, this.baseline.averageVolatility)
    if (volDeviation > 0.5) {
      results.push(this.makeResult('MARKET', 'volatility-shift', this.baseline.averageVolatility, current.volatility, volDeviation,
        `Volatility shifted ${(volDeviation * 100).toFixed(0)}% from baseline`))
    }

    // Liquidity change (§8)
    const liqDeviation = Math.abs(current.liquidity - this.baseline.averageLiquidity) / Math.max(0.001, this.baseline.averageLiquidity)
    if (liqDeviation > 0.4) {
      results.push(this.makeResult('MARKET', 'liquidity-change', this.baseline.averageLiquidity, current.liquidity, liqDeviation,
        `Liquidity changed ${(liqDeviation * 100).toFixed(0)}% from baseline`))
    }

    // Sentiment change (§8)
    const sentDeviation = Math.abs(current.sentiment - this.baseline.averageSentiment) / Math.max(0.01, Math.abs(this.baseline.averageSentiment))
    if (sentDeviation > 0.6) {
      results.push(this.makeResult('MARKET', 'sentiment-change', this.baseline.averageSentiment, current.sentiment, sentDeviation,
        `Sentiment shifted ${(sentDeviation * 100).toFixed(0)}% from baseline`))
    }

    // Correlation change (§8)
    const corrDeviation = Math.abs(current.correlation - this.baseline.averageCorrelation)
    if (corrDeviation > 0.3) {
      results.push(this.makeResult('MARKET', 'correlation-change', this.baseline.averageCorrelation, current.correlation, corrDeviation,
        `Correlation structure changed by ${corrDeviation.toFixed(2)} from baseline`))
    }

    for (const r of results) {
      this.history.push(r)
      governanceAlerts.alert({
        type: 'MARKET_DRIFT',
        severity: r.severity as AlertSeverity,
        component: 'market-intelligence',
        message: r.description,
        metadata: { metric: r.metric, expected: r.expected, observed: r.observed },
      })
    }
    if (this.history.length > this.historyLimit) this.history.shift()
    return results
  }

  private makeResult(type: DriftType, metric: string, expected: number, observed: number, deviation: number, description: string): DriftDetectionResult {
    const severity: DriftSeverity = deviation > 1.0 ? 'CRITICAL' : deviation > 0.7 ? 'HIGH' : deviation > 0.5 ? 'MEDIUM' : 'LOW'
    return { type, severity, component: 'market', metric, expected, observed, deviation, detectedAt: Date.now(), description }
  }

  getHistory(limit = 50): DriftDetectionResult[] {
    return this.history.slice(-limit)
  }
}

export const marketDriftDetector = new MarketDriftDetector()

// ─────────────────────────────────────────────────────────────────────────────
// Feature drift detector  (Chapter 2.5 §9)
// ─────────────────────────────────────────────────────────────────────────────

interface FeatureBaseline {
  featureId: string
  mean: number
  std: number
  missingRate: number
  establishedAt: number
}

class FeatureDriftDetector {
  private baselines = new Map<string, FeatureBaseline>()
  private history: DriftDetectionResult[] = []
  private readonly historyLimit = 1000

  setBaseline(featureId: string, mean: number, std: number, missingRate: number): void {
    this.baselines.set(featureId, { featureId, mean, std, missingRate, establishedAt: Date.now() })
  }

  /** Detect feature drift (§9). */
  detect(featureId: string, current: { mean: number; std: number; missingRate: number }): DriftDetectionResult[] {
    const baseline = this.baselines.get(featureId)
    if (!baseline) return []
    const results: DriftDetectionResult[] = []

    // Distribution shift (§9) — mean moved > 2 std
    const meanShift = Math.abs(current.mean - baseline.mean) / Math.max(0.001, baseline.std)
    if (meanShift > 2) {
      results.push(this.makeResult('FEATURE', featureId, 'distribution-shift', baseline.mean, current.mean, meanShift,
        `Feature "${featureId}" mean shifted ${meanShift.toFixed(1)}σ from baseline`))
    }

    // Missing value increase (§9)
    const missingIncrease = current.missingRate - baseline.missingRate
    if (missingIncrease > 0.1) {
      results.push(this.makeResult('FEATURE', featureId, 'missing-increase', baseline.missingRate, current.missingRate, missingIncrease,
        `Feature "${featureId}" missing rate increased by ${(missingIncrease * 100).toFixed(0)}%`))
    }

    // Abnormal range (§9) — std changed significantly
    const stdChange = Math.abs(current.std - baseline.std) / Math.max(0.001, baseline.std)
    if (stdChange > 1.0) {
      results.push(this.makeResult('FEATURE', featureId, 'abnormal-range', baseline.std, current.std, stdChange,
        `Feature "${featureId}" std changed ${(stdChange * 100).toFixed(0)}% from baseline`))
    }

    for (const r of results) {
      this.history.push(r)
      governanceAlerts.alert({
        type: 'FEATURE_DRIFT',
        severity: r.severity as AlertSeverity,
        component: 'feature-engineering',
        message: r.description,
        metadata: { featureId, metric: r.metric },
      })
    }
    if (this.history.length > this.historyLimit) this.history.shift()
    return results
  }

  private makeResult(type: DriftType, component: string, metric: string, expected: number, observed: number, deviation: number, description: string): DriftDetectionResult {
    const severity: DriftSeverity = deviation > 3 ? 'CRITICAL' : deviation > 2 ? 'HIGH' : deviation > 1.5 ? 'MEDIUM' : 'LOW'
    return { type, severity, component, metric, expected, observed, deviation, detectedAt: Date.now(), description }
  }

  getHistory(limit = 50): DriftDetectionResult[] {
    return this.history.slice(-limit)
  }
}

export const featureDriftDetector = new FeatureDriftDetector()

// ─────────────────────────────────────────────────────────────────────────────
// Model decay policy  (Chapter 2.5 §10, §10.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface DecayPolicyConfig {
  maxCalibrationDegradation: number // e.g. 0.15 — calibrationError can worsen by at most 0.15
  maxConfidenceMiscalibration: number // e.g. 0.25
  maxDirectionalAccuracyDecline: number // e.g. 0.10
  minRollingEvaluationWindow: number // ms — minimum window for valid evaluation
  minSampleSize: number // minimum resolved predictions for valid evaluation
}

export const DEFAULT_DECAY_POLICY: DecayPolicyConfig = {
  maxCalibrationDegradation: 0.15,
  maxConfidenceMiscalibration: 0.25,
  maxDirectionalAccuracyDecline: 0.10,
  minRollingEvaluationWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
  minSampleSize: 30,
}

export type GovernanceAction =
  | 'CONTINUE'
  | 'GENERATE_ALERT'
  | 'REDUCE_CONFIDENCE'
  | 'SUSPEND_PUBLICATION'
  | 'OBSERVATION_MODE'
  | 'RETIRE'

export interface DecayEvaluation {
  modelId: string
  evaluatedAt: number
  baselineMetrics: ValidationMetrics | null
  observedMetrics: RollingPerformanceMetrics
  deviations: Array<{ metric: string; baseline: number; observed: number; deviation: number; limit: number; exceeded: boolean }>
  actions: GovernanceAction[]
  decision: 'CONTINUE' | 'RECALIBRATE' | 'RETRAIN' | 'SUSPEND' | 'RETIRE'
  severity: DriftSeverity
}

import type { ValidationMetrics } from './model-lifecycle'

class ModelDecayPolicy {
  private config: DecayPolicyConfig = { ...DEFAULT_DECAY_POLICY }
  private evaluations = new Map<string, DecayEvaluation[]>()
  private subscribers = new Set<(eval_: DecayEvaluation) => void>()

  setConfig(patch: Partial<DecayPolicyConfig>): void {
    this.config = { ...this.config, ...patch }
    log.info(`decay policy config updated: ${JSON.stringify(this.config)}`)
  }

  getConfig(): DecayPolicyConfig {
    return { ...this.config }
  }

  /** Evaluate a model's decay against its baseline (§10.1). */
  evaluate(modelId: string): DecayEvaluation | null {
    const model = aiModelRegistry.get(modelId)
    if (!model) return null

    const observed = performanceMonitor.getLatest(modelId)
    if (!observed || observed.sampleSize < this.config.minSampleSize) {
      return null // insufficient data
    }

    const baseline = model.validationMetrics
    const deviations: DecayEvaluation['deviations'] = []
    const actions: GovernanceAction[] = []

    if (baseline) {
      // Calibration degradation (§10.1)
      const calibDev = observed.calibrationQuality < (1 - baseline.calibrationError)
        ? (1 - baseline.calibrationError) - observed.calibrationQuality : 0
      deviations.push({
        metric: 'calibration',
        baseline: 1 - baseline.calibrationError,
        observed: observed.calibrationQuality,
        deviation: calibDev,
        limit: this.config.maxCalibrationDegradation,
        exceeded: calibDev > this.config.maxCalibrationDegradation,
      })
      if (calibDev > this.config.maxCalibrationDegradation) actions.push('GENERATE_ALERT', 'REDUCE_CONFIDENCE')

      // Directional accuracy decline (§10.1)
      const dirDecline = baseline.directionalAccuracy - observed.directionalAccuracy
      deviations.push({
        metric: 'directional-accuracy',
        baseline: baseline.directionalAccuracy,
        observed: observed.directionalAccuracy,
        deviation: dirDecline,
        limit: this.config.maxDirectionalAccuracyDecline,
        exceeded: dirDecline > this.config.maxDirectionalAccuracyDecline,
      })
      if (dirDecline > this.config.maxDirectionalAccuracyDecline) actions.push('GENERATE_ALERT', 'SUSPEND_PUBLICATION')

      // Confidence miscalibration (§10.1)
      const confMiscal = 1 - observed.confidenceCalibration
      deviations.push({
        metric: 'confidence-miscalibration',
        baseline: 0,
        observed: confMiscal,
        deviation: confMiscal,
        limit: this.config.maxConfidenceMiscalibration,
        exceeded: confMiscal > this.config.maxConfidenceMiscalibration,
      })
      if (confMiscal > this.config.maxConfidenceMiscalibration) actions.push('REDUCE_CONFIDENCE', 'OBSERVATION_MODE')

      // EV realization decline (§10.1)
      const evDecline = baseline.expectedValueRealization - observed.expectedValueRealization
      if (evDecline > 0.3) {
        deviations.push({
          metric: 'ev-realization',
          baseline: baseline.expectedValueRealization,
          observed: observed.expectedValueRealization,
          deviation: evDecline,
          limit: 0.3,
          exceeded: true,
        })
        actions.push('GENERATE_ALERT')
      }
    }

    // Determine decision (§10: Continue/Recalibrate/Retrain/Suspend/Retire)
    const exceededCount = deviations.filter((d) => d.exceeded).length
    let decision: DecayEvaluation['decision'] = 'CONTINUE'
    let severity: DriftSeverity = 'NONE'
    if (exceededCount >= 3) {
      decision = 'RETIRE'
      severity = 'CRITICAL'
      actions.push('RETIRE')
    } else if (exceededCount >= 2) {
      decision = 'SUSPEND'
      severity = 'HIGH'
      actions.push('SUSPEND_PUBLICATION')
    } else if (exceededCount >= 1) {
      decision = 'RECALIBRATE'
      severity = 'MEDIUM'
      actions.push('OBSERVATION_MODE')
    }

    if (actions.length === 0) actions.push('CONTINUE')

    const evaluation: DecayEvaluation = {
      modelId,
      evaluatedAt: Date.now(),
      baselineMetrics: baseline,
      observedMetrics: observed,
      deviations,
      actions: [...new Set(actions)] as GovernanceAction[],
      decision,
      severity,
    }

    // Store + audit
    const hist = this.evaluations.get(modelId) ?? []
    hist.push(evaluation)
    if (hist.length > 200) hist.shift()
    this.evaluations.set(modelId, hist)

    // Emit governance alerts for exceeded limits (§10.1)
    if (exceededCount > 0) {
      governanceAlerts.alert({
        type: 'MODEL_DEGRADATION',
        severity: severity as AlertSeverity,
        component: 'ai-governance',
        message: `Model "${modelId}" decay: ${decision} (${exceededCount} limits exceeded)`,
        metadata: { modelId, deviations: deviations.filter((d) => d.exceeded) },
      })
    }

    // Apply governance actions (§10.1)
    this.applyActions(modelId, evaluation)

    log.info(`model decay [${modelId}]: ${decision} (severity ${severity}, ${exceededCount} limits exceeded)`)
    for (const sub of this.subscribers) sub(evaluation)
    return evaluation
  }

  /** Apply governance actions (§10.1 — alert, reduce confidence, suspend, observe, retire). */
  private applyActions(modelId: string, evaluation: DecayEvaluation): void {
    for (const action of evaluation.actions) {
      switch (action) {
        case 'SUSPEND_PUBLICATION':
          log.warn(`governance action: SUSPEND publication for model "${modelId}"`)
          // The workflow orchestrator checks operationalSafety before publishing
          break
        case 'OBSERVATION_MODE':
          log.warn(`governance action: move model "${modelId}" into OBSERVATION mode`)
          break
        case 'RETIRE':
          log.error(`governance action: RETIRE model "${modelId}"`)
          const model = aiModelRegistry.get(modelId)
          if (model && model.lifecycleState === 'PRODUCTION') {
            aiModelRegistry.transition(modelId, 'ARCHIVE', `Retired due to decay: ${evaluation.deviations.filter((d) => d.exceeded).map((d) => d.metric).join(', ')}`)
          }
          break
        case 'REDUCE_CONFIDENCE':
          // Confidence decay is already applied via performanceMonitor.getConfidenceDecay()
          log.info(`governance action: REDUCE confidence for model "${modelId}" (decay multiplier applied)`)
          break
        case 'GENERATE_ALERT':
          // Alert already emitted above
          break
        case 'CONTINUE':
          break
      }
    }
  }

  getLatestEvaluation(modelId: string): DecayEvaluation | undefined {
    const hist = this.evaluations.get(modelId)
    return hist?.[hist.length - 1]
  }

  getHistory(modelId: string, limit = 50): DecayEvaluation[] {
    return (this.evaluations.get(modelId) ?? []).slice(-limit)
  }

  subscribe(handler: (eval_: DecayEvaluation) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const modelDecayPolicy = new ModelDecayPolicy()

// Re-export
export { predictionTraceability }
