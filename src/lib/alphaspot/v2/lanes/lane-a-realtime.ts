// Lane A — Real-Time Processing  (Chapter 1 §8)
//
// Ultra-low latency market monitoring. Live market ingestion, order flow,
// order book updates, and short-lived in-memory state. This lane prioritizes
// responsiveness and NEVER blocks on analytical work.
//
// In V2, Lane A is a thin adapter over the existing V1 engine's in-memory
// state (candle buffers, order books, funding, tickers). It exposes a stable
// read interface for Lane B and a subscription interface for live UI updates.

import type { Candle, Timeframe, OrderBookImbalance, FundingData } from '../../types'
import type { Asset, LaneARealtime, LaneAEvent } from '../types'

/**
 * Registry pattern: the actual real-time data lives in the engine process.
 * Lane A consumers register a data provider (the engine) and Lane A exposes
 * a read-only + subscribe interface. This keeps Lane A pure and testable.
 */
export interface LaneADataProvider {
  getPrice(asset: Asset): number | null
  getOrderBook(asset: Asset): OrderBookImbalance | null
  getFunding(asset: Asset): FundingData | null
  get24hStats(asset: Asset): { changePct: number | null; volume: number | null; quoteVolume: number | null } | null
  getCandles(asset: Asset, tf: Timeframe): Candle[] | null
  getKnownAssets(): Asset[]
  subscribe(handler: (asset: Asset, event: LaneAEvent) => void): () => void
}

let provider: LaneADataProvider | null = null

/** Register the real-time data provider (called once by the engine at boot). */
export function registerLaneAProvider(p: LaneADataProvider): void {
  provider = p
}

function requireProvider(): LaneADataProvider {
  if (!provider) {
    throw new Error('[LaneA] No data provider registered. Call registerLaneAProvider() first.')
  }
  return provider
}

/** The Lane A facade — read-only access to the real-time market cache. */
export const LaneA: LaneARealtime = {
  getPrice(asset) {
    return provider?.getPrice(asset) ?? null
  },
  getOrderBook(asset) {
    return provider?.getOrderBook(asset) ?? null
  },
  getFunding(asset) {
    return provider?.getFunding(asset) ?? null
  },
  get24hStats(asset) {
    return provider?.get24hStats(asset) ?? null
  },
  getCandles(asset, tf) {
    return provider?.getCandles(asset, tf) ?? null
  },
  subscribe(handler) {
    return requireProvider().subscribe(handler)
  },
}

/** Convenience: list all assets Lane A currently knows about. */
export function getKnownAssets(): Asset[] {
  return provider?.getKnownAssets() ?? []
}
