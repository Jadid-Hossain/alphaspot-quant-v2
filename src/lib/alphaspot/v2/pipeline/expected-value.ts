// Pipeline Stage 6 — Expected Value Estimation  (Chapter 1 §7-B, §11)
//
// Synthesize statistical + context factors into a unified Expected Value
// assessment. This is the single number that drives ranking.
//
// EV = (probabilityOfSuccess × expectedReward) − ((1 − probabilityOfSuccess) × expectedRisk)
//
// Every component is traceable (Principle 6: explainable, Rule 4: measurable).

import type {
  Asset,
  ExpectedValue,
  ExpectedValueComponent,
  PipelineContext,
  EngineeredFeatures,
  MarketContext,
  StatisticalMetrics,
} from '../types'

export async function runExpectedValue(
  eligibleAssets: Asset[],
  features: Map<Asset, EngineeredFeatures>,
  contexts: Map<Asset, MarketContext>,
  statistics: Map<Asset, StatisticalMetrics>,
  _ctx: PipelineContext,
): Promise<Map<Asset, ExpectedValue>> {
  const out = new Map<Asset, ExpectedValue>()

  for (const asset of eligibleAssets) {
    const f = features.get(asset)
    const c = contexts.get(asset)
    const s = statistics.get(asset)
    if (!f || !c || !s) continue

    const components: ExpectedValueComponent[] = []

    // ── Component 1: Statistical edge ────────────────────────────────
    const statEdge = s.edgeScore ?? 0
    components.push({
      key: 'statistical_edge',
      label: 'Statistical Edge',
      contribution: statEdge * 40,
      detail: `Edge score ${(statEdge * 100).toFixed(1)}/100 from ${s.evidenceCount} evidence sources (P=${(s.probabilityOfSuccess ?? 0).toFixed(2)}).`,
    })

    // ── Component 2: Expected return vs drawdown ─────────────────────
    const ret = s.expectedReturnPct ?? 0
    const dd = s.expectedDrawdownPct ?? 0
    const evRaw = ret + dd // ret is positive (favorable), dd is negative (cost)
    components.push({
      key: 'return_minus_drawdown',
      label: 'Expected Return − Drawdown',
      contribution: evRaw * 10,
      detail: `Expected return ${ret.toFixed(2)}% vs expected drawdown ${dd.toFixed(2)}%.`,
    })

    // ── Component 3: Regime alignment ────────────────────────────────
    const regimeAligned = c.regime === 'TRENDING_UP' || c.regime === 'LOW_VOLATILITY'
    const regimeMisaligned = c.regime === 'TRENDING_DOWN' || c.regime === 'HIGH_VOLATILITY'
    const regimeContribution = regimeAligned ? 15 : regimeMisaligned ? -20 : 0
    components.push({
      key: 'regime_alignment',
      label: 'Regime Alignment',
      contribution: regimeContribution,
      detail: `Current regime ${c.regime} (confidence ${(c.regimeConfidence * 100).toFixed(0)}%). ${regimeAligned ? 'Favorable for longs.' : regimeMisaligned ? 'Unfavorable for longs.' : 'Neutral.'}`,
    })

    // ── Component 4: Relative strength ───────────────────────────────
    if (c.relativeStrength != null) {
      const rs = (c.relativeStrength - 0.5) * 20
      components.push({
        key: 'relative_strength',
        label: 'Relative Strength',
        contribution: rs,
        detail: `Relative strength ${(c.relativeStrength * 100).toFixed(0)}/100 vs the broader market.`,
      })
    }

    // ── Component 5: Trend alignment (macro) ─────────────────────────
    if (f.trendAlignment != null) {
      const ta = f.trendAlignment * 15
      components.push({
        key: 'trend_alignment',
        label: 'Multi-Timeframe Trend',
        contribution: ta,
        detail: `Trend alignment ${f.trendAlignment.toFixed(2)} across 15m/1h/4h.`,
      })
    }

    // ── Component 6: Liquidity quality ───────────────────────────────
    if (f.liquidityScore != null) {
      const liq = (f.liquidityScore - 0.5) * 10
      components.push({
        key: 'liquidity',
        label: 'Liquidity Quality',
        contribution: liq,
        detail: `Liquidity score ${(f.liquidityScore * 100).toFixed(0)}/100.`,
      })
    }

    // ── Component 7: Sample confidence penalty ───────────────────────
    const confPenalty = (1 - (s.confidence ?? 0.5)) * -15
    components.push({
      key: 'confidence_penalty',
      label: 'Confidence Penalty',
      contribution: confPenalty,
      detail: `Model confidence ${(s.confidence * 100).toFixed(0)}% — penalizing uncertainty.`,
    })

    // ── Synthesize ───────────────────────────────────────────────────
    let ev = 0
    for (const comp of components) ev += comp.contribution
    ev = Math.round(ev * 100) / 100

    const evPercent = ev / 10 // convert to a rough % of capital
    const regimeAlignment =
      c.regime === 'TRENDING_UP' ? 0.8 :
      c.regime === 'LOW_VOLATILITY' ? 0.5 :
      c.regime === 'TRENDING_DOWN' ? -0.8 :
      c.regime === 'HIGH_VOLATILITY' ? -0.5 : 0

    out.set(asset, {
      asset,
      ev,
      evPercent,
      components,
      confidence: s.confidence,
      regimeAlignment,
    })
  }

  console.log(`[pipeline:expected-value] ${out.size} assets valued`)
  return out
}
