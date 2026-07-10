// CHAPTER 3.10 §5, §6, §7, §8, §11 — Feature Processor
//
// Validation (§5): missing/invalid/NaN/infinite/duplicate/schema/version.
// Missing Value Handling (§6): forward fill, rolling median/mean, constant, statistical.
// Online Normalization (§7): rolling Z-score, rolling min-max, robust, EWMA, MAD.
//   ALL use rolling historical windows ONLY (Rule 5). Future data PROHIBITED (Rule 4).
//   Constant-memory incremental (Rule 11) — updates without rescanning history.
// Feature Scaling (§8): standard, robust, min-max, quantile, log. Parameters versioned (Rule 6).

import { createLogger } from '../domains/01-core-infrastructure'
import { EMA, EWMA, CircularBuffer, emaForPeriod, ewmaForHalfLife } from '../microstructure/rolling-metrics'
import type { FeatureVector } from '../feature-extraction/types'
import type {
  ImputationRecord,
  ImputationStrategy,
  MissingValueConfig,
  NormalizationConfig,
  NormalizationMethod,
  ProcessingConfig,
  ScalingConfig,
  ScalingMethod,
  ValidationResult,
} from './types'
import { DEFAULT_PROCESSING_CONFIG, PROCESSING_VERSION, SCALING_VERSION, MISSING_DATA_VERSION } from './types'

const log = createLogger('feature-processing:processor')

// ─────────────────────────────────────────────────────────────────────────────
// Rolling Normalizer  (Chapter 3.10 §7, Rule 5, Rule 11)
// Constant-memory incremental statistics. No future data (Rule 4).
// ─────────────────────────────────────────────────────────────────────────────

export class RollingNormalizer {
  private meanEma: EMA
  private varianceEwma: EWMA
  private valueBuffer: CircularBuffer<number>
  private medianBuffer: CircularBuffer<number>
  private method: NormalizationMethod
  private windowSize: number

  constructor(config: NormalizationConfig) {
    this.method = config.method
    this.windowSize = config.windowSize
    this.meanEma = emaForPeriod(config.windowSize)
    this.varianceEwma = ewmaForHalfLife(config.windowSize)
    this.valueBuffer = new CircularBuffer<number>(config.windowSize)
    this.medianBuffer = new CircularBuffer<number>(config.windowSize)
  }

  /** Normalize a value using rolling historical stats only (Rule 5 — no future data). */
  normalize(value: number): number {
    this.valueBuffer.push(value)
    this.medianBuffer.push(value)
    this.meanEma.update(value)
    this.varianceEwma.update(value)

    switch (this.method) {
      case 'ROLLING_Z_SCORE': {
        const mean = this.meanEma.value ?? value
        const std = this.varianceEwma.stdDev ?? 1
        return std > 1e-10 ? (value - mean) / std : 0
      }
      case 'ROLLING_MIN_MAX': {
        const min = this.valueBuffer.min() ?? value
        const max = this.valueBuffer.max() ?? value
        const range = max - min
        return range > 1e-10 ? (value - min) / range : 0.5
      }
      case 'ROBUST_SCALING': {
        const median = this.medianBuffer.median() ?? value
        const mad = this.computeMAD(value, median)
        return mad > 1e-10 ? (value - median) / mad : 0
      }
      case 'EWMA_STANDARDIZATION': {
        const mean = this.meanEma.value ?? value
        const std = this.varianceEwma.stdDev ?? 1
        return std > 1e-10 ? (value - mean) / std : 0
      }
      case 'MEDIAN_ABSOLUTE_DEVIATION': {
        const median = this.medianBuffer.median() ?? value
        const mad = this.computeMAD(value, median)
        return mad > 1e-10 ? (value - median) / (1.4826 * mad) : 0
      }
      default:
        return value
    }
  }

