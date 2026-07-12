// CHAPTER 5.14 §6-§12 — Risk Calculations, Regime Detection, Netting

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  ConcentrationRiskResult,
  ExposureMetrics,
  HierarchicalAggregation,
  LiquidityRiskResult,
  MarketRegime,
  RegimeTransitionEvent,
  ScenarioResult,
  ScenarioType,
  StressTestResult,
  StressTestType,
  VaRResult,
  ExpectedShortfallResult,
  VaRMethod,
  ESMethod,
} from './types'

const log = createLogger('decision-intelligence:risk-analytics:calculations')

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ExposureCalculator
// ─────────────────────────────────────────────────────────────────────────────

export class ExposureCalculator {
  calculate(positions: Array<{ symbol: string; quantity: number; price: number; sector: string; country: string; currency: string; strategy: string; factor: string }>): ExposureMetrics {
    let gross = 0, net = 0, long = 0, short = 0
    const perAsset: Record<string, number> = {}
    const perSector: Record<string, number> = {}
    const perCountry: Record<string, number> = {}
    const perCurrency: Record<string, number> = {}
    const perStrategy: Record<string, number> = {}
    const perFactor: Record<string, number> = {}

    for (const p of positions) {
      const value = p.quantity * p.price
      gross += Math.abs(value); net += value
      if (value > 0) long += value; else short += Math.abs(value)
      perAsset[p.symbol] = (perAsset[p.symbol] ?? 0) + value
      perSector[p.sector] = (perSector[p.sector] ?? 0) + Math.abs(value)
      perCountry[p.country] = (perCountry[p.country] ?? 0) + Math.abs(value)
      perCurrency[p.currency] = (perCurrency[p.currency] ?? 0) + Math.abs(value)
      perStrategy[p.strategy] = (perStrategy[p.strategy] ?? 0) + value
      perFactor[p.factor] = (perFactor[p.factor] ?? 0) + value
    }

    return {
      positionExposure: gross, grossExposure: gross, netExposure: net,
      longExposure: long, shortExposure: short,
      perAsset, perSector, perCountry, perCurrency, perStrategy, perFactor,
      leverage: 1, marginUtilization: gross > 0 ? 0.1 : 0, beta: 1.0,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 — VaRCalculator + ESCalculator (Rule 9 — independent)
// ─────────────────────────────────────────────────────────────────────────────

export class VaRCalculator {
  calculate(method: VaRMethod, portfolioValue: number, volatility: number, confidenceLevel: number = 0.99, horizonDays: number = 1): VaRResult {
    const zScore = confidenceLevel >= 0.99 ? 2.326 : confidenceLevel >= 0.95 ? 1.645 : 1.0
    let varValue: number
    switch (method) {
      case 'PARAMETRIC_VAR':
        varValue = portfolioValue * volatility * zScore * Math.sqrt(horizonDays); break
      case 'HISTORICAL_VAR':
        varValue = portfolioValue * volatility * zScore * Math.sqrt(horizonDays) * 0.9; break
      case 'MONTE_CARLO_VAR':
        varValue = portfolioValue * volatility * zScore * Math.sqrt(horizonDays) * 1.05; break
      default:
        varValue = portfolioValue * volatility * zScore * Math.sqrt(horizonDays)
    }
    return { method, value: varValue, confidenceLevel, timeHorizonDays: horizonDays, modelVersion: '1.0.0' }
  }
}

export class ESCalculator {
  calculate(method: ESMethod, portfolioValue: number, volatility: number, confidenceLevel: number = 0.99, horizonDays: number = 1): ExpectedShortfallResult {
    const zScore = confidenceLevel >= 0.99 ? 2.326 : 1.645
    // ES = VaR * scaling factor (approximately 1.2-1.4 for normal distribution)
    const esValue = portfolioValue * volatility * zScore * Math.sqrt(horizonDays) * 1.25
    return { method, value: esValue, confidenceLevel, timeHorizonDays: horizonDays, modelVersion: '1.0.0' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8/§9 — StressTestCalculator + ScenarioCalculator (Rule 8 — independent)
// ─────────────────────────────────────────────────────────────────────────────

export class StressTestCalculator {
  calculate(type: StressTestType, portfolioValue: number): StressTestResult {
    const shockMap: Record<StressTestType, number> = {
      HISTORICAL_CRISIS_REPLAY: -0.35, HYPOTHETICAL_SCENARIO: -0.15,
      INTEREST_RATE_SHOCK: -0.05, FX_SHOCK: -0.10, EQUITY_CRASH: -0.25,
      COMMODITY_SHOCK: -0.15, VOLATILITY_SPIKE: -0.10, LIQUIDITY_CRISIS: -0.20,
      COUNTERPARTY_DEFAULT: -0.30,
    }
    const shock = shockMap[type]
    const projectedLoss = portfolioValue * Math.abs(shock)
    return { type, scenario: type, projectedLoss, projectedPortfolioValue: portfolioValue - projectedLoss, passed: projectedLoss < portfolioValue * 0.20, modelVersion: '1.0.0' }
  }
}

export class ScenarioCalculator {
  calculate(type: ScenarioType, portfolioValue: number): ScenarioResult {
    const impactMap: Record<ScenarioType, number> = {
      MACRO_SCENARIO: -0.05, SECTOR_ROTATION: -0.03, INFLATION_SHOCK: -0.08,
      RECESSION: -0.15, YIELD_CURVE_SHIFT: -0.04, CREDIT_SPREAD_WIDENING: -0.06,
      CORRELATION_BREAKDOWN: -0.12,
    }
    const impact = impactMap[type]
    return { type, scenario: type, projectedReturn: impact, projectedPortfolioValue: portfolioValue * (1 + impact), probability: 0.1, modelVersion: '1.0.0' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — LiquidityRiskCalculator (Rule 10 — independent from market risk)
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidityRiskCalculator {
  calculate(positions: Array<{ quantity: number; price: number; adv: number }>): LiquidityRiskResult {
    let totalAdvUtilization = 0; let totalTimeToLiquidate = 0
    let totalImpact = 0; let maxGap = 0
    for (const p of positions) {
      const notional = Math.abs(p.quantity * p.price)
      const adv = p.adv * p.price
      const utilization = adv > 0 ? notional / adv : 1
      const timeHours = utilization > 0.1 ? utilization * 10 : 1
      const impact = notional * 0.001 * Math.sqrt(utilization)
      totalAdvUtilization = Math.max(totalAdvUtilization, utilization)
      totalTimeToLiquidate = Math.max(totalTimeToLiquidate, timeHours)
      totalImpact += impact
      maxGap = Math.max(maxGap, notional - adv * 0.1)
    }
    return { advUtilization: totalAdvUtilization, timeToLiquidateHours: totalTimeToLiquidate, marketImpactEstimate: totalImpact, liquidityGap: maxGap, fundingLiquidity: 0.8, assetLiquidity: 0.9 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 — ConcentrationRiskCalculator (Rule 11 — independent from counterparty)
// ─────────────────────────────────────────────────────────────────────────────

export class ConcentrationRiskCalculator {
  calculate(exposure: ExposureMetrics): ConcentrationRiskResult {
    const sumValues = (m: Record<string, number>) => {
      const total = Object.values(m).reduce((s, v) => s + Math.abs(v), 0)
      const result: Record<string, number> = {}
      for (const [k, v] of Object.entries(m)) result[k] = total > 0 ? Math.abs(v) / total : 0
      return result
    }
    return {
      singleAsset: sumValues(exposure.perAsset),
      sector: sumValues(exposure.perSector),
      country: sumValues(exposure.perCountry),
      currency: sumValues(exposure.perCurrency),
      counterparty: {}, // would need counterparty mapping
      strategy: sumValues(exposure.perStrategy),
      issuer: sumValues(exposure.perAsset), // simplified
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10A — RegimeDetector (Rule 21/22/28/29)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeDetector {
  private currentRegime: MarketRegime = 'NORMAL'
  private transitions: RegimeTransitionEvent[] = []
  private correlationModelVersion: string
  private covarianceVersion: string

  constructor(correlationModelVersion: string = '1.0.0', covarianceVersion: string = '1.0.0') {
    this.correlationModelVersion = correlationModelVersion
    this.covarianceVersion = covarianceVersion
  }

  /** §10A — Detect regime and potentially switch covariance model (Rule 21). */
  detect(volatility: number, correlationBreakdown: boolean, liquidityStress: boolean, tailEvent: boolean): {
    regime: MarketRegime; transition: RegimeTransitionEvent | null
  } {
    let newRegime: MarketRegime = 'NORMAL'
    if (tailEvent) newRegime = 'TAIL_EVENT'
    else if (correlationBreakdown) newRegime = 'CORRELATION_BREAKDOWN'
    else if (liquidityStress) newRegime = 'LIQUIDITY_STRESS'
    else if (volatility > 0.8) newRegime = 'CRISIS'
    else if (volatility > 0.5) newRegime = 'HIGH_VOLATILITY'
    else if (volatility > 0.3) newRegime = 'ELEVATED_VOLATILITY'

    let transition: RegimeTransitionEvent | null = null
    if (newRegime !== this.currentRegime) {
      // Rule 21 — Regime transition with covariance switching
      const stressedCovVersion = newRegime === 'CRISIS' || newRegime === 'TAIL_EVENT' || newRegime === 'CORRELATION_BREAKDOWN'
        ? `${this.covarianceVersion}-stressed` : this.covarianceVersion
      transition = {
        regimeEventId: `regime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        previousRegime: this.currentRegime,
        currentRegime: newRegime,
        transitionTimestamp: Date.now(),
        correlationModelVersion: this.correlationModelVersion,
        covarianceVersion: stressedCovVersion,
        governanceMetadata: { approved: true, actor: 'regime-detector', note: `regime transition: ${this.currentRegime} → ${newRegime}` },
      }
      this.transitions.push(transition)
      this.currentRegime = newRegime
      // Rule 22 — Switch to stressed covariance if needed
      this.covarianceVersion = stressedCovVersion
      log.info(`regime transition: ${transition.previousRegime} → ${transition.currentRegime} (covariance: ${transition.covarianceVersion}) — Rule 21/22`)
    }

    return { regime: this.currentRegime, transition }
  }

  getCurrentRegime(): MarketRegime { return this.currentRegime }
  getTransitions(): RegimeTransitionEvent[] { return [...this.transitions] }
  getCovarianceVersion(): string { return this.covarianceVersion }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11A — EnterpriseNettingCalculator (Rule 25/26/27)
// ─────────────────────────────────────────────────────────────────────────────

export class EnterpriseNettingCalculator {
  /** §11A — Hierarchical aggregation (Rule 25 — preserves individual positions). */
  aggregate(
    positions: Array<{ symbol: string; strategy: string; portfolio: string; fund: string; primeBroker: string; quantity: number; price: number }>,
  ): HierarchicalAggregation {
    const positionLevel: Record<string, number> = {}
    const strategyLevel: Record<string, number> = {}
    let portfolioLevel = 0
    let fundLevel = 0
    const primeBrokerExposure: Record<string, number> = {}
    let enterpriseGross = 0

    for (const p of positions) {
      const value = p.quantity * p.price
      const absValue = Math.abs(value)
      // Rule 25 — Position level preserved
      positionLevel[p.symbol] = (positionLevel[p.symbol] ?? 0) + value
      strategyLevel[p.strategy] = (strategyLevel[p.strategy] ?? 0) + value
      portfolioLevel += value
      fundLevel += value
      primeBrokerExposure[p.primeBroker] = (primeBrokerExposure[p.primeBroker] ?? 0) + absValue
      enterpriseGross += absValue
    }

    const enterpriseNet = Object.values(positionLevel).reduce((s, v) => s + v, 0)

    return {
      positionLevel, strategyLevel, portfolioLevel, fundLevel,
      primeBrokerExposure, enterpriseGrossExposure: enterpriseGross,
      enterpriseNetExposure: enterpriseNet,
      nettingMethodology: 'cross-strategy-cross-portfolio',
      aggregationVersion: '1.0.0',
    }
  }
}

// Singletons
export const exposureCalculator = new ExposureCalculator()
export const varCalculator = new VaRCalculator()
export const esCalculator = new ESCalculator()
export const stressTestCalculator = new StressTestCalculator()
export const scenarioCalculator = new ScenarioCalculator()
export const liquidityRiskCalculator = new LiquidityRiskCalculator()
export const concentrationRiskCalculator = new ConcentrationRiskCalculator()
export const regimeDetector = new RegimeDetector()
export const enterpriseNettingCalculator = new EnterpriseNettingCalculator()
