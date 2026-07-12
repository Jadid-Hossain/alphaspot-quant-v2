// CHAPTER 5.6 §8, §11 — Rebalancing Management & Temporal Cooldowns
//
// §8 — Rebalancing Management:
//   • Absolute Drift Threshold
//   • Relative Drift Threshold
//   • Minimum Quantity Threshold
//   • Minimum Notional Threshold
//   • Turnover Threshold
//   • Portfolio/Strategy Drift Thresholds
//   • Time-Based / Event-Based Rebalancing
//
// Rule 6 — Order necessity determined by configurable rebalancing thresholds,
//           NOT target positions alone.
// Rule 22 — Temporal Rebalancing Cooldowns suppress repeated order generation.
// Rule 25 — Freshness, Urgency, Cooldown policies independently configurable.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CooldownState,
  RebalancingThresholds,
  TemporalCooldownConfig,
} from './types'

const log = createLogger('decision-intelligence:order-decision:rebalancing')

// ─────────────────────────────────────────────────────────────────────────────
// RebalancingEvaluator
// Rule 6 — Determines order necessity via configurable thresholds.
// ─────────────────────────────────────────────────────────────────────────────

export interface DriftEvaluation {
  /** Absolute drift (quantity units). */
  absoluteDrift: number
  /** Relative drift (fraction). */
  relativeDrift: number
  /** Whether drift exceeds absolute threshold. */
  exceedsAbsolute: boolean
  /** Whether drift exceeds relative threshold. */
  exceedsRelative: boolean
  /** Whether drift exceeds portfolio threshold. */
  exceedsPortfolio: boolean
  /** Whether drift exceeds strategy threshold. */
  exceedsStrategy: boolean
  /** Whether rebalancing is necessary. */
  rebalanceRequired: boolean
  /** Reason for the decision. */
  reason: string
}

export class RebalancingEvaluator {
  /**
   * Evaluate drift between current and target positions (§8, Rule 6, Rule 7).
   */
  evaluateDrift(
    currentQuantity: number,
    targetQuantity: number,
    portfolioWeight: number,
    strategyWeight: number,
    thresholds: RebalancingThresholds,
  ): DriftEvaluation {
    const absoluteDrift = targetQuantity - currentQuantity
    const absDriftMagnitude = Math.abs(absoluteDrift)
    const relativeDrift = currentQuantity !== 0
      ? absoluteDrift / Math.abs(currentQuantity)
      : (targetQuantity !== 0 ? 1.0 : 0.0)

    const exceedsAbsolute = absDriftMagnitude > thresholds.absoluteDriftThreshold
    const exceedsRelative = Math.abs(relativeDrift) > thresholds.relativeDriftThreshold
    const exceedsPortfolio = Math.abs(portfolioWeight) > thresholds.portfolioDriftThreshold
    const exceedsStrategy = Math.abs(strategyWeight) > thresholds.strategyDriftThreshold

    // Rule 6 — Order necessity determined by thresholds
    const rebalanceRequired = exceedsAbsolute || exceedsRelative || exceedsPortfolio || exceedsStrategy

    let reason: string
    if (!rebalanceRequired) {
      reason = `drift below thresholds (abs ${absDriftMagnitude.toFixed(6)} ≤ ${thresholds.absoluteDriftThreshold}, rel ${(Math.abs(relativeDrift) * 100).toFixed(3)}% ≤ ${(thresholds.relativeDriftThreshold * 100).toFixed(2)}%)`
    } else {
      const triggers: string[] = []
      if (exceedsAbsolute) triggers.push(`absolute drift ${absDriftMagnitude.toFixed(6)} > ${thresholds.absoluteDriftThreshold}`)
      if (exceedsRelative) triggers.push(`relative drift ${(Math.abs(relativeDrift) * 100).toFixed(3)}% > ${(thresholds.relativeDriftThreshold * 100).toFixed(2)}%`)
      if (exceedsPortfolio) triggers.push(`portfolio drift ${(Math.abs(portfolioWeight) * 100).toFixed(3)}% > ${(thresholds.portfolioDriftThreshold * 100).toFixed(2)}%`)
      if (exceedsStrategy) triggers.push(`strategy drift ${(Math.abs(strategyWeight) * 100).toFixed(3)}% > ${(thresholds.strategyDriftThreshold * 100).toFixed(2)}%`)
      reason = `rebalance required: ${triggers.join(', ')}`
    }

    log.debug(
      `drift: current=${currentQuantity.toFixed(6)}, target=${targetQuantity.toFixed(6)}, ` +
      `abs=${absDriftMagnitude.toFixed(6)}, rel=${(relativeDrift * 100).toFixed(3)}%, ` +
      `required=${rebalanceRequired}`,
    )

    return {
      absoluteDrift,
      relativeDrift,
      exceedsAbsolute,
      exceedsRelative,
      exceedsPortfolio,
      exceedsStrategy,
      rebalanceRequired,
      reason,
    }
  }

