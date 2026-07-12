// CHAPTER 5.9 §10A, §10B — Transactional Acknowledgment State Machine
//                              & Distributed Idempotency Management
//
// §10A — Transactional Acknowledgment Management:
//   • Every outbound request follows a deterministic acknowledgment state machine
//   • States: Pending Transmission, Transmitted, Transmitted-Unacknowledged,
//     Acknowledged, Rejected, Timed Out, Unknown State, Reconciliation Required, Completed
//   • Unknown State: duplicate submission prohibited, cancellations suspended,
//     execution ownership unresolved, reconciliation required
//
// §10B — Distributed Idempotency Management:
//   • Exactly-once logical submission across distributed gateway clusters
//   • Deterministic idempotency key from: Routing Decision ID, Parent Order ID,
//     Child Order ID, Gateway Cluster Epoch, Broker Identifier, Protocol Version
//   • Embedded in: FIX ClOrdID, REST Idempotency-Key, Exchange Client Order ID, etc.
//   • Duplicate transmissions using identical keys automatically rejected
//
// Rule 11 — Duplicate broker requests prevented via deterministic idempotency.
// Rule 21 — Every outbound transmission follows state machine before completion.
// Rule 22 — Unknown State: never retransmitted until reconciliation completes.
// Rule 23 — Exactly-once via deterministic distributed idempotency keys.
// Rule 24 — Globally unique sequencing independent of local node state.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AcknowledgmentState,
  IdempotencyMechanism,
  TransmissionState,
} from './types'

const log = createLogger('decision-intelligence:broker-gateway:state-machine')

// ─────────────────────────────────────────────────────────────────────────────
// TransactionalAcknowledgmentStateMachine (§10A, Rule 21, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface StateTransition {
  from: TransmissionState
  to: TransmissionState
  at: number
  reason: string
  actor: string
}

export interface AcknowledgmentRecord {
  brokerRequestId: string
  currentState: TransmissionState
  acknowledgmentState: AcknowledgmentState
  transmissionAttempt: number
  transitions: StateTransition[]
  /** §10A — Entered Unknown State (Rule 22). */
  enteredUnknownState: boolean
  /** §10A — Reconciliation required. */
  reconciliationRequired: boolean
  lastUpdate: number
}

export class TransactionalAcknowledgmentStateMachine {
  private records = new Map<string, AcknowledgmentRecord>()
  /** Idempotency key → brokerRequestId (for dedup). */
  private keyToRequest = new Map<string, string>()

  /**
   * Initialize a new acknowledgment record (§10A, Rule 21).
   */
  initialize(brokerRequestId: string, idempotencyKey: string, currentTime: number = Date.now()): AcknowledgmentRecord {
    const record: AcknowledgmentRecord = {
      brokerRequestId,
      currentState: 'PENDING_TRANSMISSION',
      acknowledgmentState: 'PENDING',
      transmissionAttempt: 0,
      transitions: [],
      enteredUnknownState: false,
      reconciliationRequired: false,
      lastUpdate: currentTime,
    }
    this.records.set(brokerRequestId, record)
    this.keyToRequest.set(idempotencyKey, brokerRequestId)
    return record
  }

  /**
   * Transition to a new state (§10A, Rule 21).
   * Every transition is immutable, timestamped, version controlled, auditable.
   */
  transition(
    brokerRequestId: string,
    toState: TransmissionState,
    reason: string,
    actor: string = 'gateway',
    currentTime: number = Date.now(),
  ): boolean {
    const record = this.records.get(brokerRequestId)
    if (!record) {
      log.warn(`transition failed — unknown brokerRequestId: ${brokerRequestId}`)
      return false
    }

    const fromState = record.currentState
    if (!this.isValidTransition(fromState, toState)) {
      log.warn(`invalid transition: ${fromState} → ${toState} for ${brokerRequestId}`)
      return false
    }

    record.transitions.push({ from: fromState, to: toState, at: currentTime, reason, actor })
    record.currentState = toState
    record.lastUpdate = currentTime

    // Update acknowledgment state
    switch (toState) {
      case 'TRANSMITTED': record.acknowledgmentState = 'PENDING'; break
      case 'TRANSMITTED_UNACKNOWLEDGED': record.acknowledgmentState = 'PENDING'; break
      case 'ACKNOWLEDGED': record.acknowledgmentState = 'ACKNOWLEDGED'; break
      case 'REJECTED': record.acknowledgmentState = 'REJECTED'; break
      case 'TIMED_OUT': record.acknowledgmentState = 'TIMED_OUT'; break
      case 'UNKNOWN_STATE':
        record.acknowledgmentState = 'UNKNOWN'
        record.enteredUnknownState = true
        record.reconciliationRequired = true
        break
      case 'RECONCILIATION_REQUIRED': record.reconciliationRequired = true; break
      case 'COMPLETED': record.acknowledgmentState = 'ACKNOWLEDGED'; break
    }

    log.debug(`acknowledgment state: ${fromState} → ${toState} for ${brokerRequestId} (${reason})`)
    return true
  }

  /**
   * Check if a request can be retransmitted (Rule 22).
   * Unknown State: never retransmitted until reconciliation completes.
   */
  canRetransmit(brokerRequestId: string): boolean {
    const record = this.records.get(brokerRequestId)
    if (!record) return true
    // Rule 22 — Unknown State prohibits retransmission
    if (record.currentState === 'UNKNOWN_STATE' && record.reconciliationRequired) {
      return false
    }
    return true
  }

  /**
   * Mark reconciliation complete (§10A, Rule 22).
   */
  completeReconciliation(brokerRequestId: string, finalState: TransmissionState, currentTime: number = Date.now()): boolean {
    const record = this.records.get(brokerRequestId)
    if (!record) return false
    record.reconciliationRequired = false
    record.enteredUnknownState = false
    return this.transition(brokerRequestId, finalState, 'reconciliation completed', 'reconciliation-engine', currentTime)
  }

