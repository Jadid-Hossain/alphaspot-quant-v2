// AlphaSpot Engine — socket.io mini-service on port 3003
// Ingests Binance data, runs the confluence scorer + risk engine,
// generates LLM reasoning, persists to Prisma, and broadcasts snapshots.

import { createServer } from 'http'
import { Server } from 'socket.io'
import { db } from '../../src/lib/db'
import {
  SYMBOLS,
  TIMEFRAMES,
  fetchHistoricalKlines,
  fetch24hTicker,
  fetchOrderBookImbalance,
  fetchFundingData,
  fetchFearGreed,
  connectKlineStream,
} from './binance'
import { SUPPORTED_SYMBOLS } from '../../src/lib/alphaspot/types'
import { computeIndicators } from '../../src/lib/alphaspot/indicators'
import { detectPatterns, summarizePatterns } from '../../src/lib/alphaspot/patterns'
import { calculateConfluenceScore } from '../../src/lib/alphaspot/confluence'
import {
  evaluateRisk,
  applyBuy,
  applySell,
  simulateSell,
  markToMarket,
  emptyPosition,
  type RiskConfig,
} from '../../src/lib/alphaspot/risk-engine'
import { explainDecision, marketCommentary } from './llm'
import type {
  Symbol,
  Timeframe,
  Candle,
  SymbolSnapshot,
  EngineState,
  Position,
  ServerToClientEvents,
  ClientToServerEvents,
  Indicators,
  SentimentData,
  Patterns,
} from '../../src/lib/alphaspot/types'

const PORT = 3003
const MAX_CANDLES = 300
const EVAL_THROTTLE_MS = 2000
const ORDERBOOK_INTERVAL_MS = 10_000
const FUNDING_INTERVAL_MS = 60_000
const FNG_INTERVAL_MS = 60 * 60 * 1000
const COMMENTARY_INTERVAL_MS = 5 * 60 * 1000

// ---------- Engine state ----------
const config: RiskConfig = {
  allocatedCapital: 10_000,
  initialPct: 0.20,
  recoveryPct: 0.30,
  dropThresholdPct: 2.0,
  takeProfitPct: 1.0,
  strongBuyScore: 75,
  strongSellScore: -75,
  maxRecoveries: 2,
}

// Build per-symbol state maps dynamically from the watchlist so adding a
// new coin only requires editing SUPPORTED_SYMBOLS.
function buildRecord<T>(fn: (s: Symbol) => T): Record<string, T> {
  const r: Record<string, T> = {}
  for (const s of SYMBOLS) r[s] = fn(s)
  return r
}

const candleBuffers: Record<string, Record<Timeframe, Candle[]>> = buildRecord(() => ({
  '15m': [],
  '1h': [],
  '4h': [],
}))

const positions: Record<string, Position> = buildRecord((s) => emptyPosition(s))

// last computed 4h indicators (for macro-breakdown detection)
const prev4hInd: Record<string, Indicators | null> = buildRecord(() => null)

const ticker24h: Record<string, { changePct: number | null; volume: number | null; lastPrice: number | null }> = buildRecord(() => ({ changePct: null, volume: null, lastPrice: null }))

const orderBooks: Record<string, SymbolSnapshot['orderBook']> = buildRecord(() => null)

const funding: Record<string, SymbolSnapshot['funding']> = buildRecord(() => null)

let sentimentShared: SentimentData = {
  fearGreed: null,
  fearGreedLabel: null,
  newsScore: null,
  newsHeadlines: [],
}

// per-symbol sentiment from LLM commentary
const sentimentPerSymbol: Record<string, { score: number | null; commentary: string | null }> = buildRecord(() => ({ score: null, commentary: null }))

const lastEvalAt: Record<string, number> = buildRecord(() => 0)
let engineEnabled = true

// ---------- Helpers ----------
function nowMs() {
  return Date.now()
}

function upsertCandle(symbol: Symbol, tf: Timeframe, candle: Candle) {
  const buf = candleBuffers[symbol][tf]
  if (buf.length === 0) {
    buf.push(candle)
    return
  }
  const last = buf[buf.length - 1]
  if (candle.time === last.time) {
    buf[buf.length - 1] = candle
  } else if (candle.time > last.time) {
    buf.push(candle)
    if (buf.length > MAX_CANDLES) buf.shift()
  }
}

