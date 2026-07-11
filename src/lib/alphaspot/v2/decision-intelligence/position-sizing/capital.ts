// CHAPTER 5.5 §8 — Capital Management
//
// §8 — Capital Management supports:
//   • Capital Reservation
//   • Available Capital Verification
//   • Dynamic Capital Allocation
//   • Strategy Capital Budgets
//   • Portfolio Capital Limits
//   • Cash Buffer Management
//   • Margin Allocation
//   • Capital Utilization Monitoring
//   • Atomic Capital Locking
//   • Capital Reservation Transactions
//   • Reservation Timeout Management
//   • Reservation Rollback
//
// Rule 13 — Capital reservation shall occur BEFORE position publication.
// Rule 17 — Capital reserved for pending positions shall NOT be simultaneously
//           allocated to additional positions until released or executed.
// Rule 21 — Atomic capital reservation lock BEFORE any sizing calculation.
//           Concurrent sizing requests shall never allocate identical capital.
// Rule 24 — Capital reservations are transactional. If position generation,
//           validation, or publication fails, all temporary reservations shall
//           be automatically rolled back.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CapitalReservation,
  CapitalReservationStatus,
  CapitalState,
} from './types'

const log = createLogger('decision-intelligence:position-sizing:capital')

// ─────────────────────────────────────────────────────────────────────────────
// CapitalManager — manages capital reservations with atomic locking (§8)
// ─────────────────────────────────────────────────────────────────────────────

export class CapitalManager {
  private state: CapitalState
  /** Atomic lock holders (ownerId → reservationId). Rule 21. */
  private atomicLocks = new Map<string, string>()
  /** Reservation timeout interval (ms). */
  private reservationTimeoutMs: number

  constructor(totalCapital: number, reservationTimeoutMs: number = 30000) {
    this.reservationTimeoutMs = reservationTimeoutMs
    this.state = {
      totalCapital,
      availableCapital: totalCapital,
      totalReserved: 0,
      cashBuffer: totalCapital * 0.05,
      reservations: [],
      strategyBudgets: {},
      strategyAllocated: {},
    }
  }

  /**
   * Acquire atomic capital lock (Rule 21).
   * Must be acquired BEFORE any sizing calculation begins.
   * Concurrent sizing requests for the same ownerId shall never allocate identical capital.
   */
  acquireAtomicLock(ownerId: string, currentTime: number = Date.now()): string | null {
    if (this.atomicLocks.has(ownerId)) {
      log.warn(`atomic lock already held for ${ownerId} — Rule 21 violation prevented`)
      return null
    }
    const lockId = `lock-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    this.atomicLocks.set(ownerId, lockId)
    log.debug(`atomic lock acquired: ${lockId} for ${ownerId}`)
    return lockId
  }

  /**
   * Release atomic lock (Rule 21).
   * Called after position publication or on failure.
   */
  releaseAtomicLock(ownerId: string): void {
    const lockId = this.atomicLocks.get(ownerId)
    if (lockId) {
      this.atomicLocks.delete(ownerId)
      log.debug(`atomic lock released: ${lockId} for ${ownerId}`)
    }
  }

  /**
   * Create capital reservation (§8, Rule 13, Rule 17).
   * Reserved capital cannot be simultaneously allocated to additional positions.
   */
  reserveCapital(
    ownerId: string,
    amount: number,
    reason: string,
    atomicLockId: string | null,
    currentTime: number = Date.now(),
  ): CapitalReservation | null {
    // Verify atomic lock held (Rule 21)
    if (atomicLockId !== null) {
      const heldLock = this.atomicLocks.get(ownerId)
      if (heldLock !== atomicLockId) {
        log.warn(`cannot reserve capital for ${ownerId} — atomic lock not held`)
        return null
      }
    }

    // Rule 17 — Check available capital (excluding already-reserved)
    const available = this.state.availableCapital - this.state.cashBuffer
    if (amount > available) {
      log.warn(
        `insufficient capital for ${ownerId}: requested ${amount}, available ${available} ` +
        `(total ${this.state.totalCapital}, reserved ${this.state.totalReserved}, buffer ${this.state.cashBuffer})`,
      )
      return null
    }

    const reservation: CapitalReservation = {
      reservationId: `resv-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId,
      amount,
      reservedAt: currentTime,
      expiresAt: currentTime + this.reservationTimeoutMs,
      status: 'RESERVED',
      reason,
      atomicLock: atomicLockId !== null,
    }

    this.state.reservations.push(reservation)
    this.state.totalReserved += amount
    this.state.availableCapital -= amount

    // Track per-strategy allocation
    this.state.strategyAllocated[ownerId] = (this.state.strategyAllocated[ownerId] ?? 0) + amount

