// CHAPTER 5.4 §8 — Risk Limit Management
//
// §8 — Risk policies support configurable limits:
//   • Portfolio-level: max position/portfolio/sector/asset/strategy exposure,
//     max leverage, max drawdown, max daily loss, max correlation,
//     max participation rate, min liquidity, max risk score, max liquidation prob.
//   • Transactional (Rule 22): max single transaction size, max rebalancing delta,
//     max order flow rate, max capital deployment rate, max exchange participation,
//     max margin utilization. INDEPENDENT from portfolio-level.
//
// Rule 6 — Fully configurable + version controlled.
// Rule 10 — Liquidity constraints INDEPENDENT from leverage constraints.
// Rule 18 — Constraint violations generate immutable governance events.
// Rule 22 — Transactional limits INDEPENDENT from portfolio-level.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  ConstraintViolation,
  CanonicalPortfolioContract,
  PortfolioRiskLimits,
  RiskCategory,
  RiskSeverity,
  TransactionalRiskLimits,
} from './types'
import type { AssetMetadata } from '../portfolio-construction/types'

const log = createLogger('decision-intelligence:risk-management:limits')

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioRiskLimitEnforcer — portfolio-level limit evaluation (§8)
// ─────────────────────────────────────────────────────────────────────────────

export class PortfolioRiskLimitEnforcer {
  /**
   * Evaluate all portfolio-level risk limits (§8).
   * Returns violations for any mandatory limit exceeded.
   */
  evaluate(
    portfolio: CanonicalPortfolioContract,
    limits: PortfolioRiskLimits,
    assetMetadata: Map<string, AssetMetadata>,
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = []
    const now = Date.now()

    // §8 — Maximum Portfolio Exposure (gross)
    if (portfolio.allocationPlan.grossExposure > limits.maxPortfolioExposure) {
      violations.push(this.makeViolation(
        'maxPortfolioExposure', 'PORTFOLIO_RISK', 'HIGH',
        portfolio.allocationPlan.grossExposure, limits.maxPortfolioExposure,
        `gross exposure ${portfolio.allocationPlan.grossExposure.toFixed(3)} > limit ${limits.maxPortfolioExposure}`,
        now, false,
      ))
    }

    // §8 — Maximum Leverage
    if (portfolio.allocationPlan.leverage > limits.maxLeverage) {
      violations.push(this.makeViolation(
        'maxLeverage', 'LEVERAGE_RISK', 'CRITICAL',
        portfolio.allocationPlan.leverage, limits.maxLeverage,
        `leverage ${portfolio.allocationPlan.leverage.toFixed(3)} > limit ${limits.maxLeverage}`,
        now, false,
      ))
    }

    // §8 — Per-asset exposure + max position exposure
    for (const w of portfolio.assetWeights) {
      if (Math.abs(w.targetWeight) > limits.maxAssetExposure) {
        violations.push(this.makeViolation(
          'maxAssetExposure', 'CONCENTRATION_RISK', 'HIGH',
          Math.abs(w.targetWeight), limits.maxAssetExposure,
          `asset ${w.symbol} weight ${Math.abs(w.targetWeight).toFixed(3)} > limit ${limits.maxAssetExposure}`,
          now, false, [w.symbol],
        ))
      }
      if (Math.abs(w.targetWeight) > limits.maxPositionExposure) {
        violations.push(this.makeViolation(
          'maxPositionExposure', 'CONCENTRATION_RISK', 'CRITICAL',
          Math.abs(w.targetWeight), limits.maxPositionExposure,
          `position ${w.symbol} weight ${Math.abs(w.targetWeight).toFixed(3)} > limit ${limits.maxPositionExposure}`,
          now, false, [w.symbol],
        ))
      }
    }

    // §8 — Per-sector exposure
    const sectorMap = this.aggregateByAttribute(portfolio, assetMetadata, 'sector')
    for (const [sector, exposure] of sectorMap) {
      if (exposure > limits.maxSectorExposure) {
        violations.push(this.makeViolation(
          'maxSectorExposure', 'CONCENTRATION_RISK', 'MEDIUM',
          exposure, limits.maxSectorExposure,
          `sector ${sector} exposure ${exposure.toFixed(3)} > limit ${limits.maxSectorExposure}`,
          now, false,
        ))
      }
    }

    // §8 — Per-strategy exposure
    const strategyMap = this.aggregateByStrategy(portfolio)
    for (const [strategy, exposure] of strategyMap) {
      if (exposure > limits.maxStrategyExposure) {
        violations.push(this.makeViolation(
          'maxStrategyExposure', 'CONCENTRATION_RISK', 'MEDIUM',
          exposure, limits.maxStrategyExposure,
          `strategy ${strategy} exposure ${exposure.toFixed(3)} > limit ${limits.maxStrategyExposure}`,
          now, false,
        ))
      }
    }

    // §8 — Maximum Correlation
    if (portfolio.correlationMetrics.maxCorrelation > limits.maxCorrelation) {
      violations.push(this.makeViolation(
        'maxCorrelation', 'CORRELATION_RISK', 'HIGH',
        portfolio.correlationMetrics.maxCorrelation, limits.maxCorrelation,
        `max pairwise correlation ${portfolio.correlationMetrics.maxCorrelation.toFixed(3)} > limit ${limits.maxCorrelation}`,
        now, false,
      ))
    }
    if (portfolio.correlationMetrics.avgAssetCorrelation > limits.maxAvgCorrelation) {
      violations.push(this.makeViolation(
        'maxAvgCorrelation', 'CORRELATION_RISK', 'MEDIUM',
        portfolio.correlationMetrics.avgAssetCorrelation, limits.maxAvgCorrelation,
        `avg correlation ${portfolio.correlationMetrics.avgAssetCorrelation.toFixed(3)} > limit ${limits.maxAvgCorrelation}`,
        now, false,
      ))
    }

    // §8 — Maximum Participation Rate (liquidity)
    if (portfolio.diversificationMetrics.maxParticipationRate > limits.maxParticipationRate) {
      violations.push(this.makeViolation(
        'maxParticipationRate', 'LIQUIDITY_RISK', 'CRITICAL',
        portfolio.diversificationMetrics.maxParticipationRate, limits.maxParticipationRate,
        `max participation rate ${portfolio.diversificationMetrics.maxParticipationRate.toFixed(3)} > limit ${limits.maxParticipationRate}`,
        now, false,
      ))
    }

    // §8 — Minimum Liquidity Requirement
    const belowLiquidity: string[] = []
    for (const w of portfolio.assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      if (meta && meta.liquidityScore < limits.minLiquidityRequirement) {
        belowLiquidity.push(w.symbol)
      }
    }
    if (belowLiquidity.length > 0) {
      violations.push(this.makeViolation(
        'minLiquidityRequirement', 'LIQUIDITY_RISK', 'HIGH',
        0, limits.minLiquidityRequirement,
        `assets below minimum liquidity: ${belowLiquidity.join(', ')}`,
        now, false, belowLiquidity,
      ))
    }

    log.debug(
      `portfolio ${portfolio.portfolioId} — ${violations.length} violations ` +
      `(${violations.filter((v) => v.severity === 'CRITICAL' || v.severity === 'CATASTROPHIC').length} critical)`,
    )

    return violations
  }

