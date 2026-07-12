// CHAPTER 5.8 §14, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Venue Failover, Routing Reconstruction, Configuration Reload
//   • Route Recalculation, Failure Logging, Graceful Degradation, Routing Quarantine
//   Invalid routing decisions shall NEVER be published.
//
// §14 — Metrics include:
//   • Routing Decisions Generated, Venue Utilization, Routing Latency
//   • Venue Failures, Venue Switches, Fill Probability Distribution
//   • Queue Position Accuracy, Routing Success Rate, Governance Events

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalRoutingContract, RoutingStrategy } from './types'

const log = createLogger('decision-intelligence:smart-order-routing:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedRouting {
  routing: CanonicalRoutingContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface RoutingFailureRecord {
  failureId: string
  routingDecisionId: string | null
  failureType: RoutingFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'FAILOVER' | 'GRACEFUL_DEGRADATION'
}

export type RoutingFailureType =
  | 'EXECUTION_PLAN_INVALID'
  | 'NO_HEALTHY_VENUES'
  | 'VENUE_ISOLATION'
  | 'ALLOCATION_FAILED'
  | 'SYNCHRONIZATION_FAILED'
  | 'ROUTING_VALIDATION_FAILED'
  | 'REROUTING_FAILED'
  | 'INTERNAL_ERROR'

export class RoutingFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedRouting>()
  private failures: RoutingFailureRecord[] = []
  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  quarantineRouting(routing: CanonicalRoutingContract, reason: string, currentTime: number = Date.now()): string {
    const id = `rq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { routing, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`routing decision ${routing.routingDecisionId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    routingDecisionId: string | null,
    failureType: RoutingFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: RoutingFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `rf-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, routingDecisionId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`routing failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
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

export const routingFailureRecovery = new RoutingFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface SOREObservabilityMetrics {
  // §14 — Routing Decisions Generated
  totalRoutingDecisions: number
  decisionsByStrategy: Record<RoutingStrategy, number>

  // §14 — Venue Utilization
  venueUtilization: Record<string, number>

  // §14 — Routing Latency
  avgRoutingLatencyMs: number
  p95RoutingLatencyMs: number
  maxRoutingLatencyMs: number

  // §14 — Venue Failures
  totalVenueFailures: number
  venueFailuresByType: Record<string, number>

  // §14 — Venue Switches
  totalVenueSwitches: number

  // §14 — Fill Probability Distribution
  avgFillProbability: number
  fillProbabilityDistribution: { min: number; p25: number; p50: number; p75: number; max: number }

  // §14 — Queue Position Accuracy
  avgQueuePositionAccuracy: number

  // §14 — Routing Success Rate
  routingSuccessRate: number

  // §14 — Governance Events
  totalGovernanceEvents: number

  // Rerouting metrics (§10A)
  totalReroutingEvents: number
  reroutingByAction: Record<string, number>

  // Toxicity metrics (Rule 21)
  totalToxicityPenalties: number
  totalToxicityExclusions: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  windowStart: number
  windowEnd: number
}

export class SOREObservabilityCollector {
  private totalRoutingDecisions = 0
  private decisionsByStrategy: Record<string, number> = {}
  private venueUtilization: Record<string, number> = {}
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalVenueFailures = 0
  private venueFailuresByType: Record<string, number> = {}
  private totalVenueSwitches = 0
  private fillProbabilities: number[] = []
  private queuePositionAccuracies: number[] = []
  private routingSuccessCount = 0
  private totalGovernanceEvents = 0
  private totalReroutingEvents = 0
  private reroutingByAction: Record<string, number> = {}
  private totalToxicityPenalties = 0
  private totalToxicityExclusions = 0
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordRoutingDecision(strategy: RoutingStrategy, venueIds: string[], latencyMs: number, fillProbability: number, success: boolean): void {
    this.totalRoutingDecisions++
    this.decisionsByStrategy[strategy] = (this.decisionsByStrategy[strategy] ?? 0) + 1
    for (const vid of venueIds) {
      this.venueUtilization[vid] = (this.venueUtilization[vid] ?? 0) + 1
    }
    this.latencySamples.push(latencyMs)
    this.fillProbabilities.push(fillProbability)
    if (success) this.routingSuccessCount++
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
    if (this.fillProbabilities.length > this.MAX_SAMPLES) this.fillProbabilities.shift()
  }

  recordVenueFailure(type: string): void {
    this.totalVenueFailures++
    this.venueFailuresByType[type] = (this.venueFailuresByType[type] ?? 0) + 1
  }

  recordVenueSwitch(): void {
    this.totalVenueSwitches++
  }

  recordQueuePositionAccuracy(accuracy: number): void {
    this.queuePositionAccuracies.push(accuracy)
    if (this.queuePositionAccuracies.length > this.MAX_SAMPLES) this.queuePositionAccuracies.shift()
  }

  recordRerouting(action: string): void {
    this.totalReroutingEvents++
    this.reroutingByAction[action] = (this.reroutingByAction[action] ?? 0) + 1
  }

  recordToxicityPenalty(): void {
    this.totalToxicityPenalties++
  }

  recordToxicityExclusion(): void {
    this.totalToxicityExclusions++
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

  snapshot(): SOREObservabilityMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0
    const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
    const fillSorted = [...this.fillProbabilities].sort((a, b) => a - b)

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count, totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0, maxMs: t.maxMs,
      }
    }

    return {
      totalRoutingDecisions: this.totalRoutingDecisions,
      decisionsByStrategy: this.decisionsByStrategy as Record<RoutingStrategy, number>,
      venueUtilization: this.venueUtilization,
      avgRoutingLatencyMs: avg(this.latencySamples),
      p95RoutingLatencyMs: percentile(sorted, 0.95),
      maxRoutingLatencyMs: max(this.latencySamples),
      totalVenueFailures: this.totalVenueFailures,
      venueFailuresByType: this.venueFailuresByType,
      totalVenueSwitches: this.totalVenueSwitches,
      avgFillProbability: avg(this.fillProbabilities),
      fillProbabilityDistribution: {
        min: min(fillSorted),
        p25: percentile(fillSorted, 0.25),
        p50: percentile(fillSorted, 0.50),
        p75: percentile(fillSorted, 0.75),
        max: max(fillSorted),
      },
      avgQueuePositionAccuracy: avg(this.queuePositionAccuracies),
      routingSuccessRate: this.totalRoutingDecisions > 0 ? this.routingSuccessCount / this.totalRoutingDecisions : 0,
      totalGovernanceEvents: this.totalGovernanceEvents,
      totalReroutingEvents: this.totalReroutingEvents,
      reroutingByAction: this.reroutingByAction,
      totalToxicityPenalties: this.totalToxicityPenalties,
      totalToxicityExclusions: this.totalToxicityExclusions,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalRoutingDecisions = 0
    this.decisionsByStrategy = {}
    this.venueUtilization = {}
    this.latencySamples = []
    this.stageTimings = {}
    this.totalVenueFailures = 0
    this.venueFailuresByType = {}
    this.totalVenueSwitches = 0
    this.fillProbabilities = []
    this.queuePositionAccuracies = []
    this.routingSuccessCount = 0
    this.totalGovernanceEvents = 0
    this.totalReroutingEvents = 0
    this.reroutingByAction = {}
    this.totalToxicityPenalties = 0
    this.totalToxicityExclusions = 0
    this.windowStart = Date.now()
  }
}

export const soreObservabilityCollector = new SOREObservabilityCollector()
