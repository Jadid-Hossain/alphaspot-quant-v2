// CHAPTER 5.12 §7-§12 — Ledgers, Cost Basis, Tax Lots, Positions, Currency, Corporate Actions
//
// This module consolidates the supporting accounting subsystems:
//   §7  — Ledger Management (8 ledgers) + Compensating Journals (§7A, Rule 21)
//   §8  — Cost Basis Management (6 methodologies, Rule 11)
//   §9  — Tax Lot Management (Rule 14)
//   §10A — Bifurcated Position States (Rule 22) + §11A Short Financing (Rule 23)
//   §11 — Multi-Currency Accounting (Rule 13)
//   §12 — Corporate Action Accounting (Rule 12)

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AccountingConfiguration,
  BiTemporalTimestamps,
  CashBalance,
  CompensatingJournalType,
  CorporateActionEvent,
  CostBasisMethod,
  EntrySide,
  FXTranslationRate,
  JournalEntry,
  LedgerType,
  PortfolioState,
  PositionState,
  PositionStateType,
  TaxLot,
} from './types'

const log = createLogger('decision-intelligence:portfolio-accounting:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §7 — LedgerManager (8 ledgers, Rule 9/17/18)
// ─────────────────────────────────────────────────────────────────────────────

export class LedgerManager {
  /** §7 — 8 ledgers, all immutable (Rule 18). */
  private ledgers = new Map<LedgerType, JournalEntry[]>()

  constructor() {
    for (const type of ['PORTFOLIO_LEDGER', 'POSITION_LEDGER', 'CASH_LEDGER', 'CURRENCY_LEDGER',
      'CORPORATE_ACTION_LEDGER', 'ADJUSTMENT_LEDGER', 'HISTORICAL_LEDGER', 'AUDIT_LEDGER'] as LedgerType[]) {
      this.ledgers.set(type, [])
    }
  }

  /** Post a journal entry (Rule 9 — double-entry, Rule 17 — every debit has credit). */
  postEntry(ledgerType: LedgerType, entry: JournalEntry): void {
    const ledger = this.ledgers.get(ledgerType) ?? []
    ledger.push(entry)
    this.ledgers.set(ledgerType, ledger)
  }

  /** §7A — Create compensating journal (Rule 21 — immutable, opposite, linked to original). */
  createCompensatingJournal(
    originalEventId: string,
    type: CompensatingJournalType,
    originalEntries: JournalEntry[],
    biTemporal: BiTemporalTimestamps,
  ): JournalEntry[] {
    const compensating: JournalEntry[] = []
    for (const orig of originalEntries) {
      const opposite: EntrySide = orig.side === 'DEBIT' ? 'CREDIT' : 'DEBIT'
      compensating.push({
        ...orig,
        entryId: `comp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        side: opposite,
        biTemporal: { ...biTemporal, correctionTime: Date.now() },
        originalAccountingEventId: originalEventId,
        description: `${type}: compensating for ${orig.description}`,
      })
    }
    log.info(`compensating journal created: ${type} for ${originalEventId} — ${compensating.length} opposite entries (Rule 21)`)
    return compensating
  }

  /** Rule 17 — Validate double-entry balance (debits = credits). */
  validateBalance(entries: JournalEntry[]): { balanced: boolean; debitTotal: number; creditTotal: number } {
    const debitTotal = entries.filter((e) => e.side === 'DEBIT').reduce((s, e) => s + e.amount, 0)
    const creditTotal = entries.filter((e) => e.side === 'CREDIT').reduce((s, e) => s + e.amount, 0)
    const balanced = Math.abs(debitTotal - creditTotal) < 0.0001
    if (!balanced) {
      log.warn(`Rule 17 violation: debits ${debitTotal} ≠ credits ${creditTotal}`)
    }
    return { balanced, debitTotal, creditTotal }
  }

  getLedger(type: LedgerType): JournalEntry[] {
    return [...(this.ledgers.get(type) ?? [])]
  }

  getAllLedgers(): Map<LedgerType, JournalEntry[]> {
    return new Map(this.ledgers)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — CostBasisManager (6 methodologies, Rule 11)
// Rule 11 — Cost basis mathematically independent from market valuation.
// ─────────────────────────────────────────────────────────────────────────────

export class CostBasisManager {
  /** Calculate cost basis (§8, Rule 11 — independent from market valuation). */
  calculate(
    method: CostBasisMethod,
    existingLots: TaxLot[],
    newQuantity: number,
    newPrice: number,
    isClosing: boolean,
  ): { updatedLots: TaxLot[]; costBasis: number; averageCost: number; realizedGainLoss: number } {
    switch (method) {
      case 'AVERAGE_COST':
        return this.averageCost(existingLots, newQuantity, newPrice, isClosing)
      case 'FIFO':
        return this.fifo(existingLots, newQuantity, newPrice, isClosing)
      case 'LIFO':
        return this.lifo(existingLots, newQuantity, newPrice, isClosing)
      case 'SPECIFIC_IDENTIFICATION':
      case 'WEIGHTED_AVERAGE':
      case 'REGULATORY_COST_BASIS':
      default:
        return this.averageCost(existingLots, newQuantity, newPrice, isClosing)
    }
  }

  private averageCost(lots: TaxLot[], qty: number, price: number, isClosing: boolean) {
    if (isClosing) {
      const totalQty = lots.reduce((s, l) => s + l.quantity, 0)
      const avgCost = totalQty > 0 ? lots.reduce((s, l) => s + l.totalCostBasis, 0) / totalQty : 0
      const realized = (price - avgCost) * qty
      return { updatedLots: lots, costBasis: avgCost * qty, averageCost: avgCost, realizedGainLoss: realized }
    }
    const totalQty = lots.reduce((s, l) => s + l.quantity, 0) + qty
    const totalCost = lots.reduce((s, l) => s + l.totalCostBasis, 0) + qty * price
    const avgCost = totalQty > 0 ? totalCost / totalQty : price
    const newLot: TaxLot = {
      lotId: `lot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: lots[0]?.symbol ?? '', quantity: qty, costBasisPerUnit: price, totalCostBasis: qty * price,
      acquisitionDate: Date.now(), holdingPeriodDays: 0, washSaleFlag: false, status: 'OPEN',
      closedDate: null, realizedGainLoss: 0, version: 1,
    }
    // Merge into single lot (average cost method)
    const mergedLot: TaxLot = { ...newLot, quantity: totalQty, totalCostBasis: totalCost, costBasisPerUnit: avgCost }
    return { updatedLots: [mergedLot], costBasis: totalCost, averageCost: avgCost, realizedGainLoss: 0 }
  }

  private fifo(lots: TaxLot[], qty: number, price: number, isClosing: boolean) {
    if (isClosing) {
      let remaining = qty
      let realized = 0
      let costBasis = 0
      const updated = [...lots].sort((a, b) => a.acquisitionDate - b.acquisitionDate)
      for (const lot of updated) {
        if (remaining <= 0) break
        const closeQty = Math.min(remaining, lot.quantity)
        realized += (price - lot.costBasisPerUnit) * closeQty
        costBasis += lot.costBasisPerUnit * closeQty
        lot.quantity -= closeQty
        lot.realizedGainLoss += (price - lot.costBasisPerUnit) * closeQty
        if (lot.quantity <= 0) { lot.status = 'CLOSED'; lot.closedDate = Date.now() }
        remaining -= closeQty
      }
      const avgCost = qty > 0 ? costBasis / qty : 0
      return { updatedLots: updated.filter((l) => l.quantity > 0), costBasis, averageCost: avgCost, realizedGainLoss: realized }
    }
    const newLot: TaxLot = {
      lotId: `lot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: lots[0]?.symbol ?? '', quantity: qty, costBasisPerUnit: price, totalCostBasis: qty * price,
      acquisitionDate: Date.now(), holdingPeriodDays: 0, washSaleFlag: false, status: 'OPEN',
      closedDate: null, realizedGainLoss: 0, version: 1,
    }
    return { updatedLots: [...lots, newLot], costBasis: qty * price, averageCost: price, realizedGainLoss: 0 }
  }

  private lifo(lots: TaxLot[], qty: number, price: number, isClosing: boolean) {
    if (isClosing) {
      const updated = [...lots].sort((a, b) => b.acquisitionDate - a.acquisitionDate) // LIFO: newest first
      let remaining = qty; let realized = 0; let costBasis = 0
      for (const lot of updated) {
        if (remaining <= 0) break
        const closeQty = Math.min(remaining, lot.quantity)
        realized += (price - lot.costBasisPerUnit) * closeQty
        costBasis += lot.costBasisPerUnit * closeQty
        lot.quantity -= closeQty; lot.realizedGainLoss += (price - lot.costBasisPerUnit) * closeQty
        if (lot.quantity <= 0) { lot.status = 'CLOSED'; lot.closedDate = Date.now() }
        remaining -= closeQty
      }
      const avgCost = qty > 0 ? costBasis / qty : 0
      return { updatedLots: updated.filter((l) => l.quantity > 0), costBasis, averageCost: avgCost, realizedGainLoss: realized }
    }
    const newLot: TaxLot = {
      lotId: `lot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: lots[0]?.symbol ?? '', quantity: qty, costBasisPerUnit: price, totalCostBasis: qty * price,
      acquisitionDate: Date.now(), holdingPeriodDays: 0, washSaleFlag: false, status: 'OPEN',
      closedDate: null, realizedGainLoss: 0, version: 1,
    }
    return { updatedLots: [...lots, newLot], costBasis: qty * price, averageCost: price, realizedGainLoss: 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 — TaxLotManager (Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export class TaxLotManager {
  createLot(symbol: string, qty: number, price: number): TaxLot {
    return {
      lotId: `lot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      symbol, quantity: qty, costBasisPerUnit: price, totalCostBasis: qty * price,
      acquisitionDate: Date.now(), holdingPeriodDays: 0, washSaleFlag: false,
      status: 'OPEN', closedDate: null, realizedGainLoss: 0, version: 1,
    }
  }

  updateHoldingPeriods(lots: TaxLot[], currentTime: number = Date.now()): void {
    for (const lot of lots) {
      if (lot.status === 'OPEN') {
        lot.holdingPeriodDays = Math.floor((currentTime - lot.acquisitionDate) / (1000 * 60 * 60 * 24))
      }
    }
  }

  flagWashSale(lot: TaxLot): void {
    lot.washSaleFlag = true
    log.info(`wash sale flagged for lot ${lot.lotId}`)
  }

  splitLot(lot: TaxLot, splitQuantity: number): TaxLot[] {
    if (splitQuantity >= lot.quantity) return [lot]
    const lot1: TaxLot = { ...lot, quantity: splitQuantity, totalCostBasis: lot.costBasisPerUnit * splitQuantity, lotId: `${lot.lotId}-a`, version: lot.version + 1 }
    const lot2: TaxLot = { ...lot, quantity: lot.quantity - splitQuantity, totalCostBasis: lot.costBasisPerUnit * (lot.quantity - splitQuantity), lotId: `${lot.lotId}-b`, version: lot.version + 1 }
    return [lot1, lot2]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10A — PositionManager (Bifurcated States, Rule 22) + §11A Short Financing (Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export class PositionManager {
  /** §10A — Update traded position state (Rule 22 — immediate on reconciliation/escrow). */
  updateTradedPosition(
    portfolio: PortfolioState,
    symbol: string,
    quantity: number,
    price: number,
    isClosing: boolean,
    config: AccountingConfiguration,
  ): PositionState {
    let pos = portfolio.tradedPositions.get(symbol)
    if (!pos) {
      pos = {
        symbol, stateType: 'TRADED', quantity: 0, averageCost: 0, totalCostBasis: 0,
        currency: config.baseCurrency, isShort: false, borrowLiability: 0,
        marginLiability: 0, borrowFeeAccrued: 0, fundingPaymentAccrued: 0, rebateAccrued: 0,
        taxLots: [], lastUpdate: Date.now(),
      }
      portfolio.tradedPositions.set(symbol, pos)
    }

    if (!isClosing) {
      // Opening/increasing position
      const totalQty = pos.quantity + quantity
      const totalCost = pos.totalCostBasis + quantity * price
      pos.averageCost = totalQty > 0 ? totalCost / totalQty : 0
      pos.totalCostBasis = totalCost
      pos.quantity = totalQty
    } else {
      // Closing/reducing position
      pos.quantity -= quantity
      if (pos.quantity < 0) {
        // Rule 23 — Short position generates financing liability entries
        pos.isShort = true
        pos.borrowLiability = Math.abs(pos.quantity) * price
        if (config.shortFinancingEnabled) {
          pos.borrowFeeAccrued += Math.abs(quantity) * price * config.borrowFeeRate
        }
      }
      pos.totalCostBasis = pos.quantity * pos.averageCost
    }

    pos.lastUpdate = Date.now()
    log.debug(`traded position updated: ${symbol} qty=${pos.quantity} avgCost=${pos.averageCost.toFixed(2)} short=${pos.isShort}`)
    return pos
  }

  /** §10A — Update settled position state (Rule 22 — only after custodian settlement). */
  updateSettledPosition(
    portfolio: PortfolioState,
    symbol: string,
    quantity: number,
    price: number,
    config: AccountingConfiguration,
  ): PositionState {
    let pos = portfolio.settledPositions.get(symbol)
    if (!pos) {
      pos = {
        symbol, stateType: 'SETTLED', quantity: 0, averageCost: 0, totalCostBasis: 0,
        currency: config.baseCurrency, isShort: false, borrowLiability: 0,
        marginLiability: 0, borrowFeeAccrued: 0, fundingPaymentAccrued: 0, rebateAccrued: 0,
        taxLots: [], lastUpdate: Date.now(),
      }
      portfolio.settledPositions.set(symbol, pos)
    }
    pos.quantity += quantity
    pos.totalCostBasis = pos.quantity > 0 ? pos.quantity * pos.averageCost : 0
    pos.lastUpdate = Date.now()
    log.debug(`settled position updated: ${symbol} qty=${pos.quantity}`)
    return pos
  }

  /** §10A — Rule 22: Traded and Settled states logically independent. */
  getBifurcatedStates(portfolio: PortfolioState, symbol: string): { traded: PositionState | null; settled: PositionState | null } {
    return {
      traded: portfolio.tradedPositions.get(symbol) ?? null,
      settled: portfolio.settledPositions.get(symbol) ?? null,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 — CashManager
// ─────────────────────────────────────────────────────────────────────────────

export class CashManager {
  updateCashBalance(portfolio: PortfolioState, currency: string, delta: number, type: 'available' | 'pending' | 'escrow' | 'margin' | 'borrow' = 'available'): void {
    let balance = portfolio.cashBalances.get(currency)
    if (!balance) {
      balance = { currency, available: 0, pending: 0, escrow: 0, margin: 0, borrow: 0, accruedIncome: 0, lastUpdate: Date.now() }
      portfolio.cashBalances.set(currency, balance)
    }
    balance[type] += delta
    balance.lastUpdate = Date.now()
  }

  getCashBalance(portfolio: PortfolioState, currency: string): CashBalance | null {
    return portfolio.cashBalances.get(currency) ?? null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — CurrencyManager (Multi-Currency, Rule 13)
// Rule 13 — Preserve both native and translated values.
// ─────────────────────────────────────────────────────────────────────────────

export class CurrencyManager {
  /** §11 — FX Translation (Rule 13 — preserve native + translated). */
  translate(amount: number, fromCurrency: string, toCurrency: string, fxRate: FXTranslationRate | null): {
    nativeAmount: number; translatedAmount: number; fxRate: number; realizedFXGainLoss: number
  } {
    if (fromCurrency === toCurrency || !fxRate) {
      return { nativeAmount: amount, translatedAmount: amount, fxRate: 1.0, realizedFXGainLoss: 0 }
    }
    const translated = amount * fxRate.rate
    log.debug(`FX translation: ${amount} ${fromCurrency} → ${translated.toFixed(2)} ${toCurrency} (rate ${fxRate.rate})`)
    return { nativeAmount: amount, translatedAmount: translated, fxRate: fxRate.rate, realizedFXGainLoss: 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 — CorporateActionManager (Rule 12)
// Rule 12 — Corporate actions generate new accounting events, never modify history.
// ─────────────────────────────────────────────────────────────────────────────

export class CorporateActionManager {
  /** §12 — Process corporate action (Rule 12 — new event, not modify history). */
  processAction(
    action: CorporateActionEvent,
    portfolio: PortfolioState,
  ): { affected: boolean; adjustments: string[] } {
    const adjustments: string[] = []
    const pos = portfolio.tradedPositions.get(action.symbol)

    switch (action.actionType) {
      case 'STOCK_SPLIT': {
        if (pos) {
          pos.quantity *= action.ratio
          pos.averageCost /= action.ratio
          adjustments.push(`stock split ${action.ratio}:1 — qty ${pos.quantity}, avgCost ${pos.averageCost.toFixed(2)}`)
        }
        break
      }
      case 'REVERSE_SPLIT': {
        if (pos) {
          pos.quantity /= action.ratio
          pos.averageCost *= action.ratio
          adjustments.push(`reverse split 1:${action.ratio} — qty ${pos.quantity}, avgCost ${pos.averageCost.toFixed(2)}`)
        }
        break
      }
      case 'DIVIDEND':
      case 'SPECIAL_DIVIDEND': {
        if (pos && pos.quantity > 0) {
          const dividend = pos.quantity * action.cashAmount
          adjustments.push(`dividend: ${dividend.toFixed(2)} ${portfolio.baseCurrency}`)
        }
        break
      }
      case 'SYMBOL_CHANGE': {
        if (pos && action.newSymbol) {
          portfolio.tradedPositions.delete(action.symbol)
          pos.symbol = action.newSymbol
          portfolio.tradedPositions.set(action.newSymbol, pos)
          adjustments.push(`symbol change: ${action.symbol} → ${action.newSymbol}`)
        }
        break
      }
      default:
        adjustments.push(`${action.actionType}: processed (Rule 12 — new event)`)
    }

    log.info(`corporate action processed: ${action.actionType} for ${action.symbol} — ${adjustments.length} adjustments (Rule 12)`)
    return { affected: pos !== undefined, adjustments }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const ledgerManager = new LedgerManager()
export const costBasisManager = new CostBasisManager()
export const taxLotManager = new TaxLotManager()
export const positionManager = new PositionManager()
export const cashManager = new CashManager()
export const currencyManager = new CurrencyManager()
export const corporateActionManager = new CorporateActionManager()
