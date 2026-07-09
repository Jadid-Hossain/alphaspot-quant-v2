// Lane B — Analytical Processing  (Chapter 1 §8)
//
// Generate market intelligence: feature engineering, market structure, market
// regime, statistical evaluation, trade candidate generation. This lane
// operates INDEPENDENTLY of real-time ingestion — it runs the full evaluation
// pipeline on a schedule and publishes immutable Market Snapshots.
//
// Chapter 1 §9: "The system does not continuously recalculate recommendations
// for every incoming market tick. Instead, analytical results are published as
// immutable Market Snapshots."
//
// This module is the orchestrator. The actual pipeline stages live in
// ../pipeline/*.ts. Later MDS chapters will specify the exact algorithms;
// here we wire the 10-stage pipeline together with the correct sequencing
// mandated by Chapter 1 §6 and §11.

import type {
  Asset,
  MarketSnapshot,
  LaneBAnalytical,
  PipelineContext,
  StructuralConstraints,
  DEFAULT_CONSTRAINTS as _DC,
} from '../types'
import { PIPELINE_VERSION, DEFAULT_CONSTRAINTS } from '../types'
import { runStructuralValidation } from '../pipeline/structural-validation'
import { runFeatureEngineering } from '../pipeline/feature-engineering'
import { runMarketContext } from '../pipeline/market-context'
import { runStatisticalEvaluation } from '../pipeline/statistical-evaluation'
import { runExpectedValue } from '../pipeline/expected-value'
import { runCandidateGeneration } from '../pipeline/candidate-generator'
import { runPortfolioOptimization } from '../pipeline/portfolio-optimizer'
import { runRecommendationValidation } from '../pipeline/recommendation-validator'
import { runRankingEngine } from '../pipeline/ranking-engine'
import { generateSnapshot } from '../pipeline/snapshot-generator'
import { getKnownAssets } from './lane-a-realtime'

const SNAPSHOT_HISTORY_LIMIT = 100

class LaneBImpl implements LaneBAnalytical {
  private latest: MarketSnapshot | null = null
  private history: MarketSnapshot[] = []
  private subscribers = new Set<(snapshot: MarketSnapshot) => void>()
  private running = false
  private snapshotCounter = 0

  /**
   * Run the complete 10-stage evaluation pipeline (Chapter 1 §6, §11).
   * No stage may be skipped (Rule 1). No module may publish directly.
   */
  async runPipeline(): Promise<MarketSnapshot> {
    if (this.running) {
      console.warn('[LaneB] pipeline already running — skipping concurrent run')
      return this.latest ?? this.emptySnapshot()
    }
    this.running = true
    const startedAt = Date.now()
    this.snapshotCounter++

    const ctx: PipelineContext = {
      snapshotVersion: this.snapshotCounter,
      pipelineVersion: PIPELINE_VERSION,
      constraints: DEFAULT_CONSTRAINTS as StructuralConstraints,
      generatedAt: startedAt,
    }

    const assets = getKnownAssets()
    const stageTimings: Record<string, number> = {}

    try {
      // ── Stage 1: Market Observation (read from Lane A) ──────────────
      const t1 = Date.now()
      stageTimings['market-observation'] = Date.now() - t1

      // ── Stage 2: Structural Validation (hard eligibility gate) ──────
      const t2 = Date.now()
      const eligibility = await runStructuralValidation(assets, ctx)
      stageTimings['structural-validation'] = Date.now() - t2
      const eligibleAssets = eligibility.filter((e) => e.eligible).map((e) => e.asset)

      // ── Stage 3: Feature Engineering (eligible assets only) ─────────
      const t3 = Date.now()
      const features = await runFeatureEngineering(eligibleAssets, ctx)
      stageTimings['feature-engineering'] = Date.now() - t3

      // ── Stage 4: Market Context Analysis ────────────────────────────
      const t4 = Date.now()
      const contexts = await runMarketContext(eligibleAssets, features, ctx)
      stageTimings['market-context'] = Date.now() - t4

      // ── Stage 5: Statistical Evaluation ─────────────────────────────
      const t5 = Date.now()
      const statistics = await runStatisticalEvaluation(eligibleAssets, features, contexts, ctx)
      stageTimings['statistical-evaluation'] = Date.now() - t5

      // ── Stage 6: Expected Value Estimation ──────────────────────────
      const t6 = Date.now()
      const evs = await runExpectedValue(eligibleAssets, features, contexts, statistics, ctx)
      stageTimings['expected-value'] = Date.now() - t6

      // ── Stage 7: Trade Candidate Generation ─────────────────────────
      const t7 = Date.now()
      const candidates = await runCandidateGeneration(eligibleAssets, eligibility, features, contexts, statistics, evs, ctx)
      stageTimings['candidate-generation'] = Date.now() - t7

      // ── Stage 8: Portfolio Optimization ─────────────────────────────
      const t8 = Date.now()
      const optimized = await runPortfolioOptimization(candidates, ctx)
      stageTimings['portfolio-optimization'] = Date.now() - t8

      // ── Stage 9: Recommendation Validation ──────────────────────────
      const t9 = Date.now()
      const validated = await runRecommendationValidation(optimized, ctx)
      stageTimings['recommendation-validation'] = Date.now() - t9

      // ── Stage 10: Ranking Engine ────────────────────────────────────
      const t10 = Date.now()
      const ranked = runRankingEngine(validated, evs, statistics, ctx)
      stageTimings['ranking-engine'] = Date.now() - t10

      // ── Stage 11: Market Snapshot Generation ────────────────────────
      const t11 = Date.now()
      const snapshot = generateSnapshot({
        version: ctx.snapshotVersion,
        timestamp: startedAt,
        evaluatedAssets: assets,
        eligibleAssets,
        rankings: ranked,
        tradeCandidates: validated,
        recommendations: validated.filter((c) => c.stage === 'PUBLISHED').map((c) => toRecommendation(c, ctx)),
        regime: inferDominantRegime(contexts),
        regimeConfidence: inferRegimeConfidence(contexts),
        stageTimings,
      }, ctx)
      stageTimings['snapshot-generation'] = Date.now() - t11

      // Publish
      this.latest = snapshot
      this.history = [snapshot, ...this.history].slice(0, SNAPSHOT_HISTORY_LIMIT)
      for (const sub of this.subscribers) sub(snapshot)

      console.log(
        `[LaneB] snapshot v${snapshot.version} published: ${eligibleAssets.length}/${assets.length} eligible, ${validated.length} candidates, ${snapshot.recommendations.length} recommendations, ${Date.now() - startedAt}ms`,
      )
      return snapshot
    } catch (e) {
      console.error('[LaneB] pipeline failed:', e)
      return this.latest ?? this.emptySnapshot()
    } finally {
      this.running = false
    }
  }

