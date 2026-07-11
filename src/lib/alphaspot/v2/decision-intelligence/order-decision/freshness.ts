// CHAPTER 5.6 §10, §11, Rule 8, Rule 21, Rule 17 — Pending Order Freshness & Turnover
//
// §10 — Pending orders continuously monitored for execution freshness.
//       Stale orders enter recovery workflow (cancel, release, recompute, re-evaluate).
// Rule 8 — Pending orders incorporated into delta calculations (prevent duplicate execution).
// Rule 17 — Turnover budgets enforced INDEPENDENTLY of transaction cost policies.
// Rule 21 — Pending order freshness verification + stale-order recovery.
// Rule 25 — Freshness, Urgency, Cooldown policies independently configurable.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  OrderPortfolioState,
  PendingOrder,
  PendingOrderStatus,
  TurnoverBudget,
} from './types'

const log = createLogger('decision-intelligence:order-decision:freshness')

// ─────────────────────────────────────────────────────────────────────────────
// PendingOrderManager (§10, Rule 8, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export interface StaleOrderRecovery {
  orderId: string
  reason: string
  cancelledAt: number
  releasedQuantity: number
}

export class PendingOrderManager {
  /**
   * Verify freshness of all pending orders (§10, Rule 21).
   * Returns orders that have exceeded freshness thresholds.
   */
  verifyFreshness(
    pendingOrders: PendingOrder[],
    freshnessTimeoutMs: number,
    heartbeatTimeoutMs: number,
    currentTime: number = Date.now(),
  ): { staleOrders: PendingOrder[]; freshOrders: PendingOrder[] } {
    const stale: PendingOrder[] = []
    const fresh: PendingOrder[] = []

    for (const order of pendingOrders) {
      const age = currentTime - order.createdAt
      const heartbeatAge = currentTime - order.lastHeartbeat

      // Rule 21 — Heartbeat timeout
      if (heartbeatAge > heartbeatTimeoutMs && !order.acknowledged) {
        order.freshnessStatus = 'STALE'
        stale.push(order)
        continue
      }

      // Rule 21 — Overall freshness timeout
      if (age > freshnessTimeoutMs) {
        order.freshnessStatus = 'STALE'
        stale.push(order)
        continue
      }

      order.freshnessStatus = order.acknowledged
        ? (order.filledQuantity > 0 ? 'PENDING_PARTIAL_FILL' : 'PENDING_FULL')
        : 'PENDING_ACK'
      fresh.push(order)
    }

    if (stale.length > 0) {
      log.warn(`${stale.length} pending orders are STALE (Rule 21 — freshness verification)`)
    }

    return { staleOrders: stale, freshOrders: fresh }
  }

  /**
   * Initiate stale-order recovery workflow (§10, Rule 21).
   * The recovery workflow may: cancel stale orders, release reserved quantities,
   * recompute portfolio deltas, trigger fresh Order Decision evaluation.
   */
  initiateRecovery(
    staleOrders: PendingOrder[],
    currentTime: number = Date.now(),
  ): StaleOrderRecovery[] {
    const recoveries: StaleOrderRecovery[] = []

    for (const order of staleOrders) {
      if (!order.cancellable) {
        log.warn(`stale order ${order.orderId} is not cancellable — skipping recovery`)
        continue
      }

      const recovery: StaleOrderRecovery = {
        orderId: order.orderId,
        reason: `stale order (age ${currentTime - order.createdAt}ms, heartbeat age ${currentTime - order.lastHeartbeat}ms)`,
        cancelledAt: currentTime,
        releasedQuantity: order.quantity - order.filledQuantity,
      }

      order.freshnessStatus = 'CANCELLED'
      recoveries.push(recovery)

      log.info(
        `stale order recovery: ${order.orderId} cancelled — released ${recovery.releasedQuantity} units (Rule 21)`,
      )
    }

    return recoveries
  }

