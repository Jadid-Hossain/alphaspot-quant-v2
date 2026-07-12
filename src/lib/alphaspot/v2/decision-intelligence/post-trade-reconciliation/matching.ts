// CHAPTER 5.11 §8, §9 — Trade Matching & Execution Verification
//
// §8 — Trade Matching: execution ID, broker/exchange order, timestamp, quantity,
//      price, fee, settlement, cross-system, tolerance-based, three-way matching,
//      SSI validation, settlement instruction, clearing/custody/cash account verification.
// §9 — Execution Verification: quantity, price, average price, maker/taker,
//      exchange/broker fees, funding/borrow charges, currency, FX conversion.
//
// Rule 6 — Matching methodologies independently configurable + version controlled.
// Rule 10 — Execution verification mathematically independent from settlement verification.
// Rule 13 — Duplicate trade detection deterministic + auditable.
// Rule 15 — Configurable tolerance thresholds for price/quantity/fee matching.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  BrokerConfirmation,
  CustodianConfirmation,
  ExchangeConfirmation,
  InternalLedgerEntry,
  MatchingDiscrepancy,
  MatchingResult,
  ReconciliationType,
  SSIConfiguration,
  ToleranceConfiguration,
} from './types'

const log = createLogger('decision-intelligence:post-trade-reconciliation:matching')

