// CHAPTER 5.2 §10 — Strategy State Manager
//
// Manages strategy operational state (§10). State transitions are deterministic
// and fully version controlled (Rule 8, Rule 18). Cooldown policies are
// configurable (Rule 19). Cooldown expiration NEVER resets historical stats
// (Rule 19).
//
// States: ACTIVE / COOLDOWN / SUSPENDED / RECOVERY / OBSERVATION / RETIRED
//
// Cooldown triggers (§10):
//   • Consecutive Loss Threshold
//   • Drawdown Threshold
//   • Risk Governance Events
//   • Manual Governance Actions
//
// Rule 7 — Strategies never modify each other's state.
// Rule 8 — State transitions deterministic.
// Rule 18 — State transitions fully auditable + version controlled.
// Rule 19 — Cooldown expiration NEVER resets historical stats.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CooldownTrigger,
  StrategyDefinition,
  StrategyOperationalState,
  StrategyState,
  StrategyStateTransition,
  StrategyAuditEvent,
} from './types'

const log = createLogger('decision-intelligence:strategy-engine:state-manager')

// ─────────────────────────────────────────────────────────────────────────────
// StrategyStateManager
// ─────────────────────────────────────────────────────────────────────────────

export class StrategyStateManager {
  private states = new Map<string, StrategyOperationalState>()
  private definitions = new Map<string, StrategyDefinition>()

  /** Register a strategy definition (§11 — versioned). */
  registerStrategy(definition: StrategyDefinition): void {
    this.definitions.set(definition.strategyId, definition)
    if (!this.states.has(definition.strategyId)) {
      this.states.set(definition.strategyId, this.createInitialState(definition))
      log.info(`strategy ${definition.strategyId} registered — state ${definition.observationMode ? 'OBSERVATION' : 'ACTIVE'}`)
    }
  }

  /** Get the operational state for a strategy. */
  getState(strategyId: string): StrategyOperationalState | null {
    return this.states.get(strategyId) ?? null
  }

  /** Get the definition for a strategy. */
  getDefinition(strategyId: string): StrategyDefinition | null {
    return this.definitions.get(strategyId) ?? null
  }

  /**
   * Check if a strategy is operationally available for new decisions (§10).
   * A strategy is available only in ACTIVE or OBSERVATION or RECOVERY states.
   */
  isAvailable(strategyId: string, currentTime: number = Date.now()): boolean {
    const state = this.states.get(strategyId)
    if (!state) return false

    // Update cooldown timers before checking
    this.tickCooldown(strategyId, currentTime)

    return (
      state.currentState === 'ACTIVE' ||
      state.currentState === 'OBSERVATION' ||
      state.currentState === 'RECOVERY'
    )
  }

  /**
   * Record a decision outcome (win/loss) — drives cooldown evaluation (§10).
   * Updates consecutive win/loss counters and drawdown. Triggers cooldown if
   * thresholds are crossed (Rule 19 — configurable activation criteria).
   */
  recordOutcome(
    strategyId: string,
    outcome: 'WIN' | 'LOSS' | 'NEUTRAL',
    performanceScore: number, // 0..1
    currentTime: number = Date.now(),
  ): void {
    const state = this.states.get(strategyId)
    const def = this.definitions.get(strategyId)
    if (!state || !def) return

    state.totalDecisions++

    if (outcome === 'WIN') {
      state.consecutiveWins++
      state.consecutiveLosses = 0
      state.totalWins++
    } else if (outcome === 'LOSS') {
      state.consecutiveLosses++
      state.consecutiveWins = 0
      state.totalLosses++
    } else {
      // NEUTRAL — does not break streaks but doesn't extend them either
    }

    // Drawdown tracking (peak-relative)
    if (performanceScore > state.peakPerformanceScore) {
      state.peakPerformanceScore = performanceScore
    } else if (state.peakPerformanceScore > 0) {
      state.drawdownState = Math.max(
        0,
        (state.peakPerformanceScore - performanceScore) / state.peakPerformanceScore,
      )
    }

    // Cooldown evaluation (§10, Rule 19)
    if (def.cooldownPolicy.enabled && state.currentState === 'ACTIVE') {
      this.evaluateCooldownTriggers(strategyId, currentTime)
    }
  }

  /** Mark a decision accepted/rejected (for acceptance rate stats). */
  recordDecisionDisposition(strategyId: string, accepted: boolean): void {
    const state = this.states.get(strategyId)
    if (!state) return
    if (accepted) state.totalAccepted++
    else state.totalRejected++
  }

