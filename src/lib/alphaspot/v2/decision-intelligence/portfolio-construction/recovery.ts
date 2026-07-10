// CHAPTER 5.3 §16 — Failure Recovery
//
// §16 — Failure recovery supports:
//   • Portfolio Reconstruction
//   • Allocation Recovery
//   • Constraint Recovery
//   • Failure Logging
//   • Graceful Degradation
//   • Portfolio Quarantine
//
// Invalid portfolios shall NEVER be published (§16).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPortfolioContract } from './types'

const log = createLogger('decision-intelligence:portfolio-construction:recovery')

// ─────────────────────────────────────────────────────────────────────────────
// QuarantinedPortfolio — invalid portfolios held for analysis (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantinedPortfolio {
  portfolio: CanonicalPortfolioContract
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
  portfolioId: string | null
  failureType: FailureType
  failureStage: string
  reason: string
  occurredAt: number
  recoveredVia: 'NONE' | 'QUARANTINE' | 'RECONSTRUCTION' | 'CONSTRAINT_RELAXATION' | 'GRACEFUL_DEGRADATION'
  metadata: Record<string, unknown>
}

export type FailureType =
  | 'DECISION_INVALID'
  | 'OPTIMIZATION_FAILED'
  | 'CONSTRAINT_VIOLATION'
  | 'LIQUIDITY_CONSTRAINT_EXCEEDED'
  | 'CORRELATION_CONSTRAINT_EXCEEDED'
  | 'DIVERSIFICATION_CONSTRAINT_EXCEEDED'
  | 'PORTFOLIO_VALIDATION_FAILED'
  | 'GOVERNANCE_REJECTION'
  | 'INSUFFICIENT_CAPITAL'
  | 'INTERNAL_ERROR'

// ─────────────────────────────────────────────────────────────────────────────
// FailureRecoveryManager (§16)
// ─────────────────────────────────────────────────────────────────────────────

export class PortfolioFailureRecoveryManager {
  private quarantine = new Map<string, QuarantinedPortfolio>()
  private failures: FailureRecord[] = []
  private degraded = new Set<string>()

  private readonly MAX_QUARANTINE = 50
  private readonly MAX_FAILURES = 500

  /** Quarantine an invalid portfolio (§16 — invalid NEVER published). */
  quarantinePortfolio(
    portfolio: CanonicalPortfolioContract,
    reason: string,
    actor: string = 'pce-engine',
    currentTime: number = Date.now(),
  ): string {
    const quarantineId = `pq-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const record: QuarantinedPortfolio = {
      portfolio,
      quarantineReason: reason,
      quarantinedAt: currentTime,
      quarantinedBy: actor,
      reviewStatus: 'PENDING',
      reviewNotes: [],
    }
    this.quarantine.set(quarantineId, record)

    if (this.quarantine.size > this.MAX_QUARANTINE) {
      const firstKey = this.quarantine.keys().next().value
      if (firstKey) this.quarantine.delete(firstKey)
    }

    log.warn(`portfolio ${portfolio.portfolioId} quarantined: ${reason}`)
    return quarantineId
  }

  reviewQuarantined(quarantineId: string, status: QuarantinedPortfolio['reviewStatus'], note: string): boolean {
    const record = this.quarantine.get(quarantineId)
    if (!record) return false
    record.reviewStatus = status
    record.reviewNotes.push(note)
    log.info(`quarantined portfolio ${quarantineId} reviewed: ${status}`)
    return true
  }

  getQuarantined(quarantineId: string): QuarantinedPortfolio | null {
    return this.quarantine.get(quarantineId) ?? null
  }

  listQuarantined(): Array<QuarantinedPortfolio> {
    return Array.from(this.quarantine.values())
  }

  /** Log a failure event (§16 — failure logging). */
  logFailure(
    portfolioId: string | null,
    failureType: FailureType,
    failureStage: string,
    reason: string,
    recoveredVia: FailureRecord['recoveredVia'] = 'NONE',
    metadata: Record<string, unknown> = {},
    currentTime: number = Date.now(),
  ): string {
    const failureId = `pf-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const record: FailureRecord = {
      failureId,
      portfolioId,
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

  listFailures(limit: number = 100): Array<FailureRecord> {
    return this.failures.slice(-limit)
  }

  /** Mark a portfolio as gracefully degraded (§16). */
  markDegraded(portfolioId: string, reason: string): void {
    this.degraded.add(portfolioId)
    log.warn(`portfolio ${portfolioId} in graceful degradation: ${reason}`)
  }

  clearDegraded(portfolioId: string): void {
    this.degraded.delete(portfolioId)
  }

  isDegraded(portfolioId: string): boolean {
    return this.degraded.has(portfolioId)
  }

  getStats() {
    const failuresByType: Record<string, number> = {}
    for (const f of this.failures) {
      failuresByType[f.failureType] = (failuresByType[f.failureType] ?? 0) + 1
    }
    return {
      totalQuarantined: this.quarantine.size,
      pendingReview: Array.from(this.quarantine.values()).filter((q) => q.reviewStatus === 'PENDING').length,
      totalFailures: this.failures.length,
      failuresByType,
      degradedPortfolios: this.degraded.size,
    }
  }
}

// Singleton
export const portfolioFailureRecovery = new PortfolioFailureRecoveryManager()
