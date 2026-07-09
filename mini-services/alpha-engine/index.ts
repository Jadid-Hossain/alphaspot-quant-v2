// AlphaSpot Engine — socket.io mini-service on port 3003
// Ingests Binance data for ALL tradeable USDT spot pairs, runs the confluence
// scorer + risk engine, generates LLM reasoning, persists to Prisma, and
// broadcasts snapshots + instant price ticks.
//
// Architecture:
//   - Dynamic symbol discovery via exchangeInfo (350+ coins)
//   - Chunked kline WebSocket connections (200 streams each)
//   - miniTicker@arr stream for 1-second 24h change/volume updates
//   - Instant priceTick broadcast on every kline update (no throttle)
//   - Round-robin evaluation queue for indicator computation (caps CPU)
//   - Concurrency-limited REST seeding (respects Binance weight limits)

import { createServer } from 'http'
import { Server } from 'socket.io'
import { db } from '../../src/lib/db'
import {
  TIMEFRAMES,
  fetchAllSpotSymbols,
  fetchAll24hTickers,
  fetchHistoricalKlines,
  fetchOrderBookImbalance,
  fetchFundingData,
  fetchFearGreed,
  connectKlineStream,
  connectMiniTickerStream,
  type SymbolInfo,
} from './binance'
import { computeIndicators } from '../../src/lib/alphaspot/indicators'
import { detectPatterns } from '../../src/lib/alphaspot/patterns'
import { calculateConfluenceScore } from '../../src/lib/alphaspot/confluence'
import {
  evaluateRisk,
  applyBuy,
  applySell,
  markToMarket,
  emptyPosition,
  type RiskConfig,
} from '../../src/lib/alphaspot/risk-engine'
import { explainDecision, marketCommentary } from './llm'
import {
  shouldDropForCompliance,
  setShariahMode,
  isShariahModeEnabled,
  loadComplianceCache,
  getComplianceSummary,
} from './compliance-gate'
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
  PriceTick,
} from '../../src/lib/alphaspot/types'

const PORT = 3003
const MAX_CANDLES = 300
const SEED_CONCURRENCY = 15        // parallel REST calls during seeding
const EVAL_BATCH_SIZE = 8          // coins evaluated per round-robin tick
const EVAL_TICK_MS = 300           // round-robin interval → ~27 coins/sec
const ORDERBOOK_INTERVAL_MS = 30_000
const FUNDING_INTERVAL_MS = 120_000
const FNG_INTERVAL_MS = 60 * 60 * 1000
const COMMENTARY_INTERVAL_MS = 10 * 60 * 1000  // less frequent with many coins
const ENGINE_BROADCAST_MS = 15_000

// ---------- Engine config ----------
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

// ---------- Dynamic state (populated at boot) ----------
let SYMBOLS: Symbol[] = []
let SYMBOL_INFOS: SymbolInfo[] = []

const candleBuffers = new Map<Symbol, Record<Timeframe, Candle[]>>()
const positions = new Map<Symbol, Position>()
const prev4hInd = new Map<Symbol, Indicators | null>()
const ticker24h = new Map<Symbol, { changePct: number | null; volume: number | null; lastPrice: number | null }>()
const orderBooks = new Map<Symbol, SymbolSnapshot['orderBook']>()
const funding = new Map<Symbol, SymbolSnapshot['funding']>()
const sentimentPerSymbol = new Map<Symbol, { score: number | null; commentary: string | null }>()
const lastEvalAt = new Map<Symbol, number>()

let sentimentShared: SentimentData = {
  fearGreed: null,
  fearGreedLabel: null,
  newsScore: null,
  newsHeadlines: [],
}

let engineEnabled = true

// ---------- Helpers ----------
function nowMs() {
  return Date.now()
}

function initSymbolState(s: Symbol) {
  candleBuffers.set(s, { '15m': [], '1h': [], '4h': [] })
  positions.set(s, emptyPosition(s))
  prev4hInd.set(s, null)
  ticker24h.set(s, { changePct: null, volume: null, lastPrice: null })
  orderBooks.set(s, null)
  funding.set(s, null)
  sentimentPerSymbol.set(s, { score: null, commentary: null })
  lastEvalAt.set(s, 0)
}

