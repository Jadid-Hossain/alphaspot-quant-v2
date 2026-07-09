// AlphaSpot Technical Indicators Library
// Pure TypeScript implementations of RSI, StochRSI, MACD, EMA, Bollinger Bands, OBV, ATR.
// No external dependencies — runs in both the Next.js server and the socket.io mini-service.

import type { Candle, Indicators } from './types'

/** Simple Moving Average over the last `period` values */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

/** Exponential Moving Average — returns the full series so we can chain */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0]
  out.push(prev)
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null
  return emaSeries(values, period).at(-1) ?? null
}

/** Wilder's RSI */
export function rsiSeries(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return []
  const out: number[] = []
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return out
}

export function rsi(closes: number[], period = 14): number | null {
  const s = rsiSeries(closes, period)
  return s.length ? s.at(-1)! : null
}

/** Stochastic RSI — K and D lines (3,3 smooth of 14-period RSI) */
export function stochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): { k: number | null; d: number | null } {
  const rsiArr = rsiSeries(closes, rsiPeriod)
  if (rsiArr.length < stochPeriod) return { k: null, d: null }
  const rawK: number[] = []
  for (let i = stochPeriod - 1; i < rsiArr.length; i++) {
    const window = rsiArr.slice(i - stochPeriod + 1, i + 1)
    const min = Math.min(...window)
    const max = Math.max(...window)
    rawK.push(max === min ? 50 : ((rsiArr[i] - min) / (max - min)) * 100)
  }
  if (rawK.length < kSmooth) return { k: null, d: null }
  const kArr = smaOf(rawK, kSmooth)
  const dArr = smaOf(kArr.filter((v) => v !== null) as number[], dSmooth)
  return { k: kArr.at(-1) ?? null, d: dArr.at(-1) ?? null }
}

function smaOf(values: number[], period: number): number[] {
  if (values.length < period) return []
  const out: number[] = []
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    out.push(sum / period)
  }
  return out
}

/** MACD (12, 26, 9) */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): { macd: number | null; signal: number | null; hist: number | null } {
  if (closes.length < slow) return { macd: null, signal: null, hist: null }
  const fastEma = emaSeries(closes, fast)
  const slowEma = emaSeries(closes, slow)
  const macdLine: number[] = []
  // align from index slow-1
  for (let i = slow - 1; i < closes.length; i++) {
    macdLine.push(fastEma[i] - slowEma[i])
  }
  if (macdLine.length < signal) return { macd: macdLine.at(-1) ?? null, signal: null, hist: null }
  const signalLine = emaSeries(macdLine, signal)
  const m = macdLine.at(-1)!
  const s = signalLine.at(-1) ?? null
  return { macd: m, signal: s, hist: s !== null ? m - s : null }
}

/** Bollinger Bands (20, 2) */
export function bollinger(closes: number[], period = 20, mult = 2): { upper: number | null; middle: number | null; lower: number | null; percentB: number | null } {
  if (closes.length < period) return { upper: null, middle: null, lower: null, percentB: null }
  const slice = closes.slice(-period)
  const mean = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
  const std = Math.sqrt(variance)
  const upper = mean + mult * std
  const lower = mean - mult * std
  const last = closes.at(-1)!
  const percentB = upper === lower ? 50 : ((last - lower) / (upper - lower)) * 100
  return { upper, middle: mean, lower, percentB }
}

/** On-Balance Volume series + rising flag */
export function obvSeries(candles: Candle[]): number[] {
  const out: number[] = []
  let prev = 0
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      prev = candles[i].volume
    } else {
      const dir = candles[i].close > candles[i - 1].close ? 1 : candles[i].close < candles[i - 1].close ? -1 : 0
      prev = prev + dir * candles[i].volume
    }
    out.push(prev)
  }
  return out
}

export function obv(candles: Candle[]): { value: number | null; rising: boolean | null } {
  if (candles.length < 2) return { value: null, rising: null }
  const s = obvSeries(candles)
  const last = s.at(-1)!
  const lookback = Math.min(10, s.length - 1)
  const prev = s[s.length - 1 - lookback]
  return { value: last, rising: last > prev }
}

/** Average True Range (14) — used for volatility context */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }
  // Wilder smoothing
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period
  }
  return prev
}

/** Compute the full Indicators bundle for a candle series */
export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close)
  const r = rsi(closes, 14)
  const stoch = stochRsi(closes)
  const m = macd(closes)
  const bb = bollinger(closes)
  const obvRes = obv(candles)
  return {
    rsi: r,
    stochRsiK: stoch.k,
    stochRsiD: stoch.d,
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbPercentB: bb.percentB,
    obv: obvRes.value,
    obvRising: obvRes.rising,
    atr: atr(candles, 14),
  }
}

/** Helper: is the 4h macro trend up? (EMA50 > EMA200) */
export function isMacroUp(ind: Indicators): boolean | null {
  if (ind.ema50 == null || ind.ema200 == null) return null
  return ind.ema50 > ind.ema200
}

/** Helper: did EMA50 just cross below EMA200 (death cross) vs previous candle? */
export function macroBreakdown(prev: Indicators | null, curr: Indicators): boolean {
  if (!prev || prev.ema50 == null || prev.ema200 == null || curr.ema50 == null || curr.ema200 == null) return false
  const wasUp = prev.ema50 >= prev.ema200
  const nowDown = curr.ema50 < curr.ema200
  return wasUp && nowDown
}
