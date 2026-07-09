// DOMAIN 10 — RISK ENGINE  (Chapter 2.1 §4, Domain 10)
//
// Purpose: Protect capital.
//
// Responsibilities:
//   • stop loss              • portfolio risk
//   • take profit            • drawdown control
//   • position sizing        • recommendation invalidation
//
// RISK DECISIONS OVERRIDE PREDICTION QUALITY (Chapter 2.1 §4, Domain 10).
//
// Consumes: TradeCandidate[] from Portfolio Intelligence
// Produces: RiskAssessment per candidate; may INVALIDATE candidates.

import type { TradeCandidate, RiskMetrics } from '../../types'

export interface RiskAssessment {
  candidateId: string
  asset: string
  riskMetrics: RiskMetrics
  approved: boolean
  rejectionReasons: string[]
  riskScore: number // 0..1 — higher = riskier
}

export interface RiskEngineContract {
  /** Validate every candidate against risk rules. May INVALIDATE. */
  validate(candidates: TradeCandidate[]): RiskAssessment[]
  /** Compute risk metrics (stop, target, sizing, VaR) for a candidate. */
  computeRisk(candidate: TradeCandidate): RiskMetrics
  /** Portfolio-level risk budget check. */
  checkPortfolioRisk(assessments: RiskAssessment[]): { withinBudget: boolean; usedPct: number; maxPct: number }
  /** Monitor open positions for stop-loss / take-profit triggers. */
  monitorPositions(): { actions: Array<{ asset: string; action: 'STOP' | 'TAKE_PROFIT'; reason: string }> }
}

export const RISK_ENGINE_TOKEN = 'domain.risk-engine'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Risk Engine × Prediction
 *
 * This domain may NOT generate probabilities or run ML inference. It consumes
 * predictions and may override them on risk grounds — but it never produces
 * its own predictions.
 */
