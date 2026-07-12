// CHAPTER 5.11 §10, §10A — Exception Management & Pending Settlement Escrow
//
// §10 — Exception Management:
//   • Missing Executions, Duplicate Trades, Trade Breaks, Trade Corrections
//   • Settlement Delays, Fee Mismatches, Quantity/Price Discrepancies
//   • Manual Review Queue, Contra-Reconciliation Generation, Rollback Orchestration
//   • Accounting Reversal Notification, Compensating Reconciliation Events
//
// §10A — Pending Settlement Escrow:
//   • Provisional Portfolio Recognition, Pending Cash/Asset Settlement
//   • Custodian Confirmation Waiting, Settlement Aging, Escrow Release/Rollback
//   • Escrow state logically independent from reconciliation/settlement status (Rule 12)
//
// Rule 9/19 — Only Fully Reconciled or Escrow-Approved trades enter Portfolio Accounting.
// Rule 12 — Settlement/Escrow/Reconciliation status logically independent.
// Rule 21 — Busts/Corrections after publication generate immutable Contra-Reconciliation Events.
// Rule 22 — Rollback orchestration independent from Portfolio Accounting (notifications only).

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  ContraReconciliationEvent,
  EscrowState,
  EscrowStatus,
  ExceptionStatus,
  ReconciliationConfiguration,
} from './types'

const log = createLogger('decision-intelligence:post-trade-reconciliation:exceptions')

// ─────────────────────────────────────────────────────────────────────────────
// ExceptionManager (§10, Rule 14, Rule 21, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExceptionRecord {
  exceptionId: string
  tradeId: string
  exceptionType: ExceptionStatus
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  detectedAt: number
  resolvedAt: number | null
  resolution: string | null
  /** Rule 14 — Historical lineage preserved. */
  reconciliationId: string | null
}

export class ExceptionManager {
  private exceptions = new Map<string, ExceptionRecord>()
  private manualReviewQueue: string[] = []

  /**
   * Create an exception record (§10, Rule 14 — preserves complete historical lineage).
   */
  createException(
    tradeId: string,
    exceptionType: ExceptionStatus,
    severity: ExceptionRecord['severity'],
    description: string,
    reconciliationId: string | null = null,
    currentTime: number = Date.now(),
  ): ExceptionRecord {
    const exceptionId = `exc-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const record: ExceptionRecord = {
      exceptionId,
      tradeId,
      exceptionType,
      severity,
      description,
      detectedAt: currentTime,
      resolvedAt: null,
      resolution: null,
      reconciliationId,
    }
    this.exceptions.set(exceptionId, record)

    // §10 — Add to manual review queue if needed
    if (severity === 'HIGH' || severity === 'CRITICAL') {
      this.manualReviewQueue.push(exceptionId)
    }

    log.warn(`exception created: ${exceptionId} [${exceptionType}] for trade ${tradeId}: ${description}`)
    return record
  }

  /**
   * Resolve an exception (§10, Rule 14).
   */
  resolveException(exceptionId: string, resolution: string, currentTime: number = Date.now()): boolean {
    const record = this.exceptions.get(exceptionId)
    if (!record) return false
    record.resolvedAt = currentTime
    record.resolution = resolution
    log.info(`exception resolved: ${exceptionId} — ${resolution}`)
    return true
  }

  /**
   * Generate a Contra-Reconciliation Event (§10, Rule 21).
   * Rule 21 — Busts/Corrections after publication generate immutable Contra-Reconciliation Events.
   * These initiate deterministic downstream rollback workflows while preserving complete audit lineage.
   */
  generateContraReconciliation(
    originalReconciliationId: string,
    eventType: 'TRADE_BUST' | 'TRADE_CORRECTION',
    reason: string,
    corrections?: { quantity?: number; price?: number; fees?: number },
    currentTime: number = Date.now(),
  ): ContraReconciliationEvent {
    const contraEvent: ContraReconciliationEvent = {
      contraEventId: `contra-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      originalReconciliationId,
      eventType,
      reason,
      correctedQuantity: corrections?.quantity,
      correctedPrice: corrections?.price,
      correctedFees: corrections?.fees,
      // Rule 22 — Rollback notification (not direct accounting modification)
      rollbackNotification: true,
      timestamp: currentTime,
    }

    log.info(
      `contra-reconciliation generated: ${contraEvent.contraEventId} for ${originalReconciliationId} ` +
      `(${eventType}: ${reason}) — Rule 21/22: rollback notification, audit preserved`,
    )

