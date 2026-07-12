// AlphaSpot Quant V2 — Barrel Export
//
// Single entry point for the V2 architecture. Import from '@/lib/alphaspot/v2'.
//
// Architecture:
//   Chapter 1:   3 lanes + 10-stage recommendation pipeline + immutable snapshots
//   Chapter 2.1: 14 independent domains with explicit boundaries
//   Chapter 2.2: Event-driven communication + Workflow Orchestrator + snapshot lifecycle
//   Chapter 2.3: Runtime architecture — write coordination, worker pool, cache hierarchy, backpressure, fault tolerance, watchdogs
//   Chapter 2.4: Engineering standards & governance — source-of-truth, dependency governance, error classification, config, security, model/feature governance, plugins, quality gates, constitution
//   Chapter 2.5: AI governance — model lifecycle, prediction traceability, confidence calibration, performance monitoring, drift detection, model decay policy, shadow evaluation, recommendation validity, operational safety, explainability, governance alerts, audit trail, continuous improvement
//   Chapter 3.1: Exchange connectivity — exchange abstraction, connection lifecycle, subscription management, connection pool + stream sharding, heartbeat, time sync, rate limits, reconnection policy, jitter buffer, data gap detection, data recovery, failover, observability
//
// The 10-stage pipeline (Chapter 1) maps onto the 14 domains (Chapter 2.1):
//   • Market Observation           → Domain 03 (Gateway) + 04 (Data)
//   • Structural Validation        → Domain 04 (Market Data — eligibility gate)
//   • Feature Engineering          → Domain 05
//   • Market Context               → Domain 06 (Market Intelligence)
//   • Statistical Evaluation       → Domain 07 (ML) + 08 (Decision, for EV)
//   • Expected Value               → Domain 08 (Decision Engine)
//   • Candidate Generation         → Domain 08 (only domain that creates candidates)
//   • Portfolio Optimization       → Domain 09 (Portfolio Intelligence)
//   • Recommendation Validation    → Domain 10 (Risk Engine — overrides)
//   • Ranking Engine               → Domain 08
//   • Snapshot Generation          → Domain 02 (Workflow Orchestration)
//
// Communication (Chapter 2.2): domains never invoke each other directly.
// All inter-domain communication flows through the Event Transport Layer as
// immutable, versioned, correlation-ID'd events. The Workflow Orchestrator
// owns execution order, timeouts, retries, and snapshot lifecycle.

