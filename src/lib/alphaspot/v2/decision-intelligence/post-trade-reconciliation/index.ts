// AlphaSpot Quant V2 — Decision Intelligence: Post-Trade Reconciliation
//
// Chapter 5.11 — Post-Trade Reconciliation Engine (PTRE).
//
// The PTRE is the EXCLUSIVE bridge between Exchange Execution (Ch 5.10) and
// Portfolio Accounting. Transforms Exchange Execution Events into reconciled,
// verified, institutionally consistent execution records.
//
// Import from '@/lib/alphaspot/v2/decision-intelligence/post-trade-reconciliation'.

// Types — Canonical Reconciliation Contract (§6, Rule 4) + 22 architectural rule types
export * from './types'

// Matching — §8 trade matching (Rule 6/13/15) + §9 execution verification (Rule 10)
export * from './matching'

// Exceptions — §10 exception management (Rule 14/21/22) + §10A escrow (Rule 9/12/19)
export * from './exceptions'

// Governance — §11 versioning (Rule 5) + §12 governance
export * from './governance'

// Recovery + Observability — §16 failure recovery + §14 metrics
export * from './recovery'

// Engine — §5 20-stage pipeline + §1 main facade
export * from './engine'
