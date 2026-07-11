// CHAPTER 5.7 §14, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Configuration Reload
//   • Execution Plan Reconstruction
//   • Algorithm Fallback
//   • Failure Logging
//   • Graceful Degradation
//   • Execution Quarantine
//   Invalid execution plans shall NEVER be published.
//
// §14 — Metrics include:
//   • Execution Plans Generated
//   • Algorithm Distribution
//   • Expected Transaction Cost
//   • Expected Market Impact
//   • Expected Slippage
//   • Participation Rate
//   • Child Orders Generated
//   • Optimization Latency
//   • Governance Events

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalExecutionPlanContract, ExecutionAlgorithm } from './types'

const log = createLogger('decision-intelligence:execution-optimization:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedExecution {
  plan: CanonicalExecutionPlanContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface ExecutionFailureRecord {
  failureId: string
  executionPlanId: string | null
  failureType: ExecutionFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'ALGORITHM_FALLBACK' | 'GRACEFUL_DEGRADATION'
}

export type ExecutionFailureType =
  | 'ORDER_INTENT_INVALID'
  | 'ALGORITHM_SELECTION_FAILED'
  | 'DECOMPOSITION_FAILED'
  | 'SCHEDULE_CONSTRUCTION_FAILED'
  | 'CHILD_ORDER_PLANNING_FAILED'
  | 'EXECUTION_VALIDATION_FAILED'
  | 'ADAPTATION_FAILED'
  | 'INTERNAL_ERROR'

export class ExecutionFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedExecution>()
  private failures: ExecutionFailureRecord[] = []
  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  quarantinePlan(plan: CanonicalExecutionPlanContract, reason: string, currentTime: number = Date.now()): string {
    const id = `eq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { plan, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`execution plan ${plan.executionPlanId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    executionPlanId: string | null,
    failureType: ExecutionFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: ExecutionFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `ef-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, executionPlanId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`execution failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
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

export const executionFailureRecovery = new ExecutionFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface EOEObservabilityMetrics {
  // §14 — Execution Plans Generated
  totalPlans: number
  plansByAlgorithm: Record<ExecutionAlgorithm, number>

  // §14 — Algorithm Distribution
  algorithmDistribution: Record<string, number>

  // §14 — Expected Transaction Cost
  avgExpectedTxCost: number
  totalExpectedTxCost: number

  // §14 — Expected Market Impact
  avgExpectedImpact: number
  totalExpectedImpact: number

  // §14 — Expected Slippage
  avgExpectedSlippage: number

  // §14 — Participation Rate
  avgParticipationRate: number

  // §14 — Child Orders Generated
  totalChildOrders: number
  avgChildOrdersPerPlan: number

  // §14 — Optimization Latency
  avgOptimizationLatencyMs: number
  p95OptimizationLatencyMs: number
  maxOptimizationLatencyMs: number

  // §14 — Governance Events
  totalGovernanceEvents: number

  // Adaptation metrics (§10A)
  totalAdaptations: number
  adaptationsByType: Record<string, number>

  // Residual re-absorption events (Rule 21)
  totalResidualReabsorptions: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  windowStart: number
  windowEnd: number
}

export class EOEObservabilityCollector {
  private totalPlans = 0
  private plansByAlgorithm: Record<string, number> = {}
  private txCosts: number[] = []
  private impacts: number[] = []
  private slippages: number[] = []
  private participationRates: number[] = []
  private totalChildOrders = 0
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalGovernanceEvents = 0
  private totalAdaptations = 0
  private adaptationsByType: Record<string, number> = {}
  private totalResidualReabsorptions = 0
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordPlan(
    algorithm: ExecutionAlgorithm,
    txCost: number,
    impact: number,
    slippage: number,
    participationRate: number,
    childOrderCount: number,
    latencyMs: number,
  ): void {
    this.totalPlans++
    this.plansByAlgorithm[algorithm] = (this.plansByAlgorithm[algorithm] ?? 0) + 1
    this.txCosts.push(txCost)
    this.impacts.push(impact)
    this.slippages.push(slippage)
    this.participationRates.push(participationRate)
    this.totalChildOrders += childOrderCount
    this.latencySamples.push(latencyMs)
    if (this.txCosts.length > this.MAX_SAMPLES) this.txCosts.shift()
    if (this.impacts.length > this.MAX_SAMPLES) this.impacts.shift()
    if (this.slippages.length > this.MAX_SAMPLES) this.slippages.shift()
    if (this.participationRates.length > this.MAX_SAMPLES) this.participationRates.shift()
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
  }

  recordAdaptation(type: string): void {
    this.totalAdaptations++
    this.adaptationsByType[type] = (this.adaptationsByType[type] ?? 0) + 1
  }

  recordResidualReabsorption(): void {
    this.totalResidualReabsorptions++
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

  snapshot(): EOEObservabilityMetrics {
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
      totalPlans: this.totalPlans,
      plansByAlgorithm: this.plansByAlgorithm as Record<ExecutionAlgorithm, number>,
      algorithmDistribution: this.plansByAlgorithm,
      avgExpectedTxCost: avg(this.txCosts),
      totalExpectedTxCost: this.txCosts.reduce((s, c) => s + c, 0),
      avgExpectedImpact: avg(this.impacts),
      totalExpectedImpact: this.impacts.reduce((s, c) => s + c, 0),
      avgExpectedSlippage: avg(this.slippages),
      avgParticipationRate: avg(this.participationRates),
      totalChildOrders: this.totalChildOrders,
      avgChildOrdersPerPlan: this.totalPlans > 0 ? this.totalChildOrders / this.totalPlans : 0,
      avgOptimizationLatencyMs: avg(this.latencySamples),
      p95OptimizationLatencyMs: percentile(sorted, 0.95),
      maxOptimizationLatencyMs: max(this.latencySamples),
      totalGovernanceEvents: this.totalGovernanceEvents,
      totalAdaptations: this.totalAdaptations,
      adaptationsByType: this.adaptationsByType,
      totalResidualReabsorptions: this.totalResidualReabsorptions,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalPlans = 0
    this.plansByAlgorithm = {}
    this.txCosts = []
    this.impacts = []
    this.slippages = []
    this.participationRates = []
    this.totalChildOrders = 0
    this.latencySamples = []
    this.stageTimings = {}
    this.totalGovernanceEvents = 0
    this.totalAdaptations = 0
    this.adaptationsByType = {}
    this.totalResidualReabsorptions = 0
    this.windowStart = Date.now()
  }
}

export const eoeObservabilityCollector = new EOEObservabilityCollector()
