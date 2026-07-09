// AlphaSpot Quant V2 — Barrel Export
//
// Single entry point for the V2 architecture. Import from '@/lib/alphaspot/v2'.
//
// Architecture (Chapter 1):
//   • 3 lanes: Lane A (real-time), Lane B (analytical), Lane C (research)
//   • 10-stage recommendation pipeline (no module may bypass it)
//   • Immutable Market Snapshots
//   • Trade Candidate lifecycle with expiration
//   • Structural validation as a hard eligibility gate

export * from './types'
export * from './lanes/lane-a-realtime'
export * from './lanes/lane-b-analytical'
export * from './lanes/lane-c-research'
export * from './pipeline/structural-validation'
export * from './pipeline/feature-engineering'
export * from './pipeline/market-context'
export * from './pipeline/statistical-evaluation'
export * from './pipeline/expected-value'
export * from './pipeline/candidate-generator'
export * from './pipeline/portfolio-optimizer'
export * from './pipeline/recommendation-validator'
export * from './pipeline/ranking-engine'
export * from './pipeline/snapshot-generator'
