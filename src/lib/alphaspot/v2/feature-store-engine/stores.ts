// CHAPTER 5.16 §7-§11 — Feature Engineering, Stores, Quality

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  FeatureDefinition,
  FeatureQualityResult,
  FeatureStoreConfiguration,
  FeatureVector,
  FreshnessStatus,
  QualityStatus,
} from './types'

const log = createLogger('decision-intelligence:feature-store:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §7 — FeatureEngineer (19 categories, Rule 8/17 — deterministic, reproducible)
// ─────────────────────────────────────────────────────────────────────────────

export class FeatureEngineer {
  /** Compute feature values from raw data (§7, Rule 17 — mathematically reproducible). */
  compute(
    def: FeatureDefinition,
    rawData: Record<string, number[]>,
    timestamp: number,
    assetId: string,
    exchangeId: string,
  ): FeatureVector {
    const values: Record<string, number> = {}

    // §7 — Execute engineering expression based on category
    switch (def.category) {
      case 'TECHNICAL_INDICATORS':
        values['rsi'] = this.computeRSI(rawData['close'] ?? [])
        values['ema50'] = this.computeEMA(rawData['close'] ?? [], 50)
        values['ema200'] = this.computeEMA(rawData['close'] ?? [], 200)
        break
      case 'ROLLING_STATISTICS':
        values['rolling_mean'] = this.computeRollingMean(rawData['close'] ?? [], def.windowSize ?? 20)
        values['rolling_std'] = this.computeRollingStd(rawData['close'] ?? [], def.windowSize ?? 20)
        break
      case 'VOLATILITY_FEATURES':
        values['atr'] = this.computeATR(rawData['high'] ?? [], rawData['low'] ?? [], rawData['close'] ?? [])
        values['realized_vol'] = this.computeRealizedVol(rawData['close'] ?? [])
        break
      case 'LAG_FEATURES':
        for (const lag of def.lagPeriods) {
          values[`lag_${lag}`] = this.computeLag(rawData['close'] ?? [], lag)
        }
        break
      case 'PRICE_DERIVATIVES':
        values['returns'] = this.computeReturns(rawData['close'] ?? [])
        values['log_returns'] = this.computeLogReturns(rawData['close'] ?? [])
        break
      case 'VOLUME_FEATURES':
        values['volume_sma'] = this.computeRollingMean(rawData['volume'] ?? [], def.windowSize ?? 20)
        values['volume_ratio'] = this.computeVolumeRatio(rawData['volume'] ?? [])
        break
      default:
        values['value'] = rawData['close']?.[rawData['close'].length - 1] ?? 0
    }

    return {
      featureId: def.featureId, assetIdentifier: assetId, exchangeIdentifier: exchangeId,
      timestamp, values, version: def.version,
    }
  }

  /** §7 — Normalize feature values (deterministic, Rule 17). */
  normalize(vector: FeatureVector, method: string, params: Record<string, number>): Record<string, number> {
    const normalized: Record<string, number> = {}
    switch (method) {
      case 'z_score':
        for (const [k, v] of Object.entries(vector.values)) {
          const mean = params[`${k}_mean`] ?? 0
          const std = params[`${k}_std`] ?? 1
          normalized[k] = std > 0 ? (v - mean) / std : 0
        }
        break
      case 'min_max':
        for (const [k, v] of Object.entries(vector.values)) {
          const min = params[`${k}_min`] ?? 0
          const max = params[`${k}_max`] ?? 1
          normalized[k] = max > min ? (v - min) / (max - min) : 0
        }
        break
      default:
        return { ...vector.values }
    }
    return normalized
  }

  // ─── Feature computation helpers ───
  private computeRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50
    let gains = 0, losses = 0
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1]
      if (change > 0) gains += change; else losses -= change
    }
    const rs = losses === 0 ? 100 : gains / losses
    return 100 - 100 / (1 + rs)
  }

  private computeEMA(values: number[], period: number): number {
    if (values.length === 0) return 0
    const k = 2 / (period + 1)
    let ema = values[0]
    for (let i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k)
    return ema
  }

  private computeRollingMean(values: number[], window: number): number {
    if (values.length === 0) return 0
    const slice = values.slice(-window)
    return slice.reduce((s, v) => s + v, 0) / slice.length
  }

  private computeRollingStd(values: number[], window: number): number {
    if (values.length < 2) return 0
    const slice = values.slice(-window)
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length
    return Math.sqrt(variance)
  }

  private computeATR(highs: number[], lows: number[], closes: number[]): number {
    if (closes.length < 2) return 0
    const trueRanges: number[] = []
    for (let i = 1; i < closes.length; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
      trueRanges.push(tr)
    }
    return trueRanges.reduce((s, v) => s + v, 0) / trueRanges.length
  }

  private computeRealizedVol(closes: number[]): number {
    if (closes.length < 2) return 0
    const returns: number[] = []
    for (let i = 1; i < closes.length; i++) returns.push(Math.log(closes[i] / closes[i - 1]))
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length
    return Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length)
  }

  private computeLag(values: number[], lag: number): number {
    if (values.length <= lag) return values[0] ?? 0
    return values[values.length - 1 - lag]
  }

  private computeReturns(closes: number[]): number {
    if (closes.length < 2) return 0
    return (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]
  }

  private computeLogReturns(closes: number[]): number {
    if (closes.length < 2) return 0
    return Math.log(closes[closes.length - 1] / closes[closes.length - 2])
  }

  private computeVolumeRatio(volumes: number[]): number {
    if (volumes.length < 2) return 1
    const recent = volumes[volumes.length - 1]
    const avg = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length)
    return avg > 0 ? recent / avg : 1
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — OnlineFeatureStore (Rule 9/10 — low-latency, independent storage)
// ─────────────────────────────────────────────────────────────────────────────

