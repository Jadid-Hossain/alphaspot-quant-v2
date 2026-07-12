// CHAPTER 5.7 §8, §10A — Child Order Management & Execution Adaptation
//
// §8 — Child Order Management:
//   • Complete linkage to parent order
//   • Residual Re-absorption State Machine (Rule 21)
//   • When child becomes Partially Filled / Expired / Cancelled / Rejected / Unfilled
//     → remaining quantity returns to parent
//   • Residual triggers dynamic recalculation (no historical modification)
//
// §10A — Execution Adaptation:
//   • Continuous evaluation of active plan optimality
//   • Liquidity/volatility/spread/participation/urgency/time/residual/fill changes
//   • May produce: Algorithm Upgrade/Downgrade, Schedule Recalc, Child Reallocation,
//     Participation Adjustment, Slice Size Adjustment
//   • Every adaptation generates new immutable Execution Plan Version (Rule 26)
//
// Rule 19 — Adaptive algorithms without modifying historical plans.
// Rule 21 — Residual Re-absorption State Machine.
// Rule 22 — Async execution interrupts.
// Rule 23 — Mid-flight algorithm switching.
// Rule 26 — Adaptation generates new immutable versions.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AlgorithmSwitchingStatus,
  ChildOrderPlan,
  ChildOrderState,
  ExecutionAlgorithm,
  ExecutionInterruptStatus,
} from './types'

const log = createLogger('decision-intelligence:execution-optimization:child-orders')

// ─────────────────────────────────────────────────────────────────────────────
// ChildOrderManager — residual re-absorption state machine (§8, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResidualReabsorptionEvent {
  childOrderId: string
  parentOrderId: string
  fromState: ChildOrderState
  toState: ChildOrderState
  residualQuantity: number
  timestamp: number
  reason: string
}

export class ChildOrderManager {
  /**
   * Process child order state transition and handle residual re-absorption (§8, Rule 21).
   * When a child becomes Partially Filled / Expired / Cancelled / Rejected / Unfilled,
   * the remaining quantity returns to the parent.
   */
  processChildStateTransition(
    child: ChildOrderPlan,
    newState: ChildOrderState,
    filledQuantity: number,
    reason: string,
    currentTime: number = Date.now(),
  ): { updatedChild: ChildOrderPlan; reabsorptionEvent: ResidualReabsorptionEvent | null } {
    const oldState = child.state
    const residualQuantity = Math.max(0, child.quantity - filledQuantity)

    const updatedChild: ChildOrderPlan = {
      ...child,
      state: newState,
      filledQuantity,
      residualQuantity,
      executedAt: newState === 'FILLED' ? currentTime : child.executedAt,
    }

    let reabsorptionEvent: ResidualReabsorptionEvent | null = null

    // §8 — Trigger residual re-absorption for specific states
    const reabsorptionStates: ChildOrderState[] = ['PARTIALLY_FILLED', 'EXPIRED', 'CANCELLED', 'REJECTED', 'UNFILLED']
    if (reabsorptionStates.includes(newState) && residualQuantity > 0) {
      reabsorptionEvent = {
        childOrderId: child.childOrderId,
        parentOrderId: child.parentOrderId,
        fromState: oldState,
        toState: newState,
        residualQuantity,
        timestamp: currentTime,
        reason: `${newState}: ${reason} — ${residualQuantity} returned to parent (Rule 21)`,
      }
      log.info(
        `residual re-absorption: child ${child.childOrderId} ${oldState}→${newState}, ` +
        `${residualQuantity} returned to parent ${child.parentOrderId} (Rule 21)`,
      )
    }

    return { updatedChild, reabsorptionEvent }
  }

  /**
   * Verify Rule 8 — aggregate child quantity exactly equals parent quantity.
   */
  verifyAggregateQuantity(childOrders: ChildOrderPlan[], parentQuantity: number): {
    valid: boolean
    aggregate: number
    difference: number
  } {
    const aggregate = childOrders.reduce((sum, c) => sum + c.quantity, 0)
    const difference = aggregate - parentQuantity
    const valid = Math.abs(difference) < 1e-10 // floating point tolerance
    if (!valid) {
      log.warn(
        `Rule 8 violation: aggregate child quantity ${aggregate} ≠ parent ${parentQuantity} ` +
        `(difference ${difference})`,
      )
    }
    return { valid, aggregate, difference }
  }

