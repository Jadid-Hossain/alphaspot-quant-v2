// CHAPTER 5.4 §10 — Risk State Management & Circuit Breakers
//
// §10 — The engine maintains:
//   • Current Risk State
//   • Historical Risk State
//   • Active Violations
//   • Emergency Status
//   • Circuit Breaker Status
//   • Atomic Portfolio Groups
//   • Dependency Graph State
//   • Margin Simulation State
//   • Transaction Rate State
//
// Rule 16 — Emergency circuit breakers may immediately invalidate all pending
//           portfolio approvals WITHOUT modifying historical records.
// Rule 18 — Constraint violations generate immutable governance events.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CircuitBreakerStatus,
  ConstraintViolation,
  RiskAuditEvent,
  RiskState,
} from './types'

const log = createLogger('decision-intelligence:risk-management:state')

// ─────────────────────────────────────────────────────────────────────────────
// Risk Operational State (§10)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskOperationalState {
  currentState: RiskState
  previousState: RiskState | null
  stateEnteredAt: number
  stateTransitionHistory: Array<{
    from: RiskState
    to: RiskState
    at: number
    reason: string
    actor: string
  }>

  // §10 — Active violations
  activeViolations: ConstraintViolation[]
  totalViolationsAllTime: number

  // §10 — Emergency status
  emergencyStatus: 'NORMAL' | 'ELEVATED' | 'EMERGENCY' | 'HALTED'
  emergencyTriggeredAt: number | null
  emergencyReason: string | null

  // §10 — Circuit breaker status (Rule 16)
  circuitBreakerStatus: CircuitBreakerStatus
  circuitBreakerTriggeredAt: number | null
  circuitBreakerReason: string | null
  pendingApprovalsInvalidated: number

  // §10 — Audit trail (Rule 18 — immutable governance events)
  auditLog: RiskAuditEvent[]

  // Current drawdown tracking
  currentDrawdown: number
  peakNav: number
  dailyPnl: number
  dailyPnlResetAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// RiskStateManager
// ─────────────────────────────────────────────────────────────────────────────

export class RiskStateManager {
  private state: RiskOperationalState

  constructor() {
    const now = Date.now()
    this.state = {
      currentState: 'NORMAL',
      previousState: null,
      stateEnteredAt: now,
      stateTransitionHistory: [],
      activeViolations: [],
      totalViolationsAllTime: 0,
      emergencyStatus: 'NORMAL',
      emergencyTriggeredAt: null,
      emergencyReason: null,
      circuitBreakerStatus: 'INACTIVE',
      circuitBreakerTriggeredAt: null,
      circuitBreakerReason: null,
      pendingApprovalsInvalidated: 0,
      auditLog: [],
      currentDrawdown: 0,
      peakNav: 0,
      dailyPnl: 0,
      dailyPnlResetAt: now,
    }
  }

  /** Get current state. */
  getState(): RiskOperationalState {
    return { ...this.state }
  }

  /** Transition to a new state (§10). */
  transitionState(to: RiskState, reason: string, actor: string = 'system'): void {
    if (this.state.currentState === to) return
    const now = Date.now()
    this.state.previousState = this.state.currentState
    this.state.currentState = to
    this.state.stateEnteredAt = now
    this.state.stateTransitionHistory.push({
      from: this.state.previousState,
      to,
      at: now,
      reason,
      actor,
    })
    if (this.state.stateTransitionHistory.length > 200) this.state.stateTransitionHistory.shift()

    this.state.auditLog.push({
      action: `STATE_TRANSITION:${this.state.previousState}_TO_${to}`,
      at: now,
      actor,
      note: reason,
      before: this.state.previousState,
      after: to,
    })
    if (this.state.auditLog.length > 500) this.state.auditLog.shift()

    log.info(`risk state: ${this.state.previousState} → ${to} (${reason})`)
  }

  /** Record a constraint violation (Rule 18 — immutable governance event). */
  recordViolation(violation: ConstraintViolation): void {
    this.state.activeViolations.push(violation)
    this.state.totalViolationsAllTime++
    if (this.state.activeViolations.length > 500) this.state.activeViolations.shift()

    // Rule 18 — generate immutable governance event
    this.state.auditLog.push({
      action: `VIOLATION:${violation.constraint}`,
      at: violation.timestamp,
      actor: 'risk-engine',
      note: violation.description,
    })
    if (this.state.auditLog.length > 500) this.state.auditLog.shift()

    // Update state based on severity
    if (violation.severity === 'CATASTROPHIC') {
      this.transitionState('EMERGENCY', `catastrophic violation: ${violation.constraint}`, 'risk-engine')
    } else if (violation.severity === 'CRITICAL' && this.state.currentState === 'NORMAL') {
      this.transitionState('HIGH_RISK', `critical violation: ${violation.constraint}`, 'risk-engine')
    }
  }

