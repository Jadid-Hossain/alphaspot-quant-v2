// CHAPTER 3.9 §6, §7, §11 — Price, Volume, and Volatility Features
//
// All features are deterministic (Rule 2, Rule 3). Temporal integrity enforced
// (Rule 4, Rule 5, Rule 6 — no look-ahead bias, no data leakage). Extraction
// only — no normalization (Rule 7).

import type { CanonicalCandle } from '../candle-engine/types'
import { EMA, CircularBuffer, emaForPeriod } from '../microstructure/rolling-metrics'
import type { FeatureValue } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Price Features  (Chapter 3.9 §6)
// ─────────────────────────────────────────────────────────────────────────────

export function extractPriceFeatures(candles: CanonicalCandle[]): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (candles.length < 2) return features

  const current = candles[candles.length - 1]
  const prev = candles[candles.length - 2]

  // §6 — Returns
  features['price.return'] = current.close > 0 && prev.close > 0 ? (current.close - prev.close) / prev.close : null
  // §6 — Log Returns
  features['price.log_return'] = current.close > 0 && prev.close > 0 ? Math.log(current.close / prev.close) : null
  // §6 — Price Acceleration (second derivative of price)
  if (candles.length >= 3) {
    const prev2 = candles[candles.length - 3]
    const v1 = prev.close - prev2.close
    const v2 = current.close - prev.close
    features['price.acceleration'] = v2 - v1
  } else {
    features['price.acceleration'] = null
  }
  // §6 — Price Velocity (first derivative)
  features['price.velocity'] = current.close - prev.close
  // §6 — Gap Size (open vs previous close)
  features['price.gap_size'] = current.open - prev.close
  features['price.gap_size_pct'] = prev.close > 0 ? (current.open - prev.close) / prev.close : null
  // §6 — Relative Close Position (where close sits within the candle range)
  const range = current.high - current.low
  features['price.rel_close_position'] = range > 0 ? (current.close - current.low) / range : 0.5
  // §6 — Candle Body Ratio
  const body = Math.abs(current.close - current.open)
  features['price.body_ratio'] = range > 0 ? body / range : 0
  // §6 — Upper Shadow Ratio
  const upperShadow = current.high - Math.max(current.open, current.close)
  features['price.upper_shadow_ratio'] = range > 0 ? upperShadow / range : 0
  // §6 — Lower Shadow Ratio
  const lowerShadow = Math.min(current.open, current.close) - current.low
  features['price.lower_shadow_ratio'] = range > 0 ? lowerShadow / range : 0
  // §6 — Range Expansion (current range vs previous range)
  const prevRange = prev.high - prev.low
  features['price.range_expansion'] = prevRange > 0 ? range / prevRange : 1
  // §6 — Range Compression (inverse of expansion)
  features['price.range_compression'] = range > 0 ? prevRange / range : 1

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume Features  (Chapter 3.9 §7)
// ─────────────────────────────────────────────────────────────────────────────

export function extractVolumeFeatures(candles: CanonicalCandle[]): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (candles.length < 2) return features

  const current = candles[candles.length - 1]
  const prev = candles[candles.length - 2]

  // §7 — Relative Volume (current vs average of last N)
  const lookback = Math.min(20, candles.length - 1)
  const recentVols = candles.slice(-lookback - 1, -1).map((c) => c.volume)
  const avgVol = recentVols.length > 0 ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : current.volume
  features['volume.relative'] = avgVol > 0 ? current.volume / avgVol : 1
  // §7 — Rolling Volume (sum of last N)
  features['volume.rolling'] = candles.slice(-lookback).reduce((a, c) => a + c.volume, 0)
  // §7 — Volume Acceleration
  features['volume.acceleration'] = current.volume - prev.volume
  // §7 — Volume Decay
  features['volume.decay'] = prev.volume > 0 ? current.volume / prev.volume : 1
  // §7 — Buy Volume Ratio
  features['volume.buy_ratio'] = current.volume > 0 ? current.buyVolume / current.volume : null
  // §7 — Sell Volume Ratio
  features['volume.sell_ratio'] = current.volume > 0 ? current.sellVolume / current.volume : null
  // §7 — VWAP Distance (close vs VWAP)
  features['volume.vwap_distance'] = current.vwap > 0 ? (current.close - current.vwap) / current.vwap : null
  // §7 — Volume Persistence (how consistent volume has been)
  const vols = candles.slice(-lookback).map((c) => c.volume)
  const volMean = vols.reduce((a, b) => a + b, 0) / vols.length
  const volStd = Math.sqrt(vols.reduce((a, v) => a + (v - volMean) ** 2, 0) / vols.length)
  features['volume.persistence'] = volMean > 0 ? 1 - Math.min(1, volStd / volMean) : 0

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Volatility Features  (Chapter 3.9 §11)
// ─────────────────────────────────────────────────────────────────────────────