function upsertCandle(symbol: Symbol, tf: Timeframe, candle: Candle) {
  const buf = candleBuffers.get(symbol)?.[tf]
  if (!buf) return
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
  const bufs = candleBuffers.get(symbol)
  if (!bufs) return null
  const buf15 = bufs['15m']
  const buf1h = bufs['1h']
  const buf4h = bufs['4h']
  if (buf15.length < 30 || buf1h.length < 30 || buf4h.length < 30) return null

  const ind15 = computeIndicators(buf15)
  const ind1h = computeIndicators(buf1h)
  const ind4h = computeIndicators(buf4h)
  const patterns: Patterns = detectPatterns(buf15)
  const price = buf15[buf15.length - 1].close
  const sent = sentimentPerSymbol.get(symbol)!
  const ob = orderBooks.get(symbol) ?? null
  const fd = funding.get(symbol) ?? null
  const tk = ticker24h.get(symbol)!

  const confluence = calculateConfluenceScore({
    indicators: { '15m': ind15, '1h': ind1h, '4h': ind4h },
    patterns,
    sentiment: {
      fearGreed: sentimentShared.fearGreed,
      fearGreedLabel: sentimentShared.fearGreedLabel,
      newsScore: sent.score,
      newsHeadlines: sent.commentary ? [{ title: sent.commentary, score: sent.score ?? 0 }] : [],
    },
    orderBook: ob,
    funding: fd,
    price,
  })

  const pos = markToMarket(positions.get(symbol)!, price, config.allocatedCapital)

  return {
    symbol,
    price,
    change24hPct: tk.changePct,
    volume24h: tk.volume,
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
      newsScore: sent.score,
      newsHeadlines: sent.commentary ? [{ title: sent.commentary, score: sent.score ?? 0 }] : [],
    },
    orderBook: ob,
    funding: fd,
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
  db.reasoningLog
    .create({ data: { symbol, source, level, message } })
    .catch((e) => console.error('[db] log persist failed', e))
}

async function executeDecision(symbol: Symbol, snapshot: SymbolSnapshot) {
  const decision = evaluateRisk(
    positions.get(symbol)!,
    {
      symbol,
      price: snapshot.price,
      score: snapshot.confluence.score,
      confluence: snapshot.confluence,
      indicators: snapshot.indicators,
      prev4hIndicators: prev4hInd.get(symbol) ?? null,
    },
    config,
  )

  if (decision.action === 'HOLD') return

  if (decision.action === 'BUY') {
    const newPos = applyBuy(
      positions.get(symbol)!,
      snapshot.price,
      decision.quantity,
      decision.quoteValue,
      decision.newState,
      decision.kind!,
      config.allocatedCapital,
    )
    positions.set(symbol, newPos)
  } else if (decision.action === 'SELL') {
    positions.set(symbol, applySell(positions.get(symbol)!, snapshot.price))
  }

  const trade = await db.trade
    .create({
      data: {
        symbol,
        side: decision.side!,
        kind: decision.kind!,
        price: snapshot.price,
        quantity: decision.quantity,
        quoteValue: decision.quoteValue,
        avgEntryPrice: positions.get(symbol)!.avgEntryPrice,
        positionQty: positions.get(symbol)!.quantity,
        state: positions.get(symbol)!.state,
        realizedPnl: decision.realizedPnl,
        score: snapshot.confluence.score,
        reason: decision.reason,
      },
    })
    .catch((e) => {
      console.error('[db] trade persist failed', e)
      return null
    })

  io.emit('trade', {
    id: trade?.id ?? Math.random().toString(36).slice(2),
    symbol,
    side: decision.side!,
    kind: decision.kind!,
    price: snapshot.price,
    quantity: decision.quantity,
    quoteValue: decision.quoteValue,
    state: positions.get(symbol)!.state,
    realizedPnl: decision.realizedPnl,
    score: snapshot.confluence.score,
    reason: decision.reason,
    createdAt: new Date().toISOString(),
  })

  logEntry(symbol, 'ENGINE', 'TRADE', decision.reason)

  explainDecision({
    symbol,
    action: decision.action,
    kind: decision.kind!,
    price: snapshot.price,
    score: snapshot.confluence.score,
    position: positions.get(symbol)!,
    confluence: snapshot.confluence,
    reasoning: decision.reason,
  })
    .then((explanation) => logEntry(symbol, 'LLM', 'SIGNAL', explanation))
    .catch((e) => console.error('[llm] explain failed', e))
}

async function evaluateSymbol(symbol: Symbol) {
  // ── SHARIAH COMPLIANCE GATE (§2) ──
  // If shariahMode is ON and the asset is non-compliant, drop it instantly
  // BEFORE any feature engineering, ML inference, or risk calculations.
  if (shouldDropForCompliance(symbol)) {
    return // Non-compliant asset — dropped from evaluation queue
  }

  const snap = buildSnapshot(symbol)
  if (!snap) return

  if (engineEnabled) {
    try {
      await executeDecision(symbol, snap)
    } catch (e) {
      console.error(`[engine] decision error for ${symbol}`, e)
    }
  }
  prev4hInd.set(symbol, snap.indicators['4h'])

  // Occasionally persist a signal snapshot to the DB (for history)
  if (Math.random() < 0.02) {
    db.signal
      .create({
        data: {
          symbol,
          score: snap.confluence.score,
          label: snap.confluence.label,
          state: positions.get(symbol)!.state,
          price: snap.price,
          indicatorsJson: JSON.stringify(snap.indicators),
          patternsJson: JSON.stringify(snap.patterns),
          sentiment: sentimentPerSymbol.get(symbol)!.score,
          fearGreed: sentimentShared.fearGreed,
        },
      })
      .catch((e) => console.error('[db] signal persist failed', e))
  }

  io.emit('snapshot', snap)
}

