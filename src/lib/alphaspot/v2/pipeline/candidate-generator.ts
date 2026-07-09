// Pipeline Stage 7 — Trade Candidate Generation  (Chapter 1 §10, §11)
//
// Convert evaluated assets into Trade Candidates. Every candidate carries:
//   • asset, timestamp, version
//   • statistical metrics, expected value, risk metrics
//   • recommendation rationale (explainable)
//   • expiration time (Principle 7)
//
// Only assets with a positive EV and sufficient edge become BUY candidates.
// Others become WATCH or are rejected. This stage NEVER publishes — it only
// creates candidates for downstream validation (Rule 1).

import type {
  Asset,
  TradeCandidate,
  CandidateAction,
  PipelineContext,
  AssetEligibility,
  EngineeredFeatures,
  MarketContext,
  StatisticalMetrics,
  ExpectedValue,
  RiskMetrics,
} from '../types'
import { DEFAULT_RECOMMENDATION_TTL_MS } from '../types'
import { LaneA } from '../lanes/lane-a-realtime'

interface CandidateInput {
  asset: Asset
  eligibility: AssetEligibility
  features: EngineeredFeatures
  context: MarketContext
  statistics: StatisticalMetrics
  expectedValue: ExpectedValue
}

export async function runCandidateGeneration(
  eligibleAssets: Asset[],
  eligibility: AssetEligibility[],
  features: Map<Asset, EngineeredFeatures>,
  contexts: Map<Asset, MarketContext>,
  statistics: Map<Asset, StatisticalMetrics>,
  evs: Map<Asset, ExpectedValue>,
  ctx: PipelineContext,
): Promise<TradeCandidate[]> {
  const now = Date.now()
  const eligMap = new Map(eligibility.map((e) => [e.asset, e]))
  const candidates: TradeCandidate[] = []

  for (const asset of eligibleAssets) {
    const f = features.get(asset)
    const c = contexts.get(asset)
    const s = statistics.get(asset)
    const ev = evs.get(asset)
    const elig = eligMap.get(asset)
    if (!f || !c || !s || !ev || !elig) continue

    const price = LaneA.getPrice(asset)
    if (price == null) continue

    // Determine action from EV + context
    const action: CandidateAction = decideAction(ev, c, s)
    if (action === 'HOLD' && ev.ev != null && ev.ev < 5) continue // skip weak holds

    // Compute risk metrics
    const risk = computeRiskMetrics(asset, price, f, c, s, ev)

    // Build rationale (explainable — Principle 6)
    const rationale = buildRationale(asset, action, ev, c, s, f, risk)

    candidates.push({
      id: `cand-${asset.replace('/', '-')}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      asset,
      version: 1,
      createdAt: now,
      stage: 'STATISTICAL_EVALUATION',
      action,
      eligibility: elig,
      features: f,
      context: c,
      statistics: s,
      expectedValue: ev,
      risk,
      rationale,
      rejectionReason: null,
      expiresAt: now + DEFAULT_RECOMMENDATION_TTL_MS,
    })
  }

  console.log(`[pipeline:candidate-generation] ${candidates.length} candidates created (BUY: ${candidates.filter((c) => c.action === 'BUY').length})`)
  return candidates
}

function decideAction(ev: ExpectedValue, c: MarketContext, s: StatisticalMetrics): CandidateAction {
  // Capital preservation first (Principle 1): never recommend in HIGH_VOLATILITY
  if (c.regime === 'HIGH_VOLATILITY' && (ev.ev ?? 0) < 30) return 'WATCH'

  // Strong positive EV + decent edge → BUY
  if ((ev.ev ?? 0) >= 20 && (s.edgeScore ?? 0) >= 0.5 && (s.probabilityOfSuccess ?? 0) >= 0.55) {
    return 'BUY'
  }

  // Strong negative EV → SELL (for existing positions; otherwise WATCH)
  if ((ev.ev ?? 0) <= -20) return 'SELL'

  // Moderate EV → WATCH (don't trade — Principle 2: trade less, trade better)
  if ((ev.ev ?? 0) >= 5) return 'WATCH'

  return 'HOLD'
}

function computeRiskMetrics(
  asset: Asset,
  price: number,
  f: EngineeredFeatures,
  c: MarketContext,
  s: StatisticalMetrics,
  ev: ExpectedValue,
): RiskMetrics {
  const atr = f.indicators.atr ?? price * 0.02
  // Entry: current price
  const suggestedEntryPrice = price
  // Stop: 1.5 × ATR below entry (capital preservation)
  const suggestedStopPrice = price - 1.5 * atr
  // Target: based on expected return, floored at 2× risk
  const riskPerUnit = price - suggestedStopPrice
  const suggestedTargetPrice = price + Math.max(riskPerUnit * 2, riskPerUnit * ((ev.ev ?? 0) / 10))
  const maxRiskPct = (riskPerUnit / price) * 100
  const rewardToRisk = (suggestedTargetPrice - price) / riskPerUnit

  // Kelly fraction: f* = (p*b - q) / b, where b = reward/risk, p = prob, q = 1-p
  const p = s.probabilityOfSuccess ?? 0.5
  const b = rewardToRisk
  const q = 1 - p
  const kellyFraction = b > 0 ? Math.max(0, Math.min(0.25, (p * b - q) / b)) : 0 // cap at 25%

  // Position size: Kelly × confidence, capped
  const positionSizePct = Math.max(0, Math.min(0.2, kellyFraction * (s.confidence ?? 0.5)))

  // VaR estimate: 1.5 × ATR as % of capital at suggested position size
  const varEstimate = (1.5 * atr / price) * positionSizePct * 100

  return {
    asset,
    maxRiskPct,
    rewardToRisk,
    kellyFraction,
    varEstimate,
    suggestedStopPrice,
    suggestedTargetPrice,
    suggestedEntryPrice,
    positionSizePct,
  }
}

function buildRationale(
  asset: Asset,
  action: CandidateAction,
  ev: ExpectedValue,
  c: MarketContext,
  s: StatisticalMetrics,
  f: EngineeredFeatures,
  risk: RiskMetrics,
): string {
  const base = asset.split('/')[0]
  const topFactor = [...ev.components].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]
  const patternNote =
    f.patterns.bullish.length > 0
      ? ` ${f.patterns.bullish[0].name} detected.`
      : f.patterns.bearish.length > 0
        ? ` ${f.patterns.bearish[0].name} detected.`
        : ''

  if (action === 'BUY') {
    return `${action} ${base}: EV ${ev.ev?.toFixed(1)} (P success ${(s.probabilityOfSuccess ?? 0).toFixed(2)}, confidence ${(s.confidence ?? 0).toFixed(2)}). ${c.regime.replace('_', ' ').toLowerCase()} regime, ${c.marketStructure.toLowerCase()} structure.${patternNote} Top driver: ${topFactor?.label} (${topFactor?.contribution >= 0 ? '+' : ''}${topFactor?.contribution.toFixed(1)}). R/R ${risk.rewardToRisk?.toFixed(2)}, stop $${risk.suggestedStopPrice?.toFixed(2)}, target $${risk.suggestedTargetPrice?.toFixed(2)}.`
  }
  if (action === 'SELL') {
    return `${action} ${base}: negative EV ${ev.ev?.toFixed(1)}. ${c.regime.replace('_', ' ').toLowerCase()} regime with ${c.marketStructure.toLowerCase()} structure.${patternNote}`
  }
  if (action === 'WATCH') {
    return `WATCH ${base}: moderate EV ${ev.ev?.toFixed(1)} but below trade threshold (Principle 2: trade less, trade better). Re-evaluating.`
  }
  return `HOLD ${base}: no statistical edge (EV ${ev.ev?.toFixed(1)}). Standing aside.`
}
