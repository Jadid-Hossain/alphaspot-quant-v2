// CHAPTER 5.6 — Order Decision Engine Types
//
// The ODE is the exclusive bridge between Position Sizing (Ch 5.5) and the
// Execution Optimization Layer. Transforms validated Position Contracts into
// executable Order Intent Contracts (§1).
//
// Core principles (§2):
//   • Approved target positions do NOT necessarily require immediate execution.
//   • Every market order introduces costs (transaction, spread, impact, slippage, turnover).
//   • The ODE determines whether expected portfolio improvement justifies these costs.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Independent of ML, strategy, portfolio optimization, risk policy, broker, execution algorithms.
//   • Identical Position Contracts + portfolio states → identical Order Intent Contracts.
//
// The ODE performs NO: ML, signal generation, strategy selection, portfolio
// construction, risk evaluation, position sizing, smart order routing, broker
// communication, market execution (§1).
//
// 25 architectural rules enforced (see §17).
// 21-stage pipeline (§5 — no skips).

import type { CanonicalPositionContract } from '../position-sizing/types'

// ─────────────────────────────────────────────────────────────────────────────
// Order Decision Types  (Chapter 5.6 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderDecisionType =
  | 'BUY' // §7
  | 'SELL' // §7
  | 'REBALANCE' // §7
  | 'HOLD' // §7
  | 'NO_ACTION' // §7
  | 'REDUCE_POSITION' // §7
  | 'INCREASE_POSITION' // §7
  | 'CLOSE_POSITION' // §7
  | 'OPEN_POSITION' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Order Side  (Chapter 5.6 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderSide = 'BUY' | 'SELL'

// ─────────────────────────────────────────────────────────────────────────────
// Execution Urgency  (Chapter 5.6 §4, §6, Rule 23, Rule 24)
// Rule 23 — Independent of transaction cost estimates.
// Rule 24 — Influences scheduling ONLY; never modifies portfolio objectives.
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionUrgency =
  | 'IMMEDIATE' // §17, Rule 23 — highest priority
  | 'HIGH' // §17, Rule 23
  | 'NORMAL' // §17, Rule 23
  | 'LOW' // §17, Rule 23
  | 'OPPORTUNISTIC' // §17, Rule 23 — lowest priority

// ─────────────────────────────────────────────────────────────────────────────
// Order Intent  (Chapter 5.6 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderIntent = 'EXECUTE' | 'HOLD' | 'SUPPRESS' | 'DEFER' | 'CANCEL_PENDING'

// ─────────────────────────────────────────────────────────────────────────────
// Pending Order Status  (Chapter 5.6 §4, §6, §10, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export type PendingOrderStatus =
  | 'NONE' // No pending order for this position
  | 'PENDING_ACK' // Awaiting exchange acknowledgment
  | 'PENDING_PARTIAL_FILL' // Partially filled
  | 'PENDING_FULL' // Acknowledged, awaiting fill
  | 'STALE' // Rule 21 — exceeded freshness threshold
  | 'CANCELLED' // Stale-order recovery cancelled
  | 'EXPIRED' // Validity horizon expired

// ─────────────────────────────────────────────────────────────────────────────
// Order State  (Chapter 5.6 §13)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderState = 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'EXPIRED' | 'RETIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Rebalancing Thresholds  (Chapter 5.6 §8, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface RebalancingThresholds {
  /** §8 — Absolute drift threshold (in quantity units). */
  absoluteDriftThreshold: number
  /** §8 — Relative drift threshold (fraction, e.g., 0.05 = 5%). */
  relativeDriftThreshold: number
  /** §8 — Minimum quantity threshold below which no order is generated. */
  minimumQuantityThreshold: number
  /** §8 — Minimum notional threshold (quote currency). */
  minimumNotionalThreshold: number
  /** §8 — Turnover threshold (fraction of NAV per day). */
  turnoverThreshold: number
  /** §8 — Portfolio drift threshold (fraction). */
  portfolioDriftThreshold: number
  /** §8 — Strategy drift threshold (fraction). */
  strategyDriftThreshold: number
  /** §8 — Time-based rebalancing interval (ms). */
  timeBasedRebalancingMs: number
  version: string
}

