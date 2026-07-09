// DOMAIN 04 — MARKET DATA  (Chapter 2.1 §4, Domain 04)
//
// Purpose: Store raw market information.
//
// Responsibilities:
//   • tick history          • funding history
//   • candle history        • market snapshots
//   • orderbook snapshots   • historical archive
//   • trade history
//
// FORBIDDEN (Chapter 2.1 §7): calculations, trading decisions.
// This domain owns raw market data. No calculations occur here.
//
// It also owns the STRUCTURAL VALIDATION gate (Chapter 1 §7-A) because
// eligibility is a data-quality property, not an analytical one.

import type { Candle, Timeframe, OrderBookImbalance, FundingData } from '../../../types'
import type { Asset, AssetEligibility, StructuralConstraints } from '../../types'

export interface MarketDataContract {
  // ── Raw data access (in-memory cache) ──
  getPrice(asset: Asset): number | null
  getCandles(asset: Asset, tf: Timeframe): Candle[] | null
  getOrderBook(asset: Asset): OrderBookImbalance | null
  getFunding(asset: Asset): FundingData | null
  get24hStats(asset: Asset): { changePct: number | null; volume: number | null; quoteVolume: number | null } | null
  getKnownAssets(): Asset[]

  // ── Structural validation (data-quality gate) ──
  validateEligibility(assets: Asset[], constraints: StructuralConstraints): Promise<AssetEligibility[]>
  getEligibleAssets(): Asset[]

  // ── Historical archive (delegated to Persistence) ──
  archiveSnapshot(snapshot: unknown): Promise<void>

  // ── Ingestion (called by Market Gateway via RawMarketEvent) ──
  ingestCandle(asset: Asset, tf: Timeframe, candle: Candle): void
  ingestPrice(asset: Asset, price: number): void
  ingestOrderBook(asset: Asset, ob: OrderBookImbalance): void
  ingestFunding(asset: Asset, funding: FundingData): void
  ingest24hStats(asset: Asset, stats: { changePct: number; volume: number; quoteVolume: number }): void
}

export const MARKET_DATA_TOKEN = 'domain.market-data'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Market Data × Trading Decisions
 *   Market Data × Calculations
 *
 * This domain may NOT: recommend trades, score assets, compute indicators, or
 * produce any analytical output. It only stores and serves raw market data.
 */