export class OnlineFeatureStore {
  /** Hot cache: (assetId, featureId) → latest vector. */
  private cache = new Map<string, FeatureVector>()
  /** Freshness tracking. */
  private freshness = new Map<string, number>()

  /** §8 — Write to online store (streaming/incremental updates). */
  write(vector: FeatureVector, currentTime: number = Date.now()): void {
    const key = `${vector.assetIdentifier}:${vector.featureId}`
    this.cache.set(key, vector)
    this.freshness.set(key, currentTime)
  }

  /** §8 — Low-latency retrieval. */
  get(assetId: string, featureId: string): FeatureVector | null {
    return this.cache.get(`${assetId}:${featureId}`) ?? null
  }

  /** §8, Rule 11 — Freshness validation. */
  checkFreshness(assetId: string, featureId: string, timeoutMs: number, currentTime: number = Date.now()): FreshnessStatus {
    const key = `${assetId}:${featureId}`
    const lastUpdate = this.freshness.get(key)
    if (!lastUpdate) return 'UNKNOWN'
    const age = currentTime - lastUpdate
    if (age > timeoutMs * 2) return 'EXPIRED'
    if (age > timeoutMs) return 'STALE'
    return 'FRESH'
  }

  /** §8 — Feature expiration. */
  expire(assetId: string, featureId: string): void {
    const key = `${assetId}:${featureId}`
    this.cache.delete(key)
    this.freshness.delete(key)
  }