  /**
   * Incorporate pending orders into delta calculation (Rule 8).
   * Adjusts the target quantity by subtracting pending order quantities
   * to prevent duplicate execution of identical investment intent.
   */
  adjustTargetForPendingOrders(
    symbol: string,
    targetQuantity: number,
    currentQuantity: number,
    pendingOrders: PendingOrder[],
  ): { adjustedTarget: number; adjustedDelta: number; pendingReduction: number } {
    let pendingReduction = 0

    for (const order of pendingOrders) {
      if (order.symbol !== symbol) continue
      if (order.freshnessStatus === 'CANCELLED' || order.freshnessStatus === 'EXPIRED') continue

      // Rule 8 — Subtract unfilled pending quantity from delta
      const unfilledQuantity = order.quantity - order.filledQuantity
      if (order.side === 'BUY') {
        pendingReduction += unfilledQuantity
      } else {
        pendingReduction -= unfilledQuantity
      }
    }

    // Adjusted target accounts for pending orders
    const adjustedTarget = targetQuantity - pendingReduction
    const adjustedDelta = adjustedTarget - currentQuantity

    if (pendingReduction !== 0) {
      log.debug(
        `Rule 8 — pending order adjustment for ${symbol}: target ${targetQuantity} → ${adjustedTarget} ` +
        `(pending reduction ${pendingReduction})`,
      )
    }

    return { adjustedTarget, adjustedDelta, pendingReduction }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TurnoverManager (§11, Rule 17)
// Rule 17 — Turnover budgets enforced INDEPENDENTLY of transaction cost policies.
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnoverEvaluation {
  /** Whether the order would exceed turnover budget. */
  passed: boolean
  /** Daily turnover after this order (fraction of NAV). */
  projectedDailyTurnover: number
  /** Portfolio turnover after this order. */
  projectedPortfolioTurnover: number
  /** Strategy turnover after this order. */
  projectedStrategyTurnover: number
  /** Asset turnover after this order. */
  projectedAssetTurnover: number
  /** Reason for pass/fail. */
  reason: string
}

export class TurnoverManager {
  /**
   * Evaluate turnover budget (§11, Rule 17 — independent from tx cost).
   */
  evaluate(
    orderNotional: number,
    totalNav: number,
    strategyAllocation: number,
    assetAllocation: number,
    currentState: OrderPortfolioState,
    budget: TurnoverBudget,
  ): TurnoverEvaluation {
    const orderTurnoverFraction = totalNav > 0 ? Math.abs(orderNotional) / totalNav : 0

    const projectedDailyTurnover = currentState.dailyTurnover + orderTurnoverFraction
    const projectedPortfolioTurnover = orderTurnoverFraction // simplified
    const projectedStrategyTurnover = strategyAllocation > 0 ? Math.abs(orderNotional) / strategyAllocation : 0
    const projectedAssetTurnover = assetAllocation > 0 ? Math.abs(orderNotional) / assetAllocation : 0

    let passed = true
    let reason = 'turnover budget satisfied'

    if (projectedDailyTurnover > budget.dailyTurnoverLimit) {
      passed = false
      reason = `daily turnover ${(projectedDailyTurnover * 100).toFixed(2)}% > limit ${(budget.dailyTurnoverLimit * 100).toFixed(2)}%`
    } else if (projectedPortfolioTurnover > budget.portfolioTurnoverLimit) {
      passed = false
      reason = `portfolio turnover ${(projectedPortfolioTurnover * 100).toFixed(2)}% > limit ${(budget.portfolioTurnoverLimit * 100).toFixed(2)}%`
    } else if (projectedStrategyTurnover > budget.strategyTurnoverLimit) {
      passed = false
      reason = `strategy turnover ${(projectedStrategyTurnover * 100).toFixed(2)}% > limit ${(budget.strategyTurnoverLimit * 100).toFixed(2)}%`
    } else if (projectedAssetTurnover > budget.assetTurnoverLimit) {
      passed = false
      reason = `asset turnover ${(projectedAssetTurnover * 100).toFixed(2)}% > limit ${(budget.assetTurnoverLimit * 100).toFixed(2)}%`
    }

    log.debug(
      `turnover: daily=${(projectedDailyTurnover * 100).toFixed(2)}%, portfolio=${(projectedPortfolioTurnover * 100).toFixed(2)}%, ` +
      `strategy=${(projectedStrategyTurnover * 100).toFixed(2)}%, asset=${(projectedAssetTurnover * 100).toFixed(2)}%, passed=${passed}`,
    )

    return {
      passed,
      projectedDailyTurnover,
      projectedPortfolioTurnover,
      projectedStrategyTurnover,
      projectedAssetTurnover,
      reason,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const pendingOrderManager = new PendingOrderManager()
export const turnoverManager = new TurnoverManager()
