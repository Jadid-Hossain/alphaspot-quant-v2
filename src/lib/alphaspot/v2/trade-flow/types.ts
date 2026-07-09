// CHAPTER 3.8 §4-§12 — Trade Flow Intelligence Types & Contracts
//
// The TFI analyzes completed transactions to estimate actual market participant
// behavior. Outputs are immutable (Rule 2). Deterministic (Rule 3, Rule 15).
// All rolling metrics use constant-memory algorithms (Rule 12). Adaptive
// baselines for anomaly detection (Rule 11). Dedup by Event ID (Rule 16).

import type { MicrostructureSnapshot } from '../microstructure/types'
import type { CanonicalMarketEvent } from '../market-data/canonical-event'

// ─────────────────────────────────────────────────────────────────────────────
// Trade Flow Intelligence Snapshot  (Chapter 3.8 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeFlowSnapshot {
  symbol: string
  timestamp: number // UTC epoch ms
  // §5 — Volume Delta
  aggressiveBuyVolume: number
  aggressiveSellVolume: number
  volumeDelta: number // net (buy - sell)
  // §6 — CVD
  sessionCVD: number // resets at UTC daily boundary (§6)
  rollingCVD: number // configurable window
  cvdMomentum: number | null
  cvdSlope: number | null
  priceCvdDivergence: number | null // -1..1
  // §7 — Block Trade
  blockTradeScore: number // 0..1
  // §9 — Trade Velocity
  tradeVelocity: number // trades per second (EMA)
  volumePerSecond: number | null
  executionBurstScore: number | null // 0..1
  // §8 — Execution Imbalance
  executionImbalance: number // -1..1
  buyerDominance: number | null // 0..1
  sellerDominance: number | null // 0..1
  // §11 — Exhaustion
  buyingExhaustion: number // 0..1
  sellingExhaustion: number // 0..1
  // §4 — Institutional + Confidence
  institutionalActivityScore: number // 0..1
  flowConfidence: number // 0..1
  // §10 — Optional Derivatives (NULL when unavailable — Rule 14)
  derivatives: DerivativesFlow | null
  // Versioning
  snapshotVersion: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivatives Flow  (Chapter 3.8 §10 — optional)
// ─────────────────────────────────────────────────────────────────────────────

export interface DerivativesFlow {
  longLiquidationScore: number | null // 0..1
  shortLiquidationScore: number | null // 0..1
  liquidationCascadeProbability: number | null // 0..1
  fundingRateDivergence: number | null // -1..1
  openInterestDelta: number | null // change in OI
  derivativesPressureScore: number | null // -1..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume Delta  (Chapter 3.8 §5)
// ─────────────────────────────────────────────────────────────────────────────

export interface VolumeDelta {
  aggressiveBuyVolume: number
  aggressiveSellVolume: number
  netDelta: number
  rollingDelta: number | null // EMA
  deltaAcceleration: number | null // rate of change
  deltaPersistence: number | null // 0..1 (how consistent the direction is)
}

// ─────────────────────────────────────────────────────────────────────────────
// Block Trade Assessment  (Chapter 3.8 §7 — adaptive, no fixed thresholds)
// ─────────────────────────────────────────────────────────────────────────────

export interface BlockTradeAssessment {
  largeTradeScore: number // 0..1 (Z-score based §7, Rule 13)
  blockTradeFrequency: number | null // blocks per minute
  averageBlockSize: number | null
  blockDirectionBias: number | null // -1..1
  institutionalParticipationScore: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Imbalance  (Chapter 3.8 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionImbalance {
  buyerDominance: number | null // 0..1
  sellerDominance: number | null // 0..1
  executionConcentration: number | null // 0..1
  tradeDensity: number | null // trades per second
  directionalPersistence: number | null // 0..1
  executionEfficiency: number | null // 0..1
  imbalance: number // -1..1
  // Rule 4 — aggressor classification exclusively from exchange Maker/Taker
  aggressorMethod: 'EXCHANGE_METADATA'
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade Velocity  (Chapter 3.8 §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeVelocity {
  tradesPerSecond: number // EMA
  volumePerSecond: number | null // EMA
  executionBurstScore: number | null // 0..1
  marketActivityScore: number | null // 0..1
  velocityAcceleration: number | null
  velocityDeceleration: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Exhaustion Assessment  (Chapter 3.8 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExhaustionAssessment {
  buyingExhaustion: number // 0..1
  sellingExhaustion: number // 0..1
  momentumDecay: number | null // 0..1
  volumeFatigue: number | null // 0..1
  participationDecline: number | null // 0..1
  executionSaturation: number | null // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow Confidence  (Chapter 3.8 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowConfidence {
  tradeCoverage: number // 0..1
  marketActivity: number // 0..1
  synchronization: 'SYNCED' | 'OUT_OF_SYNC' | 'UNKNOWN'
  dataCompleteness: number // 0..1
  executionStability: number // 0..1
  microstructureAgreement: number // 0..1
  overallScore: number // 0..1
}

// Re-export input types
export type { MicrostructureSnapshot, CanonicalMarketEvent }
