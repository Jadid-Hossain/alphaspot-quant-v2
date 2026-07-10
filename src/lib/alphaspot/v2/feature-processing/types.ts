// CHAPTER 3.10 §4, §5, §6, §7, §8, §9, §13 — Feature Processing Types
//
// The FPFS transforms Feature Vectors (Ch 3.9) into ML-ready datasets.
// All preprocessing is deterministic (Rule 2, Rule 3). Future information
// prohibited (Rule 4). Rolling-only normalization (Rule 5). Scaling versioned
// (Rule 6). Every imputation recorded (Rule 7). Processed datasets immutable
// (Rule 8). Full lineage (Rule 10). ML-independent (Rule 15).

import type { FeatureVector } from '../feature-extraction/types'

// ─────────────────────────────────────────────────────────────────────────────
// Processed Feature Vector  (Chapter 3.10 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessedFeatureVector {
  symbol: string
  timestamp: number
  featureVersion: string // from the input FeatureVector
  processingVersion: string // preprocessing pipeline version
  scalingVersion: string // scaling parameters version
  missingDataVersion: string // imputation strategy version
  processedFeatures: Readonly<Record<string, number>> // ML-ready numerical values
  featureMask: Readonly<Record<string, boolean>> // true = imputed, false = original
  processingMetadata: ProcessingMetadata
  datasetVersion: number
}

export interface ProcessingMetadata {
  validationResult: ValidationResult
  imputations: ImputationRecord[]
  normalizationMethod: string
  scalingMethod: string
  processingLatencyMs: number
  dependencyVersions: Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation  (Chapter 3.10 §5)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  missingFeatures: string[]
  invalidFeatures: string[]
  quarantined: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing Value Handling  (Chapter 3.10 §6)
// ─────────────────────────────────────────────────────────────────────────────

export type ImputationStrategy = 'FORWARD_FILL' | 'ROLLING_MEDIAN' | 'ROLLING_MEAN' | 'CONSTANT' | 'STATISTICAL'

export interface ImputationRecord {
  featureName: string
  strategy: ImputationStrategy
  originalValue: null | undefined
  imputedValue: number
  imputedAt: number
}

export interface MissingValueConfig {
  strategy: ImputationStrategy
  constantValue?: number
  rollingWindowSize?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Online Normalization  (Chapter 3.10 §7 — rolling only, no future data)
// ─────────────────────────────────────────────────────────────────────────────

export type NormalizationMethod = 'ROLLING_Z_SCORE' | 'ROLLING_MIN_MAX' | 'ROBUST_SCALING' | 'EWMA_STANDARDIZATION' | 'MEDIAN_ABSOLUTE_DEVIATION'

export interface NormalizationConfig {
  method: NormalizationMethod
  windowSize: number // rolling window (Rule 5 — historical only)
  ewmaLambda?: number // for EWMA
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Scaling  (Chapter 3.10 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type ScalingMethod = 'STANDARD' | 'ROBUST' | 'MIN_MAX' | 'QUANTILE' | 'LOG'

export interface ScalingConfig {
  method: ScalingMethod
  // Parameters are versioned (Rule 6)
  minRange?: [number, number] // for MIN_MAX
  logBase?: number // for LOG
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Lineage  (Chapter 3.10 §13, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureLineage {
  originalFeatureVector: FeatureVector
  transformationChain: TransformationStep[]
  normalizationMethod: NormalizationMethod
  scalingMethod: ScalingMethod
  imputationMethod: ImputationStrategy
  processingTimestamp: number
  dependencyVersions: Record<string, string>
}

export interface TransformationStep {
  step: string
  input: unknown
  output: unknown
  at: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing config  (combines all preprocessing stages)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessingConfig {
  validation: { enabled: boolean }
  missingValues: MissingValueConfig
  normalization: NormalizationConfig
  scaling: ScalingConfig
}

export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  validation: { enabled: true },
  missingValues: { strategy: 'FORWARD_FILL', rollingWindowSize: 20 },
  normalization: { method: 'ROLLING_Z_SCORE', windowSize: 50 },
  scaling: { method: 'STANDARD' },
}

export const PROCESSING_VERSION = '1.0.0'
export const SCALING_VERSION = '1.0.0'
export const MISSING_DATA_VERSION = '1.0.0'
