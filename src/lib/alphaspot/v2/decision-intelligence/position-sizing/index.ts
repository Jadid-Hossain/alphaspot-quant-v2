// AlphaSpot Quant V2 — Decision Intelligence: Position Sizing
//
// Chapter 5.5 — Position Sizing Engine (PSE).
//
// The PSE is the EXCLUSIVE bridge between Risk Management (Ch 5.4) and the
// Order Decision Engine. Transforms risk-approved portfolio allocations into
// executable position sizes through deterministic, configurable, capital-aware,
// and fully governed sizing methodologies.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/position-sizing'.

// Types — Canonical Position Contract (§6, Rule 4) + 25 architectural rule types
export * from './types'

// Capital — §8 capital management (Rule 13, Rule 17, Rule 21, Rule 24)
export * from './capital'

// Oracle — §3, Rule 22 Real-Time Price & FX Conversion Oracle
export * from './oracle'

// Methods — §7 12 position sizing methods (Rule 6, Rule 14, Rule 23)
export * from './methods'

// Exchange — §9 exchange normalization (Rule 10, Rule 16, Rule 19)
export * from './exchange'

// Governance — §10 state + §11 versioning (Rule 5) + §12 governance (Rule 11)
export * from './governance'

// Recovery + Observability — §16 failure recovery + §14 metrics
export * from './recovery'

// Engine — §5 17-stage pipeline + §1 main facade
export * from './engine'
