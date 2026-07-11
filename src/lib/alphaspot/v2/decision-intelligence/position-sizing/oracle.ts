// CHAPTER 5.5 §3, Rule 22 — Real-Time Price & FX Conversion Oracle
//
// Rule 22 — Notional allocations approved by the Risk Management Engine shall
//           be translated into asset quantities EXCLUSIVELY through approved
//           Real-Time Price and Foreign Exchange Conversion Oracles.
//           Translation sources shall be versioned and recorded in complete
//           position lineage.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { FXOracleEntry, PriceOracleEntry } from './types'

const log = createLogger('decision-intelligence:position-sizing:oracle')

// ─────────────────────────────────────────────────────────────────────────────
// PriceFXOracle — provides real-time prices and FX conversion rates (Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export class PriceFXOracle {
  /** symbol → latest price entry. */
  private prices = new Map<string, PriceOracleEntry>()
  /** "FROM:TO" → FX rate entry. */
  private fxRates = new Map<string, FXOracleEntry>()
  /** Oracle source identifier (Rule 22 — versioned). */
  private source: string
  private sourceVersion: string

  constructor(source: string = 'alphaspot-oracle', sourceVersion: string = '1.0.0') {
    this.source = source
    this.sourceVersion = sourceVersion
  }

  /**
   * Update the price for a symbol (Rule 22).
   */
  updatePrice(symbol: string, price: number, quoteCurrency: string, confidence: number = 1.0, currentTime: number = Date.now()): void {
    if (!Number.isFinite(price) || price <= 0) {
      log.warn(`invalid price for ${symbol}: ${price} — ignored`)
      return
    }
    const entry: PriceOracleEntry = {
      symbol, price, quoteCurrency, timestamp: currentTime,
      source: this.source, sourceVersion: this.sourceVersion, confidence,
    }
    this.prices.set(symbol, entry)
    log.debug(`price updated: ${symbol} = ${price} ${quoteCurrency} (conf ${confidence})`)
  }

  /**
   * Update an FX conversion rate (Rule 22).
   */
  updateFXRate(fromCurrency: string, toCurrency: string, rate: number, confidence: number = 1.0, currentTime: number = Date.now()): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      log.warn(`invalid FX rate ${fromCurrency}→${toCurrency}: ${rate} — ignored`)
      return
    }
    const key = this.fxKey(fromCurrency, toCurrency)
    const entry: FXOracleEntry = {
      fromCurrency, toCurrency, rate, timestamp: currentTime,
      source: this.source, sourceVersion: this.sourceVersion, confidence,
    }
    this.fxRates.set(key, entry)
    log.debug(`FX rate updated: ${fromCurrency}→${toCurrency} = ${rate}`)
  }

  /**
   * Get the current price for a symbol (Rule 22).
   * Returns null if price not available.
   */
  getPrice(symbol: string): PriceOracleEntry | null {
    return this.prices.get(symbol) ?? null
  }

  /**
   * Get the FX conversion rate (Rule 22).
   * Returns 1.0 if from === to (no conversion needed).
   * Returns null if rate not available.
   */
  getFXRate(fromCurrency: string, toCurrency: string): FXOracleEntry | null {
    if (fromCurrency === toCurrency) {
      return {
        fromCurrency, toCurrency, rate: 1.0, timestamp: Date.now(),
        source: this.source, sourceVersion: this.sourceVersion, confidence: 1.0,
      }
    }
    return this.fxRates.get(this.fxKey(fromCurrency, toCurrency)) ?? null
  }

  /**
   * Translate a notional amount from one currency to another (Rule 22).
   * Returns the converted amount and the FX entry used.
   */
  translateCurrency(amount: number, fromCurrency: string, toCurrency: string): { converted: number; fxEntry: FXOracleEntry | null } {
    if (fromCurrency === toCurrency) {
      return { converted: amount, fxEntry: null }
    }
    const fxEntry = this.getFXRate(fromCurrency, toCurrency)
    if (!fxEntry) {
      log.warn(`no FX rate for ${fromCurrency}→${toCurrency} — cannot translate`)
      return { converted: amount, fxEntry: null }
    }
    return { converted: amount * fxEntry.rate, fxEntry }
  }

  /**
   * Translate a notional allocation into asset quantity (Rule 22).
   * quantity = notionalValue / price
   * Handles FX conversion if the notional currency differs from the price quote currency.
   */
  translateNotionalToQuantity(
    notionalValue: number,
    notionalCurrency: string,
    symbol: string,
  ): { quantity: number; priceEntry: PriceOracleEntry | null; fxEntry: FXOracleEntry | null; error: string | null } {
    const priceEntry = this.getPrice(symbol)
    if (!priceEntry) {
      return { quantity: 0, priceEntry: null, fxEntry: null, error: `no price available for ${symbol}` }
    }

    // If notional currency differs from price quote currency, translate
    let adjustedNotional = notionalValue
    let fxEntry: FXOracleEntry | null = null
    if (notionalCurrency !== priceEntry.quoteCurrency) {
      const translation = this.translateCurrency(notionalValue, notionalCurrency, priceEntry.quoteCurrency)
      if (translation.fxEntry === null && notionalCurrency !== priceEntry.quoteCurrency) {
        return { quantity: 0, priceEntry, fxEntry: null, error: `no FX rate for ${notionalCurrency}→${priceEntry.quoteCurrency}` }
      }
      adjustedNotional = translation.converted
      fxEntry = translation.fxEntry
    }

    if (priceEntry.price <= 0) {
      return { quantity: 0, priceEntry, fxEntry, error: `invalid price for ${symbol}: ${priceEntry.price}` }
    }

    const quantity = adjustedNotional / priceEntry.price
    return { quantity, priceEntry, fxEntry, error: null }
  }

  /** Get oracle source info (Rule 22 — versioned). */
  getSource(): { source: string; sourceVersion: string } {
    return { source: this.source, sourceVersion: this.sourceVersion }
  }

  /** List all cached symbols. */
  listSymbols(): string[] {
    return Array.from(this.prices.keys())
  }

  private fxKey(from: string, to: string): string {
    return `${from}:${to}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton oracle
// ─────────────────────────────────────────────────────────────────────────────

export const priceFXOracle = new PriceFXOracle()
