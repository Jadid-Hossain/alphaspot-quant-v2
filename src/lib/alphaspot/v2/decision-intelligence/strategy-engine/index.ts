// AlphaSpot Quant V2 — Decision Intelligence: Strategy Intelligence Engine
//
// Chapter 5.2 — Strategy Intelligence Engine (SIE).
//
// The SIE is the EXCLUSIVE bridge between Signal Generation (Ch 5.1) and
// Portfolio Construction (Ch 5.3). It transforms Canonical Signals into
// strategy-specific Strategy Decisions through deterministic, auditable,
// configurable decision logic.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/strategy-engine'.

// Types — Canonical Strategy Decision Contract (§6, Rule 4) + supporting types
export * from './types'

// State Manager (§10 — institutional lifecycle: Active/Cooldown/Suspended/Recovery/Observation/Retired)
export * from './state-manager'

// Rules (§8 — deterministic rule evaluation: Direction/Strength/Confidence/Quality/Regime/Horizon/Freshness/State/Time)
export * from './rules'

// Governance (§11 — Strategy Versioning, Rule 14 immutable; §12 — Strategy Governance, complete history mandatory)
export * from './governance'

// Reconciliation (§9, Rule 16/17 — Cross-Strategy Decision Reconciliation with full lineage)
export * from './reconciliation'

// Recovery (§16 — Strategy Reload, Decision Quarantine, Graceful Degradation, State Restoration)
export * from './recovery'

// Observability (§14 — Strategy Decisions/Acceptance Rate/Latency/Distribution/Utilization/Conflicts/Governance/Throughput)
export * from './observability'

// Engine (§5 — 11-stage pipeline; §1 — main facade)
export * from './engine'
