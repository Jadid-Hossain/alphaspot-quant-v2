// CHAPTER 5.5 §14, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Configuration Reload
//   • Capital Recovery
//   • Position Reconstruction
//   • Failure Logging
//   • Graceful Degradation
//   • Position Quarantine
//   Invalid positions shall NEVER be published.
//
// §14 — Metrics include:
//   • Positions Generated
//   • Position Size Distribution
//   • Capital Utilization
//   • Position Rejections
//   • Quantity Normalization Events
//   • Position Latency
//   • Governance Events

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPositionContract, PositionSizingMethod } from './types'

const log = createLogger('decision-intelligence:position-sizing:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedPosition {
  position: CanonicalPositionContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface PositionFailureRecord {
  failureId: string
  positionId: string | null
  failureType: PositionFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'CAPITAL_ROLLBACK' | 'GRACEFUL_DEGRADATION'
}

export type PositionFailureType =
  | 'RISK_CONTRACT_INVALID'
  | 'CAPITAL_LOCK_FAILED'
  | 'INSUFFICIENT_CAPITAL'
  | 'PRICE_ORACLE_UNAVAILABLE'
  | 'FX_ORACLE_UNAVAILABLE'
  | 'SIZING_METHOD_FAILED'
  | 'HARD_CAP_VIOLATION'
  | 'EXCHANGE_NORMALIZATION_FAILED'
  | 'POSITION_VALIDATION_FAILED'
  | 'CAPITAL_RESERVATION_FAILED'
  | 'INTERNAL_ERROR'

export class PositionFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedPosition>()
  private failures: PositionFailureRecord[] = []
  private readonly MAX_QUARANTINE = 100
  private readonly MAX_FAILURES = 500

  quarantinePosition(position: CanonicalPositionContract, reason: string, currentTime: number = Date.now()): string {
    const id = `pq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { position, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`position ${position.positionId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    positionId: string | null,
    failureType: PositionFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: PositionFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `pf-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, positionId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`position failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
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

export const positionFailureRecovery = new PositionFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface PSEObservabilityMetrics {
  // §14 — Positions Generated
  totalPositions: number
  positionsByMethod: Record<PositionSizingMethod, number>

  // §14 — Position Size Distribution
  avgPositionSize: number
  minPositionSize: number
  maxPositionSize: number
  positionSizeP50: number
  positionSizeP95: number

  // §14 — Capital Utilization
  avgCapitalUtilization: number
  currentCapitalUtilization: number

  // §14 — Position Rejections
  totalRejections: number
  rejectionRate: number

  // §14 — Quantity Normalization Events
  totalNormalizationEvents: number
  normalizationsByStatus: Record<string, number>

  // §14 — Position Latency
  avgLatencyMs: number
  p95LatencyMs: number
  maxLatencyMs: number

  // §14 — Governance Events
  totalGovernanceEvents: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  windowStart: number
  windowEnd: number
}

export class PSEObservabilityCollector {
  private totalPositions = 0
  private positionsByMethod: Record<string, number> = {}
  private positionSizes: number[] = []
  private capitalUtilizations: number[] = []
  private currentCapitalUtilization = 0
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private totalRejections = 0
  private totalNormalizationEvents = 0
  private normalizationsByStatus: Record<string, number> = {}
  private totalGovernanceEvents = 0
  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordPosition(method: PositionSizingMethod, size: number, capitalUtilization: number, latencyMs: number): void {
    this.totalPositions++
    this.positionsByMethod[method] = (this.positionsByMethod[method] ?? 0) + 1
    this.positionSizes.push(size)
    this.capitalUtilizations.push(capitalUtilization)
    this.currentCapitalUtilization = capitalUtilization
    this.latencySamples.push(latencyMs)
    if (this.positionSizes.length > this.MAX_SAMPLES) this.positionSizes.shift()
    if (this.capitalUtilizations.length > this.MAX_SAMPLES) this.capitalUtilizations.shift()
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()
  }

  recordRejection(): void {
    this.totalRejections++
  }

  recordNormalization(status: string): void {
    this.totalNormalizationEvents++
    this.normalizationsByStatus[status] = (this.normalizationsByStatus[status] ?? 0) + 1
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

  snapshot(): PSEObservabilityMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const sorted = [...this.positionSizes].sort((a, b) => a - b)
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0
    const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0

    const latencySorted = [...this.latencySamples].sort((a, b) => a - b)

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count, totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0, maxMs: t.maxMs,
      }
    }

    return {
      totalPositions: this.totalPositions,
      positionsByMethod: this.positionsByMethod as Record<PositionSizingMethod, number>,
      avgPositionSize: avg(this.positionSizes),
      minPositionSize: min(this.positionSizes),
      maxPositionSize: max(this.positionSizes),
      positionSizeP50: percentile(sorted, 0.50),
      positionSizeP95: percentile(sorted, 0.95),
      avgCapitalUtilization: avg(this.capitalUtilizations),
      currentCapitalUtilization: this.currentCapitalUtilization,
      totalRejections: this.totalRejections,
      rejectionRate: this.totalPositions + this.totalRejections > 0
        ? this.totalRejections / (this.totalPositions + this.totalRejections) : 0,
      totalNormalizationEvents: this.totalNormalizationEvents,
      normalizationsByStatus: this.normalizationsByStatus,
      avgLatencyMs: avg(this.latencySamples),
      p95LatencyMs: percentile(latencySorted, 0.95),
      maxLatencyMs: max(this.latencySamples),
      totalGovernanceEvents: this.totalGovernanceEvents,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalPositions = 0
    this.positionsByMethod = {}
    this.positionSizes = []
    this.capitalUtilizations = []
    this.currentCapitalUtilization = 0
    this.latencySamples = []
    this.stageTimings = {}
    this.totalRejections = 0
    this.totalNormalizationEvents = 0
    this.normalizationsByStatus = {}
    this.totalGovernanceEvents = 0
    this.windowStart = Date.now()
  }
}

export const pseObservabilityCollector = new PSEObservabilityCollector()