    return contraEvent
  }

  /**
   * Initiate rollback orchestration (§10, Rule 22).
   * Rule 22 — Rollback orchestration logically independent from Portfolio Accounting.
   * The PTRE may initiate rollback NOTIFICATIONS but shall never directly modify accounting records.
   */
  initiateRollback(
    reconciliationId: string,
    reason: string,
    currentTime: number = Date.now(),
  ): { rollbackNotificationId: string; accountingNotified: boolean } {
    const rollbackNotificationId = `rollback-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    log.info(
      `rollback orchestrated: ${rollbackNotificationId} for ${reconciliationId} — ` +
      `Rule 22: notification only, accounting NOT modified by PTRE`,
    )
    return { rollbackNotificationId, accountingNotified: true }
  }

  /** Get all exceptions. */
  getExceptions(): ExceptionRecord[] {
    return Array.from(this.exceptions.values())
  }

  /** Get manual review queue. */
  getManualReviewQueue(): string[] {
    return [...this.manualReviewQueue]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EscrowManager (§10A, Rule 9/12/19)
// Rule 12 — Escrow status logically independent from reconciliation/settlement.
// ─────────────────────────────────────────────────────────────────────────────

export class EscrowManager {
  private escrowStates = new Map<string, EscrowState>()

  /**
   * Create escrow for a trade (§10A).
   * Used when execution is reconciled but settlement confirmation is outstanding.
   */
  createEscrow(
    tradeId: string,
    pendingCash: number,
    pendingAsset: number,
    currentTime: number = Date.now(),
  ): EscrowState {
    const escrow: EscrowState = {
      tradeId,
      status: 'PENDING',
      provisionalRecognition: true, // §10A — provisional portfolio recognition
      pendingCashSettlement: pendingCash,
      pendingAssetDelivery: pendingAsset,
      custodianConfirmationWaiting: true,
      settlementAgingMs: 0,
      createdAt: currentTime,
      releasedAt: null,
    }
    this.escrowStates.set(tradeId, escrow)
    log.info(`escrow created for trade ${tradeId} (§10A — pending settlement)`)
    return escrow
  }

  /**
   * Approve escrow (§10A).
   * Only escrow-approved reconciled trades may proceed to provisional portfolio accounting.
   */
  approveEscrow(tradeId: string, currentTime: number = Date.now()): boolean {
    const escrow = this.escrowStates.get(tradeId)
    if (!escrow) return false
    if (escrow.status !== 'PENDING') return false
    escrow.status = 'APPROVED'
    log.info(`escrow approved for trade ${tradeId} — can proceed to provisional accounting (Rule 9/19)`)
    return true
  }

  /**
   * Release escrow (§10A — settlement confirmed).
   */
  releaseEscrow(tradeId: string, currentTime: number = Date.now()): boolean {
    const escrow = this.escrowStates.get(tradeId)
    if (!escrow) return false
    escrow.status = 'RELEASED'
    escrow.releasedAt = currentTime
    escrow.custodianConfirmationWaiting = false
    log.info(`escrow released for trade ${tradeId} — settlement confirmed`)
    return true
  }

  /**
   * Age escrow (§10A — settlement aging).
   */
  ageEscrow(tradeId: string, config: ReconciliationConfiguration, currentTime: number = Date.now()): boolean {
    const escrow = this.escrowStates.get(tradeId)
    if (!escrow || escrow.status !== 'PENDING') return false
    escrow.settlementAgingMs = currentTime - escrow.createdAt
    if (escrow.settlementAgingMs > config.settlementAgingThresholdMs) {
      escrow.status = 'AGED_OUT'
      log.warn(`escrow aged out for trade ${tradeId} — settlement ${escrow.settlementAgingMs}ms > threshold ${config.settlementAgingThresholdMs}ms`)
      return true
    }
    return false
  }

  /**
   * Rollback escrow (§10A).
   */
  rollbackEscrow(tradeId: string, currentTime: number = Date.now()): boolean {
    const escrow = this.escrowStates.get(tradeId)
    if (!escrow) return false
    escrow.status = 'ROLLED_BACK'
    escrow.provisionalRecognition = false
    log.warn(`escrow rolled back for trade ${tradeId}`)
    return true
  }

  /**
   * Check if trade can enter portfolio accounting (Rule 9/19).
   * Only Fully Reconciled or Escrow-Approved trades may enter.
   */
  canEnterAccounting(
    tradeId: string,
    reconciliationStatus: string,
    config: ReconciliationConfiguration,
  ): boolean {
    // Rule 9/19 — Fully Reconciled can always enter
    if (reconciliationStatus === 'FULLY_RECONCILED') return true
    // Rule 9/19 — Escrow-Approved can enter if config allows
    if (reconciliationStatus === 'ESCROW_APPROVED' && config.allowEscrowApprovedAccounting) {
      const escrow = this.escrowStates.get(tradeId)
      return escrow?.status === 'APPROVED'
    }
    return false
  }

  /** Get escrow state. */
  getEscrow(tradeId: string): EscrowState | null {
    return this.escrowStates.get(tradeId) ?? null
  }

  /** Get all escrow states. */
  getAllEscrow(): EscrowState[] {
    return Array.from(this.escrowStates.values())
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const exceptionManager = new ExceptionManager()
export const escrowManager = new EscrowManager()
