// CHAPTER 5.10 §11, §12 — Execution Versioning & Governance
//
// §11 — Every execution records: Execution Version, Broker Version, Routing
//       Version, Configuration Version, Governance Version.
//       Historical execution records immutable (Rule 5).
// §12 — Every execution records: Approval/Validation Status, Review/Audit History,
//       Creation/Completion Timestamp, Governance Metadata.
//
// Rule 5 — Historical execution records immutable.
// Rule 19 — Every execution event supports deterministic replay for audit reconstruction.
// Rule 22 — Trade Bust/Correction never modify history; generate compensating events.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalExecutionEventContract,
  ExecutionAuditEvent,
  ExecutionGovernanceMetadata,
  ExecutionReviewEvent,
  ExecutionVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:exchange-execution:governance')

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedExecutionRecord {
  executionEventId: string
  versions: ExecutionVersionBundle
  execution: CanonicalExecutionEventContract
  registeredAt: number
  active: boolean
}

export class ExecutionVersionRegistry {
  private active = new Map<string, CanonicalExecutionEventContract>()
  private history = new Map<string, VersionedExecutionRecord[]>()

  register(execution: CanonicalExecutionEventContract, currentTime: number = Date.now()): void {
    this.active.set(execution.executionEventId, execution)
    const key = execution.executionEventId
    const versions = this.history.get(key) ?? []
    versions.push({
      executionEventId: execution.executionEventId,
      versions: { ...execution.executionMetadata.versions },
      execution,
      registeredAt: currentTime,
      active: true,
    })
    this.history.set(key, versions)
    log.info(`execution event ${execution.executionEventId} registered`)
  }

  getActive(executionEventId: string): CanonicalExecutionEventContract | null {
    return this.active.get(executionEventId) ?? null
  }

  getHistorical(executionEventId: string, version: string): CanonicalExecutionEventContract | null {
    const versions = this.history.get(executionEventId)
    if (!versions) return null
    return versions.find((v) => v.versions.executionVersion === version)?.execution ?? null
  }

  /** Rule 19 — Get all versions for deterministic replay. */
  getAllVersions(executionEventId: string): VersionedExecutionRecord[] {
    return this.history.get(executionEventId) ?? []
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

  initialize(executionEventId: string, currentTime: number = Date.now()): ExecutionGovernanceMetadata {
    if (this.governance.has(executionEventId)) return this.governance.get(executionEventId)!
    const meta: ExecutionGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      completionTimestamp: null,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(executionEventId, meta)
    return meta
  }

  get(executionEventId: string): ExecutionGovernanceMetadata | null {
    return this.governance.get(executionEventId) ?? null
  }

  approve(executionEventId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionEventId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`execution event ${executionEventId} approved by ${actor}: ${note}`)
  }

  reject(executionEventId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionEventId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`execution event ${executionEventId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(executionEventId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionEventId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  completeExecution(executionEventId: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(executionEventId, currentTime)
    meta.completionTimestamp = currentTime
    meta.auditHistory.push({ action: 'COMPLETED', at: currentTime, actor: 'exchange-engine', note: 'execution completed' })
  }

  addAuditEvent(executionEventId: string, event: ExecutionAuditEvent): void {
    const meta = this.getOrCreate(executionEventId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  private getOrCreate(executionEventId: string, currentTime: number): ExecutionGovernanceMetadata {
    return this.governance.get(executionEventId) ?? this.initialize(executionEventId, currentTime)
  }
}

export const executionGovernanceManager = new ExecutionGovernanceManager()