function buildSnapshot(symbol: Symbol): SymbolSnapshot | null {
  const buf15 = candleBuffers[symbol]['15m']
  const buf1h = candleBuffers[symbol]['1h']
  const buf4h = candleBuffers[symbol]['4h']
  if (buf15.length < 30 || buf1h.length < 30 || buf4h.length < 30) return null

  const ind15 = computeIndicators(buf15)
  const ind1h = computeIndicators(buf1h)
  const ind4h = computeIndicators(buf4h)

  // store prev 4h before overwriting (we track prev4hInd at evaluation time)
  const patterns: Patterns = detectPatterns(buf15)
  const price = buf15[buf15.length - 1].close

  const confluence = calculateConfluenceScore({
    indicators: { '15m': ind15, '1h': ind1h, '4h': ind4h },
    patterns,
    sentiment: {
      fearGreed: sentimentShared.fearGreed,
      fearGreedLabel: sentimentShared.fearGreedLabel,
      newsScore: sentimentPerSymbol[symbol].score,
      newsHeadlines: [],
    },
    orderBook: orderBooks[symbol],
    funding: funding[symbol],
    price,
  })

  let pos = markToMarket(positions[symbol], price, config.allocatedCapital)

  return {
    symbol,
    price,
    change24hPct: ticker24h[symbol].changePct,
    volume24h: ticker24h[symbol].volume,
    candles: {
      '15m': buf15.slice(-200),
      '1h': buf1h.slice(-200),
      '4h': buf4h.slice(-200),
    },
    indicators: { '15m': ind15, '1h': ind1h, '4h': ind4h },
    patterns,
    sentiment: {
      fearGreed: sentimentShared.fearGreed,
      fearGreedLabel: sentimentShared.fearGreedLabel,
      newsScore: sentimentPerSymbol[symbol].score,
      newsHeadlines: sentimentPerSymbol[symbol].commentary ? [{ title: sentimentPerSymbol[symbol].commentary!, score: sentimentPerSymbol[symbol].score ?? 0 }] : [],
    },
    orderBook: orderBooks[symbol],
    funding: funding[symbol],
    confluence,
    position: pos,
    updatedAt: nowMs(),
  }
}

function logEntry(symbol: Symbol, source: string, level: string, message: string) {
  const entry = {
    id: Math.random().toString(36).slice(2),
    symbol,
    source,
    level,
    message,
    createdAt: new Date().toISOString(),
  }
  io.emit('log', entry)
  // persist (fire and forget)
  db.reasoningLog
    .create({ data: { symbol, source, level, message } })
    .catch((e) => console.error('[db] log persist failed', e))
}

async function executeDecision(symbol: Symbol, snapshot: SymbolSnapshot) {
  const decision = evaluateRisk(
    positions[symbol],
    {
      symbol,
      price: snapshot.price,
      score: snapshot.confluence.score,
      confluence: snapshot.confluence,
      indicators: snapshot.indicators,
      prev4hIndicators: prev4hInd[symbol],
    },
    config,
  )

  if (decision.action === 'HOLD') return

  // Apply the decision
  if (decision.action === 'BUY') {
    positions[symbol] = applyBuy(
      positions[symbol],
      snapshot.price,
      decision.quantity,
      decision.quoteValue,
      decision.newState,
      decision.kind!,
      config.allocatedCapital,
    )
  } else if (decision.action === 'SELL') {
    positions[symbol] = applySell(positions[symbol], snapshot.price)
  }

  // Persist trade
  const trade = await db.trade
    .create({
      data: {
        symbol,
        side: decision.side!,
        kind: decision.kind!,
        price: snapshot.price,
        quantity: decision.quantity,
        quoteValue: decision.quoteValue,
        avgEntryPrice: positions[symbol].avgEntryPrice,
        positionQty: positions[symbol].quantity,
        state: positions[symbol].state,
        realizedPnl: decision.realizedPnl,
        score: snapshot.confluence.score,
        reason: decision.reason,
      },
    })
    .catch((e) => {
      console.error('[db] trade persist failed', e)
      return null
    })

  // Broadcast trade
  io.emit('trade', {
    id: trade?.id ?? Math.random().toString(36).slice(2),
    symbol,
    side: decision.side!,
    kind: decision.kind!,
    price: snapshot.price,
    quantity: decision.quantity,
    quoteValue: decision.quoteValue,
    state: positions[symbol].state,
    realizedPnl: decision.realizedPnl,
    score: snapshot.confluence.score,
    reason: decision.reason,
    createdAt: new Date().toISOString(),
  })

  logEntry(symbol, 'ENGINE', 'TRADE', decision.reason)

  // Ask LLM for an analyst-style explanation (non-blocking)
  explainDecision({
    symbol,
    action: decision.action,
    kind: decision.kind!,
    price: snapshot.price,
    score: snapshot.confluence.score,
    position: positions[symbol],
    confluence: snapshot.confluence,
    reasoning: decision.reason,
  })
    .then((explanation) => {
      logEntry(symbol, 'LLM', 'SIGNAL', explanation)
    })
    .catch((e) => console.error('[llm] explain failed', e))
}

