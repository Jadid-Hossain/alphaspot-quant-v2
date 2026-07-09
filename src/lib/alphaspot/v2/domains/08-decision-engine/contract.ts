// DOMAIN 08 — DECISION ENGINE  (Chapter 2.1 §4, Domain 08)
//
// Purpose: Transform intelligence into Trade Candidates.
//
// Responsibilities:
//   • expected value estimation   • trade quality
//   • candidate scoring           • recommendation reasoning
//   • candidate ranking
//
// ONLY THIS DOMAIN may create Trade Candidates (Chapter 2.1 §4, Domain 08).
//
// Consumes: ML predictions (probabilities) + Market Intelligence (context)
// Produces: TradeCandidate[] with EV, risk metrics, rationale

import type {
  Asset,
  TradeCandidate,
  ExpectedValue,
  StatisticalMetrics,
  MarketContext,
  EngineeredFeatures,
} from '../../types'

export interface DecisionEngineContract {
  /** Estimate the unified Expected Value for an asset. */
  estimateExpectedValue(
    asset: Asset,
    features: EngineeredFeatures,
    context: MarketContext,
    statistics: StatisticalMetrics,
  ): ExpectedValue
  /** Generate Trade Candidates from the evaluated universe. */
  generateCandidates(
    assets: Asset[],
    features: Map<Asset, EngineeredFeatures>,
    contexts: Map<Asset, MarketContext>,
    statistics: Map<Asset, StatisticalMetrics>,
    evs: Map<Asset, ExpectedValue>,
  ): TradeCandidate[]
  /** Rank candidates by statistical quality (EV then edge). */
  rankCandidates(candidates: TradeCandidate[]): TradeCandidate[]
  /** Build the explainable rationale for a candidate (Principle 6). */
  explainCandidate(candidate: TradeCandidate): string
}

export const DECISION_ENGINE_TOKEN = 'domain.decision-engine'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Decision Engine × Portfolio Management (delegated to Domain 09)
 *   Decision Engine × Risk Override (delegated to Domain 10)
 *
 * This domain creates candidates and scores them. It may NOT allocate capital,
 * enforce portfolio-level constraints, or override predictions on risk grounds.
 * Those are Portfolio Intelligence (09) and Risk Engine (10) responsibilities.
 */