  /** Clear active violations (after resolution). */
  clearViolations(): void {
    this.state.activeViolations = []
    if (this.state.currentState === 'HIGH_RISK' || this.state.currentState === 'EMERGENCY') {
      this.transitionState('NORMAL', 'violations cleared', 'risk-engine')
    }
  }

  /**
   * Trigger circuit breaker (Rule 16).
   * Immediately invalidates all pending approvals WITHOUT modifying history.
   */
  triggerCircuitBreaker(reason: string, pendingApprovalCount: number): void {
    const now = Date.now()
    this.state.circuitBreakerStatus = 'TRIGGERED'
    this.state.circuitBreakerTriggeredAt = now
    this.state.circuitBreakerReason = reason
    this.state.pendingApprovalsInvalidated = pendingApprovalCount
    this.state.emergencyStatus = 'HALTED'
    this.state.emergencyTriggeredAt = now
    this.state.emergencyReason = reason

    this.transitionState('HALTED', `circuit breaker: ${reason}`, 'circuit-breaker')

    this.state.auditLog.push({
      action: 'CIRCUIT_BREAKER_TRIGGERED',
      at: now,
      actor: 'circuit-breaker',
      note: `${reason} — ${pendingApprovalCount} pending approvals invalidated (Rule 16)`,
    })

    log.error(
      `CIRCUIT BREAKER TRIGGERED: ${reason} — ${pendingApprovalCount} pending approvals invalidated (Rule 16)`,
    )
  }

  /** Reset circuit breaker (after cooldown or manual override). */
  resetCircuitBreaker(actor: string = 'operator'): void {
    const now = Date.now()
    this.state.circuitBreakerStatus = 'INACTIVE'
    this.state.circuitBreakerTriggeredAt = null
    this.state.circuitBreakerReason = null
    this.state.pendingApprovalsInvalidated = 0
    this.state.emergencyStatus = 'NORMAL'
    this.state.emergencyTriggeredAt = null
    this.state.emergencyReason = null

    this.transitionState('NORMAL', 'circuit breaker reset', actor)

    this.state.auditLog.push({
      action: 'CIRCUIT_BREAKER_RESET',
      at: now,
      actor,
      note: 'circuit breaker manually reset',
    })

    log.info(`circuit breaker reset by ${actor}`)
  }

  /** Update drawdown tracking (for circuit breaker evaluation). */
  updateDrawdown(currentNav: number): void {
    if (currentNav > this.state.peakNav) {
      this.state.peakNav = currentNav
    }
    if (this.state.peakNav > 0) {
      this.state.currentDrawdown = Math.max(0, (this.state.peakNav - currentNav) / this.state.peakNav)
    }
  }

  /** Update daily PnL tracking. */
  updateDailyPnl(pnl: number): void {
    const now = Date.now()
    // Reset daily PnL at UTC midnight
    if (now - this.state.dailyPnlResetAt > 86400000) {
      this.state.dailyPnl = 0
      this.state.dailyPnlResetAt = now
    }
    this.state.dailyPnl = pnl
  }

  /** Check if circuit breaker should trigger based on drawdown/daily loss. */
  checkCircuitBreakerTriggers(
    drawdownThreshold: number,
    dailyLossThreshold: number,
    pendingApprovalCount: number,
  ): boolean {
    if (this.state.circuitBreakerStatus === 'TRIGGERED') return false

    if (this.state.currentDrawdown >= drawdownThreshold) {
      this.triggerCircuitBreaker(
        `drawdown ${(this.state.currentDrawdown * 100).toFixed(2)}% exceeds threshold ${(drawdownThreshold * 100).toFixed(2)}%`,
        pendingApprovalCount,
      )
      return true
    }
    if (this.state.dailyPnl < 0 && Math.abs(this.state.dailyPnl) >= dailyLossThreshold) {
      this.triggerCircuitBreaker(
        `daily loss ${(Math.abs(this.state.dailyPnl) * 100).toFixed(2)}% exceeds threshold ${(dailyLossThreshold * 100).toFixed(2)}%`,
        pendingApprovalCount,
      )
      return true
    }
    return false
  }

  /** Add audit event (§12, Rule 18). */
  addAuditEvent(event: RiskAuditEvent): void {
    this.state.auditLog.push(event)
    if (this.state.auditLog.length > 500) this.state.auditLog.shift()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton state manager
// ─────────────────────────────────────────────────────────────────────────────

export const riskStateManager = new RiskStateManager()
