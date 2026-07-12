// CHAPTER 5.8 — Smart Order Routing Engine Types
//
// The SORE is the exclusive bridge between Execution Optimization (Ch 5.7)
// and the Broker Gateway. Transforms validated Execution Plans into
// venue-specific Routing Decisions (§1).
//
// Core principles (§2):
//   • Execution Plans specify HOW an order should be executed.
//   • Smart Order Routing determines WHERE the order should be executed.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Optimizes execution quality while preserving approved execution intent.
//   • Independent of ML, strategy, portfolio construction, risk policy, broker APIs.
//
// The SORE performs NO: ML, strategy selection, portfolio construction, risk
// management, position sizing, execution algorithm design, broker communication,
// exchange order submission (§1).
//
// 26 architectural rules enforced (see §17).
// 15-stage pipeline (§5 — no skips).

import type { CanonicalExecutionPlanContract } from '../execution-optimization/types'

// ─────────────────────────────────────────────────────────────────────────────
// Routing Strategies  (Chapter 5.8 §7 — 10 strategies)
// ─────────────────────────────────────────────────────────────────────────────

export type RoutingStrategy =
  | 'SINGLE_VENUE' // §7
  | 'MULTI_VENUE' // §7
  | 'BEST_EXECUTION' // §7
  | 'LOWEST_COST' // §7
  | 'LOWEST_LATENCY' // §7
  | 'LIQUIDITY_SEEKING' // §7
  | 'QUEUE_POSITION_OPTIMIZATION' // §7
  | 'DARK_POOL' // §7
  | 'VENUE_PREFERENCE' // §7
  | 'HYBRID' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Routing Priority  (Chapter 5.8 §4)
// ─────────────────────────────────────────────────────────────────────────────

export type RoutingPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BACKGROUND'

// ─────────────────────────────────────────────────────────────────────────────
// Venue State  (Chapter 5.8 §10, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export type VenueHealthState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'LATENCY_SPIKE' // §10
  | 'LIQUIDITY_COLLAPSE' // §10
  | 'CONNECTIVITY_FAILURE' // §10
  | 'ISOLATED' // Rule 13 — failed venue isolated
  | 'RECOVERING'

// ─────────────────────────────────────────────────────────────────────────────
// Allocation Methodologies  (Chapter 5.8 §9)
// ─────────────────────────────────────────────────────────────────────────────

export type AllocationMethodology =
  | 'EQUAL_ALLOCATION' // §9
  | 'LIQUIDITY_PROPORTIONAL' // §9
  | 'COST_OPTIMIZED' // §9
  | 'LATENCY_OPTIMIZED' // §9
  | 'QUEUE_OPTIMIZED' // §9
  | 'TOXICITY_AWARE' // §9
  | 'ADAPTIVE' // §9

// ─────────────────────────────────────────────────────────────────────────────
// Rerouting Actions  (Chapter 5.8 §10A, Rule 25, Rule 26)
// ─────────────────────────────────────────────────────────────────────────────

export type ReroutingAction =
  | 'CANCEL_AND_REPLACE' // §10A, Rule 25
  | 'VENUE_MIGRATION' // §10A
  | 'QUEUE_REPOSITIONING' // §10A
  | 'ORDER_REFRESH' // §10A
  | 'ALTERNATIVE_VENUE_ALLOCATION' // §10A
  | 'PARTIAL_QUANTITY_MIGRATION' // §10A
  | 'NONE'