  /**
   * Adjust remaining child orders after residual re-absorption (§8).
   * Redistributes residual quantity across remaining planned child orders.
   */
  redistributeResidual(
    childOrders: ChildOrderPlan[],
    residualQuantity: number,
    remainingPlannedCount: number,
  ): ChildOrderPlan[] {
    if (remainingPlannedCount === 0 || residualQuantity <= 0) return childOrders

    const additionalPerSlice = residualQuantity / remainingPlannedCount
    let remaining = residualQuantity

    return childOrders.map((c) => {
      if (c.state !== 'PLANNED') return c
      const isLast = remainingPlannedCount === 1
      const addition = isLast ? remaining : additionalPerSlice
      remaining -= addition
      return {
        ...c,
        quantity: c.quantity + addition,
      }
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionAdaptationManager (§10A, Rule 19, Rule 22, Rule 23, Rule 26)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdaptationEvaluation {
  /** Whether adaptation is needed. */
  adaptationNeeded: boolean
  /** Type of adaptation (Rule 23). */
  switchingStatus: AlgorithmSwitchingStatus
  /** New algorithm (if switching). */
  newAlgorithm: ExecutionAlgorithm | null
  /** Interrupt status (Rule 22). */
  interruptStatus: ExecutionInterruptStatus
  /** Reason for adaptation. */
  reason: string
  /** §10A — Adaptation factors. */
  factors: {
    liquidityChange: number
    volatilityChange: number
    spreadChange: number
    participationChange: number
    urgencyChange: number
    timeRemainingFraction: number
    residualFraction: number
    fillPerformance: number
  }
}

export class ExecutionAdaptationManager {
  /**
   * Evaluate whether the active execution plan needs adaptation (§10A).
   * Returns adaptation recommendation.
   */
  evaluate(
    currentAlgorithm: ExecutionAlgorithm,
    currentParticipationRate: number,
    targetParticipationRate: number,
    urgency: string,
    liquidityScore: number,
    volatility: number,
    spread: number,
    baselineLiquidity: number,
    baselineVolatility: number,
    baselineSpread: number,
    timeRemainingMs: number,
    totalTimeMs: number,
    residualQuantity: number,
    parentQuantity: number,
    filledQuantity: number,
    interruptThresholds: {
      liquidityDegradationThreshold: number
      volatilitySpikeThreshold: number
      priceDislocationThreshold: number
      riskLimitApproachThreshold: number
    },
  ): AdaptationEvaluation {
    // §10A — Compute adaptation factors
    const liquidityChange = baselineLiquidity > 0 ? (liquidityScore - baselineLiquidity) / baselineLiquidity : 0
    const volatilityChange = baselineVolatility > 0 ? (volatility - baselineVolatility) / baselineVolatility : 0
    const spreadChange = baselineSpread > 0 ? (spread - baselineSpread) / baselineSpread : 0
    const participationChange = targetParticipationRate > 0
      ? (currentParticipationRate - targetParticipationRate) / targetParticipationRate : 0
    const urgencyChange = 0 // would compare to original urgency
    const timeRemainingFraction = totalTimeMs > 0 ? timeRemainingMs / totalTimeMs : 0
    const residualFraction = parentQuantity > 0 ? residualQuantity / parentQuantity : 0
    const fillPerformance = parentQuantity > 0 ? filledQuantity / parentQuantity : 0

    // §10A — Check for adaptation triggers
    let adaptationNeeded = false
    let switchingStatus: AlgorithmSwitchingStatus = 'NONE'
    let newAlgorithm: ExecutionAlgorithm | null = null
    let interruptStatus: ExecutionInterruptStatus = 'NONE'
    let reason = 'execution on track'

    // Rule 22 — Interrupt checks
    if (liquidityChange < -interruptThresholds.liquidityDegradationThreshold) {
      adaptationNeeded = true
      interruptStatus = 'LIQUIDITY_DEGRADED'
      switchingStatus = 'DOWNGRADE'
      reason = `liquidity degraded ${(liquidityChange * 100).toFixed(1)}% — downgrade algorithm`
      // Downgrade to slower algorithm
      newAlgorithm = this.downgradeAlgorithm(currentAlgorithm)
    } else if (volatilityChange > interruptThresholds.volatilitySpikeThreshold) {
      adaptationNeeded = true
      interruptStatus = 'VOLATILITY_SPIKE'
      switchingStatus = 'DOWNGRADE'
      reason = `volatility spike +${(volatilityChange * 100).toFixed(1)}% — slow down execution`
      newAlgorithm = this.downgradeAlgorithm(currentAlgorithm)
    } else if (spreadChange > interruptThresholds.priceDislocationThreshold) {
      adaptationNeeded = true
      interruptStatus = 'PRICE_DISLOCATION'
      switchingStatus = 'SCHEDULE_RECALC'
      reason = `spread expanded ${(spreadChange * 100).toFixed(1)}% — recalculate schedule`
    } else if (residualFraction > 0.5 && timeRemainingFraction < 0.2) {
      // Running out of time with significant residual — upgrade to aggressive
      adaptationNeeded = true
      switchingStatus = 'UPGRADE'
      reason = `residual ${(residualFraction * 100).toFixed(1)}% with ${(timeRemainingFraction * 100).toFixed(1)}% time remaining — upgrade to aggressive`
      newAlgorithm = this.upgradeAlgorithm(currentAlgorithm)
    } else if (Math.abs(participationChange) > 0.2) {
      adaptationNeeded = true
      switchingStatus = 'PARTICIPATION_ADJUST'
      reason = `participation rate drift ${(participationChange * 100).toFixed(1)}% — adjust`
    }

    log.debug(
      `adaptation eval: needed=${adaptationNeeded}, switch=${switchingStatus}, ` +
      `interrupt=${interruptStatus}, liqΔ=${(liquidityChange * 100).toFixed(1)}%, volΔ=${(volatilityChange * 100).toFixed(1)}%`,
    )

    return {
      adaptationNeeded,
      switchingStatus,
      newAlgorithm,
      interruptStatus,
      reason,
      factors: {
        liquidityChange, volatilityChange, spreadChange, participationChange,
        urgencyChange, timeRemainingFraction, residualFraction, fillPerformance,
      },
    }
  }

  /**
   * Upgrade algorithm to more aggressive (Rule 23).
   */
  private upgradeAlgorithm(current: ExecutionAlgorithm): ExecutionAlgorithm {
    const upgradeMap: Partial<Record<ExecutionAlgorithm, ExecutionAlgorithm>> = {
      ICEBERG: 'TWAP',
      VWAP: 'TWAP',
      TWAP: 'POV',
      POV: 'IMPLEMENTATION_SHORTFALL',
      IMPLEMENTATION_SHORTFALL: 'ARRIVAL_PRICE',
      ARRIVAL_PRICE: 'SNIPER',
      SNIPER: 'MARKET',
      PEGGED: 'TWAP',
    }
    return upgradeMap[current] ?? current
  }

  /**
   * Downgrade algorithm to less aggressive (Rule 23).
   */
  private downgradeAlgorithm(current: ExecutionAlgorithm): ExecutionAlgorithm {
    const downgradeMap: Partial<Record<ExecutionAlgorithm, ExecutionAlgorithm>> = {
      MARKET: 'SNIPER',
      SNIPER: 'ARRIVAL_PRICE',
      ARRIVAL_PRICE: 'IMPLEMENTATION_SHORTFALL',
      IMPLEMENTATION_SHORTFALL: 'POV',
      POV: 'TWAP',
      TWAP: 'VWAP',
      VWAP: 'ICEBERG',
    }
    return downgradeMap[current] ?? current
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const childOrderManager = new ChildOrderManager()
export const executionAdaptationManager = new ExecutionAdaptationManager()