  /** Track active signals being evaluated by a strategy (§10). */
  addActiveSignal(strategyId: string, signalId: string): void {
    const state = this.states.get(strategyId)
    if (!state) return
    if (!state.activeSignals.includes(signalId)) {
      state.activeSignals.push(signalId)
    }
  }

  /** Remove an active signal from tracking (§10). */
  removeActiveSignal(strategyId: string, signalId: string): void {
    const state = this.states.get(strategyId)
    if (!state) return
    state.activeSignals = state.activeSignals.filter((s) => s !== signalId)
  }

  /** Record last decision ID for the strategy. */
  recordDecision(strategyId: string, decisionId: string, at: number): void {
    const state = this.states.get(strategyId)
    if (!state) return
    state.lastDecisionId = decisionId
    state.lastDecisionAt = at
  }

  /**
   * Transition a strategy to a new state (Rule 8 — deterministic, Rule 18 — auditable).
   * Returns true if the transition was valid + applied, false otherwise.
   */
  transitionState(
    strategyId: string,
    toState: StrategyState,
    reason: string,
    actor: string,
    trigger: StrategyStateTransition['trigger'],
    currentTime: number = Date.now(),
  ): boolean {
    const state = this.states.get(strategyId)
    if (!state) return false

    if (!this.isValidTransition(state.currentState, toState)) {
      log.warn(`invalid transition for ${strategyId}: ${state.currentState} → ${toState} — rejected`)
      return false
    }

    const transition: StrategyStateTransition = {
      from: state.currentState,
      to: toState,
      at: currentTime,
      reason,
      actor,
      trigger,
    }

    const auditEvent: StrategyAuditEvent = {
      action: `STATE_TRANSITION:${state.currentState}_TO_${toState}`,
      at: currentTime,
      actor,
      note: reason,
      before: state.currentState,
      after: toState,
    }

    state.previousState = state.currentState
    state.currentState = toState
    state.stateEnteredAt = currentTime
    state.stateTransitionHistory.push(transition)
    state.auditLog.push(auditEvent)

    // Cap history size
    if (state.stateTransitionHistory.length > 200) state.stateTransitionHistory.shift()
    if (state.auditLog.length > 500) state.auditLog.shift()

    log.info(`strategy ${strategyId}: ${state.previousState} → ${toState} (${trigger}: ${reason})`)
    return true
  }

  /**
   * Trigger cooldown on a strategy (§10).
   * Used by the engine when consecutive loss/drawdown thresholds are crossed,
   * or by governance for manual/risk events.
   */
  triggerCooldown(
    strategyId: string,
    trigger: CooldownTrigger,
    reason: string,
    currentTime: number = Date.now(),
  ): void {
    const state = this.states.get(strategyId)
    const def = this.definitions.get(strategyId)
    if (!state || !def) return

    if (!def.cooldownPolicy.enabled) {
      log.debug(`strategy ${strategyId} cooldown disabled — trigger ignored`)
      return
    }

    state.cooldownStatus = 'IN_COOLDOWN'
    state.cooldownStartedAt = currentTime
    state.cooldownRemaining = def.cooldownPolicy.cooldownDurationMs
    state.cooldownReason = reason
    state.cooldownTrigger = trigger

    // Transition to COOLDOWN state
    this.transitionState(strategyId, 'COOLDOWN', reason, 'state-manager', 'AUTOMATIC', currentTime)
  }

