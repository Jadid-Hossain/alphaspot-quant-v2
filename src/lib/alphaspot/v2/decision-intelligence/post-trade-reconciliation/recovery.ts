// CHAPTER 5.11 §14, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Reconciliation Replay, Trade Reconstruction, Configuration Reload
//   • Failure Logging, Graceful Degradation, Exception Quarantine
//   Incomplete reconciliations shall NEVER be promoted to Portfolio Accounting.
//
// §14 — Metrics include:
//   • Trades Reconciled, Matching Rate, Exception Rate, Settlement Delays
//   • Trade Corrections, Trade Busts, Duplicate Trades
//   • Average Reconciliation Latency, Governance Events

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalReconciliationContract, ReconciliationStatus, ReconciliationType } from './types'

const log = createLogger('decision-intelligence:post-trade-reconciliation:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedReconciliation {
  reconciliation: CanonicalReconciliationContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface ReconciliationFailureRecord {
  failureId: string
  reconciliationId: string | null
  failureType: ReconciliationFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'REPLAY' | 'RECONSTRUCTION' | 'QUARANTINE' | 'GRACEFUL_DEGRADATION'
}

export type ReconciliationFailureType =
  | 'EXECUTION_EVENT_INVALID'
  | 'MISSING_CONFIRMATION'
  | 'MATCHING_FAILED'
  | 'SSI_VALIDATION_FAILED'
  | 'SETTLEMENT_VERIFICATION_FAILED'
  | 'EXCEPTION_UNRESOLVED'
  | 'INCOMPLETE_RECONCILIATION'
  | 'INTERNAL_ERROR'

export class ReconciliationFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedReconciliation>()
  private failures: ReconciliationFailureRecord[] = []
  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  quarantineReconciliation(reconciliation: CanonicalReconciliationContract, reason: string, currentTime: number = Date.now()): string {
    const id = `rq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { reconciliation, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`reconciliation ${reconciliation.reconciliationId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    reconciliationId: string | null,
    failureType: ReconciliationFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: ReconciliationFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `rf-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, reconciliationId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`reconciliation failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
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

export const reconciliationFailureRecovery = new ReconciliationFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface PTREObservabilityMetrics {
  // §14 — Trades Reconciled
  totalReconciled: number
  reconciliationsByStatus: Record<ReconciliationStatus, number>
  reconciliationsByType: Record<ReconciliationType, number>

  // §14 — Matching Rate
  matchingRate: number

  // §14 — Exception Rate
  exceptionRate: number
  totalExceptions: number

  // §14 — Settlement Delays
  totalSettlementDelays: number

  // §14 — Trade Corrections / Busts / Duplicates
  totalTradeCorrections: number
  totalTradeBusts: number
  totalDuplicateTrades: number

  // §14 — Average Reconciliation Latency
  avgReconciliationLatencyMs: number
  p95ReconciliationLatencyMs: number
  maxReconciliationLatencyMs: number

  // §14 — Governance Events
  totalGovernanceEvents: number

  // Escrow metrics (§10A)
  totalEscrowCreated: number
  totalEscrowApproved: number
  totalEscrowReleased: number
  totalEscrowAgedOut: number
  totalEscrowRolledBack: number

  // Contra-reconciliation events (Rule 21)
  totalContraReconciliationEvents: number

  // Rollback notifications (Rule 22)
  totalRollbackNotifications: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  windowStart: number
  windowEnd: number
}

export class PTREObservabilityCollector {
  private totalReconciled = 0
  private reconciliationsByStatus: Record<string, number> = {}
  private reconciliationsByType: Record<string, number> = {}
  private totalMatched = 0
  private totalExceptions = 0
  private totalSettlementDelays = 0
  private totalTradeCorrections = 0
  private totalTradeBusts = 0
  private totalDuplicateTrades = 0
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalGovernanceEvents = 0
  private totalEscrowCreated = 0
  private totalEscrowApproved = 0
  private totalEscrowReleased = 0
  private totalEscrowAgedOut = 0
  private totalEscrowRolledBack = 0
  private totalContraReconciliationEvents = 0
  private totalRollbackNotifications = 0
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordReconciliation(status: ReconciliationStatus, type: ReconciliationType, matched: boolean, latencyMs: number): void {
    this.totalReconciled++
    this.reconciliationsByStatus[status] = (this.reconciliationsByStatus[status] ?? 0) + 1
    this.reconciliationsByType[type] = (this.reconciliationsByType[type] ?? 0) + 1
    if (matched) this.totalMatched++
    if (status === 'EXCEPTION' || type === 'MISSING_TRADE' || type === 'DUPLICATE_TRADE') this.totalExceptions++
    if (type === 'TRADE_CORRECTION') this.totalTradeCorrections++
    if (type === 'TRADE_BUST') this.totalTradeBusts++
    if (type === 'DUPLICATE_TRADE') this.totalDuplicateTrades++
    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
  }

  recordSettlementDelay(): void { this.totalSettlementDelays++ }
  recordGovernanceEvent(): void { this.totalGovernanceEvents++ }
  recordEscrowCreated(): void { this.totalEscrowCreated++ }
  recordEscrowApproved(): void { this.totalEscrowApproved++ }
  recordEscrowReleased(): void { this.totalEscrowReleased++ }
  recordEscrowAgedOut(): void { this.totalEscrowAgedOut++ }
  recordEscrowRolledBack(): void { this.totalEscrowRolledBack++ }
  recordContraReconciliation(): void { this.totalContraReconciliationEvents++ }
  recordRollbackNotification(): void { this.totalRollbackNotifications++ }

  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  snapshot(): PTREObservabilityMetrics {
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
      totalReconciled: this.totalReconciled,
      reconciliationsByStatus: this.reconciliationsByStatus as Record<ReconciliationStatus, number>,
      reconciliationsByType: this.reconciliationsByType as Record<ReconciliationType, number>,
      matchingRate: this.totalReconciled > 0 ? this.totalMatched / this.totalReconciled : 0,
      exceptionRate: this.totalReconciled > 0 ? this.totalExceptions / this.totalReconciled : 0,
      totalExceptions: this.totalExceptions,
      totalSettlementDelays: this.totalSettlementDelays,
      totalTradeCorrections: this.totalTradeCorrections,
      totalTradeBusts: this.totalTradeBusts,
      totalDuplicateTrades: this.totalDuplicateTrades,
      avgReconciliationLatencyMs: avg(this.latencySamples),
      p95ReconciliationLatencyMs: percentile(sorted, 0.95),
      maxReconciliationLatencyMs: max(this.latencySamples),
      totalGovernanceEvents: this.totalGovernanceEvents,
      totalEscrowCreated: this.totalEscrowCreated,
      totalEscrowApproved: this.totalEscrowApproved,
      totalEscrowReleased: this.totalEscrowReleased,
      totalEscrowAgedOut: this.totalEscrowAgedOut,
      totalEscrowRolledBack: this.totalEscrowRolledBack,
      totalContraReconciliationEvents: this.totalContraReconciliationEvents,
      totalRollbackNotifications: this.totalRollbackNotifications,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalReconciled = 0
    this.reconciliationsByStatus = {}
    this.reconciliationsByType = {}
    this.totalMatched = 0
    this.totalExceptions = 0
    this.totalSettlementDelays = 0
    this.totalTradeCorrections = 0
    this.totalTradeBusts = 0
    this.totalDuplicateTrades = 0
    this.latencySamples = []
    this.stageTimings = {}
    this.totalGovernanceEvents = 0
    this.totalEscrowCreated = 0
    this.totalEscrowApproved = 0
    this.totalEscrowReleased = 0
    this.totalEscrowAgedOut = 0
    this.totalEscrowRolledBack = 0
    this.totalContraReconciliationEvents = 0
    this.totalRollbackNotifications = 0
    this.windowStart = Date.now()
  }
}

export const ptreObservabilityCollector = new PTREObservabilityCollector()
