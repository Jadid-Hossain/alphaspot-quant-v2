// CHAPTER 3.7 §4-§12 — Order Book Intelligence Types & Contracts
//
// The OBI transforms Market Microstructure Snapshots (Ch 3.6) into deterministic
// structural intelligence. Outputs are immutable (Rule 2). All behavioral
// detections use adaptive statistical baselines (Rule 11). S/R uses
// distance-to-mid weighting decay (Rule 12). Wall classification cross-refs
// execution pressure (Rule 13).

import type { MicrostructureSnapshot } from '../microstructure/types'

// ─────────────────────────────────────────────────────────────────────────────
// OBI Snapshot  (Chapter 3.7 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderBookIntelligenceSnapshot {
  symbol: string
  timestamp: number // UTC epoch ms
  // §5 — Liquidity Wall
  liquidityWallStrength: number | null // 0..1
  liquidityWallAuthenticity: number | null // 0..1 (higher = more genuine)
  wallClassifications: WallClassification[]
  // §6 — Liquidity Vacuum
  liquidityVacuumScore: number | null // 0..1 (higher = more vacuum)
  // §7 — Spoofing
  spoofingProbability: number | null // 0..1
  // §8 — Iceberg
  icebergProbability: number | null // 0..1
  hiddenVolumeEstimate: number | null
  // §9 — Absorption
  buyerAbsorptionScore: number | null // 0..1
  sellerAbsorptionScore: number | null // 0..1
  // §10 — Queue Dynamics
  queuePressureScore: number | null // -1..1
  // §11 — Liquidity Migration
  liquidityMigrationScore: number | null // -1..1 (negative=outward, positive=inward)
  // §12 — Structural Support & Resistance
  structuralSupportScore: number | null // 0..1
  structuralResistanceScore: number | null // 0..1
  // §4 — Institutional + Confidence
  institutionalParticipationScore: number | null // 0..1
  structuralConfidence: number // 0..1
  // Versioning
  snapshotVersion: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Wall  (Chapter 3.7 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type WallStatus = 'STABLE' | 'GROWING' | 'WEAKENING' | 'CONSUMED' | 'REMOVED' | 'SUSPECTED_SPOOF'

export interface LiquidityWall {
  side: 'BID' | 'ASK'
  price: number
  volume: number
  relativeVolume: number // relative to total depth
  distanceFromMidPct: number
  persistence: number // 0..1 (how long it's been there)
  reinforcementRate: number | null // rate of volume increase
  cancellationRate: number | null // rate of cancellation
  executionInteraction: number | null // how much it's absorbing
  status: WallStatus
  isGenuine: boolean // §5 — genuine only if persistent + absorbing execution (Rule 13)
}

export interface WallClassification {
  side: 'BID' | 'ASK'
  price: number
  volume: number
  status: WallStatus
  isGenuine: boolean
  distanceFromMidPct: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Vacuum  (Chapter 3.7 §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityVacuum {
  detected: boolean
  depthCollapsePct: number | null // % of depth that disappeared
  spreadExpansionPct: number | null
  vacuumDurationMs: number | null
  recoveryRate: number | null // 0..1 (how fast it recovered)
  score: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Spoofing Detection  (Chapter 3.7 §7, §7.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpoofingAssessment {
  probability: number // 0..1
  rapidAppearanceScore: number // Z-score relative to baseline
  rapidCancellationScore: number // Z-score
  executionAvoidanceScore: number // 0..1
  layeringScore: number // 0..1
  cancellationAsymmetry: number // -1..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Iceberg Detection  (Chapter 3.7 §8, §8.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface IcebergAssessment {
  probability: number // 0..1
  refillFrequencyZScore: number | null // §8.1 — adaptive
  refillConsistency: number | null // 0..1
  hiddenVolumeEstimate: number | null
  executionPersistence: number | null // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Absorption Detection  (Chapter 3.7 §9, §9.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface AbsorptionAssessment {
  buyerScore: number // 0..1
  sellerScore: number // 0..1
  duration: number | null // ms
  intensity: number | null // Z-score relative to baseline §9.1
  priceStabilityDuringExecution: number | null // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Dynamics  (Chapter 3.7 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueDynamics {
  growth: number | null // rate
  decay: number | null // rate
  replenishment: number | null // 0..1
  cancellationVelocity: number | null // Z-score
  executionVelocity: number | null // Z-score
  pressureScore: number // -1..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Migration  (Chapter 3.7 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityMigration {
  inwardMigration: number | null // rate
  outwardMigration: number | null // rate
  drift: number | null // -1..1
  concentrationShift: number | null // -1..1
  velocity: number | null // rate
  migrationScore: number // -1..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural Support & Resistance  (Chapter 3.7 §12, §12.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface StructuralSR {
  supportScore: number // 0..1
  resistanceScore: number // 0..1
  supportPrice: number | null
  resistancePrice: number | null
  liquidityPersistence: number | null // 0..1
  structuralDurability: number | null // 0..1
  reinforcementFrequency: number | null // rate
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance-to-Mid Weighting Config  (Chapter 3.7 §12.1, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export type WeightingFunction = 'LINEAR' | 'EXPONENTIAL' | 'GAUSSIAN'

export interface DistanceWeightingConfig {
  function: WeightingFunction
  /** Max distance (%) from mid that contributes to S/R. Default 2.0 (±2%). */
  maxDistancePct: number
  /** Decay rate for exponential/gaussian. */
  decayRate: number
}

export const DEFAULT_DISTANCE_WEIGHTING: DistanceWeightingConfig = {
  function: 'EXPONENTIAL',
  maxDistancePct: 2.0,
  decayRate: 0.5,
}

/**
 * Compute the distance-to-mid weight (§12.1, Rule 12).
 * Liquidity near the spread = greatest structural weight.
 * Distant liquidity = progressively smaller influence.
 */
export function computeDistanceWeight(distancePct: number, config: DistanceWeightingConfig = DEFAULT_DISTANCE_WEIGHTING): number {
  if (distancePct >= config.maxDistancePct) return 0
  const normalizedDist = distancePct / config.maxDistancePct // 0..1
  switch (config.function) {
    case 'LINEAR':
      return 1 - normalizedDist
    case 'EXPONENTIAL':
      return Math.exp(-config.decayRate * normalizedDist * 3)
    case 'GAUSSIAN':
      return Math.exp(-(normalizedDist * normalizedDist) / (2 * config.decayRate * config.decayRate))
    default:
      return 1 - normalizedDist
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export the input type
// ─────────────────────────────────────────────────────────────────────────────
export type { MicrostructureSnapshot }
