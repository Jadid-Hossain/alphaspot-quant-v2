// CHAPTER 3.7 §7.1, §8.1, §9.1, Rule 11 — Adaptive Statistical Baselines
//
// All behavioral detections (Spoofing, Icebergs, Absorption) use adaptive
// statistical baselines (rolling Z-score normalization) rather than fixed
// thresholds (Rule 11). This ensures asset-independent behavior detection.
//
// Uses constant-memory EMA for mean + variance tracking (§15.1 from Ch 3.6).

import { EWMA } from '../microstructure/rolling-metrics'

// ─────────────────────────────────────────────────────────────────────────────
// Rolling Z-Score  — constant O(1) memory
// Computes how many standard deviations a value is from its rolling mean.
// §7.1 — "spoofing probability computed relative to rolling baselines using
// configurable statistical normalization (e.g. rolling Z-score)"
// ─────────────────────────────────────────────────────────────────────────────

export class RollingZScore {
  private ewma: EWMA
  private _mean: number | null = null
  private _stdDev: number | null = null
  private _sampleCount = 0

  constructor(halfLife: number = 50) {
    this.ewma = new EWMA(1 - Math.exp(-Math.LN2 / halfLife))
  }

  /** Update the baseline with a new observation and return the Z-score. */
  update(value: number): { zScore: number; mean: number; stdDev: number } {
    this._sampleCount++
    const result = this.ewma.update(value)
    this._mean = result.mean
    this._stdDev = result.stdDev

    if (this._stdDev === null || this._stdDev < 1e-10 || this._sampleCount < 5) {
      return { zScore: 0, mean: result.mean, stdDev: result.stdDev }
    }

    const zScore = (value - result.mean) / result.stdDev
    return { zScore, mean: result.mean, stdDev: result.stdDev }
  }

  get mean(): number | null {
    return this._mean
  }

  get stdDev(): number | null {
    return this._stdDev
  }

  get sampleCount(): number {
    return this._sampleCount
  }

  reset(): void {
    this.ewma.reset()
    this._mean = null
    this._stdDev = null
    this._sampleCount = 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling Baseline  — tracks a metric's rolling statistics for normalization
// Used for cancellation rate, order arrival rate, refill rate, queue lifetime (§7.1)
// ─────────────────────────────────────────────────────────────────────────────

export class RollingBaseline {
  private zScore: RollingZScore
  private _min: number | null = null
  private _max: number | null = null

  constructor(halfLife: number = 50) {
    this.zScore = new RollingZScore(halfLife)
  }

  /** Record an observation and get its normalized Z-score. */
  observe(value: number): number {
    if (this._min === null || value < this._min) this._min = value
    if (this._max === null || value > this._max) this._max = value
    return this.zScore.update(value).zScore
  }

  get mean(): number | null {
    return this.zScore.mean
  }

  get stdDev(): number | null {
    return this.zScore.stdDev
  }

  get min(): number | null {
    return this._min
  }

  get max(): number | null {
    return this._max
  }

  get sampleCount(): number {
    return this.zScore.sampleCount
  }

  /** Is this value statistically abnormal? (|Z| > threshold) */
  isAbnormal(value: number, threshold: number = 2.0): boolean {
    const z = this.observe(value)
    return Math.abs(z) > threshold
  }

  reset(): void {
    this.zScore.reset()
    this._min = null
    this._max = null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Probability mapper — convert Z-scores to 0..1 probability (sigmoid)
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a Z-score to a 0..1 probability using sigmoid. */
export function zScoreToProbability(zScore: number): number {
  // Sigmoid: higher Z → higher probability
  return 1 / (1 + Math.exp(-zScore))
}

/** Convert a Z-score to a 0..1 probability (absolute deviation from baseline). */
export function zScoreToDeviationProbability(zScore: number): number {
  // Use |Z| — abnormality in either direction
  return 1 / (1 + Math.exp(-Math.abs(zScore) + 1.5))
}
