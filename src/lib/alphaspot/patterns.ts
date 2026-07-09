// AlphaSpot Candlestick Pattern Recognition
// Detects bullish/bearish reversal patterns from the last few candles.
// Pure TypeScript, no dependencies.

import type { Candle, Patterns, PatternHit } from './types'

const body = (c: Candle) => Math.abs(c.close - c.open)
const range = (c: Candle) => c.high - c.low || 1e-9
const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close)
const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low
const isBull = (c: Candle) => c.close > c.open
const isBear = (c: Candle) => c.close < c.open

function hit(name: string, direction: PatternHit['direction'], strength: number, candleIndex: number): PatternHit {
  return { name, direction, strength, candleIndex }
}

/**
 * Detect candlestick patterns using the last ~3 candles.
 * Returns bullish / bearish / neutral hits. Only the strongest hit per direction is kept.
 */
export function detectPatterns(candles: Candle[]): Patterns {
  const bullish: PatternHit[] = []
  const bearish: PatternHit[] = []
  const neutral: PatternHit[] = []
  const n = candles.length
  if (n < 3) return { bullish, bearish, neutral }
  const i = n - 1
  const c0 = candles[i]      // current (latest closed)
  const c1 = candles[i - 1]
  const c2 = candles[i - 2]

  // ---- Bullish Engulfing ----
  // Previous bearish, current bullish, current body fully engulfs previous body
  if (isBear(c1) && isBull(c0) && c0.open <= c1.close && c0.close >= c1.open && body(c0) > body(c1)) {
    bullish.push(hit('Bullish Engulfing', 'bullish', 85, i))
  }

  // ---- Bearish Engulfing ----
  if (isBull(c1) && isBear(c0) && c0.open >= c1.close && c0.close <= c1.open && body(c0) > body(c1)) {
    bearish.push(hit('Bearish Engulfing', 'bearish', 85, i))
  }

  // ---- Hammer (bullish reversal) ----
  // Small body at top, long lower wick (>= 2x body), tiny upper wick
  if (body(c0) > 0 && lowerWick(c0) >= 2 * body(c0) && upperWick(c0) <= body(c0) * 0.6 && (lowerWick(c0) / range(c0)) > 0.55) {
    bullish.push(hit('Hammer', 'bullish', 70, i))
  }

  // ---- Shooting Star (bearish reversal) ----
  if (body(c0) > 0 && upperWick(c0) >= 2 * body(c0) && lowerWick(c0) <= body(c0) * 0.6 && (upperWick(c0) / range(c0)) > 0.55) {
    bearish.push(hit('Shooting Star', 'bearish', 70, i))
  }

  // ---- Bullish Harami (inside bar, prev big bearish, current small bullish) ----
  if (isBear(c1) && isBull(c0) && body(c0) < body(c1) * 0.6 && c0.open >= c1.close && c0.close <= c1.open) {
    bullish.push(hit('Bullish Harami', 'bullish', 55, i))
  }

  // ---- Bearish Harami ----
  if (isBull(c1) && isBear(c0) && body(c0) < body(c1) * 0.6 && c0.open <= c1.close && c0.close >= c1.open) {
    bearish.push(hit('Bearish Harami', 'bearish', 55, i))
  }

  // ---- Doji (indecision) ----
  if (body(c0) <= range(c0) * 0.1) {
    neutral.push(hit('Doji', 'neutral', 40, i))
  }

  // ---- Morning Star (3-candle bullish reversal) ----
  // c2 big bearish, c1 small body (star), c0 bullish closing above midpoint of c2
  if (
    isBear(c2) && body(c2) > range(c2) * 0.5 &&
    body(c1) < body(c2) * 0.5 &&
    isBull(c0) && c0.close > (c2.open + c2.close) / 2
  ) {
    bullish.push(hit('Morning Star', 'bullish', 90, i))
  }

  // ---- Evening Star (3-candle bearish reversal) ----
  if (
    isBull(c2) && body(c2) > range(c2) * 0.5 &&
    body(c1) < body(c2) * 0.5 &&
    isBear(c0) && c0.close < (c2.open + c2.close) / 2
  ) {
    bearish.push(hit('Evening Star', 'bearish', 90, i))
  }

  // ---- Piercing Line (bullish) ----
  if (isBear(c1) && isBull(c0) && c0.open < c1.low && c0.close > (c1.open + c1.close) / 2 && c0.close < c1.open) {
    bullish.push(hit('Piercing Line', 'bullish', 65, i))
  }

  // ---- Dark Cloud Cover (bearish) ----
  if (isBull(c1) && isBear(c0) && c0.open > c1.high && c0.close < (c1.open + c1.close) / 2 && c0.close > c1.open) {
    bearish.push(hit('Dark Cloud Cover', 'bearish', 65, i))
  }

  // ---- Three White Soldiers (strong bullish) ----
  if (isBull(c2) && isBull(c1) && isBull(c0) && c0.close > c1.close && c1.close > c2.close && body(c0) > range(c0) * 0.5 && body(c1) > range(c1) * 0.5) {
    bullish.push(hit('Three White Soldiers', 'bullish', 80, i))
  }

  // ---- Three Black Crows (strong bearish) ----
  if (isBear(c2) && isBear(c1) && isBear(c0) && c0.close < c1.close && c1.close < c2.close && body(c0) > range(c0) * 0.5 && body(c1) > range(c1) * 0.5) {
    bearish.push(hit('Three Black Crows', 'bearish', 80, i))
  }

  // Keep only the strongest hit per direction to avoid double-counting
  const pick = (arr: PatternHit[]) => (arr.length ? [arr.reduce((a, b) => (b.strength > a.strength ? b : a))] : [])

  return {
    bullish: pick(bullish),
    bearish: pick(bearish),
    neutral,
  }
}

/** Human-readable summary of detected patterns */
export function summarizePatterns(p: Patterns): string {
  const parts: string[] = []
  if (p.bullish.length) parts.push(p.bullish.map((b) => `${b.name} (${b.strength})`).join(', '))
  if (p.bearish.length) parts.push(p.bearish.map((b) => `${b.name} (${b.strength})`).join(', '))
  if (p.neutral.length) parts.push(p.neutral.map((b) => `${b.name} (${b.strength})`).join(', '))
  return parts.length ? parts.join(' | ') : 'No notable pattern'
}
