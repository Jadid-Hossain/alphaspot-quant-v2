// CHAPTER 5.8 §11, §12 — Routing Versioning & Governance
//
// §11 — Every routing decision records: Routing Version, Execution Plan Version,
//       Configuration Version, Venue Model Version, Governance Version.
//       Historical routing decisions immutable (Rule 5).
// §12 — Every decision records: Approval/Validation Status, Review/Audit History,
//       Creation/Expiration Timestamp, Governance Metadata.
//
// Rule 5 — Historical routing decisions immutable.
// Rule 15 — Deterministic failover without modifying historical records.
// Rule 18 — Sufficient metadata for deterministic replay + audit reconstruction.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalRoutingContract,
  RoutingAuditEvent,
  RoutingGovernanceMetadata,
  RoutingReviewEvent,
  RoutingVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:smart-order-routing:governance')

// ─────────────────────────────────────────────────────────────────────────────
// RoutingVersionRegistry (§11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedRoutingRecord {
  routingDecisionId: string
  versions: RoutingVersionBundle
  routing: CanonicalRoutingContract
  registeredAt: number
  active: boolean
}

export class RoutingVersionRegistry {
  private active = new Map<string, CanonicalRoutingContract>()
  private history = new Map<string, VersionedRoutingRecord[]>()

  register(routing: CanonicalRoutingContract, currentTime: number = Date.now()): void {
    this.active.set(routing.routingDecisionId, routing)
    const key = routing.routingDecisionId
    const versions = this.history.get(key) ?? []
    versions.push({
      routingDecisionId: routing.routingDecisionId,
      versions: { ...routing.routingMetadata.versions },
      routing,
      registeredAt: currentTime,
      active: true,
    })
    this.history.set(key, versions)
    log.info(`routing decision ${routing.routingDecisionId} registered`)
  }

  getActive(routingDecisionId: string): CanonicalRoutingContract | null {
    return this.active.get(routingDecisionId) ?? null
  }

  getHistorical(routingDecisionId: string, version: string): CanonicalRoutingContract | null {
    const versions = this.history.get(routingDecisionId)
    if (!versions) return null
    return versions.find((v) => v.versions.routingVersion === version)?.routing ?? null
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }
}

export const routingVersionRegistry = new RoutingVersionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// RoutingGovernanceManager (§12 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class RoutingGovernanceManager {
  private governance = new Map<string, RoutingGovernanceMetadata>()

  initialize(routingDecisionId: string, expirationTimestamp: number, currentTime: number = Date.now()): RoutingGovernanceMetadata {
    if (this.governance.has(routingDecisionId)) return this.governance.get(routingDecisionId)!
    const meta: RoutingGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      expirationTimestamp,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(routingDecisionId, meta)
    return meta
  }

  get(routingDecisionId: string): RoutingGovernanceMetadata | null {
    return this.governance.get(routingDecisionId) ?? null
  }

  approve(routingDecisionId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(routingDecisionId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`routing decision ${routingDecisionId} approved by ${actor}: ${note}`)
  }

  reject(routingDecisionId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(routingDecisionId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`routing decision ${routingDecisionId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(routingDecisionId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(routingDecisionId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addAuditEvent(routingDecisionId: string, event: RoutingAuditEvent): void {
    const meta = this.getOrCreate(routingDecisionId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  private getOrCreate(routingDecisionId: string, currentTime: number): RoutingGovernanceMetadata {
    return this.governance.get(routingDecisionId) ?? this.initialize(routingDecisionId, currentTime + 300000, currentTime)
  }
}

export const routingGovernanceManager = new RoutingGovernanceManager()