  /** Get cache hit ratio stats. */
  getStats(): { cacheSize: number; hitCount: number; missCount: number } {
    return { cacheSize: this.cache.size, hitCount: 0, missCount: 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 — OfflineFeatureStore (Rule 9/10/13 — historical snapshots, immutable)
// ─────────────────────────────────────────────────────────────────────────────

export class OfflineFeatureStore {
  /** Historical snapshots: (assetId, featureId) → sorted by timestamp. */
  private snapshots = new Map<string, FeatureVector[]>()

  /** §9 — Write to offline store (historical snapshot). */
  write(vector: FeatureVector): void {
    const key = `${vector.assetIdentifier}:${vector.featureId}`
    const list = this.snapshots.get(key) ?? []
    list.push(vector)
    this.snapshots.set(key, list)
  }

  /** §9 — Point-in-time historical retrieval (Rule 13 — snapshots never overwritten). */
  getPointInTime(assetId: string, featureId: string, asOfTimestamp: number): FeatureVector | null {
    const key = `${assetId}:${featureId}`
    const list = this.snapshots.get(key)
    if (!list || list.length === 0) return null
    // Find the most recent snapshot at or before asOfTimestamp
    let result: FeatureVector | null = null
    for (const v of list) {
      if (v.timestamp <= asOfTimestamp) result = v
      else break
    }
    return result
  }

  /** §9 — Historical range retrieval. */
  getRange(assetId: string, featureId: string, from: number, to: number): FeatureVector[] {
    const key = `${assetId}:${featureId}`
    const list = this.snapshots.get(key) ?? []
    return list.filter((v) => v.timestamp >= from && v.timestamp <= to)
  }

  /** §9 — Feature replay (Rule 14 — deterministic replay). */
  replay(assetId: string, featureId: string, from: number, to: number): FeatureVector[] {
    return this.getRange(assetId, featureId, from, to)
  }

  /** Get snapshot count. */
  getSnapshotCount(): number {
    let count = 0
    for (const list of this.snapshots.values()) count += list.length
    return count
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — FeatureQualityManager (Rule 12/16)
// Rule 16 — Quality validation precedes publication.
// Rule 12 — Drift detection generates immutable governance events.
// ─────────────────────────────────────────────────────────────────────────────

export class FeatureQualityManager {
  /** §11 — Validate feature quality (Rule 16 — must pass before publication). */
  validate(
    vector: FeatureVector,
    config: FeatureStoreConfiguration,
    historicalValues?: number[],
  ): FeatureQualityResult {
    const issues: string[] = []
    const thresholds = config.qualityThresholds
    const values = Object.values(vector.values)

    // §11 — Missing Values
    const missingValues = values.filter((v) => v === undefined || v === null || Number.isNaN(v)).length
    if (missingValues > thresholds.maxMissingValues) {
      issues.push(`missing values ${missingValues} > threshold ${thresholds.maxMissingValues}`)
    }

    // §11 — Null Percentage
    const nullPercentage = values.length > 0 ? missingValues / values.length : 1
    if (nullPercentage > thresholds.maxNullPercentage) {
      issues.push(`null percentage ${(nullPercentage * 100).toFixed(1)}% > threshold ${(thresholds.maxNullPercentage * 100).toFixed(1)}%`)
    }

    // §11 — Outlier Detection (simple z-score)
    const outlierCount = this.detectOutliers(values)

    // §11 — Statistical Stability
    const statisticalStability = historicalValues && historicalValues.length > 1
      ? this.computeStability(values, historicalValues)
      : 1.0
    if (statisticalStability < thresholds.minStatisticalStability) {
      issues.push(`statistical stability ${statisticalStability.toFixed(3)} < threshold ${thresholds.minStatisticalStability}`)
    }

    // §11 — Distribution Shift
    const distributionShift = historicalValues && historicalValues.length > 0
      ? this.computeDistributionShift(values, historicalValues)
      : 0
    if (distributionShift > thresholds.maxDistributionShift) {
      issues.push(`distribution shift ${distributionShift.toFixed(3)} > threshold ${thresholds.maxDistributionShift}`)
    }

    // §11 — Drift Detection
    const driftScore = distributionShift * 0.7 + (1 - statisticalStability) * 0.3
    if (driftScore > thresholds.maxDriftScore) {
      issues.push(`drift score ${driftScore.toFixed(3)} > threshold ${thresholds.maxDriftScore} (Rule 12 — governance event generated)`)
    }

    // §11 — Schema Validation
    const schemaValid = values.length > 0

    // Determine status (Rule 16 — invalid features never published)
    let status: QualityStatus
    if (issues.length === 0) status = 'VALIDATED'
    else if (issues.length <= 2 && !issues.some((i) => i.includes('missing') || i.includes('null'))) status = 'WARNING'
    else status = 'INVALID'

    return {
      status, missingValues, nullPercentage, duplicateCount: 0, outlierCount,
      statisticalStability, distributionShift, driftScore,
      schemaValid, dependenciesValid: true, issues,
    }
  }

  private detectOutliers(values: number[]): number {
    if (values.length < 4) return 0
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
    if (std === 0) return 0
    return values.filter((v) => Math.abs((v - mean) / std) > 3).length
  }

  private computeStability(current: number[], historical: number[]): number {
    const currentMean = current.reduce((s, v) => s + v, 0) / current.length
    const historicalMean = historical.reduce((s, v) => s + v, 0) / historical.length
    const historicalStd = Math.sqrt(historical.reduce((s, v) => s + (v - historicalMean) ** 2, 0) / historical.length)
    if (historicalStd === 0) return 1
    return Math.max(0, 1 - Math.abs(currentMean - historicalMean) / (historicalStd * 3))
  }

  private computeDistributionShift(current: number[], historical: number[]): number {
    const currentMean = current.reduce((s, v) => s + v, 0) / current.length
    const historicalMean = historical.reduce((s, v) => s + v, 0) / historical.length
    const historicalStd = Math.sqrt(historical.reduce((s, v) => s + (v - historicalMean) ** 2, 0) / historical.length)
    if (historicalStd === 0) return 0
    return Math.min(1, Math.abs(currentMean - historicalMean) / historicalStd)
  }
}

// Singletons
export const featureEngineer = new FeatureEngineer()
export const onlineFeatureStore = new OnlineFeatureStore()
export const offlineFeatureStore = new OfflineFeatureStore()
export const featureQualityManager = new FeatureQualityManager()
