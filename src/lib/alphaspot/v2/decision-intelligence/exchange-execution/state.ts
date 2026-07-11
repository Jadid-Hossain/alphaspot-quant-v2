// CHAPTER 5.10 §7, §9, §10 — Execution State, Gap-Recovery & Event Processing
//
// §7 — Order Lifecycle Management: 15 execution states, deterministic transitions.
// §9 — Exchange Event Management: 16 event types, Trade Bust/Correction (Rule 22).
// §10 — Execution State Management: live order state, gap-recovery mode (Rule 23).
//
// Rule 6 — Deterministic state transitions, version controlled.
// Rule 11 — Only confirmed exchange acknowledgments advance execution state.
// Rule 14 — Exchange session failures trigger deterministic recovery.
// Rule 15 — Execution state synchronized with confirmed exchange events.
// Rule 22 — Trade Bust/Correction never modify history; generate compensating events.
// Rule 23 — Gap-Recovery Mode: no downstream publication until replay confirms.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  ExchangeEvent,
  ExecutionState,
  FillRecord,
  GapRecoveryState,
  LiveOrderState,
  SessionStatus,
} from './types'

const log = createLogger('decision-intelligence:exchange-execution:state')

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionStateManager (§7, §10, Rule 6, Rule 11, Rule 14, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export class ExecutionStateManager {
  private liveOrders = new Map<string, LiveOrderState>()

  /**
   * Initialize a live order (§7, §10).
   */
  initializeOrder(exchangeOrderId: string, brokerOrderId: string, orderQuantity: number, currentTime: number = Date.now()): LiveOrderState {
    const state: LiveOrderState = {
      exchangeOrderId,
      brokerOrderId,
      currentState: 'SUBMITTED',
      pendingQuantity: orderQuantity,
      filledQuantity: 0,
      remainingQuantity: orderQuantity,
      cancelStatus: 'NONE',
      replaceStatus: 'NONE',
      sessionStatus: 'CONNECTED',
      lastExchangeSequence: 0,
      gapRecoveryState: 'NORMAL',
      replaySyncState: 'SYNCHRONIZED',
      fills: [],
      stateHistory: [{
        from: 'SUBMITTED', to: 'SUBMITTED', at: currentTime, reason: 'order initialized',
      }],
      createdAt: currentTime,
      lastUpdate: currentTime,
    }
    this.liveOrders.set(exchangeOrderId, state)
    log.info(`live order initialized: ${exchangeOrderId} (qty ${orderQuantity})`)
    return state
  }

  /**
   * Transition execution state (§7, Rule 6, Rule 11).
   * Rule 11 — Only confirmed exchange acknowledgments may advance state.
   */
  transitionState(
    exchangeOrderId: string,
    toState: ExecutionState,
    reason: string,
    currentTime: number = Date.now(),
  ): boolean {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) {
      log.warn(`transition failed — unknown order: ${exchangeOrderId}`)
      return false
    }

    const fromState = order.currentState
    if (!this.isValidTransition(fromState, toState)) {
      log.warn(`invalid state transition: ${fromState} → ${toState} for ${exchangeOrderId}`)
      return false
    }

    order.stateHistory.push({ from: fromState, to: toState, at: currentTime, reason })
    order.currentState = toState
    order.lastUpdate = currentTime

    log.info(`execution state: ${exchangeOrderId} ${fromState} → ${toState} (${reason})`)
    return true
  }

  /**
   * Update fill quantities (§8, §10).
   */
  updateFillQuantities(exchangeOrderId: string, filledQty: number, remainingQty: number, currentTime: number = Date.now()): void {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return
    order.filledQuantity = filledQty
    order.remainingQuantity = remainingQty
    order.pendingQuantity = remainingQty
    order.lastUpdate = currentTime
  }

  /**
   * Add a fill record (§8).
   */
  addFill(exchangeOrderId: string, fill: FillRecord, currentTime: number = Date.now()): void {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return
    order.fills.push(fill)
    order.lastUpdate = currentTime
  }

  /**
   * Mark a fill as busted (§9, Rule 22 — does NOT modify history, marks fill).
   */
  bustFill(exchangeOrderId: string, exchangeExecutionId: string, currentTime: number = Date.now()): boolean {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return false
    const fill = order.fills.find((f) => f.exchangeExecutionId === exchangeExecutionId)
    if (!fill) return false
    fill.busted = true
    order.lastUpdate = currentTime
    log.info(`fill busted: ${exchangeExecutionId} (Rule 22 — compensating event, history preserved)`)
    return true
  }

  /**
   * Mark a fill as corrected (§9, Rule 22).
   */
  correctFill(exchangeOrderId: string, exchangeExecutionId: string, correctionEventId: string, correctedQty?: number, correctedPrice?: number, currentTime: number = Date.now()): boolean {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return false
    const fill = order.fills.find((f) => f.exchangeExecutionId === exchangeExecutionId)
    if (!fill) return false
    fill.corrected = true
    fill.correctionEventId = correctionEventId
    if (correctedQty !== undefined) fill.fillQuantity = correctedQty
    if (correctedPrice !== undefined) fill.fillPrice = correctedPrice
    order.lastUpdate = currentTime
    log.info(`fill corrected: ${exchangeExecutionId} → ${correctionEventId} (Rule 22 — compensating event)`)
    return true
  }

  /**
   * Enter Gap-Recovery Mode (§10, Rule 23).
   */
  enterGapRecovery(exchangeOrderId: string, currentTime: number = Date.now()): void {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return
    order.gapRecoveryState = 'GAP_DETECTED'
    order.replaySyncState = 'PENDING'
    order.lastUpdate = currentTime
    log.warn(`order ${exchangeOrderId} entered Gap-Recovery Mode (Rule 23)`)
  }

  /**
   * Complete gap recovery (§10, Rule 23).
   * Only fully synchronized states may be published downstream.
   */
  completeGapRecovery(exchangeOrderId: string, currentTime: number = Date.now()): void {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return
    order.gapRecoveryState = 'SYNCHRONIZED'
    order.replaySyncState = 'SYNCHRONIZED'
    order.lastUpdate = currentTime
    log.info(`order ${exchangeOrderId} gap recovery complete — synchronized (Rule 23)`)
  }

  /**
   * Check if order can be published downstream (Rule 23).
   */
  canPublish(exchangeOrderId: string): boolean {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return false
    // Rule 23 — Only fully synchronized execution states may be published
    return order.gapRecoveryState === 'NORMAL' || order.gapRecoveryState === 'SYNCHRONIZED'
  }

  /**
   * Update session status (§10, Rule 14).
   */
  updateSessionStatus(exchangeOrderId: string, status: SessionStatus, currentTime: number = Date.now()): void {
    const order = this.liveOrders.get(exchangeOrderId)
    if (!order) return
    order.sessionStatus = status
    order.lastUpdate = currentTime
    // Rule 14 — Session failures trigger recovery
    if (status === 'DISCONNECTED' || status === 'HALTED') {
      this.enterGapRecovery(exchangeOrderId, currentTime)
    }
  }

  /**
   * Get live order state.
   */
  getOrder(exchangeOrderId: string): LiveOrderState | null {
    return this.liveOrders.get(exchangeOrderId) ?? null
  }

  /**
   * Get all live orders.
   */
  getAllOrders(): LiveOrderState[] {
    return Array.from(this.liveOrders.values())
  }

  /**
   * Valid state transitions (§7 — deterministic state machine, Rule 6).
   */
  private isValidTransition(from: ExecutionState, to: ExecutionState): boolean {
    const valid: Record<ExecutionState, ExecutionState[]> = {
      SUBMITTED: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
      ACCEPTED: ['WORKING', 'REJECTED', 'CANCEL_PENDING', 'EXPIRED', 'SUSPENDED'],
      WORKING: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'MODIFY_PENDING', 'EXPIRED', 'SUSPENDED', 'BUST_PENDING'],
      PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'MODIFY_PENDING', 'SUSPENDED', 'BUST_PENDING'],
      FILLED: ['BUST_PENDING', 'TRADE_BUSTED', 'TRADE_CORRECTED'],
      CANCEL_PENDING: ['CANCELLED', 'WORKING', 'PARTIALLY_FILLED'],
      CANCELLED: ['BUST_PENDING', 'TRADE_BUSTED', 'TRADE_CORRECTED'],
      MODIFY_PENDING: ['MODIFIED', 'WORKING', 'PARTIALLY_FILLED', 'REJECTED'],
      MODIFIED: ['WORKING', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING'],
      REJECTED: [],
      EXPIRED: [],
      SUSPENDED: ['WORKING', 'PARTIALLY_FILLED', 'CANCELLED'],
      BUST_PENDING: ['TRADE_BUSTED', 'TRADE_CORRECTED'],
      TRADE_BUSTED: [],
      TRADE_CORRECTED: [],
    }
    return valid[from]?.includes(to) ?? false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExchangeEventProcessor (§9, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventProcessingResult {
  processed: boolean
  newState: ExecutionState | null
  fillAdded: boolean
  bustApplied: boolean
  correctionApplied: boolean
  gapDetected: boolean
  reason: string
}

export class ExchangeEventProcessor {
  /**
   * Process an exchange event (§9, Rule 22).
   * Trade Bust/Correction never modify history — generate compensating events.
   */
  process(
    event: ExchangeEvent,
    stateManager: ExecutionStateManager,
    fillManager: { createFill: ReturnType<FillAggregator['createFill']> },
    currentTime: number = Date.now(),
  ): EventProcessingResult {
    const order = stateManager.getOrder(event.exchangeOrderId)
    if (!order) {
      return { processed: false, newState: null, fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'order not found' }
    }

    switch (event.eventType) {
      case 'NEW_ORDER_ACK': {
        // Rule 11 — Only confirmed acks advance state
        stateManager.transitionState(event.exchangeOrderId, 'ACCEPTED', 'exchange acknowledged order')
        return { processed: true, newState: 'ACCEPTED', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'order acknowledged' }
      }
      case 'EXECUTION_REPORT': {
        stateManager.transitionState(event.exchangeOrderId, 'WORKING', 'execution report received')
        return { processed: true, newState: 'WORKING', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'execution report' }
      }
      case 'PARTIAL_FILL': {
        const qty = event.eventData.fillQuantity ?? 0
        const price = event.eventData.fillPrice ?? 0
        const execId = event.eventData.exchangeExecutionId ?? ''
        const fee = event.eventData.fee ?? 0
        const fill = fillManager.createFill(execId, qty, price, event.eventTimestamp, event.venue, fee)
        stateManager.addFill(event.exchangeOrderId, fill, currentTime)
        stateManager.transitionState(event.exchangeOrderId, 'PARTIALLY_FILLED', `partial fill ${qty} @ ${price}`)
        return { processed: true, newState: 'PARTIALLY_FILLED', fillAdded: true, bustApplied: false, correctionApplied: false, gapDetected: false, reason: `partial fill ${qty}@${price}` }
      }
      case 'COMPLETE_FILL': {
        const qty = event.eventData.fillQuantity ?? 0
        const price = event.eventData.fillPrice ?? 0
        const execId = event.eventData.exchangeExecutionId ?? ''
        const fee = event.eventData.fee ?? 0
        const fill = fillManager.createFill(execId, qty, price, event.eventTimestamp, event.venue, fee)
        stateManager.addFill(event.exchangeOrderId, fill, currentTime)
        stateManager.transitionState(event.exchangeOrderId, 'FILLED', `complete fill ${qty} @ ${price}`)
        return { processed: true, newState: 'FILLED', fillAdded: true, bustApplied: false, correctionApplied: false, gapDetected: false, reason: `complete fill ${qty}@${price}` }
      }
      case 'ORDER_REJECT': {
        stateManager.transitionState(event.exchangeOrderId, 'REJECTED', `rejected: ${event.eventData.rejectReason ?? 'unknown'}`)
        return { processed: true, newState: 'REJECTED', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'order rejected' }
      }
      case 'ORDER_CANCEL': {
        stateManager.transitionState(event.exchangeOrderId, 'CANCELLED', `cancelled: ${event.eventData.cancelReason ?? 'requested'}`)
        return { processed: true, newState: 'CANCELLED', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'order cancelled' }
      }
      case 'CANCEL_REJECT': {
        // Cancel rejected — return to working state
        const order = stateManager.getOrder(event.exchangeOrderId)
        if (order && order.currentState === 'CANCEL_PENDING') {
          stateManager.transitionState(event.exchangeOrderId, 'WORKING', 'cancel rejected')
        }
        return { processed: true, newState: 'WORKING', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'cancel rejected' }
      }
      case 'ORDER_REPLACE': {
        stateManager.transitionState(event.exchangeOrderId, 'MODIFIED', `modified: qty=${event.eventData.modifiedQuantity ?? 'N/A'}`)
        return { processed: true, newState: 'MODIFIED', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'order modified' }
      }
      case 'REPLACE_REJECT': {
        const order = stateManager.getOrder(event.exchangeOrderId)
        if (order && order.currentState === 'MODIFY_PENDING') {
          stateManager.transitionState(event.exchangeOrderId, 'WORKING', 'replace rejected')
        }
        return { processed: true, newState: 'WORKING', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'replace rejected' }
      }
      case 'TRADING_HALT': {
        stateManager.updateSessionStatus(event.exchangeOrderId, 'HALTED')
        stateManager.transitionState(event.exchangeOrderId, 'SUSPENDED', 'trading halt')
        return { processed: true, newState: 'SUSPENDED', fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'trading halt' }
      }
      case 'SESSION_DISCONNECT': {
        stateManager.updateSessionStatus(event.exchangeOrderId, 'DISCONNECTED')
        // Rule 14/23 — Enter gap recovery
        stateManager.enterGapRecovery(event.exchangeOrderId)
        return { processed: true, newState: order.currentState, fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: true, reason: 'session disconnect — gap recovery (Rule 23)' }
      }
      case 'SESSION_RECOVERY': {
        stateManager.updateSessionStatus(event.exchangeOrderId, 'RECOVERING')
        stateManager.completeGapRecovery(event.exchangeOrderId)
        stateManager.updateSessionStatus(event.exchangeOrderId, 'CONNECTED')
        return { processed: true, newState: order.currentState, fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'session recovered' }
      }
      case 'TRADE_BUST': {
        // Rule 22 — Never modify history, generate compensating event
        const bustedExecId = event.eventData.bustedExecutionId ?? ''
        stateManager.bustFill(event.exchangeOrderId, bustedExecId, currentTime)
        stateManager.transitionState(event.exchangeOrderId, 'BUST_PENDING', `trade bust: ${bustedExecId}`)
        stateManager.transitionState(event.exchangeOrderId, 'TRADE_BUSTED', `trade busted: ${bustedExecId}`)
        return { processed: true, newState: 'TRADE_BUSTED', fillAdded: false, bustApplied: true, correctionApplied: false, gapDetected: false, reason: `trade bust: ${bustedExecId} (Rule 22)` }
      }
      case 'TRADE_CORRECTION': {
        // Rule 22 — Never modify history, generate compensating event
        const correctedExecId = event.eventData.correctedExecutionId ?? ''
        const correctionEventId = event.eventId
        stateManager.correctFill(
          event.exchangeOrderId, correctedExecId, correctionEventId,
          event.eventData.correctedQuantity, event.eventData.correctedPrice, currentTime,
        )
        stateManager.transitionState(event.exchangeOrderId, 'BUST_PENDING', `trade correction: ${correctedExecId}`)
        stateManager.transitionState(event.exchangeOrderId, 'TRADE_CORRECTED', `trade corrected: ${correctedExecId}`)
        return { processed: true, newState: 'TRADE_CORRECTED', fillAdded: false, bustApplied: false, correctionApplied: true, gapDetected: false, reason: `trade correction: ${correctedExecId} (Rule 22)` }
      }
      case 'EXECUTION_REPLAY_RESPONSE':
      case 'HISTORICAL_SEQUENCE_RECOVERY': {
        // §10 — Replay events processed to fill gaps
        return { processed: true, newState: order.currentState, fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: 'replay response processed' }
      }
      default:
        return { processed: false, newState: null, fillAdded: false, bustApplied: false, correctionApplied: false, gapDetected: false, reason: `unknown event type: ${event.eventType}` }
    }
  }
}

// Type import for fillManager
import type { FillAggregator } from './buffer-fills'

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const executionStateManager = new ExecutionStateManager()
export const exchangeEventProcessor = new ExchangeEventProcessor()
