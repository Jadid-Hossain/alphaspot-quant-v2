// AlphaSpot Quant V2 — Barrel Export
//
// Single entry point for the V2 architecture. Import from '@/lib/alphaspot/v2'.
//
// Architecture:
//   Chapter 1:   3 lanes + 10-stage recommendation pipeline + immutable snapshots
//   Chapter 2.1: 14 independent domains with explicit boundaries
//   Chapter 2.2: Event-driven communication + Workflow Orchestrator + snapshot lifecycle
//   Chapter 2.3: Runtime architecture — write coordination, worker pool, cache hierarchy, backpressure, fault tolerance, watchdogs
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
