// CHAPTER 5.10 §14, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Session Recovery, Execution Replay, Event Reconstruction, Exchange Recovery
//   • Failure Logging, Graceful Degradation, Execution Quarantine
//   • Gap-Fill Synchronization, Historical Replay Recovery, Sequence Buffer Recovery
//   Incomplete execution histories shall NEVER be published.
//
// §14 — Metrics include:
//   • Orders Accepted/Rejected, Partial/Complete Fills, Average Fill Time, Fill Ratio
//   • Execution Latency, Exchange Availability, Session Disconnects
//   • Sequence Buffer Depth, Out-of-Order Events, Replay Recovery Count
//   • Trade Bust/Correction Events, Gap-Recovery Duration, Replay Sync Latency

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalExecutionEventContract, ExecutionState, ExchangeEventType, GapRecoveryState } from './types'

const log = createLogger('decision-intelligence:exchange-execution:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedExecution {
  execution: CanonicalExecutionEventContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface ExecutionFailureRecord {
  failureId: string
  executionEventId: string | null
  failureType: ExecutionFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'GAP_RECOVERY' | 'REPLAY' | 'SESSION_RECOVERY' | 'QUARANTINE' | 'GRACEFUL_DEGRADATION'
}

export type ExecutionFailureType =
  | 'BROKER_COMMUNICATION_INVALID'
  | 'SESSION_DISCONNECTED'
  | 'GAP_DETECTED'
  | 'REPLAY_FAILED'
  | 'SEQUENCE_BUFFER_OVERFLOW'
  | 'EXECUTION_VALIDATION_FAILED'
  | 'INCOMPLETE_EXECUTION_HISTORY'
  | 'INTERNAL_ERROR'

export class ExecutionFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedExecution>()
  private failures: ExecutionFailureRecord[] = []
  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  quarantineExecution(execution: CanonicalExecutionEventContract, reason: string, currentTime: number = Date.now()): string {
    const id = `eq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { execution, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`execution ${execution.executionEventId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    executionEventId: string | null,
    failureType: ExecutionFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: ExecutionFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `ef-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, executionEventId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
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

export interface EEEObservabilityMetrics {
  // §14 — Orders Accepted / Rejected
  totalOrdersAccepted: number
  totalOrdersRejected: number

  // §14 — Partial / Complete Fills
  totalPartialFills: number
  totalCompleteFills: number

  // §14 — Average Fill Time
  avgFillTimeMs: number

  // §14 — Fill Ratio
  fillRatio: number

  // §14 — Execution Latency
  avgExecutionLatencyMs: number
  p95ExecutionLatencyMs: number
  maxExecutionLatencyMs: number

  // §14 — Exchange Availability
  exchangeAvailability: number

  // §14 — Session Disconnects
  totalSessionDisconnects: number

  // §14 — Governance Events
  totalGovernanceEvents: number

  // §14 — Sequence Buffer Depth
  currentSequenceBufferDepth: number
  maxSequenceBufferDepth: number

  // §14 — Out-of-Order Events
  totalOutOfOrderEvents: number

  // §14 — Replay Recovery Count
  totalReplayRecoveries: number

  // §14 — Trade Bust Events
  totalTradeBusts: number

  // §14 — Trade Correction Events
  totalTradeCorrections: number

  // §14 — Gap-Recovery Duration
  avgGapRecoveryDurationMs: number
  totalGapRecoveries: number

  // §14 — Replay Synchronization Latency
  avgReplaySyncLatencyMs: number

  // Execution states distribution
  executionStatesDistribution: Record<ExecutionState, number>

  // Events by type
  eventsByType: Record<string, number>

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  windowStart: number
  windowEnd: number
}

export class EEEObservabilityCollector {
  private totalOrdersAccepted = 0
  private totalOrdersRejected = 0
  private totalPartialFills = 0
  private totalCompleteFills = 0
  private fillTimes: number[] = []
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalSessionDisconnects = 0
  private totalGovernanceEvents = 0
  private currentSequenceBufferDepth = 0
  private maxSequenceBufferDepth = 0
  private totalOutOfOrderEvents = 0
  private totalReplayRecoveries = 0
  private totalTradeBusts = 0
  private totalTradeCorrections = 0
  private gapRecoveryDurations: number[] = []
  private totalGapRecoveries = 0
  private replaySyncLatencies: number[] = []
  private executionStates: Record<string, number> = {}
  private eventsByType: Record<string, number> = {}
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordOrderAccepted(): void { this.totalOrdersAccepted++ }
  recordOrderRejected(): void { this.totalOrdersRejected++ }
  recordPartialFill(): void { this.totalPartialFills++ }
  recordCompleteFill(fillTimeMs: number): void {
    this.totalCompleteFills++
    this.fillTimes.push(fillTimeMs)
    if (this.fillTimes.length > this.MAX_SAMPLES) this.fillTimes.shift()
  }
  recordExecutionLatency(ms: number): void {
    this.latencySamples.push(ms)
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
  }
  recordSessionDisconnect(): void { this.totalSessionDisconnects++ }
  recordGovernanceEvent(): void { this.totalGovernanceEvents++ }
  recordSequenceBufferDepth(depth: number): void {
    this.currentSequenceBufferDepth = depth
    if (depth > this.maxSequenceBufferDepth) this.maxSequenceBufferDepth = depth
  }
  recordOutOfOrderEvent(): void { this.totalOutOfOrderEvents++ }
  recordReplayRecovery(): void { this.totalReplayRecoveries++ }
  recordTradeBust(): void { this.totalTradeBusts++ }
  recordTradeCorrection(): void { this.totalTradeCorrections++ }
  recordGapRecovery(durationMs: number): void {
    this.gapRecoveryDurations.push(durationMs)
    this.totalGapRecoveries++
    if (this.gapRecoveryDurations.length > this.MAX_SAMPLES) this.gapRecoveryDurations.shift()
  }
  recordReplaySyncLatency(ms: number): void {
    this.replaySyncLatencies.push(ms)
    if (this.replaySyncLatencies.length > this.MAX_SAMPLES) this.replaySyncLatencies.shift()
  }
  recordExecutionState(state: ExecutionState): void {
    this.executionStates[state] = (this.executionStates[state] ?? 0) + 1
  }
  recordEventType(type: ExchangeEventType): void {
    this.eventsByType[type] = (this.eventsByType[type] ?? 0) + 1
  }
  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  snapshot(): EEEObservabilityMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
    const totalOrders = this.totalOrdersAccepted + this.totalOrdersRejected
    const totalFills = this.totalPartialFills + this.totalCompleteFills

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count, totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0, maxMs: t.maxMs,
      }
    }

    return {
      totalOrdersAccepted: this.totalOrdersAccepted,
      totalOrdersRejected: this.totalOrdersRejected,
      totalPartialFills: this.totalPartialFills,
      totalCompleteFills: this.totalCompleteFills,
      avgFillTimeMs: avg(this.fillTimes),
      fillRatio: totalOrders > 0 ? totalFills / totalOrders : 0,
      avgExecutionLatencyMs: avg(this.latencySamples),
      p95ExecutionLatencyMs: percentile(sorted, 0.95),
      maxExecutionLatencyMs: max(this.latencySamples),
      exchangeAvailability: totalOrders > 0 ? this.totalOrdersAccepted / totalOrders : 1,
      totalSessionDisconnects: this.totalSessionDisconnects,
      totalGovernanceEvents: this.totalGovernanceEvents,
      currentSequenceBufferDepth: this.currentSequenceBufferDepth,
      maxSequenceBufferDepth: this.maxSequenceBufferDepth,
      totalOutOfOrderEvents: this.totalOutOfOrderEvents,
      totalReplayRecoveries: this.totalReplayRecoveries,
      totalTradeBusts: this.totalTradeBusts,
      totalTradeCorrections: this.totalTradeCorrections,
      avgGapRecoveryDurationMs: avg(this.gapRecoveryDurations),
      totalGapRecoveries: this.totalGapRecoveries,
      avgReplaySyncLatencyMs: avg(this.replaySyncLatencies),
      executionStatesDistribution: this.executionStates as Record<ExecutionState, number>,
      eventsByType: this.eventsByType,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalOrdersAccepted = 0
    this.totalOrdersRejected = 0
    this.totalPartialFills = 0
    this.totalCompleteFills = 0
    this.fillTimes = []
    this.latencySamples = []
    this.stageTimings = {}
    this.totalSessionDisconnects = 0
    this.totalGovernanceEvents = 0
    this.currentSequenceBufferDepth = 0
    this.maxSequenceBufferDepth = 0
    this.totalOutOfOrderEvents = 0
    this.totalReplayRecoveries = 0
    this.totalTradeBusts = 0
    this.totalTradeCorrections = 0
    this.gapRecoveryDurations = []
    this.totalGapRecoveries = 0
    this.replaySyncLatencies = []
    this.executionStates = {}
    this.eventsByType = {}
    this.windowStart = Date.now()
  }
}

export const eeeObservabilityCollector = new EEEObservabilityCollector()
