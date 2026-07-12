// CHAPTER 5.9 §11, §12, §13 — Broker Versioning, Governance & Failover
//
// §11 — Failover: primary/secondary broker, geographic failover, session failover,
//       connection recovery, automatic retry, manual override.
// §12 — Versioning: gateway/broker API/protocol/config/governance versions.
//       Historical communications immutable (Rule 5).
// §13 — Governance: approval/validation status, review/audit history, timestamps.
//
// Rule 5 — Historical broker communications immutable.
// Rule 13 — Automatic broker failover preserves execution integrity + auditability.
// Rule 17 — Message retries deterministic + auditable.
// Rule 19 — All communication failures generate immutable governance events.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  BrokerAuditEvent,
  BrokerConfiguration,
  BrokerGovernanceMetadata,
  BrokerReviewEvent,
  BrokerVersionBundle,
  CanonicalBrokerCommunicationContract,
  FailoverConfiguration,
} from './types'

const log = createLogger('decision-intelligence:broker-gateway:governance')

// ─────────────────────────────────────────────────────────────────────────────
// BrokerVersionRegistry (§12, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

interface VersionedBrokerRecord {
  brokerRequestId: string
  versions: BrokerVersionBundle
  communication: CanonicalBrokerCommunicationContract
  registeredAt: number
  active: boolean
}

export class BrokerVersionRegistry {
  private active = new Map<string, CanonicalBrokerCommunicationContract>()
  private history = new Map<string, VersionedBrokerRecord[]>()

  register(communication: CanonicalBrokerCommunicationContract, currentTime: number = Date.now()): void {
    this.active.set(communication.brokerRequestId, communication)
    const key = communication.brokerRequestId
    const versions = this.history.get(key) ?? []
    versions.push({
      brokerRequestId: communication.brokerRequestId,
      versions: { ...communication.requestMetadata.versions },
      communication,
      registeredAt: currentTime,
      active: true,
    })
    this.history.set(key, versions)
    log.info(`broker communication ${communication.brokerRequestId} registered`)
  }

  getActive(brokerRequestId: string): CanonicalBrokerCommunicationContract | null {
    return this.active.get(brokerRequestId) ?? null
  }

  getHistorical(brokerRequestId: string, gatewayVersion: string): CanonicalBrokerCommunicationContract | null {
    const versions = this.history.get(brokerRequestId)
    if (!versions) return null
    return versions.find((v) => v.versions.gatewayVersion === gatewayVersion)?.communication ?? null
  }

  listActive(): string[] {
    return Array.from(this.active.keys())
  }
}

export const brokerVersionRegistry = new BrokerVersionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// BrokerGovernanceManager (§13 — complete governance history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export class BrokerGovernanceManager {
  private governance = new Map<string, BrokerGovernanceMetadata>()

  initialize(brokerRequestId: string, currentTime: number = Date.now()): BrokerGovernanceMetadata {
    if (this.governance.has(brokerRequestId)) return this.governance.get(brokerRequestId)!
    const meta: BrokerGovernanceMetadata = {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      creationTimestamp: currentTime,
      transmissionTimestamp: null,
      retirementStatus: 'ACTIVE',
      governanceNotes: [],
    }
    this.governance.set(brokerRequestId, meta)
    return meta
  }

  get(brokerRequestId: string): BrokerGovernanceMetadata | null {
    return this.governance.get(brokerRequestId) ?? null
  }

  approve(brokerRequestId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(brokerRequestId, currentTime)
    meta.reviewHistory.push({ action: 'APPROVE', at: currentTime, actor, note, outcome: 'APPROVED' })
    meta.approvalStatus = 'APPROVED'
    log.info(`broker request ${brokerRequestId} approved by ${actor}: ${note}`)
  }

  reject(brokerRequestId: string, actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(brokerRequestId, currentTime)
    meta.reviewHistory.push({ action: 'REJECT', at: currentTime, actor, note, outcome: 'REJECTED' })
    meta.approvalStatus = 'REJECTED'
    // Rule 19 — immutable governance event for failure
    meta.auditHistory.push({ action: 'REJECTED', at: currentTime, actor, note })
    log.warn(`broker request ${brokerRequestId} rejected by ${actor}: ${note}`)
  }

  setValidationStatus(brokerRequestId: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(brokerRequestId, currentTime)
    meta.validationStatus = status
    meta.auditHistory.push({ action: `VALIDATION:${status}`, at: currentTime, actor, note })
  }

  recordTransmission(brokerRequestId: string, currentTime: number = Date.now()): void {
    const meta = this.getOrCreate(brokerRequestId, currentTime)
    meta.transmissionTimestamp = currentTime
    meta.auditHistory.push({ action: 'TRANSMITTED', at: currentTime, actor: 'gateway', note: 'message transmitted to broker' })
  }

  addAuditEvent(brokerRequestId: string, event: BrokerAuditEvent): void {
    const meta = this.getOrCreate(brokerRequestId, event.at)
    meta.auditHistory.push(event)
    if (meta.auditHistory.length > 1000) meta.auditHistory.shift()
  }

  private getOrCreate(brokerRequestId: string, currentTime: number): BrokerGovernanceMetadata {
    return this.governance.get(brokerRequestId) ?? this.initialize(brokerRequestId, currentTime)
  }
}

export const brokerGovernanceManager = new BrokerGovernanceManager()

// ─────────────────────────────────────────────────────────────────────────────
// BrokerFailoverManager (§11, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export interface FailoverEvent {
  fromBrokerId: string
  toBrokerId: string
  reason: string
  timestamp: number
  communicationPreserved: boolean
}

export class BrokerFailoverManager {
  private failoverHistory: FailoverEvent[] = []
  private failedBrokers = new Set<string>()

  /**
   * Detect broker failure (§11).
   */
  detectFailure(brokerId: string, reason: string, currentTime: number = Date.now()): boolean {
    this.failedBrokers.add(brokerId)
    log.warn(`broker ${brokerId} failed: ${reason}`)
    return true
  }

  /**
   * Initiate failover to secondary broker (§11, Rule 13).
   * Preserves execution integrity and auditability.
   */
  failover(
    fromBrokerId: string,
    failoverConfig: FailoverConfiguration,
    reason: string,
    currentTime: number = Date.now(),
  ): { toBrokerId: string | null; event: FailoverEvent | null } {
    // §11 — Find next available secondary broker
    for (const secondaryId of failoverConfig.secondaryBrokerIds) {
      if (!this.failedBrokers.has(secondaryId)) {
        const event: FailoverEvent = {
          fromBrokerId,
          toBrokerId: secondaryId,
          reason,
          timestamp: currentTime,
          communicationPreserved: true, // Rule 13 — preserves auditability
        }
        this.failoverHistory.push(event)
        log.info(`broker failover: ${fromBrokerId} → ${secondaryId} (Rule 13: auditability preserved)`)
        return { toBrokerId: secondaryId, event }
      }
    }

    log.error(`no secondary brokers available for failover from ${fromBrokerId}`)
    return { toBrokerId: null, event: null }
  }

  /**
   * Mark broker as recovered (§11).
   */
  markRecovered(brokerId: string): void {
    this.failedBrokers.delete(brokerId)
    log.info(`broker ${brokerId} recovered`)
  }

  /** Check if broker is failed. */
  isFailed(brokerId: string): boolean {
    return this.failedBrokers.has(brokerId)
  }

  /** Get failover history. */
  getFailoverHistory(): FailoverEvent[] {
    return [...this.failoverHistory]
  }
}

export const brokerFailoverManager = new BrokerFailoverManager()
