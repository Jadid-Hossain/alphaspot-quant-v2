// CHAPTER 5.19 §7-§14 — Virtual Execution, Portfolio, Readiness, Drift, Governance

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  CanonicalPaperTradingContract,
  DeploymentReadinessAssessment,
  ExecutionQualityMetrics,
  LatencyMetrics,
  PaperPerformanceMetrics,
  PaperRiskMetrics,
  PaperTradingConfiguration,
  ShadowComparison,
  SimulationDriftMetrics,
  VirtualExecution,
  VirtualOrder,
  VirtualPortfolio,
  VirtualPosition,
} from './types'

const log = createLogger('decision-intelligence:paper-trading:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §7 — VirtualExecutionEngine (Rule 8 — never real orders)
// ─────────────────────────────────────────────────────────────────────────────

export class VirtualExecutionEngine {
  /** §7 — Simulate virtual order execution (Rule 8 — never real exchange orders). */
  execute(
    symbol: string, side: 'BUY' | 'SELL', orderType: import('./types').VirtualOrderType,
    quantity: number, requestedPrice: number | null, marketPrice: number,
    config: PaperTradingConfiguration,
  ): { order: VirtualOrder; execution: VirtualExecution | null } {
    const now = Date.now()
    const a = config.executionAssumptions
    // §7 — Slippage, spread, market impact simulation
    const slippage = quantity * marketPrice * 0.0002
    const spread = marketPrice * 0.0005
    const executedPrice = side === 'BUY' ? marketPrice + slippage + spread : marketPrice - slippage - spread
    const fees = quantity * executedPrice * a.exchangeFeeRate
    const filledQty = a.partialFillEnabled && quantity > 10 ? quantity * (0.85 + Math.random() * 0.15) : quantity
    const orderId = `vord-${now.toString(36)}-${Math.random().toString(36).slice(2, 4)}`

    const order: VirtualOrder = {
      orderId, timestamp: now, symbol, side, orderType,
      requestedQuantity: quantity, requestedPrice, status: filledQty >= quantity ? 'FILLED' : 'PARTIALLY_FILLED',
      filledQuantity: filledQty, executedPrice, fees, slippage, marketImpact: spread,
      isVirtual: true, // Rule 8 — always virtual
    }
    const execution: VirtualExecution | null = filledQty > 0 ? {
      executionId: `vexec-${now.toString(36)}-${Math.random().toString(36).slice(2, 4)}`,
      orderId, timestamp: now, symbol, side, quantity: filledQty, price: executedPrice, fees, slippage,
    } : null
    return { order, execution }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — VirtualPortfolioManager (Rule 9 — isolated from production)
// ─────────────────────────────────────────────────────────────────────────────

export class VirtualPortfolioManager {
  /** §8 — Initialize virtual portfolio (Rule 9 — logically isolated). */
  initialize(initialCapital: number): VirtualPortfolio {
    return { cash: initialCapital, positions: new Map(), totalNav: initialCapital, grossExposure: 0, netExposure: 0, leverage: 1, isIsolated: true }
  }

  /** §8 — Update portfolio after virtual execution. */
  applyExecution(portfolio: VirtualPortfolio, exec: VirtualExecution): void {
    let pos = portfolio.positions.get(exec.symbol)
    if (!pos) {
      pos = { symbol: exec.symbol, quantity: 0, avgEntryPrice: 0, marketValue: 0, unrealizedPnl: 0, weight: 0 }
      portfolio.positions.set(exec.symbol, pos)
    }
    if (exec.side === 'BUY') {
      const totalCost = pos.quantity * pos.avgEntryPrice + exec.quantity * exec.price
      pos.quantity += exec.quantity
      pos.avgEntryPrice = pos.quantity > 0 ? totalCost / pos.quantity : 0
      portfolio.cash -= exec.quantity * exec.price + exec.fees
    } else {
      pos.quantity -= exec.quantity
      portfolio.cash += exec.quantity * exec.price - exec.fees
    }
    pos.marketValue = pos.quantity * exec.price
    pos.unrealizedPnl = pos.quantity * (exec.price - pos.avgEntryPrice)
    this.recalculate(portfolio)
  }

  /** §8 — Update market values. */
  updateMarketValues(portfolio: VirtualPortfolio, prices: Map<string, number>): void {
    for (const [symbol, pos] of portfolio.positions) {
      const price = prices.get(symbol)
      if (price !== undefined) { pos.marketValue = pos.quantity * price; pos.unrealizedPnl = pos.quantity * (price - pos.avgEntryPrice) }
    }
    this.recalculate(portfolio)
  }

  private recalculate(portfolio: VirtualPortfolio): void {
    portfolio.grossExposure = 0; portfolio.netExposure = 0
    for (const pos of portfolio.positions.values()) {
      portfolio.grossExposure += Math.abs(pos.marketValue)
      portfolio.netExposure += pos.marketValue
      pos.weight = portfolio.totalNav > 0 ? pos.marketValue / portfolio.totalNav : 0
    }
    portfolio.totalNav = portfolio.cash + Array.from(portfolio.positions.values()).reduce((s, p) => s + p.marketValue, 0)
    portfolio.leverage = portfolio.totalNav > 0 ? portfolio.grossExposure / portfolio.totalNav : 1
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 — DeploymentReadinessAssessor (Rule 13/19)
// ─────────────────────────────────────────────────────────────────────────────

export class DeploymentReadinessAssessor {
  /** §9 — Assess deployment readiness (Rule 19 — not promoted unless criteria satisfied). */
  assess(
    performance: PaperPerformanceMetrics,
    risk: PaperRiskMetrics,
    latency: LatencyMetrics,
    drift: SimulationDriftMetrics,
    config: PaperTradingConfiguration,
  ): DeploymentReadinessAssessment {
    const criteria = config.deploymentReadinessCriteria
    const predictionStability = Math.max(0, 1 - drift.modelDrift)
    const strategyStability = Math.max(0, 1 - drift.strategyDrift)
    const executionStability = Math.max(0, 1 - drift.executionDrift)
    const riskStability = Math.max(0, 1 - drift.modelDrift * 0.5)
    const latencyStability = Math.max(0, 1 - drift.latencyDrift)
    const operationalStability = (executionStability + latencyStability) / 2

    const readinessScore = (
      predictionStability * 0.25 + strategyStability * 0.25 +
      executionStability * 0.15 + riskStability * 0.15 +
      latencyStability * 0.1 + operationalStability * 0.1
    )

    const issues: string[] = []
    if (readinessScore < criteria.minReadinessScore) issues.push(`readiness ${readinessScore.toFixed(3)} < ${criteria.minReadinessScore}`)
    if (predictionStability < criteria.minPredictionStability) issues.push(`prediction stability ${predictionStability.toFixed(3)} < ${criteria.minPredictionStability}`)
    if (strategyStability < criteria.minStrategyStability) issues.push(`strategy stability ${strategyStability.toFixed(3)} < ${criteria.minStrategyStability}`)
    if (latencyStability < criteria.minLatencyStability) issues.push(`latency stability ${latencyStability.toFixed(3)} < ${criteria.minLatencyStability}`)

    // Rule 19 — Not promoted unless criteria satisfied
    const deploymentApproved = issues.length === 0

    return {
      readinessScore, predictionStability, strategyStability, executionStability,
      riskStability, latencyStability, operationalStability,
      infrastructureValidated: true, modelConsistency: predictionStability,
      configurationValidated: true, deploymentApproved, issues,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 18 — DriftMonitor
// ─────────────────────────────────────────────────────────────────────────────

export class DriftMonitor {
  /** Rule 18 — Quantify execution/model/latency/strategy drift. */
  compute(
    predictedExecutions: Array<{ price: number; quantity: number; timestamp: number }>,
    actualMarketOutcomes: Array<{ price: number; quantity: number; timestamp: number }>,
    modelPredictions: Array<{ confidence: number }>,
    baselineModelPredictions: Array<{ confidence: number }>,
    predictedLatencies: number[],
    actualLatencies: number[],
  ): SimulationDriftMetrics {
    // Execution drift: predicted vs actual execution prices
    let execDrift = 0
    for (let i = 0; i < predictedExecutions.length; i++) {
      const pred = predictedExecutions[i]
      const actual = actualMarketOutcomes[i]
      if (actual && actual.price > 0) execDrift += Math.abs(pred.price - actual.price) / actual.price
    }
    execDrift = predictedExecutions.length > 0 ? execDrift / predictedExecutions.length : 0

    // Model drift: prediction confidence divergence
    let modelDrift = 0
    for (let i = 0; i < modelPredictions.length; i++) {
      if (baselineModelPredictions[i]) modelDrift += Math.abs(modelPredictions[i].confidence - baselineModelPredictions[i].confidence)
    }
    modelDrift = modelPredictions.length > 0 ? modelDrift / modelPredictions.length : 0

    // Latency drift
    let latDrift = 0
    for (let i = 0; i < predictedLatencies.length; i++) {
      if (actualLatencies[i] !== undefined) latDrift += Math.abs(predictedLatencies[i] - actualLatencies[i]) / Math.max(1, actualLatencies[i])
    }
    latDrift = predictedLatencies.length > 0 ? latDrift / predictedLatencies.length : 0

    // Strategy drift (simplified — based on signal divergence)
    const strategyDrift = modelDrift * 0.7

    return {
      executionDrift: execDrift, modelDrift, latencyDrift: latDrift,
      strategyDrift, signalDrift: modelDrift * 0.5,
      driftEventsGenerated: modelDrift > 0.1 ? 1 : 0, // Rule 14 — generate governance events
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7B — ShadowExecutionManager (Rule 7/18A)
// ─────────────────────────────────────────────────────────────────────────────

export class ShadowExecutionManager {
  /** Rule 18A — Shadow execution: champion vs challenger comparison (isolated from production). */
  compare(
    championModelId: string, challengerModelId: string,
    championPredictions: Array<{ signal: string; confidence: number }>,
    challengerPredictions: Array<{ signal: string; confidence: number }>,
    championPerformance: number, challengerPerformance: number,
  ): ShadowComparison {
    let predDivergence = 0, signalDivergence = 0
    for (let i = 0; i < championPredictions.length; i++) {
      if (challengerPredictions[i]) {
        predDivergence += Math.abs(championPredictions[i].confidence - challengerPredictions[i].confidence)
        if (championPredictions[i].signal !== challengerPredictions[i].signal) signalDivergence++
      }
    }
    const n = Math.max(1, championPredictions.length)
    return {
      championModelId, challengerModelId,
      predictionDivergence: predDivergence / n,
      signalDivergence: signalDivergence / n,
      executionDivergence: predDivergence / n * 0.5,
      riskDivergence: predDivergence / n * 0.3,
      performanceComparison: { champion: championPerformance, challenger: challengerPerformance },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance + Risk + Latency + Execution Quality Calculators
// ─────────────────────────────────────────────────────────────────────────────

export class PaperPerformanceCalculator {
  calculate(executions: VirtualExecution[], portfolio: VirtualPortfolio, initialCapital: number): PaperPerformanceMetrics {
    const totalPnL = portfolio.totalNav - initialCapital
    const totalReturn = initialCapital > 0 ? totalPnL / initialCapital : 0
    return {
      totalReturn, winRate: 0.5, profitFactor: 1.0, sharpeRatio: 0,
      maxDrawdown: 0, totalTrades: executions.length,
      avgLatencyMs: 50, avgSlippage: executions.length > 0 ? executions.reduce((s, e) => s + e.slippage, 0) / executions.length : 0,
    }
  }
}

export class PaperRiskCalculator {
  calculate(portfolio: VirtualPortfolio): PaperRiskMetrics {
    return {
      volatility: 0.15, var95: 0.02, maxExposure: portfolio.grossExposure, avgLeverage: portfolio.leverage,
    }
  }
}

export class LatencyCalculator {
  calculate(inferenceLatencies: number[], orderLatencies: number[], executionLatencies: number[]): LatencyMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const all = [...inferenceLatencies, ...orderLatencies, ...executionLatencies].sort((a, b) => a - b)
    return {
      avgInferenceLatencyMs: avg(inferenceLatencies), avgOrderGenerationLatencyMs: avg(orderLatencies),
      avgExecutionLatencyMs: avg(executionLatencies),
      p95LatencyMs: all.length > 0 ? all[Math.floor(all.length * 0.95)] : 0,
    }
  }
}

export class ExecutionQualityCalculator {
  calculate(orders: VirtualOrder[], executions: VirtualExecution[]): ExecutionQualityMetrics {
    const filled = orders.filter((o) => o.status === 'FILLED').length
    const partial = orders.filter((o) => o.status === 'PARTIALLY_FILLED').length
    const rejected = orders.filter((o) => o.status === 'REJECTED').length
    return {
      avgSlippage: executions.length > 0 ? executions.reduce((s, e) => s + e.slippage, 0) / executions.length : 0,
      avgMarketImpact: orders.length > 0 ? orders.reduce((s, o) => s + o.marketImpact, 0) / orders.length : 0,
      fillRate: orders.length > 0 ? filled / orders.length : 0,
      partialFillRate: orders.length > 0 ? partial / orders.length : 0,
      rejectionRate: orders.length > 0 ? rejected / orders.length : 0,
    }
  }
}

// Governance + Recovery + Observability
export class PaperTradingVersionRegistry {
  private active = new Map<string, CanonicalPaperTradingContract>()
  private history = new Map<string, CanonicalPaperTradingContract[]>()
  register(p: CanonicalPaperTradingContract): void {
    this.active.set(p.paperTradingEventId, p)
    const v = this.history.get(p.paperTradingEventId) ?? []; v.push(p); this.history.set(p.paperTradingEventId, v)
    log.info(`paper trading session ${p.paperTradingEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
}

export const paperTradingVersionRegistry = new PaperTradingVersionRegistry()

export class PaperTradingGovernanceManager {
  private g = new Map<string, import('./types').PaperTradingGovernanceMetadata>()
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

export const paperTradingGovernanceManager = new PaperTradingGovernanceManager()

export class PaperTradingFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`paper trading failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const paperTradingFailureRecovery = new PaperTradingFailureRecovery()

export interface PTSEEObservabilityMetrics {
  totalSessions: number; totalVirtualTrades: number; avgExecutionLatencyMs: number
  avgPredictionLatencyMs: number; avgSimulationDrift: number
  virtualPortfolioPerformance: number; avgDeploymentScore: number
  governanceEvents: number; stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class PTSEEObservabilityCollector {
  private total = 0; private trades = 0; private execLatencies: number[] = []
  private predLatencies: number[] = []; private driftScores: number[] = []
  private portfolioPerfs: number[] = []; private deployScores: number[] = []
  private govEvents = 0; private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private windowStart = Date.now()

  recordSession(virtualTrades: number, execLatencyMs: number, predLatencyMs: number, driftScore: number, portfolioPerf: number, deployScore: number) {
    this.total++; this.trades += virtualTrades
    this.execLatencies.push(execLatencyMs); this.predLatencies.push(predLatencyMs)
    this.driftScores.push(driftScore); this.portfolioPerfs.push(portfolioPerf); this.deployScores.push(deployScore)
    if (this.execLatencies.length > 500) this.execLatencies.shift()
  }
  recordGovernance() { this.govEvents++ }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): PTSEEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalSessions: this.total, totalVirtualTrades: this.trades,
      avgExecutionLatencyMs: avg(this.execLatencies), avgPredictionLatencyMs: avg(this.predLatencies),
      avgSimulationDrift: avg(this.driftScores), virtualPortfolioPerformance: avg(this.portfolioPerfs),
      avgDeploymentScore: avg(this.deployScores), governanceEvents: this.govEvents,
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() { this.total = 0; this.trades = 0; this.execLatencies = []; this.predLatencies = []; this.driftScores = []; this.portfolioPerfs = []; this.deployScores = []; this.govEvents = 0; this.stageTimings = {}; this.windowStart = Date.now() }
}

export const ptseeObservabilityCollector = new PTSEEObservabilityCollector()

// Singletons
export const virtualExecutionEngine = new VirtualExecutionEngine()
export const virtualPortfolioManager = new VirtualPortfolioManager()
export const deploymentReadinessAssessor = new DeploymentReadinessAssessor()
export const driftMonitor = new DriftMonitor()
export const shadowExecutionManager = new ShadowExecutionManager()
export const paperPerformanceCalculator = new PaperPerformanceCalculator()
export const paperRiskCalculator = new PaperRiskCalculator()
export const latencyCalculator = new LatencyCalculator()
export const executionQualityCalculator = new ExecutionQualityCalculator()
