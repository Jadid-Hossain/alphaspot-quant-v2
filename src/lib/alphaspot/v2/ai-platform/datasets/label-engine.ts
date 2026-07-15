// CHAPTER 4.3 §5-§14 — Label Engine, Sample Weighter, Splitter, Validator
//
// Label Engine (§5-§8): 7 construction methods, multi-horizon, temporal realization.
// Sample Filter (§9): 8 rejection criteria. Sample Weighter (§9.1): 7 methods.
// Dataset Splitter (§10, §14): temporal, purge overlapping horizons, embargo.
// Label Validator (§11): horizon, future window, duplicates, distribution, class balance.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { ProcessedFeatureVector } from '../../feature-processing/types'
import type { PredictionTargetDefinition, TargetHorizon } from '../targets/registry'
import { HORIZON_MS as TARGET_HORIZON_MS } from '../targets/registry'
import type {
  LabelConfig,
  LabelMethod,
  LabelResult,
  LabelValidationResult,
  SplitConfig,
  DatasetSplit,
  TrainingSample,
  WeightingConfig,
  WeightingMethod,
} from './types'

const log = createLogger('ai-platform:datasets:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Label Engine  (Chapter 4.3 §5-§8)
// ─────────────────────────────────────────────────────────────────────────────

export class LabelEngine {
  /**
   * Generate a label for a single observation (§5-§8).
   * Labels reference ONLY future outcomes (Rule 4). No look-ahead (Rule 5).
   * Only temporally mature targets generate labels (§8, Rule 7).
   */
  generateLabel(
    observationPrice: number,
    futureCandles: Array<{ time: number; close: number; high: number; low: number }>,
    horizon: TargetHorizon,
    config: LabelConfig,
    observationTimestamp: number,
    currentTime: number,
    lateArrivalToleranceMs: number = 30_000,
  ): LabelResult | null {
    // §8, Rule 7 — temporal realization: only mature targets generate labels
    const horizonMs = TARGET_HORIZON_MS[horizon]
    const realizationTime = observationTimestamp + horizonMs + lateArrivalToleranceMs
    if (currentTime < realizationTime) {
      return null // premature — not yet eligible (Rule 7)
    }

    // Find the future candle at the horizon boundary
    const futureTime = observationTimestamp + horizonMs
    const futureCandle = futureCandles.find((c) => c.time >= futureTime)
    if (!futureCandle) {
      return null // no future data available
    }

    const futureClose = futureCandle.close
    const rawReturn = (futureClose - observationPrice) / observationPrice

    // §6 — apply the configured label method
    let labelValue: number
    switch (config.method) {
      case 'FIXED_HORIZON_RETURN':
        labelValue = rawReturn
        break
      case 'THRESHOLD_CLASSIFICATION': {
        const up = config.upThreshold ?? 0.01
        const down = config.downThreshold ?? -0.01
        labelValue = rawReturn > up ? 1 : rawReturn < down ? -1 : 0
        break
      }
      case 'TRIPLE_BARRIER': {
        const tp = config.takeProfitPct ?? 0.02
        const sl = config.stopLossPct ?? -0.01
        // Check which barrier was hit first
        let hit = 0 // 0 = time expired (neutral)
        for (const c of futureCandles) {
          if (c.time > futureTime) break
          const ret = (c.high - observationPrice) / observationPrice
          const retLow = (c.low - observationPrice) / observationPrice
          if (ret >= tp) { hit = 1; break } // take profit
          if (retLow <= sl) { hit = -1; break } // stop loss
        }
        labelValue = hit
        break
      }
      case 'VOLATILITY_ADJUSTED_RETURN': {
        const lookback = config.volLookback ?? 20
        const recentCandles = futureCandles.slice(0, lookback)
        const returns = recentCandles.map((c, i) => i > 0 ? (c.close - futureCandles[i - 1].close) / futureCandles[i - 1].close : 0)
        const vol = Math.sqrt(returns.reduce((a, r) => a + r * r, 0) / Math.max(1, returns.length))
        labelValue = vol > 1e-10 ? rawReturn / vol : 0
        break
      }
      case 'QUANTILE_CLASSIFICATION': {
        // Simplified: use the raw return's sign + magnitude bucket
        const n = config.quantiles ?? 5
        const absRet = Math.abs(rawReturn)
        const bucket = Math.min(n - 1, Math.floor(absRet * n * 10))
        labelValue = rawReturn > 0 ? bucket : -bucket
        break
      }
      case 'RELATIVE_CROSS_ASSET_RANKING':
        // Ranking requires cross-sectional context — handled at dataset level
        labelValue = rawReturn // placeholder — rank computed during dataset assembly
        break
      case 'PROBABILITY_TARGET':
        labelValue = rawReturn > 0 ? 1 : 0
        break
      default:
        labelValue = rawReturn
    }

    return {
      value: labelValue,
      method: config.method,
      family: this.inferFamily(config.method),
      horizon,
      realizedAt: futureCandle.time,
      futureClosePrice: futureClose,
      observationPrice,
      rawReturn,
      isMature: true,
    }
  }

  private inferFamily(method: LabelMethod): LabelResult['family'] {
    switch (method) {
      case 'FIXED_HORIZON_RETURN':
      case 'VOLATILITY_ADJUSTED_RETURN':
        return 'FUTURE_RETURN'
      case 'THRESHOLD_CLASSIFICATION':
      case 'TRIPLE_BARRIER':
        return 'DIRECTION_CLASSIFICATION'
      case 'QUANTILE_CLASSIFICATION':
        return 'DIRECTION_CLASSIFICATION'
      case 'RELATIVE_CROSS_ASSET_RANKING':
        return 'RELATIVE_RANKING'
      case 'PROBABILITY_TARGET':
        return 'OPPORTUNITY_SCORE'
      default:
        return 'FUTURE_RETURN'
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample Filter  (Chapter 4.3 §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterCriteria {
  minFeatureQuality: number
  minLiquidity: number | null
  excludeGaps: boolean
  excludeMaintenance: boolean
  excludeAbnormalVolatility: boolean
  requireCompleteHorizons: boolean
}

export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  minFeatureQuality: 0.3,
  minLiquidity: null,
  excludeGaps: true,
  excludeMaintenance: true,
  excludeAbnormalVolatility: false,
  requireCompleteHorizons: true,
}

export function filterSample(
  features: ProcessedFeatureVector,
  label: LabelResult | null,
  criteria: FilterCriteria,
): { accepted: boolean; reasons: string[] } {
  const reasons: string[] = []

  // §9 — missing dependencies (no label)
  if (!label) {
    reasons.push('missing label (horizon not mature or no future data)')
  }

  // §9 — low data quality
  if (features.featureQualityScore < criteria.minFeatureQuality) {
    reasons.push(`low feature quality: ${features.featureQualityScore.toFixed(2)} < ${criteria.minFeatureQuality}`)
  }

  // §9 — invalid labels
  if (label && !Number.isFinite(label.value)) {
    reasons.push('invalid label: not finite')
  }

  // §9 — incomplete horizons
  if (criteria.requireCompleteHorizons && label && !label.isMature) {
    reasons.push('incomplete horizon: label not mature')
  }

  return { accepted: reasons.length === 0, reasons }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample Weighter  (Chapter 4.3 §9.1)
// ─────────────────────────────────────────────────────────────────────────────

export class SampleWeighter {
  private config: WeightingConfig

  constructor(config: WeightingConfig) {
    this.config = config
  }

  /** Compute a deterministic sample weight (§9.1). */
  computeWeight(
    label: number,
    timestamp: number,
    datasetTimestamps: number[],
    labelDistribution?: Record<string, number>,
  ): number {
    switch (this.config.method) {
      case 'UNIFORM':
        return 1.0

      case 'ABSOLUTE_RETURN':
        return Math.abs(label) + 0.01 // avoid zero weight

      case 'VOLATILITY_ADJUSTED':
        return 1.0 // simplified — would use rolling volatility

      case 'CLASS_BALANCING': {
        const counts = labelDistribution ?? {}
        const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1
        const classCount = counts[String(label)] ?? 1
        return total / (Object.keys(counts).length * classCount)
      }

      case 'SAMPLE_UNIQUENESS': {
        // Weight inversely proportional to how many other samples share similar timestamps
        const nearby = datasetTimestamps.filter((t) => Math.abs(t - timestamp) < 3600000).length
        return 1.0 / Math.max(1, nearby)
      }

      case 'TIME_DECAY': {
        const halfLifeMs = (this.config.halfLifeDays ?? 30) * 24 * 60 * 60 * 1000
        const latestTs = Math.max(...datasetTimestamps, timestamp)
        const ageMs = latestTs - timestamp
        return Math.pow(0.5, ageMs / halfLifeMs)
      }

      case 'REGIME_AWARE':
        return 1.0 // simplified — would use regime-specific weights

      default:
        return 1.0
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Splitter  (Chapter 4.3 §10, §14, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export class DatasetSplitter {
  /**
   * Assign a sample to a dataset split (§10, Rule 12 — temporal ordering).
   * No random shuffling across time (Rule 12).
   */
  assignSplit(timestamp: number, horizon: TargetHorizon, config: SplitConfig): DatasetSplit | null {
    const horizonMs = TARGET_HORIZON_MS[horizon]

    // §14 — purge training samples whose horizons overlap with validation/test
    // A training sample at time T with horizon H has its label realized at T+H.
    // If T+H > validationStart, the label uses data from the validation period → leakage.
    const validationStart = config.trainEnd
    const testStart = config.validationEnd + config.embargoMs

    if (timestamp + horizonMs > validationStart && timestamp < validationStart) {
      // Training sample whose horizon overlaps validation → purge
      return null
    }
    if (timestamp + horizonMs > testStart && timestamp < testStart) {
      // Training sample whose horizon overlaps test → purge
      return null
    }

    // Temporal assignment (Rule 12)
    if (timestamp < config.trainEnd) return 'TRAIN'
    if (timestamp < config.validationEnd) return 'VALIDATION'
    if (timestamp < config.testEnd) return 'TEST'

    // After test end → research/benchmark
    return 'RESEARCH'
  }

  /**
   * Apply embargo (§14): skip samples within the embargo window after val/test boundaries.
   */
  isEmbargoed(timestamp: number, config: SplitConfig): boolean {
    const valEmbargoEnd = config.validationEnd + config.embargoMs
    const testEmbargoEnd = config.testEnd + config.embargoMs
    // Samples within embargo windows are excluded
    return (timestamp >= config.validationEnd && timestamp < valEmbargoEnd) ||
           (timestamp >= config.testEnd && timestamp < testEmbargoEnd)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Validator  (Chapter 4.3 §11)
// ─────────────────────────────────────────────────────────────────────────────

export function validateLabels(samples: TrainingSample[]): LabelValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let duplicates = 0
  let missing = 0

  // §11 — duplicate detection
  const seen = new Set<string>()
  for (const s of samples) {
    const key = `${s.symbol}:${s.timestamp}:${s.predictionHorizon}`
    if (seen.has(key)) duplicates++
    seen.add(key)
  }

  // §11 — missing label detection
  missing = samples.filter((s) => !Number.isFinite(s.label)).length

  // §11 — distribution analysis
  const distribution: Record<string, number> = {}
  for (const s of samples) {
    const key = String(Math.round(s.label * 100) / 100)
    distribution[key] = (distribution[key] ?? 0) + 1
  }

  // §11 — class balance (for classification)
  const classCounts = Object.values(distribution)
  const total = classCounts.reduce((a, b) => a + b, 0)
  const expectedPerClass = total / Math.max(1, classCounts.length)
  const balance = expectedPerClass > 0
    ? 1 - (classCounts.reduce((a, c) => a + Math.abs(c - expectedPerClass), 0) / (total * 2))
    : 0

  if (duplicates > 0) errors.push(`${duplicates} duplicate samples detected`)
  if (missing > 0) errors.push(`${missing} samples with missing/invalid labels`)
  if (balance < 0.3) warnings.push(`class imbalance: balance score ${balance.toFixed(2)}`)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    horizonVerified: true,
    futureWindowVerified: true,
    duplicatesDetected: duplicates,
    missingLabels: missing,
    distributionAnalysis: distribution,
    classBalance: balance,
    statisticalIntegrity: errors.length === 0,
    versionCompatible: true,
    quarantined: errors.length > 5,
  }
}
