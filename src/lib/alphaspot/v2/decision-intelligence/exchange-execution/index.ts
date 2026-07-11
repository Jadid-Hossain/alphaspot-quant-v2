// AlphaSpot Quant V2 — Decision Intelligence: Exchange Execution
//
// Chapter 5.10 — Exchange Execution Engine (EEE).
//
// The EEE is the EXCLUSIVE bridge between Broker Gateway (Ch 5.9) and Post-Trade
// Processing. Manages the complete lifecycle of live exchange orders after transmission.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/exchange-execution'.

// Types — Canonical Execution Event Contract (§6, Rule 4) + 23 architectural rule types
export * from './types'

// Buffer + Fills — §7 Asynchronous Sequence Buffer (Rule 6/21) + §8 Fill Aggregation (Rule 9/10)
export * from './buffer-fills'

// State — §7 lifecycle + §9 events + §10 gap-recovery (Rule 14/22/23)
export * from './state'

// Governance — §11 versioning (Rule 5) + §12 governance
export * from './governance'

// Recovery + Observability — §16 failure recovery + §14 metrics
export * from './recovery'

// Engine — §5 14-stage pipeline + §1 main facade
export * from './engine'
