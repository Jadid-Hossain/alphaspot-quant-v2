// CHAPTER 5.4 — Risk Management Engine Types
//
// The RME is the exclusive bridge between Portfolio Construction (Ch 5.3) and
// Position Sizing. Evaluates portfolio construction outputs against
// enterprise-wide risk constraints before capital is committed (§1).
//
// Core principles (§2):
//   • Investment opportunities are OPTIONAL.
//   • Risk constraints are MANDATORY.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Risk policies independent of ML, strategy, portfolio optimization,
//     position sizing, execution infrastructure.
//   • Identical portfolio proposals → identical risk decisions when possible.
//
// The RME performs NO: feature engineering, ML, signal generation, strategy
// selection, portfolio optimization, position sizing, order execution, broker
// communication (§1).
//
// 23 architectural rules enforced (see §17).
// 16-stage pipeline (§5 — no skips).

import type { CanonicalPortfolioContract } from '../portfolio-construction/types'

// ─────────────────────────────────────────────────────────────────────────────
// Risk Categories  (Chapter 5.4 §7 — configurable taxonomy)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskCategory =
  | 'MARKET_RISK' // §7
  | 'PORTFOLIO_RISK' // §7
  | 'LIQUIDITY_RISK' // §7
  | 'LEVERAGE_RISK' // §7
  | 'CONCENTRATION_RISK' // §7
  | 'CORRELATION_RISK' // §7
  | 'COUNTERPARTY_RISK' // §7
  | 'OPERATIONAL_RISK' // §7
  | 'REGULATORY_RISK' // §7
  | 'MODEL_RISK' // §7
  | 'GAP_RISK' // §7
  | 'TAIL_RISK' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Risk Decision  (Chapter 5.4 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskDecision =
  | 'APPROVED' // All constraints passed — full allocation approved
  | 'PARTIALLY_APPROVED' // Rule 15 — only for mathematically independent allocations
  | 'REJECTED' // Mandatory limit violated — not promoted
  | 'QUARANTINED' // §16 — unsafe portfolio held for review
  | 'CIRCUIT_BREAKER_HALT' // Rule 16 — emergency halt

// ─────────────────────────────────────────────────────────────────────────────
// Risk Severity
// ─────────────────────────────────────────────────────────────────────────────

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'CATASTROPHIC'

// ─────────────────────────────────────────────────────────────────────────────
// Risk State  (Chapter 5.4 §10)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskState = 'NORMAL' | 'ELEVATED' | 'HIGH_RISK' | 'EMERGENCY' | 'HALTED'

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker Status  (Chapter 5.4 §10, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitBreakerStatus =
  | 'INACTIVE' // Normal operation
  | 'WARNING' // Approaching limits
  | 'TRIGGERED' // Rule 16 — emergency halt, pending approvals invalidated
  | 'COOLDOWN' // Post-trigger cooldown
  | 'MANUAL_OVERRIDE' // Operator override

// ─────────────────────────────────────────────────────────────────────────────
// Stress Test Methodologies  (Chapter 5.4 §9, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export type StressTestMethod =
  | 'HISTORICAL_STRESS' // §9
  | 'HYPOTHETICAL_SCENARIO' // §9
  | 'MONTE_CARLO_SIMULATION' // §9
  | 'VOLATILITY_SHOCK' // §9
  | 'LIQUIDITY_SHOCK' // §9
  | 'CORRELATION_BREAKDOWN' // §9
  | 'FLASH_CRASH_SIMULATION' // §9
  | 'BLACK_SWAN_SCENARIOS' // §9

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Dependency Group Types  (Chapter 5.4 Rule 15, Rule 23)
// Mathematically linked allocations evaluated ATOMICALLY.
// ─────────────────────────────────────────────────────────────────────────────

export type AtomicDependencyType =
  | 'STATISTICAL_ARBITRAGE_PAIR' // Rule 15
  | 'DELTA_NEUTRAL_PORTFOLIO' // Rule 15
  | 'OPTION_HEDGE' // Rule 15
  | 'SPREAD_TRADE' // Rule 15
  | 'MULTI_LEG_STRATEGY' // Rule 15
  | 'CUSTOM_ATOMIC_GROUP' // Rule 15

// ─────────────────────────────────────────────────────────────────────────────
// Risk Limits  (Chapter 5.4 §8 — portfolio-level + transactional)
// Rule 22 — Transactional limits INDEPENDENT from portfolio-level limits.
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioRiskLimits {
  // §8 — Portfolio-level exposure limits
  maxPositionExposure: number // fraction of NAV per single position
  maxPortfolioExposure: number // gross exposure fraction
  maxSectorExposure: number // sector concentration fraction
  maxAssetExposure: number // per-asset weight fraction
  maxStrategyExposure: number // per-strategy allocation fraction

  // §8 — Leverage limits
  maxLeverage: number // max gross leverage
  maxMarginUtilization: number // fraction of available margin

  // §8 — Drawdown / loss limits
  maxDrawdown: number // max portfolio drawdown fraction
  maxDailyLoss: number // max single-day loss fraction

  // §8 — Correlation limits
  maxCorrelation: number // max pairwise correlation
  maxAvgCorrelation: number // max average correlation

  // §8 — Liquidity limits
  maxParticipationRate: number // max ADV participation
  minLiquidityRequirement: number // min liquidity score

  // §8 — Risk score limits
  maxRiskScore: number // 0..1
  maxLiquidationProbability: number // 0..1

  version: string
}

export interface TransactionalRiskLimits {
  // §8, Rule 22 — Transactional hard limits (INDEPENDENT from portfolio-level)
  maxSingleTransactionSize: number // quote currency
  maxRebalancingDelta: number // max total rebalancing delta (quote currency)
  maxOrderFlowRate: number // orders per second
  maxCapitalDeploymentRate: number // quote currency per second
  maxExchangeParticipationRate: number // fraction of exchange ADV per transaction
  maxMarginUtilization: number // fraction of available margin per transaction

  version: string
}

export const DEFAULT_PORTFOLIO_RISK_LIMITS: PortfolioRiskLimits = {
  maxPositionExposure: 0.25,
  maxPortfolioExposure: 2.0,
  maxSectorExposure: 0.50,
  maxAssetExposure: 0.30,
  maxStrategyExposure: 0.40,
  maxLeverage: 3.0,
  maxMarginUtilization: 0.80,
  maxDrawdown: 0.15,
  maxDailyLoss: 0.05,
  maxCorrelation: 0.85,
  maxAvgCorrelation: 0.70,
  maxParticipationRate: 0.10,
  minLiquidityRequirement: 0.30,
  maxRiskScore: 0.80,
  maxLiquidationProbability: 0.05,
  version: '1.0.0',
}

export const DEFAULT_TRANSACTIONAL_RISK_LIMITS: TransactionalRiskLimits = {
  maxSingleTransactionSize: 100000,
  maxRebalancingDelta: 500000,
  maxOrderFlowRate: 10,
  maxCapitalDeploymentRate: 50000,
  maxExchangeParticipationRate: 0.05,
  maxMarginUtilization: 0.25,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Margin Configuration  (Chapter 5.4 §3, Rule 21)
// Pre-trade margin simulation requires exchange-specific config.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeMarginConfiguration {
  exchange: string
  /** Maintenance margin rate (fraction of position value). */
  maintenanceMarginRate: number
  /** Initial margin rate (fraction of position value). */
  initialMarginRate: number
  /** Maximum leverage allowed by the exchange. */
  maxExchangeLeverage: number
  /** Liquidation threshold (margin ratio below which liquidation occurs). */
  liquidationThreshold: number
  /** Margin call threshold (margin ratio below which margin call occurs). */
  marginCallThreshold: number
  /** Whether cross-margin is supported. */
  crossMarginSupported: boolean
  /** Per-asset leverage overrides. */
  perAssetLeverage: Record<string, number>
}

export const DEFAULT_EXCHANGE_MARGIN_CONFIG: ExchangeMarginConfiguration = {
  exchange: 'BINANCE',
  maintenanceMarginRate: 0.025,
  initialMarginRate: 0.04,
  maxExchangeLeverage: 20,
  liquidationThreshold: 0.015,
  marginCallThreshold: 0.03,
  crossMarginSupported: true,
  perAssetLeverage: {},
}

// ─────────────────────────────────────────────────────────────────────────────
// Margin Status  (Chapter 5.4 §3, §10, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarginStatus {
  /** Total margin used (quote currency). */
  marginUsed: number
  /** Available margin (quote currency). */
  availableMargin: number
  /** Margin ratio (marginUsed / (marginUsed + availableMargin)). */
  marginRatio: number
  /** Maintenance margin required. */
  maintenanceMargin: number
  /** Whether margin call is triggered. */
  marginCallTriggered: boolean
  /** Whether liquidation is imminent. */
  liquidationImminent: boolean
  /** Projected margin after rebalancing. */
  projectedMargin: number
  /** Projected margin ratio after rebalancing. */
  projectedMarginRatio: number
  /** Liquidation probability (0..1). */
  liquidationProbability: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Stress Test Configuration  (Chapter 5.4 §3, §9, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface StressTestConfiguration {
  /** Enabled stress test methods (§9). */
  enabledMethods: StressTestMethod[]
  /** Per-method parameters. */
  parameters: Record<StressTestMethod, StressTestParameters>
  /** Maximum acceptable portfolio loss under any stress scenario (fraction). */
  maxAcceptableLoss: number
  /** Whether stress tests are mandatory (Rule 9 — independent from constraint eval). */
  mandatory: boolean
  /** Stress test version (Rule 19 — independent from portfolio construction). */
  version: string
}

export interface StressTestParameters {
  /** Shock magnitude (fraction, e.g., 0.10 = 10% shock). */
  shockMagnitude: number
  /** Duration of stress scenario (ms). */
  durationMs: number
  /** Number of Monte Carlo paths (for simulation methods). */
  monteCarloPaths: number
  /** Confidence level for VaR (0..1). */
  confidenceLevel: number
  /** Custom scenario parameters. */
  customParams: Record<string, number>
}

export const DEFAULT_STRESS_TEST_CONFIG: StressTestConfiguration = {
  enabledMethods: [
    'VOLATILITY_SHOCK',
    'LIQUIDITY_SHOCK',
    'CORRELATION_BREAKDOWN',
    'FLASH_CRASH_SIMULATION',
  ],
  parameters: {
    HISTORICAL_STRESS: { shockMagnitude: 0.20, durationMs: 86400000, monteCarloPaths: 0, confidenceLevel: 0.95, customParams: { historicalEvent: '2020-03-COVID' } },
    HYPOTHETICAL_SCENARIO: { shockMagnitude: 0.15, durationMs: 3600000, monteCarloPaths: 0, confidenceLevel: 0.95, customParams: {} },
    MONTE_CARLO_SIMULATION: { shockMagnitude: 0.10, durationMs: 86400000, monteCarloPaths: 1000, confidenceLevel: 0.95, customParams: {} },
    VOLATILITY_SHOCK: { shockMagnitude: 0.05, durationMs: 3600000, monteCarloPaths: 0, confidenceLevel: 0.95, customParams: { volMultiplier: 2.0 } },
    LIQUIDITY_SHOCK: { shockMagnitude: 0.10, durationMs: 1800000, monteCarloPaths: 0, confidenceLevel: 0.95, customParams: { participationReduction: 0.5 } },
    CORRELATION_BREAKDOWN: { shockMagnitude: 0.15, durationMs: 3600000, monteCarloPaths: 0, confidenceLevel: 0.95, customParams: { correlationMultiplier: 1.5 } },
    FLASH_CRASH_SIMULATION: { shockMagnitude: 0.25, durationMs: 600000, monteCarloPaths: 0, confidenceLevel: 0.99, customParams: { recoveryTime: 1800000 } },
    BLACK_SWAN_SCENARIOS: { shockMagnitude: 0.50, durationMs: 86400000, monteCarloPaths: 0, confidenceLevel: 0.999, customParams: { extremeEvent: true } },
  },
  maxAcceptableLoss: 0.20, // 20% max loss under stress
  mandatory: true,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Stress Test Result  (Chapter 5.4 §4, §6, §9, Rule 9)
// Rule 9 — Stress testing logically INDEPENDENT from standard constraint eval.
// ─────────────────────────────────────────────────────────────────────────────

export interface StressTestResult {
  method: StressTestMethod
  scenario: string
  passed: boolean
  /** Projected portfolio loss under this scenario (fraction of NAV). */
  projectedLoss: number
  /** Projected portfolio value after stress (quote currency). */
  projectedValue: number
  /** Value at Risk at configured confidence level. */
  valueAtRisk: number
  /** Expected shortfall (conditional VaR). */
  expectedShortfall: number
  /** Liquidation probability under stress (0..1). */
  liquidationProbability: number
  /** Per-asset stress impacts. */
  assetImpacts: Array<{ symbol: string; impact: number }>
  /** Whether this stress test caused rejection. */
  causedRejection: boolean
  /** Method version (Rule 19). */
  methodVersion: string
  /** Description of the stress scenario. */
  description: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Dependency Group  (Chapter 5.4 Rule 15, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export interface AtomicDependencyGroup {
  groupId: string
  groupType: AtomicDependencyType
  /** Symbols/positions that are mathematically linked. */
  members: AtomicDependencyMember[]
  /** Whether the group must be evaluated atomically (Rule 15). */
  atomic: boolean
  /** Description of the dependency. */
  description: string
}

export interface AtomicDependencyMember {
  symbol: string
  /** Weight/role in the group (e.g., +1 for long leg, -1 for short leg). */
  weight: number
  /** Whether this member is mandatory for group neutrality. */
  mandatory: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Approved / Rejected Allocations  (Chapter 5.4 §4, §6, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovedAllocation {
  symbol: string
  /** Approved target weight (may be reduced from portfolio proposal). */
  approvedWeight: number
  /** Original proposed weight. */
  proposedWeight: number
  /** Reduction factor applied (1.0 = no reduction, 0.0 = fully rejected). */
  reductionFactor: number
  /** Reason for any reduction. */
  reductionReason: string
  /** Strategy IDs contributing to this allocation. */
  contributingStrategies: string[]
  /** Risk score for this specific allocation (0..1). */
  allocationRiskScore: number
  /** Whether this allocation is part of an atomic group. */
  atomicGroupId: string | null
}

export interface RejectedAllocation {
  symbol: string
  /** Original proposed weight. */
  proposedWeight: number
  /** Reason for rejection. */
  rejectionReason: string
  /** Risk category that triggered rejection. */
  rejectionCategory: RiskCategory
  /** Severity of the violation. */
  severity: RiskSeverity
  /** Whether this is part of an atomic group rejection (Rule 15). */
  atomicGroupRejection: boolean
  /** Atomic group ID if applicable. */
  atomicGroupId: string | null
  /** Constraint that was violated. */
  violatedConstraint: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Constraint Violation  (Chapter 5.4 §6, Rule 18)
// Rule 18 — Constraint violations generate IMMUTABLE governance events.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstraintViolation {
  violationId: string
  constraint: string
  category: RiskCategory
  severity: RiskSeverity
  actual: number
  limit: number
  description: string
  timestamp: number
  /** Whether this is a transactional limit violation (Rule 22). */
  transactional: boolean
  /** Affected symbols. */
  affectedSymbols: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Lineage  (Chapter 5.4 Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskLineage {
  portfolioId: string
  portfolioVersion: string
  allocationId: string
  strategyDecisionIds: string[]
  constraintVersion: string
  configurationVersion: string
  governanceVersion: string
  stressTestVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Version Bundle  (Chapter 5.4 §11, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskVersionBundle {
  riskVersion: string
  portfolioVersion: string
  constraintVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Governance Metadata  (Chapter 5.4 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<RiskReviewEvent>
  auditHistory: Array<RiskAuditEvent>
  creationTimestamp: number
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface RiskReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface RiskAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Metadata  (Chapter 5.4 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskMetadata {
  riskAssessmentId: string
  riskVersion: string
  versions: RiskVersionBundle
  lineage: RiskLineage
  riskState: RiskState
  circuitBreakerStatus: CircuitBreakerStatus
  atomicGroups: AtomicDependencyGroup[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Risk Contract  (Chapter 5.4 §4, §6, Rule 4)
// Every evaluation conforms to this contract. Alternative formats PROHIBITED.
// Records are immutable (Rule 5). Risk scores independent from allocation
// confidence (Rule 14). Never modifies Canonical Portfolio Contracts (Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalRiskContract {
  // §4 — Required identifiers
  riskAssessmentId: string // Rule 3 — unique
  riskVersion: string
  portfolioId: string
  portfolioVersion: string
  evaluationTimestamp: number

  // §6 — Canonical Risk Contract fields
  riskDecision: RiskDecision
  riskScore: number // 0..1 (Rule 14 — independent from allocation confidence)
  approvedAllocations: ApprovedAllocation[]
  rejectedAllocations: RejectedAllocation[]
  exposureSummary: RiskExposureSummary
  constraintViolations: ConstraintViolation[]
  stressTestResults: StressTestResult[]
  liquidityStatus: LiquidityAssessment
  leverageStatus: LeverageAssessment
  marginStatus: MarginStatus

  // §4 — Metadata + Governance
  riskMetadata: RiskMetadata
  governanceMetadata: RiskGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Exposure Summary  (Chapter 5.4 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskExposureSummary {
  grossExposure: number
  netExposure: number
  longExposure: number
  shortExposure: number
  leverage: number
  perSector: Record<string, number>
  perAsset: Record<string, number>
  perStrategy: Record<string, number>
  concentrationRisk: number // 0..1 HHI
  correlationRisk: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Assessment  (Chapter 5.4 §6, Rule 10)
// Rule 10 — Liquidity constraints INDEPENDENT from leverage constraints.
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityAssessment {
  passed: boolean
  /** Max participation rate across all assets. */
  maxParticipationRate: number
  /** Average participation rate. */
  avgParticipationRate: number
  /** Liquidity score (0..1, higher = more liquid). */
  liquidityScore: number
  /** Estimated slippage as fraction of NAV. */
  estimatedSlippage: number
  /** Whether any asset fails minimum liquidity requirement. */
  belowMinimumLiquidity: string[]
  /** Liquidity-constrained assets (reduced allocation needed). */
  constrainedAssets: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Leverage Assessment  (Chapter 5.4 §6, Rule 10)
// Rule 10 — Leverage constraints INDEPENDENT from liquidity constraints.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeverageAssessment {
  passed: boolean
  /** Current gross leverage. */
  grossLeverage: number
  /** Net leverage. */
  netLeverage: number
  /** Maximum allowed leverage. */
  maxLeverage: number
  /** Margin utilization (0..1). */
  marginUtilization: number
  /** Whether leverage exceeds limits. */
  exceedsLeverageLimit: boolean
  /** Liquidation distance (0..1, higher = safer). */
  liquidationDistance: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Current Portfolio State (Risk View)  (Chapter 5.4 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskPortfolioState {
  timestamp: number
  totalNav: number
  cashBalance: number
  positions: Array<{
    symbol: string
    quantity: number
    marketValue: number
    weight: number
    unrealizedPnl: number
  }>
  currentDrawdown: number
  dailyPnl: number
  marginStatus: MarginStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Configuration  (Chapter 5.4 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskConfiguration {
  portfolioLimits: PortfolioRiskLimits
  transactionalLimits: TransactionalRiskLimits
  stressTestConfig: StressTestConfiguration
  exchangeMarginConfig: ExchangeMarginConfiguration
  atomicDependencyGroups: AtomicDependencyGroup[]
  versions: RiskVersionBundle
  /** Whether circuit breakers are enabled (Rule 16). */
  circuitBreakersEnabled: boolean
  /** Drawdown threshold for circuit breaker trigger. */
  circuitBreakerDrawdownThreshold: number
  /** Daily loss threshold for circuit breaker trigger. */
  circuitBreakerDailyLossThreshold: number
}

export const DEFAULT_RISK_CONFIGURATION: Omit<RiskConfiguration, 'versions'> = {
  portfolioLimits: { ...DEFAULT_PORTFOLIO_RISK_LIMITS },
  transactionalLimits: { ...DEFAULT_TRANSACTIONAL_RISK_LIMITS },
  stressTestConfig: { ...DEFAULT_STRESS_TEST_CONFIG },
  exchangeMarginConfig: { ...DEFAULT_EXCHANGE_MARGIN_CONFIG },
  atomicDependencyGroups: [],
  circuitBreakersEnabled: true,
  circuitBreakerDrawdownThreshold: 0.12, // 12% drawdown triggers circuit breaker
  circuitBreakerDailyLossThreshold: 0.04, // 4% daily loss triggers circuit breaker
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Evaluation Pipeline Stages  (Chapter 5.4 §5 — 16 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_EVALUATION_STAGES = [
  'PORTFOLIO_RECEPTION',
  'PORTFOLIO_VALIDATION',
  'CURRENT_PORTFOLIO_STATE_LOADING',
  'RISK_POLICY_LOADING',
  'ATOMIC_DEPENDENCY_VERIFICATION',
  'EXPOSURE_ASSESSMENT',
  'LIQUIDITY_ASSESSMENT',
  'PRE_TRADE_MARGIN_SIMULATION',
  'STRESS_TESTING',
  'TRANSACTIONAL_LIMIT_VERIFICATION',
  'CONSTRAINT_EVALUATION',
  'RISK_DECISION_CONSTRUCTION',
  'RISK_VALIDATION',
  'RISK_PUBLICATION',
  'METADATA_RECORDING',
  'RISK_COMPLETION',
] as const

export type RiskEvaluationStage = (typeof RISK_EVALUATION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const RME_VERSION = '1.0.0'
export const RISK_CONTRACT_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalPortfolioContract } from '../portfolio-construction/types'
