// CHAPTER 5.7 §11, §12 — Execution Versioning & Governance
//
// §11 — Every execution plan records: Execution Version, Order Version,
//       Position Version, Risk Version, Configuration Version, Governance Version.
//       Historical plans immutable (Rule 5).
// §12 — Every plan records: Approval/Validation Status, Review/Audit History,
//       Creation/Expiration Timestamp, Governance Metadata.
//
// Rule 5 — Historical execution plans immutable.
// Rule 18 — Plans may be recomputed when validity expires (new immutable version).
// Rule 26 — Adaptive modifications generate new immutable Execution Plan Versions.
// Rule 27 — Adaptation, residual, switching, randomization independently configurable.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalExecutionPlanContract,
  ExecutionAuditEvent,
  ExecutionGovernanceMetadata,
  ExecutionReviewEvent,
  ExecutionVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:execution-optimization:governance')

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedExecutionRecord {
  executionPlanId: string
  planVersion: number
  versions: ExecutionVersionBundle
  plan: CanonicalExecutionPlanContract
  registeredAt: number
  active: boolean
}

export class ExecutionVersionRegistry {
  private active = new Map<string, CanonicalExecutionPlanContract>()
  private history = new Map<string, VersionedExecutionRecord[]>()

  register(plan: CanonicalExecutionPlanContract, currentTime: number = Date.now()): void {
    this.active.set(plan.executionPlanId, plan)
    const key = plan.executionPlanId
    const versions = this.history.get(key) ?? []
    versions.push({
      executionPlanId: plan.executionPlanId,
      planVersion: plan.executionPlanVersion,
      versions: { ...plan.executionMetadata.versions },
      plan,
      registeredAt: currentTime,
      active: true,
    })
    this.history.set(key, versions)
    log.info(
      `execution plan ${plan.executionPlanId} v${plan.executionPlanVersion} registered ` +
      `(total versions: ${versions.length})`,
    )
  }

  getActive(executionPlanId: string): CanonicalExecutionPlanContract | null {
    return this.active.get(executionPlanId) ?? null
  }

  getHistorical(executionPlanId: string, planVersion: number): CanonicalExecutionPlanContract | null {
    const versions = this.history.get(executionPlanId)
    if (!versions) return null
    return versions.find((v) => v.planVersion === planVersion)?.plan ?? null
  }

  listVersions(executionPlanId: string): number[] {
    return (this.history.get(executionPlanId) ?? []).map((v) => v.planVersion)
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }
}

export const executionVersionRegistry = new ExecutionVersionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class ExecutionGovernanceManager {
  private governance = new Map<string, ExecutionGovernanceMetadata>()

  initialize(executionPlanId: string, expirationTimestamp: number, currentTime: number = Date.now()): ExecutionGovernanceMetadata {
    if (this.governance.has(executionPlanId)) return this.governance.get(executionPlanId)!
    const meta: ExecutionGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      expirationTimestamp,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(executionPlanId, meta)
    return meta
  }

  get(executionPlanId: string): ExecutionGovernanceMetadata | null {
    return this.governance.get(executionPlanId) ?? null
  }

  approve(executionPlanId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionPlanId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`execution plan ${executionPlanId} approved by ${actor}: ${note}`)
  }

  reject(executionPlanId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionPlanId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`execution plan ${executionPlanId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(executionPlanId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionPlanId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addAuditEvent(executionPlanId: string, event: ExecutionAuditEvent): void {
    const meta = this.getOrCreate(executionPlanId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  isExpired(executionPlanId: string, currentTime: number = Date.now()): boolean {
    const meta = this.governance.get(executionPlanId)
    if (!meta) return true
    return currentTime > meta.expirationTimestamp
  }

  private getOrCreate(executionPlanId: string, currentTime: number): ExecutionGovernanceMetadata {
    return this.governance.get(executionPlanId) ?? this.initialize(executionPlanId, currentTime + 300000, currentTime)
  }
}

export const executionGovernanceManager = new ExecutionGovernanceManager()
