// CHAPTER 4.11 — Online Inference Engine Types
//
// The OIE transforms validated feature vectors into production predictions (§1).
// Correctness > speed (§2). Unique Prediction ID (Rule 3). Canonical Prediction Tuple (Rule 4).
// Schema validation before execution (Rule 5). Mismatches → quarantine (Rule 6).
// Crypto verification before loading (Rule 8). Dual-Slot A/B (Rule 22).
// Point-in-Time replay (Rule 23). Async XAI (Rule 13). SLOs (Rule 18).

import type { CanonicalPredictionTuple } from '../models/types'
import type { ProcessedFeatureVector } from '../../feature-processing/types'

// ─────────────────────────────────────────────────────────────────────────────
// Inference Request  (Chapter 4.11 §3, §5)
// ─────────────────────────────────────────────────────────────────────────────

export interface InferenceRequest {
  requestId: string
  symbol: string
  target: string // prediction target ID
  horizon: string
  featureVector: ProcessedFeatureVector
  featureSchemaHash: string
  ensembleId: string | null
  requestOrigin: string
  timestamp: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference Result  (Chapter 4.11 §4 — Output Contract, Rule 4, Rule 10)
// Immutable. Conforms to Canonical Prediction Tuple.
// ─────────────────────────────────────────────────────────────────────────────

export interface InferenceResult extends CanonicalPredictionTuple {
  predictionId: string
  predictionTimestamp: number
  predictionTarget: string
  predictionHorizon: string
  ensembleVersion: string | null
  modelVersion: string
  featureVersion: string
  featureSchemaVersion: string
  confidenceMetadata: ConfidenceMetadata
  uncertaintyMetadata: UncertaintyMetadata
  runtimeMetadata: RuntimeMetadata
  governanceMetadata: InferenceGovernance
  // Rule 10 — immutable
  createdAt: number
}

export interface ConfidenceMetadata {
  predictionConfidence: number // 0..1
  method: string
  factors: Record<string, number>
}

export interface UncertaintyMetadata {
  epistemicUncertainty: number // 0..1
  aleatoricUncertainty: number // 0..1
  crossModelVariance: number | null
  method: string
}

export interface RuntimeMetadata {
  processingDurationMs: number
  workerId: string
  slotId: 'A' | 'B' // Rule 22 — Dual-Slot
  modelArtifactHash: string
  runtimeVersion: string
  // Rule 14 — graceful degradation info
  degraded: boolean
  unavailableModels: string[]
  quorumSatisfied: boolean
}

export interface InferenceGovernance {
  predictionId: string
  requestOrigin: string
  modelVersion: string
  ensembleVersion: string | null
  featureVersion: string
  schemaVersion: string
  runtimeEnvironment: string
  predictionTimestamp: number
  processingDurationMs: number
  auditMetadata: Record<string, string>
  // Rule 23 — Point-in-Time replay
  pointInTimeFeatureVectorRef: string
  featureVectorHash: string
  serializedFeatureSnapshotRef: string
  // Rule 9 — complete lineage
  lineage: InferenceLineage
}

export interface InferenceLineage {
  predictionId: string
  featureVersion: string
  modelVersion: string
  ensembleVersion: string | null
  schemaVersion: string
  configurationVersion: string
  runtimeVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Dual-Slot Model Management  (Chapter 4.11 §6, Rule 21, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export type SlotId = 'A' | 'B'

export type ModelSlotState = 'EMPTY' | 'LOADING' | 'VERIFYING' | 'WARMING_UP' | 'READY' | 'ACTIVE' | 'UNLOADING'

export interface ModelSlot {
  slotId: SlotId
  modelId: string | null
  state: ModelSlotState
  cryptoVerified: boolean
  compatibilityVerified: boolean
  warmUpComplete: boolean
  healthVerified: boolean
  loadedAt: number | null
  activatedAt: number | null
  inFlightRequests: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Point-in-Time Replay Record  (Chapter 4.11 §14, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export interface PointInTimeReplayRecord {
  predictionId: string
  serializedFeatureVector: string // or immutable reference
  featureSchemaHash: string
  predictionMetadata: Record<string, unknown>
  runtimeMetadata: Record<string, unknown>
  canonicalPredictionTuple: CanonicalPredictionTuple
  createdAt: number
  // Rule 23 — async, never increases latency
  asyncGenerated: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Latency & SLO Management  (Chapter 4.11 §11, Rule 12, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface LatencyBudget {
  maxLatencyMs: number
  p50TargetMs: number
  p95TargetMs: number
  p99TargetMs: number
  timeoutMs: number
}

export interface SLOConfig {
  latency: LatencyBudget
  minAvailability: number // 0..1
  minThroughput: number // predictions/sec
  minSuccessRate: number // 0..1
}

export interface SLOStatus {
  latencyP50: number
  latencyP95: number
  latencyP99: number
  availability: number
  throughput: number
  successRate: number
  violations: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Validation Result  (Chapter 4.11 §8, Rule 5, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  countMatch: boolean
  orderMatch: boolean
  nameMatch: boolean
  hashMatch: boolean
  versionMatch: boolean
  quarantined: boolean // Rule 6 — quarantine on mismatch, no auto-adaptation
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference Pipeline Stages  (Chapter 4.11 §5 — 15 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const INFERENCE_STAGES = [
  'FEATURE_RECEPTION',
  'FEATURE_VALIDATION',
  'SCHEMA_VERIFICATION',
  'FEATURE_COMPATIBILITY_VERIFICATION',
  'PRODUCTION_MODEL_RESOLUTION',
  'LOADED_MODEL_VERIFICATION',
  'ENSEMBLE_RESOLUTION',
  'PREDICTION_EXECUTION',
  'CONFIDENCE_ESTIMATION',
  'UNCERTAINTY_ESTIMATION',
  'CANONICAL_PREDICTION_TUPLE_CONSTRUCTION',
  'PREDICTION_VALIDATION',
  'PREDICTION_PUBLICATION',
  'ASYNC_POINT_IN_TIME_LOGGING',
  'ASYNC_EXPLAINABILITY_DISPATCH',
  'INFERENCE_COMPLETION',
] as const

export type InferenceStage = (typeof INFERENCE_STAGES)[number]

export const OIE_VERSION = '1.0.0'
export const RUNTIME_VERSION = '1.0.0'
