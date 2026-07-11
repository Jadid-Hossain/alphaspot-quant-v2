// CHAPTER 5.3 §9 — Diversification Assessment
//
// Evaluates (§9):
//   • Asset / Sector / Country / Exchange / Currency / Strategy Concentration
//   • ADV / Expected Market Impact / Order Book Depth / Participation Rate
//   • Liquidity Capacity / Execution Capacity / Estimated Slippage / Turnover
//
// Rule 9 — Diversification constraints configurable + version controlled.
// Rule 13 — Reject target allocations exceeding liquidity capacity constraints.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AssetMetadata,
  AssetWeight,
  ConstraintEvaluationResult,
  DiversificationMetrics,
  PortfolioConstraints,
  RebalancingDelta,
} from './types'

const log = createLogger('decision-intelligence:portfolio-construction:diversification')

// ─────────────────────────────────────────────────────────────────────────────
// DiversificationAssessor
// ─────────────────────────────────────────────────────────────────────────────

export class DiversificationAssessor {
  /**
   * Compute diversification metrics (§9) from asset weights.
   * All concentration metrics use Herfindahl-Hirschman Index (HHI):
   *   HHI = Σ(weight_i)^2
   *   HHI ∈ [0, 1]; 1 = single asset (no diversification).
   */
  assess(
    assetWeights: AssetWeight[],
    assetMetadata: Map<string, AssetMetadata>,
    delta: RebalancingDelta | null,
    constraints: PortfolioConstraints,
    totalNav: number,
  ): DiversificationMetrics {
    // §9 — Asset Concentration (HHI)
    const assetConcentration = this.computeHHI(assetWeights.map((w) => Math.abs(w.targetWeight)))

    // §9 — Sector Concentration
    const sectorWeights = this.aggregateByAttribute(assetWeights, assetMetadata, 'sector')
    const sectorConcentration = this.computeHHI(sectorWeights)

    // §9 — Country Concentration
    const countryWeights = this.aggregateByAttribute(assetWeights, assetMetadata, 'country')
    const countryConcentration = this.computeHHI(countryWeights)

    // §9 — Exchange Concentration
    const exchangeWeights = this.aggregateByAttribute(assetWeights, assetMetadata, 'exchange')
    const exchangeConcentration = this.computeHHI(exchangeWeights)

    // §9 — Currency Concentration
    const currencyWeights = this.aggregateByAttribute(assetWeights, assetMetadata, 'currency')
    const currencyConcentration = this.computeHHI(currencyWeights)

    // §9 — Strategy Concentration
    const strategyWeights = this.aggregateByStrategy(assetWeights)
    const strategyConcentration = this.computeHHI(strategyWeights)

    // §9 — Effective number of assets (1 / HHI)
    const effectiveAssetCount = assetConcentration > 0 ? 1 / assetConcentration : 0

    // §9 — Diversification ratio (weighted avg vol / portfolio vol)
    let weightedAvgVol = 0
    let totalAbsWeight = 0
    for (const w of assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const vol = meta?.volatility ?? 0.5
      weightedAvgVol += Math.abs(w.targetWeight) * vol
      totalAbsWeight += Math.abs(w.targetWeight)
    }
    weightedAvgVol = totalAbsWeight > 0 ? weightedAvgVol / totalAbsWeight : 0
    // Simplified portfolio vol (no covariance): sqrt(Σ(w_i * σ_i)^2)
    let portfolioVariance = 0
    for (const w of assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const vol = meta?.volatility ?? 0.5
      portfolioVariance += Math.pow(w.targetWeight * vol, 2)
    }
    const portfolioVol = Math.sqrt(portfolioVariance)
    const diversificationRatio = portfolioVol > 0 ? weightedAvgVol / portfolioVol : 0

    // §9 — Liquidity metrics
    const liquidityMetrics = this.computeLiquidityMetrics(assetWeights, assetMetadata, totalNav, delta)

    // §9 — Turnover ratio
    let totalTurnover = 0
    for (const w of assetWeights) {
      totalTurnover += Math.abs(w.targetWeight - w.currentWeight)
    }
    const turnoverRatio = totalNav > 0 ? totalTurnover / 2 : 0 // one-way turnover

    // §9 — Composite diversification score (0..1, higher = more diversified)
    const assetScore = 1 - Math.min(1, assetConcentration / Math.max(0.01, constraints.maxAssetConcentration))
    const sectorScore = 1 - Math.min(1, sectorConcentration / Math.max(0.01, constraints.maxSectorConcentration))
    const effectiveScore = Math.min(1, effectiveAssetCount / Math.max(1, constraints.minEffectiveAssetCount))
    const liquidityScore = 1 - liquidityMetrics.maxParticipationRate
    const diversificationScore = (assetScore * 0.3 + sectorScore * 0.2 + effectiveScore * 0.3 + liquidityScore * 0.2)

    log.debug(
      `diversification: assetHHI=${assetConcentration.toFixed(3)}, sectorHHI=${sectorConcentration.toFixed(3)}, ` +
      `effective=${effectiveAssetCount.toFixed(1)}, divRatio=${diversificationRatio.toFixed(3)}, ` +
      `maxPartRate=${liquidityMetrics.maxParticipationRate.toFixed(3)}, score=${diversificationScore.toFixed(3)}`,
    )

    return {
      assetConcentration,
      sectorConcentration,
      countryConcentration,
      exchangeConcentration,
      currencyConcentration,
      strategyConcentration,
      effectiveAssetCount,
      diversificationRatio,
      liquidityCapacityUtilization: liquidityMetrics.capacityUtilization,
      maxParticipationRate: liquidityMetrics.maxParticipationRate,
      avgParticipationRate: liquidityMetrics.avgParticipationRate,
      estimatedSlippage: liquidityMetrics.estimatedSlippage,
      turnoverRatio,
      diversificationScore,
    }
  }

