// Pipeline Stage 9 — Recommendation Validation  (Chapter 1 §6, §10, §11)
//
// Final validation before a candidate becomes a published Recommendation.
// Enforces the architectural rules:
//   Rule 1: no bypassing the pipeline (candidate must have passed all stages)
//   Rule 3: explainable (rationale must be present)
//   Rule 4: measurable (statistical metrics must be present)
//   Rule 5: must expire (expiresAt must be in the future)
//   Principle 1: capital preservation (risk must be bounded)
//   Principle 3: multiple evidence sources (evidenceCount >= 3)
//
// Candidates that pass validation get stage = 'RECOMMENDATION_VALIDATION'.
// The snapshot generator will then promote them to 'PUBLISHED'.

import type { TradeCandidate, PipelineContext } from '../types'

const MIN_EVIDENCE_COUNT = 3 // Principle 3: multiple independent evidence sources
const MAX_RISK_PCT = 5 // Principle 1: cap single-trade risk at 5% of capital
const MIN_RR = 1.0 // reward must at least equal risk

export async function runRecommendationValidation(
  candidates: TradeCandidate[],
  _ctx: PipelineContext,
): Promise<TradeCandidate[]> {
  const out: TradeCandidate[] = []

  for (const c of candidates) {
    // Only BUY candidates need full validation; WATCH/HOLD pass through
    if (c.action !== 'BUY') {
      out.push({ ...c, stage: 'RECOMMENDATION_VALIDATION' })
      continue
    }

    const failures: string[] = []

    // Rule 1: must have passed portfolio optimization
    if (c.stage !== 'PORTFOLIO_OPTIMIZATION') {
      failures.push('skipped portfolio optimization stage')
    }

    // Rule 3: explainable
    if (!c.rationale || c.rationale.trim().length < 10) {
      failures.push('rationale missing or too short')
    }

    // Rule 4: measurable — statistical metrics present
    if (!c.statistics || c.statistics.evidenceCount < MIN_EVIDENCE_COUNT) {
      failures.push(`insufficient evidence: ${c.statistics?.evidenceCount ?? 0} < ${MIN_EVIDENCE_COUNT}`)
    }

    // Rule 5: must expire in the future
    if (!c.expiresAt || c.expiresAt <= Date.now()) {
      failures.push('expiration missing or already expired')
    }

    // Principle 1: risk bounded
    if (c.risk?.maxRiskPct != null && c.risk.maxRiskPct > MAX_RISK_PCT) {
      failures.push(`risk too high: ${c.risk.maxRiskPct.toFixed(2)}% > ${MAX_RISK_PCT}%`)
    }

    // Reward-to-risk floor
    if (c.risk?.rewardToRisk != null && c.risk.rewardToRisk < MIN_RR) {
      failures.push(`reward/risk too low: ${c.risk.rewardToRisk.toFixed(2)} < ${MIN_RR}`)
    }

    if (failures.length > 0) {
      out.push({
        ...c,
        stage: 'REJECTED',
        rejectionReason: `Validation failed: ${failures.join('; ')}`,
        action: 'WATCH',
      })
    } else {
      out.push({ ...c, stage: 'PUBLISHED' })
    }
  }

  const published = out.filter((c) => c.stage === 'PUBLISHED').length
  const rejected = out.filter((c) => c.stage === 'REJECTED').length
  console.log(`[pipeline:recommendation-validation] ${published} published, ${rejected} rejected, ${out.length - published - rejected} passthrough`)
  return out
}
