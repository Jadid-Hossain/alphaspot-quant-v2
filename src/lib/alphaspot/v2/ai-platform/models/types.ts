// CHAPTER 4.4 — Machine Learning Model Architecture Types
//
// The MLMA defines the canonical organizational framework for models (§1).
// Models are interchangeable (§2, Rule 7). Every model implements the canonical
// interface (Rule 3). Historical models immutable (Rule 4). Versioning mandatory
// (Rule 5). Canonical Prediction Tuple for all algorithms (§8, Rule 17).
// Strict schema validation before inference (§12, Rule 18).

import type { ProcessedFeatureVector } from '../../feature-processing/types'
import type { PredictionTargetDefinition, TargetHorizon } from '../targets/registry'

// ─────────────────────────────────────────────────────────────────────────────
// Model Families  (Chapter 4.4 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type ModelFamily =
  | 'REGRESSION'
  | 'CLASSIFICATION'
  | 'RANKING'
  | 'MULTI_TASK'
  | 'ENSEMBLE'
  | 'CASCADING'

// ─────────────────────────────────────────────────────────────────────────────
// Model Lifecycle  (Chapter 4.4 §11, Rule 9, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export type ModelLifecycleState =
  | 'DEVELOPMENT'
  | 'TRAINING'
  | 'VALIDATION'
  | 'CANDIDATE'
  | 'PRODUCTION'
  | 'RETIRED'

/** Allowed forward transitions (§11 — no bypassing validation). */
const ALLOWED_LIFECYCLE_TRANSITIONS: Record<ModelLifecycleState, ModelLifecycleState[]> = {
  DEVELOPMENT: ['TRAINING', 'RETIRED'], // can retire early
  TRAINING: ['VALIDATION', 'DEVELOPMENT', 'RETIRED'],
  VALIDATION: ['CANDIDATE', 'DEVELOPMENT', 'RETIRED'],
  CANDIDATE: ['PRODUCTION', 'DEVELOPMENT', 'RETIRED'],
  PRODUCTION: ['RETIRED'],
  RETIRED: [], // terminal
}

export function canTransitionLifecycle(from: ModelLifecycleState, to: ModelLifecycleState): boolean {
  return ALLOWED_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Prediction Tuple  (Chapter 4.4 §8, Rule 17)
// Every prediction returns this — identical contract for ALL algorithms.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPredictionTuple {
  /** The primary prediction (expected value). */
  expectedValue: number
  /** Epistemic uncertainty — model uncertainty from limited knowledge/insufficient training data. */
  epistemicUncertainty: number // 0..1
  /** Statistical range within which the outcome is expected (configured confidence level). */
  predictionInterval: [number, number]
  /** Prediction metadata — version, model version, feature schema version, inference timestamp. */
  metadata: PredictionMetadata
}

export interface PredictionMetadata {
  predictionVersion: string
  modelVersion: string
  featureSchemaVersion: string
  inferenceTimestamp: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Version  (Chapter 4.4 §9, Rule 5 — 7 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelVersionInfo {
  architectureVersion: string
  trainingVersion: string
  datasetVersion: string
  featureVersion: string
  predictionTargetVersion: string
  hyperparameterVersion: string
  deploymentVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility Metadata  (Chapter 4.4 §12, Rule 8, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureSchema {
  schemaVersion: string
  schemaHash: string // hash of the feature names + order
  inputDimension: number
  featureNames: string[] // ordered list — Rule 18 enforces order
  featureOrderingSpec: string // specification of the expected order
}

export interface CompatibilityMetadata {
  supportedFeatureVersions: string[]
  supportedDatasetVersions: string[]
  supportedTargetVersions: string[]
  compatibleInferenceEngineVersion: string
  minimumSystemRequirements: string
  featureSchema: FeatureSchema
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Instance  (Chapter 4.4 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export type AssetCoverage = 'GLOBAL' | 'SECTOR' | 'ASSET_SPECIFIC' | 'HIERARCHICAL'
export type RegistryStatus = 'ACTIVE' | 'HISTORICAL' | 'EXPERIMENTAL' | 'CANDIDATE' | 'DEPRECATED' | 'ARCHIVED'

export interface ModelInstance {
  modelId: string
  modelVersion: ModelVersionInfo
  family: ModelFamily
  predictionTarget: string // target ID
  predictionHorizon: TargetHorizon
  supportedAssets: string[] // empty = all
  assetCoverage: AssetCoverage
  supportedFeatures: string[]
  trainingConfigRef: string
  performanceMetadata: ModelPerformanceMetadata
  deploymentStatus: RegistryStatus
  lifecycleState: ModelLifecycleState
  compatibility: CompatibilityMetadata
  // §13 — Governance
  governance: ModelGovernance
  // §5, Rule 16 — Cascading dependencies
  dependencies: string[] // upstream model IDs whose outputs are used as inputs
  // §4 — immutable
  createdAt: number
}

export interface ModelPerformanceMetadata {
  validationScore: number | null
  calibrationScore: number | null
  lastValidatedAt: number | null
  sampleCount: number | null
}

export interface ModelGovernance {
  creator: string
  creationTimestamp: number
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  changeHistory: Array<{ field: string; oldValue: string; newValue: string; at: number }>
  retirementReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Model Interface  (Chapter 4.4 §8, Rule 3, Rule 12, Rule 17)
// Every model implements this — algorithm-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalModelInterface {
  readonly modelId: string
  readonly family: ModelFamily

  /** §8 — Train the model on a dataset. */
  train(dataset: unknown): Promise<void>

  /** §8 — Validate the model. Returns validation score. */
  validate(dataset: unknown): Promise<number>

  /** §8, Rule 17 — Predict. Returns Canonical Prediction Tuple. */
  predict(features: ProcessedFeatureVector): Promise<CanonicalPredictionTuple>

  /** §8 — Export model for deployment. */
  export(): Promise<unknown>

  /** §8 — Export metadata. */
  exportMetadata(): ModelInstance

  /** §8 — Version reporting. */
  getVersion(): ModelVersionInfo

  /** §8 — Capability discovery. */
  getCapabilities(): ModelCapabilities
}

export interface ModelCapabilities {
  supportedTargets: string[]
  supportedHorizons: TargetHorizon[]
  supportedAssetCoverage: AssetCoverage[]
  supportsMultiOutput: boolean
  supportsCascading: boolean
  supportsEnsemble: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Validation Result  (Chapter 4.4 §12, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  versionMatch: boolean
  countMatch: boolean
  orderMatch: boolean
  nameMatch: boolean
  hashMatch: boolean
  quarantined: boolean
}

export const MODEL_ARCHITECTURE_VERSION = '1.0.0'
