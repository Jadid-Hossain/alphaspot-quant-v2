// CHAPTER 5.2 §14 — Observability
//
// §14 — Metrics include:
//   • Strategy Decisions
//   • Strategy Acceptance Rate
//   • Decision Latency
//   • Decision Distribution
//   • Strategy Utilization
//   • Strategy Conflicts
//   • Governance Events
//   • Decision Throughput

import type { DecisionType, StrategyState } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// SIE Observability Metrics (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface SIEObservabilityMetrics {
  // §14 — Strategy Decisions
  totalDecisions: number
  decisionsByType: Record<DecisionType, number>
  decisionsByStrategy: Record<string, number>
  decisionsByState: Record<StrategyState, number>

  // §14 — Strategy Acceptance Rate
  totalAccepted: number
  totalRejected: number
  acceptanceRate: number

  // §14 — Decision Latency
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  maxLatencyMs: number

  // §14 — Decision Distribution
  decisionDistribution: {
    accepted: number
    rejectedByRules: number
    rejectedByRegime: number
    rejectedByCapacity: number
    rejectedByGovernance: number
    rejectedByState: number
    quarantined: number
    consolidated: number
    partiallyOffset: number
    deferred: number
  }

  // §14 — Strategy Utilization
  strategyUtilization: Record<string, {
    decisions: number
    accepted: number
    rejected: number
    lastActiveAt: number | null
    state: StrategyState | null
  }>

  // §14 — Strategy Conflicts
  totalConflicts: number
  conflictsByType: Record<string, number>
  opposingDirectionConflicts: number

  // §14 — Governance Events
  totalGovernanceEvents: number
  governanceEventsByType: Record<string, number>

  // §14 — Decision Throughput
  decisionsPerSecond: number
  decisionsPerMinute: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  // Time window
  windowStart: number
  windowEnd: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SIEObservabilityCollector
// ─────────────────────────────────────────────────────────────────────────────