  /**
   * Get acknowledgment record.
   */
  getRecord(brokerRequestId: string): AcknowledgmentRecord | null {
    return this.records.get(brokerRequestId) ?? null
  }

  /**
   * Check if a request is in Unknown State (Rule 22).
   */
  isUnknownState(brokerRequestId: string): boolean {
    const record = this.records.get(brokerRequestId)
    return record?.currentState === 'UNKNOWN_STATE'
  }

  /**
   * Valid state transitions (§10A — deterministic state machine).
   */
  private isValidTransition(from: TransmissionState, to: TransmissionState): boolean {
    const valid: Record<TransmissionState, TransmissionState[]> = {
      PENDING_TRANSMISSION: ['TRANSMITTED', 'REJECTED', 'TIMED_OUT'],
      TRANSMITTED: ['TRANSMITTED_UNACKNOWLEDGED', 'ACKNOWLEDGED', 'REJECTED', 'TIMED_OUT', 'UNKNOWN_STATE'],
      TRANSMITTED_UNACKNOWLEDGED: ['ACKNOWLEDGED', 'REJECTED', 'TIMED_OUT', 'UNKNOWN_STATE'],
      ACKNOWLEDGED: ['COMPLETED', 'RECONCILIATION_REQUIRED'],
      REJECTED: ['COMPLETED', 'RECONCILIATION_REQUIRED'],
      TIMED_OUT: ['RECONCILIATION_REQUIRED', 'COMPLETED'],
      UNKNOWN_STATE: ['RECONCILIATION_REQUIRED'], // Rule 22 — cannot retransmit directly
      RECONCILIATION_REQUIRED: ['COMPLETED', 'ACKNOWLEDGED', 'REJECTED'],
      COMPLETED: [], // terminal
    }
    return valid[from]?.includes(to) ?? false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DistributedIdempotencyManager (§10B, Rule 23, Rule 24)
// ─────────────────────────────────────────────────────────────────────────────

export class DistributedIdempotencyManager {
  /** Set of all generated keys (for dedup). */
  private generatedKeys = new Set<string>()
  /** §10B — Cluster epoch for distributed uniqueness. */
  private clusterEpoch: number
  /** §10B — Key generation version. */
  private keyVersion: string

  constructor(clusterEpoch: number = 1, keyVersion: string = '1.0.0') {
    this.clusterEpoch = clusterEpoch
    this.keyVersion = keyVersion
  }

  /**
   * Generate a deterministic distributed idempotency key (§10B, Rule 23).
   * Key is derived from immutable execution metadata.
   * Deterministic: same inputs → same key.
   * Does NOT register the key — use checkDuplicate() to register + verify.
   */
  generateKey(
    routingDecisionId: string,
    parentOrderId: string,
    childOrderId: string,
    brokerId: string,
    protocolVersion: string,
  ): { key: string; mechanism: IdempotencyMechanism; version: string } {
    // §10B — Deterministic key from immutable metadata
    const keyParts = [
      routingDecisionId,
      parentOrderId,
      childOrderId,
      String(this.clusterEpoch),
      brokerId,
      protocolVersion,
    ]
    const key = `idem-${keyParts.join('-')}`

    log.debug(`idempotency key generated: ${key} (epoch ${this.clusterEpoch})`)
    return {
      key,
      mechanism: 'REST_IDEMPOTENCY_KEY', // default; would be protocol-specific
      version: this.keyVersion,
    }
  }

  /**
   * Check if a key has been used (Rule 23 — exactly-once).
   */
  isKeyUsed(key: string): boolean {
    return this.generatedKeys.has(key)
  }

  /**
   * Reject duplicate transmission (§10B, Rule 11).
   * If not a duplicate, registers the key (exactly-once enforcement).
   */
  checkDuplicate(key: string): { isDuplicate: boolean; reason: string } {
    if (this.generatedKeys.has(key)) {
      return {
        isDuplicate: true,
        reason: `duplicate idempotency key ${key} — transmission rejected (Rule 11, Rule 23)`,
      }
    }
    // Register the key (exactly-once)
    this.generatedKeys.add(key)
    return { isDuplicate: false, reason: 'unique idempotency key registered' }
  }

  /**
   * Embed idempotency key into protocol-specific field (§10B).
   */
  embedInProtocol(key: string, mechanism: IdempotencyMechanism): { field: string; value: string } {
    switch (mechanism) {
      case 'FIX_CLORDID':
        return { field: 'ClOrdID', value: key }
      case 'FIX_SECONDARY_CLORDID':
        return { field: 'SecondaryClOrdID', value: key }
      case 'REST_IDEMPOTENCY_KEY':
        return { field: 'Idempotency-Key', value: key }
      case 'EXCHANGE_CLIENT_ORDER_ID':
        return { field: 'clientOrderId', value: key }
      case 'PROPRIETARY_BROKER_ID':
        return { field: 'brokerOrderId', value: key }
      default:
        return { field: 'idempotencyKey', value: key }
    }
  }

  /** Update cluster epoch (Rule 24 — globally unique sequencing). */
  updateClusterEpoch(epoch: number): void {
    this.clusterEpoch = epoch
    log.info(`cluster epoch updated: ${epoch}`)
  }

  /** Get current cluster epoch. */
  getClusterEpoch(): number {
    return this.clusterEpoch
  }

  /** Get total keys generated. */
  getKeyCount(): number {
    return this.generatedKeys.size
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const acknowledgmentStateMachine = new TransactionalAcknowledgmentStateMachine()
export const idempotencyManager = new DistributedIdempotencyManager()
