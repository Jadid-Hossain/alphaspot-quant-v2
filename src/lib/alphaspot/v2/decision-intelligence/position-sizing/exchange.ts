// CHAPTER 5.5 §9 — Exchange Normalization
//
// §9 — Every position undergoes exchange compatibility verification.
// Normalization includes:
//   • Minimum Lot Size
//   • Maximum Lot Size
//   • Tick Size
//   • Contract Multipliers
//   • Fractional Quantity Rules
//   • Position Precision
//   • Currency Precision
//   • Exchange Quantity Constraints
//
// Rule 10 — Exchange normalization shall NEVER increase approved portfolio risk.
//           Normalization may REDUCE position size but shall NEVER enlarge it.
// Rule 16 — If exchange constraints prevent full execution, generate the nearest
//           valid executable quantity without violating approved risk limits.
// Rule 19 — All exchange-specific trading rules versioned independently.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  ExchangeNormalizationStatus,
  ExchangeTradingRules,
} from './types'

const log = createLogger('decision-intelligence:position-sizing:exchange')

// ─────────────────────────────────────────────────────────────────────────────
// ExchangeNormalizer
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizationResult {
  /** Normalized quantity (exchange-compliant). */
  normalizedQuantity: number
  /** Original quantity before normalization. */
  originalQuantity: number
  /** Status of normalization. */
  status: ExchangeNormalizationStatus
  /** Capital allocation after normalization (may be reduced — Rule 10). */
  normalizedCapital: number
  /** Original capital before normalization. */
  originalCapital: number
  /** Difference (normalizedCapital - originalCapital). */
  capitalDelta: number
  /** Price used for capital calculation. */
  price: number
  /** Description of normalization. */
  description: string
}

export class ExchangeNormalizer {
  /**
   * Normalize a quantity to comply with exchange rules (§9, Rule 10, Rule 16).
   *
   * Rule 10 — Normalization may REDUCE but NEVER INCREASE.
   * Rule 16 — If full execution impossible, generate nearest valid quantity.
   * Rule 19 — Exchange rules are versioned.
   */
  normalize(
    quantity: number,
    capital: number,
    price: number,
    rules: ExchangeTradingRules,
  ): NormalizationResult {
    const originalQuantity = quantity
    const originalCapital = capital
    let normalizedQuantity = quantity
    let status: ExchangeNormalizationStatus = 'NOT_REQUIRED'
    let description = 'no normalization required'

    // §9 — Fractional quantity rules
    if (!rules.fractionalQuantitiesAllowed) {
      const floored = Math.floor(quantity)
      if (floored !== quantity) {
        normalizedQuantity = floored
        status = 'REDUCED'
        description = `fractional quantities not allowed — floored to ${floored}`
      }
    }

    // §9 — Minimum lot size
    if (normalizedQuantity < rules.minLotSize) {
      // Rule 16 — Below minimum lot → cannot execute
      // Rule 10 — Cannot increase to meet minimum (would enlarge position)
      return {
        normalizedQuantity: 0,
        originalQuantity,
        status: 'REJECTED',
        normalizedCapital: 0,
        originalCapital,
        capitalDelta: -originalCapital,
        price,
        description: `quantity ${normalizedQuantity} below minLotSize ${rules.minLotSize} — REJECTED (Rule 10: cannot enlarge)`,
      }
    }

    // §9 — Maximum lot size
    if (normalizedQuantity > rules.maxLotSize) {
      normalizedQuantity = rules.maxLotSize
      status = 'REDUCED'
      description = `quantity reduced to maxLotSize ${rules.maxLotSize}`
    }

    // §9 — Maximum order quantity
    if (normalizedQuantity > rules.maxOrderQuantity) {
      normalizedQuantity = rules.maxOrderQuantity
      status = 'REDUCED'
      description = `quantity reduced to maxOrderQuantity ${rules.maxOrderQuantity}`
    }

    // §9 — Position precision (round to precision decimals)
    const precision = rules.positionPrecision
    const factor = Math.pow(10, precision)
    const rounded = Math.floor(normalizedQuantity * factor) / factor // Rule 10 — floor, never ceil
    if (rounded !== normalizedQuantity) {
      if (status === 'NOT_REQUIRED') {
        status = 'NORMALIZED'
        description = `rounded down to ${precision} decimal places (Rule 10: never enlarge)`
      } else {
        description += `; rounded to ${precision} decimals`
      }
      normalizedQuantity = rounded
    }

    // §9 — Tick size verification (price must be on tick)
    // (Note: tick size affects price, not quantity, but we verify the notional)
    const notional = normalizedQuantity * price
    const tickNotional = rules.tickSize * rules.contractMultiplier
    if (tickNotional > 0 && notional < tickNotional) {
      // Notional below tick value — cannot execute
      return {
        normalizedQuantity: 0,
        originalQuantity,
        status: 'REJECTED',
        normalizedCapital: 0,
        originalCapital,
        capitalDelta: -originalCapital,
        price,
        description: `notional ${notional} below tick value ${tickNotional} — REJECTED`,
      }
    }

    // §9 — Contract multiplier (quantity in contracts, not units)
    // If contractMultiplier > 1, the effective quantity is normalizedQuantity * contractMultiplier
    // (We keep the reported quantity in units; the multiplier affects notional)
    const effectiveQuantity = normalizedQuantity * rules.contractMultiplier
    const normalizedCapital = effectiveQuantity * price

    // Rule 10 — NEVER INCREASE
    if (normalizedCapital > originalCapital) {
      // Reduce quantity to match original capital
      const maxQuantity = originalCapital / (rules.contractMultiplier * price)
      const flooredMax = Math.floor(maxQuantity * factor) / factor
      normalizedQuantity = flooredMax
      status = 'REDUCED'
      description = `reduced to ${flooredMax} to avoid enlarging position (Rule 10)`
    }

    const finalCapital = normalizedQuantity * rules.contractMultiplier * price
    const capitalDelta = finalCapital - originalCapital

    if (normalizedQuantity === originalQuantity) {
      status = status === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : status
    } else if (status === 'NOT_REQUIRED') {
      status = 'NORMALIZED'
      description = `quantity adjusted from ${originalQuantity} to ${normalizedQuantity}`
    }

    log.debug(
      `normalization: ${originalQuantity} → ${normalizedQuantity} ` +
      `(status ${status}, capital ${originalCapital.toFixed(0)} → ${finalCapital.toFixed(0)}, delta ${capitalDelta.toFixed(0)})`,
    )

    return {
      normalizedQuantity,
      originalQuantity,
      status,
      normalizedCapital: finalCapital,
      originalCapital,
      capitalDelta,
      price,
      description,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton normalizer
// ─────────────────────────────────────────────────────────────────────────────

export const exchangeNormalizer = new ExchangeNormalizer()
