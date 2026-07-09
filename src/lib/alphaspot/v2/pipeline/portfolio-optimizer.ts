// Pipeline Stage 8 — Portfolio Optimization  (Chapter 1 §11, Principle 4)
//
// Evaluate candidates in a PORTFOLIO context. No asset is evaluated in
// isolation — every candidate competes against every other (Principle 4).
//
// Responsibilities:
//   • Apply portfolio-level risk budget (don't over-allocate to correlated assets)
//   • Cap total concurrent positions
//   • Cap capital deployment
//   • Promote the strongest candidates, demote the weakest
//
// This stage mutates candidate.stage → 'PORTFOLIO_OPTIMIZATION' and may
// downgrade action (BUY → WATCH) for candidates that lose the portfolio
// competition. It NEVER publishes (Rule 1).

import type { TradeCandidate, PipelineContext } from '../types'

const MAX_CONCURRENT_BUY_CANDIDATES = 8
const MAX_TOTAL_POSITION_PCT = 0.6 // 60% of capital deployed max
const MIN_EV_FOR_BUY = 15

export async function runPortfolioOptimization(
  candidates: TradeCandidate[],
  _ctx: PipelineContext,
): Promise<TradeCandidate[]> {
  if (candidates.length === 0) return []

  // Sort by EV descending — strongest first
  const ranked = [...candidates].sort(
    (a, b) => (b.expectedValue?.ev ?? -Infinity) - (a.expectedValue?.ev ?? -Infinity),
  )

  let buySlots = 0
  let projectedCapitalPct = 0
  const out: TradeCandidate[] = []

  for (const c of ranked) {
    const ev = c.expectedValue?.ev ?? 0
    const sizePct = c.risk?.positionSizePct ?? 0

    if (c.action === 'BUY') {
      // Portfolio-level gates
      if (ev < MIN_EV_FOR_BUY) {
        // Downgrade: too weak after portfolio context
        out.push({
          ...c,
          action: 'WATCH',
          stage: 'PORTFOLIO_OPTIMIZATION',
          rationale: `${c.rationale} [Portfolio: downgraded to WATCH — EV ${ev.toFixed(1)} below portfolio threshold ${MIN_EV_FOR_BUY}.]`,
        })
        continue
      }
      if (buySlots >= MAX_CONCURRENT_BUY_CANDIDATES) {
        out.push({
          ...c,
          action: 'WATCH',
          stage: 'PORTFOLIO_OPTIMIZATION',
          rationale: `${c.rationale} [Portfolio: downgraded to WATCH — max ${MAX_CONCURRENT_BUY_CANDIDATES} concurrent buy candidates reached.]`,
        })
        continue
      }
      if (projectedCapitalPct + sizePct > MAX_TOTAL_POSITION_PCT) {
        out.push({
          ...c,
          action: 'WATCH',
          stage: 'PORTFOLIO_OPTIMIZATION',
          rationale: `${c.rationale} [Portfolio: downgraded to WATCH — capital budget ${(MAX_TOTAL_POSITION_PCT * 100).toFixed(0)}% would be exceeded.]`,
        })
        continue
      }
      buySlots++
      projectedCapitalPct += sizePct
      out.push({ ...c, stage: 'PORTFOLIO_OPTIMIZATION' })
    } else {
      out.push({ ...c, stage: 'PORTFOLIO_OPTIMIZATION' })
    }
  }

  console.log(
    `[pipeline:portfolio-optimization] ${out.length} candidates: ${out.filter((c) => c.action === 'BUY').length} BUY, ${out.filter((c) => c.action === 'WATCH').length} WATCH, capital ${(projectedCapitalPct * 100).toFixed(1)}% projected`,
  )
  return out
}
