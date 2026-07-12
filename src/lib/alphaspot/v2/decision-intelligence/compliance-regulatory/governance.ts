// CHAPTER 5.15 §12-§17 — Versioning, Governance, Recovery, Observability

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalComplianceContract } from './types'

const log = createLogger('decision-intelligence:compliance-regulatory:governance')

export class ComplianceVersionRegistry {
  private active = new Map<string, CanonicalComplianceContract>()
  private history = new Map<string, CanonicalComplianceContract[]>()
  register(c: CanonicalComplianceContract): void {
    this.active.set(c.complianceEventId, c)
    const v = this.history.get(c.complianceEventId) ?? []; v.push(c); this.history.set(c.complianceEventId, v)
    log.info(`compliance event ${c.complianceEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
  listActive() { return Array.from(this.active.keys()) }
}

export const complianceVersionRegistry = new ComplianceVersionRegistry()

export class ComplianceGovernanceManager {
  private g = new Map<string, import('./types').ComplianceGovernanceMetadata>()
  init(id: string, now: number = Date.now()) {
    if (this.g.has(id)) return this.g.get(id)!
    const m = { approvalStatus: 'PENDING' as const, validationStatus: 'PENDING' as const, reviewHistory: [], auditHistory: [], creationTimestamp: now, evaluationTimestamp: null as number | null, retirementStatus: 'ACTIVE' as const, governanceNotes: [] }
    this.g.set(id, m); return m
  }
  get(id: string) { return this.g.get(id) ?? null }
  approve(id: string, actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    m.approvalStatus = 'APPROVED'; m.evaluationTimestamp = now
  }
  setValidation(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.validationStatus = status; m.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const complianceGovernanceManager = new ComplianceGovernanceManager()

export class ComplianceFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`compliance failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const complianceFailureRecovery = new ComplianceFailureRecovery()

export interface CRCEObservabilityMetrics {
  totalComplianceEvents: number
  totalRuleViolations: number
  totalRestrictionViolations: number
  totalAMLAlerts: number
  totalKYCAlerts: number
  totalSurveillanceAlerts: number
  totalApprovalEvents: number
  avgComplianceLatencyMs: number
  totalGovernanceEvents: number
  totalOrdersApproved: number
  totalOrdersVetoed: number
  avgPreTradeLatencyMs: number
  totalPassiveBreachAlerts: number
  totalMandatoryReviews: number
  totalRuleCompilationErrors: number
  totalDSLVersionChanges: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class CRCEObservabilityCollector {
  private total = 0; private ruleVio = 0; private restrictVio = 0
  private amlAlerts = 0; private kycAlerts = 0; private survAlerts = 0
  private approvals = 0; private latencies: number[] = []
  private preTradeLatencies: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private govEvents = 0; private ordersApproved = 0; private ordersVetoed = 0
  private passiveBreaches = 0; private mandatoryReviews = 0
  private ruleCompileErrors = 0; private dslVersionChanges = 0
  private windowStart = Date.now()

  recordEvent(context: string, decision: string, latencyMs: number) {
    this.total++; this.latencies.push(latencyMs)
    if (context === 'PRE_TRADE') {
      this.preTradeLatencies.push(latencyMs)
      if (decision === 'APPROVED' || decision === 'WARNING') this.ordersApproved++
      if (decision === 'HARD_VETO') this.ordersVetoed++
      this.approvals++
    }
    if (context === 'POST_TRADE') {
      if (decision === 'PASSIVE_BREACH_ALERT') this.passiveBreaches++
      if (decision === 'MANDATORY_REVIEW') this.mandatoryReviews++
    }
    if (this.latencies.length > 500) this.latencies.shift()
    if (this.preTradeLatencies.length > 500) this.preTradeLatencies.shift()
  }
  recordRuleViolation() { this.ruleVio++ }
  recordRestrictionViolation() { this.restrictVio++ }
  recordAMLAlert() { this.amlAlerts++ }
  recordKYCAlert() { this.kycAlerts++ }
  recordSurveillanceAlert() { this.survAlerts++ }
  recordGovernance() { this.govEvents++ }
  recordRuleCompilationError() { this.ruleCompileErrors++ }
  recordDSLVersionChange() { this.dslVersionChanges++ }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): CRCEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalComplianceEvents: this.total, totalRuleViolations: this.ruleVio,
      totalRestrictionViolations: this.restrictVio, totalAMLAlerts: this.amlAlerts,
      totalKYCAlerts: this.kycAlerts, totalSurveillanceAlerts: this.survAlerts,
      totalApprovalEvents: this.approvals, avgComplianceLatencyMs: avg(this.latencies),
      totalGovernanceEvents: this.govEvents, totalOrdersApproved: this.ordersApproved,
      totalOrdersVetoed: this.ordersVetoed, avgPreTradeLatencyMs: avg(this.preTradeLatencies),
      totalPassiveBreachAlerts: this.passiveBreaches, totalMandatoryReviews: this.mandatoryReviews,
      totalRuleCompilationErrors: this.ruleCompileErrors, totalDSLVersionChanges: this.dslVersionChanges,
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() {
    this.total = 0; this.ruleVio = 0; this.restrictVio = 0; this.amlAlerts = 0
    this.kycAlerts = 0; this.survAlerts = 0; this.approvals = 0; this.latencies = []
    this.preTradeLatencies = []; this.stageTimings = {}; this.govEvents = 0
    this.ordersApproved = 0; this.ordersVetoed = 0; this.passiveBreaches = 0
    this.mandatoryReviews = 0; this.ruleCompileErrors = 0; this.dslVersionChanges = 0
    this.windowStart = Date.now()
  }
}

export const crceObservabilityCollector = new CRCEObservabilityCollector()
