// Pipeline Stage 10 — Ranking Engine  (Chapter 1 §4, Principle 4, §11)
//
// Rank every eligible asset by statistical quality. Every asset competes
// against every other eligible asset (Principle 4). The ranking is what
// the dashboard displays and what drives the "is this better than the
// other 440 coins?" question (Chapter 1 §1).
//
// Output: an array of { asset, ev, edgeScore, rank, tier } sorted by rank.
// Tier A = strongest, D = weakest.

import type {
  Asset,
  ExpectedValue,
  RecommendationRank,
  PipelineContext,
  StatisticalMetrics,
  TradeCandidate,
} from '../types'
import { RANK_THRESHOLDS } from '../types'

export interface RankingEntry {
  asset: Asset
  ev: number | null
  edgeScore: number | null
  rank: number
  tier: RecommendationRank | null
}

export function runRankingEngine(
  candidates: TradeCandidate[],
  evs: Map<Asset, ExpectedValue>,
  statistics: Map<Asset, StatisticalMetrics>,
  _ctx: PipelineContext,
): RankingEntry[] {
  // Build entries from EV + edge score
  const entries: RankingEntry[] = []
  for (const [asset, ev] of evs) {
    const s = statistics.get(asset)
    entries.push({
      asset,
      ev: ev.ev,
      edgeScore: s?.edgeScore ?? null,
      rank: 0,
      tier: null,
    })
  }

  // Sort by EV descending (primary), edge score (secondary)
  entries.sort((a, b) => {
    const evDiff = (b.ev ?? -Infinity) - (a.ev ?? -Infinity)
    if (Math.abs(evDiff) > 0.01) return evDiff
    return (b.edgeScore ?? -1) - (a.edgeScore ?? -1)
  })

  // Assign rank + tier
  entries.forEach((e, i) => {
    e.rank = i + 1
    e.tier = assignTier(e.ev ?? 0, statistics.get(e.asset)?.confidence ?? 0, e.edgeScore ?? 0)
  })

  console.log(
    `[pipeline:ranking-engine] ranked ${entries.length} assets. Top 3: ${entries.slice(0, 3).map((e) => `${e.asset.split('/')[0]}(EV ${e.ev?.toFixed(0)}, ${e.tier})`).join(', ')}`,
  )
  return entries
}

function assignTier(ev: number, confidence: number, edge: number): RecommendationRank | null {
  // Must meet ALL thresholds for a tier (highest tier wins)
  if (ev >= RANK_THRESHOLDS.A.minEv && confidence >= RANK_THRESHOLDS.A.minConfidence && edge >= RANK_THRESHOLDS.A.minEdge) return 'A'
  if (ev >= RANK_THRESHOLDS.B.minEv && confidence >= RANK_THRESHOLDS.B.minConfidence && edge >= RANK_THRESHOLDS.B.minEdge) return 'B'
  if (ev >= RANK_THRESHOLDS.C.minEv && confidence >= RANK_THRESHOLDS.C.minConfidence && edge >= RANK_THRESHOLDS.C.minEdge) return 'C'
  if (ev >= RANK_THRESHOLDS.D.minEv && confidence >= RANK_THRESHOLDS.D.minConfidence && edge >= RANK_THRESHOLDS.D.minEdge) return 'D'
  return null
}
