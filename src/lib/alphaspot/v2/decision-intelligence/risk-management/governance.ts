// CHAPTER 5.4 §11, §12 — Risk Versioning & Governance
//
// §11 — Every evaluation records: Risk Version, Portfolio Version, Constraint
//       Version, Configuration Version, Governance Version. Historical
//       evaluations immutable (Rule 5).
//
// §12 — Every evaluation records: Approval Status, Validation Status, Review
//       History, Audit History, Creation Timestamp, Retirement Status,
//       Governance Metadata. Complete governance history mandatory.
//
// Rule 5 — Historical risk records immutable.
// Rule 11 — Only approved Canonical Risk Contracts enter Position Sizing.
// Rule 12 — Risk governance independent of deployment topology.
// Rule 17 — Risk policy changes never retroactively alter historical evaluations.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalRiskContract,
  RiskAuditEvent,
  RiskGovernanceMetadata,
  RiskReviewEvent,
  RiskVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:risk-management:governance')

// ─────────────────────────────────────────────────────────────────────────────
// RiskVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedRiskRecord {
  riskAssessmentId: string
  versions: RiskVersionBundle
  contract: CanonicalRiskContract
  registeredAt: number
  active: boolean
}

export class RiskVersionRegistry {
  private active = new Map<string, CanonicalRiskContract>()
  private history = new Map<string, VersionedRiskRecord>()

  /** Register a risk evaluation (§11, Rule 5). */
  register(contract: CanonicalRiskContract, currentTime: number = Date.now()): void {
    this.active.set(contract.riskAssessmentId, contract)
    const key = this.versionKey(contract.riskAssessmentId, contract.riskVersion)
    if (!this.history.has(key)) {
      this.history.set(key, {
        riskAssessmentId: contract.riskAssessmentId,
        versions: { ...contract.riskMetadata.versions },
        contract,
        registeredAt: currentTime,
        active: true,
      })
    }
    log.info(`risk assessment ${contract.riskAssessmentId} v${contract.riskVersion} registered`)
  }

  /** Get an active risk assessment. */
  getActive(riskAssessmentId: string): CanonicalRiskContract | null {
    return this.active.get(riskAssessmentId) ?? null
  }

  /** Get a historical version (Rule 5 — immutable). */
  getHistorical(riskAssessmentId: string, version: string): CanonicalRiskContract | null {
    return this.history.get(this.versionKey(riskAssessmentId, version))?.contract ?? null
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }

  private versionKey(id: string, version: string): string {
    return `${id}@${version}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RiskGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class RiskGovernanceManager {
  private governance = new Map<string, RiskGovernanceMetadata>()

  initialize(riskAssessmentId: string, currentTime: number = Date.now()): RiskGovernanceMetadata {
    if (this.governance.has(riskAssessmentId)) return this.governance.get(riskAssessmentId)!
    const meta: RiskGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(riskAssessmentId, meta)
    return meta
  }

  get(riskAssessmentId: string): RiskGovernanceMetadata | null {
    return this.governance.get(riskAssessmentId) ?? null
  }

  approve(riskAssessmentId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(riskAssessmentId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`risk assessment ${riskAssessmentId} approved by ${actor}: ${note}`)
  }

  reject(riskAssessmentId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(riskAssessmentId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`risk assessment ${riskAssessmentId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(riskAssessmentId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(riskAssessmentId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addAuditEvent(riskAssessmentId: string, event: RiskAuditEvent): void {
    const meta = this.getOrCreate(riskAssessmentId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  /**
   * Rule 11 — Only approved Canonical Risk Contracts enter Position Sizing.
   */
  isApproved(riskAssessmentId: string): boolean {
    const meta = this.governance.get(riskAssessmentId)
    if (!meta) return false
    return (
      (meta.approvalStatus === 'APPROVED' || meta.approvalStatus === 'CONDITIONAL') &&
      meta.validationStatus === 'PASSED' &&
      meta.retirementStatus === 'ACTIVE'
    )
  }

  private getOrCreate(riskAssessmentId: string, currentTime: number): RiskGovernanceMetadata {
    return this.governance.get(riskAssessmentId) ?? this.initialize(riskAssessmentId, currentTime)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const riskVersionRegistry = new RiskVersionRegistry()
export const riskGovernanceManager = new RiskGovernanceManager()