    log.info(
      `capital reserved: ${reservation.reservationId} for ${ownerId} — amount ${amount} ` +
      `(available ${this.state.availableCapital}, reserved ${this.state.totalReserved})`,
    )

    return reservation
  }

  /**
   * Commit capital reservation (§8, Rule 13).
   * Called at position publication — converts RESERVED to COMMITTED.
   */
  commitReservation(reservationId: string, currentTime: number = Date.now()): boolean {
    const reservation = this.state.reservations.find((r) => r.reservationId === reservationId)
    if (!reservation) {
      log.warn(`cannot commit — reservation ${reservationId} not found`)
      return false
    }
    if (reservation.status !== 'RESERVED') {
      log.warn(`cannot commit — reservation ${reservationId} status is ${reservation.status}`)
      return false
    }
    reservation.status = 'COMMITTED'
    log.info(`capital reservation committed: ${reservationId} (Rule 13 — at position publication)`)
    return true
  }

  /**
   * Release capital reservation (§8).
   * Called when position is executed or expired.
   */
  releaseReservation(reservationId: string, currentTime: number = Date.now()): boolean {
    const reservation = this.state.reservations.find((r) => r.reservationId === reservationId)
    if (!reservation) return false

    if (reservation.status === 'RELEASED' || reservation.status === 'ROLLED_BACK') {
      return true // already released
    }

    const amount = reservation.amount
    this.state.availableCapital += amount
    this.state.totalReserved -= amount
    reservation.status = 'RELEASED'

    // Update per-strategy allocation
    this.state.strategyAllocated[reservation.ownerId] = Math.max(
      0,
      (this.state.strategyAllocated[reservation.ownerId] ?? 0) - amount,
    )

    log.info(`capital reservation released: ${reservationId} — ${amount} returned to available`)
    return true
  }

  /**
   * Rollback capital reservation (§8, Rule 24).
   * Called on position generation/validation/publication failure.
   * All temporary reservations are automatically rolled back.
   */
  rollbackReservation(reservationId: string, reason: string, currentTime: number = Date.now()): boolean {
    const reservation = this.state.reservations.find((r) => r.reservationId === reservationId)
    if (!reservation) return false

    const amount = reservation.amount
    this.state.availableCapital += amount
    this.state.totalReserved -= amount
    reservation.status = 'ROLLED_BACK'

    // Update per-strategy allocation
    this.state.strategyAllocated[reservation.ownerId] = Math.max(
      0,
      (this.state.strategyAllocated[reservation.ownerId] ?? 0) - amount,
    )

    log.warn(`capital reservation ROLLED BACK: ${reservationId} — ${amount} returned (Rule 24: ${reason})`)
    return true
  }

  /**
   * Process reservation timeouts (§8 — Reservation Timeout Management).
   * Reservations that have expired are automatically rolled back.
   */
  processTimeouts(currentTime: number = Date.now()): number {
    let timeoutCount = 0
    for (const reservation of this.state.reservations) {
      if (reservation.status === 'RESERVED' && currentTime > reservation.expiresAt) {
        this.rollbackReservation(reservation.reservationId, 'reservation timeout')
        reservation.status = 'TIMEOUT'
        timeoutCount++
      }
    }
    if (timeoutCount > 0) {
      log.info(`processed ${timeoutCount} reservation timeouts`)
    }
    return timeoutCount
  }

  /** Get current capital state. */
  getState(): CapitalState {
    return { ...this.state }
  }

  /** Set strategy capital budget (§8). */
  setStrategyBudget(strategyId: string, budget: number): void {
    this.state.strategyBudgets[strategyId] = budget
  }

  /** Check if a strategy has remaining budget (§8). */
  hasStrategyBudget(strategyId: string, amount: number): boolean {
    const budget = this.state.strategyBudgets[strategyId]
    if (budget === undefined) return true // no budget = unlimited
    const allocated = this.state.strategyAllocated[strategyId] ?? 0
    return allocated + amount <= budget
  }

  /** Get capital utilization (0..1). */
  getUtilization(): number {
    return this.state.totalCapital > 0 ? this.state.totalReserved / this.state.totalCapital : 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton capital manager (initialized with default capital)
// ─────────────────────────────────────────────────────────────────────────────

let capitalManagerInstance: CapitalManager | null = null

export function initializeCapitalManager(totalCapital: number, reservationTimeoutMs: number = 30000): CapitalManager {
  capitalManagerInstance = new CapitalManager(totalCapital, reservationTimeoutMs)
  return capitalManagerInstance
}

export function getCapitalManager(): CapitalManager {
  if (!capitalManagerInstance) {
    capitalManagerInstance = new CapitalManager(1000000, 30000)
  }
  return capitalManagerInstance
}
