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
export * from './decision-intelligence' // Decision intelligence — signal generation, Canonical Signal Contract, hysteresis, regime compatibility (Chapter 5.1)
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
