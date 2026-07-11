// CHAPTER 5.7 — Execution Optimization Engine Types
//
// The EOE is the exclusive bridge between the Order Decision Engine (Ch 5.6)
// and the Smart Order Routing Engine. Transforms validated Order Intent
// Contracts into optimized Execution Plans (§1).
//
// Core principles (§2):
//   • Order Intent defines WHAT should be traded.
//   • Execution Optimization determines HOW it should be traded.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Minimizes execution cost while preserving investment intent.
//   • Independent of ML, strategy, portfolio construction, risk policy, broker.
//
// The EOE performs NO: ML, signal generation, strategy selection, portfolio
// construction, risk management, position sizing, broker connectivity, exchange
// routing, order execution (§1).
//
// 27 architectural rules enforced (see §17).
// 19-stage pipeline (§5 — no skips).

import type { CanonicalOrderIntentContract } from '../order-decision/types'

// ─────────────────────────────────────────────────────────────────────────────
// Execution Algorithms  (Chapter 5.7 §7 — 12 methodologies)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionAlgorithm =
  | 'MARKET' // §7 — immediate market execution
  | 'LIMIT' // §7 — limit order execution
  | 'TWAP' // §7 — Time-Weighted Average Price
  | 'VWAP' // §7 — Volume-Weighted Average Price
  | 'POV' // §7 — Participation of Volume
  | 'IMPLEMENTATION_SHORTFALL' // §7 — minimize IS
  | 'ARRIVAL_PRICE' // §7 — benchmark to arrival price
  | 'ICEBERG' // §7 — hidden quantity slices
  | 'SNIPER' // §7 — opportunistic aggressive
  | 'PEGGED' // §7 — pegged to reference price
  | 'ADAPTIVE' // §7 — dynamically switching
  | 'HYBRID' // §7 — combination of algorithms

// ─────────────────────────────────────────────────────────────────────────────
// Execution State  (Chapter 5.7 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionState =
  | 'DRAFT'
  | 'PROPOSED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'INTERRUPTED' // Rule 22 — async interrupt
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'RETIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Execution Interrupt Status  (Chapter 5.7 §4, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionInterruptStatus =
  | 'NONE'
  | 'MARKET_CONDITIONS_CHANGED' // Rule 22 — material market change
  | 'LIQUIDITY_DEGRADED'
  | 'VOLATILITY_SPIKE'
  | 'PRICE_DISLOCATION'
  | 'RISK_LIMIT_APPROACHED'
  | 'MANUAL_INTERRUPT'
  | 'VALIDITY_EXPIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm Switching Status  (Chapter 5.7 §4, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export type AlgorithmSwitchingStatus =
  | 'NONE' // No switch
  | 'UPGRADE' // §10A — algorithm upgraded
  | 'DOWNGRADE' // §10A — algorithm downgraded
  | 'SCHEDULE_RECALC' // §10A — schedule recalculated
  | 'CHILD_REALLOCATION' // §10A — child orders reallocated
  | 'PARTICIPATION_ADJUST' // §10A — participation rate adjusted
  | 'SLICE_ADJUST' // §10A — slice size adjusted

// ─────────────────────────────────────────────────────────────────────────────
// Child Order State  (Chapter 5.7 §8, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export type ChildOrderState =
  | 'PLANNED'
  | 'PUBLISHED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'EXPIRED' // §8 — triggers residual re-absorption
  | 'CANCELLED' // §8 — triggers residual re-absorption
  | 'REJECTED' // §8 — triggers residual re-absorption
  | 'UNFILLED' // §8 — beyond threshold triggers re-absorption

// ─────────────────────────────────────────────────────────────────────────────
// Slice Randomization Metadata  (Chapter 5.7 §4, §10B, Rule 24)
// ─────────────────────────────────────────────────────────────────────────────