function getEngineState(): EngineState {
  const snapMap: Record<string, SymbolSnapshot | null> = {}
  for (const s of SYMBOLS) snapMap[s] = null
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
    snapshots: snapMap,
    lastTickAt: nowMs(),
  }
}

// ---------- Concurrency-limited batch runner ----------
async function runBatch<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++
      try {
        results[cur] = await fn(items[cur])
      } catch {
        /* swallow — errors logged by caller */
      }
    }
  })
  await Promise.all(workers)
  return results
}

// ---------- Periodic fetchers (only for top coins to limit API weight) ----------
async function refreshOrderBooks() {
  // Only fetch order books for top 40 coins by volume to respect rate limits
  const top = [...SYMBOLS].slice(0, 40)
  await runBatch(top, 8, async (s) => {
    try {
      orderBooks.set(s, await fetchOrderBookImbalance(s))
    } catch (e) {
      console.error(`[orderbook] ${s} failed`, e)
    }
  })
}

async function refreshFunding() {
  const top = [...SYMBOLS].slice(0, 40)
  await runBatch(top, 8, async (s) => {
    try {
      funding.set(s, await fetchFundingData(s))
    } catch (e) {
      console.error(`[funding] ${s} failed`, e)
    }
  })
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

async function refreshCommentary() {
  // Commentary only for top 12 coins (LLM calls are expensive)
  const top = [...SYMBOLS].slice(0, 12)
  for (const s of top) {
    const snap = buildSnapshot(s)
    if (!snap) continue
    try {
      const { commentary, sentiment } = await marketCommentary(snap)
      sentimentPerSymbol.get(s)!.score = sentiment
      sentimentPerSymbol.get(s)!.commentary = commentary
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

  socket.on('control', (cmd) => {
    if (cmd.action === 'start') {
      engineEnabled = true
      logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'INFO', 'Engine ENABLED by user.')
    } else if (cmd.action === 'stop') {
      engineEnabled = false
      logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'INFO', 'Engine PAUSED by user. Live data still streaming.')
    } else if (cmd.action === 'reset' && cmd.symbol) {
      positions.set(cmd.symbol, emptyPosition(cmd.symbol))
      logEntry(cmd.symbol, 'SYSTEM', 'INFO', `Position for ${cmd.symbol} reset to FLAT (paper).`)
    } else if (cmd.action === 'shariah-on') {
      setShariahMode(true)
      logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'INFO', 'Shariah Compliance Mode ENABLED. Non-compliant assets filtered from pipeline. Execution locked to unleveraged Spot.')
    } else if (cmd.action === 'shariah-off') {
      setShariahMode(false)
      logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'INFO', 'Shariah Compliance Mode DISABLED.')
    }
    io.emit('engine', getEngineState())
  })

  socket.on('disconnect', () => {
    console.log(`[io] client disconnected: ${socket.id}`)
  })
})

// ---------- Round-robin evaluation queue ----------
let evalCursor = 0
function startEvalQueue() {
  setInterval(async () => {
    if (SYMBOLS.length === 0) return
    const batch: Symbol[] = []
    for (let i = 0; i < EVAL_BATCH_SIZE && i < SYMBOLS.length; i++) {
      batch.push(SYMBOLS[evalCursor % SYMBOLS.length])
      evalCursor++
    }
    await Promise.all(batch.map((s) => evaluateSymbol(s).catch((e) => console.error(`[eval] ${s}`, e))))
  }, EVAL_TICK_MS)
}

