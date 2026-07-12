// CHAPTER 5.8 §8 — Venue Evaluation & Toxicity Assessment
//
// §8 — Every candidate venue is evaluated using:
//   • Available Liquidity, Order Book Depth, Spread, Historical Fill Rate
//   • Venue Latency, Queue Length, Queue Position Probability
//   • Maker/Taker Fees, Reliability Score, Historical Stability
//   • Venue Toxicity Assessment (Rule 21)
//
// Rule 10 — Venue cost estimation INDEPENDENT from latency estimation.
// Rule 17 — Queue-position estimation INDEPENDENT from liquidity estimation.
// Rule 21 — Toxicity assessment precedes final venue ranking.
//           Toxicity is mathematically INDEPENDENT from liquidity/latency/fee/queue.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  RoutingConfiguration,
  VenueEvaluation,
  VenueMetadata,
  VenueToxicityAssessment,
} from './types'

const log = createLogger('decision-intelligence:smart-order-routing:evaluation')

// ─────────────────────────────────────────────────────────────────────────────
// VenueToxicityAssessor (§8, Rule 21)
// Rule 21 — Toxicity INDEPENDENT from liquidity/latency/fee/queue evaluation.
// ─────────────────────────────────────────────────────────────────────────────

export class VenueToxicityAssessor {
  /**
   * Assess venue toxicity (§8, Rule 21).
   * Toxicity is mathematically INDEPENDENT from all other evaluations.
   */
  assess(venue: VenueMetadata, config: RoutingConfiguration): VenueToxicityAssessment {
    // §8 — VPIN (Volume-Synchronized Probability of Informed Trading)
    // Higher VPIN → more informed trading → more toxic
    const vpin = this.estimateVPIN(venue)

    // §8 — Adverse selection rate (proxy: 1 - reliability)
    const adverseSelectionRate = Math.max(0, Math.min(1, 1 - venue.reliabilityScore * 0.7))

    // §8 — Toxic fill ratio (proxy: based on spread + queue)
    const toxicFillRatio = Math.max(0, Math.min(1, venue.spread * 5 + venue.queueLength * 0.001))

    // §8 — Post-fill price drift (proxy: based on volatility of venue)
    const postFillPriceDrift = Math.max(0, Math.min(0.05, venue.spread * 2))

    // §8 — Quote fade rate (proxy: 1 - fill rate)
    const quoteFadeRate = Math.max(0, Math.min(1, 1 - venue.historicalFillRate))

    // §8 — Aggressive order flow ratio (proxy)
    const aggressiveOrderFlowRatio = Math.max(0, Math.min(1, 0.3 + (1 - venue.reliabilityScore) * 0.4))

    // §8 — Fill quality degradation
    const fillQualityDegradation = Math.max(0, Math.min(1, 1 - venue.historicalStability))

    // §8 — Information leakage risk
    const informationLeakageRisk = Math.max(0, Math.min(1, venue.venueType === 'DARK' ? 0.2 : 0.5 + venue.spread * 2))

    // §8 — Hidden liquidity reliability
    const hiddenLiquidityReliability = Math.max(0, Math.min(1, venue.historicalFillRate * 0.8))

    // §8 — Composite venue toxicity score (0..1, higher = more toxic)
    const venueToxicityScore = Math.max(0, Math.min(1,
      vpin * 0.25 +
      adverseSelectionRate * 0.20 +
      toxicFillRatio * 0.15 +
      quoteFadeRate * 0.10 +
      aggressiveOrderFlowRatio * 0.10 +
      fillQualityDegradation * 0.08 +
      informationLeakageRisk * 0.07 +
      postFillPriceDrift * 5 * 0.05,
    ))

    // Rule 21 — Penalize or exclude based on toxicity
    const penalize = venueToxicityScore > config.toxicityPenaltyThreshold
    const exclude = venueToxicityScore > config.toxicityExclusionThreshold

    log.debug(
      `venue ${venue.venueId} toxicity: score=${venueToxicityScore.toFixed(3)}, vpin=${vpin.toFixed(3)}, ` +
      `penalize=${penalize}, exclude=${exclude}`,
    )

    return {
      venueId: venue.venueId,
      vpin,
      adverseSelectionRate,
      toxicFillRatio,
      postFillPriceDrift,
      quoteFadeRate,
      aggressiveOrderFlowRatio,
      fillQualityDegradation,
      informationLeakageRisk,
      hiddenLiquidityReliability,
      venueToxicityScore,
      penalize,
      exclude,
      modelVersion: config.toxicityModelVersion,
    }
  }

