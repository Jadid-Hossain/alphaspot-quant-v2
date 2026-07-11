// CHAPTER 5.6 §15, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Configuration Reload
//   • Portfolio Reconstruction
//   • Decision Recovery
//   • Failure Logging
//   • Graceful Degradation
//   • Order Quarantine
//   Invalid Order Intent Contracts shall NEVER be published.
//
// §15 — Metrics include:
//   • Orders Generated
//   • Orders Suppressed
//   • Average Rebalancing Drift
//   • Transaction Cost Estimates
//   • Market Impact Estimates
//   • Turnover Utilization
//   • Decision Latency
//   • Governance Events

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalOrderIntentContract, ExecutionUrgency, OrderIntent } from './types'

const log = createLogger('decision-intelligence:order-decision:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedOrder {
  order: CanonicalOrderIntentContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface OrderFailureRecord {
  failureId: string
  positionId: string | null
  failureType: OrderFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'GRACEFUL_DEGRADATION' | 'STALE_RECOVERY'
}

export type OrderFailureType =
  | 'POSITION_CONTRACT_INVALID'
  | 'PENDING_ORDER_FRESHNESS_FAILED'
  | 'DRIFT_BELOW_THRESHOLD'
  | 'MINIMUM_TRADE_SIZE_FAILED'
  | 'MINIMUM_NOTIONAL_FAILED'
  | 'ECONOMIC_BENEFIT_FAILED'
  | 'LIQUIDITY_CONSTRAINT_FAILED'
  | 'TURNOVER_BUDGET_EXCEEDED'
  | 'COOLDOWN_ACTIVE'
  | 'ORDER_VALIDATION_FAILED'
  | 'INTERNAL_ERROR'

export class OrderFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedOrder>()
  private failures: OrderFailureRecord[] = []
  private readonly MAX_QUARANTINE = 100
  private readonly MAX_FAILURES = 500

  quarantineOrder(order: CanonicalOrderIntentContract, reason: string, currentTime: number = Date.now()): string {
    const id = `oq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { order, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`order ${order.orderDecisionId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    positionId: string | null,
    failureType: OrderFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: OrderFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `of-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, positionId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`order failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
    return failureId
  }

  getStats() {
    const failuresByType: Record<string, number> = {}
    for (const f of this.failures) {
      failuresByType[f.failureType] = (failuresByType[f.failureType] ?? 0) + 1
    }
    return {
      totalQuarantined: this.quarantine.size,
      totalFailures: this.failures.length,
      failuresByType,
    }
  }
}

export const orderFailureRecovery = new OrderFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§15)
// ─────────────────────────────────────────────────────────────────────────────

export interface ODEObservabilityMetrics {
  // §15 — Orders Generated
  totalOrders: number
  ordersByIntent: Record<OrderIntent, number>
  ordersByUrgency: Record<ExecutionUrgency, number>

  // §15 — Orders Suppressed
  totalSuppressed: number
  suppressionRate: number

  // §15 — Average Rebalancing Drift
  avgRebalancingDrift: number
  maxRebalancingDrift: number

  // §15 — Transaction Cost Estimates
  avgTransactionCost: number
  totalTransactionCost: number

  // §15 — Market Impact Estimates
  avgMarketImpact: number
  totalMarketImpact: number

  // §15 — Turnover Utilization
  avgTurnoverUtilization: number
  currentTurnoverUtilization: number

  // §15 — Decision Latency
  avgDecisionLatencyMs: number
  p95DecisionLatencyMs: number
  maxDecisionLatencyMs: number

  // §15 — Governance Events
  totalGovernanceEvents: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  // Stale order recoveries (Rule 21)
  staleOrderRecoveries: number

  windowStart: number
  windowEnd: number
}