export * from './types'
export * from './domains' // 14 domains + domain map + I/O flow (Chapter 2.1)
export * from './events' // Event transport + catalog + snapshot lifecycle + orchestrator (Chapter 2.2)
export * from './runtime' // Write coordinator + worker pool + cache hierarchy + backpressure + fault tolerance + watchdogs (Chapter 2.3)
export * from './governance' // Source-of-truth + dependency governance + error handling + config + security + model/feature governance + plugins + quality gates + constitution (Chapter 2.4 + 2.5)
export * from './connectivity' // Exchange connector + subscription manager + connection pool + stream sharding + heartbeat + time sync + rate limits + jitter buffer + reconnection + data recovery (Chapter 3.1)
export * from './market-data' // Canonical market events + bounded ring buffer + schema/timestamp/sequence/duplicate validation + normalization + integrity verification + publication + replay (Chapter 3.2)
export * from './market-state' // Market state cache — partitioned, atomic, versioned, immutable snapshots, quality tracking, recovery (Chapter 3.3)
export * from './historical-data' // Historical data manager — immutable datasets, versioned, UTC epoch, gap detection + repair, columnar payload store, stitching (Chapter 3.4)
export * from './candle-engine' // Candle construction engine — canonical OHLCV, timeframe dependency graph, incremental aggregation, watermark completion, late-event v+1, checkpoint recovery (Chapter 3.5)
export * from './microstructure' // Market microstructure engine — liquidity, execution pressure, spread dynamics, order book imbalance, bounded depth, EMA/EWMA rolling metrics (Chapter 3.6)
export * from './order-book-intel' // Order book intelligence — liquidity walls, spoofing (adaptive Z-score), icebergs, absorption, queue dynamics, migration, structural S/R with distance-to-mid decay (Chapter 3.7)
export * from './trade-flow' // Trade flow intelligence — volume delta, session/rolling CVD, block trades (adaptive), execution imbalance (Maker/Taker), velocity, exhaustion, derivatives overlay (Chapter 3.8)
export * from './feature-extraction' // Feature extraction — 17 feature categories, deterministic triggers, forward-fill, immutable vectors, temporal integrity (Chapter 3.9)
export * from './feature-processing' // Feature processing & store — validation, imputation, rolling normalization, scaling, online/offline store, lineage (Chapter 3.10)
export * from './ai-platform' // AI platform — prediction framework, probability vs confidence, multi-horizon, uncertainty, explainability, governance, deterministic inference (Chapter 4.1)
export * from './decision-intelligence' // Decision intelligence — Ch 5.1-5.15: full institutional trading pipeline (signal → strategy → portfolio → risk → sizing → order → execution → routing → broker → exchange → reconciliation → accounting → PnL → risk analytics → compliance)
export * from './feature-store-engine' // Ch 5.16 — Feature Store Engine: Canonical Feature Contract, dual pipeline (write 14 stages + read online 6 / offline 6), 19 feature categories, online+offline stores (Rule 9/10), quality validation (Rule 16), drift detection (Rule 12), versioning, governance
export * from './alternative-data-engine' // Ch 5.17 — Alternative Data Management Engine: Canonical Alternative Data Contract, 16-stage pipeline, provider management (Rule 1/11), quality validation (Rule 9), unstructured data parsing (Rule 19), dual timestamps (Rule 18), multi-source fusion (Rule 10), versioning, governance
export * from './market-simulation-engine' // Ch 5.18 — Market Simulation & Backtesting Engine: Canonical Simulation Contract, 17-stage pipeline, 8 methodologies, market replay (Rule 8), execution simulation (Rule 10/11), point-in-time AI inference (Rule 9A), look-ahead bias prevention (Rule 17), performance evaluation (§10), versioning, governance
export * from './paper-trading-engine' // Ch 5.19 — Paper Trading & Shadow Execution Engine: Canonical Paper Trading Contract, 17-stage pipeline, dual mode (paper simulation + shadow execution Rule 7/18A), virtual portfolio (Rule 9), deployment readiness (Rule 13/19), drift monitoring (Rule 14/18), versioning, governance
export * from './configuration-engine' // Ch 5.20 — Configuration & Version Control Engine: Canonical Configuration Contract, 13-stage pipeline, composite cryptographic hash (Rule 18), hot-reload streaming (Rule 18A), secret rejection (Rule 18B), rollback (Rule 8), drift detection (Rule 15), four-eyes approval (§10), versioning, governance
export * from './user-api-engine' // Ch 5.21 — User API & Access Management Engine: Canonical Access Contract, 14-stage pipeline, 11 auth methods, RBAC+ABAC (Rule 9), API key management (Rule 8 — never plaintext), rate limiting (Rule 14 — independent), tenant isolation (Rule 19), webhook signing (Rule 21), versioning, governance
export * from './model-governance-engine' // Ch 5.22 — AI Model Governance Engine: Canonical Model Governance Contract, dual pipeline (onboarding 15 + continuous 10), 9 lifecycle states, performance certification (Rule 16), champion-challenger (Rule 8), deployment signature (Rule 7), drift monitoring (Rule 13), cryptographic signing (Rule 9), versioning, governance
export * from './lanes/lane-a-realtime'
export * from './lanes/lane-b-analytical'
export * from './lanes/lane-c-research'
export * from './pipeline/structural-validation'
export * from './pipeline/feature-engineering'
export * from './pipeline/market-context'
export * from './pipeline/statistical-evaluation'
export * from './pipeline/expected-value'
export * from './pipeline/candidate-generator'
export * from './pipeline/portfolio-optimizer'
export * from './pipeline/recommendation-validator'
export * from './pipeline/ranking-engine'
export * from './pipeline/snapshot-generator'
