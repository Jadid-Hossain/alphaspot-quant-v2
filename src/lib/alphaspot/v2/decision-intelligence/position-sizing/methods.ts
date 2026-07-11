// CHAPTER 5.5 §7 — Position Sizing Methods
//
// §7 — The engine supports 12 sizing methodologies:
//   1.  Fixed Fractional Sizing
//   2.  Fixed Dollar Sizing
//   3.  Fixed Risk Sizing
//   4.  Kelly Criterion
//   5.  Fractional Kelly
//   6.  Volatility Targeting
//   7.  ATR-Based Position Sizing
//   8.  Risk Budgeting
//   9.  Equal Risk Allocation
//  10.  Dynamic Capital Allocation
//  11.  Conviction-Based Position Sizing
//  12.  Custom Position Sizing Models
//
// Rule 6 — Fully configurable + version controlled.
// Rule 14 — Kelly, vol targeting, ATR, etc. independently versioned + reproducible.
// Rule 23 — Every methodology executes within configurable mathematical hard-cap
//           constraints. Safety limits may REDUCE but NEVER INCREASE.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  PositionSizingHardCaps,
  PositionSizingMethod,
  SizingMethodParameters,
} from './types'

const log = createLogger('decision-intelligence:position-sizing:methods')

// ─────────────────────────────────────────────────────────────────────────────
// SizingInput — bundled data needed by all methods
// ─────────────────────────────────────────────────────────────────────────────

