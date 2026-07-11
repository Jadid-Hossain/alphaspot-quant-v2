// AlphaSpot Quant V2 — Decision Intelligence: Risk Management
//
// Chapter 5.4 — Risk Management Engine (RME).
//
// The RME is the EXCLUSIVE bridge between Portfolio Construction (Ch 5.3) and
// Position Sizing. Evaluates portfolio construction outputs against
// enterprise-wide risk constraints before capital is committed to market execution.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/risk-management'.

// Types — Canonical Risk Contract (§6, Rule 4) + 23 architectural rule types
export * from './types'

// Limits — §8 risk limit management (portfolio + transactional, Rule 22)
export * from './limits'

// Stress Testing — §9 (Rule 9 independent, Rule 19 versioned)
export * from './stress-testing'

// Atomic Dependency — Rule 15, Rule 23 (atomic group verification)
export * from './atomic'

// Margin Simulation — Rule 21 (pre-trade exchange-specific margin)
export * from './margin'

// State — §10 risk state + Rule 16 circuit breakers
export * from './state'

// Governance — §11 versioning (Rule 5 immutable) + §12 governance (Rule 11)
export * from './governance'

// Recovery + Observability — §16 failure recovery + §14 metrics
export * from './recovery'

// Engine — §5 16-stage pipeline + §1 main facade
export * from './engine'
