// CHAPTER 5.3 — Portfolio Construction Engine Types
//
// The PCE is the exclusive bridge between Strategy Intelligence (Ch 5.2) and
// Risk Management. Transforms Canonical Strategy Decision Contracts into
// portfolio-level investment allocations (§1).
//
// Core principles (§2):
//   • Strategy decisions represent investment intent.
//   • A portfolio represents a globally optimized investment structure.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Same Strategy Decision Contracts → same Portfolio Construction when
//     mathematically possible (§2).
//
// The PCE performs NO: ML, signal generation, strategy selection, position
// sizing, risk limit enforcement, broker communication, order execution (§1).
//
// 15 architectural rules enforced (see §17).
// 15-stage pipeline (§5 — no skips).

import type { CanonicalStrategyDecision } from '../strategy-engine/types'

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Construction Methodologies  (Chapter 5.3 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type PortfolioMethod =
  | 'EQUAL_WEIGHT' // §7
  | 'FIXED_ALLOCATION' // §7
  | 'MARKET_CAP_WEIGHT' // §7
  | 'EQUAL_RISK_CONTRIBUTION' // §7 (ERC)
  | 'RISK_PARITY' // §7
  | 'MINIMUM_VARIANCE' // §7
  | 'MEAN_VARIANCE' // §7
  | 'BLACK_LITTERMAN' // §7
  | 'HIERARCHICAL_RISK_PARITY' // §7 (HRP)
  | 'MAXIMUM_DIVERSIFICATION' // §7
  | 'BAYESIAN' // §7
  | 'EXPECTED_UTILITY' // §7
  | 'UNCERTAINTY_AWARE' // §7.1
  | 'LIQUIDITY_CONSTRAINED' // §7.2
  | 'TRANSACTION_COST_AWARE' // §7.3
  | 'MULTI_OBJECTIVE' // §7.4
  | 'CUSTOM' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Capital Allocation Method  (Chapter 5.3 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type CapitalAllocationMethod =
  | 'FIXED_ALLOCATION'
  | 'DYNAMIC_ALLOCATION'
  | 'STRATEGY_BASED'
  | 'ASSET_CLASS'
  | 'SECTOR'
  | 'REGION'
  | 'LIQUIDITY_BASED'
  | 'VOLATILITY_BASED'

// ─────────────────────────────────────────────────────────────────────────────
// Rebalancing Delta Action Types  (Chapter 5.3 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type RebalanceAction =
  | 'INCREASE_POSITION' // §8
  | 'REDUCE_POSITION' // §8
  | 'CLOSE_POSITION' // §8
  | 'OPEN_POSITION' // §8
  | 'CASH_REALLOCATION' // §8
  | 'CAPITAL_RESERVATION_UPDATE' // §8
  | 'PENDING_ALLOCATION_ADJUSTMENT' // §8
  | 'NO_CHANGE'

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio State  (Chapter 5.3 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type PortfolioState = 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'RETIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Approval / Validation Status  (Chapter 5.3 §12)
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
export type RetirementStatus = 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Asset Metadata  (Chapter 5.3 §3, §7.2, §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface AssetMetadata {
  symbol: string
  exchange: string
  assetClass: 'CRYPTO' | 'EQUITY' | 'FOREX' | 'COMMODITY' | 'FIXED_INCOME' | 'OTHER'
  sector: string
  country: string
  currency: string

  // §7.2 — Liquidity metadata
  averageDailyVolume: number // ADV (units)
  averageDailyDollarVolume: number // ADDV (quote currency)
  orderBookDepth: number // quote currency at top N levels
  bidAskSpread: number // fraction (e.g., 0.0005 = 5 bps)
  liquidityScore: number // 0..1 — composite

  // §7.3 — Transaction cost components
  commissionRate: number // fraction per unit
  exchangeFee: number // fraction per unit
  borrowCost: number // annualized fraction (for shorts)
  fundingCost: number // annualized fraction (perpetuals)

  // Risk metadata
  volatility: number // annualized (0..1)
  beta: number // relative to market benchmark
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset Weight  (Chapter 5.3 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface AssetWeight {
  symbol: string
  /** Target weight as fraction of NAV (0..1). Negative = short. */
  targetWeight: number
  /** Current weight as fraction of NAV. */
  currentWeight: number
  /** Capital allocated to this asset (quote currency). */
  allocatedCapital: number
  /** Expected return contribution (from strategy decisions). */
  expectedReturn: number
  /** Strategy IDs that contributed to this asset's allocation. */
  contributingStrategies: string[]
  /** Strategy Decision IDs that produced this allocation. */
  contributingDecisionIds: string[]
  /** Allocation confidence (Rule 14 — independent from Strategy Decision Confidence). */
  allocationConfidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Allocation Plan  (Chapter 5.3 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioAllocationPlan {
  /** Total portfolio NAV (quote currency). */
  totalNav: number
  /** Capital deployed (non-cash). */
  investedCapital: number
  /** Cash held (undeployed). */
  cashHolding: number
  /** Reserved capital (pending settlement). */
  reservedCapital: number
  /** Gross exposure fraction (sum of |weights|). */
  grossExposure: number
  /** Net exposure fraction (sum of signed weights). */
  netExposure: number
  /** Total leverage (gross / NAV). */
  leverage: number
  /** Per-asset weights. */
  assetWeights: AssetWeight[]
  /** Capital allocation method used. */
  allocationMethod: CapitalAllocationMethod
}

// ─────────────────────────────────────────────────────────────────────────────
// Current Portfolio State  (Chapter 5.3 §3, §4, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface CurrentPortfolioState {
  /** Snapshot timestamp. */
  timestamp: number
  /** Total portfolio NAV (quote currency). */
  totalNav: number
  /** Cash balance (quote currency). */
  cashBalance: number
  /** Reserved capital (quote currency). */
  reservedCapital: number
  /** Current open positions. */
  positions: CurrentPosition[]
  /** Capital allocation method currently in effect. */
  currentAllocationMethod: CapitalAllocationMethod
  /** Pending rebalance metadata. */
  pendingRebalance: PendingRebalance | null
}

export interface CurrentPosition {
  symbol: string
  /** Quantity (positive = long, negative = short). */
  quantity: number
  /** Average entry price. */
  avgEntryPrice: number
  /** Current market price. */
  currentPrice: number
  /** Position market value (quote currency). */
  marketValue: number
  /** Weight as fraction of NAV. */
  weight: number
  /** Unrealized PnL (quote currency). */
  unrealizedPnl: number
  /** Strategy ID that originated this position. */
  originatingStrategyId: string | null
}

export interface PendingRebalance {
  rebalanceId: string
  initiatedAt: number
  expectedCompletionAt: number
  pendingActions: number
  totalDeltaValue: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Rebalancing Delta  (Chapter 5.3 §8)
// The mathematical difference between Target Portfolio State and Current
// Portfolio State. ONLY Rebalancing Delta outputs are forwarded to downstream
// Risk Management (§8).
// ─────────────────────────────────────────────────────────────────────────────

export interface RebalancingDelta {
  /** Delta ID — unique. */
  deltaId: string
  /** Timestamp of delta computation. */
  computedAt: number
  /** Per-asset rebalance actions. */
  actions: RebalanceActionItem[]
  /** Total delta value (quote currency, signed). */
  totalDeltaValue: number
  /** Total turnover (sum of |deltas|). */
  totalTurnover: number
  /** Estimated transaction cost (quote currency). */
  estimatedTransactionCost: number
  /** Cash adjustment (positive = add cash, negative = deploy cash). */
  cashAdjustment: number
  /** Capital reservation updates. */
  reservationUpdates: Array<{
    strategyId: string
    reservationId: string
    delta: number
    reason: string
  }>
}

export interface RebalanceActionItem {
  symbol: string
  action: RebalanceAction
  /** Quantity delta (positive = buy, negative = sell). */
  quantityDelta: number
  /** Capital delta (quote currency, signed). */
  capitalDelta: number
  /** Weight delta (signed fraction). */
  weightDelta: number
  /** Target weight after rebalance. */
  targetWeight: number
  /** Current weight before rebalance. */
  currentWeight: number
  /** Strategy IDs that contributed to this action. */
  contributingStrategies: string[]
  /** Decision IDs that drove this action. */
  contributingDecisionIds: string[]
  /** Estimated transaction cost for this action. */
  estimatedCost: number
  /** Reason for this action. */
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Diversification Metrics  (Chapter 5.3 §6, §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiversificationMetrics {
  /** Herfindahl-Hirschman Index for asset concentration (0..1, 1 = single asset). */
  assetConcentration: number
  /** HHI for sector concentration. */
  sectorConcentration: number
  /** HHI for country concentration. */
  countryConcentration: number
  /** HHI for exchange concentration. */
  exchangeConcentration: number
  /** HHI for currency concentration. */
  currencyConcentration: number
  /** HHI for strategy concentration. */
  strategyConcentration: number
  /** Effective number of assets (1 / sum(weight^2)). */
  effectiveAssetCount: number
  /** Diversification ratio (weighted avg vol / portfolio vol). */
  diversificationRatio: number
  /** Liquidity capacity utilization (0..1). */
  liquidityCapacityUtilization: number
  /** Maximum participation rate across assets (0..1). */
  maxParticipationRate: number
  /** Average participation rate (0..1). */
  avgParticipationRate: number
  /** Total estimated slippage (fraction of NAV). */
  estimatedSlippage: number
  /** Turnover ratio (0..1). */
  turnoverRatio: number
  /** Diversification score (0..1, higher = more diversified). */
  diversificationScore: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation Metrics  (Chapter 5.3 §10)
// Independent from diversification (Rule 10).
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrelationMetrics {
  /** Average pairwise asset correlation (-1..1). */
  avgAssetCorrelation: number
  /** Average strategy correlation (-1..1). */
  avgStrategyCorrelation: number
  /** Average factor correlation (-1..1). */
  avgFactorCorrelation: number
  /** Average sector correlation (-1..1). */
  avgSectorCorrelation: number
  /** Average market correlation (-1..1). */
  avgMarketCorrelation: number
  /** Maximum pairwise correlation (-1..1). */
  maxCorrelation: number
  /** Number of highly correlated pairs (|corr| > threshold). */
  highlyCorrelatedPairs: number
  /** Correlation penalty applied (0..1, fraction of allocation reduced). */
  correlationPenalty: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Exposure Summary  (Chapter 5.3 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExposureSummary {
  grossLongExposure: number
  grossShortExposure: number
  netExposure: number
  netLongExposure: number
  netShortExposure: number
  perAssetClass: Record<string, number>
  perSector: Record<string, number>
  perCountry: Record<string, number>
  perCurrency: Record<string, number>
  perExchange: Record<string, number>
  perStrategy: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Constraints  (Chapter 5.3 §3, §6, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioConstraints {
  // Capital constraints
  maxGrossExposure: number
  maxNetExposure: number
  maxLeverage: number
  minCashReserve: number

  // Per-asset constraints
  maxAssetWeight: number
  minAssetWeight: number
  maxShortWeight: number

  // Per-strategy constraints
  maxStrategyWeight: number

  // §9 — Diversification constraints
  maxAssetConcentration: number // HHI
  maxSectorConcentration: number
  maxCountryConcentration: number
  maxExchangeConcentration: number
  maxCurrencyConcentration: number
  maxStrategyConcentration: number
  minEffectiveAssetCount: number

  // §7.2 — Liquidity constraints
  maxParticipationRate: number // fraction of ADV
  maxOrderBookDepthUtilization: number // fraction of depth
  maxEstimatedSlippage: number // fraction of NAV

  // §10 — Correlation constraints
  maxAvgCorrelation: number
  maxPairwiseCorrelation: number

  // §7.3 — Transaction cost constraints
  maxTotalTransactionCost: number // fraction of NAV
  maxTurnover: number // fraction of NAV

  // Prohibited / allowed assets
  prohibitedSymbols: string[]
  allowedSymbols: string[] | null // null = all allowed

  version: string
}

export const DEFAULT_PORTFOLIO_CONSTRAINTS: PortfolioConstraints = {
  maxGrossExposure: 2.0,
  maxNetExposure: 1.0,
  maxLeverage: 3.0,
  minCashReserve: 0.05,
  maxAssetWeight: 0.30,
  minAssetWeight: 0.0,
  maxShortWeight: 0.20,
  maxStrategyWeight: 0.40,
  maxAssetConcentration: 0.30,
  maxSectorConcentration: 0.50,
  maxCountryConcentration: 0.60,
  maxExchangeConcentration: 0.70,
  maxCurrencyConcentration: 0.80,
  maxStrategyConcentration: 0.50,
  minEffectiveAssetCount: 5,
  maxParticipationRate: 0.10, // 10% of ADV
  maxOrderBookDepthUtilization: 0.20,
  maxEstimatedSlippage: 0.005, // 50 bps
  maxAvgCorrelation: 0.70,
  maxPairwiseCorrelation: 0.85,
  maxTotalTransactionCost: 0.01, // 1% of NAV
  maxTurnover: 0.50,
  prohibitedSymbols: [],
  allowedSymbols: null,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Constraint Evaluation Result  (Chapter 5.3 §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstraintEvaluationResult {
  passed: boolean
  violations: Array<{
    constraint: string
    actual: number
    limit: number
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    description: string
  }>
  warnings: Array<{
    constraint: string
    actual: number
    limit: number
    description: string
  }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Version Bundle  (Chapter 5.3 §11, Rule 5 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioVersionBundle {
  portfolioVersion: string
  strategyVersion: string
  allocationVersion: string
  constraintVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Governance  (Chapter 5.3 §7.5)
// ─────────────────────────────────────────────────────────────────────────────

export interface OptimizationGovernance {
  optimizationMethod: PortfolioMethod
  optimizationVersion: string
  objectiveFunctionVersion: string
  constraintVersion: string
  configurationVersion: string
  randomSeed: number | null
  solverVersion: string
  solverConfiguration: Record<string, unknown>
  optimizationTimestamp: number
  optimizationMetadata: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Lineage  (Chapter 5.3 Rule 7 — complete lineage)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioLineage {
  strategyDecisionIds: string[]
  strategyIds: string[]
  signalIds: string[]
  predictionIds: string[]
  configurationVersion: string
  constraintVersion: string
  allocationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Governance Metadata  (Chapter 5.3 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  reviewHistory: Array<PortfolioReviewEvent>
  auditHistory: Array<PortfolioAuditEvent>
  creationTimestamp: number
  retirementStatus: RetirementStatus
  governanceNotes: string[]
}

export interface PortfolioReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface PortfolioAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Metadata  (Chapter 5.3 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioMetadata {
  portfolioId: string
  portfolioName: string
  versions: PortfolioVersionBundle
  optimization: OptimizationGovernance
  lineage: PortfolioLineage
  allocationMethod: CapitalAllocationMethod
  constructionMethod: PortfolioMethod
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Portfolio Contract  (Chapter 5.3 §4, §6, Rule 4)
// Every portfolio conforms to this contract. Alternative formats PROHIBITED.
// Portfolios are immutable (Rule 5). Allocations, NOT executable trades (Rule 13).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPortfolioContract {
  // §4 — Required identifiers
  portfolioId: string // Rule 3 — unique
  portfolioVersion: string
  allocationId: string
  strategyDecisionIds: string[]
  portfolioTimestamp: number

  // §6 — Canonical Portfolio Contract fields
  portfolioState: PortfolioState
  allocationPlan: PortfolioAllocationPlan
  targetPortfolioState: TargetPortfolioState
  currentPortfolioState: CurrentPortfolioState
  rebalancingDelta: RebalancingDelta
  capitalAdjustmentPlan: CapitalAdjustmentPlan
  assetWeights: AssetWeight[]
  exposureSummary: ExposureSummary
  diversificationMetrics: DiversificationMetrics
  correlationMetrics: CorrelationMetrics
  constraintEvaluation: ConstraintEvaluationResult
  allocationConfidence: number // Rule 14 — independent from Strategy Decision Confidence

  // §4, Rule 7 — Metadata + Governance
  portfolioMetadata: PortfolioMetadata
  governanceMetadata: PortfolioGovernanceMetadata

  // §5 — Pipeline completion metadata
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Target Portfolio State  (Chapter 5.3 §4, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface TargetPortfolioState {
  timestamp: number
  totalNav: number
  targetCash: number
  targetInvestedCapital: number
  targetGrossExposure: number
  targetNetExposure: number
  targetLeverage: number
  targetPositions: Array<{
    symbol: string
    targetQuantity: number
    targetWeight: number
    targetCapital: number
  }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Capital Adjustment Plan  (Chapter 5.3 §4, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface CapitalAdjustmentPlan {
  /** Total capital to deploy (positive) or release (negative). */
  totalCapitalAdjustment: number
  /** Cash to add (positive) or withdraw (negative). */
  cashAdjustment: number
  /** Per-strategy capital adjustments. */
  perStrategyAdjustments: Array<{
    strategyId: string
    currentAllocation: number
    targetAllocation: number
    delta: number
    reason: string
  }>
  /** Reserved capital releases. */
  reservationReleases: Array<{
    strategyId: string
    reservationId: string
    amount: number
    reason: string
  }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Configuration  (Chapter 5.3 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioConfiguration {
  portfolioId: string
  portfolioName: string
  constructionMethod: PortfolioMethod
  allocationMethod: CapitalAllocationMethod
  constraints: PortfolioConstraints

  // §7.1 — Uncertainty-aware configuration
  uncertaintyAware: {
    enabled: boolean
    epistemicPenaltyWeight: number // 0..1 — how strongly epistemic uncertainty reduces allocation
    aleatoricPenaltyWeight: number
    minConfidenceThreshold: number
  }

  // §7.3 — Transaction cost configuration
  transactionCostAware: {
    enabled: boolean
    includeMarketImpact: boolean
    marketImpactCoefficient: number // square-root impact coefficient
    includeSlippage: boolean
    slippageCoefficient: number
  }

  // §7.4 — Multi-objective configuration
  multiObjective: {
    enabled: boolean
    objectives: Array<{
      objective: MultiObjective
      weight: number // 0..1
    }>
  }

  // §10 — Correlation configuration
  correlation: {
    enabled: boolean
    correlationThreshold: number // |corr| above which allocations are reduced
    reductionFactor: number // 0..1 — fraction to reduce
  }

  // §11 — Versioning
  versions: PortfolioVersionBundle

  // §7.5 — Optimization governance
  optimization: Omit<OptimizationGovernance, 'optimizationTimestamp' | 'optimizationMetadata'>
}

export type MultiObjective =
  | 'EXPECTED_RETURN_MAX'
  | 'PORTFOLIO_RISK_MIN'
  | 'DIVERSIFICATION_MAX'
  | 'LIQUIDITY_PRESERVATION'
  | 'CAPITAL_EFFICIENCY'
  | 'STRATEGY_BALANCE'
  | 'EXPOSURE_CONTROL'
  | 'TRANSACTION_COST_MIN'
  | 'UNCERTAINTY_REDUCTION'
  | 'REGULATORY_COMPLIANCE'

export const DEFAULT_PORTFOLIO_CONFIGURATION: Omit<PortfolioConfiguration, 'portfolioId' | 'portfolioName'> = {
  constructionMethod: 'EQUAL_WEIGHT',
  allocationMethod: 'DYNAMIC_ALLOCATION',
  constraints: { ...DEFAULT_PORTFOLIO_CONSTRAINTS },
  uncertaintyAware: {
    enabled: true,
    epistemicPenaltyWeight: 0.5,
    aleatoricPenaltyWeight: 0.2,
    minConfidenceThreshold: 0.4,
  },
  transactionCostAware: {
    enabled: true,
    includeMarketImpact: true,
    marketImpactCoefficient: 0.1,
    includeSlippage: true,
    slippageCoefficient: 0.05,
  },
  multiObjective: {
    enabled: false,
    objectives: [],
  },
  correlation: {
    enabled: true,
    correlationThreshold: 0.7,
    reductionFactor: 0.3,
  },
  versions: {
    portfolioVersion: '1.0.0',
    strategyVersion: '1.0.0',
    allocationVersion: '1.0.0',
    constraintVersion: '1.0.0',
    configurationVersion: '1.0.0',
    governanceVersion: '1.0.0',
  },
  optimization: {
    optimizationMethod: 'EQUAL_WEIGHT',
    optimizationVersion: '1.0.0',
    objectiveFunctionVersion: '1.0.0',
    constraintVersion: '1.0.0',
    configurationVersion: '1.0.0',
    randomSeed: 42,
    solverVersion: 'analytic-v1',
    solverConfiguration: {},
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Construction Pipeline Stages  (Chapter 5.3 §5 — 15 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const PORTFOLIO_CONSTRUCTION_STAGES = [
  'STRATEGY_DECISION_RECEPTION',
  'DECISION_VALIDATION',
  'CURRENT_PORTFOLIO_STATE_LOADING',
  'PORTFOLIO_CONSTRAINT_LOADING',
  'TARGET_PORTFOLIO_OPTIMIZATION',
  'REBALANCING_DELTA_CALCULATION',
  'STRATEGY_AGGREGATION',
  'ASSET_SELECTION',
  'CAPITAL_ALLOCATION_PLANNING',
  'DIVERSIFICATION_ASSESSMENT',
  'CORRELATION_ASSESSMENT',
  'PORTFOLIO_CONSTRUCTION',
  'PORTFOLIO_VALIDATION',
  'PORTFOLIO_PUBLICATION',
  'METADATA_RECORDING',
  'PORTFOLIO_COMPLETION',
] as const

export type PortfolioConstructionStage = (typeof PORTFOLIO_CONSTRUCTION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const PCE_VERSION = '1.0.0'
export const PORTFOLIO_CONTRACT_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalStrategyDecision } from '../strategy-engine/types'
