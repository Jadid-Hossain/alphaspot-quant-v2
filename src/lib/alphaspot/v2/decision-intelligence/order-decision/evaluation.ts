// CHAPTER 5.6 §9, §10 — Transaction Cost, Market Impact & Liquidity Evaluation
//
// §9 — Transaction Cost Evaluation: exchange fees, broker fees, spread, slippage,
//      market impact, funding, borrow, FX conversion.
//      Orders failing minimum economic benefit shall NOT be promoted (Rule 10).
// §10 — Liquidity Management: ADV, depth, participation rate, spread, volatility.
//       Orders violating liquidity constraints may be reduced or rejected.
//
// Rule 9 — Transaction cost estimates INDEPENDENT from market impact estimates.
// Rule 10 — Orders exceeding economic benefit thresholds suppressed.
// Rule 11 — Liquidity evaluation precedes parent order construction.
// Rule 18 — All models independently versioned.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  LiquidityAssessment,
  LiquidityModel,
  MarketImpactEstimate,
  MarketImpactModel,
  TransactionCostEstimate,
  TransactionCostModel,
} from './types'

const log = createLogger('decision-intelligence:order-decision:evaluation')

// ─────────────────────────────────────────────────────────────────────────────
// TransactionCostEvaluator (§9, Rule 9, Rule 18)
// Rule 9 — INDEPENDENT from market impact estimates.
// ─────────────────────────────────────────────────────────────────────────────