export interface SliceRandomizationMetadata {
  /** Whether timing jitter is applied. */
  timingJitterEnabled: boolean
  /** Whether quantity jitter is applied. */
  quantityJitterEnabled: boolean
  /** Timing jitter magnitude (ms, ±). */
  timingJitterMs: number
  /** Quantity jitter magnitude (fraction, ±). */
  quantityJitterFraction: number
  /** Randomized participation windows. */
  randomizedParticipationWindows: boolean
  /** Randomized iceberg refresh timing. */
  randomizedIcebergRefresh: boolean
  /** Deterministic random seed (Rule 24 — deterministic under identical seeds). */
  randomSeed: number
  /** Rule 25 — Constraints preserved. */
  constraintsPreserved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Child Order Plan  (Chapter 5.7 §4, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChildOrderPlan {
  childOrderId: string
  parentOrderId: string
  /** Slice sequence number. */
  sequence: number
  /** Quantity for this child order. */
  quantity: number
  /** Scheduled time for this slice. */
  scheduledTime: number
  /** Planned duration (ms). */
  plannedDurationMs: number
  /** Algorithm for this child (may differ for hybrid). */
  algorithm: ExecutionAlgorithm
  /** State of this child order. */
  state: ChildOrderState
  /** Filled quantity. */
  filledQuantity: number
  /** Residual quantity (returned to parent if unfilled). */
  residualQuantity: number
  /** Whether this child was randomized (Rule 24). */
  randomized: boolean
  /** Actual execution time (if filled). */
  executedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Schedule  (Chapter 5.7 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionSchedule {
  /** Start time of execution. */
  startTime: number
  /** Expected completion time. */
  expectedCompletionTime: number
  /** Total execution duration (ms). */
  totalDurationMs: number
  /** Number of slices planned. */
  sliceCount: number
  /** Per-slice schedule (time → quantity). */
  slices: Array<{
    sequence: number
    scheduledTime: number
    quantity: number
    participationRate: number
  }>
  /** Participation rate target (for POV/VWAP). */
  targetParticipationRate: number
  /** Whether schedule is randomized (Rule 24). */
  randomized: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Cost Estimate  (Chapter 5.7 §4, §9, Rule 11)
// Rule 11 — Execution cost estimation INDEPENDENT from market impact estimation.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionCostEstimate {
  exchangeFees: number
  makerTakerFees: number
  bidAskSpreadCost: number
  estimatedSlippage: number
  opportunityCost: number
  delayCost: number
  fundingCost: number
  borrowCost: number
  totalCost: number
  costFraction: number
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Impact Estimate  (Chapter 5.7 §4, §10, Rule 11)
// Rule 11 — INDEPENDENT from execution cost estimation.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketImpactEstimate {
  permanentImpact: number
  temporaryImpact: number
  totalImpact: number
  impactCost: number
  participationRate: number
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Risk Score  (Chapter 5.7 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionRiskScore {
  /** Overall execution risk (0..1, higher = riskier). */
  overall: number
  /** Market impact risk component. */
  marketImpactRisk: number
  /** Timing risk component. */
  timingRisk: number
  /** Adverse selection risk component. */
  adverseSelectionRisk: number
  /** Information leakage risk component. */
  informationLeakageRisk: number
  /** Liquidity risk component. */
  liquidityRisk: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Lineage  (Chapter 5.7 Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionLineage {
  orderDecisionId: string
  orderVersion: string
  positionId: string
  positionVersion: string
  riskAssessmentId: string
  portfolioId: string
  portfolioVersion: string
  strategyDecisionIds: string[]
  executionCostModelVersion: string
  marketImpactModelVersion: string
  liquidityModelVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Version Bundle  (Chapter 5.7 §11, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionVersionBundle {
  executionVersion: string
  orderVersion: string
  positionVersion: string
  riskVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Governance Metadata  (Chapter 5.7 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<ExecutionReviewEvent>
  auditHistory: Array<ExecutionAuditEvent>
  creationTimestamp: number
  expirationTimestamp: number
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface ExecutionReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface ExecutionAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Metadata  (Chapter 5.7 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionMetadata {
  executionPlanId: string
  executionVersion: string
  executionPlanVersion: number // §4 — increments on adaptation (Rule 26)
  versions: ExecutionVersionBundle
  lineage: ExecutionLineage
  algorithm: ExecutionAlgorithm
  executionState: ExecutionState
  interruptStatus: ExecutionInterruptStatus
  algorithmSwitchingStatus: AlgorithmSwitchingStatus
  sliceRandomization: SliceRandomizationMetadata
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Execution Plan Contract  (Chapter 5.7 §4, §6, Rule 4)
// Every plan conforms to this contract. Alternative formats PROHIBITED.
// Plans are immutable (Rule 5). Never modifies Order Intent Contracts (Rule 10).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalExecutionPlanContract {
  // §4 — Required identifiers
  executionPlanId: string // Rule 3 — unique
  executionVersion: string
  parentOrderId: string // links to Order Intent Contract
  parentOrderSymbol: string
  planTimestamp: number

  // §6 — Canonical Execution Plan Contract fields
  algorithm: ExecutionAlgorithm
  executionSchedule: ExecutionSchedule
  childOrderPlan: ChildOrderPlan[]
  sliceQuantity: number
  participationRate: number
  expectedTransactionCost: ExecutionCostEstimate
  expectedMarketImpact: MarketImpactEstimate
  expectedSlippage: number
  executionRiskScore: ExecutionRiskScore
  expectedCompletionTime: number

  // §4 — Execution state (additional contract fields)
  executionState: ExecutionState
  remainingParentQuantity: number
  executedQuantity: number
  residualQuantity: number
  executionPlanVersion: number // §4 — increments on adaptation (Rule 26)
  interruptStatus: ExecutionInterruptStatus
  algorithmSwitchingStatus: AlgorithmSwitchingStatus
  sliceRandomization: SliceRandomizationMetadata

  // §4, Rule 9 — Metadata + Governance
  executionMetadata: ExecutionMetadata
  governanceMetadata: ExecutionGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Configuration  (Chapter 5.7 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionConfiguration {
  /** Default algorithm. */
  defaultAlgorithm: ExecutionAlgorithm
  /** Per-urgency algorithm overrides (Rule 13). */
  perUrgencyAlgorithm: Partial<Record<string, ExecutionAlgorithm>>
  /** Rule 13 — Algorithm selection thresholds. */
  algorithmSelectionThresholds: AlgorithmSelectionThresholds
  /** §7 — Algorithm parameters. */
  algorithmParameters: Record<ExecutionAlgorithm, AlgorithmParameters>
  /** §9 — Execution cost model. */
  executionCostModel: ExecutionCostModel
  /** §10 — Market impact model. */
  marketImpactModel: ExecutionImpactModel
  /** §10 — Liquidity model. */
  liquidityModel: ExecutionLiquidityModel
  /** Rule 24 — Randomization config. */
  randomization: RandomizationConfig
  /** Rule 22 — Interrupt thresholds. */
  interruptThresholds: InterruptThresholds
  /** Rule 8 — Child order constraints. */
  childOrderConstraints: ChildOrderConstraints
  /** Rule 18 — Validity horizon (ms). */
  validityHorizonMs: number
  /** Rule 27 — Random seed for deterministic reproducibility. */
  randomSeed: number
  versions: ExecutionVersionBundle
}

export interface AlgorithmSelectionThresholds {
  /** Min ADV for aggressive algorithms. */
  minAdvForAggressive: number
  /** Max participation rate for single slice. */
  maxSliceParticipation: number
  /** Urgency threshold for market execution. */
  marketExecutionUrgencyThreshold: string
  /** Liquidity threshold for TWAP/VWAP. */
  twapVwapLiquidityThreshold: number
  version: string
}

export interface AlgorithmParameters {
  /** TWAP — number of slices. */
  twapSlices: number
  /** VWAP — volume profile buckets. */
  vwapBuckets: number
  /** POV — target participation rate. */
  povTargetRate: number
  /** Iceberg — visible quantity fraction. */
  icebergVisibleFraction: number
  /** Sniper — aggression threshold. */
  sniperAggressionThreshold: number
  /** Limit — limit price offset (bps from mid). */
  limitOffsetBps: number
  /** Max child order duration (ms). */
  maxChildDurationMs: number
  /** Min child order size. */
  minChildSize: number
  version: string
}

export interface ExecutionCostModel {
  exchangeFeeRate: number
  makerFeeRate: number
  takerFeeRate: number
  bidAskSpread: number
  slippageCoefficient: number
  fundingRate: number
  borrowRate: number
  version: string
}

export interface ExecutionImpactModel {
  sqrtImpactCoefficient: number
  linearImpactCoefficient: number
  permanentImpactFraction: number
  version: string
}

export interface ExecutionLiquidityModel {
  maxParticipationRate: number
  maxDepthUtilization: number
  minLiquidityScore: number
  version: string
}

export interface RandomizationConfig {
  enabled: boolean // Rule 24
  timingJitterMs: number
  quantityJitterFraction: number
  randomizedParticipationWindows: boolean
  randomizedIcebergRefresh: boolean
  randomizedPassivePlacement: boolean
  /** Rule 24 — deterministic under identical seeds. */
  deterministicSeed: boolean
  version: string
}

export interface InterruptThresholds {
  liquidityDegradationThreshold: number
  volatilitySpikeThreshold: number
  priceDislocationThreshold: number
  riskLimitApproachThreshold: number
  version: string
}

export interface ChildOrderConstraints {
  minChildSize: number
  maxChildSize: number
  maxChildDurationMs: number
  unfilledThresholdMs: number
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ALGORITHM_PARAMETERS: AlgorithmParameters = {
  twapSlices: 10,
  vwapBuckets: 24,
  povTargetRate: 0.05,
  icebergVisibleFraction: 0.1,
  sniperAggressionThreshold: 0.8,
  limitOffsetBps: 1,
  maxChildDurationMs: 60000,
  minChildSize: 0.0001,
  version: '1.0.0',
}

export const DEFAULT_EXECUTION_CONFIG: Omit<ExecutionConfiguration, 'versions' | 'algorithmParameters'> = {
  defaultAlgorithm: 'TWAP',
  perUrgencyAlgorithm: {
    IMMEDIATE: 'MARKET',
    HIGH: 'SNIPER',
    NORMAL: 'TWAP',
    LOW: 'VWAP',
    OPPORTUNISTIC: 'ICEBERG',
  },
  algorithmSelectionThresholds: {
    minAdvForAggressive: 100000,
    maxSliceParticipation: 0.10,
    marketExecutionUrgencyThreshold: 'IMMEDIATE',
    twapVwapLiquidityThreshold: 0.5,
    version: '1.0.0',
  },
  executionCostModel: {
    exchangeFeeRate: 0.001,
    makerFeeRate: 0.0005,
    takerFeeRate: 0.001,
    bidAskSpread: 0.0005,
    slippageCoefficient: 0.0002,
    fundingRate: 0.0001,
    borrowRate: 0.01,
    version: '1.0.0',
  },
  marketImpactModel: {
    sqrtImpactCoefficient: 0.1,
    linearImpactCoefficient: 0.01,
    permanentImpactFraction: 0.3,
    version: '1.0.0',
  },
  liquidityModel: {
    maxParticipationRate: 0.10,
    maxDepthUtilization: 0.20,
    minLiquidityScore: 0.3,
    version: '1.0.0',
  },
  randomization: {
    enabled: true,
    timingJitterMs: 1000,
    quantityJitterFraction: 0.05,
    randomizedParticipationWindows: true,
    randomizedIcebergRefresh: true,
    randomizedPassivePlacement: false,
    deterministicSeed: true,
    version: '1.0.0',
  },
  interruptThresholds: {
    liquidityDegradationThreshold: 0.5,
    volatilitySpikeThreshold: 2.0,
    priceDislocationThreshold: 0.02,
    riskLimitApproachThreshold: 0.9,
    version: '1.0.0',
  },
  childOrderConstraints: {
    minChildSize: 0.0001,
    maxChildSize: 100,
    maxChildDurationMs: 60000,
    unfilledThresholdMs: 30000,
    version: '1.0.0',
  },
  validityHorizonMs: 300000, // 5 minutes
  randomSeed: 42,
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Optimization Pipeline Stages  (Chapter 5.7 §5 — 19 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const EXECUTION_OPTIMIZATION_STAGES = [
  'ORDER_INTENT_RECEPTION',
  'ORDER_VALIDATION',
  'LIQUIDITY_MODEL_LOADING',
  'EXECUTION_COST_EVALUATION',
  'MARKET_IMPACT_EVALUATION',
  'EXECUTION_URGENCY_ASSESSMENT',
  'EXECUTION_ALGORITHM_SELECTION',
  'PARTICIPATION_RATE_OPTIMIZATION',
  'PARENT_ORDER_DECOMPOSITION',
  'EXECUTION_SCHEDULE_CONSTRUCTION',
  'CHILD_ORDER_PLANNING',
  'EXECUTION_VALIDATION',
  'EXECUTION_PLAN_PUBLICATION',
  'EXECUTION_STATE_MONITORING',
  'RESIDUAL_QUANTITY_MONITORING',
  'ADAPTIVE_EXECUTION_EVALUATION',
  'EXECUTION_PLAN_RE_OPTIMIZATION',
  'METADATA_RECORDING',
  'EXECUTION_COMPLETION',
] as const

export type ExecutionOptimizationStage = (typeof EXECUTION_OPTIMIZATION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const EOE_VERSION = '1.0.0'
export const EXECUTION_PLAN_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalOrderIntentContract } from '../order-decision/types'
