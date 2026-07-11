// CHAPTER 5.4 §14, §16 — Failure Recovery & Observability
//
// §16 — Failure recovery supports:
//   • Risk Policy Reload
//   • Configuration Recovery
//   • Risk Quarantine
//   • Failure Logging
//   • Graceful Degradation
//   • State Recovery
//   Unsafe portfolios shall NEVER be approved.
//
// §14 — Metrics include:
//   • Risk Evaluations
//   • Risk Acceptance Rate
//   • Constraint Violations
//   • Exposure Distribution
//   • Drawdown Events
//   • Leverage Usage
//   • Liquidity Violations
//   • Stress Test Failures
//   • Risk Latency
//   • Governance Events

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalRiskContract, RiskDecision } from './types'

const log = createLogger('decision-intelligence:risk-management:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Failure Recovery (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedRisk {
  contract: CanonicalRiskContract
  reason: string
  quarantinedAt: number
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
}

export interface RiskFailureRecord {
  failureId: string
  portfolioId: string | null
  failureType: RiskFailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'POLICY_RELOAD' | 'GRACEFUL_DEGRADATION'
}

export type RiskFailureType =
  | 'PORTFOLIO_INVALID'
  | 'ATOMIC_DEPENDENCY_FAILURE'
  | 'MARGIN_SIMULATION_FAILURE'
  | 'STRESS_TEST_FAILURE'
  | 'CONSTRAINT_VIOLATION_CRITICAL'
  | 'CIRCUIT_BREAKER_TRIGGERED'
  | 'GOVERNANCE_REJECTION'
  | 'INTERNAL_ERROR'

export class RiskFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedRisk>()
  private failures: RiskFailureRecord[] = []
  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  quarantineContract(contract: CanonicalRiskContract, reason: string, currentTime: number = Date.now()): string {
    const id = `rq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.quarantine.set(id, { contract, reason, quarantinedAt: currentTime, reviewStatus: 'PENDING' })
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }
    log.warn(`risk contract ${contract.riskAssessmentId} quarantined: ${reason}`)
    return id
  }

  logFailure(
    portfolioId: string | null,
    failureType: RiskFailureType,
    failureStage: string,
    reason: string,
    recoveredVia: RiskFailureRecord['recoveredVia'] = 'NONE',
    currentTime: number = Date.now(),
  ): string {
    const failureId = `rf-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.failures.push({
      failureId, portfolioId, failureType, failureStage, reason, occurredAt: currentTime, recoveredVia,
    })
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()
    log.error(`risk failure ${failureId} [${failureType}] at ${failureStage}: ${reason}`)
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

export const riskFailureRecovery = new RiskFailureRecoveryManager()

// ─────────────────────────────────────────────────────────────────────────────
// Observability (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface RMEObservabilityMetrics {
  // §14 — Risk Evaluations
  totalEvaluations: number
  evaluationsByDecision: Record<RiskDecision, number>

  // §14 — Risk Acceptance Rate
  acceptanceRate: number

  // §14 — Constraint Violations
  totalConstraintViolations: number
  violationsByCategory: Record<string, number>
  violationsBySeverity: Record<string, number>

  // §14 — Exposure Distribution
  avgGrossExposure: number
  avgNetExposure: number
  avgLeverage: number

  // §14 — Drawdown Events
  drawdownEvents: number
  maxDrawdownObserved: number

  // §14 — Leverage Usage
  avgLeverageUsage: number
  maxLeverageUsage: number

  // §14 — Liquidity Violations
  liquidityViolations: number

  // §14 — Stress Test Failures
  stressTestFailures: number
  stressTestPassRate: number

  // §14 — Risk Latency
  avgRiskLatencyMs: number
  p95RiskLatencyMs: number
  maxRiskLatencyMs: number

  // §14 — Governance Events
  totalGovernanceEvents: number

  // Pipeline stage timings
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>

  // Circuit breakers
  circuitBreakerTriggers: number

  windowStart: number
  windowEnd: number
}

