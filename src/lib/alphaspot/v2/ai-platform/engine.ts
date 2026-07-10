// CHAPTER 4.1 §9, §13, §14 — Prediction Governance + Inference Engine
//
// Governance (§13, Rule 10): version control, audit trail, calibration/performance/
// drift monitoring, promotion/rollback. No model bypasses governance.
//
// Inference Engine (§9, Rule 4): deterministic — identical model + features + config
// → identical predictions. Randomness PROHIBITED.
// Rule 15: only ProcessedFeatureVectors as input (no raw market data).
// Rule 1: produces probabilities, NOT trading decisions.
// Rule 13: advisory only — Decision Engine makes final calls.

import { createLogger } from '../domains/01-core-infrastructure'
import type { ProcessedFeatureVector } from '../feature-processing/types'
import type {
  GovernanceAction,
  ModelInterface,
  PredictionGovernanceState,
  PredictionRequest,
  PredictionResult,
  PredictionExplanation,
  UncertaintyEstimate,
} from './types'
import { INFERENCE_ENGINE_VERSION, PREDICTION_SCHEMA_VERSION } from './types'

const log = createLogger('ai-platform:inference')

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Governance  (Chapter 4.1 §13, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

class PredictionGovernance {
  private states = new Map<string, PredictionGovernanceState>() // modelId → state
  private auditLog: Array<{ modelId: string; action: GovernanceAction; at: number; note: string }> = []
  private readonly auditLimit = 10_000

  /** Register a model for governance (§13). */
  register(modelId: string): void {
    this.states.set(modelId, {
      modelId,
      calibrationStatus: 'UNKNOWN',
      performanceStatus: 'HEALTHY',
      driftStatus: 'STABLE',
      currentAction: 'APPROVED',
      lastAuditAt: Date.now(),
      promotionEligible: false,
    })
    log.info(`model registered for governance: ${modelId}`)
  }

  /** Check if a model is allowed to produce predictions (Rule 10). */
  canPredict(modelId: string): boolean {
    const state = this.states.get(modelId)
    if (!state) return false
    return state.currentAction === 'APPROVED' || state.currentAction === 'CALIBRATION_WARNING' || state.currentAction === 'DRIFT_WARNING'
  }

  /** Update calibration status (§9, Rule 9). */
  updateCalibration(modelId: string, calibrationScore: number): void {
    const state = this.states.get(modelId)
    if (!state) return
    state.calibrationStatus = calibrationScore > 0.8 ? 'CALIBRATED' : calibrationScore > 0.5 ? 'DEGRADED' : 'DEGRADED'
    if (calibrationScore < 0.5) {
      this.act(modelId, 'CALIBRATION_WARNING', `Calibration score dropped to ${calibrationScore.toFixed(2)}`)
    }
  }

  /** Update performance status. */
  updatePerformance(modelId: string, healthy: boolean): void {
    const state = this.states.get(modelId)
    if (!state) return
    state.performanceStatus = healthy ? 'HEALTHY' : 'DEGRADED'
    if (!healthy) this.act(modelId, 'PERFORMANCE_DEGRADED', 'Performance degraded')
  }

  /** Update drift status. */
  updateDrift(modelId: string, driftLevel: 'STABLE' | 'DRIFTING' | 'SEVERE'): void {
    const state = this.states.get(modelId)
    if (!state) return
    state.driftStatus = driftLevel
    if (driftLevel === 'DRIFTING') this.act(modelId, 'DRIFT_WARNING', 'Model drift detected')
    if (driftLevel === 'SEVERE') this.act(modelId, 'SUSPENDED', 'Severe drift — model suspended')
  }

  /** Promote a model (§13 — promotion policy). */
  promote(modelId: string): boolean {
    const state = this.states.get(modelId)
    if (!state || !state.promotionEligible) return false
    this.act(modelId, 'APPROVED', 'Model promoted')
    return true
  }

  /** Rollback a model (§13 — rollback policy). */
  rollback(modelId: string, reason: string): void {
    this.act(modelId, 'ROLLED_BACK', reason)
  }

  /** Record a governance action (§13 — audit trail). */
  private act(modelId: string, action: GovernanceAction, note: string): void {
    const state = this.states.get(modelId)
    if (state) {
      state.currentAction = action
      state.lastAuditAt = Date.now()
    }
    this.auditLog.push({ modelId, action, at: Date.now(), note })
    if (this.auditLog.length > this.auditLimit) this.auditLog.shift()
    log.info(`governance [${modelId}]: ${action} — ${note}`)
  }

  getState(modelId: string): PredictionGovernanceState | undefined {
    return this.states.get(modelId)
  }

  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit)
  }
}

