// CHAPTER 4.6 — Model Training Pipeline Types
//
// The MTP transforms ML datasets into validated model artifacts (§1).
// Deterministic (Rule 2). Datasets immutable (Rule 3). Unique Experiment ID (Rule 4).
// Temporal ordering in CV (Rule 5). Full traceability (Rule 6). Configs versioned (Rule 7).
// Experiments immutable (Rule 8). Only validated artifacts enter registry (Rule 10).
// Crypto signing mandatory (Rule 17). Deterministic execution (Rule 18).

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Validation  (Chapter 4.6 §7, Rule 5, Rule 11, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export type CrossValidationMethod =
  | 'WALK_FORWARD'
  | 'EXPANDING_WINDOW'
  | 'ROLLING_WINDOW'
  | 'BLOCKED_TIME_SERIES'
  | 'NESTED'
  | 'CPCV' // Combinatorial Purged Cross-Validation

export interface CrossValidationConfig {
  method: CrossValidationMethod
  numFolds: number
  // For ROLLING_WINDOW: window size
  rollingWindowSize: number | null
  // For CPCV: number of groups
  cpcvGroups: number | null
  // Purge + embargo from Ch 4.3 (Rule 16 — consume + enforce)
  purgeEnabled: boolean
  embargoMs: number
  // Temporal ordering always preserved (Rule 5)
  preserveTemporalOrder: true
}

export interface ValidationFold {
  foldId: number
  trainIndices: number[]
  validationIndices: number[]
  trainStartTime: number
  trainEndTime: number
  validationStartTime: number
  validationEndTime: number
  // Samples purged due to horizon overlap (Rule 16)
  purgedIndices: number[]
  // Embargo window applied
  embargoApplied: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint  (Chapter 4.6 §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingCheckpoint {
  checkpointId: string
  epoch: number
  modelParameters: unknown
  optimizerState: unknown
  trainingMetrics: Record<string, number>
  validationMetrics: Record<string, number>
  randomGeneratorState: number // RNG state seed
  checkpointVersion: string
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Early Stopping  (Chapter 4.6 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface EarlyStoppingConfig {
  enabled: boolean
  monitorMetric: string // e.g. 'val_loss'
  patience: number // epochs to wait before stopping
  minImprovement: number // minimum improvement threshold
  restoreBestCheckpoint: boolean
  version: string
}

export interface EarlyStoppingResult {
  stopped: boolean
  reason: string | null
  bestEpoch: number | null
  bestMetricValue: number | null
  epochsWaited: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Artifact  (Chapter 4.6 §11, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export type ReproducibilityClass = 'DETERMINISTICALLY_REPRODUCED' | 'STOCHASTICALLY_VALIDATED'

export interface ModelArtifact {
  artifactId: string
  modelParameters: unknown
  featureSchemaHash: string
  trainingConfiguration: string // serialized config
  datasetVersion: string
  featureVersion: string
  targetVersion: string
  softwareEnvironment: SoftwareEnvironment
  serializationFormat: string
  integrityHash: string
  // §11, Rule 17 — cryptographic signature (mandatory for production)
  cryptographicSignature: CryptographicSignature | null
  // §12, Rule 18 — reproducibility classification
  reproducibilityClass: ReproducibilityClass
  stochasticVariance: number | null // quantified variance if Stochastically Validated
  // Lineage
  experimentId: string
  trainingLineage: TrainingLineage
  // Validation
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  validationScore: number | null
  // Metadata
  artifactVersion: string
  createdAt: number
}

export interface CryptographicSignature {
  signature: string // the cryptographic signature
  signedFields: string[] // what was signed: parameters, schema hash, lineage, config, version
  signingMethod: string // e.g. 'HSM-RSA', 'KeyVault-ECDSA'
  signedAt: number
  signedBy: string // the signing identity
}

export interface SoftwareEnvironment {
  libraryVersions: Record<string, string>
  compilerVersions: Record<string, string>
  os: string
  containerVersion: string
  hardwareConfig: string
  // §12, Rule 18 — deterministic execution settings
  deterministicCuda: boolean
  deterministicBlas: boolean
  fixedThreadScheduling: boolean
  deterministicRng: boolean
}

export interface TrainingLineage {
  datasetVersion: string
  featureVersion: string
  targetVersion: string
  modelVersion: string
  configVersion: string
  randomSeed: number
  trainingDurationMs: number
  crossValidationMethod: CrossValidationMethod
}

// ─────────────────────────────────────────────────────────────────────────────
// Training Experiment  (Chapter 4.6 §6, Rule 4, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export type ExperimentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface TrainingExperiment {
  experimentId: string
  timestamp: number
  datasetVersion: string
  featureVersion: string
  targetVersion: string
  modelVersion: string
  configVersion: string
  randomSeed: number
  trainingDurationMs: number | null
  hardwareMetadata: string
  softwareEnvironment: SoftwareEnvironment | null
  status: ExperimentStatus
  // Result
  artifact: ModelArtifact | null
  evaluationSummary: TrainingEvaluation | null
  // Immutable (Rule 8)
  failureReason: string | null
}

export interface TrainingEvaluation {
  crossValidationScores: number[]
  meanScore: number
  stdScore: number
  calibrationScore: number | null
  metricName: string
  earlyStoppingResult: EarlyStoppingResult | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Training Report  (Chapter 4.6 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingReport {
  experimentId: string
  pipelineStages: Array<{ stage: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'; durationMs: number; note: string }>
  crossValidationFolds: ValidationFold[]
  checkpoints: TrainingCheckpoint[]
  finalMetrics: Record<string, number>
  artifactId: string | null
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  reproducibilityClass: ReproducibilityClass
}

export const TRAINING_PIPELINE_VERSION = '1.0.0'
export const ARTIFACT_VERSION = '1.0.0'
export const CHECKPOINT_VERSION = '1.0.0'
export const EARLY_STOPPING_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Training Pipeline Stages  (Chapter 4.6 §5 — 11 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_STAGES = [
  'DATASET_VALIDATION',
  'FEATURE_COMPATIBILITY_VERIFICATION',
  'TRAINING_CONFIG_VALIDATION',
  'MODEL_INITIALIZATION',
  'CROSS_VALIDATION',
  'MODEL_TRAINING',
  'EARLY_STOPPING_EVALUATION',
  'PERFORMANCE_EVALUATION',
  'ARTIFACT_GENERATION',
  'MODEL_REGISTRATION',
  'TRAINING_COMPLETION',
] as const

export type TrainingStage = (typeof TRAINING_STAGES)[number]