// ─────────────────────────────────────────────────────────────────────────────
// Venue Metadata  (Chapter 5.8 §3, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueMetadata {
  venueId: string
  venueName: string
  exchange: string
  venueType: 'LIT' | 'DARK' | 'AUCTION' | 'RFQ' | 'INTERNALIZATION'
  /** §8 — Available liquidity (quote currency). */
  availableLiquidity: number
  /** §8 — Order book depth (quote currency). */
  orderBookDepth: number
  /** §8 — Spread (fraction of price). */
  spread: number
  /** §8 — Historical fill rate (0..1). */
  historicalFillRate: number
  /** §8 — Venue latency (ms, round-trip). */
  venueLatency: number
  /** §8 — Queue length (orders ahead). */
  queueLength: number
  /** §8 — Maker fee rate (fraction). */
  makerFee: number
  /** §8 — Taker fee rate (fraction). */
  takerFee: number
  /** §8 — Reliability score (0..1). */
  reliabilityScore: number
  /** §8 — Historical stability (0..1). */
  historicalStability: number
  /** §8 — Regulatory eligibility (which assets/strategies allowed). */
  regulatoryEligibility: string[]
  /** §9 — Geographic location. */
  geographicLocation: string
  /** §9 — Network transit time (ms). */
  networkTransitTime: number
  /** §9 — Exchange gateway latency (ms). */
  gatewayLatency: number
  /** Rule 13 — Current health state. */
  healthState: VenueHealthState
  /** When health state last updated. */
  healthUpdatedAt: number
  /** Venue model version (Rule 16). */
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Venue Toxicity Assessment  (Chapter 5.8 §8, Rule 21)
// Rule 21 — Toxicity assessment precedes final venue ranking.
// Toxicity is mathematically INDEPENDENT from liquidity/latency/fee/queue eval.
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueToxicityAssessment {
  venueId: string
  /** §8 — VPIN (Volume-Synchronized Probability of Informed Trading), 0..1. */
  vpin: number
  /** §8 — Adverse selection rate (0..1). */
  adverseSelectionRate: number
  /** §8 — Toxic fill ratio (0..1). */
  toxicFillRatio: number
  /** §8 — Post-fill price drift (fraction). */
  postFillPriceDrift: number
  /** §8 — Quote fade rate (0..1). */
  quoteFadeRate: number
  /** §8 — Aggressive order flow ratio (0..1). */
  aggressiveOrderFlowRatio: number
  /** §8 — Fill quality degradation (0..1). */
  fillQualityDegradation: number
  /** §8 — Information leakage risk (0..1). */
  informationLeakageRisk: number
  /** §8 — Hidden liquidity reliability (0..1). */
  hiddenLiquidityReliability: number
  /** §8 — Composite venue toxicity score (0..1, higher = more toxic). */
  venueToxicityScore: number
  /** Rule 21 — Whether venue should be penalized/excluded. */
  penalize: boolean
  /** Rule 21 — Whether venue should be excluded entirely. */
  exclude: boolean
  /** Toxicity model version (independently versioned). */
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Venue Evaluation Result  (Chapter 5.8 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueEvaluation {
  venueId: string
  /** Liquidity score (0..1). */
  liquidityScore: number
  /** Queue position probability (0..1). */
  queuePositionProbability: number
  /** Expected venue cost (quote currency). */
  expectedVenueCost: number
  /** Expected venue latency (ms). */
  expectedVenueLatency: number
  /** Expected fill probability (0..1). */
  expectedFillProbability: number
  /** Toxicity assessment (Rule 21 — independent). */
  toxicityAssessment: VenueToxicityAssessment
  /** Composite venue score (0..1, higher = better). */
  compositeScore: number
  /** Rule 21 — Penalized due to toxicity. */
  toxicityPenalized: boolean
  /** Rule 21 — Excluded due to toxicity. */
  toxicityExcluded: boolean
  /** Evaluation reason. */
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Venue Allocation  (Chapter 5.8 §4, §6, §9, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueAllocation {
  venueId: string
  exchange: string
  /** Quantity allocated to this venue. */
  allocatedQuantity: number
  /** Fraction of total child order quantity (0..1). */
  allocationFraction: number
  /** Queue position estimate (orders ahead). */
  queuePositionEstimate: number
  /** Expected fill probability for this allocation (0..1). */
  expectedFillProbability: number
  /** Expected venue cost for this allocation. */
  expectedVenueCost: number
  /** Expected venue latency (ms). */
  expectedVenueLatency: number
  /** §9 — Adjusted release time for latency synchronization (Rule 22/23). */
  synchronizedReleaseTime: number
  /** §9 — Network transit compensation (ms). */
  latencyCompensationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Latency Synchronization  (Chapter 5.8 §9, Rule 22, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export interface LatencySynchronization {
  /** Whether synchronization is enabled. */
  enabled: boolean
  /** Target arrival time at matching engines. */
  targetArrivalTime: number
  /** Synchronization tolerance (ms). */
  synchronizationToleranceMs: number
  /** Per-venue release times. */
  perVenueReleaseTimes: Record<string, number>
  /** Per-venue network transit estimates (ms). */
  perVenueTransitTimes: Record<string, number>
  /** Per-venue gateway latencies (ms). */
  perVenueGatewayLatencies: Record<string, number>
  /** §9 — Clock synchronization reference. */
  clockSyncReference: string
  /** Model version (independently versioned). */
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Monitoring State  (Chapter 5.8 §10A, Rule 24, Rule 25)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueMonitoringState {
  childOrderId: string
  venueId: string
  /** Current queue position. */
  currentPosition: number
  /** Initial queue position. */
  initialPosition: number
  /** Queue position decay (positions lost over time). */
  queuePositionDecay: number
  /** Last fill heartbeat timestamp. */
  lastHeartbeat: number
  /** Expected fill time (ms from now). */
  expectedFillTimeMs: number
  /** Remaining queue length. */
  remainingQueueLength: number
  /** Passive order age (ms). */
  passiveOrderAgeMs: number
  /** Venue queue congestion (0..1). */
  queueCongestion: number
  /** Queue abandonment detected. */
  queueAbandonmentDetected: boolean
  /** Dynamic queue score (0..1, higher = better). */
  dynamicQueueScore: number
  /** Whether rerouting is recommended (Rule 25). */
  reroutingRecommended: boolean
  /** Rerouting reason. */
  reroutingReason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Lineage  (Chapter 5.8 Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingLineage {
  executionPlanId: string
  executionPlanVersion: number
  orderDecisionId: string
  orderVersion: string
  positionId: string
  riskAssessmentId: string
  portfolioId: string
  strategyDecisionIds: string[]
  venueModelVersion: string
  toxicityModelVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Version Bundle  (Chapter 5.8 §11, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingVersionBundle {
  routingVersion: string
  executionPlanVersion: string
  configurationVersion: string
  venueModelVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Governance Metadata  (Chapter 5.8 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<RoutingReviewEvent>
  auditHistory: Array<RoutingAuditEvent>
  creationTimestamp: number
  expirationTimestamp: number
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface RoutingReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface RoutingAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Metadata  (Chapter 5.8 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingMetadata {
  routingDecisionId: string
  routingVersion: string
  versions: RoutingVersionBundle
  lineage: RoutingLineage
  routingStrategy: RoutingStrategy
  allocationMethodology: AllocationMethodology
  routingPriority: RoutingPriority
  reroutingAction: ReroutingAction
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Routing Contract  (Chapter 5.8 §4, §6, Rule 4)
// Every routing decision conforms to this contract. Alternative formats PROHIBITED.
// Records are immutable (Rule 5). Never modifies Execution Plan Contracts (Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalRoutingContract {
  // §4 — Required identifiers
  routingDecisionId: string // Rule 3 — unique
  routingVersion: string
  executionPlanId: string
  parentOrderId: string
  childOrderId: string
  routingTimestamp: number

  // §6 — Canonical Routing Contract fields
  selectedVenues: string[]
  selectedExchanges: string[]
  venueAllocations: VenueAllocation[]
  routingPriority: RoutingPriority
  routingStrategy: RoutingStrategy
  queuePositionEstimate: number
  expectedFillProbability: number
  expectedVenueCost: number
  expectedVenueLatency: number
  routingConfidence: number

  // §9 — Latency synchronization
  latencySynchronization: LatencySynchronization

  // §4 — Routing metadata
  routingMetadata: RoutingMetadata
  governanceMetadata: RoutingGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Configuration  (Chapter 5.8 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingConfiguration {
  defaultStrategy: RoutingStrategy
  perUrgencyStrategy: Partial<Record<string, RoutingStrategy>>
  allocationMethodology: AllocationMethodology
  /** Rule 21 — Toxicity threshold for penalty. */
  toxicityPenaltyThreshold: number
  /** Rule 21 — Toxicity threshold for exclusion. */
  toxicityExclusionThreshold: number
  /** Rule 9 — Maximum venues per routing decision. */
  maxVenuesPerRouting: number
  /** Rule 22 — Synchronization tolerance (ms). */
  synchronizationToleranceMs: number
  /** §9 — Whether latency-matched synchronization is enabled. */
  latencySyncEnabled: boolean
  /** Rule 24 — Queue monitoring interval (ms). */
  queueMonitoringIntervalMs: number
  /** Rule 25 — Queue position decay threshold for rerouting. */
  queueDecayReroutingThreshold: number
  /** Rule 25 — Fill heartbeat timeout (ms). */
  fillHeartbeatTimeoutMs: number
  /** Rule 13 — Venue recovery criteria. */
  venueRecoveryCriteria: VenueRecoveryCriteria
  /** Venue model version (Rule 16). */
  venueModelVersion: string
  /** Toxicity model version (independently versioned). */
  toxicityModelVersion: string
  versions: RoutingVersionBundle
}

export interface VenueRecoveryCriteria {
  /** Minimum health observations before recovery. */
  minHealthObservations: number
  /** Required reliability score for recovery. */
  minReliabilityScore: number
  /** Required latency (ms). */
  maxLatencyMs: number
  /** Recovery cooldown (ms). */
  recoveryCooldownMs: number
}

export const DEFAULT_ROUTING_CONFIG: Omit<RoutingConfiguration, 'versions'> = {
  defaultStrategy: 'BEST_EXECUTION',
  perUrgencyStrategy: {
    IMMEDIATE: 'LOWEST_LATENCY',
    HIGH: 'BEST_EXECUTION',
    NORMAL: 'BEST_EXECUTION',
    LOW: 'LOWEST_COST',
    OPPORTUNISTIC: 'LIQUIDITY_SEEKING',
  },
  allocationMethodology: 'COST_OPTIMIZED',
  toxicityPenaltyThreshold: 0.5,
  toxicityExclusionThreshold: 0.8,
  maxVenuesPerRouting: 5,
  synchronizationToleranceMs: 5,
  latencySyncEnabled: true,
  queueMonitoringIntervalMs: 1000,
  queueDecayReroutingThreshold: 0.3,
  fillHeartbeatTimeoutMs: 5000,
  venueRecoveryCriteria: {
    minHealthObservations: 5,
    minReliabilityScore: 0.8,
    maxLatencyMs: 100,
    recoveryCooldownMs: 30000,
  },
  venueModelVersion: '1.0.0',
  toxicityModelVersion: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing Pipeline Stages  (Chapter 5.8 §5 — 15 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const ROUTING_PIPELINE_STAGES = [
  'EXECUTION_PLAN_RECEPTION',
  'EXECUTION_PLAN_VALIDATION',
  'VENUE_DISCOVERY',
  'VENUE_HEALTH_VERIFICATION',
  'LIQUIDITY_EVALUATION',
  'QUEUE_POSITION_ESTIMATION',
  'VENUE_COST_EVALUATION',
  'LATENCY_EVALUATION',
  'FILL_PROBABILITY_ESTIMATION',
  'VENUE_RANKING',
  'MULTI_VENUE_ALLOCATION',
  'ROUTING_VALIDATION',
  'ROUTING_PUBLICATION',
  'METADATA_RECORDING',
  'ROUTING_COMPLETION',
] as const

export type RoutingPipelineStage = (typeof ROUTING_PIPELINE_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const SORE_VERSION = '1.0.0'
export const ROUTING_CONTRACT_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalExecutionPlanContract } from '../execution-optimization/types'
