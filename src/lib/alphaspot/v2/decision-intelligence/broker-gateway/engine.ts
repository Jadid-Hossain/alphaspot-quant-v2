// CHAPTER 5.9 §5 — Broker Gateway Engine (BGE)
//
// §1 — The BGE is the EXCLUSIVE bridge between Smart Order Routing (Ch 5.8)
//      and external execution venues. Transforms validated Routing Contracts
//      into broker-specific execution requests.
//
// §5 — 16-stage pipeline (no skips):
//   1.  ROUTING_CONTRACT_RECEPTION
//   2.  CONTRACT_VALIDATION
//   3.  BROKER_SELECTION
//   4.  SESSION_VERIFICATION
//   5.  AUTHENTICATION_VERIFICATION
//   6.  CLOCK_SYNCHRONIZATION_VERIFICATION
//   7.  DISTRIBUTED_IDEMPOTENCY_GENERATION
//   8.  RATE_GOVERNOR_VERIFICATION
//   9.  PROTOCOL_TRANSLATION
//  10.  MESSAGE_VALIDATION
//  11.  ORDER_SUBMISSION
//  12.  TRANSACTIONAL_ACKNOWLEDGMENT_MONITORING
//  13.  SUBMISSION_VERIFICATION
//  14.  COMMUNICATION_RECORDING
//  15.  BROKER_RESPONSE_RECORDING
//  16.  COMMUNICATION_COMPLETION
//
// §6 — Canonical Broker Communication Contract (Rule 4 — alternative formats prohibited).
// §7 — 7 Communication Protocols (FIX 4.2/4.4/5.0, REST, WebSocket, gRPC, Proprietary).
// §8 — Session Management (Rule 9/10/18).
// §9 — Message Validation (Rule 15/16).
// §10A — Transactional Acknowledgment State Machine (Rule 21/22).
// §10B — Distributed Idempotency (Rule 23/24).
// §10C — Active Rate Governor (Rule 25/26).
// §10D — Clock Synchronization (Rule 27/28).
// §11 — Failover Management (Rule 13).
// §12 — Broker Versioning (Rule 5 immutable).
// §13 — Broker Governance.
// §17 — Failure Recovery (invalid NEVER produces ambiguous states).
//
// 28 architectural rules enforced (see §18).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalRoutingContract } from '../smart-order-routing/types'
import type {
  BrokerConfiguration,
  BrokerGovernanceMetadata,
  BrokerCommunicationLineage,
  CanonicalBrokerCommunicationContract,
  ClockSyncStatus,
  CommunicationProtocol,
  ConnectionStatus,
  GatewayConfiguration,
  RequestMetadata,
  SubmissionStatus,
  TransmissionState,
} from './types'
import { BGE_VERSION, BROKER_COMMUNICATION_SCHEMA_VERSION } from './types'
import { sessionManager, messageValidator } from './session'
import { acknowledgmentStateMachine, idempotencyManager } from './state-machine'
import { rateGovernor, clockSyncManager } from './rate-clock'
import { brokerVersionRegistry, brokerGovernanceManager, brokerFailoverManager } from './governance'
import { brokerFailureRecovery, bgeObservabilityCollector } from './recovery'

const log = createLogger('decision-intelligence:broker-gateway:engine')

// ─────────────────────────────────────────────────────────────────────────────
// BrokerSubmissionRequest — input to submit()
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerSubmissionRequest {
  /** Canonical Routing Contract (Rule 1 — only Ch 5.8 contracts). */
  routingContract: CanonicalRoutingContract
  /** Broker ID to submit to. */
  brokerId: string
  /** Child order ID. */
  childOrderId: string
  /** Symbol to trade. */
  symbol: string
  /** Order side. */
  side: 'BUY' | 'SELL'
  /** Order quantity. */
  quantity: number
  /** Order price (limit orders). */
  price: number
  /** Gateway configuration. */
  gatewayConfig: GatewayConfiguration
  /** Known symbols for validation. */
  knownSymbols: Set<string>
}

