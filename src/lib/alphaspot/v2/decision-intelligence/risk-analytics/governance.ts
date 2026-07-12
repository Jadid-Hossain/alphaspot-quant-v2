// CHAPTER 5.14 §13-§16 — Versioning, Governance, Recovery, Observability

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalRiskContract } from './types'

const log = createLogger('decision-intelligence:risk-analytics:governance')

export class RiskVersionRegistry {
  private active = new Map<string, CanonicalRiskContract>()
  private history = new Map<string, CanonicalRiskContract[]>()
  register(r: CanonicalRiskContract): void {
    this.active.set(r.riskEventId, r)
    const v = this.history.get(r.riskEventId) ?? []; v.push(r); this.history.set(r.riskEventId, v)
    log.info(`risk event ${r.riskEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
  listActive() { return Array.from(this.active.keys()) }
}

export const riskVersionRegistry = new RiskVersionRegistry()

export class RiskGovernanceManager {
  private g = new Map<string, import('./types').RiskGovernanceMetadata>()
  init(id: string, now: number = Date.now()) {
    if (this.g.has(id)) return this.g.get(id)!
    const m = { approvalStatus: 'PENDING' as const, validationStatus: 'PENDING' as const, reviewHistory: [], auditHistory: [], creationTimestamp: now, calculationTimestamp: null as number | null, retirementStatus: 'ACTIVE' as const, governanceNotes: [] }
    this.g.set(id, m); return m
  }
  get(id: string) { return this.g.get(id) ?? null }
  approve(id: string, actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    m.approvalStatus = 'APPROVED'; m.calculationTimestamp = now
  }
  setValidation(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.validationStatus = status; m.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const riskGovernanceManager = new RiskGovernanceManager()

export class RiskFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `rf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`risk failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const riskFailureRecovery = new RiskFailureRecovery()

export interface RAEEObservabilityMetrics {
  totalVaREvents: number; totalExposureUpdates: number; totalStressTests: number
  totalScenarioRuns: number; totalLiquidityAlerts: number; avgMarginUtilization: number
  totalConcentrationAlerts: number; avgCalculationLatencyMs: number
  totalGovernanceEvents: number; totalRegimeTransitions: number
  totalCorrelationMatrixSwitches: number; nettingEfficiency: number
  enterpriseGrossExposure: number; enterpriseNetExposure: number
  totalIntradayRiskUpdates: number; totalOfficialRiskPublications: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class RAEEObservabilityCollector {
  private total = 0; private exposures = 0; private stress = 0; private scenarios = 0
  private liqAlerts = 0; private marginUtil: number[] = []; private concAlerts = 0
  private latencies: number[] = []; private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private govEvents = 0; private regimeTransitions = 0; private corrSwitches = 0
  private nettingEff = 0; private entGross = 0; private entNet = 0
  private intradayUpdates = 0; private officialPubs = 0
  private windowStart = Date.now()

  recordVaREvent(marginUtil: number, entGross: number, entNet: number, latencyMs: number, isOfficial: boolean) {
    this.total++; this.marginUtil.push(marginUtil); this.entGross = entGross; this.entNet = entNet
    this.latencies.push(latencyMs)
    if (this.marginUtil.length > 500) this.marginUtil.shift()
    if (this.latencies.length > 500) this.latencies.shift()
    if (isOfficial) this.officialPubs++; else this.intradayUpdates++
  }
  recordExposure() { this.exposures++ }
  recordStressTest() { this.stress++ }
  recordScenarioRun() { this.scenarios++ }
  recordLiquidityAlert() { this.liqAlerts++ }
  recordConcentrationAlert() { this.concAlerts++ }
  recordGovernance() { this.govEvents++ }
  recordRegimeTransition() { this.regimeTransitions++ }
  recordCorrelationSwitch() { this.corrSwitches++ }
  recordNettingEfficiency(eff: number) { this.nettingEff = eff }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): RAEEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalVaREvents: this.total, totalExposureUpdates: this.exposures,
      totalStressTests: this.stress, totalScenarioRuns: this.scenarios,
      totalLiquidityAlerts: this.liqAlerts, avgMarginUtilization: avg(this.marginUtil),
      totalConcentrationAlerts: this.concAlerts, avgCalculationLatencyMs: avg(this.latencies),
      totalGovernanceEvents: this.govEvents, totalRegimeTransitions: this.regimeTransitions,
      totalCorrelationMatrixSwitches: this.corrSwitches, nettingEfficiency: this.nettingEff,
      enterpriseGrossExposure: this.entGross, enterpriseNetExposure: this.entNet,
      totalIntradayRiskUpdates: this.intradayUpdates, totalOfficialRiskPublications: this.officialPubs,
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() {
    this.total = 0; this.exposures = 0; this.stress = 0; this.scenarios = 0
    this.liqAlerts = 0; this.marginUtil = []; this.concAlerts = 0
    this.latencies = []; this.stageTimings = {}; this.govEvents = 0
    this.regimeTransitions = 0; this.corrSwitches = 0; this.nettingEff = 0
    this.entGross = 0; this.entNet = 0; this.intradayUpdates = 0; this.officialPubs = 0
    this.windowStart = Date.now()
  }
}

export const raeeObservabilityCollector = new RAEEObservabilityCollector()