async function evaluateSymbol(symbol: Symbol) {
  if (!engineEnabled) {
    // still broadcast snapshot so UI shows live data
    const snap = buildSnapshot(symbol)
    if (snap) io.emit('snapshot', snap)
    return
  }
  const snap = buildSnapshot(symbol)
  if (!snap) return

  // detect macro breakdown before overwriting prev4hInd
  // (we pass prev4hInd to evaluateRisk; update it after)
  try {
    await executeDecision(symbol, snap)
  } catch (e) {
    console.error(`[engine] decision error for ${symbol}`, e)
  }
  // update prev4h for next tick
  prev4hInd[symbol] = snap.indicators['4h']

  // persist a signal snapshot every ~60s
  if (Math.random() < 0.05) {
    db.signal
      .create({
        data: {
          symbol,
          score: snap.confluence.score,
          label: snap.confluence.label,
          state: positions[symbol].state,
          price: snap.price,
          indicatorsJson: JSON.stringify(snap.indicators),
          patternsJson: JSON.stringify(snap.patterns),
          sentiment: sentimentPerSymbol[symbol].score,
          fearGreed: sentimentShared.fearGreed,
        },
      })
      .catch((e) => console.error('[db] signal persist failed', e))
  }

  io.emit('snapshot', snap)
}

function getEngineState(): EngineState {
  return {
    enabled: engineEnabled,
    symbols: SYMBOLS,
    allocatedCapital: config.allocatedCapital,
    config: {
      initialPct: config.initialPct,
      recoveryPct: config.recoveryPct,
      dropThresholdPct: config.dropThresholdPct,
      takeProfitPct: config.takeProfitPct,
      strongBuyScore: config.strongBuyScore,
      strongSellScore: config.strongSellScore,
    },
    snapshots: buildRecord(() => null),
    lastTickAt: nowMs(),
  }
}

// ---------- Periodic fetchers ----------
async function refreshOrderBooks() {
  for (const s of SYMBOLS) {
    try {
      orderBooks[s] = await fetchOrderBookImbalance(s)
    } catch (e) {
      console.error(`[orderbook] ${s} failed`, e)
    }
  }
}

async function refreshFunding() {
  for (const s of SYMBOLS) {
    try {
      funding[s] = await fetchFundingData(s)
    } catch (e) {
      console.error(`[funding] ${s} failed`, e)
    }
  }
}

async function refreshFearGreed() {
  try {
    const fng = await fetchFearGreed()
    sentimentShared = { ...sentimentShared, fearGreed: fng.value, fearGreedLabel: fng.label }
    console.log(`[fng] Fear & Greed: ${fng.value} (${fng.label})`)
  } catch (e) {
    console.error('[fng] failed', e)
  }
}

async function refreshTickers() {
  for (const s of SYMBOLS) {
    try {
      const t = await fetch24hTicker(s)
      ticker24h[s] = { changePct: t.changePct, volume: t.volume, lastPrice: t.lastPrice }
    } catch (e) {
      console.error(`[ticker] ${s} failed`, e)
    }
  }
}

async function refreshCommentary() {
  for (const s of SYMBOLS) {
    const snap = buildSnapshot(s)
    if (!snap) continue
    try {
      const { commentary, sentiment } = await marketCommentary(snap)
      sentimentPerSymbol[s] = { score: sentiment, commentary }
      if (commentary) logEntry(s, 'LLM', 'INFO', commentary)
    } catch (e) {
      console.error(`[commentary] ${s} failed`, e)
    }
  }
}