export function extractVolatilityFeatures(candles: CanonicalCandle[]): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (candles.length < 14) return features

  const closes = candles.map((c) => c.close)

  // §11 — ATR (Average True Range, 14-period, Wilder)
  const trueRanges: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    )
    trueRanges.push(tr)
  }
  const atrPeriod = Math.min(14, trueRanges.length)
  const atr = trueRanges.slice(-atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod
  features['volatility.atr'] = atr
  features['volatility.atr_pct'] = closes[closes.length - 1] > 0 ? atr / closes[closes.length - 1] : null

  // §11 — Realized Volatility (std of log returns)
  const logReturns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) logReturns.push(Math.log(closes[i] / closes[i - 1]))
  }
  const lrMean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length
  const lrStd = Math.sqrt(logReturns.reduce((a, v) => a + (v - lrMean) ** 2, 0) / logReturns.length)
  features['volatility.realized'] = lrStd * Math.sqrt(252) // annualized

  // §11 — Parkinson Volatility (uses high-low range)
  const parkinsonVals: number[] = []
  for (const c of candles.slice(-20)) {
    if (c.high > 0 && c.low > 0) parkinsonVals.push(Math.log(c.high / c.low) ** 2)
  }
  const parkinson = parkinsonVals.length > 0
    ? Math.sqrt(parkinsonVals.reduce((a, b) => a + b, 0) / parkinsonVals.length) * Math.sqrt(252 / (4 * Math.LN2))
    : null
  features['volatility.parkinson'] = parkinson

  // §11 — Garman-Klass Volatility
  const gkVals: number[] = []
  for (const c of candles.slice(-20)) {
    if (c.high > 0 && c.low > 0 && c.open > 0 && c.close > 0) {
      const gk = 0.5 * Math.log(c.high / c.low) ** 2 - (2 * Math.LN2 - 1) * Math.log(c.close / c.open) ** 2
      gkVals.push(gk)
    }
  }
  const gk = gkVals.length > 0 ? Math.sqrt(gkVals.reduce((a, b) => a + b, 0) / gkVals.length) * Math.sqrt(252) : null
  features['volatility.garman_klass'] = gk

  // §11 — Rolling Standard Deviation (20-period close)
  const recentCloses = closes.slice(-20)
  const closeMean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length
  const closeStd = Math.sqrt(recentCloses.reduce((a, v) => a + (v - closeMean) ** 2, 0) / recentCloses.length)
  features['volatility.rolling_std'] = closeStd
  features['volatility.rolling_std_pct'] = closeMean > 0 ? closeStd / closeMean : null

  // §11 — EWMA Volatility (lambda = 0.94, RiskMetrics standard)
  const lambda = 0.94
  let ewmaVar = 0
  for (let i = 0; i < logReturns.length; i++) {
    ewmaVar = lambda * ewmaVar + (1 - lambda) * logReturns[i] ** 2
  }
  features['volatility.ewma'] = Math.sqrt(ewmaVar) * Math.sqrt(252)

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend + Momentum Features
// ─────────────────────────────────────────────────────────────────────────────

export function extractTrendMomentumFeatures(candles: CanonicalCandle[]): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (candles.length < 30) return features

  const closes = candles.map((c) => c.close)

  // EMA 50
  const ema50 = emaForPeriod(50)
  for (const c of closes) ema50.update(c)
  features['trend.ema50'] = ema50.value
  features['trend.ema50_distance'] = ema50.value !== null ? (closes[closes.length - 1] - ema50.value) / ema50.value : null

  // EMA 200
  const ema200 = emaForPeriod(200)
  for (const c of closes) ema200.update(c)
  features['trend.ema200'] = ema200.value
  features['trend.ema50_above_ema200'] = ema50.value !== null && ema200.value !== null ? ema50.value > ema200.value : null

  // RSI (14)
  const rsiPeriod = 14
  let gains = 0, losses = 0
  for (let i = closes.length - rsiPeriod; i < closes.length; i++) {
    if (i > 0) {
      const diff = closes[i] - closes[i - 1]
      if (diff >= 0) gains += diff
      else losses -= diff
    }
  }
  const avgGain = gains / rsiPeriod
  const avgLoss = losses / rsiPeriod
  features['momentum.rsi'] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  // MACD
  const ema12 = emaForPeriod(12)
  const ema26 = emaForPeriod(26)
  for (const c of closes) { ema12.update(c); ema26.update(c) }
  const macd = ema12.value !== null && ema26.value !== null ? ema12.value - ema26.value : null
  features['momentum.macd'] = macd

  // Stochastic RSI K
  const rsi = features['momentum.rsi'] as number
  features['momentum.stoch_rsi_k'] = rsi / 100

  return features
}
