// Pipeline Stage 5 — Statistical Evaluation  (Chapter 1 §7-B, §11)
//
// Probabilistic evaluation of eligible assets. Produces probability estimates,
// expected return/drawdown, confidence, and a synthesized edge score.
//
// Chapter 1 §7-B lists the statistical evidence: probability estimates,
// expected return, expected drawdown, confidence estimation, market regime
// alignment, relative strength, volatility behavior, momentum.
//
// The exact probability model will be specified in a later MDS chapter.
// Here we implement a transparent, multi-evidence synthesis that converts the
// engineered features + market context into probabilistic metrics. Every
// output is traceable to its inputs (Rule 4: measurable).

import type {
  Asset,
  StatisticalMetrics,
  PipelineContext,
  EngineeredFeatures,
  MarketContext,
} from '../types'

export async function runStatisticalEvaluation(
  eligibleAssets: Asset[],
  features: Map<Asset, EngineeredFeatures>,
  contexts: Map<Asset, MarketContext>,
  _ctx: PipelineContext,
): Promise<Map<Asset, StatisticalMetrics>> {
  const out = new Map<Asset, StatisticalMetrics>()

  for (const asset of eligibleAssets) {
    const f = features.get(asset)
    const c = contexts.get(asset)
    if (!f || !c) continue

    const ind = f.indicators

    // ── Probability of success: synthesized from multiple evidence sources ──
    // (Principle 3: no recommendation from a single indicator)
    const evidence: { name: string; p: number; weight: number }[] = []

    // Evidence 1: RSI mean-reversion (oversold → bounce probability)
    if (ind.rsi != null) {
      if (ind.rsi < 30) evidence.push({ name: 'rsi_oversold', p: 0.62, weight: 1.0 })
      else if (ind.rsi > 70) evidence.push({ name: 'rsi_overbought', p: 0.38, weight: 0.8 })
      else evidence.push({ name: 'rsi_neutral', p: 0.5, weight: 0.3 })
    }

    // Evidence 2: MACD momentum
    if (ind.macdHist != null) {
      const p = 0.5 + Math.max(-0.15, Math.min(0.15, ind.macdHist / 200))
      evidence.push({ name: 'macd_momentum', p, weight: 0.9 })
    }

    // Evidence 3: trend alignment (macro trend filter — never fight the daily)
    if (f.trendAlignment != null) {
      evidence.push({ name: 'trend_alignment', p: 0.5 + f.trendAlignment * 0.2, weight: 1.2 })
    }

    // Evidence 4: market regime alignment
    const regimeBullish = c.regime === 'TRENDING_UP' || c.regime === 'LOW_VOLATILITY'
    const regimeBearish = c.regime === 'TRENDING_DOWN' || c.regime === 'HIGH_VOLATILITY'
    if (regimeBullish) evidence.push({ name: 'regime_bullish', p: 0.58, weight: 0.7 })
    else if (regimeBearish) evidence.push({ name: 'regime_bearish', p: 0.42, weight: 0.7 })

    // Evidence 5: relative strength
    if (c.relativeStrength != null) {
      evidence.push({ name: 'relative_strength', p: 0.5 + (c.relativeStrength - 0.5) * 0.4, weight: 0.6 })
    }

    // Evidence 6: candlestick pattern
    if (f.patterns.bullish.length > 0) evidence.push({ name: 'bullish_pattern', p: 0.6, weight: 0.8 })
    if (f.patterns.bearish.length > 0) evidence.push({ name: 'bearish_pattern', p: 0.4, weight: 0.8 })

    // Weighted average → probability of success
    let wsum = 0
    let psum = 0
    for (const e of evidence) {
      wsum += e.weight
      psum += e.p * e.weight
    }
    const probabilityOfSuccess = wsum > 0 ? Math.max(0.05, Math.min(0.95, psum / wsum)) : 0.5

    // Expected return: scaled by volatility + edge
    const baseMove = (c.volatilityPct ?? 2) * 0.5 // half a volatility unit
    const expectedReturnPct = (probabilityOfSuccess - 0.5) * 2 * baseMove

    // Expected drawdown: adverse excursion estimate
    const expectedDrawdownPct = -(c.volatilityPct ?? 2) * 0.3

    // Confidence: how much the evidence agrees (entropy-based proxy)
    const probs = evidence.map((e) => e.p)
    const avgP = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0.5
    const variance = probs.length ? probs.reduce((a, p) => a + (p - avgP) ** 2, 0) / probs.length : 0
    const confidence = Math.max(0.1, Math.min(0.95, 0.8 - variance * 4))

    // Edge score: |probabilityOfSuccess - 0.5| scaled, then refined by confidence
    const edgeScore = Math.max(0, Math.min(1, Math.abs(probabilityOfSuccess - 0.5) * 2 * confidence))

    // Sample quality: proxy from liquidity + history depth
    const sampleQuality = Math.max(0, Math.min(1, (f.liquidityScore ?? 0) * 0.7 + 0.3))

    out.set(asset, {
      asset,
      probabilityOfSuccess,
      expectedReturnPct,
      expectedDrawdownPct,
      confidence,
      edgeScore,
      sampleQuality,
      evidenceCount: evidence.length,
    })
  }

  console.log(`[pipeline:statistical-evaluation] ${out.size} assets evaluated`)
  return out
}
