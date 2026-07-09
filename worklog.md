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

---
Task ID: MDS-CH1
Agent: main (Z.ai Code)
Task: Chapter 1 of the Master Design Specification — Vision, Design Philosophy & System Architecture. Establish the V2 architectural foundation.

Work Log:
- Created `full_prompt.md` and appended Chapter 1 verbatim (the MDS accumulator file — all future chapters append to it in sequence).
- Analyzed Chapter 1: it is a vision/architecture chapter mandating (1) multi-lane processing, (2) a 10-stage recommendation pipeline no module may bypass, (3) immutable Market Snapshots, (4) Trade Candidate lifecycle with expiration, (5) structural validation as a hard gate, (6) ranking not isolated evaluation, (7) 8 design principles.
- Built the V2 type system (`src/lib/alphaspot/v2/types.ts`): Asset, AssetMeta, MarketRegime, MarketContext, StructuralConstraints (+ DEFAULT_CONSTRAINTS), AssetEligibility, EngineeredFeatures, StatisticalMetrics, ExpectedValue (+ components), RiskMetrics, TradeCandidate (+ stage/action enums), Recommendation (+ rank enum), MarketSnapshot, PortfolioAnalysis, PipelineStageResult, PipelineContext, Lane A/B/C contracts, PIPELINE_VERSION, PIPELINE_STAGES, DEFAULT_RECOMMENDATION_TTL_MS, RANK_THRESHOLDS.
- Built the 3 lanes (Chapter 1 §8):
  • Lane A (`lanes/lane-a-realtime.ts`): registry/provider pattern — thin read-only adapter over the existing engine's in-memory state. Exposes getPrice/getOrderBook/getFunding/get24hStats/getCandles/subscribe. No analytical work.
  • Lane B (`lanes/lane-b-analytical.ts`): orchestrator that runs the full 10-stage pipeline on demand and publishes immutable Market Snapshots. Keeps a 100-snapshot history. Subscribers notified on each publication.
  • Lane C (`lanes/lane-c-research.ts`): research/validation scaffold (backtest, validatePrediction, getPerformanceMetrics) as stubs — later MDS chapters will implement. Runs independently, never blocks production.
- Built the 10-stage recommendation pipeline (Chapter 1 §6, §11):
  1. Market Observation — reads from Lane A
  2. Structural Validation (`structural-validation.ts`) — FULLY IMPLEMENTED: checks minHistoryBars (200), minQuoteVolume24h ($1M), valid price, 4h history depth. Returns AssetEligibility with failedChecks. Hard gate — no ML runs on failed assets.
  3. Feature Engineering (`feature-engineering.ts`) — wraps V1 indicators/patterns + derives momentumScore, volatilityScore, trendAlignment, liquidityScore.
  4. Market Context (`market-context.ts`) — classifies regime (TRENDING_UP/DOWN, RANGING, HIGH/LOW_VOLATILITY, TRANSITIONAL), confidence, volatility, liquidity, spread, market structure, relative strength.
  5. Statistical Evaluation (`statistical-evaluation.ts`) — synthesizes 6 evidence sources (RSI, MACD, trend, regime, relative strength, patterns) into probabilityOfSuccess, expectedReturnPct, expectedDrawdownPct, confidence, edgeScore, sampleQuality. Principle 3: no single-indicator recommendations.
  6. Expected Value (`expected-value.ts`) — synthesizes 7 EV components (statistical edge, return−drawdown, regime alignment, relative strength, trend alignment, liquidity, confidence penalty) into a unified signed EV.
  7. Candidate Generator (`candidate-generator.ts`) — creates TradeCandidate objects with action (BUY/SELL/WATCH/HOLD), risk metrics (ATR-based stop/target, Kelly sizing, VaR), rationale (explainable), expiration (15min TTL). Principle 1: never recommend in HIGH_VOLATILITY. Principle 2: WATCH for moderate EV.
  8. Portfolio Optimizer (`portfolio-optimizer.ts`) — ranks candidates by EV, caps at 8 concurrent BUY candidates, caps total capital at 60%, downgrades losers to WATCH. Principle 4: assets compete.
  9. Recommendation Validator (`recommendation-validator.ts`) — enforces Rule 1 (pipeline order), Rule 3 (explainable), Rule 4 (measurable, ≥3 evidence), Rule 5 (expires), Principle 1 (risk ≤5%), R/R ≥1.0. Rejects or publishes.
  10. Ranking Engine (`ranking-engine.ts`) — ranks all eligible assets by EV then edge score, assigns tier A/B/C/D based on RANK_THRESHOLDS.
  11. Snapshot Generator (`snapshot-generator.ts`) — publishes an immutable (deep-frozen) MarketSnapshot with portfolio analysis, stage timings, monotonic version counter. Rule 2: reproducible.