export const predictionGovernance = new PredictionGovernance()

// ─────────────────────────────────────────────────────────────────────────────
// Inference Engine  (Chapter 4.1 §9, §14, Rule 1, Rule 4, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

class InferenceEngine {
  private models = new Map<string, ModelInterface>()
  private stats = {
    totalPredictions: 0,
    inferenceFailures: 0,
    avgLatencyMs: 0,
  }
  private latencySamples: number[] = []
  private subscribers = new Set<(prediction: PredictionResult) => void>()

  /** Register a model (§8 — any model family, algorithm-independent). */
  registerModel(model: ModelInterface): void {
    this.models.set(model.modelId, model)
    predictionGovernance.register(model.modelId)
    log.info(`model registered: ${model.modelId} (family: ${model.family}, targets: ${model.supportedTargets.length}, horizons: ${model.supportedHorizons.length})`)
  }

  /**
   * Run a prediction (§9, Rule 4 — deterministic, Rule 1 — probability not decision).
   *
   * Rule 15: input must be a ProcessedFeatureVector (no raw market data).
   * Rule 10: model must pass governance check.
   * Rule 4: identical model + features + config → identical predictions.
   */
  async predict(request: PredictionRequest): Promise<PredictionResult | null> {
    const startTime = Date.now()

    // Find a model that supports this target + horizon
    const model = this.findModel(request.target, request.horizon)
    if (!model) {
      log.warn(`no model available for target ${request.target} horizon ${request.horizon}`)
      return null
    }

    // Rule 10 — governance check
    if (!predictionGovernance.canPredict(model.modelId)) {
      log.warn(`model ${model.modelId} is not allowed to predict (governance)`)
      return null
    }

    try {
      // §9, Rule 4 — deterministic inference
      const modelOutput = await model.infer(request.features, request.target, request.horizon)

      // §7 — compute confidence (epistemic) — distinct from probability (aleatoric)
      const confidence = this.computeConfidence(model, request.features)

      // §11, Rule 2 — uncertainty quantification
      const uncertainty = this.computeUncertainty(model, request.features, modelOutput, confidence)

      // §12, Rule 7 — explainability (model-independent)
      const explanation = this.computeExplanation(model, request.features, confidence)

      // §10 — versioning
      const modelVersion = model.modelVersion

      // §7 — model agreement (for ensemble — simplified: 1 model = 1.0)
      const modelAgreement = 1.0

      // §9 — calibration score
      const calibrationScore = model.getCalibrationScore()

      // Build the prediction result
      const prediction: PredictionResult = {
        predictionId: `pred-${request.symbol}-${request.target}-${request.horizon}-${Date.now().toString(36)}`,
        symbol: request.symbol,
        target: request.target,
        horizon: request.horizon,
        predictionTimestamp: Date.now(),
        probability: modelOutput.probability,
        confidence,
        predictionInterval: modelOutput.predictionInterval,
        expectedValue: modelOutput.expectedValue,
        modelAgreement,
        calibrationScore,
        uncertainty,
        explanation,
        modelVersion,
        inputHash: this.hashFeatures(request.features),
      }

      // Update governance (§9 — calibration monitoring)
      predictionGovernance.updateCalibration(model.modelId, calibrationScore)

      // Stats
      this.stats.totalPredictions++
      const latencyMs = Date.now() - startTime
      this.latencySamples.push(latencyMs)
      if (this.latencySamples.length > 500) this.latencySamples.shift()
      this.stats.avgLatencyMs = this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length

      // Notify subscribers
      for (const sub of this.subscribers) {
        try { sub(prediction) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
      }

      return Object.freeze(prediction) // immutable output
    } catch (e) {
      this.stats.inferenceFailures++
      log.error(`inference failed for ${request.symbol} ${request.target}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** Find a model that supports the requested target + horizon (§8). */
  private findModel(target: PredictionRequest['target'], horizon: PredictionRequest['horizon']): ModelInterface | null {
    for (const model of this.models.values()) {
      if (model.supportedTargets.includes(target) && model.supportedHorizons.includes(horizon)) {
        return model
      }
    }
    return null
  }

  /** Compute confidence (epistemic uncertainty — §7, Rule 3). */
  private computeConfidence(model: ModelInterface, features: ProcessedFeatureVector): number {
    // Confidence = model's certainty in its own forecast based on data density + historical familiarity
    const featureQuality = features.featureQualityScore ?? 0.5
    const calibration = model.getCalibrationScore()
    // Higher feature quality + better calibration → higher confidence
    return Math.max(0, Math.min(1, featureQuality * 0.5 + calibration * 0.5))
  }

  /** Compute uncertainty (§11, Rule 2). */
  private computeUncertainty(
    model: ModelInterface,
    features: ProcessedFeatureVector,
    output: { probability: number },
    confidence: number,
  ): UncertaintyEstimate {
    const dataUncertainty = 1 - Math.abs(output.probability - 0.5) * 2 // probability near 0.5 = high data uncertainty
    const modelUncertainty = 1 - confidence
    const featureQuality = features.featureQualityScore ?? 0.5
    const regimeAlignment = 0.7 // simplified — would come from market regime engine
    const predictionStability = 0.8 // simplified — would track recent prediction consistency
    const overallUncertainty = (dataUncertainty + modelUncertainty + (1 - featureQuality)) / 3

    return {
      dataUncertainty,
      modelUncertainty,
      featureQuality,
      regimeAlignment,
      predictionStability,
      overallUncertainty,
    }
  }

  /** Compute explanation (§12, Rule 7 — model-independent). */
  private computeExplanation(
    model: ModelInterface,
    features: ProcessedFeatureVector,
    confidence: number,
  ): PredictionExplanation {
    const featureImportance = model.getFeatureImportance(features)
    return {
      featureImportance,
      predictionDrivers: featureImportance.slice(0, 3).map((f) => `${f.feature} (${f.direction}, ${f.importance.toFixed(2)})`),
      confidenceExplanation: confidence > 0.7
        ? 'High confidence — strong feature quality and model calibration.'
        : confidence > 0.4
          ? 'Moderate confidence — some uncertainty in feature quality or model calibration.'
          : 'Low confidence — poor feature quality or model calibration degradation.',
      historicalSimilarity: null, // would be computed by XAI module (Ch 4.10)
      modelContribution: null, // would be populated by ensemble (Ch 4.9)
    }
  }

  /** Hash features for reproducibility (Rule 14). */
  private hashFeatures(features: ProcessedFeatureVector): string {
    const str = JSON.stringify(features.processedFeatures)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return `hash-${hash.toString(36)}`
  }

  /** Subscribe to predictions (§14 — observability). */
  onPrediction(handler: (prediction: PredictionResult) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Observability (§14). */
  getStats() {
    return {
      ...this.stats,
      registeredModels: this.models.size,
      governanceStates: Array.from(predictionGovernance.getState.length),
    }
  }
}

export const inferenceEngine = new InferenceEngine()