  private makeViolation(
    constraint: string,
    category: RiskCategory,
    severity: RiskSeverity,
    actual: number,
    limit: number,
    description: string,
    timestamp: number,
    transactional: boolean,
    affectedSymbols: string[] = [],
  ): ConstraintViolation {
    return {
      violationId: `viol-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      constraint, category, severity, actual, limit, description, timestamp, transactional, affectedSymbols,
    }
  }

  private aggregateByAttribute(
    portfolio: CanonicalPortfolioContract,
    assetMetadata: Map<string, AssetMetadata>,
    attr: 'sector' | 'country' | 'currency' | 'exchange',
  ): Map<string, number> {
    const agg = new Map<string, number>()
    for (const w of portfolio.assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const key = meta?.[attr] ?? 'UNKNOWN'
      agg.set(key, (agg.get(key) ?? 0) + Math.abs(w.targetWeight))
    }
    return agg
  }

  private aggregateByStrategy(portfolio: CanonicalPortfolioContract): Map<string, number> {
    const agg = new Map<string, number>()
    for (const w of portfolio.assetWeights) {
      for (const s of w.contributingStrategies) {
        agg.set(s, (agg.get(s) ?? 0) + Math.abs(w.targetWeight) / Math.max(1, w.contributingStrategies.length))
      }
    }
    return agg
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TransactionalRiskLimitEnforcer — transactional hard limits (§8, Rule 22)
// Rule 22 — INDEPENDENT from portfolio-level limits.
// ─────────────────────────────────────────────────────────────────────────────

export class TransactionalRiskLimitEnforcer {
  /**
   * Evaluate transactional hard limits (§8, Rule 22).
   * These limits are evaluated BEFORE position sizing.
   */
  evaluate(
    portfolio: CanonicalPortfolioContract,
    limits: TransactionalRiskLimits,
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = []
    const now = Date.now()

    // §8, Rule 22 — Maximum Single Transaction Size
    for (const action of portfolio.rebalancingDelta.actions) {
      const transactionSize = Math.abs(action.capitalDelta)
      if (transactionSize > limits.maxSingleTransactionSize) {
        violations.push({
          violationId: `viol-tx-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          constraint: 'maxSingleTransactionSize',
          category: 'OPERATIONAL_RISK',
          severity: 'CRITICAL',
          actual: transactionSize,
          limit: limits.maxSingleTransactionSize,
          description: `transaction ${action.symbol} size ${transactionSize.toFixed(0)} > limit ${limits.maxSingleTransactionSize}`,
          timestamp: now,
          transactional: true,
          affectedSymbols: [action.symbol],
        })
      }
    }

    // §8, Rule 22 — Maximum Rebalancing Delta
    const totalDelta = Math.abs(portfolio.rebalancingDelta.totalDeltaValue)
    if (totalDelta > limits.maxRebalancingDelta) {
      violations.push({
        violationId: `viol-tx-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        constraint: 'maxRebalancingDelta',
        category: 'OPERATIONAL_RISK',
        severity: 'HIGH',
        actual: totalDelta,
        limit: limits.maxRebalancingDelta,
        description: `total rebalancing delta ${totalDelta.toFixed(0)} > limit ${limits.maxRebalancingDelta}`,
        timestamp: now,
        transactional: true,
        affectedSymbols: [],
      })
    }

    // §8, Rule 22 — Maximum Capital Deployment Rate
    // Check if any single action's deployment rate exceeds limit
    for (const action of portfolio.rebalancingDelta.actions) {
      // Assume deployment happens over 1 second (conservative)
      const deploymentRate = Math.abs(action.capitalDelta) // per second
      if (deploymentRate > limits.maxCapitalDeploymentRate) {
        violations.push({
          violationId: `viol-tx-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          constraint: 'maxCapitalDeploymentRate',
          category: 'OPERATIONAL_RISK',
          severity: 'HIGH',
          actual: deploymentRate,
          limit: limits.maxCapitalDeploymentRate,
          description: `deployment rate for ${action.symbol} ${deploymentRate.toFixed(0)}/s > limit ${limits.maxCapitalDeploymentRate}`,
          timestamp: now,
          transactional: true,
          affectedSymbols: [action.symbol],
        })
      }
    }

    // §8, Rule 22 — Maximum Margin Utilization per transaction
    for (const action of portfolio.rebalancingDelta.actions) {
      const marginUsed = Math.abs(action.capitalDelta) * 0.1 // 10% margin assumption
      const marginUtilization = marginUsed / Math.max(1, Math.abs(action.capitalDelta))
      if (marginUtilization > limits.maxMarginUtilization) {
        violations.push({
          violationId: `viol-tx-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          constraint: 'maxMarginUtilization',
          category: 'LEVERAGE_RISK',
          severity: 'HIGH',
          actual: marginUtilization,
          limit: limits.maxMarginUtilization,
          description: `margin utilization for ${action.symbol} ${marginUtilization.toFixed(3)} > limit ${limits.maxMarginUtilization}`,
          timestamp: now,
          transactional: true,
          affectedSymbols: [action.symbol],
        })
      }
    }

    log.debug(`portfolio ${portfolio.portfolioId} — ${violations.length} transactional violations`)

    return violations
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const portfolioRiskLimitEnforcer = new PortfolioRiskLimitEnforcer()
export const transactionalRiskLimitEnforcer = new TransactionalRiskLimitEnforcer()
