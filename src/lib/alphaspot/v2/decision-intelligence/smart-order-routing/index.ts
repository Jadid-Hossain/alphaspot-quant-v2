// AlphaSpot Quant V2 — Decision Intelligence: Smart Order Routing
//
// Chapter 5.8 — Smart Order Routing Engine (SORE).
//
// The SORE is the EXCLUSIVE bridge between Execution Optimization (Ch 5.7) and
// the Broker Gateway. Transforms validated Execution Plans into venue-specific
// Routing Decisions.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/smart-order-routing'.

// Types — Canonical Routing Contract (§6, Rule 4) + 26 architectural rule types
export * from './types'

// Evaluation — §8 venue evaluation + Rule 21 toxicity assessment
export * from './evaluation'

// Allocation — §9 multi-venue allocation + Rule 22/23 latency synchronization
export * from './allocation'

// Failover — §10 failover (Rule 13) + §10A dynamic queue management (Rule 24/25/26)
export * from './failover'

// Governance — §11 versioning (Rule 5) + §12 governance
export * from './governance'

// Recovery + Observability — §16 failure recovery + §14 metrics
export * from './recovery'

// Engine — §5 15-stage pipeline + §1 main facade
export * from './engine'
