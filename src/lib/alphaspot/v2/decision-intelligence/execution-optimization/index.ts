// AlphaSpot Quant V2 — Decision Intelligence: Execution Optimization
//
// Chapter 5.7 — Execution Optimization Engine (EOE).
//
// The EOE is the EXCLUSIVE bridge between the Order Decision Engine (Ch 5.6)
// and the Smart Order Routing Engine. Transforms validated Order Intent
// Contracts into optimized Execution Plans.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/execution-optimization'.

// Types — Canonical Execution Plan Contract (§6, Rule 4) + 27 architectural rule types
export * from './types'

// Algorithms — §7 12 execution algorithms (Rule 6, Rule 14)
export * from './algorithms'

// Child Orders — §8 Rule 21 residual re-absorption + §10A adaptation (Rule 22/23/26)
export * from './child-orders'

// Governance — §11 versioning (Rule 5) + §12 governance (Rule 18 validity)
export * from './governance'

// Recovery + Observability — §16 failure recovery + §14 metrics
export * from './recovery'

// Engine — §5 19-stage pipeline + §1 main facade
export * from './engine'
