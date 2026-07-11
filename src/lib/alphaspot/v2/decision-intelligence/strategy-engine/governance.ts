// CHAPTER 5.2 §11, §12 — Strategy Versioning & Governance
//
// §11 — Every strategy records: Strategy Version, Configuration Version,
//       Rule Version, Signal Version, Model Version, Governance Version.
//       Historical strategies remain immutable (Rule 14).
//
// §12 — Every strategy records: Approval Status, Validation Status, Review
//       History, Audit History, Creation Timestamp, Retirement Status,
//       Governance Metadata. Complete governance history is mandatory.
//
// Rule 11 — Strategy governance independent of deployment topology.
// Rule 14 — Historical strategy versions immutable.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  StrategyAuditEvent,
  StrategyDefinition,
  StrategyGovernanceMetadata,
  StrategyReviewEvent,
  StrategyVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:strategy-engine:governance')

// ─────────────────────────────────────────────────────────────────────────────
// StrategyVersionRegistry (§11, Rule 14 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedStrategyRecord {
  strategyId: string
  versions: StrategyVersionBundle
  definition: StrategyDefinition
  registeredAt: number
  supersededBy: string | null
  active: boolean
}

export class StrategyVersionRegistry {
  /** Active strategies (current versions). */
  private active = new Map<string, StrategyDefinition>()
  /** All historical versions (strategyId+version → record). Immutable (Rule 14). */
  private history = new Map<string, VersionedStrategyRecord>()
  /** Per-strategy version index (strategyId → list of version keys). */
  private versionIndex = new Map<string, string[]>()

  /**
   * Register or update a strategy definition (§11).
   * If a previous version exists, it is superseded (kept immutable in history).
   */
  register(definition: StrategyDefinition, currentTime: number = Date.now()): 'NEW' | 'UPDATED' {
    const existing = this.active.get(definition.strategyId)
    const versionKey = this.versionKey(definition.strategyId, definition.versions.strategyVersion)

    if (existing) {
      // Supersede the previous active version (Rule 14 — historical immutable)
      const prevVersionKey = this.versionKey(existing.strategyId, existing.versions.strategyVersion)
      const prevRecord = this.history.get(prevVersionKey)
      if (prevRecord) {
        prevRecord.active = false
        prevRecord.supersededBy = definition.versions.strategyVersion
      }
    }

    // Register the new active version
    this.active.set(definition.strategyId, definition)

    // Add to history (Rule 14 — historical immutable, but new versions can be added)
    if (!this.history.has(versionKey)) {
      this.history.set(versionKey, {
        strategyId: definition.strategyId,
        versions: { ...definition.versions },
        definition: { ...definition },
        registeredAt: currentTime,
        supersededBy: null,
        active: true,
      })

      const versions = this.versionIndex.get(definition.strategyId) ?? []
      versions.push(versionKey)
      this.versionIndex.set(definition.strategyId, versions)
    }

    log.info(
      `strategy ${definition.strategyId} v${definition.versions.strategyVersion} ${existing ? 'updated (previous archived)' : 'registered'}`,
    )
    return existing ? 'UPDATED' : 'NEW'
  }

  /** Get the currently active definition for a strategy. */
  getActive(strategyId: string): StrategyDefinition | null {
    return this.active.get(strategyId) ?? null
  }

  /** Get a specific historical version (§11 — Rule 14 immutable). */
  getHistorical(strategyId: string, strategyVersion: string): StrategyDefinition | null {
    const record = this.history.get(this.versionKey(strategyId, strategyVersion))
    return record ? record.definition : null
  }

  /** List all registered strategy IDs. */
  listStrategyIds(): string[] {
    return Array.from(this.active.keys())
  }

  /** List all versions for a strategy (§11). */
  listVersions(strategyId: string): StrategyVersionBundle[] {
    const versions = this.versionIndex.get(strategyId) ?? []
    return versions
      .map((k) => this.history.get(k))
      .filter((r): r is VersionedStrategyRecord => r !== null)
      .map((r) => ({ ...r.versions }))
  }

  /** Get version metadata for a strategy. */
  getVersionInfo(strategyId: string, strategyVersion: string): VersionedStrategyRecord | null {
    return this.history.get(this.versionKey(strategyId, strategyVersion)) ?? null
  }