- Created barrel export (`src/lib/alphaspot/v2/index.ts`) for clean imports.
- Lint passes cleanly. Both services (Next.js + engine) still running — V2 is purely additive, V1 untouched.

Stage Summary:
- V2 architectural foundation complete per Chapter 1. Every concept mandated by the chapter now has a concrete module + typed interface.
- The 10-stage pipeline is wired together in Lane B with correct sequencing (Rule 1: no bypassing).
- Structural validation is fully implemented as a hard gate (Chapter 1 §7-A).
- Market Snapshots are immutable + deep-frozen + versioned (Chapter 1 §9, Rule 2).
- Trade Candidates carry asset, metrics, EV, risk, rationale, expiration, version (Chapter 1 §10).
- Recommendations expire (Principle 7, Rule 5) and are tiered A/B/C/D.
- Later MDS chapters will: (a) wire Lane A to the real engine via registerLaneAProvider, (b) specify exact regime/probability algorithms, (c) build the research/backtest lane, (d) replace the V1 dashboard with a snapshot-driven V2 dashboard.

---
Task ID: MDS-CH2.1
Agent: main (Z.ai Code)
Task: Chapter 2.1 of the MDS — System Decomposition: Domain Responsibilities & System Boundaries. Decompose the V2 architecture into 14 independent domains.

Work Log:
- Appended Chapter 2.1 verbatim to full_prompt.md (now 430 lines, 2 chapters).
- Analyzed Chapter 2.1: mandates 14 domains with single responsibility, strong encapsulation, replaceability, loose coupling, business-driven organization. Explicit forbidden-responsibilities list per domain. I/O flow chain: Gateway → Data → Features → Intelligence → ML → Decision → Portfolio → Risk → Execution → Presentation.
- Mapped the Chapter 1 10-stage pipeline onto the 14 domains (documented in v2/index.ts header).
- Created 14 domain directories under src/lib/alphaspot/v2/domains/ (01-core-infrastructure through 14-presentation-layer).
- DOMAIN 01 (Core Infrastructure) — FULLY IMPLEMENTED concretely:
  • Configuration: PlatformConfig + DEFAULT_PLATFORM_CONFIG, getConfig/setConfig
  • Logging: LogLevel, LogEntry, createLogger(domain) factory, addLogSink, domain-scoped loggers
  • Metrics: gauge/counter/histogram factories, getMetricsSnapshot (with p50/p95/p99)
  • Health Checks: registerHealthCheck, runHealthChecks, HealthStatus
  • Scheduling: schedule(name, intervalMs, fn) with task tracking, getScheduledTasks
  • Time Sync: now() with injectable time provider (testable)
  • Secrets: getSecret/requireSecret (env-backed)
  • Environment: getEnvironment/isProduction
  • Dependency Injection: register/resolve/tryResolve registry + DI_TOKENS map for all 14 domains
