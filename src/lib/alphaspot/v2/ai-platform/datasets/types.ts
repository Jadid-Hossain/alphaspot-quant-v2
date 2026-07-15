// CHAPTER 4.3 — Dataset Construction & Label Engineering Types
//
// Transforms processed features into ML-ready datasets (§1).
// Labels reference ONLY future outcomes (Rule 4). No look-ahead (Rule 5).
// Deterministic (Rule 2, Rule 3). Immutable datasets (Rule 8).
// Complete lineage (Rule 9, §13). Independent of ML (Rule 10, Rule 15).

import type { ProcessedFeatureVector } from '../../feature-processing/types'
import type { PredictionTargetDefinition, TargetHorizon } from '../targets/registry'

// ─────────────────────────────────────────────────────────────────────────────
// Label Families  (Chapter 4.3 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type LabelFamily =
  | 'FUTURE_RETURN'
  | 'DIRECTION_CLASSIFICATION'
  | 'RELATIVE_RANKING'
  | 'VOLATILITY_PREDICTION'
  | 'REGIME_CLASSIFICATION'
  | 'OPPORTUNITY_SCORE'
  | 'RISK_SCORE'

// ─────────────────────────────────────────────────────────────────────────────
// Label Construction Methods  (Chapter 4.3 §6, Rule 11)
// ─────────────────────────────────────────────────────────────────────────────

export type LabelMethod =
  | 'FIXED_HORIZON_RETURN'
  | 'THRESHOLD_CLASSIFICATION'
  | 'TRIPLE_BARRIER'
  | 'VOLATILITY_ADJUSTED_RETURN'
  | 'QUANTILE_CLASSIFICATION'
  | 'RELATIVE_CROSS_ASSET_RANKING'
  | 'PROBABILITY_TARGET'

export interface LabelConfig {
  method: LabelMethod
  // For THRESHOLD_CLASSIFICATION
  upThreshold?: number // e.g. 0.01 = 1% return → class 1
  downThreshold?: number // e.g. -0.01 = -1% return → class -1
  // For TRIPLE_BARRIER
  takeProfitPct?: number
  stopLossPct?: number
  maxHoldingPeriod?: number
  // For QUANTILE_CLASSIFICATION
  quantiles?: number // e.g. 5 = quintiles
  // For VOLATILITY_ADJUSTED_RETURN
  volLookback?: number
  // Version (Rule 11)
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Result  (Chapter 4.3 §5 — a generated label)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelResult {
  value: number // the label value (regression: return, classification: class, ranking: rank)
  method: LabelMethod
  family: LabelFamily
  horizon: TargetHorizon
  // The future data used to compute this label (for audit §13)
  realizedAt: number // when the horizon elapsed
  futureClosePrice: number | null
  observationPrice: number
  // Metadata
  rawReturn: number | null
  isMature: boolean // §8 — temporal realization
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample Weighting  (Chapter 4.3 §9.1)
// ─────────────────────────────────────────────────────────────────────────────

export type WeightingMethod =
  | 'UNIFORM'
  | 'ABSOLUTE_RETURN'
  | 'VOLATILITY_ADJUSTED'
  | 'CLASS_BALANCING'
  | 'SAMPLE_UNIQUENESS'
  | 'TIME_DECAY'
  | 'REGIME_AWARE'

export interface WeightingConfig {
  method: WeightingMethod
  // For TIME_DECAY
  halfLifeDays?: number
  // For CLASS_BALANCING
  classCounts?: Record<number, number>
  // Version (§9.1 — changing creates new dataset version)
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Split  (Chapter 4.3 §10, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export type DatasetSplit = 'TRAIN' | 'VALIDATION' | 'TEST' | 'RESEARCH' | 'BENCHMARK'

export interface SplitConfig {
  // Temporal boundaries (UTC epoch ms) — chronological order preserved (Rule 12)
  trainEnd: number
  validationEnd: number
  testEnd: number
  // Embargo window after validation/test boundaries (§14)
  embargoMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Training Sample  (Chapter 4.3 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingSample {
  datasetId: string
  datasetVersion: number
  featureVersion: string
  labelVersion: string
  predictionTargetVersion: string
  symbol: string
  timestamp: number // observation timestamp T
  predictionHorizon: TargetHorizon
  featureVector: ProcessedFeatureVector
  label: number
  labelMethod: LabelMethod
  sampleWeight: number
  datasetSplit: DatasetSplit
  qualityScore: number
  metadata: TrainingSampleMetadata
}

export interface TrainingSampleMetadata {
  // §13 — Lineage
  sourceFeatures: string // feature vector hash
  sourceLabel: LabelResult
  predictionTarget: string // target ID
  labelMethod: LabelMethod
  constructionTimestamp: number
  dependencyVersions: Record<string, string>
  processingConfig: string
  // Filtering info (§9)
  filterStatus: 'ACCEPTED' | 'REJECTED'
  filterReasons: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset  (a collection of training samples)
// ─────────────────────────────────────────────────────────────────────────────

export interface MLDataset {
  datasetId: string
  datasetVersion: number
  featureVersion: string
  labelVersion: string
  predictionTargetVersion: string
  schemaVersion: string
  configurationVersion: string
  symbol: string
  target: PredictionTargetDefinition
  labelConfig: LabelConfig
  weightingConfig: WeightingConfig
  splitConfig: SplitConfig
  samples: ReadonlyArray<TrainingSample>
  labelDistribution: Record<string, number>
  classBalance: number // 0..1 (1 = perfectly balanced)
  qualityScore: number
  createdAt: number
  // §16 — storage location for columnar payload
  storageLocation: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Validation  (Chapter 4.3 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  horizonVerified: boolean
  futureWindowVerified: boolean
  duplicatesDetected: number
  missingLabels: number
  distributionAnalysis: Record<string, number> | null
  classBalance: number | null
  statisticalIntegrity: boolean
  versionCompatible: boolean
  quarantined: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Version  (Chapter 4.3 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetVersion {
  datasetVersion: number
  labelVersion: string
  featureVersion: string
  predictionTargetVersion: string
  schemaVersion: string
  configurationVersion: string
}

export const DATASET_SCHEMA_VERSION = '1.0.0'
export const DATASET_CONFIGURATION_VERSION = '1.0.0'
export const LABEL_VERSION = '1.0.0'
