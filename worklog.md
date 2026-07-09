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