  private computeMAD(value: number, median: number): number {
    const deviations = this.medianBuffer.values().map((v) => Math.abs(v - median))
    if (deviations.length === 0) return 1
    deviations.sort((a, b) => a - b)
    const mid = Math.floor(deviations.length / 2)
    return deviations.length % 2 === 0 ? (deviations[mid - 1] + deviations[mid]) / 2 : deviations[mid]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Scaler  (Chapter 3.10 §8, Rule 6 — parameters versioned)
// ─────────────────────────────────────────────────────────────────────────────

export class FeatureScaler {
  private method: ScalingMethod
  private minRange: [number, number]
  private logBase: number

  constructor(config: ScalingConfig) {
    this.method = config.method
    this.minRange = config.minRange ?? [0, 1]
    this.logBase = config.logBase ?? Math.E
  }

  scale(value: number): number {
    switch (this.method) {
      case 'STANDARD':
        return value // Z-score already done by normalizer
      case 'ROBUST':
        return value // robust scaling already done by normalizer
      case 'MIN_MAX': {
        const [min, max] = this.minRange
        return min + value * (max - min) // value is already 0..1 from rolling min-max normalizer
      }
      case 'QUANTILE':
        // Simplified: use sigmoid as a smooth quantile-like transform
        return 1 / (1 + Math.exp(-value))
      case 'LOG':
        return value > 0 ? Math.log(value) / Math.log(this.logBase) : 0
      default:
        return value
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Validator  (Chapter 3.10 §5)
// ─────────────────────────────────────────────────────────────────────────────

export function validateFeatureVector(vector: FeatureVector): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const missingFeatures: string[] = []
  const invalidFeatures: string[] = []

  for (const [name, value] of Object.entries(vector.features)) {
    if (value === null || value === undefined) {
      missingFeatures.push(name)
    } else if (typeof value === 'number') {
      if (Number.isNaN(value)) {
        invalidFeatures.push(`${name}: NaN`)
      } else if (!Number.isFinite(value)) {
        invalidFeatures.push(`${name}: ${value === Infinity ? 'Infinity' : '-Infinity'}`)
      }
    }
  }

  // §5 — schema validation
  if (!vector.featureVersion) errors.push('missing featureVersion')
  if (!vector.featureSetVersion) errors.push('missing featureSetVersion')
  if (vector.featureCount === 0) errors.push('empty feature vector')

  // §5 — version compatibility
  if (vector.featureVersion !== '2.0.0') {
    warnings.push(`feature version ${vector.featureVersion} may not be compatible`)
  }

  const valid = errors.length === 0
  const quarantined = !valid || invalidFeatures.length > 10

  return { valid, errors, warnings, missingFeatures, invalidFeatures, quarantined }
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing Value Handler  (Chapter 3.10 §6, Rule 7 — every imputation recorded)
// ─────────────────────────────────────────────────────────────────────────────

export class MissingValueHandler {
  private config: MissingValueConfig
  private forwardFillCache = new Map<string, number>() // feature → last known value
  private rollingBuffers = new Map<string, CircularBuffer<number>>() // feature → rolling buffer

  constructor(config: MissingValueConfig) {
    this.config = config
  }

  /** Handle a missing value (§6). Returns the imputed value + record. */
  handle(featureName: string, value: number | null | undefined, timestamp: number): { value: number; record: ImputationRecord | null } {
    // If value is present, update caches and return
    if (value !== null && value !== undefined && typeof value === 'number' && Number.isFinite(value)) {
      this.forwardFillCache.set(featureName, value)
      this.getBuffer(featureName).push(value)
      return { value, record: null }
    }

    // Value is missing — impute (§6)
    const imputed = this.impute(featureName)
    const record: ImputationRecord = {
      featureName,
      strategy: this.config.strategy,
      originalValue: value as null | undefined,
      imputedValue: imputed,
      imputedAt: timestamp,
    }
    return { value: imputed, record }
  }

  private impute(featureName: string): number {
    switch (this.config.strategy) {
      case 'FORWARD_FILL': {
        return this.forwardFillCache.get(featureName) ?? 0
      }
      case 'ROLLING_MEDIAN': {
        return this.getBuffer(featureName).median() ?? this.forwardFillCache.get(featureName) ?? 0
      }
      case 'ROLLING_MEAN': {
        const vals = this.getBuffer(featureName).values()
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : (this.forwardFillCache.get(featureName) ?? 0)
      }
      case 'CONSTANT': {
        return this.config.constantValue ?? 0
      }
      case 'STATISTICAL': {
        // Use median as statistical imputation
        return this.getBuffer(featureName).median() ?? 0
      }
      default:
        return 0
    }
  }

  private getBuffer(featureName: string): CircularBuffer<number> {
    let buf = this.rollingBuffers.get(featureName)
    if (!buf) {
      buf = new CircularBuffer<number>(this.config.rollingWindowSize ?? 20)
      this.rollingBuffers.set(featureName, buf)
    }
    return buf
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Processor  (Chapter 3.10 §1 — full preprocessing pipeline)
// ─────────────────────────────────────────────────────────────────────────────

export class FeatureProcessor {
  private config: ProcessingConfig
  private normalizers = new Map<string, RollingNormalizer>() // per-feature normalizer
  private scaler: FeatureScaler
  private missingHandler: MissingValueHandler
  private stats = {
    totalProcessed: 0,
    validationErrors: 0,
    imputations: 0,
    quarantined: 0,
    avgLatencyMs: 0,
  }
  private latencySamples: number[] = []

  constructor(config: ProcessingConfig = DEFAULT_PROCESSING_CONFIG) {
    this.config = config
    this.scaler = new FeatureScaler(config.scaling)
    this.missingHandler = new MissingValueHandler(config.missingValues)
  }

  /**
   * Process a Feature Vector into an ML-ready ProcessedFeatureVector (§4).
   * Deterministic (Rule 2, Rule 3). No future data (Rule 4).
   * Immutable output (Rule 8). Full lineage (Rule 10).
   */
  process(vector: FeatureVector): ProcessedFeatureVector | null {
    const startTime = Date.now()
    this.stats.totalProcessed++

    // §5 — Validation
    const validation = validateFeatureVector(vector)
    if (validation.quarantined) {
      this.stats.quarantined++
      this.stats.validationErrors += validation.errors.length + validation.invalidFeatures.length
      log.warn(`feature vector quarantined for ${vector.symbol}: ${validation.errors.join('; ')} | invalid: ${validation.invalidFeatures.length}`)
      return null
    }

    const imputations: ImputationRecord[] = []
    const processedFeatures: Record<string, number> = {}
    const featureMask: Record<string, boolean> = {}

    // Process each feature
    for (const [name, rawValue] of Object.entries(vector.features)) {
      // §6 — Missing value handling
      const { value: imputedValue, record } = this.missingHandler.handle(name, rawValue as number | null | undefined, vector.timestamp)
      if (record) {
        imputations.push(record)
        featureMask[name] = true // imputed
      } else {
        featureMask[name] = false // original
      }

      // Only normalize/scale numerical features
      if (typeof imputedValue === 'number' && Number.isFinite(imputedValue)) {
        // §7 — Online normalization (rolling, constant-memory, no future data)
        let normalizer = this.normalizers.get(name)
        if (!normalizer) {
          normalizer = new RollingNormalizer(this.config.normalization)
          this.normalizers.set(name, normalizer)
        }
        const normalized = normalizer.normalize(imputedValue)

        // §8 — Feature scaling
        const scaled = this.scaler.scale(normalized)

        processedFeatures[name] = scaled
      } else {
        // Categorical/string features — pass through as-is (encoded externally)
        processedFeatures[name] = typeof imputedValue === 'number' ? imputedValue : 0
      }
    }

    this.stats.imputations += imputations.length

    const latencyMs = Date.now() - startTime
    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > 500) this.latencySamples.shift()
    this.stats.avgLatencyMs = this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length

    // §4 — Build the immutable ProcessedFeatureVector (Rule 8)
    const processed: ProcessedFeatureVector = {
      symbol: vector.symbol,
      timestamp: vector.timestamp,
      featureVersion: vector.featureVersion,
      processingVersion: PROCESSING_VERSION,
      scalingVersion: SCALING_VERSION,
      missingDataVersion: MISSING_DATA_VERSION,
      processedFeatures: Object.freeze(processedFeatures),
      featureMask: Object.freeze(featureMask),
      processingMetadata: {
        validationResult: validation,
        imputations,
        normalizationMethod: this.config.normalization.method,
        scalingMethod: this.config.scaling.method,
        processingLatencyMs: latencyMs,
        dependencyVersions: {
          featureExtraction: vector.featureVersion,
          processing: PROCESSING_VERSION,
          scaling: SCALING_VERSION,
        },
      },
      datasetVersion: 1,
    }

    return Object.freeze(processed) // Rule 8 — immutable
  }

  getStats() {
    return { ...this.stats }
  }
}

// Re-export for the barrel
export type { ProcessedFeatureVector }
import type { ProcessedFeatureVector } from './types'