- DOMAINS 02–14: each has a contract.ts defining its typed interface (inputs accepted, outputs published) + forbidden-responsibilities documentation. Contracts:
  • 02 Workflow Orchestration: start/stop/runNow/getLatestSnapshot/subscribe + buildPipelineContext
  • 03 Market Gateway: discoverSymbols/connect/fetchHistoricalCandles/fetchOrderBook/fetchFunding/isHealthy — publishes RawMarketEvent
  • 04 Market Data: raw data accessors + structural validation (eligibility gate) + ingestion methods
  • 05 Feature Engineering: generateFeatures/generateForAssets/validateFeatures/getFeatureVersion
  • 06 Market Intelligence: analyzeAsset/analyzeBatch/computeCorrelations/getMarketRegimeSummary — publishes MarketContext
  • 07 Machine Learning: predict/predictBatch/calibrate/getModelInfo — outputs probabilities ONLY
  • 08 Decision Engine: estimateExpectedValue/generateCandidates/rankCandidates/explainCandidate — ONLY domain that creates TradeCandidates
  • 09 Portfolio Intelligence: optimize/getExposure/checkConcentration — portfolio context mandatory
  • 10 Risk Engine: validate/computeRisk/checkPortfolioRisk/monitorPositions — risk overrides prediction
  • 11 Execution Engine: execute/getOpenPositions/getHistory/tick — zero prediction logic
  • 12 Persistence: saveSnapshot/getSnapshot/listRecommendations/saveExecution/batchWrite/transaction
  • 13 Research Platform: backtest/validatePrediction/walkForward/trackExperiment — never in production chain
  • 14 Presentation Layer: getActiveSnapshot/subscribeToSnapshots/getRecommendations/explainRecommendation — no calculations
- Created domain-map.ts: DOMAINS array (14 DomainDescriptor objects with purpose/responsibilities/forbidden/publishes/consumes/inProductionChain), PRODUCTION_FLOW (10-stage I/O chain), getDomain/getProductionChain helpers.
- Created domains/index.ts barrel export.
- Updated v2/index.ts to export domains + document the pipeline→domain mapping.
- Lint passes cleanly. Both services still running (V2 purely additive, V1 untouched).

Stage Summary:
- 14-domain decomposition complete per Chapter 2.1. Every domain has a typed contract + forbidden-responsibilities documentation.
- Core Infrastructure (Domain 01) is fully implemented — provides config, logging, metrics, health checks, scheduling, time sync, secrets, DI registry for all other domains.
- Domain map documents the I/O flow chain (§6) and which domain publishes/consumes which contract.
- Forbidden responsibilities are enforced via contract types (e.g., ML contract outputs StatisticalMetrics/probabilities, NOT recommendations; Decision Engine is the ONLY domain with generateCandidates).
- Replaceability (Principle 3): every domain is interface-driven — Binance gateway can swap to multi-exchange, SQLite to PostgreSQL, baseline ML to a trained model, without touching upstream domains.
- Later MDS chapters will: (a) implement each domain's concrete logic against its contract, (b) register implementations in the DI registry, (c) wire the Workflow Orchestrator to drive the full chain, (d) rebuild the Presentation Layer as a snapshot-driven V2 dashboard.

---
Task ID: MDS-CH2.2
Agent: main (Z.ai Code)
Task: Chapter 2.2 of the MDS — Communication Architecture, Workflow Orchestration, Event Model & Snapshot Lifecycle. Build the event-driven communication layer.

