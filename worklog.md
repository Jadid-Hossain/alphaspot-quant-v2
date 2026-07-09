# AlphaSpot - Project Worklog

## Project Overview
AlphaSpot is an institutional-grade Real-Time Crypto Spot Trading AI built on Next.js 16.
Adapted from a Python/FastAPI blueprint to a 100% free Next.js + socket.io mini-service stack.

### Architecture
- **Frontend**: Next.js 16 App Router, TailwindCSS, shadcn/ui, TradingView Lightweight Charts
- **Backend API**: Next.js API routes (REST)
- **Real-time engine**: socket.io mini-service on port 3003 (Binance WS ingestion + scoring + risk engine)
- **Database**: Prisma ORM + SQLite (trades, signals, reasoning logs)
- **AI Reasoning**: z-ai-web-dev-sdk LLM (generates natural-language explanations of confluence)
- **Data sources (all free)**: Binance public REST/WebSocket, Binance FAPI (funding/OI), Alternative.me Fear & Greed

### Core Modules
1. Data Ingestion Engine — Binance WS for OHLCV (15m/1h/4h) + order book depth + funding rates + Fear&Greed
2. Pattern Recognition & Confluence Scorer — RSI, StochRSI, MACD, EMA50/200, BB, OBV, candlestick patterns, sentiment
3. Dynamic Risk & "No-Net-Loss" Recovery Engine — FLAT -> IN_TRADE -> RECOVERY_MODE state machine + Smart DCA + macro hard stop
4. FastAPI-style backend — Next.js /api/status, /api/trades, /api/control + socket.io /ws stream
5. React Frontend — live dashboard with TradingView charts, AI Signal Box, Position Card, Reasoning Log

---

---
Task ID: ALL
Agent: main (Z.ai Code)
Task: Build AlphaSpot — Real-Time Crypto Trading AI (all 5 modules from the blueprint)

Work Log:
- Adapted the Python/FastAPI blueprint to the Next.js 16 + socket.io mini-service stack (100% free: Binance public API, Alternative.me F&G, z-ai-web-dev-sdk LLM).
- Module 1 (Data Ingestion): Built `mini-services/alpha-engine/binance.ts` — Binance REST (historical klines, 24h ticker, order book depth, futures funding rate + open interest) + combined WebSocket (9 streams: BTC/ETH/SOL × 15m/1h/4h) with auto-reconnect. Fear & Greed from Alternative.me.
- Module 2 (Pattern Recognition & Confluence): Built `src/lib/alphaspot/indicators.ts` (RSI, StochRSI, MACD, EMA50/200, Bollinger Bands, OBV, ATR), `patterns.ts` (12 candlestick patterns: Engulfing, Hammer, Shooting Star, Harami, Morning/Evening Star, Piercing, Dark Cloud, Three Soldiers/Crows, Doji), and `confluence.ts` (weighted scoring -100..+100 across multi-timeframe indicators + patterns + order flow + funding + sentiment). STRONG_BUY >= 75.
- Module 3 (Risk Engine): Built `risk-engine.ts` — FLAT→IN_TRADE→RECOVERY_MODE state machine with Smart DCA (20% initial → 30% recovery on 2% drop if macro intact → take profit on 1% bounce → emergency exit on 4h EMA50/200 death cross). Paper trading simulation with position tracking, avg-entry reweighting, realized PnL.
- Module 4 (Backend): Next.js API routes `/api/status` (portfolio stats), `/api/trades`, `/api/logs`, `/api/signals`. socket.io mini-service on port 3003 broadcasts snapshots, logs, trades, engine state. LLM reasoning via z-ai-web-dev-sdk (`llm.ts`) — generates analyst-style explanations on every trade decision + periodic market commentary with sentiment score.
- Module 5 (Frontend): Built a dark trading-terminal dashboard with TradingView Lightweight Charts (candlesticks + EMA50/200 overlays, 15m/1h/4h switcher), AI Signal Box (animated score meter), Active Position Card (unrealized PnL, capital deployed bar), Multi-Timeframe Indicator Panels, Confluence Factors (scored breakdown + LLM commentary), streaming AI Reasoning Log, Live Trade Feed, Portfolio Stats, sticky footer. Zustand store + socket.io client. Responsive (mobile stacks vertically).
- Prisma schema: Trade, Signal, ReasoningLog, EngineConfig models on SQLite.
- Verified end-to-end with Agent Browser + VLM: live data flowing (BTC $61,829, F&G 22 Extreme Fear), LLM commentary clean and data-driven, symbol switching works, no console errors, no visual glitches, mobile responsive.