// ---------- Boot ----------
async function boot() {
  console.log('[boot] AlphaSpot engine starting...')

  // 1. Discover ALL tradeable USDT spot pairs
  console.log('[boot] Fetching exchangeInfo (all USDT spot pairs)...')
  SYMBOL_INFOS = await fetchAllSpotSymbols()
  SYMBOLS = SYMBOL_INFOS.map((s) => s.symbol)
  console.log(`[boot] Discovered ${SYMBOLS.length} tradeable USDT spot pairs`)

  // 2. Initialize per-symbol state
  for (const s of SYMBOLS) initSymbolState(s)

  // 3. Fetch all 24h tickers in ONE call (for volume ranking + initial prices)
  console.log('[boot] Fetching 24h tickers for all symbols...')
  const tickerMap = await fetchAll24hTickers()
  for (const [sym, t] of tickerMap) {
    if (ticker24h.has(sym)) {
      ticker24h.set(sym, { changePct: t.changePct, volume: t.volume, lastPrice: t.lastPrice })
    }
  }
  // Sort SYMBOLS by 24h quote volume descending (most liquid first) — so
  // top coins get seeded + evaluated first, and order-book/funding/commentary
  // (which only cover the top N) target the most relevant coins.
  SYMBOLS.sort((a, b) => (tickerMap.get(b)?.quoteVolume ?? 0) - (tickerMap.get(a)?.quoteVolume ?? 0))
  console.log(`[boot] Sorted by volume. Top 5: ${SYMBOLS.slice(0, 5).map((s) => `${s.split('/')[0]}($${(tickerMap.get(s)?.quoteVolume ?? 0).toFixed(0)})`).join(', ')}`)

  // 4. Connect miniTicker stream (instant 24h change/volume updates for ALL coins)
  console.log('[boot] Connecting miniTicker stream...')
  connectMiniTickerStream((map) => {
    for (const [sym, t] of map) {
      const existing = ticker24h.get(sym)
      if (existing) {
        existing.changePct = t.changePct
        existing.volume = t.volume
        existing.lastPrice = t.price
      }
    }
  })

  // 5. Connect kline WebSocket (chunked) — prices start flowing immediately
  console.log('[boot] Connecting kline WebSocket (chunked)...')
  connectKlineStream(
    SYMBOLS,
    TIMEFRAMES,
    (symbol, tf, candle) => {
      upsertCandle(symbol, tf, candle)
      // INSTANT price tick broadcast — no throttle, no indicator computation.
      // This is what makes the displayed price match Binance in real-time.
      if (tf === '15m') {
        const tk = ticker24h.get(symbol)
        const tick: PriceTick = {
          symbol,
          price: candle.close,
          change24hPct: tk?.changePct ?? null,
          volume24h: tk?.volume ?? null,
          time: candle.time,
        }
        io.emit('priceTick', tick)
      }
    },
    (connected) => {
      if (connected) {
        logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'INFO', `Binance kline stream connected.`)
      } else {
        logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'WARN', 'Binance kline stream disconnected — reconnecting.')
      }
    },
  )

  // 6. Seed candle buffers in background (concurrency-limited) — indicators
  //    come online progressively as each coin's buffers fill.
  console.log(`[boot] Seeding ${SYMBOLS.length}×${TIMEFRAMES.length} candle buffers (concurrency=${SEED_CONCURRENCY})...`)
  const seedTasks: { symbol: Symbol; tf: Timeframe }[] = []
  for (const s of SYMBOLS) {
    for (const tf of TIMEFRAMES) seedTasks.push({ symbol: s, tf })
  }
  let seeded = 0
  runBatch(seedTasks, SEED_CONCURRENCY, async ({ symbol, tf }) => {
    try {
      const klines = await fetchHistoricalKlines(symbol, tf, MAX_CANDLES)
      const buf = candleBuffers.get(symbol)
      if (buf) buf[tf] = klines
      seeded++
      if (seeded % 100 === 0) console.log(`[boot] seeded ${seeded}/${seedTasks.length} buffers`)
    } catch (e) {
      // Some minor symbols may fail — log once and continue
    }
  }).then(() => {
    console.log(`[boot] Seeding complete: ${seeded}/${seedTasks.length} buffers`)
  })

  // 7. Fetch Fear & Greed
  refreshFearGreed().catch(() => {})

  // 7b. Load Shariah compliance cache
  await loadComplianceCache().catch((e) => console.error('[boot] compliance cache load failed', e))

  // 8. Start round-robin evaluation queue
  startEvalQueue()

  // 9. Periodic loops (order books + funding only for top coins)
  setInterval(refreshOrderBooks, ORDERBOOK_INTERVAL_MS)
  setInterval(refreshFunding, FUNDING_INTERVAL_MS)
  setInterval(refreshFearGreed, FNG_INTERVAL_MS)
  setTimeout(refreshOrderBooks, 5_000)
  setTimeout(refreshFunding, 15_000)
  setTimeout(refreshCommentary, 60_000)
  setInterval(refreshCommentary, COMMENTARY_INTERVAL_MS)

  // 10. Broadcast engine state periodically
  setInterval(() => io.emit('engine', getEngineState()), ENGINE_BROADCAST_MS)

  httpServer.listen(PORT, () => {
    console.log(`[io] AlphaSpot engine listening on port ${PORT}`)
    logEntry(SYMBOLS[0] ?? 'BTC/USDT', 'SYSTEM', 'INFO', `AlphaSpot engine online. Tracking ${SYMBOLS.length} coins. Allocated capital $${config.allocatedCapital}.`)
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