  /** Estimate VPIN (simplified — real VPIN uses volume bucketing). */
  private estimateVPIN(venue: VenueMetadata): number {
    // Proxy: higher spread + lower fill rate + lower reliability → higher VPIN
    const spreadComponent = Math.min(1, venue.spread * 10)
    const fillComponent = 1 - venue.historicalFillRate
    const reliabilityComponent = 1 - venue.reliabilityScore
    return Math.max(0, Math.min(1, spreadComponent * 0.4 + fillComponent * 0.3 + reliabilityComponent * 0.3))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VenueEvaluator (§8)
// Rule 10 — Cost INDEPENDENT from latency.
// Rule 17 — Queue position INDEPENDENT from liquidity.
// ─────────────────────────────────────────────────────────────────────────────

export class VenueEvaluator {
  private toxicityAssessor = new VenueToxicityAssessor()

  /**
   * Evaluate a candidate venue (§8).
   * All evaluations are mathematically independent (Rule 10, Rule 17, Rule 21).
   */
  evaluate(
    venue: VenueMetadata,
    orderQuantity: number,
    orderValue: number,
    config: RoutingConfiguration,
  ): VenueEvaluation {
    // Rule 21 — Toxicity assessment (independent from all other evaluations)
    const toxicityAssessment = this.toxicityAssessor.assess(venue, config)

    // §8 — Liquidity score (Rule 17 — independent from queue position)
    const liquidityScore = this.computeLiquidityScore(venue, orderValue)

    // §8 — Queue position probability (Rule 17 — independent from liquidity)
    const queuePositionProbability = this.computeQueuePositionProbability(venue)

    // §8 — Expected venue cost (Rule 10 — independent from latency)
    const expectedVenueCost = this.computeExpectedCost(venue, orderQuantity, orderValue)

    // §8 — Expected venue latency (Rule 10 — independent from cost)
    const expectedVenueLatency = this.computeExpectedLatency(venue)

    // §8 — Expected fill probability
    const expectedFillProbability = this.computeFillProbability(venue, orderValue)

    // Composite score
    let compositeScore = (
      liquidityScore * 0.25 +
      queuePositionProbability * 0.20 +
      (1 - expectedVenueCost / Math.max(1, orderValue)) * 0.15 +
      (1 - expectedVenueLatency / 200) * 0.10 +
      expectedFillProbability * 0.20 +
      venue.reliabilityScore * 0.10
    )

    // Rule 21 — Apply toxicity penalty
    let toxicityPenalized = false
    let toxicityExcluded = false
    let reason = 'venue evaluated'

    if (toxicityAssessment.exclude) {
      toxicityExcluded = true
      compositeScore = 0
      reason = `venue EXCLUDED — toxicity ${toxicityAssessment.venueToxicityScore.toFixed(3)} > ${config.toxicityExclusionThreshold} (Rule 21)`
    } else if (toxicityAssessment.penalize) {
      toxicityPenalized = true
      const penaltyFactor = 1 - (toxicityAssessment.venueToxicityScore - config.toxicityPenaltyThreshold) * 2
      compositeScore *= Math.max(0.1, penaltyFactor)
      reason = `venue PENALIZED — toxicity ${toxicityAssessment.venueToxicityScore.toFixed(3)} > ${config.toxicityPenaltyThreshold} (Rule 21)`
    }

    return {
      venueId: venue.venueId,
      liquidityScore,
      queuePositionProbability,
      expectedVenueCost,
      expectedVenueLatency,
      expectedFillProbability,
      toxicityAssessment,
      compositeScore: Math.max(0, Math.min(1, compositeScore)),
      toxicityPenalized,
      toxicityExcluded,
      reason,
    }
  }

  /** §8 — Liquidity score (0..1). Rule 17 — independent from queue position. */
  private computeLiquidityScore(venue: VenueMetadata, orderValue: number): number {
    const depthCoverage = venue.orderBookDepth > 0 ? Math.min(1, venue.orderBookDepth / Math.max(1, orderValue)) : 0
    const spreadScore = Math.max(0, 1 - venue.spread * 20)
    const fillRateScore = venue.historicalFillRate
    return Math.max(0, Math.min(1, depthCoverage * 0.4 + spreadScore * 0.3 + fillRateScore * 0.3))
  }

  /** §8 — Queue position probability (0..1). Rule 17 — independent from liquidity. */
  private computeQueuePositionProbability(venue: VenueMetadata): number {
    if (venue.queueLength === 0) return 1.0
    // Probability of getting filled decreases with queue length
    return Math.max(0, Math.min(1, 1 / (1 + venue.queueLength * 0.01)))
  }

  /** §8 — Expected venue cost (quote currency). Rule 10 — independent from latency. */
  private computeExpectedCost(venue: VenueMetadata, orderQuantity: number, orderValue: number): number {
    const feeCost = orderValue * venue.takerFee // assume taker for conservative estimate
    const spreadCost = orderValue * venue.spread * 0.5
    const slippageCost = orderValue * 0.0002 // estimate
    return feeCost + spreadCost + slippageCost
  }

  /** §8 — Expected venue latency (ms). Rule 10 — independent from cost. */
  private computeExpectedLatency(venue: VenueMetadata): number {
    return venue.venueLatency + venue.networkTransitTime + venue.gatewayLatency
  }

  /** §8 — Expected fill probability (0..1). */
  private computeFillProbability(venue: VenueMetadata, orderValue: number): number {
    const liquidityCoverage = venue.availableLiquidity > 0 ? Math.min(1, venue.availableLiquidity / Math.max(1, orderValue)) : 0
    return Math.max(0, Math.min(1, venue.historicalFillRate * 0.5 + liquidityCoverage * 0.5))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VenueRanker — ranks venues by composite score (§8, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export class VenueRanker {
  /**
   * Rank venues by composite score (§8, Rule 16 — versioned, reproducible).
   * Excluded venues (Rule 21) are filtered out.
   */
  rank(evaluations: VenueEvaluation[]): VenueEvaluation[] {
    return evaluations
      .filter((e) => !e.toxicityExcluded)
      .sort((a, b) => b.compositeScore - a.compositeScore)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const venueToxicityAssessor = new VenueToxicityAssessor()
export const venueEvaluator = new VenueEvaluator()
export const venueRanker = new VenueRanker()
