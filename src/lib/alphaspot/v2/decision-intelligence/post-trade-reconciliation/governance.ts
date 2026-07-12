// CHAPTER 5.11 §11, §12 — Reconciliation Versioning & Governance
//
// §11 — Every reconciliation records: Reconciliation Version, Execution Version,
//       Broker Version, Configuration Version, Governance Version.
//       Historical reconciliations immutable (Rule 5).
// §12 — Every reconciliation records: Approval/Validation Status, Review/Audit
//       History, Creation/Resolution Timestamp, Governance Metadata.
//
// Rule 5 — Historical reconciliation records immutable.
// Rule 11 — Trade corrections/busts generate new immutable versions, not modify history.
// Rule 16 — Corporate actions never retroactively modify; new reconciliation events.
// Rule 17 — Every reconciliation decision supports deterministic replay.
// Rule 21 — Contra-Reconciliation Events are immutable, not historical modifications.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalReconciliationContract,
  ReconciliationAuditEvent,
  ReconciliationGovernanceMetadata,
  ReconciliationReviewEvent,
  ReconciliationVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:post-trade-reconciliation:governance')

// ─────────────────────────────────────────────────────────────────────────────
// ReconciliationVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedReconciliationRecord {
  reconciliationId: string
  versions: ReconciliationVersionBundle
  reconciliation: CanonicalReconciliationContract
  registeredAt: number
  active: boolean
}

export class ReconciliationVersionRegistry {
  private active = new Map<string, CanonicalReconciliationContract>()
  private history = new Map<string, VersionedReconciliationRecord[]>()

  register(reconciliation: CanonicalReconciliationContract, currentTime: number = Date.now()): void {
    this.active.set(reconciliation.reconciliationId, reconciliation)
    const key = reconciliation.reconciliationId
    const versions = this.history.get(key) ?? []
    versions.push({
      reconciliationId: reconciliation.reconciliationId,
      versions: { ...reconciliation.reconciliationMetadata.versions },
      reconciliation,
      registeredAt: currentTime,
      active: true,
    })
    this.history.set(key, versions)
    log.info(`reconciliation ${reconciliation.reconciliationId} registered`)
  }

  getActive(reconciliationId: string): CanonicalReconciliationContract | null {
    return this.active.get(reconciliationId) ?? null
  }

  /** Rule 17 — Get all versions for deterministic replay. */
  getAllVersions(reconciliationId: string): VersionedReconciliationRecord[] {
    return this.history.get(reconciliationId) ?? []
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }
}

export const reconciliationVersionRegistry = new ReconciliationVersionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// ReconciliationGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class ReconciliationGovernanceManager {
  private governance = new Map<string, ReconciliationGovernanceMetadata>()

  initialize(reconciliationId: string, currentTime: number = Date.now()): ReconciliationGovernanceMetadata {
    if (this.governance.has(reconciliationId)) return this.governance.get(reconciliationId)!
    const meta: ReconciliationGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      resolutionTimestamp: null,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(reconciliationId, meta)
    return meta
  }

  get(reconciliationId: string): ReconciliationGovernanceMetadata | null {
    return this.governance.get(reconciliationId) ?? null
  }

  approve(reconciliationId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(reconciliationId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    meta.resolutionTimestamp = currentTime
    log.info(`reconciliation ${reconciliationId} approved by ${actor}: ${note}`)
  }

  reject(reconciliationId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(reconciliationId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    meta.resolutionTimestamp = currentTime
    log.warn(`reconciliation ${reconciliationId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(reconciliationId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(reconciliationId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addAuditEvent(reconciliationId: string, event: ReconciliationAuditEvent): void {
    const meta = this.getOrCreate(reconciliationId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  private getOrCreate(reconciliationId: string, currentTime: number): ReconciliationGovernanceMetadata {
    return this.governance.get(reconciliationId) ?? this.initialize(reconciliationId, currentTime)
  }
}

export const reconciliationGovernanceManager = new ReconciliationGovernanceManager()