Stage Summary:
- Both services running: Next.js dev (port 3000) + alpha-engine mini-service (port 3003), accessed via Caddy gateway (port 81).
- All 5 blueprint modules implemented and verified working.
- 100% free stack: no paid APIs, no paid cloud, runs locally.
- LLM (z-ai-web-dev-sdk) powers both per-decision reasoning and periodic market commentary.
- Paper trading mode (clearly labeled in UI + footer).

---
Task ID: EXPAND-24
Agent: main (Z.ai Code)
Task: Expand from 3 coins to a comprehensive watchlist of 24 major cryptocurrencies

Work Log:
- Relaxed `Symbol` type from a 3-member literal union to `string` in `types.ts`, and added a `SUPPORTED_SYMBOLS` constant listing 24 top USDT spot pairs (BTC, ETH, BNB, SOL, XRP, ADA, AVAX, DOGE, DOT, LINK, LTC, ATOM, UNI, ETC, NEAR, APT, ARB, OP, FIL, INJ, SUI, SEI, TIA, RUNE).
- Updated `binance.ts`: SYMBOLS now references SUPPORTED_SYMBOLS; built a dynamic `STREAM_TO_SYMBOL` lookup map (replaces hardcoded 3-coin map) so the WS handler can resolve any coin. 24 coins × 3 timeframes = 72 streams (well under Binance's 200-stream limit).
- Updated engine `index.ts`: replaced all hardcoded per-symbol state maps (candleBuffers, positions, prev4hInd, ticker24h, orderBooks, funding, sentimentPerSymbol, lastEvalAt) with a generic `buildRecord()` helper that initializes state for every coin in SUPPORTED_SYMBOLS. Updated boot log and engine-state broadcast to reference the dynamic list.
- Updated Zustand store (`use-alpha-spot.ts`): snapshots and lastPriceFlash now built dynamically from SUPPORTED_SYMBOLS; `selectedSymbol` is a string. Exported SYMBOLS = SUPPORTED_SYMBOLS.
- Built new `Watchlist` component: persistent left sidebar (desktop) / Sheet (mobile) showing all 24 coins with live price, 24h %, AI signal dot (color-coded by label, pulsing for STRONG signals), and an "IN"/"R" badge for active positions. Includes a search filter. Rows are `React.memo`-ized with primitive props for performance (only changed rows re-render on snapshot updates).
- Redesigned `Header`: removed the 3-button symbol tabs; added a compact coin-picker button (mobile) that opens a Sheet with the watchlist; shows selected symbol + live price + 24h% inline on desktop.
- Updated `page.tsx` layout: added a 240px persistent watchlist sidebar (lg+) alongside the main dashboard area; main content max-width adjusted to 1500px.
- Verified end-to-end: engine boots and seeds 24 coins × 3 timeframes = 21,600 candles, connects 72 WS streams, broadcasts snapshots for all coins. DB confirms signals + logs being recorded across all 24 symbols. Agent Browser + VLM confirm: watchlist sidebar visible with all 24 coins, signal dots present, no overlaps, mobile Sheet works with search filter, coin switching updates the full dashboard. No console errors.

Stage Summary:
- Watchlist expanded from 3 → 24 coins (8x increase).
- UI redesigned with a professional trading-terminal watchlist sidebar (desktop) + Sheet picker (mobile) with search.
- All 5 blueprint modules (ingestion, confluence, risk, backend, frontend) now operate across 24 coins simultaneously.
- Performance optimized with memoized watchlist rows; no jank with 24 coins streaming at ~12 snapshots/sec.
- Adding more coins in the future only requires editing the SUPPORTED_SYMBOLS array — everything else is dynamic.

---
Task ID: ALL-COINS + PRICE-FIX
Agent: main (Z.ai Code)
Task: (1) Add ALL tradeable Binance USDT coins. (2) Fix price not matching Binance/other platforms (lag).

Work Log:
- PRICE FIX: Root cause was the 2-second evaluation throttle — snapshots (which carry the price) were only broadcast every 2s per coin. Added a new `priceTick` socket event that broadcasts on EVERY kline WebSocket update with zero throttle and zero indicator computation. The frontend merges these instant price ticks into the snapshot, so the displayed price now matches Binance in real-time (verified: AlphaSpot $62,960.01 vs Binance API $62,963.43 — $3 difference = sub-second capture delay).
- ALL COINS: Added `fetchAllSpotSymbols()` which queries Binance's `/api/v3/exchangeInfo` API and returns ALL tradeable USDT spot pairs (filtered: status=TRADING, isSpotTradingAllowed, excludes leveraged UP/DOWN/BULL/BEAR tokens and stablecoin-base pairs like USDC/USDT). Discovered 441 coins at runtime.
- Chunked WebSocket: Rewrote `connectKlineStream()` to split 1323 streams (441 coins × 3 timeframes) across 7 independent WS connections (200 streams each) to stay under Binance's URL length limit. Each chunk auto-reconnects independently.
- miniTicker stream: Added `connectMiniTickerStream()` subscribing to `!miniTicker@arr` — a single stream that pushes 24h change/volume for ALL symbols every 1 second. Replaced the 60s REST ticker polling entirely.
- Dynamic state: Replaced all hardcoded per-symbol Maps with `Map<Symbol, T>` populated at boot from the exchangeInfo response. The engine now tracks 441 coins dynamically — adding/removing coins requires zero code changes.
- Round-robin eval: Replaced per-kline-tick evaluation (which would overwhelm the CPU with 441 coins) with a timer-based round-robin queue: evaluates 8 coins every 300ms (~27 coins/sec), cycling through all 441 coins every ~16s. Price ticks still broadcast instantly on every kline update (decoupled from eval).
- Concurrency-limited seeding: Added `runBatch()` helper that seeds 1323 candle buffers (441 coins × 3 timeframes × 300 candles) with concurrency=15 to respect Binance's REST weight limits. Seeding runs in the background after WS connects, so prices appear immediately and indicators populate progressively.
- LLM rate limiting: With 400+ coins generating trade signals, added a strict rate limiter (1 LLM call per 5s, max 1 concurrent) to `explainDecision` and `marketCommentary`. Calls that can't be served are dropped gracefully (the engine's deterministic reason is already logged). Eliminated all 429 errors.
- Volume-sorted watchlist: SYMBOLS sorted by 24h quote volume descending so top coins (BTC, ETH, SOL, XLM, XRP...) are seeded/evaluated first and order-book/funding/commentary (which cover top N) target the most relevant coins.
- Frontend store: Added `livePrices` map + `priceTick` handler for instant price updates. Watchlist rows now use per-row Zustand selector subscriptions (`useAlphaSpot(s => s.snapshots[sym])`) so only the changed row re-renders — critical for 441 rows.
- Verified: 441 coins in watchlist, BTC price matches Binance ($62,960 vs $62,963), 54 paper trades executed (+$41.26 PnL), 184 coins with computed signals, zero 429 errors, zero console errors.

Stage Summary:
- Watchlist expanded from 24 → 441 coins (ALL tradeable Binance USDT spot pairs, discovered dynamically).
- Price is now real-time: instant priceTick broadcasts on every kline update, matching Binance's live price within sub-second.
- Architecture scales: chunked WS (7 connections), round-robin eval queue, per-row React subscriptions, LLM rate limiting.
- Adding new Binance listings requires zero code changes — the engine discovers them automatically at boot.
