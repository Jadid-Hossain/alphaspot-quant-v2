// CHAPTER 5.10 §5 — Exchange Execution Engine (EEE)
//
// §1 — The EEE is the EXCLUSIVE bridge between Broker Gateway (Ch 5.9) and
//      Post-Trade Processing. Manages complete lifecycle of live exchange orders.
//
// §5 — 14-stage pipeline (no skips):
//   1.  BROKER_COMMUNICATION_RECEPTION
//   2.  COMMUNICATION_VALIDATION
//   3.  EXCHANGE_SESSION_VERIFICATION
//   4.  EXCHANGE_ACKNOWLEDGMENT_PROCESSING
//   5.  ASYNCHRONOUS_SEQUENCE_BUFFER
//   6.  EVENT_ORDERING_GAP_DETECTION
//   7.  EXECUTION_EVENT_RECEPTION
//   8.  EXECUTION_STATE_UPDATE
//   9.  FILL_AGGREGATION
//  10.  TRADE_BUST_CORRECTION_PROCESSING
//  11.  EXECUTION_VALIDATION
//  12.  EXECUTION_PUBLICATION
//  13.  METADATA_RECORDING
//  14.  EXECUTION_COMPLETION
//
// §6 — Canonical Execution Event Contract (Rule 4 — alternative formats prohibited).
// §7 — Order Lifecycle: 15 states, deterministic transitions (Rule 6).
// §8 — Fill Management (Rule 9, Rule 10, Rule 12).
// §9 — Exchange Events: 16 types, Trade Bust/Correction (Rule 22).
// §10 — Execution State + Gap-Recovery (Rule 23).
// §11 — Execution Versioning (Rule 5 immutable).
// §12 — Execution Governance.
// §16 — Failure Recovery (incomplete histories NEVER published).
//
// 23 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalBrokerCommunicationContract } from '../broker-gateway/types'
import type {
  CanonicalExecutionEventContract,
  ExecutionConfiguration,
  ExecutionGovernanceMetadata,
  ExecutionLineage,
  ExecutionMetadata,
  ExecutionState,
  ExecutionStatus,
  ExecutionVersionBundle,
  ExchangeEvent,
  FillAggregation,
} from './types'
import { EEE_VERSION, EXECUTION_EVENT_SCHEMA_VERSION } from './types'
import { fillAggregator, AsynchronousSequenceBuffer } from './buffer-fills'
import { executionStateManager, exchangeEventProcessor } from './state'
import { executionVersionRegistry, executionGovernanceManager } from './governance'
import { executionFailureRecovery, eeeObservabilityCollector } from './recovery'