export class ODEObservabilityCollector {
  private totalOrders = 0
  private ordersByIntent: Record<string, number> = {}
  private ordersByUrgency: Record<string, number> = {}
  private totalSuppressed = 0
  private rebalancingDrifts: number[] = []
  private transactionCosts: number[] = []
  private marketImpacts: number[] = []
  private turnoverUtilizations: number[] = []
  private currentTurnoverUtilization = 0
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalGovernanceEvents = 0
  private staleOrderRecoveries = 0
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordOrder(
    intent: OrderIntent,
    urgency: ExecutionUrgency,
    rebalancingDrift: number,
    transactionCost: number,
    marketImpact: number,
    turnoverUtilization: number,
    latencyMs: number,
  ): void {
    this.totalOrders++
    this.ordersByIntent[intent] = (this.ordersByIntent[intent] ?? 0) + 1
    this.ordersByUrgency[urgency] = (this.ordersByUrgency[urgency] ?? 0) + 1

    if (intent === 'SUPPRESS' || intent === 'HOLD' || intent === 'DEFER') {
      this.totalSuppressed++
    }

    this.rebalancingDrifts.push(Math.abs(rebalancingDrift))
    this.transactionCosts.push(transactionCost)
    this.marketImpacts.push(marketImpact)
    this.turnoverUtilizations.push(turnoverUtilization)
    this.currentTurnoverUtilization = turnoverUtilization
    this.latencySamples.push(latencyMs)

    if (this.rebalancingDrifts.length > this.MAX_SAMPLES) this.rebalancingDrifts.shift()
    if (this.transactionCosts.length > this.MAX_SAMPLES) this.transactionCosts.shift()
    if (this.marketImpacts.length > this.MAX_SAMPLES) this.marketImpacts.shift()
    if (this.turnoverUtilizations.length > this.MAX_SAMPLES) this.turnoverUtilizations.shift()
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
  }

  recordStaleOrderRecovery(): void {
    this.staleOrderRecoveries++
  }

  recordGovernanceEvent(): void {
    this.totalGovernanceEvents++
  }

  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  snapshot(): ODEObservabilityMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count, totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0, maxMs: t.maxMs,
      }
    }

    return {
      totalOrders: this.totalOrders,
      ordersByIntent: this.ordersByIntent as Record<OrderIntent, number>,
      ordersByUrgency: this.ordersByUrgency as Record<ExecutionUrgency, number>,
      totalSuppressed: this.totalSuppressed,
      suppressionRate: this.totalOrders > 0 ? this.totalSuppressed / this.totalOrders : 0,
      avgRebalancingDrift: avg(this.rebalancingDrifts),
      maxRebalancingDrift: max(this.rebalancingDrifts),
      avgTransactionCost: avg(this.transactionCosts),
      totalTransactionCost: this.transactionCosts.reduce((s, c) => s + c, 0),
      avgMarketImpact: avg(this.marketImpacts),
      totalMarketImpact: this.marketImpacts.reduce((s, c) => s + c, 0),
      avgTurnoverUtilization: avg(this.turnoverUtilizations),
      currentTurnoverUtilization: this.currentTurnoverUtilization,
      avgDecisionLatencyMs: avg(this.latencySamples),
      p95DecisionLatencyMs: percentile(sorted, 0.95),
      maxDecisionLatencyMs: max(this.latencySamples),
      totalGovernanceEvents: this.totalGovernanceEvents,
      stageTimings,
      staleOrderRecoveries: this.staleOrderRecoveries,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalOrders = 0
    this.ordersByIntent = {}
    this.ordersByUrgency = {}
    this.totalSuppressed = 0
    this.rebalancingDrifts = []
    this.transactionCosts = []
    this.marketImpacts = []
    this.turnoverUtilizations = []
    this.currentTurnoverUtilization = 0
    this.latencySamples = []
    this.stageTimings = {}
    this.totalGovernanceEvents = 0
    this.staleOrderRecoveries = 0
    this.windowStart = Date.now()
  }
}

export const odeObservabilityCollector = new ODEObservabilityCollector()
