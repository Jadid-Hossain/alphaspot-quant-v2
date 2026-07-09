// Pipeline Stage 4 — Market Context Analysis  (Chapter 1 §5, §7-B, Principle 5)
//
// Determine the market regime, volatility, liquidity, structure, and relative
// strength for every eligible asset. No recommendation may ignore market
// context (Principle 5).
//
// Chapter 1 mandates the stage and the dimensions it must cover. The exact
// regime-classification algorithm will be specified in a later MDS chapter;
// here we implement a robust first-principles classifier using the engineered
// features + Lane A data.

import type {
  Asset,
  MarketContext,
  MarketRegime,
  PipelineContext,
  EngineeredFeatures,
} from '../types'
import { LaneA } from '../lanes/lane-a-realtime'

export async function runMarketContext(
  eligibleAssets: Asset[],
  features: Map<Asset, EngineeredFeatures>,
  _ctx: PipelineContext,
): Promise<Map<Asset, MarketContext>> {
  const out = new Map<Asset, MarketContext>()

  // Compute market-wide relative strength baseline (median momentum)
  const momenta: number[] = []
  for (const f of features.values()) if (f.momentumScore != null) momenta.push(f.momentumScore)
  momenta.sort((a, b) => a - b)
  const medianMomentum = momenta.length > 0 ? momenta[Math.floor(momenta.length / 2)] : 0

  for (const asset of eligibleAssets) {
    const f = features.get(asset)
    if (!f) continue
    const ind = f.indicators
    const stats = LaneA.get24hStats(asset)
    const ob = LaneA.getOrderBook(asset)

    // Regime classification (first principles)
    const regime = classifyRegime(f)
    const regimeConfidence = regimeConfidence(f, regime)

    // Volatility
    const volatilityPct = f.volatilityScore != null ? f.volatilityScore * 100 : null
    const volatilityRank = f.volatilityScore

    // Liquidity
    const liquidityScore = f.liquidityScore

    // Spread (approximate from order book imbalance — proxy)
    const spreadPct = ob ? Math.abs(ob.imbalance) * 0.1 : null

    // Market structure
    const marketStructure = classifyStructure(ind)

    // Relative strength vs market median
    const relativeStrength =
      f.momentumScore != null
        ? Math.max(0, Math.min(1, 0.5 + (f.momentumScore - medianMomentum) / 2))
        : null

    out.set(asset, {
      regime,
      regimeConfidence,
      volatilityPct,
      volatilityRank,
      liquidityScore,
      spreadPct,
      marketStructure,
      relativeStrength,
      statisticalEdge: null, // filled by statistical evaluation stage
    })
  }

  console.log(`[pipeline:market-context] ${out.size} assets contextualized`)
  return out
}

function classifyRegime(f: EngineeredFeatures): MarketRegime {
  const vol = f.volatilityScore ?? 0.3
  const mom = f.momentumScore ?? 0
  const trend = f.trendAlignment ?? 0

  if (vol > 0.7) return 'HIGH_VOLATILITY'
  if (vol < 0.15) return 'LOW_VOLATILITY'
  if (Math.abs(mom) < 0.15 && Math.abs(trend) < 0.25) return 'RANGING'
  if (mom > 0.25 && trend > 0.25) return 'TRENDING_UP'
  if (mom < -0.25 && trend < -0.25) return 'TRENDING_DOWN'
  return 'TRANSITIONAL'
}

function regimeConfidence(f: EngineeredFeatures, regime: MarketRegime): number {
  // Higher confidence when momentum + trend agree strongly
  const mom = Math.abs(f.momentumScore ?? 0)
  const trend = Math.abs(f.trendAlignment ?? 0)
  const agreement = (mom + trend) / 2
  if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') return Math.min(1, 0.4 + agreement)
  if (regime === 'RANGING') return Math.min(1, 0.4 + (1 - agreement))
  if (regime === 'HIGH_VOLATILITY' || regime === 'LOW_VOLATILITY') {
    const vol = f.volatilityScore ?? 0.5
    return Math.min(1, 0.4 + Math.abs(vol - 0.5) * 1.2)
  }
  return 0.3 // TRANSITIONAL / UNKNOWN — low confidence
}

function classifyStructure(ind: import('../../types').Indicators): 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' {
  if (ind.ema50 == null || ind.ema200 == null) return 'NEUTRAL'
  const above = ind.ema50 > ind.ema200
  const macdBull = ind.macdHist != null && ind.macdHist > 0
  const rsiBull = ind.rsi != null && ind.rsi > 50
  const bullSignals = (above ? 1 : 0) + (macdBull ? 1 : 0) + (rsiBull ? 1 : 0)
  if (bullSignals >= 3) return 'BULLISH'
  if (bullSignals === 0) return 'BEARISH'
  return 'MIXED'
}