  /**
   * Evaluate diversification constraints (§9, Rule 9, Rule 13).
   * Returns violations + warnings.
   */
  evaluateConstraints(
    metrics: DiversificationMetrics,
    constraints: PortfolioConstraints,
  ): Pick<ConstraintEvaluationResult, 'violations' | 'warnings'> {
    const violations: ConstraintEvaluationResult['violations'] = []
    const warnings: ConstraintEvaluationResult['warnings'] = []

    if (metrics.assetConcentration > constraints.maxAssetConcentration) {
      violations.push({
        constraint: 'maxAssetConcentration',
        actual: metrics.assetConcentration,
        limit: constraints.maxAssetConcentration,
        severity: 'HIGH',
        description: `asset HHI ${metrics.assetConcentration.toFixed(3)} > limit ${constraints.maxAssetConcentration}`,
      })
    }
    if (metrics.sectorConcentration > constraints.maxSectorConcentration) {
      violations.push({
        constraint: 'maxSectorConcentration',
        actual: metrics.sectorConcentration,
        limit: constraints.maxSectorConcentration,
        severity: 'MEDIUM',
        description: `sector HHI ${metrics.sectorConcentration.toFixed(3)} > limit ${constraints.maxSectorConcentration}`,
      })
    }
    if (metrics.countryConcentration > constraints.maxCountryConcentration) {
      violations.push({
        constraint: 'maxCountryConcentration',
        actual: metrics.countryConcentration,
        limit: constraints.maxCountryConcentration,
        severity: 'MEDIUM',
        description: `country HHI ${metrics.countryConcentration.toFixed(3)} > limit ${constraints.maxCountryConcentration}`,
      })
    }
    if (metrics.exchangeConcentration > constraints.maxExchangeConcentration) {
      violations.push({
        constraint: 'maxExchangeConcentration',
        actual: metrics.exchangeConcentration,
        limit: constraints.maxExchangeConcentration,
        severity: 'LOW',
        description: `exchange HHI ${metrics.exchangeConcentration.toFixed(3)} > limit ${constraints.maxExchangeConcentration}`,
      })
    }
    if (metrics.currencyConcentration > constraints.maxCurrencyConcentration) {
      violations.push({
        constraint: 'maxCurrencyConcentration',
        actual: metrics.currencyConcentration,
        limit: constraints.maxCurrencyConcentration,
        severity: 'LOW',
        description: `currency HHI ${metrics.currencyConcentration.toFixed(3)} > limit ${constraints.maxCurrencyConcentration}`,
      })
    }
    if (metrics.strategyConcentration > constraints.maxStrategyConcentration) {
      violations.push({
        constraint: 'maxStrategyConcentration',
        actual: metrics.strategyConcentration,
        limit: constraints.maxStrategyConcentration,
        severity: 'MEDIUM',
        description: `strategy HHI ${metrics.strategyConcentration.toFixed(3)} > limit ${constraints.maxStrategyConcentration}`,
      })
    }
    if (metrics.effectiveAssetCount < constraints.minEffectiveAssetCount) {
      violations.push({
        constraint: 'minEffectiveAssetCount',
        actual: metrics.effectiveAssetCount,
        limit: constraints.minEffectiveAssetCount,
        severity: 'HIGH',
        description: `effective asset count ${metrics.effectiveAssetCount.toFixed(1)} < min ${constraints.minEffectiveAssetCount}`,
      })
    }

    // §9, Rule 13 — Liquidity capacity constraints
    if (metrics.maxParticipationRate > constraints.maxParticipationRate) {
      violations.push({
        constraint: 'maxParticipationRate',
        actual: metrics.maxParticipationRate,
        limit: constraints.maxParticipationRate,
        severity: 'CRITICAL',
        description: `max participation rate ${metrics.maxParticipationRate.toFixed(3)} > limit ${constraints.maxParticipationRate}`,
      })
    }
    if (metrics.estimatedSlippage > constraints.maxEstimatedSlippage) {
      violations.push({
        constraint: 'maxEstimatedSlippage',
        actual: metrics.estimatedSlippage,
        limit: constraints.maxEstimatedSlippage,
        severity: 'HIGH',
        description: `estimated slippage ${metrics.estimatedSlippage.toFixed(4)} > limit ${constraints.maxEstimatedSlippage}`,
      })
    }
    if (metrics.turnoverRatio > constraints.maxTurnover) {
      warnings.push({
        constraint: 'maxTurnover',
        actual: metrics.turnoverRatio,
        limit: constraints.maxTurnover,
        description: `turnover ${metrics.turnoverRatio.toFixed(3)} exceeds limit ${constraints.maxTurnover} (warning)`,
      })
    }

    return { violations, warnings }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────────

  private computeHHI(weights: number[]): number {
    return weights.reduce((sum, w) => sum + w * w, 0)
  }

  private aggregateByAttribute(
    assetWeights: AssetWeight[],
    assetMetadata: Map<string, AssetMetadata>,
    attribute: 'sector' | 'country' | 'exchange' | 'currency',
  ): number[] {
    const aggregated = new Map<string, number>()
    for (const w of assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const attr = meta?.[attribute] ?? 'UNKNOWN'
      aggregated.set(attr, (aggregated.get(attr) ?? 0) + Math.abs(w.targetWeight))
    }
    return Array.from(aggregated.values())
  }

  private aggregateByStrategy(assetWeights: AssetWeight[]): number[] {
    const aggregated = new Map<string, number>()
    for (const w of assetWeights) {
      for (const strategyId of w.contributingStrategies) {
        aggregated.set(strategyId, (aggregated.get(strategyId) ?? 0) + Math.abs(w.targetWeight) / Math.max(1, w.contributingStrategies.length))
      }
    }
    return Array.from(aggregated.values())
  }

  private computeLiquidityMetrics(
    assetWeights: AssetWeight[],
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
    delta: RebalancingDelta | null,
  ): {
    capacityUtilization: number
    maxParticipationRate: number
    avgParticipationRate: number
    estimatedSlippage: number
  } {
    let maxPart = 0
    let sumPart = 0
    let count = 0
    let maxCapacityUtil = 0
    let totalSlippage = 0

    for (const w of assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      if (!meta) continue
      const capital = Math.abs(w.targetWeight) * totalNav
      const participationRate = meta.averageDailyDollarVolume > 0
        ? capital / meta.averageDailyDollarVolume
        : 0
      const depthUtilization = meta.orderBookDepth > 0
        ? capital / meta.orderBookDepth
        : 0

      maxPart = Math.max(maxPart, participationRate)
      sumPart += participationRate
      count++
      maxCapacityUtil = Math.max(maxCapacityUtil, depthUtilization)

      // Estimated slippage: half-spread + square-root impact
      const slippage = meta.bidAskSpread * 0.5 + 0.1 * Math.sqrt(participationRate) * meta.bidAskSpread
      totalSlippage += Math.abs(w.targetWeight) * slippage
    }

    return {
      capacityUtilization: maxCapacityUtil,
      maxParticipationRate: maxPart,
      avgParticipationRate: count > 0 ? sumPart / count : 0,
      estimatedSlippage: totalSlippage,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton assessor
// ─────────────────────────────────────────────────────────────────────────────

export const diversificationAssessor = new DiversificationAssessor()