export class RMEObservabilityCollector {
  private totalEvaluations = 0
  private evaluationsByDecision: Record<string, number> = {}
  private acceptanceCount = 0
  private latencySamples: number[] = []
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}

  private totalConstraintViolations = 0
  private violationsByCategory: Record<string, number> = {}
  private violationsBySeverity: Record<string, number> = {}
  private liquidityViolations = 0

  private grossExposures: number[] = []
  private netExposures: number[] = []
  private leverages: number[] = []
  private leverageUsages: number[] = []

  private drawdownEvents = 0
  private maxDrawdownObserved = 0

  private stressTestFailures = 0
  private stressTestTotal = 0

  private totalGovernanceEvents = 0
  private circuitBreakerTriggers = 0

  private windowStart = Date.now()
  private readonly MAX_SAMPLES = 500

  recordEvaluation(decision: RiskDecision, latencyMs: number, grossExposure: number, netExposure: number, leverage: number, leverageUsage: number): void {
    this.totalEvaluations++
    this.evaluationsByDecision[decision] = (this.evaluationsByDecision[decision] ?? 0) + 1
    if (decision === 'APPROVED' || decision === 'PARTIALLY_APPROVED') this.acceptanceCount++

    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > this.MAX_SAMPLES) this.latencySamples.shift()

    this.grossExposures.push(grossExposure)
    this.netExposures.push(netExposure)
    this.leverages.push(leverage)
    this.leverageUsages.push(leverageUsage)
    if (this.grossExposures.length > this.MAX_SAMPLES) this.grossExposures.shift()
    if (this.netExposures.length > this.MAX_SAMPLES) this.netExposures.shift()
    if (this.leverages.length > this.MAX_SAMPLES) this.leverages.shift()
    if (this.leverageUsages.length > this.MAX_SAMPLES) this.leverageUsages.shift()
  }

  recordViolation(category: string, severity: string): void {
    this.totalConstraintViolations++
    this.violationsByCategory[category] = (this.violationsByCategory[category] ?? 0) + 1
    this.violationsBySeverity[severity] = (this.violationsBySeverity[severity] ?? 0) + 1
    if (category === 'LIQUIDITY_RISK') this.liquidityViolations++
  }

  recordStressTest(passed: boolean): void {
    this.stressTestTotal++
    if (!passed) this.stressTestFailures++
  }

  recordDrawdown(drawdown: number): void {
    if (drawdown > 0.05) this.drawdownEvents++
    if (drawdown > this.maxDrawdownObserved) this.maxDrawdownObserved = drawdown
  }

  recordGovernanceEvent(): void {
    this.totalGovernanceEvents++
  }

  recordCircuitBreakerTrigger(): void {
    this.circuitBreakerTriggers++
  }

  recordStageTiming(stage: string, durationMs: number): void {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++
    this.stageTimings[stage].totalMs += durationMs
    if (durationMs > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = durationMs
  }

  snapshot(): RMEObservabilityMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const percentile = (s: number[], p: number) => s.length > 0 ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0

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
      totalEvaluations: this.totalEvaluations,
      evaluationsByDecision: this.evaluationsByDecision as Record<RiskDecision, number>,
      acceptanceRate: this.totalEvaluations > 0 ? this.acceptanceCount / this.totalEvaluations : 0,
      totalConstraintViolations: this.totalConstraintViolations,
      violationsByCategory: this.violationsByCategory,
      violationsBySeverity: this.violationsBySeverity,
      avgGrossExposure: avg(this.grossExposures),
      avgNetExposure: avg(this.netExposures),
      avgLeverage: avg(this.leverages),
      drawdownEvents: this.drawdownEvents,
      maxDrawdownObserved: this.maxDrawdownObserved,
      avgLeverageUsage: avg(this.leverageUsages),
      maxLeverageUsage: max(this.leverageUsages),
      liquidityViolations: this.liquidityViolations,
      stressTestFailures: this.stressTestFailures,
      stressTestPassRate: this.stressTestTotal > 0 ? (this.stressTestTotal - this.stressTestFailures) / this.stressTestTotal : 0,
      avgRiskLatencyMs: avg(this.latencySamples),
      p95RiskLatencyMs: percentile(sorted, 0.95),
      maxRiskLatencyMs: max(this.latencySamples),
      totalGovernanceEvents: this.totalGovernanceEvents,
      stageTimings,
      circuitBreakerTriggers: this.circuitBreakerTriggers,
      windowStart: this.windowStart,
      windowEnd: Date.now(),
    }
  }

  reset(): void {
    this.totalEvaluations = 0
    this.evaluationsByDecision = {}
    this.acceptanceCount = 0
    this.latencySamples = []
    this.stageTimings = {}
    this.totalConstraintViolations = 0
    this.violationsByCategory = {}
    this.violationsBySeverity = {}
    this.liquidityViolations = 0
    this.grossExposures = []
    this.netExposures = []
    this.leverages = []
    this.leverageUsages = []
    this.drawdownEvents = 0
    this.maxDrawdownObserved = 0
    this.stressTestFailures = 0
    this.stressTestTotal = 0
    this.totalGovernanceEvents = 0
    this.circuitBreakerTriggers = 0
    this.windowStart = Date.now()
  }
}

export const rmeObservabilityCollector = new RMEObservabilityCollector()
