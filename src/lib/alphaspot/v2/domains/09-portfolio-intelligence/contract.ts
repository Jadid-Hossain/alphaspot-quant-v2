// DOMAIN 09 — PORTFOLIO INTELLIGENCE  (Chapter 2.1 §4, Domain 09)
//
// Purpose: Evaluate every Trade Candidate inside portfolio context.
//
// Responsibilities:
//   • diversification        • correlation
//   • exposure               • capital allocation
//   • sector concentration
//
// A trade is NEVER evaluated independently. Portfolio context is mandatory.
//
// Consumes: TradeCandidate[] from Decision Engine
// Produces: TradeCandidate[] with portfolio-level downgrades applied

import type { TradeCandidate } from '../../types'

export interface PortfolioAssessment {
  totalCandidates: number
  promoted: number
  downgraded: number
  projectedCapitalPct: number
  concentrationWarnings: string[]
}

export interface PortfolioIntelligenceContract {
  /** Evaluate candidates in portfolio context. May downgrade BUY → WATCH. */
  optimize(candidates: TradeCandidate[]): { candidates: TradeCandidate[]; assessment: PortfolioAssessment }
  /** Current portfolio exposure snapshot. */
  getExposure(): { totalCapitalPct: number; byAsset: Record<string, number> }
  /** Check concentration limits for a hypothetical new position. */
  checkConcentration(asset: string, sizePct: number): { allowed: boolean; reason: string }
}

export const PORTFOLIO_INTELLIGENCE_TOKEN = 'domain.portfolio-intelligence'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Portfolio Intelligence × Prediction
 *   Portfolio Intelligence × Risk Override (that's Domain 10)
 *
 * This domain allocates capital and checks concentration. It may NOT generate
 * probabilities, override on risk grounds, or execute trades.
 */
