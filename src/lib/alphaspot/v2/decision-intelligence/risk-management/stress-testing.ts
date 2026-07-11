// CHAPTER 5.4 §9 — Stress Testing Engine
//
// §9 — Every portfolio undergoes stress evaluation.
// Supported methodologies (§9):
//   • Historical Stress Testing
//   • Hypothetical Scenario Testing
//   • Monte Carlo Simulation
//   • Volatility Shock
//   • Liquidity Shock
//   • Correlation Breakdown
//   • Flash Crash Simulation
//   • Black Swan Scenarios
//
// Rule 9 — Stress testing logically INDEPENDENT from standard constraint evaluation.
// Rule 19 — All stress-testing methodologies versioned INDEPENDENTLY of
//           portfolio construction methodologies.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPortfolioContract } from '../portfolio-construction/types'
import type { AssetMetadata } from '../portfolio-construction/types'
import type {
  StressTestConfiguration,
  StressTestMethod,
  StressTestParameters,
  StressTestResult,
} from './types'

const log = createLogger('decision-intelligence:risk-management:stress-testing')

// ─────────────────────────────────────────────────────────────────────────────
// StressTestMethodExecutor interface (§9 — algorithm-independent, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface StressTestMethodExecutor {
  method: StressTestMethod
  version: string // Rule 19
  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Volatility Shock (§9)
// Simulates a sudden increase in asset volatility.
// ─────────────────────────────────────────────────────────────────────────────