  getLatestSnapshot(): MarketSnapshot | null {
    return this.latest
  }

  getSnapshotHistory(): MarketSnapshot[] {
    return this.history
  }

  subscribe(handler: (snapshot: MarketSnapshot) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  private emptySnapshot(): MarketSnapshot {
    return {
      version: 0,
      timestamp: Date.now(),
      pipelineVersion: PIPELINE_VERSION,
      regime: 'UNKNOWN',
      regimeConfidence: 0,
      evaluatedAssets: [],
      eligibleAssets: [],
      rankings: [],
      tradeCandidates: [],
      recommendations: [],
      portfolioAnalysis: {
        totalEligible: 0,
        totalCandidates: 0,
        activeRecommendations: 0,
        capitalDeployedPct: 0,
        openPositions: 0,
        averagePositionQuality: null,
        riskBudgetUsedPct: null,
        marketBreadth: null,
      },
      stageTimings: {},
      generatedAt: Date.now(),
    }
  }
}

export const LaneB: LaneBAnalytical = new LaneBImpl()

// ── Helpers ────────────────────────────────────────────────────────────────
function inferDominantRegime(
  contexts: Map<Asset, import('../types').MarketContext>,
): import('../types').MarketRegime {
  if (contexts.size === 0) return 'UNKNOWN'
  const counts = new Map<string, number>()
  for (const c of contexts.values()) counts.set(c.regime, (counts.get(c.regime) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [r, n] of counts) if (n > bestN) { best = r; bestN = n }
  return (best as import('../types').MarketRegime) ?? 'UNKNOWN'
}

function inferRegimeConfidence(
  contexts: Map<Asset, import('../types').MarketContext>,
): number {
  if (contexts.size === 0) return 0
  let sum = 0
  for (const c of contexts.values()) sum += c.regimeConfidence
  return sum / contexts.size
}

function toRecommendation(
  candidate: import('../types').TradeCandidate,
  ctx: PipelineContext,
): import('../types').Recommendation {
  return {
    id: `rec-${candidate.id}`,
    candidateId: candidate.id,
    asset: candidate.asset,
    action: candidate.action,
    rank: candidate.risk?.rewardToRisk != null && candidate.risk.rewardToRisk >= 2 ? 'A' : candidate.risk?.rewardToRisk != null && candidate.risk.rewardToRisk >= 1 ? 'B' : 'C',
    entryPrice: candidate.risk?.suggestedEntryPrice ?? null,
    targetPrice: candidate.risk?.suggestedTargetPrice ?? null,
    stopPrice: candidate.risk?.suggestedStopPrice ?? null,
    positionSizePct: candidate.risk?.positionSizePct ?? null,
    expectedValue: candidate.expectedValue?.ev ?? null,
    probabilityOfSuccess: candidate.statistics?.probabilityOfSuccess ?? null,
    rewardToRisk: candidate.risk?.rewardToRisk ?? null,
    rationale: candidate.rationale,
    evidence: candidate.expectedValue?.components ?? [],
    publishedAt: Date.now(),
    expiresAt: candidate.expiresAt,
    status: 'ACTIVE',
    snapshotVersion: ctx.snapshotVersion,
    pipelineVersion: ctx.pipelineVersion,
  }
}

// re-export DEFAULT_CONSTRAINTS to satisfy the unused import linter pattern
export const _constraints = DEFAULT_CONSTRAINTS