export interface SizingInput {
  /** Approved allocation weight (fraction of NAV). */
  approvedWeight: number
  /** Total portfolio NAV (quote currency). */
  totalNav: number
  /** Current price of the asset (quote currency). */
  price: number
  /** Asset volatility (annualized, 0..1). */
  assetVolatility: number
  /** Allocation risk score (0..1, from Ch 5.4). */
  allocationRiskScore: number
  /** Sizing method parameters. */
  parameters: SizingMethodParameters
  /** Hard caps (Rule 23). */
  hardCaps: PositionSizingHardCaps
  /** Strategy ID (for per-strategy overrides). */
  strategyId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// SizingResult — output of a sizing method
// ─────────────────────────────────────────────────────────────────────────────

export interface SizingResult {
  method: PositionSizingMethod
  /** Theoretical capital allocation (before hard caps). */
  theoreticalCapital: number
  /** Capital allocation after hard caps (Rule 23). */
  cappedCapital: number
  /** Whether a hard cap was applied. */
  hardCapApplied: boolean
  /** Which hard cap was applied (if any). */
  hardCapReason: string
  /** Position confidence (0..1). */
  positionConfidence: number
  /** Method version (Rule 14). */
  methodVersion: string
  /** Method-specific metadata. */
  metadata: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// PositionSizingMethodExecutor interface (§7, Rule 6, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionSizingMethodExecutor {
  method: PositionSizingMethod
  version: string // Rule 14
  compute(input: SizingInput): SizingResult
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard-Cap Enforcer (Rule 23 — may REDUCE but NEVER INCREASE)
// ─────────────────────────────────────────────────────────────────────────────

export function applyHardCaps(
  theoreticalCapital: number,
  hardCaps: PositionSizingHardCaps,
  totalNav: number,
  price: number,
): { cappedCapital: number; hardCapApplied: boolean; hardCapReason: string } {
  let capped = theoreticalCapital
  let hardCapApplied = false
  let reason = ''

  // Rule 23 — max position fraction
  const maxFractionCapital = totalNav * hardCaps.maxPositionFraction
  if (capped > maxFractionCapital) {
    capped = maxFractionCapital
    hardCapApplied = true
    reason = `maxPositionFraction ${hardCaps.maxPositionFraction} (NAV ${totalNav})`
  }

  // Rule 23 — max absolute capital
  if (capped > hardCaps.maxAbsoluteCapital) {
    capped = hardCaps.maxAbsoluteCapital
    hardCapApplied = true
    reason = `maxAbsoluteCapital ${hardCaps.maxAbsoluteCapital}`
  }

  // Rule 23 — max quantity (translate to capital)
  if (price > 0) {
    const maxQuantityCapital = hardCaps.maxQuantity * price
    if (capped > maxQuantityCapital) {
      capped = maxQuantityCapital
      hardCapApplied = true
      reason = `maxQuantity ${hardCaps.maxQuantity} × price ${price}`
    }
  }

  // Rule 23 — min position size
  if (capped < hardCaps.minPositionSize) {
    capped = 0 // reject (below minimum)
    hardCapApplied = true
    reason = `below minPositionSize ${hardCaps.minPositionSize}`
  }

  // Rule 23 — NEVER INCREASE (safety constraint)
  if (capped > theoreticalCapital) {
    capped = theoreticalCapital
    hardCapApplied = false
    reason = ''
  }

  return { cappedCapital: capped, hardCapApplied, hardCapReason: reason }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fixed Fractional Sizing (§7)
// Allocates a fixed percentage of capital.
// ─────────────────────────────────────────────────────────────────────────────

export class FixedFractionalExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'FIXED_FRACTIONAL'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const fractionalPercent = input.parameters.fractionalPercent
    const theoretical = input.totalNav * fractionalPercent * (1 - input.allocationRiskScore * 0.5)
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: 1 - input.allocationRiskScore,
      methodVersion: this.version,
      metadata: { fractionalPercent, riskScore: input.allocationRiskScore },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fixed Dollar Sizing (§7)
// Allocates a fixed dollar amount.
// ─────────────────────────────────────────────────────────────────────────────

export class FixedDollarExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'FIXED_DOLLAR'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const theoretical = Math.min(input.parameters.fixedDollarAmount, input.totalNav * input.approvedWeight)
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: 0.7,
      methodVersion: this.version,
      metadata: { fixedDollarAmount: input.parameters.fixedDollarAmount },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fixed Risk Sizing (§7)
// Allocates based on risk per trade and stop-loss distance.
// ─────────────────────────────────────────────────────────────────────────────

export class FixedRiskExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'FIXED_RISK'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const riskAmount = input.totalNav * input.parameters.riskPerTrade
    const stopLoss = input.parameters.stopLossPercent
    // position size = riskAmount / stopLoss (in currency)
    const theoretical = stopLoss > 0 ? riskAmount / stopLoss : 0
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: 0.8,
      methodVersion: this.version,
      metadata: { riskPerTrade: input.parameters.riskPerTrade, stopLossPercent: stopLoss, riskAmount },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Kelly Criterion (§7, Rule 14)
// f* = (p*b - q) / b where p=win rate, q=1-p, b=win/loss ratio
// ─────────────────────────────────────────────────────────────────────────────

export class KellyCriterionExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'KELLY_CRITERION'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const p = input.parameters.winRate
    const q = 1 - p
    const b = input.parameters.winLossRatio
    // Kelly fraction: f* = (p*b - q) / b
    const kellyFraction = b > 0 ? (p * b - q) / b : 0
    const theoretical = Math.max(0, input.totalNav * kellyFraction)
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: Math.max(0, Math.min(1, kellyFraction * 2)),
      methodVersion: this.version,
      metadata: { winRate: p, winLossRatio: b, kellyFraction },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Fractional Kelly (§7, Rule 14)
// Uses a fraction (e.g., half) of the full Kelly allocation.
// ─────────────────────────────────────────────────────────────────────────────

export class FractionalKellyExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'FRACTIONAL_KELLY'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const p = input.parameters.winRate
    const q = 1 - p
    const b = input.parameters.winLossRatio
    const fullKelly = b > 0 ? (p * b - q) / b : 0
    const fractional = input.parameters.kellyFraction // e.g., 0.5 for half Kelly
    const theoretical = Math.max(0, input.totalNav * fullKelly * fractional)
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: Math.max(0, Math.min(1, fullKelly * fractional * 2)),
      methodVersion: this.version,
      metadata: { winRate: p, winLossRatio: b, kellyFraction: fractional, fullKelly },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Volatility Targeting (§7, Rule 14)
// Scales position to achieve a target portfolio volatility contribution.
// ─────────────────────────────────────────────────────────────────────────────

export class VolatilityTargetingExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'VOLATILITY_TARGETING'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const targetVol = input.parameters.targetVolatility
    const assetVol = input.assetVolatility || input.parameters.assetVolatility
    // position weight = targetVol / assetVol
    const weight = assetVol > 0 ? targetVol / assetVol : 0
    const theoretical = Math.max(0, input.totalNav * Math.min(1, weight))
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: Math.max(0, Math.min(1, weight)),
      methodVersion: this.version,
      metadata: { targetVolatility: targetVol, assetVolatility: assetVol, targetWeight: weight },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ATR-Based Position Sizing (§7, Rule 14)
// Sizes based on Average True Range (volatility measure).
// ─────────────────────────────────────────────────────────────────────────────

export class ATRBasedExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'ATR_BASED'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    // ATR as fraction of price (using asset volatility as proxy)
    const atrFraction = input.assetVolatility / Math.sqrt(252) // daily vol approx
    const atrMultiplier = input.parameters.atrMultiplier
    const riskPerUnit = input.price * atrFraction * atrMultiplier
    const riskAmount = input.totalNav * input.parameters.riskPerTrade
    // position size = riskAmount / riskPerUnit (in currency)
    const theoretical = riskPerUnit > 0 ? riskAmount / riskPerUnit * input.price : 0
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: 0.75,
      methodVersion: this.version,
      metadata: { atrMultiplier, riskPerUnit, riskAmount, atrFraction },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Risk Budgeting (§7, Rule 14)
// Allocates a fixed risk budget across positions.
// ─────────────────────────────────────────────────────────────────────────────

export class RiskBudgetingExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'RISK_BUDGETING'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const riskBudget = input.parameters.riskBudget
    // position capital = riskBudget * totalNav / assetVolatility
    const assetVol = input.assetVolatility || input.parameters.assetVolatility
    const theoretical = assetVol > 0 ? (riskBudget * input.totalNav) / assetVol : 0
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: Math.max(0, Math.min(1, 1 - assetVol)),
      methodVersion: this.version,
      metadata: { riskBudget, assetVolatility: assetVol },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Equal Risk Allocation (§7, Rule 14)
// Allocates so each position contributes equal risk.
// ─────────────────────────────────────────────────────────────────────────────

export class EqualRiskAllocationExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'EQUAL_RISK_ALLOCATION'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    // For a single position, ERA ≈ inverse-volatility weighting
    const assetVol = input.assetVolatility || input.parameters.assetVolatility
    const targetRisk = 0.02 // 2% risk contribution target
    const theoretical = assetVol > 0 ? (targetRisk * input.totalNav) / assetVol : 0
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: 0.7,
      methodVersion: this.version,
      metadata: { targetRisk, assetVolatility: assetVol },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Dynamic Capital Allocation (§7, Rule 14)
// Adjusts allocation based on dynamic factors.
// ─────────────────────────────────────────────────────────────────────────────

export class DynamicCapitalAllocationExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'DYNAMIC_CAPITAL_ALLOCATION'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const baseAllocation = input.totalNav * input.approvedWeight
    const adjustmentFactor = input.parameters.dynamicAdjustmentFactor
    // Adjust based on risk score (lower risk → larger allocation)
    const riskAdjustment = 1 - input.allocationRiskScore * 0.5
    const theoretical = baseAllocation * adjustmentFactor * riskAdjustment
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: Math.max(0, Math.min(1, riskAdjustment)),
      methodVersion: this.version,
      metadata: { baseAllocation, adjustmentFactor, riskAdjustment },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Conviction-Based Position Sizing (§7, Rule 14)
// Sizes based on conviction (risk score inverse).
// ─────────────────────────────────────────────────────────────────────────────

export class ConvictionBasedExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'CONVICTION_BASED'
  version = '1.0.0'

  compute(input: SizingInput): SizingResult {
    const conviction = Math.max(0, Math.min(1, 1 - input.allocationRiskScore))
    const convictionScaled = conviction * input.parameters.convictionScale
    const minConviction = input.parameters.minConviction
    const maxConviction = input.parameters.maxConviction
    // Only allocate if conviction above minimum
    if (convictionScaled < minConviction) {
      return {
        method: this.method,
        theoreticalCapital: 0,
        cappedCapital: 0,
        hardCapApplied: true,
        hardCapReason: `conviction ${convictionScaled.toFixed(3)} below minConviction ${minConviction}`,
        positionConfidence: convictionScaled,
        methodVersion: this.version,
        metadata: { conviction, convictionScaled, minConviction, rejected: true },
      }
    }
    const capped = Math.min(convictionScaled, maxConviction)
    const theoretical = input.totalNav * capped * input.approvedWeight
    const capResult = applyHardCaps(theoretical, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: theoretical,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: convictionScaled,
      methodVersion: this.version,
      metadata: { conviction, convictionScaled, minConviction, maxConviction },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Custom Position Sizing (§7, Rule 14)
// User-defined sizing function.
// ─────────────────────────────────────────────────────────────────────────────

export class CustomExecutor implements PositionSizingMethodExecutor {
  method: PositionSizingMethod = 'CUSTOM'
  version = '1.0.0'
  constructor(private computeFn: (input: SizingInput) => { theoreticalCapital: number; confidence: number; metadata?: Record<string, unknown> }) {}

  compute(input: SizingInput): SizingResult {
    const result = this.computeFn(input)
    const capResult = applyHardCaps(result.theoreticalCapital, input.hardCaps, input.totalNav, input.price)
    return {
      method: this.method,
      theoreticalCapital: result.theoreticalCapital,
      cappedCapital: capResult.cappedCapital,
      hardCapApplied: capResult.hardCapApplied,
      hardCapReason: capResult.hardCapReason,
      positionConfidence: result.confidence,
      methodVersion: this.version,
      metadata: { ...result.metadata, custom: true },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SizingMethodRegistry (§7, Rule 6, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export class SizingMethodRegistry {
  private executors = new Map<PositionSizingMethod, PositionSizingMethodExecutor>()

  constructor() {
    this.register(new FixedFractionalExecutor())
    this.register(new FixedDollarExecutor())
    this.register(new FixedRiskExecutor())
    this.register(new KellyCriterionExecutor())
    this.register(new FractionalKellyExecutor())
    this.register(new VolatilityTargetingExecutor())
    this.register(new ATRBasedExecutor())
    this.register(new RiskBudgetingExecutor())
    this.register(new EqualRiskAllocationExecutor())
    this.register(new DynamicCapitalAllocationExecutor())
    this.register(new ConvictionBasedExecutor())
  }

  register(executor: PositionSizingMethodExecutor): void {
    this.executors.set(executor.method, executor)
    log.info(`registered sizing method: ${executor.method} v${executor.version}`)
  }

  get(method: PositionSizingMethod): PositionSizingMethodExecutor | null {
    return this.executors.get(method) ?? null
  }

  listMethods(): PositionSizingMethod[] {
    return Array.from(this.executors.keys())
  }
}

export const sizingMethodRegistry = new SizingMethodRegistry()
