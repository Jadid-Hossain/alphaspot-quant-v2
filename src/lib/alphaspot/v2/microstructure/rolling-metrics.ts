// CHAPTER 3.6 §15.1, Rule 13 — Constant-Memory Rolling Metrics
//
// All rolling temporal metrics (VWAP, spread volatility, liquidity stats,
// execution pressure) use constant-memory algorithms: EMA, EWMA, fixed-size
// circular buffers. Growing historical arrays are PROHIBITED during live
// execution. Memory usage remains bounded regardless of engine uptime.

// ─────────────────────────────────────────────────────────────────────────────
// Exponential Moving Average (EMA)  — constant O(1) memory
// ─────────────────────────────────────────────────────────────────────────────

export class EMA {
  private _value: number | null = null
  private _alpha: number

  constructor(alpha: number) {
    if (alpha <= 0 || alpha > 1) throw new Error(`EMA alpha must be in (0, 1], got ${alpha}`)
    this._alpha = alpha
  }

  update(value: number): number {
    if (this._value === null) {
      this._value = value
    } else {
      this._value = this._alpha * value + (1 - this._alpha) * this._value
    }
    return this._value
  }

  get value(): number | null {
    return this._value
  }

  reset(): void {
    this._value = null
  }
}

/** Create an EMA with a specified period (alpha = 2 / (period + 1)). */
export function emaForPeriod(period: number): EMA {
  return new EMA(2 / (period + 1))
}

// ─────────────────────────────────────────────────────────────────────────────
// Exponentially Weighted Moving Average (EWMA) — for volatility
// Constant O(1) memory. Tracks variance using exponential weighting.
// ─────────────────────────────────────────────────────────────────────────────

export class EWMA {
  private _mean: number | null = null
  private _variance: number | null = null
  private _lambda: number // decay factor

  constructor(lambda: number) {
    if (lambda <= 0 || lambda >= 1) throw new Error(`EWMA lambda must be in (0, 1), got ${lambda}`)
    this._lambda = lambda
  }

  update(value: number): { mean: number; variance: number; stdDev: number } {
    if (this._mean === null) {
      this._mean = value
      this._variance = 0
    } else {
      const diff = value - this._mean
      this._mean = this._lambda * value + (1 - this._lambda) * this._mean
      this._variance = this._lambda * diff * diff + (1 - this._lambda) * (this._variance ?? 0)
    }
    return {
      mean: this._mean,
      variance: this._variance ?? 0,
      stdDev: Math.sqrt(this._variance ?? 0),
    }
  }

  get mean(): number | null {
    return this._mean
  }

  get stdDev(): number | null {
    return this._variance !== null ? Math.sqrt(this._variance) : null
  }

  reset(): void {
    this._mean = null
    this._variance = null
  }
}

/** Create an EWMA with a specified half-life. */
export function ewmaForHalfLife(halfLife: number): EWMA {
  return new EWMA(1 - Math.exp(-Math.LN2 / halfLife))
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-Size Circular Buffer  — constant O(N) memory
// §15.1 approved implementation for rolling stats (median, max, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export class CircularBuffer<T = number> {
  private buffer: (T | null)[]
  private head = 0
  private size = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity).fill(null)
  }

  push(value: T): void {
    this.buffer[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) this.size++
  }

  /** Get all values in insertion order. */
  values(): T[] {
    const out: T[] = []
    if (this.size < this.capacity) {
      // Buffer not yet full — read from start
      for (let i = 0; i < this.size; i++) out.push(this.buffer[i] as T)
    } else {
      // Buffer full — read from head (oldest) around to head-1 (newest)
      for (let i = 0; i < this.capacity; i++) {
        const idx = (this.head + i) % this.capacity
        out.push(this.buffer[idx] as T)
      }
    }
    return out
  }

  /** Get the most recent value. */
  latest(): T | null {
    if (this.size === 0) return null
    const idx = (this.head - 1 + this.capacity) % this.capacity
    return this.buffer[idx]
  }

  /** Get the oldest value. */
  oldest(): T | null {
    if (this.size === 0) return null
    if (this.size < this.capacity) return this.buffer[0]
    return this.buffer[this.head]
  }

  /** Compute median (for number buffers). */
  median(): number | null {
    const vals = this.values() as number[]
    if (vals.length === 0) return null
    const sorted = [...vals].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  /** Compute max (for number buffers). */
  max(): number | null {
    const vals = this.values() as number[]
    if (vals.length === 0) return null
    return Math.max(...vals)
  }

  /** Compute min (for number buffers). */
  min(): number | null {
    const vals = this.values() as number[]
    if (vals.length === 0) return null
    return Math.min(...vals)
  }

  get length(): number {
    return this.size
  }

  get isFull(): boolean {
    return this.size >= this.capacity
  }

  clear(): void {
    this.buffer.fill(null)
    this.head = 0
    this.size = 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate of Change tracker — constant O(1) memory
// Used for spread expansion/compression rate (§8)
// ─────────────────────────────────────────────────────────────────────────────

export class RateOfChange {
  private _previous: number | null = null
  private _rate: number | null = null
  private _alpha: number

  constructor(alpha: number = 0.1) {
    this._alpha = alpha
  }

  update(value: number): number | null {
    if (this._previous !== null) {
      const change = value - this._previous
      this._rate = this._rate === null ? change : this._alpha * change + (1 - this._alpha) * this._rate
    }
    this._previous = value
    return this._rate
  }

  get rate(): number | null {
    return this._rate
  }

  reset(): void {
    this._previous = null
    this._rate = null
  }
}