// ─────────────────────────────────────────────────────────────────────────────
// TradeMatcher (§8, Rule 6, Rule 13, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export class TradeMatcher {
  /** Seen trade IDs for duplicate detection (Rule 13). */
  private seenTradeIds = new Set<string>()

  /**
   * Three-way trade matching (§8): exchange vs broker vs internal ledger.
   * Rule 6 — Configurable matching methodology.
   * Rule 15 — Tolerance-based matching.
   */
  threeWayMatch(
    execution: { quantity: number; averageExecutionPrice: number; fillAggregation: { totalFees: number } },
    exchangeConf: ExchangeConfirmation | null,
    brokerConf: BrokerConfirmation | null,
    internalLedger: InternalLedgerEntry | null,
    tolerance: ToleranceConfiguration,
  ): MatchingResult {
    const discrepancies: MatchingDiscrepancy[] = []

    // §8 — Quantity matching (with tolerance)
    const execQty = execution.quantity
    const exchQty = exchangeConf?.quantity ?? null
    const brokerQty = brokerConf?.quantity ?? null
    const ledgerQty = internalLedger?.quantity ?? null

    // §8 — Price matching
    const execPrice = execution.averageExecutionPrice
    const exchPrice = exchangeConf?.price ?? null
    const brokerPrice = brokerConf?.price ?? null
    const ledgerPrice = internalLedger?.price ?? null

    // §8 — Fee matching
    const execFees = execution.fillAggregation.totalFees
    const exchFees = exchangeConf?.fees ?? null
    const brokerFees = brokerConf?.fees ?? null
    const ledgerFees = internalLedger?.fees ?? null

    // §8 — Funding matching
    const exchFunding = exchangeConf?.funding ?? 0

    // Compare execution vs exchange
    this.compareField('quantity', execQty, exchQty, tolerance, discrepancies)
    this.compareField('price', execPrice, exchPrice, tolerance, discrepancies)
    this.compareField('fees', execFees, exchFees, tolerance, discrepancies)

    // Compare execution vs broker
    this.compareField('quantity', execQty, brokerQty, tolerance, discrepancies)
    this.compareField('price', execPrice, brokerPrice, tolerance, discrepancies)
    this.compareField('fees', execFees, brokerFees, tolerance, discrepancies)

    // Compare execution vs internal ledger
    this.compareField('quantity', execQty, ledgerQty, tolerance, discrepancies)
    this.compareField('price', execPrice, ledgerPrice, tolerance, discrepancies)
    this.compareField('fees', execFees, ledgerFees, tolerance, discrepancies)

    // Determine match type
    const allMatched = discrepancies.length === 0
    const allWithinTolerance = discrepancies.every((d) => d.withinTolerance)
    const hasMissing = !exchangeConf || !brokerConf || !internalLedger

    let matchType: ReconciliationType
    let matched: boolean

    if (hasMissing) {
      matchType = 'MISSING_TRADE'
      matched = false
    } else if (allMatched) {
      matchType = 'FULL_MATCH'
      matched = true
    } else if (allWithinTolerance) {
      matchType = 'PARTIAL_MATCH'
      matched = true // tolerance-based match
    } else {
      // Determine primary discrepancy type
      const qtyDisc = discrepancies.find((d) => d.field === 'quantity' && !d.withinTolerance)
      const priceDisc = discrepancies.find((d) => d.field === 'price' && !d.withinTolerance)
      const feeDisc = discrepancies.find((d) => d.field === 'fees' && !d.withinTolerance)
      if (qtyDisc) matchType = 'QUANTITY_DIFFERENCE'
      else if (priceDisc) matchType = 'PRICE_DIFFERENCE'
      else if (feeDisc) matchType = 'FEE_DIFFERENCE'
      else matchType = 'PARTIAL_MATCH'
      matched = false
    }

    // Rule 13 — Duplicate trade detection
    const tradeId = exchangeConf?.tradeId ?? brokerConf?.tradeId ?? ''
    if (tradeId && this.seenTradeIds.has(tradeId)) {
      matchType = 'DUPLICATE_TRADE'
      matched = false
      log.warn(`duplicate trade detected: ${tradeId} (Rule 13)`)
    }
    if (tradeId) this.seenTradeIds.add(tradeId)

    const result: MatchingResult = {
      matched,
      matchType,
      matchedQuantity: execQty,
      matchedPrice: execPrice,
      matchedFees: execFees,
      matchedFunding: exchFunding,
      discrepancies,
      toleranceApplied: allWithinTolerance && !allMatched,
      reason: allMatched ? 'full match' : allWithinTolerance ? 'matched within tolerance' : `${discrepancies.length} discrepancies`,
    }

    log.debug(
      `three-way match: type=${matchType}, matched=${matched}, ` +
      `discrepancies=${discrepancies.length}, tolerance=${result.toleranceApplied}`,
    )

    return result
  }

  /**
   * SSI Validation (§8).
   */
  validateSSI(symbol: string, ssiConfig: SSIConfiguration | null): { valid: boolean; reason: string } {
    if (!ssiConfig) {
      return { valid: false, reason: `no SSI configuration for ${symbol}` }
    }
    if (!ssiConfig.clearingAccount) {
      return { valid: false, reason: 'missing clearing account' }
    }
    if (!ssiConfig.custodyAccount) {
      return { valid: false, reason: 'missing custody account' }
    }
    if (!ssiConfig.cashAccount) {
      return { valid: false, reason: 'missing cash account' }
    }
    return { valid: true, reason: 'SSI validated' }
  }

  /**
   * Compare a field with tolerance (Rule 15).
   */
  private compareField(
    field: MatchingDiscrepancy['field'],
    expected: number,
    actual: number | null,
    tolerance: ToleranceConfiguration,
    discrepancies: MatchingDiscrepancy[],
  ): void {
    if (actual === null) return // missing confirmation — handled separately

    const difference = expected - actual
    const absDiff = Math.abs(difference)

    // Rule 15 — Configurable tolerance
    let absTolerance: number
    let fracTolerance: number
    switch (field) {
      case 'quantity':
        absTolerance = tolerance.quantityTolerance
        fracTolerance = tolerance.quantityToleranceFraction
        break
      case 'price':
        absTolerance = tolerance.priceTolerance
        fracTolerance = tolerance.priceToleranceFraction
        break
      case 'fees':
        absTolerance = tolerance.feeTolerance
        fracTolerance = tolerance.feeToleranceFraction
        break
      case 'funding':
        absTolerance = tolerance.fundingTolerance
        fracTolerance = 0.01
        break
      case 'commission':
        absTolerance = tolerance.feeTolerance
        fracTolerance = tolerance.feeToleranceFraction
        break
      default:
        absTolerance = 0.01
        fracTolerance = 0.001
    }

    const fracDiff = expected !== 0 ? absDiff / Math.abs(expected) : absDiff
    const withinTolerance = absDiff <= absTolerance || fracDiff <= fracTolerance

    if (absDiff > 0) {
      discrepancies.push({
        field,
        expected,
        actual,
        difference,
        withinTolerance,
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionVerifier (§9, Rule 10)
// Rule 10 — Execution verification mathematically independent from settlement verification.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionVerificationResult {
  verified: boolean
  executedQuantity: number
  executionPrice: number
  averagePrice: number
  makerTakerStatus: 'MAKER' | 'TAKER' | 'UNKNOWN'
  exchangeFees: number
  brokerFees: number
  fundingCharges: number
  borrowCharges: number
  executionCurrency: string
  fxConversion: number
  discrepancies: string[]
}

export class ExecutionVerifier {
  /**
   * Verify execution details (§9, Rule 10 — independent from settlement).
   */
  verify(
    executedQuantity: number,
    averageExecutionPrice: number,
    fillAggregation: { totalFees: number; fillCount: number; fills: Array<{ fee: number; fillPrice: number; fillQuantity: number }> },
    exchangeConf: ExchangeConfirmation | null,
    brokerConf: BrokerConfirmation | null,
  ): ExecutionVerificationResult {
    const discrepancies: string[] = []

    // §9 — Executed quantity verification
    if (executedQuantity <= 0) {
      discrepancies.push(`invalid executed quantity: ${executedQuantity}`)
    }

    // §9 — Execution price verification
    if (averageExecutionPrice <= 0) {
      discrepancies.push(`invalid average execution price: ${averageExecutionPrice}`)
    }

    // §9 — Average price verification (recompute from fills)
    const recomputedAvg = fillAggregation.fills.length > 0
      ? fillAggregation.fills.reduce((s, f) => s + f.fillQuantity * f.fillPrice, 0) / fillAggregation.fills.reduce((s, f) => s + f.fillQuantity, 0)
      : 0
    if (Math.abs(recomputedAvg - averageExecutionPrice) > 0.01) {
      discrepancies.push(`average price mismatch: reported ${averageExecutionPrice} vs recomputed ${recomputedAvg}`)
    }

    // §9 — Maker/Taker status (simplified — would come from exchange)
    const makerTakerStatus: 'MAKER' | 'TAKER' | 'UNKNOWN' = exchangeConf ? 'TAKER' : 'UNKNOWN'

    // §9 — Exchange fees
    const exchangeFees = exchangeConf?.fees ?? fillAggregation.totalFees

    // §9 — Broker fees / commission
    const brokerFees = brokerConf?.commission ?? 0

    // §9 — Funding charges
    const fundingCharges = exchangeConf?.funding ?? 0

    // §9 — Borrow charges (for shorts — would need position context)
    const borrowCharges = 0

    // §9 — Execution currency
    const executionCurrency = 'USDT' // would come from metadata

    // §9 — FX conversion
    const fxConversion = 1.0 // would come from FX oracle

    const verified = discrepancies.length === 0

    log.debug(
      `execution verification: verified=${verified}, qty=${executedQuantity}, ` +
      `avgPrice=${averageExecutionPrice.toFixed(2)}, fees=${exchangeFees.toFixed(2)}`,
    )

    return {
      verified,
      executedQuantity,
      executionPrice: averageExecutionPrice,
      averagePrice: recomputedAvg,
      makerTakerStatus,
      exchangeFees,
      brokerFees,
      fundingCharges,
      borrowCharges,
      executionCurrency,
      fxConversion,
      discrepancies,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const tradeMatcher = new TradeMatcher()
export const executionVerifier = new ExecutionVerifier()
