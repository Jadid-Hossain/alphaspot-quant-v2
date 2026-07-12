// CHAPTER 5.13 §12-§15, §17 — Versioning, Governance, Recovery, Restatement, Observability

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPerformanceContract, PerformanceRestatement, RestatementType } from './types'

const log = createLogger('decision-intelligence:pnl-performance:governance')

// §12 — Versioning (Rule 5/24 immutable)
export class PerformanceVersionRegistry {
  private active = new Map<string, CanonicalPerformanceContract>()
  private history = new Map<string, CanonicalPerformanceContract[]>()

  register(p: CanonicalPerformanceContract): void {
    this.active.set(p.performanceEventId, p)
    const v = this.history.get(p.performanceEventId) ?? []
    v.push(p)
    this.history.set(p.performanceEventId, v)
    log.info(`performance event ${p.performanceEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  /** Rule 14/30 — Deterministic replay. */
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
  listActive() { return Array.from(this.active.keys()) }
}

export const performanceVersionRegistry = new PerformanceVersionRegistry()

// §13 — Governance
export class PerformanceGovernanceManager {
  private g = new Map<string, import('./types').PerformanceGovernanceMetadata>()
  init(id: string, now: number = Date.now()) {
    if (this.g.has(id)) return this.g.get(id)!
    const m = { approvalStatus: 'PENDING' as const, validationStatus: 'PENDING' as const, reviewHistory: [], auditHistory: [], creationTimestamp: now, calculationTimestamp: null as number | null, retirementStatus: 'ACTIVE' as const, governanceNotes: [] }
    this.g.set(id, m)
    return m
  }
  get(id: string) { return this.g.get(id) ?? null }
  approve(id: string, actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    m.approvalStatus = 'APPROVED'; m.calculationTimestamp = now
  }
  setValidation(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.validationStatus = status
    m.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const performanceGovernanceManager = new PerformanceGovernanceManager()

// §17 — Failure Recovery
export class PerformanceFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`performance failure ${id} [${type}] at ${stage}: ${reason}`)
    return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const performanceFailureRecovery = new PerformanceFailureRecovery()

// §17A — Performance Restatement (Rule 24 — never modify history)
export class PerformanceRestatementManager {
  private restatements: PerformanceRestatement[] = []

  /** §17A — Create restatement (Rule 24 — new immutable version, history preserved). */
  createRestatement(
    originalEventId: string,
    type: RestatementType,
    reason: string,
    newVersion: number,
    now: number = Date.now(),
  ): PerformanceRestatement {
    const r: PerformanceRestatement = {
      restatementId: `restmt-${now.toString(36)}-${Math.random().toString(36).slice(2, 4)}`,
      type, originalPerformanceEventId: originalEventId, reason,
      restatedAt: now, newVersion,
    }
    this.restatements.push(r)
    log.info(`performance restatement: ${r.restatementId} for ${originalEventId} (${type}: ${reason}) — Rule 24: new immutable version`)
    return r
  }

  getRestatements() { return [...this.restatements] }
}

export const performanceRestatementManager = new PerformanceRestatementManager()

// §15 — Observability
export interface PPAEObservabilityMetrics {
  totalPnLEvents: number
  avgPortfolioReturn: number
  avgBenchmarkReturn: number
  totalAttributionEvents: number
  maxDrawdown: number
  avgVolatility: number
  avgCalculationLatencyMs: number
  totalGovernanceEvents: number
  totalIntradayValuationUpdates: number
  totalOfficialNAVPublications: number
  totalRestatements: number
  totalPricingCorrections: number
  totalBenchmarkRevisions: number
  avgGreeksAttributionLatencyMs: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class PPAEObservabilityCollector {
  private total = 0; private returns: number[] = []; private benchmarks: number[] = []
  private attributions = 0; private drawdowns: number[] = []; private vols: number[] = []
  private latencies: number[] = []; private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private govEvents = 0; private intradayUpdates = 0; private navPublications = 0
  private restatements = 0; private pricingCorrections = 0; private benchmarkRevisions = 0
  private greeksLatencies: number[] = []; private windowStart = Date.now()

  recordEvent(portfolioReturn: number, benchmarkReturn: number, drawdown: number, vol: number, latencyMs: number, greeksLatencyMs: number = 0) {
    this.total++; this.returns.push(portfolioReturn); this.benchmarks.push(benchmarkReturn)
    this.drawdowns.push(drawdown); this.vols.push(vol); this.latencies.push(latencyMs)
    this.greeksLatencies.push(greeksLatencyMs)
    if (this.returns.length > 500) this.returns.shift()
    if (this.benchmarks.length > 500) this.benchmarks.shift()
    if (this.latencies.length > 500) this.latencies.shift()
  }
  recordAttribution() { this.attributions++ }
  recordGovernance() { this.govEvents++ }
  recordIntradayUpdate() { this.intradayUpdates++ }
  recordNAVPublication() { this.navPublications++ }
  recordRestatement() { this.restatements++ }
  recordPricingCorrection() { this.pricingCorrections++ }
  recordBenchmarkRevision() { this.benchmarkRevisions++ }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): PPAEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const max = (a: number[]) => a.length > 0 ? Math.max(...a) : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalPnLEvents: this.total,
      avgPortfolioReturn: avg(this.returns),
      avgBenchmarkReturn: avg(this.benchmarks),
      totalAttributionEvents: this.attributions,
      maxDrawdown: max(this.drawdowns),
      avgVolatility: avg(this.vols),
      avgCalculationLatencyMs: avg(this.latencies),
      totalGovernanceEvents: this.govEvents,
      totalIntradayValuationUpdates: this.intradayUpdates,
      totalOfficialNAVPublications: this.navPublications,
      totalRestatements: this.restatements,
      totalPricingCorrections: this.pricingCorrections,
      totalBenchmarkRevisions: this.benchmarkRevisions,
      avgGreeksAttributionLatencyMs: avg(this.greeksLatencies),
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() {
    this.total = 0; this.returns = []; this.benchmarks = []; this.attributions = 0
    this.drawdowns = []; this.vols = []; this.latencies = []; this.stageTimings = {}
    this.govEvents = 0; this.intradayUpdates = 0; this.navPublications = 0
    this.restatements = 0; this.pricingCorrections = 0; this.benchmarkRevisions = 0
    this.greeksLatencies = []; this.windowStart = Date.now()
  }
}

export const ppaeObservabilityCollector = new PPAEObservabilityCollector()
