// CHAPTER 5.6 §12, §13 — Order Versioning & Governance
//
// §12 — Every order records: Order Version, Position Version, Portfolio Version,
//       Risk Version, Configuration Version, Governance Version.
//       Historical orders immutable (Rule 5).
// §13 — Every order records: Approval Status, Validation Status, Review History,
//       Audit History, Creation Timestamp, Expiration Timestamp, Governance Metadata.
//       Complete governance history mandatory.
//
// Rule 5 — Historical order decisions immutable.
// Rule 14 — Expired order intents automatically become invalid.
// Rule 18 — All models independently versioned.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalOrderIntentContract,
  OrderAuditEvent,
  OrderGovernanceMetadata,
  OrderReviewEvent,
  OrderVersionBundle,
} from './types'

const log = createLogger('decision-intelligence:order-decision:governance')

// ─────────────────────────────────────────────────────────────────────────────
// OrderVersionRegistry (§12, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedOrderRecord {
  orderDecisionId: string
  versions: OrderVersionBundle
  order: CanonicalOrderIntentContract
  registeredAt: number
  active: boolean
}

export class OrderVersionRegistry {
  private active = new Map<string, CanonicalOrderIntentContract>()
  private history = new Map<string, VersionedOrderRecord>()

  register(order: CanonicalOrderIntentContract, currentTime: number = Date.now()): void {
    this.active.set(order.orderDecisionId, order)
    const key = `${order.orderDecisionId}@${order.orderVersion}`
    if (!this.history.has(key)) {
      this.history.set(key, {
        orderDecisionId: order.orderDecisionId,
        versions: { ...order.orderMetadata.versions },
        order,
        registeredAt: currentTime,
        active: true,
      })
    }
    log.info(`order ${order.orderDecisionId} v${order.orderVersion} registered`)
  }

  getActive(orderDecisionId: string): CanonicalOrderIntentContract | null {
    return this.active.get(orderDecisionId) ?? null
  }

  getHistorical(orderDecisionId: string, version: string): CanonicalOrderIntentContract | null {
    return this.history.get(`${orderDecisionId}@${version}`)?.order ?? null
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }
}

export const orderVersionRegistry = new OrderVersionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// OrderGovernanceManager (§13 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class OrderGovernanceManager {
  private governance = new Map<string, OrderGovernanceMetadata>()

  initialize(orderDecisionId: string, expirationTimestamp: number, currentTime: number = Date.now()): OrderGovernanceMetadata {
    if (this.governance.has(orderDecisionId)) return this.governance.get(orderDecisionId)!
    const meta: OrderGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      expirationTimestamp,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(orderDecisionId, meta)
    return meta
  }

  get(orderDecisionId: string): OrderGovernanceMetadata | null {
    return this.governance.get(orderDecisionId) ?? null
  }

  approve(orderDecisionId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(orderDecisionId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`order ${orderDecisionId} approved by ${actor}: ${note}`)
  }

  reject(orderDecisionId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(orderDecisionId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    log.warn(`order ${orderDecisionId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(orderDecisionId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(orderDecisionId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  addAuditEvent(orderDecisionId: string, event: OrderAuditEvent): void {
    const meta = this.getOrCreate(orderDecisionId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  /**
   * Check if order is expired (Rule 14).
   */
  isExpired(orderDecisionId: string, currentTime: number = Date.now()): boolean {
    const meta = this.governance.get(orderDecisionId)
    if (!meta) return true
    return currentTime > meta.expirationTimestamp
  }

  /**
   * Retire an expired order (Rule 14).
   */
  retireExpired(orderDecisionId: string, currentTime: number = Date.now()): boolean {
    const meta = this.governance.get(orderDecisionId)
    if (!meta) return false
    if (currentTime > meta.expirationTimestamp) {
      meta.retirementStatus = 'RETIRED'
      meta.auditHistory.push({ action: 'EXPIRED', at: currentTime, actor: 'system', note: 'validity horizon expired (Rule 14)' })
      log.info(`order ${orderDecisionId} retired — validity horizon expired (Rule 14)`)
      return true
    }
    return false
  }

  private getOrCreate(orderDecisionId: string, currentTime: number): OrderGovernanceMetadata {
    return this.governance.get(orderDecisionId) ?? this.initialize(orderDecisionId, currentTime + 60000, currentTime)
  }
}

export const orderGovernanceManager = new OrderGovernanceManager()
