// AlphaSpot Data Ingestion Engine — Binance public API + WebSocket
// 100% free: no auth, no paid APIs. Streams real-time OHLCV for the full
// SUPPORTED_SYMBOLS watchlist on 15m / 1h / 4h, plus order book depth,
// futures funding rates, and open interest.

import WebSocket from 'ws'
import { SUPPORTED_SYMBOLS, type Candle, type Timeframe, type Symbol, type OrderBookImbalance, type FundingData } from '../../src/lib/alphaspot/types'

const REST = 'https://api.binance.com'
const FAPI = 'https://fapi.binance.com'
const WS_BASE = 'wss://stream.binance.com:9443/stream'

export const SYMBOLS: Symbol[] = SUPPORTED_SYMBOLS
export const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h']

export const toBinanceSymbol = (s: Symbol): string => s.replace('/', '').toUpperCase()
export const toBinanceLower = (s: Symbol): string => s.replace('/', '').toLowerCase()

// Build a lookup from Binance's lowercase stream prefix (e.g. "btcusdt") back
// to our canonical pair string ("BTC/USDT"). Built once from SUPPORTED_SYMBOLS.
const STREAM_TO_SYMBOL: Record<string, Symbol> = {}
for (const s of SUPPORTED_SYMBOLS) STREAM_TO_SYMBOL[toBinanceLower(s)] = s

const TF_TO_MS: Record<Timeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
}

export interface KlinePayload {
  stream: string
  data: {
    e: string
    E: number
    s: string
    k: {
      t: number
      T: number
      s: string
      i: string
      o: string
      h: string
      l: string
      c: string
      v: string
      x: boolean
      q: string
    }
  }
}

/** Fetch historical klines to seed the indicator buffers */
export async function fetchHistoricalKlines(symbol: Symbol, interval: Timeframe, limit = 300): Promise<Candle[]> {
  const s = toBinanceSymbol(symbol)
  const url = `${REST}/api/v3/klines?symbol=${s}&interval=${interval}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`klines ${symbol} ${interval}: ${res.status}`)
  const raw = (await res.json()) as unknown[][]
  return raw.map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }))
}

/** Fetch 24h ticker stats */
export async function fetch24hTicker(symbol: Symbol): Promise<{ changePct: number; volume: number; lastPrice: number }> {
  const s = toBinanceSymbol(symbol)
  const res = await fetch(`${REST}/api/v3/ticker/24hr?symbol=${s}`)
  if (!res.ok) throw new Error(`ticker ${symbol}: ${res.status}`)
  const j = (await res.json()) as { priceChangePercent: string; volume: string; lastPrice: string }
  return {
    changePct: Number(j.priceChangePercent),
    volume: Number(j.volume),
    lastPrice: Number(j.lastPrice),
  }
}

/** Fetch order book depth and compute bid/ask volume imbalance */
export async function fetchOrderBookImbalance(symbol: Symbol, limit = 50): Promise<OrderBookImbalance> {
  const s = toBinanceSymbol(symbol)
  const res = await fetch(`${REST}/api/v3/depth?symbol=${s}&limit=${limit}`)
  if (!res.ok) throw new Error(`depth ${symbol}: ${res.status}`)
  const j = (await res.json()) as { bids: [string, string][]; asks: [string, string][] }
  const bidVolume = j.bids.reduce((a, b) => a + Number(b[0]) * Number(b[1]), 0)
  const askVolume = j.asks.reduce((a, b) => a + Number(b[0]) * Number(b[1]), 0)
  const total = bidVolume + askVolume
  return { bidVolume, askVolume, imbalance: total > 0 ? (bidVolume - askVolume) / total : 0 }
}

/** Fetch futures funding rate + open interest (free, no auth) */
export async function fetchFundingData(symbol: Symbol): Promise<FundingData> {
  const s = toBinanceSymbol(symbol)
  let fundingRate: number | null = null
  let nextFundingMs: number | null = null
  let openInterest: number | null = null
  try {
    const r1 = await fetch(`${FAPI}/fapi/v1/premiumIndex?symbol=${s}`)
    if (r1.ok) {
      const j = (await r1.json()) as { fundingRate: string; nextFundingTime: number }
      fundingRate = Number(j.fundingRate)
      nextFundingMs = j.nextFundingTime
    }
  } catch {
    /* ignore */
  }
  try {
    const r2 = await fetch(`${FAPI}/fapi/v1/openInterest?symbol=${s}`)
    if (r2.ok) {
      const j = (await r2.json()) as { openInterest: string }
      openInterest = Number(j.openInterest)
    }
  } catch {
    /* ignore */
  }
  return { fundingRate, openInterest, nextFundingMs }
}

/** Fetch the Fear & Greed index from Alternative.me (free, no auth) */
export async function fetchFearGreed(): Promise<{ value: number; label: string }> {
  const res = await fetch('https://api.alternative.me/fng/?limit=1')
  if (!res.ok) throw new Error(`fng: ${res.status}`)
  const j = (await res.json()) as { data: { value: string; value_classification: string }[] }
  return { value: Number(j.data[0].value), label: j.data[0].value_classification }
}

/**
 * Connect to Binance's combined kline WebSocket for all symbols + timeframes.
 * Calls onKline for every update. Auto-reconnects with backoff.
 */
export function connectKlineStream(
  symbols: Symbol[],
  timeframes: Timeframe[],
  onKline: (symbol: Symbol, tf: Timeframe, candle: Candle, isFinal: boolean) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const streams: string[] = []
  for (const s of symbols) {
    const sl = toBinanceLower(s)
    for (const tf of timeframes) {
      streams.push(`${sl}@kline_${tf}`)
    }
  }
  const url = `${WS_BASE}?streams=${streams.join('/')}`

  let ws: WebSocket | null = null
  let closedByUser = false
  let reconnectDelay = 1000

  const connect = () => {
    ws = new WebSocket(url)
    ws.on('open', () => {
      reconnectDelay = 1000
      onStatus?.(true)
      console.log(`[binance] WS connected (${streams.length} streams)`)
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as KlinePayload
        // stream format: "btcusdt@kline_15m" -> ["btcusdt", "15m"]
        const parts = msg.stream.split('@kline_')
        const symLow = parts[0]
        const tf = parts[1] as Timeframe
        const symbol = STREAM_TO_SYMBOL[symLow]
        if (!symbol || !tf) return
        const k = msg.data.k
        const candle: Candle = {
          time: Math.floor(k.t / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        }
        onKline(symbol, tf, candle, k.x)
      } catch (e) {
        console.error('[binance] parse error', e)
      }
    })
    ws.on('error', (err) => {
      console.error('[binance] WS error', err.message)
    })
    ws.on('close', () => {
      onStatus?.(false)
      if (closedByUser) return
      console.log(`[binance] WS closed, reconnecting in ${reconnectDelay}ms`)
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 15000)
    })
  }

  connect()

  return () => {
    closedByUser = true
    ws?.close()
  }
}

export { TF_TO_MS }
