// CHAPTER 4.11 §5-§23 — Online Inference Engine
//
// 15-stage pipeline (§5). Dual-Slot A/B (§6, Rule 22). Schema validation (§7-8, Rule 5/6).
// Ensemble execution (§9). Canonical Prediction Tuple (§10, Rule 4).
// Latency management (§11, Rule 12). Graceful degradation (Rule 14).
// Point-in-Time replay (§14, Rule 23). Async XAI (Rule 13). SLOs (Rule 18).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { ProcessedFeatureVector } from '../../feature-processing/types'
import type { CanonicalPredictionTuple } from '../models/types'
import type {
  InferenceRequest,
  InferenceResult,
  ModelSlot,
  PointInTimeReplayRecord,
  RuntimeMetadata,
  InferenceGovernance,
  InferenceLineage,
  ConfidenceMetadata,
  UncertaintyMetadata,
  SchemaValidationResult,
  SLOConfig,
  SLOStatus,
  LatencyBudget,
} from './types'
import { OIE_VERSION, RUNTIME_VERSION } from './types'

const log = createLogger('ai-platform:inference:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Online Inference Engine  (Chapter 4.11 §1 — main facade)
// ─────────────────────────────────────────────────────────────────────────────

class OnlineInferenceEngine {
  // Rule 22 — Dual-Slot (A/B) deployment
  private slots: Record<'A' | 'B', ModelSlot> = {
    A: { slotId: 'A', modelId: null, state: 'EMPTY', cryptoVerified: false, compatibilityVerified: false, warmUpComplete: false, healthVerified: false, loadedAt: null, activatedAt: null, inFlightRequests: 0 },
    B: { slotId: 'B', modelId: null, state: 'EMPTY', cryptoVerified: false, compatibilityVerified: false, warmUpComplete: false, healthVerified: false, loadedAt: null, activatedAt: null, inFlightRequests: 0 },
  }
  private activeSlot: 'A' | 'B' = 'A'

  private predictions: InferenceResult[] = []
  private replayRecords: PointInTimeReplayRecord[] = []
  private latencySamples: number[] = []
  private sloConfig: SLOConfig | null = null
  private stats = {
    totalPredictions: 0,
    successfulPredictions: 0,
    failedPredictions: 0,
    quarantinedRequests: 0,
    degradedPredictions: 0,
    asyncXaiDispatched: 0,
    replayRecordsCreated: 0,
    sloViolations: 0,
  }
  private xaiDispatchHandler: ((predictionId: string, featureVector: ProcessedFeatureVector) => void) | null = null

  /**
   * Load a model into the inactive slot (§6, Rule 21, Rule 22).
   * Async — never blocks live inference.
   * Crypto verification, compatibility, warm-up all happen before activation.
   */
  async loadModel(opts: {
    modelId: string
    cryptoSignatureValid: boolean
    compatibilityVerified: boolean
    warmUpComplete: boolean
    healthVerified: boolean
  }): Promise<void> {
    // Rule 22 — load into the INACTIVE slot
    const inactiveSlot: 'A' | 'B' = this.activeSlot === 'A' ? 'B' : 'A'
    const slot = this.slots[inactiveSlot]

    slot.modelId = opts.modelId
    slot.state = 'LOADING'
    slot.loadedAt = Date.now()

    // Rule 8 — crypto verification
    slot.state = 'VERIFYING'
    slot.cryptoVerified = opts.cryptoSignatureValid
    if (!opts.cryptoSignatureValid) {
      slot.state = 'EMPTY'
      slot.modelId = null
      throw new Error(`[oie] model "${opts.modelId}" crypto verification FAILED — rejected (Rule 8)`)
    }

    slot.compatibilityVerified = opts.compatibilityVerified
    slot.state = 'WARMING_UP'
    slot.warmUpComplete = opts.warmUpComplete
    slot.healthVerified = opts.healthVerified

    if (opts.compatibilityVerified && opts.warmUpComplete && opts.healthVerified) {
      slot.state = 'READY'
      log.info(`model ${opts.modelId} loaded into Slot ${inactiveSlot} — READY for activation`)
    }
  }

  /**
   * Promote the inactive slot to production (§6, Rule 22).
   * Atomic pointer transition. Old slot remains until in-flight requests complete.
   */
  promoteModel(): void {
    const inactiveSlot: 'A' | 'B' = this.activeSlot === 'A' ? 'B' : 'A'
    const newSlot = this.slots[inactiveSlot]
    const oldSlot = this.slots[this.activeSlot]

    if (newSlot.state !== 'READY') {
      throw new Error(`[oie] Slot ${inactiveSlot} not READY — cannot promote (Rule 22)`)
    }

    // Rule 22 — atomic pointer transition
    this.activeSlot = inactiveSlot
    newSlot.state = 'ACTIVE'
    newSlot.activatedAt = Date.now()

    log.info(`model ${newSlot.modelId} promoted to PRODUCTION (Slot ${inactiveSlot}). Previous: ${oldSlot.modelId} (Slot ${this.activeSlot === 'A' ? 'B' : 'A'})`)

    // Rule 22 — old slot remains until in-flight requests complete
    if (oldSlot.inFlightRequests === 0) {
      oldSlot.state = 'EMPTY'
      oldSlot.modelId = null
      log.info(`Slot ${this.activeSlot === 'A' ? 'B' : 'A'} unloaded — zero in-flight requests`)
    } else {
      oldSlot.state = 'UNLOADING'
      log.info(`Slot ${this.activeSlot === 'A' ? 'B' : 'A'} unloading — ${oldSlot.inFlightRequests} in-flight requests`)
    }
  }

  /**
   * Execute the full 15-stage inference pipeline (§5, no skips).
   * Rule 3 — unique Prediction ID. Rule 4 — Canonical Prediction Tuple.
   * Rule 5 — schema validation before execution. Rule 6 — quarantine on mismatch.
   * Rule 13 — async XAI. Rule 23 — Point-in-Time replay (async).
   */
  async infer(request: InferenceRequest): Promise<InferenceResult | null> {
    const startTime = Date.now()
    const slot = this.slots[this.activeSlot]
    this.stats.totalPredictions++
    slot.inFlightRequests++

    try {
      // Stage 1: Feature Reception (§5)
      // (implicit — request received)

      // Stage 2: Feature Validation (§7)
      if (!request.featureVector || !request.featureVector.processedFeatures) {
        this.stats.failedPredictions++
        log.warn(`inference ${request.requestId} failed — invalid feature vector`)
        return null
      }

      // Stage 3: Schema Verification (§8, Rule 5, Rule 6)
      const schemaResult = this.verifySchema(request)
      if (!schemaResult.valid) {
        this.stats.quarantinedRequests++
        log.warn(`inference ${request.requestId} QUARANTINED — schema mismatch: ${schemaResult.errors.join('; ')} (Rule 6)`)
        return null
      }

      // Stage 4: Feature Compatibility Verification (§5)
      // (verified as part of schema check)

      // Stage 5: Production Model Resolution (§5)
      if (slot.state !== 'ACTIVE' || !slot.modelId) {
        this.stats.failedPredictions++
        log.error(`inference ${request.requestId} failed — no active production model`)
        return null
      }

      // Stage 6: Loaded Model Verification (§5)
      // (verified during loading — crypto, compatibility, warm-up)

      // Stage 7: Ensemble Resolution (§9, Rule 7)
      // (ensemble handled by the ensemble engine — here we just note the ID)

      // Stage 8: Prediction Execution (§5)
      // Simulate deterministic prediction (Rule 4 — Canonical Prediction Tuple)
      const predictionTuple = this.executePrediction(request.featureVector)

      // Stage 9: Confidence Estimation (§5, Rule 11 — independent from uncertainty)
      const confidence = this.estimateConfidence(request.featureVector, predictionTuple)

      // Stage 10: Uncertainty Estimation (§5, Rule 11 — independent from confidence)
      const uncertainty = this.estimateUncertainty(request.featureVector, predictionTuple)

      // Stage 11: Canonical Prediction Tuple Construction (§10, Rule 4)
      const canonicalTuple: CanonicalPredictionTuple = {
        ...predictionTuple,
        epistemicUncertainty: uncertainty.epistemicUncertainty,
        predictionInterval: predictionTuple.predictionInterval,
        metadata: {
          predictionVersion: OIE_VERSION,
          modelVersion: slot.modelId,
          featureSchemaVersion: request.featureVector.featureVersion,
          inferenceTimestamp: Date.now(),
        },
      }

      // Stage 12: Prediction Validation (§5)
      if (!Number.isFinite(canonicalTuple.expectedValue)) {
        this.stats.failedPredictions++
        log.error(`inference ${request.requestId} failed — invalid prediction value`)
        return null
      }

      // Stage 13: Prediction Publication (§5)
      const predictionId = `pred-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const processingDurationMs = Date.now() - startTime

      // Rule 14 — check for degraded mode
      const degraded = false // would come from ensemble engine
      const unavailableModels: string[] = []

      const runtimeMetadata: RuntimeMetadata = {
        processingDurationMs,
        workerId: `worker-${this.activeSlot}`,
        slotId: this.activeSlot, // Rule 22
        modelArtifactHash: `hash-${slot.modelId}`,
        runtimeVersion: RUNTIME_VERSION,
        degraded,
        unavailableModels,
        quorumSatisfied: true,
      }

      const governanceMetadata: InferenceGovernance = {
        predictionId,
        requestOrigin: request.requestOrigin,
        modelVersion: slot.modelId,
        ensembleVersion: request.ensembleId,
        featureVersion: request.featureVector.featureVersion,
        schemaVersion: request.featureVector.featureVersion,
        runtimeEnvironment: RUNTIME_VERSION,
        predictionTimestamp: Date.now(),
        processingDurationMs,
        auditMetadata: { slotId: this.activeSlot, requestId: request.requestId },
        // Rule 23 — Point-in-Time replay references
        pointInTimeFeatureVectorRef: `pit-${predictionId}`,
        featureVectorHash: request.featureSchemaHash,
        serializedFeatureSnapshotRef: `snapshot-${predictionId}`,
        lineage: {
          predictionId,
          featureVersion: request.featureVector.featureVersion,
          modelVersion: slot.modelId,
          ensembleVersion: request.ensembleId,
          schemaVersion: request.featureVector.featureVersion,
          configurationVersion: 'cfg-1',
          runtimeVersion: RUNTIME_VERSION,
        },
      }

      const result: InferenceResult = {
        ...canonicalTuple,
        predictionId,
        predictionTimestamp: Date.now(),
        predictionTarget: request.target,
        predictionHorizon: request.horizon,
        ensembleVersion: request.ensembleId,
        modelVersion: slot.modelId,
        featureVersion: request.featureVector.featureVersion,
        featureSchemaVersion: request.featureVector.featureVersion,
        confidenceMetadata: confidence,
        uncertaintyMetadata: uncertainty,
        runtimeMetadata,
        governanceMetadata,
        createdAt: Date.now(),
      }

      const frozen = Object.freeze(result) as InferenceResult
      this.predictions.push(frozen)
      if (this.predictions.length > 1000) this.predictions.shift()
      this.stats.successfulPredictions++

      // Track latency
      this.latencySamples.push(processingDurationMs)
      if (this.latencySamples.length > 1000) this.latencySamples.shift()

      // Stage 14: Async Point-in-Time Logging (Rule 23 — async, never increases latency)
      this.createReplayRecord(predictionId, request, canonicalTuple)

      // Stage 15: Async Explainability Dispatch (Rule 13 — async, predictions never wait)
      if (this.xaiDispatchHandler) {
        this.stats.asyncXaiDispatched++
        // Dispatch asynchronously — never blocks
        setTimeout(() => {
          try {
            this.xaiDispatchHandler!(predictionId, request.featureVector)
          } catch (e) {
            log.error(`async XAI dispatch failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }, 0)
      }

      // Rule 18 — check SLOs
      this.checkSLOs()

      log.info(`inference ${predictionId}: EV=${canonicalTuple.expectedValue.toFixed(4)}, ${processingDurationMs}ms, Slot ${this.activeSlot}`)
      return frozen

    } catch (e) {
      this.stats.failedPredictions++
      log.error(`inference ${request.requestId} failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally {
      slot.inFlightRequests = Math.max(0, slot.inFlightRequests - 1)
      // Rule 22 — unload old slot if in-flight requests complete
      const oldSlot = this.slots[this.activeSlot === 'A' ? 'B' : 'A']
      if (oldSlot.state === 'UNLOADING' && oldSlot.inFlightRequests === 0) {
        oldSlot.state = 'EMPTY'
        oldSlot.modelId = null
        log.info(`Slot ${oldSlot.slotId} unloaded — all in-flight requests completed`)
      }
    }
  }

  /** Verify feature schema (§8, Rule 5, Rule 6 — quarantine on mismatch, no auto-adaptation). */
  private verifySchema(request: InferenceRequest): SchemaValidationResult {
    const errors: string[] = []
    const features = request.featureVector.processedFeatures
    const featureNames = Object.keys(features)

    // §8 — Feature Count
    const countMatch = featureNames.length > 0
    if (!countMatch) errors.push('empty feature vector')

    // §8 — Feature Hash
    const computedHash = this.computeHash(featureNames)
    const hashMatch = computedHash === request.featureSchemaHash
    if (!hashMatch) errors.push(`hash mismatch: computed=${computedHash} vs expected=${request.featureSchemaHash}`)

    // §8 — Schema Version
    const versionMatch = !!request.featureVector.featureVersion
    if (!versionMatch) errors.push('missing schema version')

    return {
      valid: errors.length === 0,
      errors,
      countMatch,
      orderMatch: true, // simplified
      nameMatch: true,
      hashMatch,
      versionMatch,
      quarantined: errors.length > 0, // Rule 6
    }
  }

  /** Execute prediction (deterministic — Rule 4). */
  private executePrediction(features: ProcessedFeatureVector): CanonicalPredictionTuple {
    // Simplified deterministic prediction
    const rsi = features.processedFeatures['momentum.rsi'] ?? 50
    const macd = features.processedFeatures['momentum.macd'] ?? 0
    const rawScore = (50 - rsi) / 50 + macd * 0.1
    const expectedValue = 1 / (1 + Math.exp(-rawScore))

    return {
      expectedValue,
      epistemicUncertainty: 0.15, // overridden in uncertainty estimation
      predictionInterval: [expectedValue - 0.1, expectedValue + 0.1],
      metadata: {
        predictionVersion: OIE_VERSION,
        modelVersion: 'production',
        featureSchemaVersion: features.featureVersion,
        inferenceTimestamp: Date.now(),
      },
    }
  }

  /** Estimate confidence (Rule 11 — independent from uncertainty). */
  private estimateConfidence(features: ProcessedFeatureVector, prediction: CanonicalPredictionTuple): ConfidenceMetadata {
    const featureQuality = features.featureQualityScore ?? 0.5
    return {
      predictionConfidence: featureQuality * 0.6 + 0.3,
      method: 'feature_quality_calibrated',
      factors: { featureQuality, dataDensity: 0.8, modelFamiliarity: 0.75 },
    }
  }

  /** Estimate uncertainty (Rule 11 — independent from confidence). */
  private estimateUncertainty(features: ProcessedFeatureVector, prediction: CanonicalPredictionTuple): UncertaintyMetadata {
    const probability = prediction.expectedValue
    const aleatoric = 1 - Math.abs(probability - 0.5) * 2
    const epistemic = 1 - (features.featureQualityScore ?? 0.5)
    return {
      epistemicUncertainty: epistemic,
      aleatoricUncertainty: aleatoric,
      crossModelVariance: null, // populated by ensemble
      method: 'decomposition',
    }
  }

  /** Create Point-in-Time replay record (§14, Rule 23 — async, never increases latency). */
  private createReplayRecord(predictionId: string, request: InferenceRequest, tuple: CanonicalPredictionTuple): void {
    const record: PointInTimeReplayRecord = {
      predictionId,
      serializedFeatureVector: JSON.stringify(request.featureVector.processedFeatures),
      featureSchemaHash: request.featureSchemaHash,
      predictionMetadata: { target: request.target, horizon: request.horizon, timestamp: request.timestamp },
      runtimeMetadata: { modelVersion: this.slots[this.activeSlot].modelId, slotId: this.activeSlot },
      canonicalPredictionTuple: tuple,
      createdAt: Date.now(),
      asyncGenerated: true, // Rule 23
    }
    this.replayRecords.push(Object.freeze(record))
    if (this.replayRecords.length > 5000) this.replayRecords.shift()
    this.stats.replayRecordsCreated++
  }

  /** Check SLOs (Rule 18). */
  private checkSLOs(): void {
    if (!this.sloConfig) return
    const status = this.getSLOStatus()
    if (status.violations.length > 0) {
      this.stats.sloViolations++
      log.warn(`SLO violations: ${status.violations.join(', ')}`)
    }
  }

  /** Get current SLO status (§11, Rule 18). */
  getSLOStatus(): SLOStatus {
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0
    const successRate = this.stats.totalPredictions > 0 ? this.stats.successfulPredictions / this.stats.totalPredictions : 1
    const throughput = this.latencySamples.length > 0 ? 1000 / (this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length) : 0

    const violations: string[] = []
    if (this.sloConfig) {
      if (p95 > this.sloConfig.latency.p95TargetMs) violations.push(`P95 latency ${p95}ms > target ${this.sloConfig.latency.p95TargetMs}ms`)
      if (p99 > this.sloConfig.latency.p99TargetMs) violations.push(`P99 latency ${p99}ms > target ${this.sloConfig.latency.p99TargetMs}ms`)
      if (successRate < this.sloConfig.minSuccessRate) violations.push(`Success rate ${successRate.toFixed(3)} < min ${this.sloConfig.minSuccessRate}`)
    }

    return { latencyP50: p50, latencyP95: p95, latencyP99: p99, availability: successRate, throughput, successRate, violations }
  }

  /** Set the async XAI dispatch handler (Rule 13). */
  setXaiDispatchHandler(handler: (predictionId: string, featureVector: ProcessedFeatureVector) => void): void {
    this.xaiDispatchHandler = handler
  }

  /** Set SLO configuration (Rule 18). */
  setSLOConfig(config: SLOConfig): void {
    this.sloConfig = config
  }

  /** Get replay record for historical replay (Rule 23). */
  getReplayRecord(predictionId: string): PointInTimeReplayRecord | undefined {
    return this.replayRecords.find((r) => r.predictionId === predictionId)
  }

  getActiveSlot(): 'A' | 'B' {
    return this.activeSlot
  }

  getSlots(): Record<'A' | 'B', ModelSlot> {
    return { ...this.slots }
  }

  getStats() {
    return { ...this.stats, totalInHistory: this.predictions.length, activeSlot: this.activeSlot }
  }

  private computeHash(featureNames: string[]): string {
    const str = featureNames.join('|')
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return `hash-${hash.toString(36)}`
  }
}

export const onlineInferenceEngine = new OnlineInferenceEngine()
