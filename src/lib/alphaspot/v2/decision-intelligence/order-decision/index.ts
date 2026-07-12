// AlphaSpot Quant V2 — Decision Intelligence: Order Decision
//
// Chapter 5.6 — Order Decision Engine (ODE).
//
// The ODE is the EXCLUSIVE bridge between Position Sizing (Ch 5.5) and the
// Execution Optimization Layer. Transforms validated Position Contracts into
// executable Order Intent Contracts through transaction-cost-aware decision logic.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/order-decision'.

// Types — Canonical Order Intent Contract (§6, Rule 4) + 25 architectural rule types
export * from './types'

// Rebalancing — §8 drift thresholds + §11 Rule 22 temporal cooldowns
export * from './rebalancing'

// Evaluation — §9 transaction cost + market impact (Rule 9) + §10 liquidity (Rule 11) + Rule 10 economic benefit
export * from './evaluation'

// Freshness — §10 Rule 21 pending order freshness + §11 Rule 17 turnover budget
export * from './freshness'

// Governance — §12 versioning (Rule 5) + §13 governance (Rule 14 validity horizon)
export * from './governance'

// Recovery + Observability — §16 failure recovery + §15 metrics
export * from './recovery'

// Engine — §5 21-stage pipeline + §1 main facade
export * from './engine'
