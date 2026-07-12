// CHAPTER 5.13 §7-§11 — PnL, Returns, Attribution, Valuation, Benchmark, Risk-Adjusted

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AttributionBreakdown,
  BenchmarkData,
  DerivativeAttribution,
  PnLBreakdown,
  PricingSnapshot,
  ReturnMetrics,
  RiskAdjustedMetrics,
  ValuationState,
} from './types'

const log = createLogger('decision-intelligence:pnl-performance:calculations')

// ─────────────────────────────────────────────────────────────────────────────
// §7 — PnLCalculator (Rule 8 — independent from attribution)
// ─────────────────────────────────────────────────────────────────────────────

export class PnLCalculator {
  calculate(
    realizedPnL: number,
    unrealizedPnL: number,
    fxPnL: number,
    fundingPnL: number,
    borrowCost: number,
    dividendIncome: number,
    interestIncome: number,
    transactionCost: number,
    slippageCost: number,
  ): PnLBreakdown {
    const totalPnL = realizedPnL + unrealizedPnL
    const carryPnL = dividendIncome + interestIncome - borrowCost - fundingPnL
    return {
      realizedPnL, unrealizedPnL, totalPnL, fxPnL, fundingPnL, borrowCost,
      dividendIncome, interestIncome, transactionCost, slippageCost, carryPnL,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — ReturnCalculator
// ─────────────────────────────────────────────────────────────────────────────

export class ReturnCalculator {
  calculate(beginValue: number, endValue: number, periodDays: number = 1): ReturnMetrics {
    const absoluteReturn = endValue - beginValue
    const simpleReturn = beginValue > 0 ? (endValue - beginValue) / beginValue : 0
    const logReturn = beginValue > 0 && endValue > 0 ? Math.log(endValue / beginValue) : 0
    // TWR (simplified — no cash flows)
    const twr = simpleReturn
    // MWR (simplified)
    const mwr = simpleReturn
    // Modified Dietz (simplified — no cash flows)
    const modifiedDietz = simpleReturn
    // Geometric
    const geometricReturn = endValue > 0 && beginValue > 0 ? endValue / beginValue - 1 : 0
    // Annualized
    const annualPeriods = periodDays > 0 ? 365 / periodDays : 1
    const annualizedReturn = simpleReturn !== 0 ? Math.pow(1 + simpleReturn, annualPeriods) - 1 : 0
    // Cumulative
    const cumulativeReturn = simpleReturn

    return { absoluteReturn, simpleReturn, logReturn, twr, mwr, modifiedDietz, geometricReturn, annualizedReturn, cumulativeReturn }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9/§9A — AttributionCalculator (Rule 8/23 — independent from PnL)
// ─────────────────────────────────────────────────────────────────────────────

export class AttributionCalculator {
  calculate(
    strategyPnL: Record<string, number>,
    assetPnL: Record<string, number>,
    sectorPnL: Record<string, number>,
    countryPnL: Record<string, number>,
    currencyPnL: Record<string, number>,
    factorPnL: Record<string, number>,
    allocationEffect: number,
    selectionEffect: number,
    derivative: DerivativeAttribution,
  ): AttributionBreakdown {
    return {
      strategyAttribution: strategyPnL,
      assetAttribution: assetPnL,
      sectorAttribution: sectorPnL,
      countryAttribution: countryPnL,
      currencyAttribution: currencyPnL,
      factorAttribution: factorPnL,
      allocationEffect,
      selectionEffect,
      interactionEffect: allocationEffect * selectionEffect,
      // Rule 23 — Derivative attribution mathematically independent
      derivativeAttribution: derivative,
    }
  }

  /** §9A — Calculate derivative attribution (Rule 23 — independent from price/benchmark). */
  calculateDerivativeAttribution(
    delta: number, gamma: number, vega: number, theta: number, rho: number,
    crossGamma: number, volatility: number, carry: number, funding: number,
    borrow: number, financingCost: number, crossAsset: number,
  ): DerivativeAttribution {
    return {
      deltaAttribution: delta, gammaAttribution: gamma, vegaAttribution: vega,
      thetaAttribution: theta, rhoAttribution: rho, crossGammaAttribution: crossGamma,
      volatilityAttribution: volatility, carryAttribution: carry, fundingAttribution: funding,
      borrowAttribution: borrow, financingCostAttribution: financingCost, crossAssetAttribution: crossAsset,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10/§10A — ValuationManager + BenchmarkManager
// Rule 21 — Intraday independent from Official EOD.
// Rule 22 — Official EOD uses only approved pricing sources.
// ─────────────────────────────────────────────────────────────────────────────

export class ValuationManager {
  private snapshots = new Map<string, PricingSnapshot[]>()

  /** §10A — Add pricing snapshot (Rule 25 — immutable). */
  addSnapshot(snapshot: PricingSnapshot): void {
    const key = snapshot.symbol
    const list = this.snapshots.get(key) ?? []
    list.push(snapshot)
    this.snapshots.set(key, list)
  }

  /** §10A — Get latest snapshot for symbol. */
  getLatest(symbol: string, state?: ValuationState): PricingSnapshot | null {
    const list = this.snapshots.get(symbol)
    if (!list || list.length === 0) return null
    if (state) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].valuationState === state) return list[i]
      }
    }
    return list[list.length - 1]
  }

  /** Rule 21 — Get intraday (streaming) vs official EOD independently. */
  getBifurcatedValuation(symbol: string): { intraday: PricingSnapshot | null; official: PricingSnapshot | null } {
    return {
      intraday: this.getLatest(symbol, 'STREAMING_INTRADAY'),
      official: this.getLatest(symbol, 'OFFICIAL_EOD'),
    }
  }

  /** §10A — Valuation freeze. */
  freeze(symbol: string, currentTime: number = Date.now()): PricingSnapshot | null {
    const latest = this.getLatest(symbol)
    if (!latest) return null
    const frozen: PricingSnapshot = {
      ...latest, snapshotId: `frozen-${currentTime.toString(36)}`,
      valuationState: 'FROZEN', timestamp: currentTime,
    }
    this.addSnapshot(frozen)
    return frozen
  }

  /** §10A — Valuation restatement (Rule 24 — new immutable version). */
  restate(symbol: string, newPrice: number, reason: string, currentTime: number = Date.now()): PricingSnapshot | null {
    const latest = this.getLatest(symbol)
    if (!latest) return null
    const restated: PricingSnapshot = {
      ...latest, snapshotId: `restated-${currentTime.toString(36)}`,
      price: newPrice, valuationState: 'RESTATEMENT', timestamp: currentTime,
    }
    this.addSnapshot(restated)
    log.info(`valuation restated: ${symbol} → ${newPrice} (${reason}) — Rule 24: new immutable version`)
    return restated
  }
}

export class BenchmarkManager {
  /** §10 — Compute benchmark comparison (Rule 9 — independent from portfolio returns). */
  compare(portfolioReturn: number, benchmark: BenchmarkData): {
    activeReturn: number
    trackingDifference: number
    relativePerformance: number
  } {
    return {
      activeReturn: portfolioReturn - benchmark.returnRate,
      trackingDifference: portfolioReturn - benchmark.returnRate,
      relativePerformance: portfolioReturn / Math.max(0.0001, benchmark.returnRate) - 1,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — RiskAdjustedCalculator (Rule 10 — independent from raw returns)
// ─────────────────────────────────────────────────────────────────────────────

export class RiskAdjustedCalculator {
  /** §11 — Calculate risk-adjusted metrics (Rule 10 — independent from raw returns). */
  calculate(
    portfolioReturn: number,
    riskFreeRate: number,
    volatility: number,
    downsideDeviation: number,
    benchmarkReturn: number,
    beta: number,
    maxDrawdown: number,
    avgPositiveReturn: number,
    avgNegativeReturn: number,
  ): RiskAdjustedMetrics {
    const excessReturn = portfolioReturn - riskFreeRate
    return {
      sharpeRatio: volatility > 0 ? excessReturn / volatility : 0,
      sortinoRatio: downsideDeviation > 0 ? excessReturn / downsideDeviation : 0,
      informationRatio: volatility > 0 ? (portfolioReturn - benchmarkReturn) / volatility : 0,
      treynorRatio: beta !== 0 ? excessReturn / beta : 0,
      jensensAlpha: portfolioReturn - (riskFreeRate + beta * (benchmarkReturn - riskFreeRate)),
      beta,
      calmarRatio: maxDrawdown !== 0 ? portfolioReturn / Math.abs(maxDrawdown) : 0,
      omegaRatio: avgNegativeReturn !== 0 ? avgPositiveReturn / Math.abs(avgNegativeReturn) : 0,
      maxDrawdown,
      volatility,
    }
  }
}

// Singletons
export const pnlCalculator = new PnLCalculator()
export const returnCalculator = new ReturnCalculator()
export const attributionCalculator = new AttributionCalculator()
export const valuationManager = new ValuationManager()
export const benchmarkManager = new BenchmarkManager()
export const riskAdjustedCalculator = new RiskAdjustedCalculator()
