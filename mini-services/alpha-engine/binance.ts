// AlphaSpot Data Ingestion Engine — Binance public API + WebSocket
// 100% free: no auth, no paid APIs. Dynamically discovers ALL tradeable USDT
// spot pairs from Binance's exchangeInfo API and streams real-time OHLCV
// for every coin on 15m / 1h / 4h, plus order book depth, futures funding
// rates, and the market-wide miniTicker array for instant price updates.

import WebSocket from 'ws'
import type { Candle, Timeframe, Symbol, OrderBookImbalance, FundingData } from '../../src/lib/alphaspot/types'

const REST = 'https://api.binance.com'
const FAPI = 'https://fapi.binance.com'
const WS_BASE = 'wss://stream.binance.com:9443/stream'

export const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h']

// Max streams per combined WS connection. Binance allows up to 1024 streams
// per connection, but the URL length is the practical limit (~8KB). We chunk
// at 200 to stay safely under the limit and allow independent reconnection.
const MAX_STREAMS_PER_CONN = 200

export const toBinanceSymbol = (s: Symbol): string => s.replace('/', '').toUpperCase()
export const toBinanceLower = (s: Symbol): string => s.replace('/', '').toLowerCase()

// Stablecoins and fiat tokens to exclude as BASE assets (boring ~$1 pairs).
const STABLE_BASES = new Set([
  'USDC', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'DAI', 'EURS', 'USDD', 'PAXG',
  'SUSD', 'GUSD', 'USDS', 'USDT', 'USD1', 'BFUSD', 'XUSD',
])

export interface SymbolInfo {
  symbol: Symbol        // "BTC/USDT"
  binanceSymbol: string // "BTCUSDT"
  base: string          // "BTC"
  quote: string         // "USDT"
}

/**
 * Fetch ALL tradeable USDT spot pairs from Binance's exchangeInfo API.
 * Filters out leveraged tokens (UP/DOWN/BULL/BEAR) and stablecoin-base pairs.
 */
