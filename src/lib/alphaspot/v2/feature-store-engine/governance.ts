// CHAPTER 5.16 §10, §12, §14, §16 — Versioning, Governance, Recovery, Observability

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalFeatureContract } from './types'

const log = createLogger('decision-intelligence:feature-store:governance')

export class FeatureVersionRegistry {
  private active = new Map<string, CanonicalFeatureContract>()
  private history = new Map<string, CanonicalFeatureContract[]>()
  register(f: CanonicalFeatureContract): void {
    this.active.set(f.featureEventId, f)
    const v = this.history.get(f.featureEventId) ?? []; v.push(f); this.history.set(f.featureEventId, v)
    log.info(`feature event ${f.featureEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  /** Rule 14 — Deterministic replay. */
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
  listActive() { return Array.from(this.active.keys()) }
}

export const featureVersionRegistry = new FeatureVersionRegistry()

export class FeatureGovernanceManager {
  private g = new Map<string, import('./types').FeatureGovernanceMetadata>()
  init(id: string, now: number = Date.now()) {
    if (this.g.has(id)) return this.g.get(id)!
    const m = { approvalStatus: 'PENDING' as const, validationStatus: 'PENDING' as const, reviewHistory: [], auditHistory: [], creationTimestamp: now, publicationTimestamp: null as number | null, retirementStatus: 'ACTIVE' as const, governanceNotes: [] }
    this.g.set(id, m); return m
  }
  get(id: string) { return this.g.get(id) ?? null }
  approve(id: string, actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    m.approvalStatus = 'APPROVED'; m.publicationTimestamp = now
  }
  setValidation(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.validationStatus = status; m.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const featureGovernanceManager = new FeatureGovernanceManager()

export class FeatureFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `ff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`feature failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const featureFailureRecovery = new FeatureFailureRecovery()

export interface FSEObservabilityMetrics {
  totalFeaturesGenerated: number
  avgFeatureLatencyMs: number
  avgFreshnessScore: number
  totalDriftEvents: number
  totalDataQualityEvents: number
  missingFeatureRate: number
  cacheHitRatio: number
  transformationErrors: number
  totalGovernanceEvents: number
  avgOnlineRetrievalLatencyMs: number
  avgOfflineReconstructionLatencyMs: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class FSEObservabilityCollector {
  private total = 0; private latencies: number[] = []; private freshnessScores: number[] = []
  private driftEvents = 0; private dqEvents = 0; private missingRate: number[] = []
  private cacheHits = 0; private cacheMisses = 0; private transformErrors = 0
  private govEvents = 0; private onlineLatencies: number[] = []; private offlineLatencies: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private windowStart = Date.now()

  recordGeneration(latencyMs: number, freshnessScore: number, driftDetected: boolean, dqIssue: boolean) {
    this.total++; this.latencies.push(latencyMs); this.freshnessScores.push(freshnessScore)
    if (driftDetected) this.driftEvents++
    if (dqIssue) this.dqEvents++
    if (this.latencies.length > 500) this.latencies.shift()
    if (this.freshnessScores.length > 500) this.freshnessScores.shift()
  }
  recordCacheHit() { this.cacheHits++ }
  recordCacheMiss() { this.cacheMisses++ }
  recordTransformationError() { this.transformErrors++ }
  recordGovernance() { this.govEvents++ }
  recordOnlineRetrieval(ms: number) { this.onlineLatencies.push(ms); if (this.onlineLatencies.length > 500) this.onlineLatencies.shift() }
  recordOfflineReconstruction(ms: number) { this.offlineLatencies.push(ms); if (this.offlineLatencies.length > 500) this.offlineLatencies.shift() }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): FSEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    const totalCache = this.cacheHits + this.cacheMisses
    return {
      totalFeaturesGenerated: this.total, avgFeatureLatencyMs: avg(this.latencies),
      avgFreshnessScore: avg(this.freshnessScores), totalDriftEvents: this.driftEvents,
      totalDataQualityEvents: this.dqEvents, missingFeatureRate: avg(this.missingRate),
      cacheHitRatio: totalCache > 0 ? this.cacheHits / totalCache : 0,
      transformationErrors: this.transformErrors, totalGovernanceEvents: this.govEvents,
      avgOnlineRetrievalLatencyMs: avg(this.onlineLatencies),
      avgOfflineReconstructionLatencyMs: avg(this.offlineLatencies),
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() {
    this.total = 0; this.latencies = []; this.freshnessScores = []; this.driftEvents = 0
    this.dqEvents = 0; this.missingRate = []; this.cacheHits = 0; this.cacheMisses = 0
    this.transformErrors = 0; this.govEvents = 0; this.onlineLatencies = []; this.offlineLatencies = []
    this.stageTimings = {}; this.windowStart = Date.now()
  }
}

export const fseObservabilityCollector = new FSEObservabilityCollector()
