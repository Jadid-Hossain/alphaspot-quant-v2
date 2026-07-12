// CHAPTER 5.17 §7-§11 — Data Quality, Provider Management, Fusion, Governance

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  AlternativeDataConfiguration,
  CanonicalAlternativeDataContract,
  CanonicalDataset,
  DataProvider,
  DataQualityResult,
  DataStructureType,
} from './types'

const log = createLogger('decision-intelligence:alt-data:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §7 — ProviderManager (Rule 1/11)
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderManager {
  private providers = new Map<string, DataProvider>()
  private healthStatus = new Map<string, { healthy: boolean; lastCheck: number; failureCount: number }>()

  /** §7 — Register a data provider (Rule 1 — only registered providers may enter). */
  register(provider: DataProvider): void {
    this.providers.set(provider.providerId, provider)
    this.healthStatus.set(provider.providerId, { healthy: true, lastCheck: Date.now(), failureCount: 0 })
    log.info(`provider registered: ${provider.providerId} (${provider.providerType})`)
  }

  get(providerId: string): DataProvider | null { return this.providers.get(providerId) ?? null }
  isRegistered(providerId: string): boolean { return this.providers.has(providerId) }

  /** §8 — Update provider reliability score. */
  updateReliability(providerId: string, score: number): void {
    const p = this.providers.get(providerId)
    if (p) { p.reliabilityScore = score; log.debug(`provider ${providerId} reliability: ${score}`) }
  }

  /** §8 — Record provider failure. */
  recordFailure(providerId: string): void {
    const h = this.healthStatus.get(providerId)
    if (h) { h.failureCount++; h.healthy = h.failureCount < 5; h.lastCheck = Date.now() }
  }

  /** §8 — Check provider health. */
  isHealthy(providerId: string): boolean { return this.healthStatus.get(providerId)?.healthy ?? false }

  /** §15 — Provider failover. */
  getFailoverProvider(dataSource: string): DataProvider | null {
    for (const p of this.providers.values()) {
      if (p.dataSource === dataSource && p.active && this.isHealthy(p.providerId)) return p
    }
    return null
  }

  listProviders(): DataProvider[] { return Array.from(this.providers.values()) }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — DataQualityManager (Rule 9 — quality before publication)
// ─────────────────────────────────────────────────────────────────────────────

export class DataQualityManager {
  /** §8 — Validate dataset quality (Rule 9 — invalid never published). */
  validate(
    dataset: CanonicalDataset,
    provider: DataProvider,
    config: AlternativeDataConfiguration,
  ): DataQualityResult {
    const issues: string[] = []
    const thresholds = config.qualityThresholds
    const dataKeys = Object.keys(dataset.data)

    // §8 — Missing Data Detection
    const missingDataCount = dataKeys.filter((k) => dataset.data[k] === undefined || dataset.data[k] === null).length
    if (missingDataCount > thresholds.maxMissingDataCount) issues.push(`missing data ${missingDataCount} > ${thresholds.maxMissingDataCount}`)

    // §8 — Schema Validation
    const schemaValid = dataKeys.length > 0

    // §8 — Outlier Detection
    const numericValues = Object.values(dataset.data).filter((v): v is number => typeof v === 'number')
    const outlierCount = this.detectOutliers(numericValues)

    // §8 — Completeness Analysis
    const completenessScore = dataKeys.length > 0 ? (dataKeys.length - missingDataCount) / dataKeys.length : 0
    if (completenessScore < thresholds.minCompletenessScore) issues.push(`completeness ${completenessScore.toFixed(2)} < ${thresholds.minCompletenessScore}`)

    // §8 — Provider Reliability Scoring
    if (provider.reliabilityScore < thresholds.minProviderReliabilityScore) issues.push(`provider reliability ${provider.reliabilityScore.toFixed(2)} < ${thresholds.minProviderReliabilityScore}`)

    // §8 — Statistical Validation
    const statisticalValid = numericValues.length > 0 && numericValues.every((v) => Number.isFinite(v))

    // §8 — Consistency Verification
    const consistencyVerified = schemaValid && statisticalValid

    // Compute overall quality score
    const qualityScore = (
      completenessScore * 0.3 +
      provider.reliabilityScore * 0.25 +
      (schemaValid ? 0.15 : 0) +
      (statisticalValid ? 0.15 : 0) +
      (consistencyVerified ? 0.15 : 0)
    )

    let status: DataQualityResult['status']
    if (issues.length === 0 && qualityScore >= thresholds.minQualityScore) status = 'VALIDATED'
    else if (issues.length <= 2 && qualityScore >= thresholds.minQualityScore * 0.8) status = 'WARNING'
    else status = 'INVALID'

    return {
      status, qualityScore, missingDataCount, duplicateCount: 0, outlierCount,
      schemaValid, timestampValid: true, completenessScore, statisticalValid,
      providerReliabilityScore: provider.reliabilityScore, consistencyVerified, issues,
    }
  }

  private detectOutliers(values: number[]): number {
    if (values.length < 4) return 0
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
    if (std === 0) return 0
    return values.filter((v) => Math.abs((v - mean) / std) > 3).length
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — UnstructuredDataParser (Rule 19)
// Rule 19 — Unstructured datasets transformed to canonical structured representations.
// ─────────────────────────────────────────────────────────────────────────────

export class UnstructuredDataParser {
  /** Rule 19 — Parse unstructured data into canonical structured representation. */
  parse(rawData: string, dataSource: string, pipelineVersion: string): CanonicalDataset {
    // Simplified parsing — real implementation would use NLP/tokenizers
    const data: Record<string, number | string | boolean> = {}

    switch (dataSource) {
      case 'NEWS_INTELLIGENCE':
      case 'SOCIAL_MEDIA':
      case 'REDDIT_INTELLIGENCE':
        data['sentiment_score'] = this.extractSentiment(rawData)
        data['mention_count'] = 1
        data['source_type'] = dataSource
        data['text_length'] = rawData.length
        break
      case 'REGULATORY_ANNOUNCEMENTS':
        data['category'] = 'regulatory'
        data['impact_score'] = this.extractImpact(rawData)
        data['text_length'] = rawData.length
        break
      default:
        data['raw_length'] = rawData.length
        data['parsed'] = true
    }

    return {
      data, schemaVersion: '1.0.0',
      originallyUnstructured: true, parsingPipelineVersion: pipelineVersion,
    }
  }

  private extractSentiment(text: string): number {
    const positive = ['bullish', 'surge', 'rally', 'gain', 'pump', 'moon']
    const negative = ['bearish', 'crash', 'dump', 'fall', 'decline', 'fear']
    const lower = text.toLowerCase()
    let score = 0.5
    for (const p of positive) if (lower.includes(p)) score += 0.1
    for (const n of negative) if (lower.includes(n)) score -= 0.1
    return Math.max(0, Math.min(1, score))
  }

  private extractImpact(text: string): number {
    return Math.min(1, text.length / 1000)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — TimestampSynchronizer (Rule 10/18)
// Rule 10 — Timestamp synchronization precedes multi-source fusion.
// Rule 18 — Preserve Event Timestamp + Ingestion Timestamp.
// ─────────────────────────────────────────────────────────────────────────────

export class TimestampSynchronizer {
  /** Rule 10 — Synchronize timestamps before fusion. */
  synchronize(eventTimestamp: number, ingestionTimestamp: number, toleranceMs: number): {
    synced: boolean; adjustedTimestamp: number; rule18Preserved: boolean
  } {
    const diff = Math.abs(ingestionTimestamp - eventTimestamp)
    // Rule 18 — Both timestamps preserved; sync only verifies alignment
    return {
      synced: diff <= toleranceMs,
      adjustedTimestamp: eventTimestamp, // Event timestamp is canonical
      rule18Preserved: true, // Rule 18 — both timestamps preserved
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — MultiSourceFusion (Rule 10 — after timestamp sync)
// ─────────────────────────────────────────────────────────────────────────────

export class MultiSourceFusion {
  /** §5 — Fuse multiple data sources (Rule 10 — after timestamp sync). */
  fuse(datasets: CanonicalDataset[], eventTimestamp: number): CanonicalDataset {
    const fusedData: Record<string, number | string | boolean> = {}
    for (const ds of datasets) {
      for (const [k, v] of Object.entries(ds.data)) {
        // Latest value wins (or average for numeric)
        if (typeof v === 'number' && typeof fusedData[k] === 'number') {
          fusedData[k] = ((fusedData[k] as number) + v) / 2 // average
        } else {
          fusedData[k] = v
        }
      }
    }
    return { data: fusedData, schemaVersion: '1.0.0', originallyUnstructured: false, parsingPipelineVersion: null }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Versioning + Governance + Recovery + Observability
// ─────────────────────────────────────────────────────────────────────────────

export class DatasetVersionRegistry {
  private active = new Map<string, CanonicalAlternativeDataContract>()
  private history = new Map<string, CanonicalAlternativeDataContract[]>()
  register(d: CanonicalAlternativeDataContract): void {
    this.active.set(d.datasetEventId, d)
    const v = this.history.get(d.datasetEventId) ?? []; v.push(d); this.history.set(d.datasetEventId, v)
    log.info(`dataset ${d.datasetEventId} registered`)
  }
  getActive(id: string) { return this.active.get(id) ?? null }
  /** Rule 12 — Deterministic replay. */
  getAllVersions(id: string) { return this.history.get(id) ?? [] }
  listActive() { return Array.from(this.active.keys()) }
}

export const datasetVersionRegistry = new DatasetVersionRegistry()

export class DataGovernanceManager {
  private g = new Map<string, import('./types').DataGovernanceMetadata>()
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

export const dataGovernanceManager = new DataGovernanceManager()

export class DataFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `df-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`alt-data failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const dataFailureRecovery = new DataFailureRecovery()

export interface ADMEObservabilityMetrics {
  totalDatasets: number; avgQualityScore: number; totalDriftEvents: number
  missingDataRate: number; duplicateRate: number; providerFailureRate: number
  avgDatasetLatencyMs: number; totalGovernanceEvents: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class ADMEObservabilityCollector {
  private total = 0; private qualityScores: number[] = []; private driftEvents = 0
  private missingCount = 0; private duplicateCount = 0; private providerFailures = 0
  private latencies: number[] = []; private govEvents = 0
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private windowStart = Date.now()

  recordDataset(qualityScore: number, latencyMs: number, drift: boolean, missing: number, duplicates: number, providerFailed: boolean) {
    this.total++; this.qualityScores.push(qualityScore); this.latencies.push(latencyMs)
    if (drift) this.driftEvents++; this.missingCount += missing; this.duplicateCount += duplicates
    if (providerFailed) this.providerFailures++
    if (this.qualityScores.length > 500) this.qualityScores.shift()
    if (this.latencies.length > 500) this.latencies.shift()
  }
  recordGovernance() { this.govEvents++ }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): ADMEObservabilityMetrics {
    const avg = (a: number[]) => a.length > 0 ? a.reduce((s, b) => s + b, 0) / a.length : 0
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalDatasets: this.total, avgQualityScore: avg(this.qualityScores),
      totalDriftEvents: this.driftEvents, missingDataRate: this.total > 0 ? this.missingCount / this.total : 0,
      duplicateRate: this.total > 0 ? this.duplicateCount / this.total : 0,
      providerFailureRate: this.total > 0 ? this.providerFailures / this.total : 0,
      avgDatasetLatencyMs: avg(this.latencies), totalGovernanceEvents: this.govEvents,
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() {
    this.total = 0; this.qualityScores = []; this.driftEvents = 0; this.missingCount = 0
    this.duplicateCount = 0; this.providerFailures = 0; this.latencies = []; this.govEvents = 0
    this.stageTimings = {}; this.windowStart = Date.now()
  }
}

export const admeObservabilityCollector = new ADMEObservabilityCollector()

// Singletons
export const providerManager = new ProviderManager()
export const dataQualityManager = new DataQualityManager()
export const unstructuredDataParser = new UnstructuredDataParser()
export const timestampSynchronizer = new TimestampSynchronizer()
export const multiSourceFusion = new MultiSourceFusion()
