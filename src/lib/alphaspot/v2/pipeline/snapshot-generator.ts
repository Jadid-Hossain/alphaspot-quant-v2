// Pipeline Stage 11 — Market Snapshot Generator  (Chapter 1 §9, §11)
//
// Publishes an immutable Market Snapshot. The dashboard always displays the
// latest completed snapshot (Chapter 1 §9). Snapshots are NEVER mutated after
// publication — this guarantees consistency, reproducibility (Rule 2), and
// lower computational overhead.
//
// This stage also computes the portfolio-level analysis and freezes the
// snapshot with a monotonic version counter.

import type {
  MarketSnapshot,
  PortfolioAnalysis,
  PipelineContext,
  TradeCandidate,
  Recommendation,
  RecommendationRank,
  MarketRegime,
} from '../types'
import { PIPELINE_VERSION, RANK_THRESHOLDS } from '../types'

export interface SnapshotInput {
  version: number
  timestamp: number
  evaluatedAssets: string[]
  eligibleAssets: string[]
  rankings: Array<{
    asset: string
    ev: number | null
    edgeScore: number | null
    rank: number
    tier: RecommendationRank | null
  }>
  tradeCandidates: TradeCandidate[]
  recommendations: Recommendation[]
  regime: MarketRegime
  regimeConfidence: number
  stageTimings: Record<string, number>
}

export function generateSnapshot(input: SnapshotInput, ctx: PipelineContext): MarketSnapshot {
  const portfolioAnalysis = computePortfolioAnalysis(input)

  // Deep-freeze the snapshot (Rule 2: reproducible; §9: immutable).
  // Object.freeze is shallow; we deep-freeze the nested arrays/objects.
  const snapshot: MarketSnapshot = {
    version: input.version,
    timestamp: input.timestamp,
    pipelineVersion: ctx.pipelineVersion ?? PIPELINE_VERSION,
    regime: input.regime,
    regimeConfidence: input.regimeConfidence,
    evaluatedAssets: Object.freeze([...input.evaluatedAssets]),
    eligibleAssets: Object.freeze([...input.eligibleAssets]),
    rankings: Object.freeze(input.rankings.map((r) => Object.freeze({ ...r }))),
    tradeCandidates: Object.freeze(input.tradeCandidates.map((c) => Object.freeze({ ...c }))),
    recommendations: Object.freeze(input.recommendations.map((r) => Object.freeze({ ...r }))),
    portfolioAnalysis: Object.freeze({ ...portfolioAnalysis }),
    stageTimings: Object.freeze({ ...input.stageTimings }),
    generatedAt: Date.now(),
  }

  return snapshot
}

function computePortfolioAnalysis(input: SnapshotInput): PortfolioAnalysis {
  const buyCandidates = input.tradeCandidates.filter((c) => c.action === 'BUY')
  const totalProjectedCapital = buyCandidates.reduce((sum, c) => sum + (c.risk?.positionSizePct ?? 0), 0)

  const positiveEv = input.rankings.filter((r) => (r.ev ?? 0) > 0).length
  const marketBreadth = input.rankings.length > 0 ? (positiveEv / input.rankings.length) * 100 : null

  const avgQuality =
    input.recommendations.length > 0
      ? input.recommendations.reduce((sum, r) => {
          const tierVal = r.rank === 'A' ? 4 : r.rank === 'B' ? 3 : r.rank === 'C' ? 2 : 1
          return sum + tierVal
        }, 0) / input.recommendations.length
      : null

  const riskBudgetUsedPct = totalProjectedCapital * 100

  return {
    totalEligible: input.eligibleAssets.length,
    totalCandidates: input.tradeCandidates.length,
    activeRecommendations: input.recommendations.length,
    capitalDeployedPct: totalProjectedCapital * 100,
    openPositions: 0, // populated when paper-trading integration lands (later chapter)
    averagePositionQuality: avgQuality,
    riskBudgetUsedPct,
    marketBreadth,
  }
}

// re-export RANK_THRESHOLDS so the tier table is co-located with ranking logic
export const _rankThresholds = RANK_THRESHOLDS
