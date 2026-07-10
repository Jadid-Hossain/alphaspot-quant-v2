// AlphaSpot Quant V2 — Decision Intelligence: Portfolio Construction
//
// Chapter 5.3 — Portfolio Construction Engine (PCE).
//
// The PCE is the EXCLUSIVE bridge between Strategy Intelligence (Ch 5.2) and
// Risk Management. It transforms Canonical Strategy Decision Contracts into
// portfolio-level investment allocations through deterministic, configurable,
// and fully governed portfolio construction methodologies.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/portfolio-construction'.

// Types — Canonical Portfolio Contract (§6, Rule 4) + supporting types
export * from './types'

// Methods — 17 portfolio construction methodologies (§7)
export * from './methods'

// Diversification — §9 assessment (Rule 9, Rule 13)
export * from './diversification'

// Correlation — §10 assessment (Rule 10 — independent from diversification)
export * from './correlation'

// Governance — §11 versioning (Rule 5 immutable) + §12 governance (Rule 11)
export * from './governance'

// Recovery — §16 failure recovery (invalid NEVER published)
export * from './recovery'

// Observability — §14 metrics
export * from './observability'

// Engine — §5 15-stage pipeline + §1 main facade
export * from './engine'
