// CHAPTER 5.12 §13, §14, §16, §18 — Versioning, Governance, Recovery & Observability

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AccountingAuditEvent,
  AccountingGovernanceMetadata,
  AccountingVersionBundle,
  CanonicalPortfolioAccountingContract,
} from './types'

const log = createLogger('decision-intelligence:portfolio-accounting:governance')

// §13 — Versioning (Rule 5 immutable)
export class AccountingVersionRegistry {
  private active = new Map<string, CanonicalPortfolioAccountingContract>()
  private history = new Map<string, CanonicalPortfolioAccountingContract[]>()

  register(acct: CanonicalPortfolioAccountingContract): void {
    this.active.set(acct.accountingEventId, acct)
    const versions = this.history.get(acct.accountingEventId) ?? []
    versions.push(acct)
    this.history.set(acct.accountingEventId, versions)
    log.info(`accounting event ${acct.accountingEventId} registered`)
  }

  getActive(id: string): CanonicalPortfolioAccountingContract | null { return this.active.get(id) ?? null }
  /** Rule 15 — Deterministic replay. */
  getAllVersions(id: string): CanonicalPortfolioAccountingContract[] { return this.history.get(id) ?? [] }
  listActive(): string[] { return Array.from(this.active.keys()) }
}

export const accountingVersionRegistry = new AccountingVersionRegistry()

// §14 — Governance
export class AccountingGovernanceManager {
  private governance = new Map<string, AccountingGovernanceMetadata>()

  initialize(id: string, now: number = Date.now()): AccountingGovernanceMetadata {
    if (this.governance.has(id)) return this.governance.get(id)!
    const meta: AccountingGovernanceMetadata = {
      approvalStatus: 'PENDING', validationStatus: 'PENDING', reviewHistory: [],
      auditHistory: [], creationTimestamp: now, postingTimestamp: null,
      retirementStatus: 'ACTIVE', governanceNotes: [],
    }
    this.governance.set(id, meta)
    return meta
  }

  get(id: string): AccountingGovernanceMetadata | null { return this.governance.get(id) ?? null }

  approve(id: string, actor: string, note: string, now: number = Date.now()): void {
    const meta = this.governance.get(id) ?? this.initialize(id, now)
    meta.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    meta.postingTimestamp = now
  }

  setValidationStatus(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()): void {
    const meta = this.governance.get(id) ?? this.initialize(id, now)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const accountingGovernanceManager = new AccountingGovernanceManager()

// §16, §18 — Failure Recovery + Observability
export interface AccountingFailureRecord {
  failureId: string; accountingEventId: string | null
  failureType: string; failureStage: string; reason: string
  occurredAt: number; recoveredVia: string
}

export class AccountingFailureRecoveryManager {
  private failures: AccountingFailureRecord[] = []
  logFailure(id: string | null, type: string, stage: string, reason: string, recoveredVia: string = 'NONE'): string {
    const fid = `af-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({ failureId: fid, accountingEventId: id, failureType: type, failureStage: stage, reason, occurredAt: Date.now(), recoveredVia: recoveredVia })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`accounting failure ${fid} [${type}] at ${stage}: ${reason}`)
    return fid
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.failureType] = (byType[f.failureType] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const accountingFailureRecovery = new AccountingFailureRecoveryManager()

export interface PAEObservabilityMetrics {
  totalAccountingEvents: number
  totalLedgerUpdates: number
  totalCashBalanceChanges: number
  totalPositionChanges: number
  totalCorporateActions: number
  totalFXAdjustments: number
  avgLedgerLatencyMs: number
  totalGovernanceEvents: number
  totalCompensatingJournals: number
  totalShortPositions: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class PAEObservabilityCollector {
  private totalEvents = 0; private totalLedgerUpdates = 0
  private totalCashChanges = 0; private totalPositionChanges = 0
  private totalCorpActions = 0; private totalFXAdjustments = 0
  private latencies: number[] = []; private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalGovEvents = 0; private totalCompensating = 0; private totalShort = 0
  private windowStart = Date.now()

  recordEvent(ledgerUpdates: number, cashChanges: number, positionChanges: number, latencyMs: number, isShort: boolean): void {
    this.totalEvents++; this.totalLedgerUpdates += ledgerUpdates
    this.totalCashChanges += cashChanges; this.totalPositionChanges += positionChanges
    this.latencies.push(latencyMs); if (this.latencies.length > 500) this.latencies.shift()
    if (isShort) this.totalShort++
  }
  recordCorporateAction(): void { this.totalCorpActions++ }
  recordFXAdjustment(): void { this.totalFXAdjustments++ }
  recordGovernanceEvent(): void { this.totalGovEvents++ }
  recordCompensatingJournal(): void { this.totalCompensating++ }
  recordStageTiming(stage: string, ms: number): void {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }
  snapshot(): PAEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalAccountingEvents: this.totalEvents, totalLedgerUpdates: this.totalLedgerUpdates,
      totalCashBalanceChanges: this.totalCashChanges, totalPositionChanges: this.totalPositionChanges,
      totalCorporateActions: this.totalCorpActions, totalFXAdjustments: this.totalFXAdjustments,
      avgLedgerLatencyMs: avg(this.latencies), totalGovernanceEvents: this.totalGovEvents,
      totalCompensatingJournals: this.totalCompensating, totalShortPositions: this.totalShort,
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset(): void {
    this.totalEvents = 0; this.totalLedgerUpdates = 0; this.totalCashChanges = 0
    this.totalPositionChanges = 0; this.totalCorpActions = 0; this.totalFXAdjustments = 0
    this.latencies = []; this.stageTimings = {}; this.totalGovEvents = 0
    this.totalCompensating = 0; this.totalShort = 0; this.windowStart = Date.now()
  }
}

export const paeObservabilityCollector = new PAEObservabilityCollector()