  /**
   * Evaluate minimum trade size (§8).
   */
  evaluateMinimumTradeSize(
    orderQuantity: number,
    thresholds: RebalancingThresholds,
  ): { passed: boolean; reason: string } {
    if (Math.abs(orderQuantity) < thresholds.minimumQuantityThreshold) {
      return {
        passed: false,
        reason: `order quantity ${Math.abs(orderQuantity).toFixed(6)} below minimum ${thresholds.minimumQuantityThreshold}`,
      }
    }
    return { passed: true, reason: 'minimum trade size satisfied' }
  }

  /**
   * Evaluate minimum notional (§8).
   */
  evaluateMinimumNotional(
    notional: number,
    thresholds: RebalancingThresholds,
  ): { passed: boolean; reason: string } {
    if (Math.abs(notional) < thresholds.minimumNotionalThreshold) {
      return {
        passed: false,
        reason: `order notional ${Math.abs(notional).toFixed(2)} below minimum ${thresholds.minimumNotionalThreshold}`,
      }
    }
    return { passed: true, reason: 'minimum notional satisfied' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CooldownManager
// Rule 22 — Temporal Rebalancing Cooldowns.
// ─────────────────────────────────────────────────────────────────────────────

export class CooldownManager {
  private state: CooldownState = {
    assetCooldowns: new Map(),
    strategyCooldowns: new Map(),
    portfolioCooldownEnd: null,
  }

  /**
   * Check if asset/strategy/portfolio is in cooldown (§11, Rule 22).
   * Returns true if cooldown is active (order should be suppressed).
   */
  isInCooldown(
    symbol: string,
    strategyId: string | null,
    config: TemporalCooldownConfig,
    currentTime: number = Date.now(),
    currentDrift: number = 0,
  ): { inCooldown: boolean; reason: string; remainingMs: number } {
    if (!config.enabled) {
      return { inCooldown: false, reason: 'cooldown disabled', remainingMs: 0 }
    }

    // §11 — Emergency drift override
    if (Math.abs(currentDrift) > config.emergencyDriftThreshold) {
      return {
        inCooldown: false,
        reason: `emergency drift ${Math.abs(currentDrift).toFixed(3)} > ${config.emergencyDriftThreshold} — cooldown overridden`,
        remainingMs: 0,
      }
    }

    // Check asset cooldown
    const assetEnd = this.state.assetCooldowns.get(symbol)
    if (assetEnd !== undefined && currentTime < assetEnd) {
      return {
        inCooldown: true,
        reason: `asset ${symbol} in cooldown (Rule 22)`,
        remainingMs: assetEnd - currentTime,
      }
    }

    // Check strategy cooldown
    if (strategyId) {
      const strategyEnd = this.state.strategyCooldowns.get(strategyId)
      if (strategyEnd !== undefined && currentTime < strategyEnd) {
        return {
          inCooldown: true,
          reason: `strategy ${strategyId} in cooldown (Rule 22)`,
          remainingMs: strategyEnd - currentTime,
        }
      }
    }

    // Check portfolio cooldown
    if (this.state.portfolioCooldownEnd !== null && currentTime < this.state.portfolioCooldownEnd) {
      return {
        inCooldown: true,
        reason: 'portfolio in cooldown (Rule 22)',
        remainingMs: this.state.portfolioCooldownEnd - currentTime,
      }
    }

    return { inCooldown: false, reason: 'no active cooldown', remainingMs: 0 }
  }

  /**
   * Set cooldown after successful order publication (§11, Rule 22).
   */
  setCooldown(
    symbol: string,
    strategyId: string | null,
    config: TemporalCooldownConfig,
    currentTime: number = Date.now(),
  ): void {
    this.state.assetCooldowns.set(symbol, currentTime + config.assetCooldownMs)
    if (strategyId) {
      this.state.strategyCooldowns.set(strategyId, currentTime + config.strategyCooldownMs)
    }
    this.state.portfolioCooldownEnd = currentTime + config.portfolioCooldownMs
    log.debug(
      `cooldown set: asset ${symbol} (+${config.assetCooldownMs}ms), ` +
      `strategy ${strategyId ?? 'none'} (+${config.strategyCooldownMs}ms), ` +
      `portfolio (+${config.portfolioCooldownMs}ms)`,
    )
  }

  /**
   * Clear cooldowns (manual override or emergency).
   */
  clearCooldowns(symbol?: string, strategyId?: string): void {
    if (symbol) this.state.assetCooldowns.delete(symbol)
    if (strategyId) this.state.strategyCooldowns.delete(strategyId)
    if (!symbol && !strategyId) {
      this.state.assetCooldowns.clear()
      this.state.strategyCooldowns.clear()
      this.state.portfolioCooldownEnd = null
    }
  }

  /** Get cooldown state. */
  getState(): CooldownState {
    return {
      assetCooldowns: new Map(this.state.assetCooldowns),
      strategyCooldowns: new Map(this.state.strategyCooldowns),
      portfolioCooldownEnd: this.state.portfolioCooldownEnd,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const rebalancingEvaluator = new RebalancingEvaluator()
export const cooldownManager = new CooldownManager()