const log = createLogger('decision-intelligence:exchange-execution:engine')

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionRequest — input to process()
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionRequest {
  /** Canonical Broker Communication Contract (Rule 1 — only Ch 5.9 contracts). */
  brokerCommunication: CanonicalBrokerCommunicationContract
  /** Order quantity (from routing contract). */
  orderQuantity: number
  /** Exchange events to process. */
  exchangeEvents: ExchangeEvent[]
  /** Execution configuration. */
  config: ExecutionConfiguration
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionResult — output of process()
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  execution: CanonicalExecutionEventContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// ExchangeExecutionEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class ExchangeExecutionEngine {
  private executionHistory: CanonicalExecutionEventContract[] = []
  private subscribers = new Set<(execution: CanonicalExecutionEventContract) => void>()
  private readonly MAX_HISTORY = 500

  /**
   * Process a broker communication and exchange events (§5 — 14-stage pipeline).
   *
   * Rule 1 — Only Canonical Broker Communication Contracts (Ch 5.9) may enter.
   * Rule 4 — Output conforms to Canonical Execution Event Contract.
   * Rule 5 — Historical execution records immutable.
   * Rule 16 — Never modifies upstream contracts.
   * Rule 22 — Trade Bust/Correction generate compensating events.
   * Rule 23 — Gap-Recovery: no downstream publication until replay confirms.
   */
  process(request: ExecutionRequest): ExecutionResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalExecutionEventContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        eeeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        eeeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { brokerCommunication, orderQuantity, exchangeEvents, config } = request
    // Create per-order sequence buffer (§7 — each order has its own event sequence)
    const orderBuffer = new AsynchronousSequenceBuffer(config.sequenceBufferMaxSize)

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: BROKER_COMMUNICATION_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      track('BROKER_COMMUNICATION_RECEPTION', () => {
        if (!brokerCommunication || typeof brokerCommunication !== 'object') {
          throw new Error('invalid broker communication contract')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: COMMUNICATION_VALIDATION (§5, Rule 16 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('COMMUNICATION_VALIDATION', () => {
        if (!brokerCommunication.brokerRequestId || !brokerCommunication.brokerOrderId) {
          throw new Error('broker communication missing required fields')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: EXCHANGE_SESSION_VERIFICATION (§5, §10)
      // ─────────────────────────────────────────────────────────────────────
      const exchangeOrderId = brokerCommunication.brokerOrderId ?? `exchange-${Date.now()}`
      track('EXCHANGE_SESSION_VERIFICATION', () => {
        // Initialize live order
        executionStateManager.initializeOrder(exchangeOrderId, brokerCommunication.brokerOrderId!, orderQuantity)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: EXCHANGE_ACKNOWLEDGMENT_PROCESSING (§5, Rule 11)
      // ─────────────────────────────────────────────────────────────────────
      track('EXCHANGE_ACKNOWLEDGMENT_PROCESSING', () => {
        // Rule 11 — Only confirmed acks advance state
        const ackEvent = exchangeEvents.find((e) => e.eventType === 'NEW_ORDER_ACK')
        if (ackEvent) {
          exchangeEventProcessor.process(ackEvent, executionStateManager, fillAggregator)
          eeeObservabilityCollector.recordEventType(ackEvent.eventType)
          // Commit the ack sequence so subsequent events are "in order"
          orderBuffer.commitSequence(ackEvent.exchangeSequence)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 5: ASYNCHRONOUS_SEQUENCE_BUFFER (§5, §7, Rule 6, Rule 21)
      // ─────────────────────────────────────────────────────────────────────
      /** Events that arrived in-order and were processed immediately. */
      const inOrderEvents: ExchangeEvent[] = []
      track('ASYNCHRONOUS_SEQUENCE_BUFFER', () => {
        for (const event of exchangeEvents) {
          if (event.eventType === 'NEW_ORDER_ACK') continue // already processed
          const result = orderBuffer.bufferEvent(event)
          if (result.buffered) {
            eeeObservabilityCollector.recordOutOfOrderEvent()
          } else {
            // Event is in order — collect for immediate processing
            inOrderEvents.push(event)
            orderBuffer.commitSequence(event.exchangeSequence)
          }
        }
        eeeObservabilityCollector.recordSequenceBufferDepth(orderBuffer.getDepth())
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 6: EVENT_ORDERING_GAP_DETECTION (§5, §7)
      // ─────────────────────────────────────────────────────────────────────
      let gapDetected = false
      track('EVENT_ORDERING_GAP_DETECTION', () => {
        const gapResult = orderBuffer.detectGaps()
        if (gapResult.hasGap) {
          gapDetected = true
          // Rule 23 — Enter gap recovery
          executionStateManager.enterGapRecovery(exchangeOrderId)
          log.warn(`gap detected: ${gapResult.missingSequences.length} missing sequences`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 7: EXECUTION_EVENT_RECEPTION (§5, §9)
      // ─────────────────────────────────────────────────────────────────────
      track('EXECUTION_EVENT_RECEPTION', () => {
        // Process in-order events first (collected in stage 5)
        const allEvents = [...inOrderEvents]
        // Then process buffered events in order
        let nextEvent = orderBuffer.getNextInOrder()
        while (nextEvent) {
          allEvents.push(nextEvent)
          nextEvent = orderBuffer.getNextInOrder()
        }
        // Sort all events by sequence for deterministic processing
        allEvents.sort((a, b) => a.exchangeSequence - b.exchangeSequence)

        for (const event of allEvents) {
          const result = exchangeEventProcessor.process(event, executionStateManager, fillAggregator)
          if (result.processed) {
            eeeObservabilityCollector.recordEventType(event.eventType)
            if (result.fillAdded) {
              if (event.eventType === 'PARTIAL_FILL') {
                eeeObservabilityCollector.recordPartialFill()
              } else if (event.eventType === 'COMPLETE_FILL') {
                eeeObservabilityCollector.recordCompleteFill(event.eventTimestamp - startTime)
              }
            }
            if (result.bustApplied) eeeObservabilityCollector.recordTradeBust()
            if (result.correctionApplied) eeeObservabilityCollector.recordTradeCorrection()
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 8: EXECUTION_STATE_UPDATE (§5, §10)
      // ─────────────────────────────────────────────────────────────────────
      let liveOrder: ReturnType<typeof executionStateManager.getOrder>
      track('EXECUTION_STATE_UPDATE', () => {
        liveOrder = executionStateManager.getOrder(exchangeOrderId)
        if (!liveOrder) {
          throw new Error('live order not found after event processing')
        }
        eeeObservabilityCollector.recordExecutionState(liveOrder.currentState)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 9: FILL_AGGREGATION (§5, §8, Rule 9, Rule 10)
      // ─────────────────────────────────────────────────────────────────────
      let fillAggregation: FillAggregation
      track('FILL_AGGREGATION', () => {
        fillAggregation = fillAggregator.aggregate(liveOrder!.fills, orderQuantity)
        // Update live order with aggregated values
        executionStateManager.updateFillQuantities(
          exchangeOrderId,
          fillAggregation.totalFilledQuantity,
          fillAggregation.remainingQuantity,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: TRADE_BUST_CORRECTION_PROCESSING (§5, §9, Rule 22)
      // ─────────────────────────────────────────────────────────────────────
      track('TRADE_BUST_CORRECTION_PROCESSING', () => {
        // Already processed in event reception — bust/correction events
        // generate compensating events without modifying history (Rule 22)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: EXECUTION_VALIDATION (§5, §16, Rule 23)
      // ─────────────────────────────────────────────────────────────────────
      track('EXECUTION_VALIDATION', () => {
        // Rule 23 — Only fully synchronized states may be published
        if (!executionStateManager.canPublish(exchangeOrderId)) {
          throw new Error('execution in gap-recovery — cannot publish (Rule 23)')
        }
        // §16 — Incomplete execution histories never published
        if (gapDetected && !orderBuffer.canFlush()) {
          throw new Error('incomplete execution history — gap not resolved (§16)')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: EXECUTION_PUBLICATION (§5, Rule 5 — immutable)
      // ─────────────────────────────────────────────────────────────────────
      let execution: CanonicalExecutionEventContract
      track('EXECUTION_PUBLICATION', () => {
        const now = Date.now()
        const versions: ExecutionVersionBundle = {
          executionVersion: EEE_VERSION,
          brokerVersion: brokerCommunication.gatewayVersion,
          routingVersion: '1.0.0',
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }

        const lineage: ExecutionLineage = {
          brokerRequestId: brokerCommunication.brokerRequestId,
          routingDecisionId: brokerCommunication.routingDecisionId,
          executionPlanId: brokerCommunication.requestMetadata.lineage.executionPlanId,
          orderDecisionId: brokerCommunication.requestMetadata.lineage.orderDecisionId,
          positionId: brokerCommunication.requestMetadata.lineage.positionId,
          riskAssessmentId: brokerCommunication.requestMetadata.lineage.riskAssessmentId,
          portfolioId: brokerCommunication.requestMetadata.lineage.portfolioId,
          strategyDecisionIds: brokerCommunication.requestMetadata.lineage.strategyDecisionIds,
          exchangeOrderId,
          brokerOrderId: brokerCommunication.brokerOrderId!,
          childOrderId: brokerCommunication.requestMetadata.lineage.executionPlanId, // simplified
          brokerApiVersion: brokerCommunication.requestMetadata.lineage.brokerApiVersion,
          protocolVersion: brokerCommunication.requestMetadata.lineage.protocolVersion,
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }

        const executionStatus = this.mapStateToStatus(liveOrder!.currentState)

        const executionMetadata: ExecutionMetadata = {
          executionEventId: `exec-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          executionVersion: EEE_VERSION,
          versions,
          lineage,
          executionState: liveOrder!.currentState,
          sessionStatus: liveOrder!.sessionStatus,
          gapRecoveryState: liveOrder!.gapRecoveryState,
          sequenceBufferDepth: orderBuffer.getDepth(),
          lastExchangeSequence: liveOrder!.lastExchangeSequence,
        }

        const governanceMeta: ExecutionGovernanceMetadata = executionGovernanceManager.initialize(executionMetadata.executionEventId, now)

        execution = {
          executionEventId: executionMetadata.executionEventId,
          executionVersion: EEE_VERSION,
          exchangeOrderId,
          brokerOrderId: brokerCommunication.brokerOrderId!,
          parentOrderId: brokerCommunication.routingDecisionId, // links to parent order
          childOrderId: lineage.childOrderId,
          executionTimestamp: now,
          executionStatus,
          executionState: liveOrder!.currentState,
          executedQuantity: fillAggregation!.totalFilledQuantity,
          remainingQuantity: fillAggregation!.remainingQuantity,
          averageExecutionPrice: fillAggregation!.averageExecutionPrice,
          executionVenue: brokerCommunication.exchange,
          fillAggregation: fillAggregation!,
          executionMetadata,
          governanceMetadata: governanceMeta,
          pipelineStages,
          createdAt: now,
        }

        execution = Object.freeze(execution) as CanonicalExecutionEventContract // Rule 5
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: METADATA_RECORDING (§5, §12)
      // ─────────────────────────────────────────────────────────────────────
      track('METADATA_RECORDING', () => {
        executionVersionRegistry.register(execution!)
        executionGovernanceManager.setValidationStatus(execution!.executionEventId, 'PASSED', 'eee-engine', 'execution validated')
        executionGovernanceManager.approve(execution!.executionEventId, 'eee-engine', `auto-approved (state ${execution!.executionState})`)
        executionGovernanceManager.completeExecution(execution!.executionEventId)
        eeeObservabilityCollector.recordGovernanceEvent()
        eeeObservabilityCollector.recordExecutionLatency(Date.now() - startTime)
        if (execution!.executionStatus === 'REJECTED') eeeObservabilityCollector.recordOrderRejected()
        else eeeObservabilityCollector.recordOrderAccepted()
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: EXECUTION_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('EXECUTION_COMPLETION', () => {
        this.executionHistory.push(execution!)
        if (this.executionHistory.length > this.MAX_HISTORY) this.executionHistory.shift()

        for (const sub of this.subscribers) {
          try { sub(execution!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `execution ${execution!.executionEventId}: state=${execution!.executionState}, ` +
          `executed=${execution!.executedQuantity.toFixed(6)}, remaining=${execution!.remainingQuantity.toFixed(6)}, ` +
          `avgPrice=${execution!.averageExecutionPrice.toFixed(2)}, fills=${execution!.fillAggregation.fillCount}, ` +
          `${Date.now() - startTime}ms`,
        )
      })

      return {
        execution: execution!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`execution processing failed: ${reason}`)
      executionFailureRecovery.logFailure(
        null, 'INTERNAL_ERROR', 'EXECUTION_PROCESSING', reason, 'GRACEFUL_DEGRADATION',
      )
      return {
        execution: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /** Map execution state to status (§4, §6). */
  private mapStateToStatus(state: ExecutionState): ExecutionStatus {
    switch (state) {
      case 'SUBMITTED': return 'PENDING'
      case 'ACCEPTED':
      case 'WORKING': return 'ACTIVE'
      case 'PARTIALLY_FILLED': return 'PARTIALLY_FILLED'
      case 'FILLED': return 'FILLED'
      case 'CANCELLED': return 'CANCELLED'
      case 'REJECTED': return 'REJECTED'
      case 'EXPIRED': return 'EXPIRED'
      case 'SUSPENDED': return 'SUSPENDED'
      case 'TRADE_BUSTED': return 'BUSTED'
      case 'TRADE_CORRECTED': return 'CORRECTED'
      default: return 'PENDING'
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  onExecution(handler: (execution: CanonicalExecutionEventContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getRecentExecutions(limit: number = 50): CanonicalExecutionEventContract[] {
    return this.executionHistory.slice(-limit)
  }

  getMetrics() {
    return eeeObservabilityCollector.snapshot()
  }

  getRecoveryStats() {
    return executionFailureRecovery.getStats()
  }

  getVersion() {
    return {
      engineVersion: EEE_VERSION,
      schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const exchangeExecutionEngine = new ExchangeExecutionEngine()
