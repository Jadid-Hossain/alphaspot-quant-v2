// CHAPTER 5.5 §10, §11, §12 — Position State, Versioning & Governance
//
// §10 — Position State Management: current state, pending positions, reserved
//       capital, position metadata. State transitions version controlled.
// §11 — Position Versioning: position/risk/portfolio/configuration/governance
//       versions. Historical positions immutable (Rule 5).
// §12 — Position Governance: approval/validation status, review/audit history,
//       creation timestamp, retirement status, governance metadata.
//
// Rule 5 — Historical position records immutable.
// Rule 11 — Only approved Canonical Position Contracts enter Order Decision Engine.
// Rule 12 — Position governance independent of deployment topology.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalPositionContract,
  PositionAuditEvent,
  PositionGovernanceMetadata,
  PositionReviewEvent,
  PositionState,
  PositionVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:position-sizing:governance')

// ─────────────────────────────────────────────────────────────────────────────
// PositionStateManager (§10)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionOperationalState {
  currentState: PositionState
  previousState: PositionState | null
  stateEnteredAt: number
  stateTransitionHistory: Array<{
    from: PositionState
    to: PositionState
    at: number
    reason: string
    actor: string
  }>
  pendingPositionIds: string[]
  reservedCapital: number
  auditLog: PositionAuditEvent[]
}

export class PositionStateManager {
  private state: PositionOperationalState

  constructor() {
    const now = Date.now()
    this.state = {
      currentState: 'PENDING',
      previousState: null,
      stateEnteredAt: now,
      stateTransitionHistory: [],
      pendingPositionIds: [],
      reservedCapital: 0,
      auditLog: [],
    }
  }

  getState(): PositionOperationalState {
    return { ...this.state }
  }

  transitionState(to: PositionState, reason: string, actor: string = 'system'): void {
    if (this.state.currentState === to) return
    const now = Date.now()
    this.state.previousState = this.state.currentState
    this.state.currentState = to
    this.state.stateEnteredAt = now
    this.state.stateTransitionHistory.push({
      from: this.state.previousState, to, at: now, reason, actor,
    })
    if (this.state.stateTransitionHistory.length > 200) this.state.stateTransitionHistory.shift()
    log.info(`position state: ${this.state.previousState} → ${to} (${reason})`)
  }

  addPendingPosition(positionId: string): void {
    if (!this.state.pendingPositionIds.includes(positionId)) {
      this.state.pendingPositionIds.push(positionId)
    }
  }

  removePendingPosition(positionId: string): void {
    this.state.pendingPositionIds = this.state.pendingPositionIds.filter((id) => id !== positionId)
  }

  updateReservedCapital(delta: number): void {
    this.state.reservedCapital = Math.max(0, this.state.reservedCapital + delta)
  }

  addAuditEvent(event: PositionAuditEvent): void {
    this.state.auditLog.push(event)
    if (this.state.auditLog.length > 500) this.state.auditLog.shift()
  }
}

export const positionStateManager = new PositionStateManager()

// ─────────────────────────────────────────────────────────────────────────────
// PositionVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedPositionRecord {
  positionId: string
  versions: PositionVersionBundle
  position: CanonicalPositionContract
  registeredAt: number
  active: boolean
}

export class PositionVersionRegistry {
  private active = new Map<string, CanonicalPositionContract>()
  private history = new Map<string, VersionedPositionRecord>()

  register(position: CanonicalPositionContract, currentTime: number = Date.now()): void {
    this.active.set(position.positionId, position)
    const key = `${position.positionId}@${position.positionVersion}`
    if (!this.history.has(key)) {
      this.history.set(key, {
        positionId: position.positionId,
        versions: { ...position.positionMetadata.versions },
        position,
        registeredAt: currentTime,
        active: true,
      })
    }
    log.info(`position ${position.positionId} v${position.positionVersion} registered`)
  }

  getActive(positionId: string): CanonicalPositionContract | null {
    return this.active.get(positionId) ?? null
  }

  getHistorical(positionId: string, version: string): CanonicalPositionContract | null {
    return this.history.get(`${positionId}@${version}`)?.position ?? null
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }
}

export const positionVersionRegistry = new PositionVersionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// PositionGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class PositionGovernanceManager {
  private governance = new Map<string, PositionGovernanceMetadata>()

  initialize(positionId: string, currentTime: number = Date.now()): PositionGovernanceMetadata {
    if (this.governance.has(positionId)) return this.governance.get(positionId)!
    const meta: PositionGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(positionId, meta)
    return meta
  }

  get(positionId: string): PositionGovernanceMetadata | null {
    return this.governance.get(positionId) ?? null
  }

  approve(positionId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(positionId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`position ${positionId} approved by ${actor}: ${note}`)
  }

  reject(positionId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(positionId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`position ${positionId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(positionId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(positionId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addAuditEvent(positionId: string, event: PositionAuditEvent): void {
    const meta = this.getOrCreate(positionId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  /** Rule 11 — Only approved positions enter Order Decision Engine. */
  isApproved(positionId: string): boolean {
    const meta = this.governance.get(positionId)
    if (!meta) return false
    return (
      (meta.approvalStatus === 'APPROVED' || meta.approvalStatus === 'CONDITIONAL') &&
      meta.validationStatus === 'PASSED' &&
      meta.retirementStatus === 'ACTIVE'
    )
  }

  private getOrCreate(positionId: string, currentTime: number): PositionGovernanceMetadata {
    return this.governance.get(positionId) ?? this.initialize(positionId, currentTime)
  }
}

export const positionGovernanceManager = new PositionGovernanceManager()
