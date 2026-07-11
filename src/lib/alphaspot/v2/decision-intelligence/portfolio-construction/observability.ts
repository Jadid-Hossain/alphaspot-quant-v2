// CHAPTER 5.3 §14 — Observability
//
// §14 — Metrics include:
//   • Portfolio Builds
//   • Allocation Latency
//   • Allocation Efficiency
//   • Portfolio Diversification
//   • Constraint Violations
//   • Capital Utilization
//   • Governance Events

import type { PortfolioMethod, PortfolioState } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// PCE Observability Metrics (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface PCEObservabilityMetrics {
  // §14 — Portfolio Builds
  totalBuilds: number
  buildsByMethod: Record<PortfolioMethod, number>
  buildsByState: Record<PortfolioState, number>

  // §14 — Allocation Latency
  avgAllocationLatencyMs: number
  p50AllocationLatencyMs: number
  p95AllocationLatencyMs: number
  maxAllocationLatencyMs: number

  // §14 — Allocation Efficiency
  avgAllocationEfficiency: number // realized vs target exposure
  avgCapitalUtilization: number

  // §14 — Portfolio Diversification
  avgDiversificationScore: number
  avgEffectiveAssetCount: number
  avgDiversificationRatio: number

  // §14 — Constraint Violations
  totalConstraintViolations: number
  violationsByType: Record<string, number>
  constraintViolationRate: number

  // §14 — Capital Utilization
  avgGrossExposure: number
  avgNetExposure: number
  avgCashReserve: number
  avgLeverage: number

  // §14 — Governance Events
  totalGovernanceEvents: number
  governanceEventsByType: Record<string, number>

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  // Time window
  windowStart: number
  windowEnd: number
}

// ─────────────────────────────────────────────────────────────────────────────
// PCE Observability Collector
// ─────────────────────────────────────────────────────────────────────────────

export class PCEObservabilityCollector {
  private totalBuilds = 0
  private buildsByMethod: Record<string, number> = {}
  private buildsByState: Record<string, number> = {}
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}

  private allocationEfficiencies: number[] = []
  private capitalUtilizations: number[] = []
  private diversificationScores: number[] = []
  private effectiveAssetCounts: number[] = []
  private diversificationRatios: number[] = []
  private grossExposures: number[] = []
  private netExposures: number[] = []
  private cashReserves: number[] = []
  private leverages: number[] = []

  private totalConstraintViolations = 0
  private violationsByType: Record<string, number> = {}
  private constraintViolationRateSamples: number[] = []

  private totalGovernanceEvents = 0
  private governanceEventsByType: Record<string, number> = {}

  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 1000

  recordBuild(
    method: PortfolioMethod,
    state: PortfolioState,
    latencyMs: number,
    allocationEfficiency: number,
    capitalUtilization: number,
    diversificationScore: number,
    effectiveAssetCount: number,
    diversificationRatio: number,
    grossExposure: number,
    netExposure: number,
    cashReserve: number,
    leverage: number,
  ): void {
    this.totalBuilds++
    this.buildsByMethod[method] = (this.buildsByMethod[method] ?? 0) + 1
    this.buildsByState[state] = (this.buildsByState[state] ?? 0) + 1

    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()

    this.allocationEfficiencies.push(allocationEfficiency)
    this.capitalUtilizations.push(capitalUtilization)
    this.diversificationScores.push(diversificationScore)
    this.effectiveAssetCounts.push(effectiveAssetCount)
    this.diversificationRatios.push(diversificationRatio)
    this.grossExposures.push(grossExposure)
    this.netExposures.push(netExposure)
    this.cashReserves.push(cashReserve)
    this.leverages.push(leverage)
  }

  recordConstraintViolation(violationType: string, totalAssets: number): void {
    this.totalConstraintViolations++
    this.violationsByType[violationType] = (this.violationsByType[violationType] ?? 0) + 1
    this.constraintViolationRateSamples.push(totalAssets > 0 ? 1 / totalAssets : 1)
  }

  recordGovernanceEvent(eventType: string): void {
    this.totalGovernanceEvents++
    this.governanceEventsByType[eventType] = (this.governanceEventsByType[eventType] ?? 0) + 1
  }

  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) {
      this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  snapshot(): PCEObservabilityMetrics {
    const windowEnd = Date.now()
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0

    const stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [stage, t] of Object.entries(this.stageTimings)) {
      stageTimings[stage] = {
        count: t.count,
        totalMs: t.totalMs,
        avgMs: t.count > 0 ? t.totalMs / t.count : 0,
        maxMs: t.maxMs,
      }
    }

    return {
      totalBuilds: this.totalBuilds,
      buildsByMethod: this.buildsByMethod as Record<PortfolioMethod, number>,
      buildsByState: this.buildsByState as Record<PortfolioState, number>,
      avgAllocationLatencyMs: avg(this.latencySamples),
      p50AllocationLatencyMs: percentile(sorted, 0.50),
      p95AllocationLatencyMs: percentile(sorted, 0.95),
      maxAllocationLatencyMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      avgAllocationEfficiency: avg(this.allocationEfficiencies),
      avgCapitalUtilization: avg(this.capitalUtilizations),
      avgDiversificationScore: avg(this.diversificationScores),
      avgEffectiveAssetCount: avg(this.effectiveAssetCounts),
      avgDiversificationRatio: avg(this.diversificationRatios),
      totalConstraintViolations: this.totalConstraintViolations,
      violationsByType: this.violationsByType,
      constraintViolationRate: avg(this.constraintViolationRateSamples),
      avgGrossExposure: avg(this.grossExposures),
      avgNetExposure: avg(this.netExposures),
      avgCashReserve: avg(this.cashReserves),
      avgLeverage: avg(this.leverages),
      totalGovernanceEvents: this.totalGovernanceEvents,
      governanceEventsByType: this.governanceEventsByType,
      stageTimings,
      windowStart: this.windowStart,
      windowEnd,
    }
  }

  reset(): void {
    this.totalBuilds = 0
    this.buildsByMethod = {}
    this.buildsByState = {}
    this.latencySamples = []
    this.stageTimings = {}
    this.allocationEfficiencies = []
    this.capitalUtilizations = []
    this.diversificationScores = []
    this.effectiveAssetCounts = []
    this.diversificationRatios = []
    this.grossExposures = []
    this.netExposures = []
    this.cashReserves = []
    this.leverages = []
    this.totalConstraintViolations = 0
    this.violationsByType = {}
    this.constraintViolationRateSamples = []
    this.totalGovernanceEvents = 0
    this.governanceEventsByType = {}
    this.windowStart = Date.now()
  }
}

export const pceObservabilityCollector = new PCEObservabilityCollector()
