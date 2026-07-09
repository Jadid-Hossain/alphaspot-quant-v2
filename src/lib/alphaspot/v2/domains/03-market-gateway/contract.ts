// DOMAIN 03 — MARKET GATEWAY  (Chapter 2.1 §4, Domain 03)
//
// Purpose: Communicate with external exchanges.
//
// Responsibilities:
//   • websocket connections    • symbol discovery
//   • REST synchronization     • heartbeat
//   • exchange metadata        • reconnect strategy
//   • exchange health
//
// FORBIDDEN (Chapter 2.1 §7): analysis. It only collects market information.
//
// Replaceability (Principle 3): the current Binance implementation can be
// swapped for a multi-exchange gateway without affecting downstream domains.

import type { Candle, Timeframe, OrderBookImbalance, FundingData } from '../../../types'
import type { Asset, AssetMeta } from '../../types'

export interface RawMarketEvent {
  type: 'CANDLE' | 'TICKER' | 'ORDER_BOOK' | 'FUNDING' | 'TRADE'
  asset: Asset
  timestamp: number
  payload: Candle | { price: number; changePct: number; volume: number; quoteVolume: number } | OrderBookImbalance | FundingData
}

export interface MarketGatewayContract {
  /** Discover all tradeable symbols from the exchange. */
  discoverSymbols(): Promise<AssetMeta[]>
  /** Connect to real-time streams. Returns a cleanup function. */
  connect(onEvent: (event: RawMarketEvent) => void): Promise<() => void>
  /** Fetch historical candles for seeding. */
  fetchHistoricalCandles(asset: Asset, tf: Timeframe, limit: number): Promise<Candle[]>
  /** Fetch current order book snapshot. */
  fetchOrderBook(asset: Asset, depth?: number): Promise<OrderBookImbalance>
  /** Fetch current funding data (futures). */
  fetchFunding(asset: Asset): Promise<FundingData>
  /** Connection health. */
  isHealthy(): boolean
  /** Last connection status for monitoring. */
  getConnectionStatus(): { connected: boolean; streams: number; lastMessageAt: number | null }
}

export const MARKET_GATEWAY_TOKEN = 'domain.market-gateway'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Market Gateway × Feature Engineering
 *   Market Gateway × Trading Decisions
 *
 * This domain may NOT: compute indicators, detect patterns, generate signals,
 * evaluate trades, or produce any analytical output. It only collects and
 * forwards raw market data.
 */