export const DEFAULT_REBALANCING_THRESHOLDS: RebalancingThresholds = {
  absoluteDriftThreshold: 0.001,
  relativeDriftThreshold: 0.05,
  minimumQuantityThreshold: 0.0001,
  minimumNotionalThreshold: 10,
  turnoverThreshold: 0.30,
  portfolioDriftThreshold: 0.10,
  strategyDriftThreshold: 0.15,
  timeBasedRebalancingMs: 1000 * 60 * 60, // 1 hour
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporal Rebalancing Cooldown  (Chapter 5.6 §11, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface TemporalCooldownConfig {
  /** §11 — Asset-level cooldown (ms). */
  assetCooldownMs: number
  /** §11 — Strategy-level cooldown (ms). */
  strategyCooldownMs: number
  /** §11 — Portfolio-level cooldown (ms). */
  portfolioCooldownMs: number
  /** §11 — Emergency drift threshold that overrides cooldown. */
  emergencyDriftThreshold: number
  /** Rule 22 — Whether cooldown is enabled. */
  enabled: boolean
  version: string
}

export const DEFAULT_TEMPORAL_COOLDOWN: TemporalCooldownConfig = {
  assetCooldownMs: 60000, // 1 minute
  strategyCooldownMs: 120000, // 2 minutes
  portfolioCooldownMs: 300000, // 5 minutes
  emergencyDriftThreshold: 0.20, // 20% drift overrides cooldown
  enabled: true,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown State  (Chapter 5.6 §11, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface CooldownState {
  /** Per-asset cooldown end times (symbol → timestamp). */
  assetCooldowns: Map<string, number>
  /** Per-strategy cooldown end times. */
  strategyCooldowns: Map<string, number>
  /** Portfolio-level cooldown end time. */
  portfolioCooldownEnd: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Cost Model  (Chapter 5.6 §3, §9, Rule 9, Rule 18)
// Rule 9 — Transaction cost estimates INDEPENDENT from market impact estimates.
// Rule 18 — Independently versioned.
// ─────────────────────────────────────────────────────────────────────────────

export interface TransactionCostModel {
  /** §9 — Exchange fee rate (fraction of notional). */
  exchangeFeeRate: number
  /** §9 — Broker fee rate (fraction of notional). */
  brokerFeeRate: number
  /** §9 — Bid-ask spread (fraction of price). */
  bidAskSpread: number
  /** §9 — Estimated slippage coefficient. */
  slippageCoefficient: number
  /** §9 — Funding cost rate (annualized, for perpetuals). */
  fundingRate: number
  /** §9 — Borrow cost rate (annualized, for shorts). */
  borrowRate: number
  /** §9 — FX conversion cost (fraction). */
  fxConversionCost: number
  /** Rule 18 — Model version. */
  version: string
}

export const DEFAULT_TX_COST_MODEL: TransactionCostModel = {
  exchangeFeeRate: 0.001,
  brokerFeeRate: 0.0005,
  bidAskSpread: 0.0005,
  slippageCoefficient: 0.0002,
  fundingRate: 0.0001,
  borrowRate: 0.01,
  fxConversionCost: 0.0005,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Impact Model  (Chapter 5.6 §3, §9, Rule 9, Rule 18)
// Rule 9 — INDEPENDENT from transaction cost estimates.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketImpactModel {
  /** Square-root impact coefficient. */
  sqrtImpactCoefficient: number
  /** Linear impact coefficient. */
  linearImpactCoefficient: number
  /** Rule 18 — Model version. */
  version: string
}

export const DEFAULT_MARKET_IMPACT_MODEL: MarketImpactModel = {
  sqrtImpactCoefficient: 0.1,
  linearImpactCoefficient: 0.01,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Model  (Chapter 5.6 §3, §10, Rule 11, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityModel {
  /** §10 — Maximum participation rate (fraction of ADV). */
  maxParticipationRate: number
  /** §10 — Minimum order book depth utilization (fraction). */
  maxDepthUtilization: number
  /** §10 — Maximum acceptable spread (fraction of price). */
  maxSpread: number
  /** Rule 18 — Model version. */
  version: string
}

export const DEFAULT_LIQUIDITY_MODEL: LiquidityModel = {
  maxParticipationRate: 0.10,
  maxDepthUtilization: 0.20,
  maxSpread: 0.005,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Turnover Budget  (Chapter 5.6 §3, §11, Rule 17)
// Rule 17 — Turnover budgets enforced INDEPENDENTLY of transaction cost policies.
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnoverBudget {
  /** §11 — Daily turnover limit (fraction of NAV). */
  dailyTurnoverLimit: number
  /** §11 — Portfolio turnover limit (fraction of NAV). */
  portfolioTurnoverLimit: number
  /** §11 — Strategy turnover limit (fraction of strategy allocation). */
  strategyTurnoverLimit: number
  /** §11 — Asset turnover limit (fraction of asset allocation). */
  assetTurnoverLimit: number
  version: string
}

export const DEFAULT_TURNOVER_BUDGET: TurnoverBudget = {
  dailyTurnoverLimit: 0.50,
  portfolioTurnoverLimit: 1.0,
  strategyTurnoverLimit: 0.80,
  assetTurnoverLimit: 0.90,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending Order  (Chapter 5.6 §3, §10, Rule 8, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingOrder {
  orderId: string
  positionId: string
  symbol: string
  side: OrderSide
  quantity: number
  /** §10 — When the order was created. */
  createdAt: number
  /** §10 — Last fill heartbeat. */
  lastHeartbeat: number
  /** §10 — Exchange acknowledgment status. */
  acknowledged: boolean
  /** §10 — Partial fill quantity. */
  filledQuantity: number
  /** §10 — Cancellation eligibility. */
  cancellable: boolean
  /** Rule 21 — Freshness status. */
  freshnessStatus: PendingOrderStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Current Portfolio State (ODE view)  (Chapter 5.6 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderPortfolioState {
  timestamp: number
  totalNav: number
  positions: Array<{
    symbol: string
    quantity: number
    marketValue: number
    weight: number
    strategyId: string | null
  }>
  pendingOrders: PendingOrder[]
  dailyTurnover: number
  strategyTurnover: Record<string, number>
  assetTurnover: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Cost Estimate  (Chapter 5.6 §4, §9, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface TransactionCostEstimate {
  exchangeFees: number
  brokerFees: number
  bidAskSpreadCost: number
  estimatedSlippage: number
  fundingCost: number
  borrowCost: number
  fxConversionCost: number
  totalCost: number
  /** Cost as fraction of notional. */
  costFraction: number
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Impact Estimate  (Chapter 5.6 §4, §9, Rule 9)
// Rule 9 — INDEPENDENT from transaction cost.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketImpactEstimate {
  /** Price impact (fraction of price). */
  priceImpact: number
  /** Impact cost in quote currency. */
  impactCost: number
  /** Participation rate (fraction of ADV). */
  participationRate: number
  /** Rule 18 — Model version. */
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Assessment  (Chapter 5.6 §10, Rule 11)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityAssessment {
  passed: boolean
  participationRate: number
  depthUtilization: number
  spreadCondition: number
  availableLiquidity: number
  reason: string
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Validity Horizon  (Chapter 5.6 §4, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidityHorizon {
  validFrom: number
  validUntil: number
  remainingMs: number
  isExpired: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Lineage  (Chapter 5.6 Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderLineage {
  positionId: string
  positionVersion: string
  riskAssessmentId: string
  portfolioId: string
  portfolioVersion: string
  strategyDecisionIds: string[]
  pricingSource: string
  pricingVersion: string
  transactionCostModelVersion: string
  marketImpactModelVersion: string
  liquidityModelVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Version Bundle  (Chapter 5.6 §12, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderVersionBundle {
  orderVersion: string
  positionVersion: string
  portfolioVersion: string
  riskVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Governance Metadata  (Chapter 5.6 §13)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<OrderReviewEvent>
  auditHistory: Array<OrderAuditEvent>
  creationTimestamp: number
  expirationTimestamp: number
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface OrderReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface OrderAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Metadata  (Chapter 5.6 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderMetadata {
  orderId: string
  orderVersion: string
  versions: OrderVersionBundle
  lineage: OrderLineage
  decisionType: OrderDecisionType
  executionUrgency: ExecutionUrgency
  pendingOrderStatus: PendingOrderStatus
  parentOrderId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Order Intent Contract  (Chapter 5.6 §4, §6, Rule 4)
// Every decision conforms to this contract. Alternative formats PROHIBITED.
// Records are immutable (Rule 5). Never modifies Position Contracts (Rule 13).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalOrderIntentContract {
  // §4 — Required identifiers
  orderDecisionId: string // Rule 3 — unique
  orderVersion: string
  positionId: string
  symbol: string
  decisionTimestamp: number

  // §6 — Canonical Order Intent Contract fields
  orderIntent: OrderIntent
  orderSide: OrderSide
  decisionType: OrderDecisionType
  orderQuantity: number
  targetQuantity: number
  currentQuantity: number
  rebalancingDelta: number
  parentOrderId: string | null

  // §4 — Cost + impact estimates
  transactionCostEstimate: TransactionCostEstimate
  marketImpactEstimate: MarketImpactEstimate
  turnoverEstimate: number

  // §4 — Decision metadata
  executionUrgency: ExecutionUrgency
  pendingOrderStatus: PendingOrderStatus
  orderFreshnessTimestamp: number
  decisionConfidence: number
  decisionReason: string
  validityHorizon: ValidityHorizon

  // §4, Rule 12 — Metadata + Governance
  orderMetadata: OrderMetadata
  governanceMetadata: OrderGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// ODE Configuration  (Chapter 5.6 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ODEConfiguration {
  rebalancingThresholds: RebalancingThresholds
  temporalCooldown: TemporalCooldownConfig
  transactionCostModel: TransactionCostModel
  marketImpactModel: MarketImpactModel
  liquidityModel: LiquidityModel
  turnoverBudget: TurnoverBudget
  /** Rule 10 — Economic benefit threshold (orders below this suppressed). */
  economicBenefitThreshold: number
  /** Rule 14 — Validity horizon (ms). */
  validityHorizonMs: number
  /** Rule 21 — Pending order freshness timeout (ms). */
  pendingOrderFreshnessMs: number
  /** Rule 21 — Heartbeat timeout (ms). */
  heartbeatTimeoutMs: number
  versions: OrderVersionBundle
}

export const DEFAULT_ODE_CONFIGURATION: Omit<ODEConfiguration, 'versions'> = {
  rebalancingThresholds: { ...DEFAULT_REBALANCING_THRESHOLDS },
  temporalCooldown: { ...DEFAULT_TEMPORAL_COOLDOWN },
  transactionCostModel: { ...DEFAULT_TX_COST_MODEL },
  marketImpactModel: { ...DEFAULT_MARKET_IMPACT_MODEL },
  liquidityModel: { ...DEFAULT_LIQUIDITY_MODEL },
  turnoverBudget: { ...DEFAULT_TURNOVER_BUDGET },
  economicBenefitThreshold: 0.001, // 10 bps minimum economic benefit
  validityHorizonMs: 60000, // 1 minute
  pendingOrderFreshnessMs: 30000, // 30 seconds
  heartbeatTimeoutMs: 10000, // 10 seconds
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Decision Pipeline Stages  (Chapter 5.6 §5 — 21 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_DECISION_STAGES = [
  'POSITION_CONTRACT_RECEPTION',
  'POSITION_VALIDATION',
  'CURRENT_PORTFOLIO_STATE_LOADING',
  'PENDING_ORDER_SYNCHRONIZATION',
  'PENDING_ORDER_FRESHNESS_VERIFICATION',
  'POSITION_DELTA_CALCULATION',
  'PORTFOLIO_DRIFT_EVALUATION',
  'MINIMUM_TRADE_SIZE_VALIDATION',
  'MINIMUM_NOTIONAL_VALIDATION',
  'TRANSACTION_COST_ESTIMATION',
  'MARKET_IMPACT_ESTIMATION',
  'LIQUIDITY_VERIFICATION',
  'TURNOVER_BUDGET_EVALUATION',
  'TEMPORAL_REBALANCING_COOLDOWN_VERIFICATION',
  'ORDER_NECESSITY_DECISION',
  'EXECUTION_URGENCY_CLASSIFICATION',
  'PARENT_ORDER_CONSTRUCTION',
  'ORDER_VALIDATION',
  'ORDER_PUBLICATION',
  'METADATA_RECORDING',
  'ORDER_COMPLETION',
] as const

export type OrderDecisionStage = (typeof ORDER_DECISION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const ODE_VERSION = '1.0.0'
export const ORDER_INTENT_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalPositionContract } from '../position-sizing/types'