// ─────────────────────────────────────────────────────────────────────────────
// BrokerSubmissionResult — output of submit()
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerSubmissionResult {
  communication: CanonicalBrokerCommunicationContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// BrokerGatewayEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class BrokerGatewayEngine {
  private communicationHistory: CanonicalBrokerCommunicationContract[] = []
  private subscribers = new Set<(comm: CanonicalBrokerCommunicationContract) => void>()
  private readonly MAX_HISTORY = 500

  /**
   * Submit a routing contract to a broker (§5 — 16-stage pipeline).
   *
   * Rule 1 — Only Canonical Routing Contracts (Ch 5.8) may enter.
   * Rule 4 — Output conforms to Canonical Broker Communication Contract.
   * Rule 7 — Protocol translation never modifies execution intent.
   * Rule 14 — Never alters approved quantities/prices/routing/execution.
   * Rule 21 — Every outbound transmission follows state machine.
   * Rule 22 — Unknown State: never retransmitted until reconciliation.
   * Rule 23 — Exactly-once via deterministic idempotency keys.
   * Rule 25 — Rate governor prevents limit violations.
   * Rule 27 — Outbound suspended when clock drift exceeds tolerance.
   */
  submit(request: BrokerSubmissionRequest): BrokerSubmissionResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalBrokerCommunicationContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        bgeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        bgeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { routingContract, brokerId, childOrderId, symbol, side, quantity, price, gatewayConfig, knownSymbols } = request

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: ROUTING_CONTRACT_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      track('ROUTING_CONTRACT_RECEPTION', () => {
        if (!routingContract || typeof routingContract !== 'object') {
          throw new Error('invalid routing contract')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: CONTRACT_VALIDATION (§5, Rule 14 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('CONTRACT_VALIDATION', () => {
        if (!routingContract.routingDecisionId || !routingContract.parentOrderId) {
          throw new Error('routing contract missing required fields')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: BROKER_SELECTION (§5)
      // ─────────────────────────────────────────────────────────────────────
      let brokerConfig: BrokerConfiguration
      track('BROKER_SELECTION', () => {
        brokerConfig = gatewayConfig.brokers.get(brokerId)
          ?? gatewayConfig.brokers.get(gatewayConfig.defaultBrokerId)
          ?? null as unknown as BrokerConfiguration
        if (!brokerConfig) {
          throw new Error(`broker ${brokerId} not configured`)
        }
        // §11 — Check if broker is failed
        if (brokerFailoverManager.isFailed(brokerId)) {
          // Rule 13 — Attempt failover
          const failover = brokerFailoverManager.failover(brokerId, brokerConfig.failoverConfig, 'broker failed')
          if (failover.toBrokerId) {
            brokerConfig = gatewayConfig.brokers.get(failover.toBrokerId)!
            bgeObservabilityCollector.recordFailoverEvent()
          } else {
            throw new Error(`broker ${brokerId} failed and no failover available`)
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: SESSION_VERIFICATION (§5, §8, Rule 9, Rule 10)
      // ─────────────────────────────────────────────────────────────────────
      let session: ReturnType<typeof sessionManager.getActiveSession>
      track('SESSION_VERIFICATION', () => {
        session = sessionManager.getActiveSession(brokerConfig!.brokerId)
        if (!session) {
          // Initialize new session
          session = sessionManager.initializeSession(brokerConfig!.brokerId, brokerConfig!.sessionConfig)
          // Authenticate (simulated)
          sessionManager.authenticate(session, `auth-token-${Date.now()}`, 3600000)
        }
        // Rule 9/10 — Check if session can transmit
        if (!sessionManager.canTransmit(session)) {
          throw new Error(`session ${session.sessionId} cannot transmit (state: ${session.state}) — Rule 9/10`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 5: AUTHENTICATION_VERIFICATION (§5, Rule 16)
      // ─────────────────────────────────────────────────────────────────────
      track('AUTHENTICATION_VERIFICATION', () => {
        // Rule 16 — Cryptographic authentication verified
        if (!session!.authToken) {
          throw new Error('session not authenticated — Rule 16')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 6: CLOCK_SYNCHRONIZATION_VERIFICATION (§5, §10D, Rule 27)
      // ─────────────────────────────────────────────────────────────────────
      let clockSyncStatus: ClockSyncStatus
      let clockDrift: number
      track('CLOCK_SYNCHRONIZATION_VERIFICATION', () => {
        const syncState = clockSyncManager.getState()
        clockSyncStatus = syncState.status
        clockDrift = syncState.drift
        // Rule 27 — Outbound suspended when clock drift exceeds tolerance
        if (!clockSyncManager.canTransmit()) {
          throw new Error(`clock sync ${clockSyncStatus} — Rule 27 outbound suspended (drift ${clockDrift}ms)`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 7: DISTRIBUTED_IDEMPOTENCY_GENERATION (§5, §10B, Rule 23)
      // ─────────────────────────────────────────────────────────────────────
      let idempotencyKey: string
      track('DISTRIBUTED_IDEMPOTENCY_GENERATION', () => {
        const keyResult = idempotencyManager.generateKey(
          routingContract.routingDecisionId,
          routingContract.parentOrderId,
          childOrderId,
          brokerConfig!.brokerId,
          brokerConfig!.protocolVersion,
        )
        idempotencyKey = keyResult.key

        // Rule 23 — Check for duplicate (exactly-once)
        const duplicateCheck = idempotencyManager.checkDuplicate(idempotencyKey)
        if (duplicateCheck.isDuplicate) {
          bgeObservabilityCollector.recordDuplicatePrevented()
          throw new Error(`idempotency conflict — ${duplicateCheck.reason} (Rule 23)`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 8: RATE_GOVERNOR_VERIFICATION (§5, §10C, Rule 25, Rule 26)
      // ─────────────────────────────────────────────────────────────────────
      track('RATE_GOVERNOR_VERIFICATION', () => {
        if (gatewayConfig.rateGovernorEnabled) {
          const check = rateGovernor.checkTransmission(brokerConfig!.brokerId, brokerConfig!.rateLimits, 1)
          bgeObservabilityCollector.recordRateGovernorActivation()
          // Rule 25 — Prevent violations of exchange limits
          // Rule 26 — Throttle before communication, not after rejection
          if (check.action === 'REJECT') {
            bgeObservabilityCollector.recordRateLimitEvent()
            throw new Error(`rate governor rejected: ${check.reason} (Rule 25/26)`)
          }
          if (check.action === 'DELAY' || check.action === 'BUFFER') {
            log.debug(`rate governor ${check.action}: ${check.reason} — wait ${check.waitMs}ms`)
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 9: PROTOCOL_TRANSLATION (§5, §7, Rule 7)
      // ─────────────────────────────────────────────────────────────────────
      let protocol: CommunicationProtocol
      track('PROTOCOL_TRANSLATION', () => {
        protocol = brokerConfig!.defaultProtocol
        // Rule 7 — Protocol translation never modifies execution intent
        // (Translation would format the message per protocol spec — not shown here)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: MESSAGE_VALIDATION (§5, §9, Rule 15)
      // ─────────────────────────────────────────────────────────────────────
      track('MESSAGE_VALIDATION', () => {
        const validation = messageValidator.validate(
          symbol, quantity, price, Date.now(),
          session!, brokerConfig!, knownSymbols,
        )
        // Rule 15 — Invalid messages never transmitted
        if (!validation.valid) {
          throw new Error(`message validation failed: ${validation.errors.join('; ')}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: ORDER_SUBMISSION (§5)
      // ─────────────────────────────────────────────────────────────────────
      let brokerOrderId: string | null = null
      let submissionStatus: SubmissionStatus
      const brokerRequestId = `breq-${brokerConfig!.brokerId}-${startTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      track('ORDER_SUBMISSION', () => {
        // Simulate order submission
        brokerOrderId = `broker-order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        submissionStatus = 'SUBMITTED'
        // Increment session sequence
        sessionManager.incrementSequence(session!)
        // Record rate governor usage
        rateGovernor.recordTransmission(brokerConfig!.brokerId, 1)
        brokerGovernanceManager.recordTransmission(brokerRequestId)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: TRANSACTIONAL_ACKNOWLEDGMENT_MONITORING (§5, §10A, Rule 21)
      // ─────────────────────────────────────────────────────────────────────
      let transmissionState: TransmissionState
      track('TRANSACTIONAL_ACKNOWLEDGMENT_MONITORING', () => {
        // Rule 21 — Initialize state machine
        acknowledgmentStateMachine.initialize(brokerRequestId, idempotencyKey!)
        acknowledgmentStateMachine.transition(brokerRequestId, 'TRANSMITTED', 'message transmitted to broker')
        acknowledgmentStateMachine.transition(brokerRequestId, 'TRANSMITTED_UNACKNOWLEDGED', 'awaiting broker acknowledgment')

        // Simulate acknowledgment received
        acknowledgmentStateMachine.transition(brokerRequestId, 'ACKNOWLEDGED', 'broker acknowledged')
        transmissionState = 'ACKNOWLEDGED'
        bgeObservabilityCollector.recordTransmissionState(transmissionState)
        bgeObservabilityCollector.recordAcknowledgmentLatency(Date.now() - startTime)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: SUBMISSION_VERIFICATION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('SUBMISSION_VERIFICATION', () => {
        if (transmissionState !== 'ACKNOWLEDGED') {
          throw new Error(`submission not acknowledged (state: ${transmissionState})`)
        }
        acknowledgmentStateMachine.transition(brokerRequestId, 'COMPLETED', 'submission verified')
        transmissionState = 'COMPLETED'
        bgeObservabilityCollector.recordTransmissionState(transmissionState)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: COMMUNICATION_RECORDING (§5, Rule 5 — immutable)
      // ─────────────────────────────────────────────────────────────────────
      let communication: CanonicalBrokerCommunicationContract
      track('COMMUNICATION_RECORDING', () => {
        const now = Date.now()
        const lineage: BrokerCommunicationLineage = {
          routingDecisionId: routingContract.routingDecisionId,
          executionPlanId: routingContract.routingMetadata.lineage.executionPlanId,
          orderDecisionId: routingContract.routingMetadata.lineage.orderDecisionId,
          positionId: routingContract.routingMetadata.lineage.positionId,
          riskAssessmentId: routingContract.routingMetadata.lineage.riskAssessmentId,
          portfolioId: routingContract.routingMetadata.lineage.portfolioId,
          strategyDecisionIds: routingContract.routingMetadata.lineage.strategyDecisionIds,
          brokerApiVersion: brokerConfig!.apiVersion,
          protocolVersion: brokerConfig!.protocolVersion,
          clockSyncVersion: '1.0.0',
          idempotencyVersion: brokerConfig!.idempotencyConfig.keyGenerationVersion,
          configurationVersion: brokerConfig!.configVersion,
          governanceVersion: '1.0.0',
        }

        const requestMetadata: RequestMetadata = {
          brokerRequestId,
          gatewayVersion: BGE_VERSION,
          versions: {
            gatewayVersion: BGE_VERSION,
            brokerApiVersion: brokerConfig!.apiVersion,
            protocolVersion: brokerConfig!.protocolVersion,
            configurationVersion: brokerConfig!.configVersion,
            governanceVersion: '1.0.0',
          },
          lineage,
          protocol: protocol!,
          idempotencyKey: idempotencyKey!,
          idempotencyMechanism: brokerConfig!.idempotencyConfig.mechanism,
          transmissionAttempt: 1,
          clockSyncStatus: clockSyncStatus!,
          clockDrift: clockDrift!,
        }

        const governanceMeta: BrokerGovernanceMetadata = brokerGovernanceManager.initialize(brokerRequestId, now)
        brokerGovernanceManager.setValidationStatus(brokerRequestId, 'PASSED', 'bge-engine', 'message validated')
        brokerGovernanceManager.approve(brokerRequestId, 'bge-engine', 'auto-approved (acknowledged)')

        communication = {
          brokerRequestId,
          gatewayVersion: BGE_VERSION,
          routingDecisionId: routingContract.routingDecisionId,
          brokerId: brokerConfig!.brokerId,
          exchange: brokerConfig!.exchange,
          requestTimestamp: startTime,
          protocol: protocol!,
          brokerOrderId,
          submissionStatus: submissionStatus!,
          transmissionState: transmissionState!,
          acknowledgmentState: 'ACKNOWLEDGED',
          idempotencyKey: idempotencyKey!,
          transmissionAttempt: 1,
          clockSyncStatus: clockSyncStatus!,
          brokerSessionId: session!.sessionId,
          connectionStatus: 'CONNECTED',
          requestMetadata,
          governanceMetadata: governanceMeta,
          pipelineStages,
          createdAt: now,
        }

        communication = Object.freeze(communication) as CanonicalBrokerCommunicationContract // Rule 5
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 15: BROKER_RESPONSE_RECORDING (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('BROKER_RESPONSE_RECORDING', () => {
        brokerVersionRegistry.register(communication!)
        bgeObservabilityCollector.recordGovernanceEvent()
        bgeObservabilityCollector.recordSubmission(
          submissionStatus!, protocol!, Date.now() - startTime, brokerConfig!.brokerId,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 16: COMMUNICATION_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('COMMUNICATION_COMPLETION', () => {
        this.communicationHistory.push(communication!)
        if (this.communicationHistory.length > this.MAX_HISTORY) this.communicationHistory.shift()

        for (const sub of this.subscribers) {
          try { sub(communication!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `broker communication ${communication!.brokerRequestId}: broker=${brokerConfig!.brokerId}, ` +
          `protocol=${protocol}, status=${submissionStatus}, state=${transmissionState}, ` +
          `${Date.now() - startTime}ms`,
        )
      })

      return {
        communication: communication!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`broker submission failed: ${reason}`)
      brokerFailureRecovery.logFailure(
        null, 'INTERNAL_ERROR', 'BROKER_SUBMISSION', reason, 'GRACEFUL_DEGRADATION',
      )
      bgeObservabilityCollector.recordApiError()
      return {
        communication: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  onCommunication(handler: (comm: CanonicalBrokerCommunicationContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getRecentCommunications(limit: number = 50): CanonicalBrokerCommunicationContract[] {
    return this.communicationHistory.slice(-limit)
  }

  getMetrics() {
    return bgeObservabilityCollector.snapshot()
  }

  getRecoveryStats() {
    return brokerFailureRecovery.getStats()
  }

  getVersion() {
    return {
      engineVersion: BGE_VERSION,
      schemaVersion: BROKER_COMMUNICATION_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const brokerGatewayEngine = new BrokerGatewayEngine()
