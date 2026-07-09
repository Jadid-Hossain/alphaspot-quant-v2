// AlphaSpot Quant V2 — Domains Barrel Export
//
// 14 independent domains (Chapter 2.1 §3). Each domain owns one responsibility,
// has explicit boundaries, and communicates only through contracts (Principle 4).
//
// Import from '@/lib/alphaspot/v2/domains'.

// Core Infrastructure (01) — the only domain with a concrete implementation so far.
// Other domains expose typed contracts; their implementations land in later MDS chapters.
export * from './01-core-infrastructure'

// Domain contracts (typed interfaces — implementations in later chapters)
export * from './02-workflow-orchestration/contract'
export * from './03-market-gateway/contract'
export * from './04-market-data/contract'
export * from './05-feature-engineering/contract'
export * from './06-market-intelligence/contract'
export * from './07-machine-learning/contract'
export * from './08-decision-engine/contract'
export * from './09-portfolio-intelligence/contract'
export * from './10-risk-engine/contract'
export * from './11-execution-engine/contract'
export * from './12-persistence/contract'
export * from './13-research-platform/contract'
export * from './14-presentation-layer/contract'

// Domain map + I/O flow documentation
export * from './domain-map'
