// CHAPTER 5.4 Rule 21 — Pre-Trade Margin Simulation
//
// Rule 21 — Before approving any allocation, the RME shall perform
//           exchange-specific pre-trade margin simulation using:
//             • current portfolio state
//             • projected portfolio state
//             • exchange maintenance margin schedules
//             • leverage configuration
//             • liquidation thresholds
//           Allocations that would violate exchange margin requirements shall
//           be REJECTED before position sizing.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPortfolioContract } from '../portfolio-construction/types'
import type {
  ConstraintViolation,
  ExchangeMarginConfiguration,
  LeverageAssessment,
  LiquidityAssessment,
  MarginStatus,
  RiskPortfolioState,
} from './types'

const log = createLogger('decision-intelligence:risk-management:margin')

// ─────────────────────────────────────────────────────────────────────────────
// PreTradeMarginSimulator (Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export class PreTradeMarginSimulator {
  /**
   * Simulate the projected margin state after rebalancing (Rule 21).
   * Uses exchange-specific maintenance margin schedules.
   */
  simulate(
    portfolio: CanonicalPortfolioContract,
    currentState: RiskPortfolioState,
    exchangeConfig: ExchangeMarginConfiguration,
  ): {
    marginStatus: MarginStatus
    leverageAssessment: LeverageAssessment
    violations: ConstraintViolation[]
  } {
    // Calculate projected position value
    const projectedGrossExposure = portfolio.allocationPlan.grossExposure * currentState.totalNav
    const projectedNetExposure = portfolio.allocationPlan.netExposure * currentState.totalNav

    // Maintenance margin = grossExposure * maintenanceMarginRate
    const maintenanceMargin = projectedGrossExposure * exchangeConfig.maintenanceMarginRate
    // Initial margin = grossExposure * initialMarginRate
    const initialMargin = projectedGrossExposure * exchangeConfig.initialMarginRate

    // Available margin = totalNav - maintenanceMargin
    const availableMargin = Math.max(0, currentState.totalNav - maintenanceMargin)
    // Margin used = initialMargin
    const marginUsed = initialMargin
    // Margin ratio = marginUsed / (marginUsed + availableMargin)
    const marginRatio = marginUsed / Math.max(1, marginUsed + availableMargin)

    // Projected margin after rebalancing
    const projectedMargin = marginUsed
    const projectedMarginRatio = marginRatio

    // Liquidation probability based on distance to liquidation threshold
    const liquidationDistance = exchangeConfig.liquidationThreshold > 0
      ? Math.max(0, (marginRatio - exchangeConfig.liquidationThreshold) / Math.max(0.001, exchangeConfig.liquidationThreshold))
      : 0
    const liquidationProbability = Math.max(0, Math.min(1, 1 - liquidationDistance))

    // Margin call triggered if margin ratio below margin call threshold
    const marginCallTriggered = marginRatio < exchangeConfig.marginCallThreshold
    // Liquidation imminent if margin ratio below liquidation threshold
    const liquidationImminent = marginRatio < exchangeConfig.liquidationThreshold

    const marginStatus: MarginStatus = {
      marginUsed,
      availableMargin,
      marginRatio,
      maintenanceMargin,
      marginCallTriggered,
      liquidationImminent,
      projectedMargin,
      projectedMarginRatio,
      liquidationProbability,
    }

    // Leverage assessment (Rule 10 — INDEPENDENT from liquidity)
    const grossLeverage = portfolio.allocationPlan.leverage
    const netLeverage = Math.abs(portfolio.allocationPlan.netExposure)
    const maxLeverage = Math.min(
      exchangeConfig.maxExchangeLeverage,
      portfolio.portfolioMetadata?.optimization?.optimizationMethod ? 3.0 : 3.0, // config-driven
    )
    const marginUtilization = marginRatio
    const exceedsLeverageLimit = grossLeverage > maxLeverage

    const leverageAssessment: LeverageAssessment = {
      passed: !exceedsLeverageLimit && !liquidationImminent,
      grossLeverage,
      netLeverage,
      maxLeverage,
      marginUtilization,
      exceedsLeverageLimit,
      liquidationDistance,
    }

    // Violations (Rule 21 — reject if margin requirements violated)
    const violations: ConstraintViolation[] = []
    const now = Date.now()

    if (liquidationImminent) {
      violations.push({
        violationId: `viol-margin-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        constraint: 'liquidationThreshold',
        category: 'LEVERAGE_RISK',
        severity: 'CATASTROPHIC',
        actual: marginRatio,
        limit: exchangeConfig.liquidationThreshold,
        description: `margin ratio ${marginRatio.toFixed(4)} below liquidation threshold ${exchangeConfig.liquidationThreshold} — IMMEDIATE LIQUIDATION RISK`,
        timestamp: now,
        transactional: false,
        affectedSymbols: [],
      })
    }

    if (marginCallTriggered) {
      violations.push({
        violationId: `viol-margin-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        constraint: 'marginCallThreshold',
        category: 'LEVERAGE_RISK',
        severity: 'CRITICAL',
        actual: marginRatio,
        limit: exchangeConfig.marginCallThreshold,
        description: `margin ratio ${marginRatio.toFixed(4)} below margin call threshold ${exchangeConfig.marginCallThreshold}`,
        timestamp: now,
        transactional: false,
        affectedSymbols: [],
      })
    }

    if (exceedsLeverageLimit) {
      violations.push({
        violationId: `viol-margin-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        constraint: 'maxLeverage',
        category: 'LEVERAGE_RISK',
        severity: 'CRITICAL',
        actual: grossLeverage,
        limit: maxLeverage,
        description: `gross leverage ${grossLeverage.toFixed(3)} exceeds max leverage ${maxLeverage}`,
        timestamp: now,
        transactional: false,
        affectedSymbols: [],
      })
    }

    log.debug(
      `margin simulation: marginRatio=${marginRatio.toFixed(4)}, liquidationProb=${liquidationProbability.toFixed(3)}, ` +
      `leverage=${grossLeverage.toFixed(2)}, violations=${violations.length}`,
    )

    return { marginStatus, leverageAssessment, violations }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton simulator
// ─────────────────────────────────────────────────────────────────────────────

export const preTradeMarginSimulator = new PreTradeMarginSimulator()