  /**
   * Tick cooldown timer for a strategy (§10, Rule 19).
   * When cooldown expires, transition to RECOVERY (per recoveryMode) — but NEVER
   * reset historical stats (Rule 19).
   */
  tickCooldown(strategyId: string, currentTime: number = Date.now()): void {
    const state = this.states.get(strategyId)
    const def = this.definitions.get(strategyId)
    if (!state || !def) return
    if (state.currentState !== 'COOLDOWN' || state.cooldownStartedAt === null) return

    const elapsed = currentTime - state.cooldownStartedAt
    const remaining = Math.max(0, def.cooldownPolicy.cooldownDurationMs - elapsed)
    state.cooldownRemaining = remaining

    if (remaining <= 0) {
      // Cooldown expired — transition based on recovery mode (§10)
      // Rule 19 — NEVER auto-reset historical stats
      const previousConsecutiveWins = state.consecutiveWins
      const previousConsecutiveLosses = state.consecutiveLosses
      const previousPeak = state.peakPerformanceScore

      const recoveryMode = def.cooldownPolicy.recoveryMode
      let targetState: StrategyState
      switch (recoveryMode) {
        case 'IMMEDIATE':
          targetState = 'ACTIVE'
          break
        case 'STAGED':
          targetState = 'RECOVERY'
          break
        case 'OBSERVATION_FIRST':
          targetState = 'OBSERVATION'
          break
      }

      // Clear cooldown metadata but PRESERVE historical stats (Rule 19)
      state.cooldownStatus = recoveryMode === 'STAGED' ? 'RECOVERING' : 'NOT_IN_COOLDOWN'
      state.cooldownStartedAt = null
      state.cooldownRemaining = 0
      state.cooldownReason = null
      state.cooldownTrigger = null

      // Restore (do NOT reset) historical stats — Rule 19 enforcement
      state.consecutiveWins = previousConsecutiveWins
      state.consecutiveLosses = previousConsecutiveLosses
      state.peakPerformanceScore = previousPeak

      this.transitionState(
        strategyId,
        targetState,
        `cooldown expired — ${recoveryMode} recovery (Rule 19: stats preserved)`,
        'state-manager',
        'COOLDOWN_EXPIRY',
        currentTime,
      )
    }
  }

  /**
   * Promote a strategy from RECOVERY to ACTIVE (§10).
   * Called when the recovery observation period is satisfied.
   */
  promoteFromRecovery(strategyId: string, currentTime: number = Date.now()): boolean {
    const state = this.states.get(strategyId)
    const def = this.definitions.get(strategyId)
    if (!state || !def) return false
    if (state.currentState !== 'RECOVERY') return false

    state.cooldownStatus = 'NOT_IN_COOLDOWN'
    return this.transitionState(
      strategyId,
      'ACTIVE',
      'recovery observation period complete',
      'state-manager',
      'AUTOMATIC',
      currentTime,
    )
  }

  /**
   * Suspend a strategy manually (§10).
   * Used by governance or operator intervention.
   */
  suspend(strategyId: string, reason: string, actor: string = 'governance', currentTime: number = Date.now()): boolean {
    return this.transitionState(strategyId, 'SUSPENDED', reason, actor, 'MANUAL', currentTime)
  }

  /**
   * Resume a suspended strategy (§10).
   */
  resume(strategyId: string, actor: string = 'governance', currentTime: number = Date.now()): boolean {
    const state = this.states.get(strategyId)
    if (!state) return false
    if (state.currentState !== 'SUSPENDED') return false
    return this.transitionState(strategyId, 'ACTIVE', 'manual resume', actor, 'MANUAL', currentTime)
  }

  /**
   * Retire a strategy (§10, §12).
   * Permanent retirement — strategy will not accept new signals.
   */
  retire(strategyId: string, reason: string, actor: string = 'governance', currentTime: number = Date.now()): boolean {
    return this.transitionState(strategyId, 'RETIRED', reason, actor, 'GOVERNANCE', currentTime)
  }

  /** Compute the strategy state health (0..1) — used in decision confidence (Rule 13). */
  computeStateHealth(strategyId: string, currentTime: number = Date.now()): number {
    const state = this.states.get(strategyId)
    if (!state) return 0

    this.tickCooldown(strategyId, currentTime)

    let base: number
    switch (state.currentState) {
      case 'ACTIVE': base = 1.0; break
      case 'OBSERVATION': base = 0.7; break
      case 'RECOVERY': base = 0.5; break
      case 'COOLDOWN': base = 0.2; break
      case 'SUSPENDED': base = 0.0; break
      case 'RETIRED': base = 0.0; break
      default: base = 0.5
    }

    // Penalize for recent consecutive losses (without resetting)
    const lossPenalty = Math.min(0.3, state.consecutiveLosses * 0.05)
    // Penalize for drawdown
    const drawdownPenalty = Math.min(0.3, state.drawdownState * 0.5)

    return Math.max(0, base - lossPenalty - drawdownPenalty)
  }

  /** Compute historical reliability (0..1) — used in decision confidence (Rule 13). */
  computeHistoricalReliability(strategyId: string): number {
    const state = this.states.get(strategyId)
    if (!state || state.totalDecisions === 0) return 0.5 // default neutral

    const winRate = state.totalWins / Math.max(1, state.totalWins + state.totalLosses)
    return winRate
  }

