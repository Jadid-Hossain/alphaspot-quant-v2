// CHAPTER 5.2 §16 — Failure Recovery
//
// §16 — Failure recovery supports:
//   • Strategy Reload
//   • Configuration Recovery
//   • Decision Quarantine
//   • Failure Logging
//   • Graceful Degradation
//   • State Recovery
//   • Strategy Suspension
//   • Cooldown Recovery
//   • State Restoration
//   • Cross-Strategy Reconciliation Recovery
//   • Capital Reservation Recovery
//
// Invalid strategy decisions shall NEVER be published.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalStrategyDecision } from './types'

const log = createLogger('decision-intelligence:strategy-engine:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// QuarantinedDecision — invalid decisions held for analysis (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedDecision {
  decision: CanonicalStrategyDecision
  quarantineReason: string
  quarantinedAt: number
  quarantinedBy: string
  reviewStatus: 'PENDING' | 'REVIEWED' | 'REJECTED' | 'RELEASED'
  reviewNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// FailureRecord — failures logged for observability (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface FailureRecord {
  failureId: string
  strategyId: string | null
  failureType: FailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'SUSPEND' | 'COOLDOWN' | 'RELOAD' | 'GRACEFUL_DEGRADATION'
  metadata: Record<string, unknown>
}

export type FailureType =
  | 'SIGNAL_INVALID'
  | 'STRATEGY_NOT_FOUND'
  | 'STRATEGY_NOT_AVAILABLE'
  | 'RULE_EVALUATION_ERROR'
  | 'REGIME_INCOMPATIBLE'
  | 'DECISION_VALIDATION_FAILED'
  | 'CAPACITY_INSUFFICIENT'
  | 'RECONCILIATION_FAILURE'
  | 'STATE_TRANSITION_INVALID'
  | 'GOVERNANCE_REJECTION'
  | 'INTERNAL_ERROR'

// ─────────────────────────────────────────────────────────────────────────────
// FailureRecoveryManager (§16)
// ─────────────────────────────────────────────────────────────────────────────

export class FailureRecoveryManager {
  /** Quarantine (bounded — Rule 14 of overall architecture: bounded memory). */
  private quarantine = new Map<string, QuarantinedDecision>()
  /** Failure log (bounded). */
  private failures: FailureRecord[] = []
  /** Strategies currently in graceful degradation. */
  private degraded = new Set<string>()

  private readonly MAX_QUARANTINE = 200
  private readonly MAX_FAILURES = 1000

  /**
   * Quarantine an invalid decision (§16).
   * Invalid decisions shall NEVER be published — they go to quarantine instead.
   */
  quarantineDecision(
    decision: CanonicalStrategyDecision,
    reason: string,
    actor: string = 'sie-engine',
    currentTime: number = Date.now(),
  ): string {
    const quarantineId = `q-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const record: QuarantinedDecision = {
      decision,
      quarantineReason: reason,
      quarantinedAt: currentTime,
      quarantinedBy: actor,
      reviewStatus: 'PENDING',
      reviewNotes: [],
    }
    this.quarantine.set(quarantineId, record)

    // Bound quarantine size (FIFO eviction)
    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }

    log.warn(`decision ${decision.decisionId} quarantined: ${reason}`)
    return quarantineId
  }

  /** Review a quarantined decision (§16). */
  reviewQuarantined(quarantineId: string, status: QuarantinedDecision['reviewStatus'], note: string): boolean {
    const record = this.quarantine.get(quarantineId)
    if (!record) return false
    record.reviewStatus = status
    record.reviewNotes.push(note)
    log.info(`quarantined decision ${quarantineId} reviewed: ${status}`)
    return true
  }

  /** Get a quarantined decision for analysis. */
  getQuarantined(quarantineId: string): QuarantinedDecision | null {
    return this.quarantine.get(quarantineId) ?? null
  }

  /** List all quarantined decisions. */
  listQuarantined(): Array<QuarantinedDecision> {
    return Array.from(this.quarantine.values())
  }

  /** Log a failure event (§16 — failure logging). */
  logFailure(
    strategyId: string | null,
    failureType: FailureType,
    failureStage: string,
    reason: string,
    recoveredVia: FailureRecord['recoveredVia'] = 'NONE',
    metadata: Record<string, unknown> = {},
    currentTime: number = Date.now(),
  ): string {
    const failureId = `f-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const record: FailureRecord = {
      failureId,
      strategyId,
      failureType,
      failureStage,
      reason,
      occurredAt: currentTime,
      recoveredVia,
      metadata,
    }
    this.failures.push(record)
    if (this.failures.length > this.MAX_FAILURES) this.failures.shift()

    log.error(`failure ${failureId} [${failureType}] at ${failureStage}: ${reason} (recovered via ${recoveredVia})`)
    return failureId
  }

  /** List recent failures. */
  listFailures(limit: number = 100): Array<FailureRecord> {
    return this.failures.slice(-limit)
  }

  /** Mark a strategy as gracefully degraded (§16 — graceful degradation). */
  markDegraded(strategyId: string, reason: string): void {
    this.degraded.add(strategyId)
    log.warn(`strategy ${strategyId} in graceful degradation: ${reason}`)
  }

  /** Clear graceful degradation for a strategy. */
  clearDegraded(strategyId: string): void {
    this.degraded.delete(strategyId)
    log.info(`strategy ${strategyId} cleared from graceful degradation`)
  }

  /** Check if a strategy is in graceful degradation. */
  isDegraded(strategyId: string): boolean {
    return this.degraded.has(strategyId)
  }

  /** Get all degraded strategy IDs. */
  listDegraded(): string[] {
    return Array.from(this.degraded)
  }

  /** Get recovery statistics (§16 — observability). */
  getStats() {
    const failuresByType: Record<string, number> = {}
    for (const f of this.failures) {
      failuresByType[f.failureType] = (failuresByType[f.failureType] ?? 0) + 1
    }
    const recoveriesByMethod: Record<string, number> = {}
    for (const f of this.failures) {
      if (f.recoveredVia !== 'NONE') {
        recoveriesByMethod[f.recoveredVia] = (recoveriesByMethod[f.recoveredVia] ?? 0) + 1
      }
    }
    return {
      totalQuarantined: this.quarantine.size,
      pendingReview: Array.from(this.quarantine.values()).filter((q) => q.reviewStatus === 'PENDING').length,
      totalFailures: this.failures.length,
      failuresByType,
      recoveriesByMethod,
      degradedStrategies: this.degraded.size,
    }
  }

  /**
   * Clear all recovery state for a strategy (§16 — state restoration).
   * Used when a strategy is reloaded or restored to a known-good state.
   */
  clearForStrategy(strategyId: string): void {
    // Remove quarantined decisions for this strategy
    for (const [id, q] of this.quarantine) {
      if (q.decision.strategyId === strategyId) {
        this.quarantine.delete(id)
      }
    }
    // Clear degradation flag
    this.degraded.delete(strategyId)
    log.info(`recovery state cleared for strategy ${strategyId}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton recovery manager
// ─────────────────────────────────────────────────────────────────────────────

export const failureRecoveryManager = new FailureRecoveryManager()