export class SIEObservabilityCollector {
  private totalDecisions = 0
  private decisionsByType: Record<string, number> = {}
  private decisionsByStrategy: Record<string, number> = {}
  private decisionsByState: Record<string, number> = {}
  private totalAccepted = 0
  private totalRejected = 0
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}

  private decisionDistribution = {
    accepted: 0,
    rejectedByRules: 0,
    rejectedByRegime: 0,
    rejectedByCapacity: 0,
    rejectedByGovernance: 0,
    rejectedByState: 0,
    quarantined: 0,
    consolidated: 0,
    partiallyOffset: 0,
    deferred: 0,
  }

  private strategyUtilization: Record<string, {
    decisions: number
    accepted: number
    rejected: number
    lastActiveAt: number | null
    state: StrategyState | null
  }> = {}

  private totalConflicts = 0
  private conflictsByType: Record<string, number> = {}
  private opposingDirectionConflicts = 0

  private totalGovernanceEvents = 0
  private governanceEventsByType: Record<string, number> = {}

  private windowStart = Date.now()
  private latencyBuffer: Array<{ at: number; latency: number }> = []

  private readonly MAX_LATENCY_SAMPLES = 1000
  private readonly MAX_LATENCY_BUFFER = 60000 // 1 minute rolling window

  /** Record a decision (§14 — Strategy Decisions, Decision Distribution). */
  recordDecision(
    strategyId: string,
    decisionType: DecisionType,
    state: StrategyState,
    accepted: boolean,
    rejectionReason: 'RULES' | 'REGIME' | 'CAPACITY' | 'GOVERNANCE' | 'STATE' | 'NONE' = 'NONE',
    latencyMs: number = 0,
    currentTime: number = Date.now(),
  ): void {
    this.totalDecisions++
    this.decisionsByType[decisionType] = (this.decisionsByType[decisionType] ?? 0) + 1
    this.decisionsByStrategy[strategyId] = (this.decisionsByStrategy[strategyId] ?? 0) + 1
    this.decisionsByState[state] = (this.decisionsByState[state] ?? 0) + 1

    if (accepted) {
      this.totalAccepted++
      this.decisionDistribution.accepted++
    } else {
      this.totalRejected++
      switch (rejectionReason) {
        case 'RULES': this.decisionDistribution.rejectedByRules++; break
        case 'REGIME': this.decisionDistribution.rejectedByRegime++; break
        case 'CAPACITY': this.decisionDistribution.rejectedByCapacity++; break
        case 'GOVERNANCE': this.decisionDistribution.rejectedByGovernance++; break
        case 'STATE': this.decisionDistribution.rejectedByState++; break
      }
    }

    // Strategy utilization
    if (!this.strategyUtilization[strategyId]) {
      this.strategyUtilization[strategyId] = {
        decisions: 0, accepted: 0, rejected: 0, lastActiveAt: null, state: null,
      }
    }
    this.strategyUtilization[strategyId].decisions++
    if (accepted) this.strategyUtilization[strategyId].accepted++
    else this.strategyUtilization[strategyId].rejected++
    this.strategyUtilization[strategyId].lastActiveAt = currentTime
    this.strategyUtilization[strategyId].state = state

    // Latency tracking
    if (latencyMs > 0) {
      this.latencySamples.push(latencyMs)
      if (this.latencySamples.length > this.MAX_LATENCY_SAMPLES) this.latencySamples.shift()
      this.latencyBuffer.push({ at: currentTime, latency: latencyMs })
      // Trim buffer
      const cutoff = currentTime - this.MAX_LATENCY_BUFFER
      this.latencyBuffer = this.latencyBuffer.filter((s) => s.at >= cutoff)
    }
  }

  /** Record a quarantined decision (§14 — Decision Distribution). */
  recordQuarantined(): void {
    this.decisionDistribution.quarantined++
  }

  /** Record a reconciliation outcome (§14 — Decision Distribution). */
  recordReconciliation(type: 'CONSOLIDATED' | 'PARTIALLY_OFFSET' | 'DEFERRED' | 'INDEPENDENT'): void {
    if (type === 'CONSOLIDATED') this.decisionDistribution.consolidated++
    else if (type === 'PARTIALLY_OFFSET') this.decisionDistribution.partiallyOffset++
    else if (type === 'DEFERRED') this.decisionDistribution.deferred++
  }

  /** Record a strategy conflict (§14 — Strategy Conflicts). */
  recordConflict(conflictType: string, opposingDirection: boolean = false): void {
    this.totalConflicts++
    this.conflictsByType[conflictType] = (this.conflictsByType[conflictType] ?? 0) + 1
    if (opposingDirection) this.opposingDirectionConflicts++
  }

  /** Record a governance event (§14 — Governance Events). */
  recordGovernanceEvent(eventType: string): void {
    this.totalGovernanceEvents++
    this.governanceEventsByType[eventType] = (this.governanceEventsByType[eventType] ?? 0) + 1
  }

  /** Record a pipeline stage timing (§14 — Decision Latency). */
  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) {
      this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  /** Get current metrics snapshot (§14). */
  snapshot(): SIEObservabilityMetrics {
    const windowEnd = Date.now()
    const windowDurationMs = windowEnd - this.windowStart
    const windowSeconds = Math.max(1, windowDurationMs / 1000)
    const windowMinutes = Math.max(1, windowSeconds / 60)

    // Sort latency samples for percentile calculations
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0
    const p50 = this.percentile(sorted, 0.50)
    const p95 = this.percentile(sorted, 0.95)
    const p99 = this.percentile(sorted, 0.99)
    const max = sorted.length > 0 ? sorted[sorted.length - 1] : 0

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count,
        totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0,
        maxMs: t.maxMs,
      }
    }

    const acceptanceRate = this.totalDecisions > 0 ? this.totalAccepted / this.totalDecisions : 0

    return {
      totalDecisions: this.totalDecisions,
      decisionsByType: this.decisionsByType as Record<DecisionType, number>,
      decisionsByStrategy: this.decisionsByStrategy,
      decisionsByState: this.decisionsByState as Record<StrategyState, number>,
      totalAccepted: this.totalAccepted,
      totalRejected: this.totalRejected,
      acceptanceRate,
      avgLatencyMs: avg,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      maxLatencyMs: max,
      decisionDistribution: { ...this.decisionDistribution },
      strategyUtilization: { ...this.strategyUtilization },
      totalConflicts: this.totalConflicts,
      conflictsByType: this.conflictsByType,
      opposingDirectionConflicts: this.opposingDirectionConflicts,
      totalGovernanceEvents: this.totalGovernanceEvents,
      governanceEventsByType: this.governanceEventsByType,
      decisionsPerSecond: this.totalDecisions / windowSeconds,
      decisionsPerMinute: this.totalDecisions / windowMinutes,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd,
    }
  }

  /** Reset metrics (for testing). */
  reset(): void {
    this.totalDecisions = 0
    this.decisionsByType = {}
    this.decisionsByStrategy = {}
    this.decisionsByState = {}
    this.totalAccepted = 0
    this.totalRejected = 0
    this.latencySamples = []
    this.latencyBuffer = []
    this.stageTimings = {}
    this.decisionDistribution = {
      accepted: 0, rejectedByRules: 0, rejectedByRegime: 0, rejectedByCapacity: 0,
      rejectedByGovernance: 0, rejectedByState: 0, quarantined: 0,
      consolidated: 0, partiallyOffset: 0, deferred: 0,
    }
    this.strategyUtilization = {}
    this.totalConflicts = 0
    this.conflictsByType = {}
    this.opposingDirectionConflicts = 0
    this.totalGovernanceEvents = 0
    this.governanceEventsByType = {}
    this.windowStart = Date.now()
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
    return sorted[idx]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton observability collector
// ─────────────────────────────────────────────────────────────────────────────

export const sieObservabilityCollector = new SIEObservabilityCollector()