// ---------- socket.io server ----------
const httpServer = createServer()
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`[io] client connected: ${socket.id}`)
  socket.emit('status', { ok: true, msg: 'AlphaSpot engine online' })
  socket.emit('engine', getEngineState())

  socket.on('subscribe', () => {
    // all clients get all symbols by default; no per-client filtering needed
  })

  socket.on('control', (cmd) => {
    if (cmd.action === 'start') {
      engineEnabled = true
      logEntry('BTC/USDT', 'SYSTEM', 'INFO', 'Engine ENABLED by user.')
    } else if (cmd.action === 'stop') {
      engineEnabled = false
      logEntry('BTC/USDT', 'SYSTEM', 'INFO', 'Engine PAUSED by user. Live data still streaming.')
    } else if (cmd.action === 'reset' && cmd.symbol) {
      positions[cmd.symbol] = emptyPosition(cmd.symbol)
      logEntry(cmd.symbol, 'SYSTEM', 'INFO', `Position for ${cmd.symbol} reset to FLAT (paper).`)
    }
    io.emit('engine', getEngineState())
  })

  socket.on('disconnect', () => {
    console.log(`[io] client disconnected: ${socket.id}`)
  })
})

// ---------- Boot ----------
async function boot() {
  console.log('[boot] AlphaSpot engine starting...')
  console.log('[boot] Seeding candle buffers from Binance REST...')
  await Promise.all(
    SYMBOLS.map(async (s) => {
      for (const tf of TIMEFRAMES) {
        try {
          const klines = await fetchHistoricalKlines(s, tf, MAX_CANDLES)
          candleBuffers[s][tf] = klines
          console.log(`[boot] ${s} ${tf}: ${klines.length} candles seeded`)
        } catch (e) {
          console.error(`[boot] seed failed ${s} ${tf}`, e)
        }
      }
    }),
  )

  await Promise.allSettled([refreshTickers(), refreshOrderBooks(), refreshFunding(), refreshFearGreed()])

  console.log('[boot] Connecting Binance kline WebSocket...')
  connectKlineStream(
    SYMBOLS,
    TIMEFRAMES,
    (symbol, tf, candle) => {
      upsertCandle(symbol, tf, candle)
      // evaluate on 15m ticks + every 2s throttle for responsiveness
      if (tf === '15m') {
        const now = nowMs()
        if (now - lastEvalAt[symbol] >= EVAL_THROTTLE_MS) {
          lastEvalAt[symbol] = now
          evaluateSymbol(symbol).catch((e) => console.error(`[eval] ${symbol}`, e))
        }
      }
    },
    (connected) => {
      logEntry(SUPPORTED_SYMBOLS[0], 'SYSTEM', connected ? 'INFO' : 'WARN', connected ? `Binance stream connected (${SYMBOLS.length * TIMEFRAMES.length} streams).` : 'Binance stream disconnected — reconnecting.')
    },
  )

  // periodic loops
  setInterval(refreshOrderBooks, ORDERBOOK_INTERVAL_MS)
  setInterval(refreshFunding, FUNDING_INTERVAL_MS)
  setInterval(refreshFearGreed, FNG_INTERVAL_MS)
  setInterval(refreshTickers, 60_000)
  setInterval(refreshCommentary, COMMENTARY_INTERVAL_MS)
  // first commentary after 30s (let data settle)
  setTimeout(refreshCommentary, 30_000)
  // broadcast engine state every 15s
  setInterval(() => io.emit('engine', getEngineState()), 15_000)

  httpServer.listen(PORT, () => {
    console.log(`[io] AlphaSpot engine listening on port ${PORT}`)
    logEntry('BTC/USDT', 'SYSTEM', 'INFO', `AlphaSpot engine online. Allocated capital $${config.allocatedCapital}. Scanning ${SUPPORTED_SYMBOLS.length} coins on 15m/1h/4h: ${SUPPORTED_SYMBOLS.map((s) => s.split('/')[0]).join(', ')}.`)
  })
}

boot().catch((e) => {
  console.error('[boot] FATAL', e)
  process.exit(1)
})

// graceful shutdown
const shutdown = (sig: string) => {
  console.log(`\n[shutdown] ${sig} received, closing...`)
  io.close()
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