Work Log:
- Appended Chapter 2.2 verbatim to full_prompt.md (now 555 lines, 3 chapters accumulated).
- Analyzed Chapter 2.2: mandates an event-driven architecture where (1) domains never invoke each other directly, (2) all communication flows through an abstract Event Transport Layer, (3) the Workflow Orchestrator owns execution order/timeout/retry/dedup, (4) every event is an immutable versioned envelope with correlationId + snapshotId, (5) snapshots have a monotonic 7-state lifecycle, (6) consumers must be idempotent, (7) failures are isolated, (8) 15 standard event types in the catalog, (9) 4 priority levels (CRITICAL/HIGH/MEDIUM/LOW), (10) 10 architectural rules.
- Created src/lib/alphaspot/v2/events/ with 5 modules:
  • transport.ts — EventEnvelope type (eventId, eventType, eventVersion, timestamp, correlationId, snapshotId, producer, frozen payload), EventPriority, EventTransport interface (publish/subscribe/flush/getStats), InMemoryEventTransport implementation with deep-freeze on publish (immutability §8), async dispatch per handler (failure isolation §17), event history for audit, getEventTransport/setEventTransport singletons (pluggable transport §4), publishEvent helper, generateEventId/CorrelationId/SnapshotId.
  • catalog.ts — All 15 standard events as typed contracts: MarketUpdated, CandlesUpdated, FeatureGenerated, MarketRegimeUpdated, PredictionCompleted, TradeCandidateCreated, CandidateRejected, PortfolioEvaluated, RiskAssessmentCompleted, SnapshotCompleted, RecommendationPublished, RecommendationExpired, PaperTradeOpened, PaperTradeClosed, ModelMetricsUpdated. Each has a versioned payload interface + EVENT_VERSIONS map + EVENT_DEFAULT_PRIORITY map. Type-safe publish() and on() helpers with EventPayloadMap for compile-time payload checking. onAll() wildcard subscriber for audit/observability.
  • snapshot-lifecycle.ts — SnapshotState enum (CREATED→COLLECTING→PROCESSING→VALIDATING→COMPLETE→PUBLISHED|FAILED), ALLOWED_TRANSITIONS matrix (monotonic — §13), SnapshotRecord interface (9 content fields from §11 + observability), SnapshotRegistry class (create/transition/get/getByVersion/getLatest/getPublished/list/subscribe/getStats). Publishes SnapshotCompleted event when entering COMPLETE state. getStats reports byState counts + averageDurationMs.
  • idempotency.ts — IdempotencyTracker class (check/mark/has with LRU eviction at 10k entries) for dedup by eventId (§10). Correlation context (beginCorrelation/bindSnapshot/getCorrelation/endCorrelation) so every event in one analytical cycle shares the same correlationId (§20).
  • workflow-orchestrator.ts — The heart of Chapter 2.2. WorkflowOrchestratorImpl class: registerStages (canonical sequence §6), start(intervalMs) (scheduling §5), runCycle() (one complete pipeline cycle = one snapshot, Rule 4), executeStage with timeout (§18) + retry with exponential backoff (§19, retries belong ONLY to orchestrator), snapshot state transitions at milestones (§13), failure isolation (§17 — publishes failure events, recovery via orchestration), observability (§21 — stage timings, stats, currentContext, activeCorrelationId). timedStage() wrapper helper. onFailure/onComplete subscribers.
- Created events/index.ts barrel export.
- Updated v2/index.ts to export events + document Chapter 2.2 architecture.
- Lint passes cleanly. Both services still running (V2 purely additive).
- Smoke-tested end-to-end: created a snapshot, transitioned through all 7 lifecycle states to PUBLISHED, published 4 events (TradeCandidateCreated, RecommendationPublished, PaperTradeOpened, SnapshotCompleted), audit wildcard handler captured all, typed handler received BTC/USDT candidate, idempotency correctly rejected duplicate eventId. Transport stats: 4 published, 2 subscribers.

Stage Summary:
- Event-driven communication layer complete per Chapter 2.2. Domains can now communicate exclusively through published immutable events (Rule 1, Rule 2).
- 15-event catalog with typed, versioned payloads (§7, §9, §15). Type-safe publish/on helpers enforce compile-time payload correctness.
- Snapshot lifecycle is a monotonic 7-state machine (§13) with a registry that tracks every snapshot, publishes SnapshotCompleted on completion, and exposes stats for observability.
- Workflow Orchestrator owns execution order, timeout, retry, dedup, snapshot coordination (§5, §6, §18, §19). It performs ZERO business logic.
- Idempotency tracker dedupes by eventId (§10, Rule 5). Correlation context propagates correlationId across an analytical cycle (§20).
- Failure isolation (§17): each handler failure is caught and logged without affecting other consumers; failed snapshots publish failure events.
- Event Transport is pluggable (§4): in-memory today, swappable to IPC/Redis/distributed broker without business-logic changes.
- Later MDS chapters will: (a) wire each domain to publish/consume events from the catalog, (b) register the 11 pipeline stages with the orchestrator, (c) connect the orchestrator to drive the live snapshot cycle.