export async function fetchAllSpotSymbols(): Promise<SymbolInfo[]> {
  const res = await fetch(`${REST}/api/v3/exchangeInfo`)
  if (!res.ok) throw new Error(`exchangeInfo: ${res.status}`)
  const j = (await res.json()) as {
    symbols: {
      symbol: string
      status: string
      baseAsset: string
      quoteAsset: string
      isSpotTradingAllowed: boolean
      permissions: string[]
    }[]
  }

  const out: SymbolInfo[] = []
  for (const s of j.symbols) {
    if (s.quoteAsset !== 'USDT') continue
    if (s.status !== 'TRADING') continue
    if (!s.isSpotTradingAllowed) continue
    // Skip leveraged tokens (BTCUP, BTCDOWN, ETHBULL, ETHBEAR, etc.)
    const b = s.baseAsset
    if (/(UP|DOWN|BULL|BEAR)$/.test(b)) continue
    // Skip stablecoin-base pairs (USDC/USDT etc.)
    if (STABLE_BASES.has(b)) continue
    out.push({
      symbol: `${b}/USDT`,
      binanceSymbol: s.symbol,
      base: b,
      quote: 'USDT',
    })
  }
  // Sort by base asset name for deterministic ordering
  out.sort((a, b) => a.base.localeCompare(b.base))
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback symbol list — used when Binance REST is unreachable (e.g. sandbox
// IP ban / 418). Keeps the engine online in degraded mode so the frontend
// can connect and display "Live" status. WebSocket streams will also likely
// fail in this environment, but the HTTP/socket.io server stays up.
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_BASES = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC',
  'LINK', 'TON', 'TRX', 'LTC', 'BCH', 'UNI', 'ATOM', 'XLM', 'ICP', 'FIL',
  'ARB', 'OP', 'APT', 'NEAR', 'INJ', 'SUI', 'SEI', 'TIA', 'ORDI', 'PEPE',
  'SHIB', 'WIF', 'BONK', 'FLOKI', 'JUP', 'PYTH', 'RNDR', 'GRT', 'AAVE', 'MKR',
]

export const FALLBACK_SYMBOLS: SymbolInfo[] = FALLBACK_BASES.map((b) => ({
  symbol: `${b}/USDT`,
  binanceSymbol: `${b}USDT`,
  base: b,
  quote: 'USDT',
}))

/**
 * Safe wrapper: returns fetchAllSpotSymbols() on success, FALLBACK_SYMBOLS on
 * failure. Never throws — guarantees the engine can always boot.
 */
export async function fetchAllSpotSymbolsSafe(): Promise<{
  symbols: SymbolInfo[]
  degraded: boolean
  error: string | null
}> {
  try {
    const symbols = await fetchAllSpotSymbols()
    if (symbols.length === 0) throw new Error('exchangeInfo returned 0 symbols')
    return { symbols, degraded: false, error: null }
  } catch (e) {
    console.warn(`[binance] fetchAllSpotSymbols failed — using ${FALLBACK_SYMBOLS.length} fallback symbols. Reason: ${(e as Error).message}`)
    return { symbols: FALLBACK_SYMBOLS, degraded: true, error: (e as Error).message }
  }
}

export interface Ticker24h {
  symbol: Symbol
  changePct: number
  volume: number
  quoteVolume: number
  lastPrice: number
}

/**
 * Fetch 24h ticker stats for ALL symbols in a single REST call (weight 80).
 * Used to seed the initial volume ranking and price/change data.
 */
export async function fetchAll24hTickers(): Promise<Map<Symbol, Ticker24h>> {
  const res = await fetch(`${REST}/api/v3/ticker/24hr`)
  if (!res.ok) throw new Error(`ticker24hr: ${res.status}`)
  const j = (await res.json()) as {
    symbol: string
    priceChangePercent: string
    volume: string
    quoteVolume: string
    lastPrice: string
  }[]
  const map = new Map<Symbol, Ticker24h>()
  for (const t of j) {
    // Only keep USDT pairs; reconstruct canonical "BASE/USDT" form
    if (!t.symbol.endsWith('USDT')) continue
    const base = t.symbol.slice(0, -4)
    if (STABLE_BASES.has(base)) continue
    if (/(UP|DOWN|BULL|BEAR)$/.test(base)) continue
    const sym = `${base}/USDT` as Symbol
    map.set(sym, {
      symbol: sym,
      changePct: Number(t.priceChangePercent),
      volume: Number(t.volume),
      quoteVolume: Number(t.quoteVolume),
      lastPrice: Number(t.lastPrice),
    })
  }
  return map
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
    /* ignore — not all spot symbols have futures */
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

export interface MiniTickerPayload {
  stream: string
  data:
    | Array<{
        e: string
        s: string
        c: string // close (last price)
        o: string // open
        h: string
        l: string
        v: string // volume
        q: string // quote volume
      }>
    | {
        e: string
        s: string
        c: string
        o: string
        h: string
        l: string
        v: string
        q: string
      }
}

/**
 * Connect to Binance's combined kline WebSocket for all symbols + timeframes.
 * Automatically chunks into multiple connections (MAX_STREAMS_PER_CONN each)
 * to stay under URL length limits. Calls onKline for every update.
 * Returns a cleanup function that closes all connections.
 */
export function connectKlineStream(
  symbols: Symbol[],
  timeframes: Timeframe[],
  onKline: (symbol: Symbol, tf: Timeframe, candle: Candle, isFinal: boolean) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  // Build the full list of stream names
  const allStreams: string[] = []
  for (const s of symbols) {
    const sl = toBinanceLower(s)
    for (const tf of timeframes) {
      allStreams.push(`${sl}@kline_${tf}`)
    }
  }

  // Chunk into groups
  const chunks: string[][] = []
  for (let i = 0; i < allStreams.length; i += MAX_STREAMS_PER_CONN) {
    chunks.push(allStreams.slice(i, i + MAX_STREAMS_PER_CONN))
  }

  console.log(`[binance] kline WS: ${allStreams.length} streams across ${chunks.length} connection(s)`)

  const cleanups: (() => void)[] = []
  let connectedCount = 0

  for (const chunk of chunks) {
    const url = `${WS_BASE}?streams=${chunk.join('/')}`
    let ws: WebSocket | null = null
    let closedByUser = false
    let reconnectDelay = 1000

    const connect = () => {
      ws = new WebSocket(url)
      ws.on('open', () => {
        reconnectDelay = 1000
        connectedCount++
        onStatus?.(connectedCount > 0)
        console.log(`[binance] WS chunk connected (${chunk.length} streams, ${connectedCount}/${chunks.length} chunks up)`)
      })
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as KlinePayload
          const parts = msg.stream.split('@kline_')
          const symLow = parts[0]
          const tf = parts[1] as Timeframe
          if (!tf) return
          // Reconstruct canonical symbol: "btcusdt" -> "BTC/USDT"
          const base = symLow.replace(/usdt$/, '').toUpperCase()
          const symbol = `${base}/USDT` as Symbol
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
          console.error('[binance] kline parse error', e)
        }
      })
      ws.on('error', (err) => {
        console.error('[binance] WS error', err.message)
      })
      ws.on('close', () => {
        connectedCount = Math.max(0, connectedCount - 1)
        if (connectedCount === 0) onStatus?.(false)
        if (closedByUser) return
        console.log(`[binance] WS chunk closed, reconnecting in ${reconnectDelay}ms`)
        setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 15000)
      })
    }

    connect()
    cleanups.push(() => {
      closedByUser = true
      ws?.close()
    })
  }

  return () => cleanups.forEach((fn) => fn())
}