export class VolatilityShockExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'VOLATILITY_SHOCK'
  version = '1.0.0' // Rule 19

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const volMultiplier = params.customParams.volMultiplier ?? 2.0
    const shockMagnitude = params.shockMagnitude

    let projectedLoss = 0
    const assetImpacts: Array<{ symbol: string; impact: number }> = []

    for (const w of portfolio.assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const baseVol = meta?.volatility ?? 0.5
      const shockedVol = baseVol * volMultiplier
      // Loss ≈ weight * shocked_vol * z_score(95%) * shock_factor
      // Normalized: vol is annualized (e.g., 0.6 = 60%/year). For a 1-day shock,
      // scale by sqrt(1/365). Shock magnitude scales the impact further.
      const zScore = 1.645 // 95% one-tailed
      const dailyVol = shockedVol / Math.sqrt(365) // annualized → daily
      const assetLoss = Math.abs(w.targetWeight) * dailyVol * zScore * shockMagnitude * 10
      projectedLoss += assetLoss
      assetImpacts.push({ symbol: w.symbol, impact: -assetLoss })
    }

    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.2 // 20% worse than VaR
    const liquidationProbability = Math.min(1, projectedLoss * 5)

    return {
      method: this.method,
      scenario: `Volatility shock ${volMultiplier}x`,
      passed: projectedLoss <= params.customParams.maxAcceptableLoss ?? 0.20,
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Volatility multiplied by ${volMultiplier}x; projected loss ${(projectedLoss * 100).toFixed(2)}% of NAV`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Liquidity Shock (§9)
// Simulates sudden reduction in market liquidity.
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidityShockExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'LIQUIDITY_SHOCK'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const participationReduction = params.customParams.participationReduction ?? 0.5
    const shockMagnitude = params.shockMagnitude

    let projectedLoss = 0
    const assetImpacts: Array<{ symbol: string; impact: number }> = []

    for (const w of portfolio.assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      // Liquidity shock increases slippage
      const baseSlippage = meta?.bidAskSpread ?? 0.001
      const shockedSlippage = baseSlippage / Math.max(0.1, participationReduction)
      const assetLoss = Math.abs(w.targetWeight) * shockedSlippage * shockMagnitude * 5
      projectedLoss += assetLoss
      assetImpacts.push({ symbol: w.symbol, impact: -assetLoss })
    }

    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.3
    const liquidationProbability = Math.min(1, projectedLoss * 3)

    return {
      method: this.method,
      scenario: `Liquidity shock (participation reduced to ${(participationReduction * 100).toFixed(0)}%)`,
      passed: projectedLoss <= 0.20,
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Market liquidity reduced; slippage increased; projected loss ${(projectedLoss * 100).toFixed(2)}%`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Correlation Breakdown (§9)
// Simulates correlations increasing toward 1.0 (diversification fails).
// ─────────────────────────────────────────────────────────────────────────────

export class CorrelationBreakdownExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'CORRELATION_BREAKDOWN'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const correlationMultiplier = params.customParams.correlationMultiplier ?? 1.5
    const shockMagnitude = params.shockMagnitude

    // When correlations increase, portfolio volatility increases
    const basePortfolioVol = portfolio.allocationPlan.grossExposure * 0.5 // estimate
    const shockedPortfolioVol = basePortfolioVol * correlationMultiplier
    const zScore = 1.645
    const projectedLoss = shockedPortfolioVol * zScore * shockMagnitude * 0.5

    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.4
    const liquidationProbability = Math.min(1, projectedLoss * 4)

    const assetImpacts = portfolio.assetWeights.map((w) => ({
      symbol: w.symbol,
      impact: -Math.abs(w.targetWeight) * shockMagnitude * 0.3,
    }))

    return {
      method: this.method,
      scenario: `Correlation breakdown (${correlationMultiplier}x)`,
      passed: projectedLoss <= 0.20,
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Correlations multiplied by ${correlationMultiplier}x; diversification benefit reduced; projected loss ${(projectedLoss * 100).toFixed(2)}%`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Flash Crash Simulation (§9)
// Simulates a rapid severe price drop with partial recovery.
// ─────────────────────────────────────────────────────────────────────────────

export class FlashCrashExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'FLASH_CRASH_SIMULATION'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    _assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const shockMagnitude = params.shockMagnitude
    const recoveryTime = params.customParams.recoveryTime ?? 1800000
    const confidenceLevel = params.confidenceLevel

    // Flash crash: immediate drop of shockMagnitude, partial recovery
    const immediateDrop = shockMagnitude
    const recoveryFraction = 0.5 // 50% recovery
    const projectedLoss = immediateDrop * (1 - recoveryFraction)

    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.5 // worse than VaR
    const liquidationProbability = Math.min(1, projectedLoss * 8) // high liquidation risk during flash crash

    const assetImpacts = portfolio.assetWeights.map((w) => ({
      symbol: w.symbol,
      impact: -Math.abs(w.targetWeight) * immediateDrop * (1 - recoveryFraction),
    }))

    return {
      method: this.method,
      scenario: `Flash crash ${(shockMagnitude * 100).toFixed(0)}% drop with ${(recoveryFraction * 100).toFixed(0)}% recovery in ${recoveryTime / 60000}min`,
      passed: projectedLoss <= 0.20,
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Flash crash at ${(confidenceLevel * 100).toFixed(1)}% confidence; projected loss ${(projectedLoss * 100).toFixed(2)}%`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Historical Stress Testing (§9)
// Replays historical crisis events (e.g., 2020-03 COVID crash).
// ─────────────────────────────────────────────────────────────────────────────

export class HistoricalStressExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'HISTORICAL_STRESS'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    _assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const historicalEvent = params.customParams.historicalEvent ?? '2020-03-COVID'
    const shockMagnitude = params.shockMagnitude

    // Historical events have known loss magnitudes
    const eventLosses: Record<string, number> = {
      '2020-03-COVID': 0.35,
      '2018-02-CRYPTO_CRASH': 0.25,
      '2022-05-LUNA': 0.40,
      '2022-11-FTX': 0.30,
    }
    const eventLoss = eventLosses[historicalEvent] ?? shockMagnitude
    const projectedLoss = eventLoss * 0.6 // 60% of historical loss applies

    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.3
    const liquidationProbability = Math.min(1, projectedLoss * 5)

    const assetImpacts = portfolio.assetWeights.map((w) => ({
      symbol: w.symbol,
      impact: -Math.abs(w.targetWeight) * projectedLoss,
    }))

    return {
      method: this.method,
      scenario: `Historical event: ${historicalEvent}`,
      passed: projectedLoss <= 0.20,
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Replay of ${historicalEvent}; projected loss ${(projectedLoss * 100).toFixed(2)}%`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Hypothetical Scenario Testing (§9)
// Tests against user-defined hypothetical scenarios.
// ─────────────────────────────────────────────────────────────────────────────

export class HypotheticalScenarioExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'HYPOTHETICAL_SCENARIO'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    _assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const shockMagnitude = params.shockMagnitude
    const projectedLoss = shockMagnitude * 0.7

    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.2
    const liquidationProbability = Math.min(1, projectedLoss * 4)

    const assetImpacts = portfolio.assetWeights.map((w) => ({
      symbol: w.symbol,
      impact: -Math.abs(w.targetWeight) * shockMagnitude * 0.5,
    }))

    return {
      method: this.method,
      scenario: `Hypothetical scenario (${(shockMagnitude * 100).toFixed(0)}% shock)`,
      passed: projectedLoss <= 0.20,
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Hypothetical ${(shockMagnitude * 100).toFixed(0)}% market shock; projected loss ${(projectedLoss * 100).toFixed(2)}%`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Monte Carlo Simulation (§9)
// Generates random paths and computes portfolio loss distribution.
// ─────────────────────────────────────────────────────────────────────────────

export class MonteCarloExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'MONTE_CARLO_SIMULATION'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const paths = params.monteCarloPaths
    const confidenceLevel = params.confidenceLevel

    // Simulate portfolio returns using simple Gaussian model
    let portfolioVol = 0
    for (const w of portfolio.assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const vol = meta?.volatility ?? 0.5
      portfolioVol += Math.pow(w.targetWeight * vol, 2)
    }
    portfolioVol = Math.sqrt(portfolioVol)

    // Generate path losses (deterministic pseudo-random for reproducibility)
    const losses: number[] = []
    let seed = 42
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    const gaussian = () => {
      const u1 = Math.max(1e-10, random())
      const u2 = random()
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    }

    for (let i = 0; i < paths; i++) {
      const z = gaussian()
      const loss = Math.max(0, -z * portfolioVol)
      losses.push(loss)
    }
    losses.sort((a, b) => b - a) // descending

    const varIndex = Math.floor(paths * (1 - confidenceLevel))
    const valueAtRisk = (losses[varIndex] ?? 0) * totalNav
    const expectedShortfall = (losses.slice(0, varIndex).reduce((s, l) => s + l, 0) / Math.max(1, varIndex)) * totalNav
    const projectedLoss = valueAtRisk / totalNav
    const liquidationProbability = Math.min(1, projectedLoss * 6)

    const assetImpacts = portfolio.assetWeights.map((w) => ({
      symbol: w.symbol,
      impact: -Math.abs(w.targetWeight) * projectedLoss * 0.5,
    }))

    return {
      method: this.method,
      scenario: `Monte Carlo ${paths} paths at ${(confidenceLevel * 100).toFixed(1)}% confidence`,
      passed: projectedLoss <= 0.20,
      projectedLoss,
      projectedValue: totalNav - valueAtRisk,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `${paths} Monte Carlo paths; VaR ${(projectedLoss * 100).toFixed(2)}% at ${(confidenceLevel * 100).toFixed(1)}% confidence`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Black Swan Scenarios (§9)
// Extreme tail-risk events (very rare, very severe).
// ─────────────────────────────────────────────────────────────────────────────

export class BlackSwanExecutor implements StressTestMethodExecutor {
  method: StressTestMethod = 'BLACK_SWAN_SCENARIOS'
  version = '1.0.0'

  execute(
    portfolio: CanonicalPortfolioContract,
    params: StressTestParameters,
    _assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult {
    const shockMagnitude = params.shockMagnitude
    const confidenceLevel = params.confidenceLevel

    // Black swan: extreme loss at 99.9% confidence
    const projectedLoss = shockMagnitude // full shock magnitude
    const projectedValue = totalNav * (1 - projectedLoss)
    const valueAtRisk = projectedLoss * totalNav
    const expectedShortfall = valueAtRisk * 1.5
    const liquidationProbability = Math.min(1, projectedLoss * 10)

    const assetImpacts = portfolio.assetWeights.map((w) => ({
      symbol: w.symbol,
      impact: -Math.abs(w.targetWeight) * shockMagnitude,
    }))

    return {
      method: this.method,
      scenario: `Black swan (${(shockMagnitude * 100).toFixed(0)}% loss at ${(confidenceLevel * 100).toFixed(1)}% confidence)`,
      passed: false, // Black swan scenarios always fail (by design)
      projectedLoss,
      projectedValue,
      valueAtRisk,
      expectedShortfall,
      liquidationProbability,
      assetImpacts,
      causedRejection: projectedLoss > 0.20,
      methodVersion: this.version,
      description: `Extreme tail-risk event; projected loss ${(projectedLoss * 100).toFixed(2)}%`,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// StressTestingEngine — orchestrates all stress test methods (§9, Rule 9, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export class StressTestingEngine {
  private executors = new Map<StressTestMethod, StressTestMethodExecutor>()

  constructor() {
    // Register all 8 stress test methods (§9)
    this.register(new VolatilityShockExecutor())
    this.register(new LiquidityShockExecutor())
    this.register(new CorrelationBreakdownExecutor())
    this.register(new FlashCrashExecutor())
    this.register(new HistoricalStressExecutor())
    this.register(new HypotheticalScenarioExecutor())
    this.register(new MonteCarloExecutor())
    this.register(new BlackSwanExecutor())
  }

  register(executor: StressTestMethodExecutor): void {
    this.executors.set(executor.method, executor)
    log.info(`registered stress test method: ${executor.method} v${executor.version}`)
  }

  /**
   * Run all enabled stress tests (§9, Rule 9 — independent from constraint eval).
   * Returns results for each method.
   */
  runAll(
    portfolio: CanonicalPortfolioContract,
    config: StressTestConfiguration,
    assetMetadata: Map<string, AssetMetadata>,
    totalNav: number,
  ): StressTestResult[] {
    const results: StressTestResult[] = []

    for (const method of config.enabledMethods) {
      const executor = this.executors.get(method)
      if (!executor) {
        log.warn(`stress test method ${method} not registered — skipping`)
        continue
      }
      const params = config.parameters[method]
      if (!params) {
        log.warn(`no parameters for stress test ${method} — skipping`)
        continue
      }
      try {
        const result = executor.execute(portfolio, params, assetMetadata, totalNav)
        results.push(result)
        log.debug(
          `stress test ${method}: ${result.passed ? 'PASS' : 'FAIL'} — projected loss ${(result.projectedLoss * 100).toFixed(2)}%`,
        )
      } catch (e) {
        log.error(`stress test ${method} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return results
  }

  listMethods(): StressTestMethod[] {
    return Array.from(this.executors.keys())
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton engine
// ─────────────────────────────────────────────────────────────────────────────

export const stressTestingEngine = new StressTestingEngine()
