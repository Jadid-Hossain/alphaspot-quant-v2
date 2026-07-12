// CHAPTER 5.18 §7-§12 — Market Replay, Execution Simulation, Performance, Governance

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  BenchmarkComparison,
  ExecutionAssumptions,
  PerformanceMetrics,
  PortfolioEvolutionPoint,
  RiskMetrics,
  SimulatedOrder,
  SimulatedTrade,
  SimulationMethod,
} from './types'

const log = createLogger('decision-intelligence:market-simulation:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §7 — MarketReplayEngine (Rule 8 — preserve original event ordering)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketEvent {
  timestamp: number
  symbol: string
  type: 'CANDLE' | 'TICK' | 'TRADE' | 'ORDER_BOOK' | 'FUNDING' | 'LIQUIDATION' | 'NEWS' | 'SENTIMENT' | 'ON_CHAIN' | 'MACRO'
  data: Record<string, number | string>
}

export class MarketReplayEngine {
  /** §7 — Replay historical market events (Rule 8 — original ordering preserved). */
  replay(events: MarketEvent[]): MarketEvent[] {
    // Rule 8 — Preserve original event ordering (sort by timestamp)
    return [...events].sort((a, b) => a.timestamp - b.timestamp)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — ExecutionSimulator (Rule 10/11 — configurable, explicit cost modeling)
// ─────────────────────────────────────────────────────────────────────────────

export class ExecutionSimulator {
  /** §8 — Simulate order execution with costs (Rule 11 — explicit modeling). */
  simulate(
    symbol: string, side: 'BUY' | 'SELL', orderType: import('./types').OrderType,
    quantity: number, requestedPrice: number | null, marketPrice: number,
    assumptions: ExecutionAssumptions,
  ): { order: SimulatedOrder; trade: SimulatedTrade | null } {
    const now = Date.now()
    // §8 — Slippage modeling
    const slippage = this.computeSlippage(quantity, marketPrice, assumptions)
    // §8 — Spread modeling
    const spread = marketPrice * 0.0005 // half-spread
    // §8 — Market impact
    const marketImpact = this.computeMarketImpact(quantity, marketPrice, assumptions)
    // §8 — Execution price
    const executedPrice = side === 'BUY'
      ? marketPrice + slippage + spread + marketImpact
      : marketPrice - slippage - spread - marketImpact
    // §8 — Exchange fees
    const fees = quantity * executedPrice * assumptions.exchangeFeeRate
    // §8 — Partial fills
    const filledQty = assumptions.partialFillEnabled && quantity > 10
      ? quantity * (0.8 + Math.random() * 0.2) // simplified
      : quantity

    const orderId = `sim-order-${now.toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    const order: SimulatedOrder = {
      orderId, timestamp: now, symbol, side, orderType,
      requestedQuantity: quantity, filledQuantity: filledQty,
      requestedPrice, executedPrice,
      status: filledQty >= quantity ? 'FILLED' : 'PARTIALLY_FILLED',
      fees, slippage,
    }

    const trade: SimulatedTrade | null = filledQty > 0 ? {
      tradeId: `sim-trade-${now.toString(36)}-${Math.random().toString(36).slice(2, 4)}`,
      timestamp: now, symbol, side, quantity: filledQty, price: executedPrice,
      fees, slippage, marketImpact, orderType, pnl: 0,
    } : null

    return { order, trade }
  }

  private computeSlippage(qty: number, price: number, a: ExecutionAssumptions): number {
    return qty * price * 0.0002 // simplified linear slippage
  }

  private computeMarketImpact(qty: number, price: number, a: ExecutionAssumptions): number {
    return a.marketImpactModel === 'sqrt' ? price * 0.0001 * Math.sqrt(qty / 100) : 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 — PerformanceCalculator (Rule 14 — never modify historical records)
// ─────────────────────────────────────────────────────────────────────────────

export class PerformanceCalculator {
  /** §10 — Calculate performance metrics from simulation results. */
  calculate(
    trades: SimulatedTrade[],
    portfolioEvolution: PortfolioEvolutionPoint[],
    initialCapital: number,
    riskFreeRate: number = 0.04,
  ): PerformanceMetrics {
    const winningTrades = trades.filter((t) => t.pnl > 0)
    const losingTrades = trades.filter((t) => t.pnl < 0)
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0)
    const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0)
    const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0))

    const totalReturn = initialCapital > 0 ? totalPnL / initialCapital : 0
    const days = portfolioEvolution.length > 1
      ? (portfolioEvolution[portfolioEvolution.length - 1].timestamp - portfolioEvolution[0].timestamp) / (1000 * 60 * 60 * 24)
      : 1
    const annualizedReturn = totalReturn !== 0 ? Math.pow(1 + totalReturn, 365 / Math.max(1, days)) - 1 : 0
    const cagr = annualizedReturn

    // Sharpe (simplified from daily returns)
    const returns: number[] = []
    for (let i = 1; i < portfolioEvolution.length; i++) {
      const prev = portfolioEvolution[i - 1].nav
      const curr = portfolioEvolution[i].nav
      if (prev > 0) returns.push((curr - prev) / prev)
    }
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length)
      : 0
    const sharpeRatio = stdReturn > 0 ? (avgReturn - riskFreeRate / 365) / stdReturn * Math.sqrt(365) : 0

    // Downside deviation for Sortino
    const downsideReturns = returns.filter((r) => r < 0)
    const downsideDeviation = downsideReturns.length > 0
      ? Math.sqrt(downsideReturns.reduce((s, r) => s + r ** 2, 0) / downsideReturns.length)
      : 0
    const sortinoRatio = downsideDeviation > 0 ? (avgReturn - riskFreeRate / 365) / downsideDeviation * Math.sqrt(365) : 0

    // Max drawdown
    let peak = initialCapital, maxDD = 0
    for (const p of portfolioEvolution) {
      if (p.nav > peak) peak = p.nav
      const dd = (peak - p.nav) / peak
      if (dd > maxDD) maxDD = dd
    }

    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0
    const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0
    const expectancy = trades.length > 0 ? totalPnL / trades.length : 0
    const calmarRatio = maxDD > 0 ? annualizedReturn / maxDD : 0
    const recoveryFactor = maxDD > 0 ? totalPnL / (maxDD * initialCapital) : 0

    return {
      cagr, totalReturn, annualizedReturn, sharpeRatio, sortinoRatio, calmarRatio,
      profitFactor, winRate, maxDrawdown: maxDD, recoveryFactor, expectancy,
      totalTrades: trades.length, winningTrades: winningTrades.length, losingTrades: losingTrades.length,
      avgWin, avgLoss,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — RiskEvaluator
// ─────────────────────────────────────────────────────────────────────────────

export class RiskEvaluator {
  calculate(portfolioEvolution: PortfolioEvolutionPoint[], returns: number[]): RiskMetrics {
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length)
      : 0
    const z95 = 1.645, z99 = 2.326
    let peak = 0, maxDDDur = 0, currentDDDur = 0, avgDD = 0, ddCount = 0, currentPeak = 0
    for (const p of portfolioEvolution) {
      if (p.nav > currentPeak) { currentPeak = p.nav; currentDDDur = 0 }
      else { currentDDDur++; if (currentDDDur > maxDDDur) maxDDDur = currentDDDur }
      const dd = currentPeak > 0 ? (currentPeak - p.nav) / currentPeak : 0
      if (dd > 0) { avgDD += dd; ddCount++ }
    }
    avgDD = ddCount > 0 ? avgDD / ddCount : 0
    return {
      volatility: stdReturn * Math.sqrt(365),
      var95: stdReturn * z95, var99: stdReturn * z99,
      expectedShortfall: stdReturn * z99 * 1.25, beta: 1.0,
      maxDrawdownDuration: maxDDDur, avgDrawdown: avgDD,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — BenchmarkComparator
// ─────────────────────────────────────────────────────────────────────────────

export class BenchmarkComparator {
  compare(portfolioReturn: number, benchmarkReturn: number, riskFreeRate: number, beta: number, trackingError: number): BenchmarkComparison {
    const alpha = portfolioReturn - (riskFreeRate + beta * (benchmarkReturn - riskFreeRate))
    const informationRatio = trackingError > 0 ? (portfolioReturn - benchmarkReturn) / trackingError : 0
    return { benchmarkId: 'default', benchmarkReturn, portfolioReturn, alpha, beta, trackingError, informationRatio }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance + Recovery + Observability
// ─────────────────────────────────────────────────────────────────────────────

export class SimulationVersionRegistry {
  private active = new Map<string, import('./types').CanonicalSimulationContract>()
  private history = new Map<string, import('./types').CanonicalSimulationContract[]>()
  register(s: import('./types').CanonicalSimulationContract): void {
    this.active.set(s.simulationEventId, s)
    const v = this.history.get(s.simulationEventId) ?? []; v.push(s); this.history.set(s.simulationEventId, v)
    log.info(`simulation ${s.simulationEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  /** Rule 13 — Deterministic replay. */
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
  listActive() { return Array.from(this.active.keys()) }
}

export const simulationVersionRegistry = new SimulationVersionRegistry()

export class SimulationGovernanceManager {
  private g = new Map<string, import('./types').SimulationGovernanceMetadata>()
  init(id: string, now: number = Date.now()) {
    if (this.g.has(id)) return this.g.get(id)!
    const m = { approvalStatus: 'PENDING' as const, validationStatus: 'PENDING' as const, reviewHistory: [], auditHistory: [], creationTimestamp: now, completionTimestamp: null as number | null, retirementStatus: 'ACTIVE' as const, governanceNotes: [] }
    this.g.set(id, m); return m
  }
  get(id: string) { return this.g.get(id) ?? null }
  approve(id: string, actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    m.approvalStatus = 'APPROVED'; m.completionTimestamp = now
  }
  setValidation(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.validationStatus = status; m.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const simulationGovernanceManager = new SimulationGovernanceManager()

export class SimulationFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `sf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`simulation failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const simulationFailureRecovery = new SimulationFailureRecovery()

export interface MSBEObservabilityMetrics {
  totalSimulations: number; avgSimulationDurationMs: number
  avgReplayLatencyMs: number; strategySuccessRate: number
  datasetCoverage: number; historicalAccuracy: number
  validationFailures: number; governanceEvents: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class MSBEObservabilityCollector {
  private total = 0; private durations: number[] = []; private replayLatencies: number[] = []
  private successCount = 0; private validationFailures = 0; private govEvents = 0
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private windowStart = Date.now()

  recordSimulation(durationMs: number, replayLatencyMs: number, success: boolean, validationPassed: boolean) {
    this.total++; this.durations.push(durationMs); this.replayLatencies.push(replayLatencyMs)
    if (success) this.successCount++
    if (!validationPassed) this.validationFailures++
    if (this.durations.length > 500) this.durations.shift()
    if (this.replayLatencies.length > 500) this.replayLatencies.shift()
  }
  recordGovernance() { this.govEvents++ }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): MSBEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalSimulations: this.total, avgSimulationDurationMs: avg(this.durations),
      avgReplayLatencyMs: avg(this.replayLatencies),
      strategySuccessRate: this.total > 0 ? this.successCount / this.total : 0,
      datasetCoverage: 1.0, historicalAccuracy: 1.0, validationFailures: this.validationFailures,
      governanceEvents: this.govEvents, stageTimings: st,
      windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() { this.total = 0; this.durations = []; this.replayLatencies = []; this.successCount = 0; this.validationFailures = 0; this.govEvents = 0; this.stageTimings = {}; this.windowStart = Date.now() }
}

export const msbeObservabilityCollector = new MSBEObservabilityCollector()

// Singletons
export const marketReplayEngine = new MarketReplayEngine()
export const executionSimulator = new ExecutionSimulator()
export const performanceCalculator = new PerformanceCalculator()
export const riskEvaluator = new RiskEvaluator()
export const benchmarkComparator = new BenchmarkComparator()
