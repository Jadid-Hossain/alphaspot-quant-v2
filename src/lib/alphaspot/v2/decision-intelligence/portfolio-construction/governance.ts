// CHAPTER 5.3 §11, §12 — Portfolio Versioning & Governance
//
// §11 — Every portfolio records: Portfolio Version, Strategy Version,
//       Allocation Version, Constraint Version, Configuration Version,
//       Governance Version. Historical portfolios remain immutable (Rule 5).
//
// §12 — Every portfolio records: Approval Status, Validation Status, Review
//       History, Audit History, Creation Timestamp, Retirement Status,
//       Governance Metadata. Complete governance history is mandatory.
//
// §7.5 — Every portfolio optimization process records: Optimization Method,
//        Optimization Version, Objective Function Version, Constraint Version,
//        Configuration Version, Random Seed, Solver Version, Solver Configuration,
//        Optimization Timestamp, Optimization Metadata.
//
// Rule 5 — Historical portfolio records immutable.
// Rule 11 — Only approved Canonical Portfolio Contracts enter Risk Management.
// Rule 12 — Portfolio governance independent of deployment topology.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalPortfolioContract,
  PortfolioAuditEvent,
  PortfolioGovernanceMetadata,
  PortfolioReviewEvent,
  PortfolioVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:portfolio-construction:governance')

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedPortfolioRecord {
  portfolioId: string
  versions: PortfolioVersionBundle
  portfolio: CanonicalPortfolioContract
  registeredAt: number
  supersededBy: string | null
  active: boolean
}

export class PortfolioVersionRegistry {
  /** Active portfolios (current versions). */
  private active = new Map<string, CanonicalPortfolioContract>()
  /** All historical versions (portfolioId+version → record). Immutable (Rule 5). */
  private history = new Map<string, VersionedPortfolioRecord>()
  /** Per-portfolio version index. */
  private versionIndex = new Map<string, string[]>()

  /**
   * Register a portfolio (§11, Rule 5 — historical immutable).
   * If a previous version exists, it is superseded (kept immutable in history).
   */
  register(portfolio: CanonicalPortfolioContract, currentTime: number = Date.now()): 'NEW' | 'UPDATED' {
    const existing = this.active.get(portfolio.portfolioId)
    const versionKey = this.versionKey(portfolio.portfolioId, portfolio.portfolioVersion)

    if (existing) {
      const prevVersionKey = this.versionKey(existing.portfolioId, existing.portfolioVersion)
      const prevRecord = this.history.get(prevVersionKey)
      if (prevRecord) {
        prevRecord.active = false
        prevRecord.supersededBy = portfolio.portfolioVersion
      }
    }

    this.active.set(portfolio.portfolioId, portfolio)

    if (!this.history.has(versionKey)) {
      this.history.set(versionKey, {
        portfolioId: portfolio.portfolioId,
        versions: { ...portfolio.portfolioMetadata.versions },
        portfolio,
        registeredAt: currentTime,
        supersededBy: null,
        active: true,
      })
      const versions = this.versionIndex.get(portfolio.portfolioId) ?? []
      versions.push(versionKey)
      this.versionIndex.set(portfolio.portfolioId, versions)
    }

    log.info(
      `portfolio ${portfolio.portfolioId} v${portfolio.portfolioVersion} ${existing ? 'updated (previous archived)' : 'registered'}`,
    )
    return existing ? 'UPDATED' : 'NEW'
  }

  /** Get the currently active portfolio. */
  getActive(portfolioId: string): CanonicalPortfolioContract | null {
    return this.active.get(portfolioId) ?? null
  }

  /** Get a specific historical version (§11 — Rule 5 immutable). */
  getHistorical(portfolioId: string, version: string): CanonicalPortfolioContract | null {
    const record = this.history.get(this.versionKey(portfolioId, version))
    return record ? record.portfolio : null
  }

  /** List all portfolio IDs. */
  listPortfolioIds(): string[] {
    return Array.from(this.active.keys())
  }

  /** List all versions for a portfolio (§11). */
  listVersions(portfolioId: string): PortfolioVersionBundle[] {
    const versions = this.versionIndex.get(portfolioId) ?? []
    return versions
      .map((k) => this.history.get(k))
      .filter((r): r is VersionedPortfolioRecord => r !== null)
      .map((r) => ({ ...r.versions }))
  }

  private versionKey(portfolioId: string, version: string): string {
    return `${portfolioId}@${version}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class PortfolioGovernanceManager {
  private governance = new Map<string, PortfolioGovernanceMetadata>()

  initialize(portfolioId: string, currentTime: number = Date.now()): PortfolioGovernanceMetadata {
    if (this.governance.has(portfolioId)) {
      return this.governance.get(portfolioId)!
    }
    const meta: PortfolioGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(portfolioId, meta)
    log.info(`governance initialized for portfolio ${portfolioId}`)
    return meta
  }

  get(portfolioId: string): PortfolioGovernanceMetadata | null {
    return this.governance.get(portfolioId) ?? null
  }

  approve(portfolioId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`portfolio ${portfolioId} approved by ${actor}: ${note}`)
  }

  reject(portfolioId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`portfolio ${portfolioId} rejected by ${actor}: ${note}`)
  }

  conditionalApprove(portfolioId: string, actor: string, note: string, conditions: string[], currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.reviewHistory.push({
      action: 'CONDITIONAL_APPROVE',
      at: currentTime,
      actor,
      note: `${note} [conditions: ${conditions.join(', ')}]`,
      outcome: 'CONDITIONAL',
    })
    meta.approvalStatus = 'CONDITIONAL'
    meta.governanceNotes.push(...conditions)
  }

  setValidationStatus(portfolioId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addNote(portfolioId: string, note: string, actor: string = 'system', currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.governanceNotes.push(`[${new Date(currentTime).toISOString()}] ${actor}: ${note}`)
  }

  addAuditEvent(portfolioId: string, event: PortfolioAuditEvent): void {
    const meta = this.getOrCreate(portfolioId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  markPendingRetirement(portfolioId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.retirementStatus = 'PENDING_RETIREMENT'
    meta.auditHistory.push({ action: 'PENDING_RETIREMENT', at: currentTime, actor, note })
  }

  completeRetirement(portfolioId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(portfolioId, currentTime)
    meta.retirementStatus = 'RETIRED'
    meta.auditHistory.push({ action: 'RETIRED', at: currentTime, actor, note })
  }

  /**
   * Check if a portfolio is operationally approved for Risk Management (Rule 11).
   * Rule 11 — Only approved Canonical Portfolio Contracts may enter Risk Management.
   */
  isApproved(portfolioId: string): boolean {
    const meta = this.governance.get(portfolioId)
    if (!meta) return false
    return (
      (meta.approvalStatus === 'APPROVED' || meta.approvalStatus === 'CONDITIONAL') &&
      meta.validationStatus === 'PASSED' &&
      meta.retirementStatus === 'ACTIVE'
    )
  }

  snapshot(): Array<{ portfolioId: string; meta: PortfolioGovernanceMetadata }> {
    return Array.from(this.governance.entries()).map(([portfolioId, meta]) => ({
      portfolioId,
      meta: { ...meta },
    }))
  }

  private getOrCreate(portfolioId: string, currentTime: number): PortfolioGovernanceMetadata {
    return this.governance.get(portfolioId) ?? this.initialize(portfolioId, currentTime)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const portfolioVersionRegistry = new PortfolioVersionRegistry()
export const portfolioGovernanceManager = new PortfolioGovernanceManager()