/**
 * Connect to Binance's `!miniTicker@arr` stream — a single stream that pushes
 * an array of mini-tickers for ALL symbols every ~1 second. Extremely efficient
 * for updating 24h change % and volume across hundreds of coins with one socket.
 */
export function connectMiniTickerStream(
  onTickers: (tickers: Map<Symbol, { price: number; changePct: number; volume: number }>) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const url = `${WS_BASE}?streams=!miniTicker@arr`
  let ws: WebSocket | null = null
  let closedByUser = false
  let reconnectDelay = 1000

  const connect = () => {
    ws = new WebSocket(url)
    ws.on('open', () => {
      reconnectDelay = 1000
      onStatus?.(true)
      console.log('[binance] miniTicker WS connected')
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as MiniTickerPayload
        const arr = Array.isArray(msg.data) ? msg.data : [msg.data]
        const map = new Map<Symbol, { price: number; changePct: number; volume: number }>()
        for (const t of arr) {
          if (!t.s || !t.s.endsWith('USDT')) continue
          const base = t.s.slice(0, -4)
          if (STABLE_BASES.has(base) || /(UP|DOWN|BULL|BEAR)$/.test(base)) continue
          const sym = `${base}/USDT` as Symbol
          const close = Number(t.c)
          const open = Number(t.o)
          map.set(sym, {
            price: close,
            changePct: open > 0 ? ((close - open) / open) * 100 : 0,
            volume: Number(t.v),
          })
        }
        if (map.size > 0) onTickers(map)
      } catch (e) {
        console.error('[binance] miniTicker parse error', e)
      }
    })
    ws.on('error', (err) => {
      console.error('[binance] miniTicker WS error', err.message)
    })
    ws.on('close', () => {
      onStatus?.(false)
      if (closedByUser) return
      console.log(`[binance] miniTicker WS closed, reconnecting in ${reconnectDelay}ms`)
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

const TF_TO_MS: Record<Timeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
}
export { TF_TO_MS }