export class TransactionCostEvaluator {
  /**
   * Estimate transaction costs for an order (§9, Rule 9 — independent from impact).
   */
  estimate(
    orderQuantity: number,
    price: number,
    isShort: boolean,
    holdingPeriodMs: number,
    model: TransactionCostModel,
  ): TransactionCostEstimate {
    const notional = Math.abs(orderQuantity) * price

    // §9 — Exchange fees
    const exchangeFees = notional * model.exchangeFeeRate
    // §9 — Broker fees
    const brokerFees = notional * model.brokerFeeRate
    // §9 — Bid-ask spread cost (half-spread × notional)
    const bidAskSpreadCost = notional * model.bidAskSpread * 0.5
    // §9 — Estimated slippage
    const estimatedSlippage = notional * model.slippageCoefficient
    // §9 — Funding cost (for perpetuals, annualized → period)
    const fundingPeriodFraction = holdingPeriodMs / (1000 * 60 * 60 * 24 * 365)
    const fundingCost = isShort ? notional * model.fundingRate * fundingPeriodFraction : 0
    // §9 — Borrow cost (for shorts, annualized → period)
    const borrowCost = isShort ? notional * model.borrowRate * fundingPeriodFraction : 0
    // §9 — FX conversion cost
    const fxConversionCost = notional * model.fxConversionCost

    const totalCost = exchangeFees + brokerFees + bidAskSpreadCost + estimatedSlippage + fundingCost + borrowCost + fxConversionCost
    const costFraction = notional > 0 ? totalCost / notional : 0

    log.debug(
      `tx cost: notional=${notional.toFixed(2)}, total=${totalCost.toFixed(2)} (${(costFraction * 100).toFixed(3)}%), ` +
      `exchange=${exchangeFees.toFixed(2)}, spread=${bidAskSpreadCost.toFixed(2)}, slippage=${estimatedSlippage.toFixed(2)}`,
    )

    return {
      exchangeFees,
      brokerFees,
      bidAskSpreadCost,
      estimatedSlippage,
      fundingCost,
      borrowCost,
      fxConversionCost,
      totalCost,
      costFraction,
      modelVersion: model.version,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MarketImpactEvaluator (§9, Rule 9, Rule 18)
// Rule 9 — INDEPENDENT from transaction cost estimates.
// ─────────────────────────────────────────────────────────────────────────────

export class MarketImpactEvaluator {
  /**
   * Estimate market impact for an order (§9, Rule 9 — independent from tx cost).
   * Uses square-root impact model: impact = coefficient × sqrt(participation rate)
   */
  estimate(
    orderQuantity: number,
    price: number,
    averageDailyVolume: number,
    model: MarketImpactModel,
  ): MarketImpactEstimate {
    const notional = Math.abs(orderQuantity) * price
    const advNotional = averageDailyVolume * price

    // Participation rate = order notional / ADV notional
    const participationRate = advNotional > 0 ? notional / advNotional : 0

    // Square-root impact model
    const sqrtImpact = model.sqrtImpactCoefficient * Math.sqrt(participationRate)
    const linearImpact = model.linearImpactCoefficient * participationRate
    const priceImpact = sqrtImpact + linearImpact
    const impactCost = notional * priceImpact

    log.debug(
      `market impact: participation=${(participationRate * 100).toFixed(3)}%, ` +
      `priceImpact=${(priceImpact * 100).toFixed(4)}%, impactCost=${impactCost.toFixed(2)}`,
    )

    return {
      priceImpact,
      impactCost,
      participationRate,
      modelVersion: model.version,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LiquidityEvaluator (§10, Rule 11, Rule 18)
// Rule 11 — Liquidity evaluation precedes parent order construction.
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidityEvaluator {
  /**
   * Evaluate liquidity for an order (§10, Rule 11).
   * Returns whether the order passes liquidity constraints.
   */
  evaluate(
    orderQuantity: number,
    price: number,
    averageDailyVolume: number,
    orderBookDepth: number,
    bidAskSpread: number,
    volatility: number,
    model: LiquidityModel,
  ): LiquidityAssessment {
    const notional = Math.abs(orderQuantity) * price
    const advNotional = averageDailyVolume * price

    // §10 — Participation rate
    const participationRate = advNotional > 0 ? notional / advNotional : 0
    // §10 — Depth utilization
    const depthUtilization = orderBookDepth > 0 ? notional / orderBookDepth : 0
    // §10 — Spread condition
    const spreadCondition = bidAskSpread
    // §10 — Available liquidity
    const availableLiquidity = orderBookDepth

    let passed = true
    let reason = 'liquidity sufficient'

    if (participationRate > model.maxParticipationRate) {
      passed = false
      reason = `participation rate ${(participationRate * 100).toFixed(3)}% > max ${(model.maxParticipationRate * 100).toFixed(2)}%`
    } else if (depthUtilization > model.maxDepthUtilization) {
      passed = false
      reason = `depth utilization ${(depthUtilization * 100).toFixed(3)}% > max ${(model.maxDepthUtilization * 100).toFixed(2)}%`
    } else if (spreadCondition > model.maxSpread) {
      passed = false
      reason = `spread ${(spreadCondition * 100).toFixed(4)}% > max ${(model.maxSpread * 100).toFixed(3)}%`
    }

    log.debug(
      `liquidity: participation=${(participationRate * 100).toFixed(3)}%, ` +
      `depthUtil=${(depthUtilization * 100).toFixed(3)}%, spread=${(spreadCondition * 100).toFixed(4)}%, ` +
      `passed=${passed}`,
    )

    return {
      passed,
      participationRate,
      depthUtilization,
      spreadCondition,
      availableLiquidity,
      reason,
      modelVersion: model.version,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Economic Benefit Evaluator (§9, Rule 10)
// Rule 10 — Orders exceeding economic benefit thresholds suppressed.
// ─────────────────────────────────────────────────────────────────────────────

export class EconomicBenefitEvaluator {
  /**
   * Evaluate whether the order's economic benefit justifies its costs (§9, Rule 10).
   * Returns true if order should be SUPPRESSED (cost exceeds benefit).
   */
  shouldSuppress(
    expectedBenefit: number,
    transactionCost: number,
    marketImpactCost: number,
    economicBenefitThreshold: number,
  ): { suppress: boolean; reason: string } {
    const totalCost = transactionCost + marketImpactCost
    const netBenefit = expectedBenefit - totalCost

    if (netBenefit < 0) {
      return {
        suppress: true,
        reason: `net benefit ${netBenefit.toFixed(2)} < 0 (benefit ${expectedBenefit.toFixed(2)} - costs ${totalCost.toFixed(2)}) — Rule 10 suppressed`,
      }
    }

    if (netBenefit < economicBenefitThreshold * expectedBenefit) {
      return {
        suppress: true,
        reason: `net benefit ${netBenefit.toFixed(2)} below threshold ${(economicBenefitThreshold * 100).toFixed(2)}% of expected — Rule 10 suppressed`,
      }
    }

    return {
      suppress: false,
      reason: `net benefit ${netBenefit.toFixed(2)} justifies execution (cost ${totalCost.toFixed(2)})`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const transactionCostEvaluator = new TransactionCostEvaluator()
export const marketImpactEvaluator = new MarketImpactEvaluator()
export const liquidityEvaluator = new LiquidityEvaluator()
export const economicBenefitEvaluator = new EconomicBenefitEvaluator()