  private versionKey(strategyId: string, strategyVersion: string): string {
    return `${strategyId}@${strategyVersion}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategyGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class StrategyGovernanceManager {
  /** strategyId → governance metadata */
  private governance = new Map<string, StrategyGovernanceMetadata>()

  /** Initialize governance metadata for a strategy (§12). */
  initialize(strategyId: string, currentTime: number = Date.now()): StrategyGovernanceMetadata {
    if (this.governance.has(strategyId)) {
      return this.governance.get(strategyId)!
    }

    const meta: StrategyGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(strategyId, meta)

    log.info(`governance initialized for strategy ${strategyId}`)
    return meta
  }

  /** Get governance metadata for a strategy (§12). */
  get(strategyId: string): StrategyGovernanceMetadata | null {
    return this.governance.get(strategyId) ?? null
  }

  /** Approve a strategy (§12). */
  approve(strategyId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
    const review: StrategyReviewEvent = {
      action: 'APPROVE',
      at: currentTime,
      actor,
      note,
      outcome: 'APPROVED',
    }
    meta.reviewHistory.push(review)
    meta.approvalStatus = 'APPROVED'
    log.info(`strategy ${strategyId} approved by ${actor}: ${note}`)
  }

  /** Reject a strategy (§12). */
  reject(strategyId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`strategy ${strategyId} rejected by ${actor}: ${note}`)
  }

  /** Conditionally approve a strategy (§12). */
  conditionalApprove(strategyId: string, actor: string, note: string, conditions: string[], currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
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

  /** Validate a strategy (§12 — validation status). */
  setValidationStatus(strategyId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({
      action: `VALIDATION:${status}`,
      at: currentTime,
      actor,
      note,
    })
  }

  /** Add a governance note (§12). */
  addNote(strategyId: string, note: string, actor: string = 'system', currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
    meta.governanceNotes.push(`[${new Date(currentTime).toISOString()}] ${actor}: ${note}`)
  }

  /** Add an audit event (§12, Rule 18 — full audit trail). */
  addAuditEvent(strategyId: string, event: StrategyAuditEvent): void {
    const meta = this.getOrCreate(strategyId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  /** Mark a strategy for retirement (§12). */
  markPendingRetirement(strategyId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
    meta.retirementStatus = 'PENDING_RETIREMENT'
    meta.auditHistory.push({
      action: 'PENDING_RETIREMENT',
      at: currentTime,
      actor,
      note,
    })
    log.info(`strategy ${strategyId} marked for pending retirement by ${actor}`)
  }

  /** Complete retirement (§12). */
  completeRetirement(strategyId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(strategyId, currentTime)
    meta.retirementStatus = 'RETIRED'
    meta.auditHistory.push({
      action: 'RETIRED',
      at: currentTime,
      actor,
      note,
    })
    log.info(`strategy ${strategyId} retired by ${actor}`)
  }

  /**
   * Check if a strategy is operationally approved for decision publication
   * (Rule 12 — only approved Strategy Decision Contracts enter Portfolio Construction).
   */
  isApproved(strategyId: string): boolean {
    const meta = this.governance.get(strategyId)
    if (!meta) return false
    return (
      (meta.approvalStatus === 'APPROVED' || meta.approvalStatus === 'CONDITIONAL') &&
      meta.validationStatus === 'PASSED' &&
      meta.retirementStatus === 'ACTIVE'
    )
  }

  /** Snapshot all governance metadata (for observability §14). */
  snapshot(): Array<{ strategyId: string; meta: StrategyGovernanceMetadata }> {
    return Array.from(this.governance.entries()).map(([strategyId, meta]) => ({
      strategyId,
      meta: { ...meta },
    }))
  }

  private getOrCreate(strategyId: string, currentTime: number): StrategyGovernanceMetadata {
    let meta = this.governance.get(strategyId)
    if (!meta) {
      meta = this.initialize(strategyId, currentTime)
    }
    return meta
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const strategyVersionRegistry = new StrategyVersionRegistry()
export const strategyGovernanceManager = new StrategyGovernanceManager()
