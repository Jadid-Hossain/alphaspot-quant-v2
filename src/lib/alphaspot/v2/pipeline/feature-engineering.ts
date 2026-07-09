// Pipeline Stage 3 — Feature Engineering  (Chapter 1 §6, §11)
//
// Generate market intelligence from raw Lane A data. Wraps the V1 indicator
// and pattern libraries plus derived structural features (momentum, volatility,
// trend alignment, liquidity).
//
// Chapter 1 mandates the stage exists and operates only on ELIGIBLE assets.
// The exact feature set will be expanded by later MDS chapters; here we wire
// the V1 indicators/patterns and derive the structural features mentioned in
// Chapter 1 §7-B (momentum, volatility behavior).

import type {
  Asset,
  EngineeredFeatures,
  PipelineContext,
} from '../types'
import type { Timeframe, Indicators, Patterns } from '../../types'
import { computeIndicators } from '../../indicators'
import { detectPatterns } from '../../patterns'
import { LaneA } from '../lanes/lane-a-realtime'

const PRIMARY_TF: Timeframe = '15m'

/**
 * Engineer features for every eligible asset. Returns a Map keyed by asset.
 * Assets with insufficient data are silently skipped (they already failed
 * structural validation, but we defend in depth).
 */
export async function runFeatureEngineering(
  eligibleAssets: Asset[],
  _ctx: PipelineContext,
): Promise<Map<Asset, EngineeredFeatures>> {
  const out = new Map<Asset, EngineeredFeatures>()

  for (const asset of eligibleAssets) {
    const candles = LaneA.getCandles(asset, PRIMARY_TF)
    if (!candles || candles.length < 30) continue

    const indicators: Indicators = computeIndicators(candles)
    const patterns: Patterns = detectPatterns(candles)

    // Derived structural features (Chapter 1 §7-B)
    const momentumScore = deriveMomentumScore(indicators)
    const volatilityScore = deriveVolatilityScore(indicators)
    const trendAlignment = deriveTrendAlignment(asset, indicators)
    const liquidityScore = deriveLiquidityScore(asset)

    out.set(asset, {
      asset,
      timeframe: PRIMARY_TF,
      candles: candles.slice(-200),
      indicators,
      patterns,
      momentumScore,
      volatilityScore,
      trendAlignment,
      liquidityScore,
      computedAt: Date.now(),
    })
  }

  console.log(`[pipeline:feature-engineering] ${out.size}/${eligibleAssets.length} assets featured`)
  return out
}

/** Momentum score: -1 (bearish) .. +1 (bullish) from RSI + MACD + StochRSI. */
function deriveMomentumScore(ind: Indicators): number | null {
  let score = 0
  let parts = 0
  if (ind.rsi != null) {
    // RSI 50 = neutral, 30 = oversold-bullish-reversal, 70 = overbought
    score += (ind.rsi - 50) / 50
    parts++
  }
  if (ind.macdHist != null) {
    // MACD histogram sign + magnitude (normalize crudely)
    score += Math.max(-1, Math.min(1, ind.macdHist / Math.max(1, Math.abs(ind.macd ?? 1))))
    parts++
  }
  if (ind.stochRsiK != null) {
    score += (ind.stochRsiK - 50) / 50
    parts++
  }
  return parts > 0 ? Math.max(-1, Math.min(1, score / parts)) : null
}

/** Volatility score: 0 (calm) .. 1 (extreme) from ATR / BB width. */
function deriveVolatilityScore(ind: Indicators): number | null {
  if (ind.bbUpper != null && ind.bbLower != null && ind.bbMiddle != null && ind.bbMiddle > 0) {
    const width = (ind.bbUpper - ind.bbLower) / ind.bbMiddle
    // Typical BB width for crypto is 2-10%; map 0..15% to 0..1
    return Math.max(0, Math.min(1, width / 0.15))
  }
  return null
}

/** Trend alignment: -1 (all bearish) .. +1 (all bullish) across 15m/1h/4h. */
function deriveTrendAlignment(asset: Asset, ind15: Indicators): number | null {
  const tf1h = LaneA.getCandles(asset, '1h')
  const tf4h = LaneA.getCandles(asset, '4h')
  let score = 0
  let parts = 0
  for (const ind of [ind15, tf1h ? computeIndicators(tf1h) : null, tf4h ? computeIndicators(tf4h) : null]) {
    if (ind?.ema50 != null && ind?.ema200 != null) {
      score += ind.ema50 > ind.ema200 ? 1 : -1
      parts++
    }
  }
  return parts > 0 ? score / parts : null
}

/** Liquidity score: 0..1 from 24h quote volume (log-scaled). */
function deriveLiquidityScore(asset: Asset): number | null {
  const stats = LaneA.get24hStats(asset)
  const qv = stats?.quoteVolume
  if (qv == null || qv <= 0) return null
  // $100k → 0, $1M → ~0.5, $100M → ~0.85, $1B → ~0.95
  return Math.max(0, Math.min(1, Math.log10(qv) / 10))
}
