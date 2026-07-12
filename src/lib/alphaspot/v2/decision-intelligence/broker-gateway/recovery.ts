// CHAPTER 5.9 §15, §17 — Failure Recovery & Observability
//
// §17 — Failure recovery supports:
//   • Session Recovery, Authentication Recovery, Connection Recovery
//   • Broker Failover, Message Replay, Failure Logging
//   • Graceful Degradation, Gateway Quarantine
//   Failed communications shall never produce ambiguous execution states.
//
// §15 — Metrics include:
//   • Orders Submitted, Submission Latency, Broker Availability, Connection Uptime
//   • Failed Submissions, Session Resets, API Errors, Rate Limit Events
//   • Gateway Throughput, Governance Events, Acknowledgment Latency
//   • Unknown Transmission Count, Rate Governor Activations
//   • Clock Drift, PTP Sync Health, Duplicate Submission Prevention
//   • Idempotency Conflicts, Transmission Retry Count

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalBrokerCommunicationContract, CommunicationProtocol, SubmissionStatus, TransmissionState } from './types'

const log = createLogger('decision-intelligence:broker-gateway:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§17)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedCommunication {
  communication: CanonicalBrokerCommunicationContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface BrokerFailureRecord {
  failureId: string
  brokerRequestId: string | null
  failureType: BrokerFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'FAILOVER' | 'SESSION_RECOVERY' | 'REPLAY' | 'QUARANTINE' | 'GRACEFUL_DEGRADATION'
}

export type BrokerFailureType =
  | 'ROUTING_CONTRACT_INVALID'
  | 'SESSION_BROKEN'
  | 'AUTHENTICATION_FAILED'
  | 'CLOCK_SYNC_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MESSAGE_VALIDATION_FAILED'
  | 'TRANSMISSION_FAILED'
  | 'ACKNOWLEDGMENT_TIMEOUT'
  | 'UNKNOWN_STATE'
  | 'BROKER_FAILOVER'
  | 'INTERNAL_ERROR'

export class BrokerFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedCommunication>()
  private failures: BrokerFailureRecord[] = []
  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  quarantineCommunication(communication: CanonicalBrokerCommunicationContract, reason: string, currentTime: number = Date.now()): string {
    const id = `bq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { communication, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`broker communication ${communication.brokerRequestId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    brokerRequestId: string | null,
    failureType: BrokerFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: BrokerFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `bf-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, brokerRequestId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`broker failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
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

export const brokerFailureRecovery = new BrokerFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§15)
// ─────────────────────────────────────────────────────────────────────────────

export interface BGEObservabilityMetrics {
  // §15 — Orders Submitted
  totalOrdersSubmitted: number
  submissionsByStatus: Record<SubmissionStatus, number>
  submissionsByProtocol: Record<CommunicationProtocol, number>

  // §15 — Submission Latency
  avgSubmissionLatencyMs: number
  p95SubmissionLatencyMs: number
  maxSubmissionLatencyMs: number

  // §15 — Broker Availability
  brokerAvailability: Record<string, number>

  // §15 — Failed Submissions
  totalFailedSubmissions: number

  // §15 — Session Resets
  totalSessionResets: number

  // §15 — API Errors
  totalApiErrors: number

  // §15 — Rate Limit Events
  totalRateLimitEvents: number
  rateGovernorActivations: number

  // §15 — Gateway Throughput
  gatewayThroughput: number // requests per second

  // §15 — Governance Events
  totalGovernanceEvents: number

  // §15 — Acknowledgment Latency
  avgAcknowledgmentLatencyMs: number

  // §15 — Unknown Transmission Count
  unknownTransmissionCount: number

  // §15 — Clock Drift
  currentClockDrift: number
  ptpSyncHealth: number

  // §15 — Duplicate Submission Prevention
  duplicateSubmissionsPrevented: number
  idempotencyConflicts: number

  // §15 — Transmission Retry Count
  totalRetries: number

  // Transmissions by state (§10A)
  transmissionsByState: Record<TransmissionState, number>

  // Failover events (§11)
  totalFailoverEvents: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  windowStart: number
  windowEnd: number
}

export class BGEObservabilityCollector {
  private totalOrdersSubmitted = 0
  private submissionsByStatus: Record<string, number> = {}
  private submissionsByProtocol: Record<string, number> = {}
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private brokerAvailability: Record<string, number> = {}
  private totalFailedSubmissions = 0
  private totalSessionResets = 0
  private totalApiErrors = 0
  private totalRateLimitEvents = 0
  private rateGovernorActivations = 0
  private totalGovernanceEvents = 0
  private acknowledgmentLatencies: number[] = []
  private unknownTransmissionCount = 0
  private currentClockDrift = 0
  private ptpSyncHealth = 1.0
  private duplicateSubmissionsPrevented = 0
  private idempotencyConflicts = 0
  private totalRetries = 0
  private transmissionsByState: Record<string, number> = {}
  private totalFailoverEvents = 0
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordSubmission(status: SubmissionStatus, protocol: CommunicationProtocol, latencyMs: number, brokerId: string): void {
    this.totalOrdersSubmitted++
    this.submissionsByStatus[status] = (this.submissionsByStatus[status] ?? 0) + 1
    this.submissionsByProtocol[protocol] = (this.submissionsByProtocol[protocol] ?? 0) + 1
    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
    // Update broker availability (simplified: 1 = available)
    this.brokerAvailability[brokerId] = 1
    if (status === 'FAILED' || status === 'REJECTED') this.totalFailedSubmissions++
  }

  recordTransmissionState(state: TransmissionState): void {
    this.transmissionsByState[state] = (this.transmissionsByState[state] ?? 0) + 1
    if (state === 'UNKNOWN_STATE') this.unknownTransmissionCount++
  }

  recordSessionReset(): void { this.totalSessionResets++ }
  recordApiError(): void { this.totalApiErrors++ }
  recordRateLimitEvent(): void { this.totalRateLimitEvents++ }
  recordRateGovernorActivation(): void { this.rateGovernorActivations++ }
  recordGovernanceEvent(): void { this.totalGovernanceEvents++ }
  recordAcknowledgmentLatency(ms: number): void {
    this.acknowledgmentLatencies.push(ms)
    if (this.acknowledgmentLatencies.length > this.MAX_SAMPLES) this.acknowledgmentLatencies.shift()
  }
  recordClockDrift(drift: number, health: number): void {
    this.currentClockDrift = drift
    this.ptpSyncHealth = health
  }
  recordDuplicatePrevented(): void { this.duplicateSubmissionsPrevented++ }
  recordIdempotencyConflict(): void { this.idempotencyConflicts++ }
  recordRetry(): void { this.totalRetries++ }
  recordFailoverEvent(): void { this.totalFailoverEvents++ }

  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  snapshot(): BGEObservabilityMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
    const windowSeconds = (Date.now() - this.windowStart) / 1000

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count, totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0, maxMs: t.maxMs,
      }
    }

    return {
      totalOrdersSubmitted: this.totalOrdersSubmitted,
      submissionsByStatus: this.submissionsByStatus as Record<SubmissionStatus, number>,
      submissionsByProtocol: this.submissionsByProtocol as Record<CommunicationProtocol, number>,
      avgSubmissionLatencyMs: avg(this.latencySamples),
      p95SubmissionLatencyMs: percentile(sorted, 0.95),
      maxSubmissionLatencyMs: max(this.latencySamples),
      brokerAvailability: this.brokerAvailability,
      totalFailedSubmissions: this.totalFailedSubmissions,
      totalSessionResets: this.totalSessionResets,
      totalApiErrors: this.totalApiErrors,
      totalRateLimitEvents: this.totalRateLimitEvents,
      rateGovernorActivations: this.rateGovernorActivations,
      gatewayThroughput: windowSeconds > 0 ? this.totalOrdersSubmitted / windowSeconds : 0,
      totalGovernanceEvents: this.totalGovernanceEvents,
      avgAcknowledgmentLatencyMs: avg(this.acknowledgmentLatencies),
      unknownTransmissionCount: this.unknownTransmissionCount,
      currentClockDrift: this.currentClockDrift,
      ptpSyncHealth: this.ptpSyncHealth,
      duplicateSubmissionsPrevented: this.duplicateSubmissionsPrevented,
      idempotencyConflicts: this.idempotencyConflicts,
      totalRetries: this.totalRetries,
      transmissionsByState: this.transmissionsByState as Record<TransmissionState, number>,
      totalFailoverEvents: this.totalFailoverEvents,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalOrdersSubmitted = 0
    this.submissionsByStatus = {}
    this.submissionsByProtocol = {}
    this.latencySamples = []
    this.stageTimings = {}
    this.brokerAvailability = {}
    this.totalFailedSubmissions = 0
    this.totalSessionResets = 0
    this.totalApiErrors = 0
    this.totalRateLimitEvents = 0
    this.rateGovernorActivations = 0
    this.totalGovernanceEvents = 0
    this.acknowledgmentLatencies = []
    this.unknownTransmissionCount = 0
    this.currentClockDrift = 0
    this.ptpSyncHealth = 1.0
    this.duplicateSubmissionsPrevented = 0
    this.idempotencyConflicts = 0
    this.totalRetries = 0
    this.transmissionsByState = {}
    this.totalFailoverEvents = 0
    this.windowStart = Date.now()
  }
}

export const bgeObservabilityCollector = new BGEObservabilityCollector()