  /** Snapshot the current state of all strategies (for observability §14). */
  snapshot(): Array<StrategyOperationalState> {
    return Array.from(this.states.values()).map((s) => ({ ...s }))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────────

  private createInitialState(def: StrategyDefinition): StrategyOperationalState {
    const now = Date.now()
    return {
      strategyId: def.strategyId,
      currentState: def.observationMode ? 'OBSERVATION' : 'ACTIVE',
      previousState: null,
      stateEnteredAt: now,
      stateTransitionHistory: [{
        from: 'ACTIVE', // synthetic initial
        to: def.observationMode ? 'OBSERVATION' : 'ACTIVE',
        at: now,
        reason: 'initial registration',
        actor: 'state-manager',
        trigger: 'SYSTEM',
      }],
      consecutiveWins: 0,
      consecutiveLosses: 0,
      totalDecisions: 0,
      totalAccepted: 0,
      totalRejected: 0,
      totalWins: 0,
      totalLosses: 0,
      drawdownState: 0,
      peakPerformanceScore: 0,
      cooldownStatus: 'NOT_IN_COOLDOWN',
      cooldownRemaining: 0,
      cooldownStartedAt: null,
      cooldownReason: null,
      cooldownTrigger: null,
      activeSignals: [],
      lastDecisionId: null,
      lastDecisionAt: null,
      auditLog: [{
        action: 'STRATEGY_REGISTERED',
        at: now,
        actor: 'state-manager',
        note: `strategy ${def.strategyId} registered in ${def.observationMode ? 'OBSERVATION' : 'ACTIVE'} state`,
      }],
      pinnedVersion: { ...def.versions },
    }
  }

  /**
   * Validate state transitions per §10 lifecycle (Rule 8 — deterministic).
   *
   *   ACTIVE        → COOLDOWN, SUSPENDED, OBSERVATION, RETIRED
   *   COOLDOWN      → RECOVERY, ACTIVE, OBSERVATION, RETIRED
   *   SUSPENDED     → ACTIVE, OBSERVATION, RETIRED
   *   RECOVERY      → ACTIVE, COOLDOWN, SUSPENDED, RETIRED
   *   OBSERVATION   → ACTIVE, SUSPENDED, RETIRED
   *   RETIRED       → (terminal — no transitions out)
   */
  private isValidTransition(from: StrategyState, to: StrategyState): boolean {
    if (from === to) return false // no-op transitions not allowed
    const valid: Record<StrategyState, StrategyState[]> = {
      ACTIVE: ['COOLDOWN', 'SUSPENDED', 'OBSERVATION', 'RECOVERY', 'RETIRED'],
      COOLDOWN: ['RECOVERY', 'ACTIVE', 'OBSERVATION', 'RETIRED'],
      SUSPENDED: ['ACTIVE', 'OBSERVATION', 'RECOVERY', 'RETIRED'],
      RECOVERY: ['ACTIVE', 'COOLDOWN', 'SUSPENDED', 'RETIRED'],
      OBSERVATION: ['ACTIVE', 'SUSPENDED', 'RECOVERY', 'RETIRED'],
      RETIRED: [], // terminal
    }
    return valid[from].includes(to)
  }

  /**
   * Evaluate cooldown triggers (§10).
   * Triggers: CONSECUTIVE_LOSS_THRESHOLD, DRAWDOWN_THRESHOLD.
   * Other triggers (RISK_GOVERNANCE_EVENT, MANUAL_ACTION) handled by callers.
   */
  private evaluateCooldownTriggers(strategyId: string, currentTime: number): void {
    const state = this.states.get(strategyId)
    const def = this.definitions.get(strategyId)
    if (!state || !def) return

    const policy = def.cooldownPolicy

    // Consecutive Loss Threshold (§10)
    if (
      state.consecutiveLosses >= policy.consecutiveLossThreshold &&
      state.currentState === 'ACTIVE'
    ) {
      this.triggerCooldown(
        strategyId,
        'CONSECUTIVE_LOSS_THRESHOLD',
        `${state.consecutiveLosses} consecutive losses (threshold ${policy.consecutiveLossThreshold})`,
        currentTime,
      )
      return
    }

    // Drawdown Threshold (§10)
    if (
      state.drawdownState >= policy.drawdownThreshold &&
      state.currentState === 'ACTIVE'
    ) {
      this.triggerCooldown(
        strategyId,
        'DRAWDOWN_THRESHOLD',
        `drawdown ${(state.drawdownState * 100).toFixed(2)}% exceeds threshold ${(policy.drawdownThreshold * 100).toFixed(2)}%`,
        currentTime,
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton state manager
// ─────────────────────────────────────────────────────────────────────────────

export const strategyStateManager = new StrategyStateManager()
