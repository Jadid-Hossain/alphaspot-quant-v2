// AlphaSpot Quant V2 — Decision Intelligence: Broker Gateway
//
// Chapter 5.9 — Broker Gateway Engine (BGE).
//
// The BGE is the EXCLUSIVE bridge between Smart Order Routing (Ch 5.8) and
// external execution venues. Transforms validated Routing Contracts into
// broker-specific execution requests.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/broker-gateway'.

// Types — Canonical Broker Communication Contract (§6, Rule 4) + 28 architectural rule types
export * from './types'

// Session — §8 session management (Rule 9/10/18) + §9 message validation (Rule 15/16)
export * from './session'

// State Machine — §10A transactional acknowledgment (Rule 21/22) + §10B idempotency (Rule 23/24)
export * from './state-machine'

// Rate + Clock — §10C rate governor (Rule 25/26) + §10D clock sync (Rule 27/28)
export * from './rate-clock'

// Governance — §11 failover (Rule 13) + §12 versioning (Rule 5) + §13 governance
export * from './governance'

// Recovery + Observability — §17 failure recovery + §15 metrics
export * from './recovery'

// Engine — §5 16-stage pipeline + §1 main facade
export * from './engine'
