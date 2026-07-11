// CHAPTER 5.5 — Position Sizing Engine Types
//
// The PSE is the exclusive bridge between Risk Management (Ch 5.4) and the
// Order Decision Engine. Transforms risk-approved portfolio allocations into
// executable position sizes (§1).
//
// Core principles (§2):
//   • Risk determines WHETHER a trade is permitted.
//   • Position sizing determines HOW MUCH capital is committed.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Sizing methodologies independent of ML, strategy, portfolio construction,
//     risk policies, execution infrastructure.
//   • Identical approved allocations → identical position sizes when possible.
//
// The PSE performs NO: ML, signal generation, strategy selection, portfolio
// construction, risk evaluation, order routing, broker communication, market
// execution (§1).
//
// 25 architectural rules enforced (see §17).
// 17-stage pipeline (§5 — no skips).

import type { CanonicalRiskContract } from '../risk-management/types'

// ─────────────────────────────────────────────────────────────────────────────
// Position Sizing Methods  (Chapter 5.5 §7 — 12 methodologies)
// ─────────────────────────────────────────────────────────────────────────────

export type PositionSizingMethod =
  | 'FIXED_FRACTIONAL' // §7
  | 'FIXED_DOLLAR' // §7
  | 'FIXED_RISK' // §7
  | 'KELLY_CRITERION' // §7
  | 'FRACTIONAL_KELLY' // §7
  | 'VOLATILITY_TARGETING' // §7
  | 'ATR_BASED' // §7
  | 'RISK_BUDGETING' // §7
  | 'EQUAL_RISK_ALLOCATION' // §7
  | 'DYNAMIC_CAPITAL_ALLOCATION' // §7
  | 'CONVICTION_BASED' // §7
  | 'CUSTOM' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Position State  (Chapter 5.5 §10)
// ─────────────────────────────────────────────────────────────────────────────

export type PositionState = 'PENDING' | 'SIZED' | 'APPROVED' | 'PUBLISHED' | 'EXECUTED' | 'REJECTED' | 'EXPIRED' | 'RETIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Capital Reservation Status  (Chapter 5.5 §8, Rule 21, Rule 24)
// ─────────────────────────────────────────────────────────────────────────────

export type CapitalReservationStatus =
  | 'NOT_REQUESTED' // No capital reservation needed
  | 'LOCK_ACQUIRED' // Rule 21 — atomic lock acquired before sizing
  | 'RESERVED' // Capital reserved (pending position publication)
  | 'COMMITTED' // Rule 13 — committed at position publication
  | 'RELEASED' // Capital released (position executed or expired)
  | 'ROLLED_BACK' // Rule 24 — rolled back due to failure
  | 'TIMEOUT' // Reservation timed out
  | 'INSUFFICIENT_CAPITAL' // Not enough capital available

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Normalization Status  (Chapter 5.5 §6, §9, Rule 10, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export type ExchangeNormalizationStatus =
  | 'NOT_REQUIRED' // Quantity already exchange-compliant
  | 'NORMALIZED' // Rule 16 — adjusted to nearest valid quantity
  | 'REDUCED' // Rule 10 — reduced to satisfy constraints (never enlarged)
  | 'REJECTED' // Cannot normalize without violating risk limits

// ─────────────────────────────────────────────────────────────────────────────
// Approval / Validation Status  (Chapter 5.5 §12)
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
export type RetirementStatus = 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Trading Rules  (Chapter 5.5 §3, §9, Rule 19)
// All exchange-specific rules versioned independently.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeTradingRules {
  exchange: string
  symbol: string
  /** §9 — Minimum lot size (quantity). */
  minLotSize: number
  /** §9 — Maximum lot size (quantity). */
  maxLotSize: number
  /** §9 — Tick size (minimum price increment). */
  tickSize: number
  /** §9 — Contract multiplier (e.g., 1 for spot, 100 for some options). */
  contractMultiplier: number
  /** §9 — Whether fractional quantities are allowed. */
  fractionalQuantitiesAllowed: boolean
  /** §9 — Position precision (decimal places for quantity). */
  positionPrecision: number
  /** §9 — Currency precision (decimal places for price). */
  currencyPrecision: number
  /** §9 — Maximum order quantity per transaction. */
  maxOrderQuantity: number
  /** Rule 19 — Version of these exchange rules. */
  version: string
}

export const DEFAULT_EXCHANGE_RULES: ExchangeTradingRules = {
  exchange: 'BINANCE',
  symbol: 'DEFAULT',
  minLotSize: 0.0001,
  maxLotSize: 1000000,
  tickSize: 0.01,
  contractMultiplier: 1,
  fractionalQuantitiesAllowed: true,
  positionPrecision: 8,
  currencyPrecision: 2,
  maxOrderQuantity: 1000000,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Price Oracle Entry  (Chapter 5.5 §3, Rule 22)
// Real-Time Price Oracle — versioned, recorded in lineage.
// ─────────────────────────────────────────────────────────────────────────────

export interface PriceOracleEntry {
  symbol: string
  /** Current price in quote currency. */
  price: number
  /** Quote currency (e.g., 'USDT'). */
  quoteCurrency: string
  /** Price timestamp. */
  timestamp: number
  /** Oracle source identifier (Rule 22 — versioned). */
  source: string
  /** Oracle version. */
  sourceVersion: string
  /** Confidence in the price (0..1). */
  confidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// FX Conversion Oracle Entry  (Chapter 5.5 §3, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface FXOracleEntry {
  fromCurrency: string
  toCurrency: string
  /** Exchange rate: 1 fromCurrency = rate toCurrency. */
  rate: number
  timestamp: number
  source: string
  sourceVersion: string
  confidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Capital Reservation  (Chapter 5.5 §8, Rule 21, Rule 24, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export interface CapitalReservation {
  reservationId: string
  /** Strategy/position this reservation is for. */
  ownerId: string
  /** Amount reserved (quote currency). */
  amount: number
  /** When the reservation was created. */
  reservedAt: number
  /** When the reservation expires (timeout). */
  expiresAt: number
  status: CapitalReservationStatus
  /** Reason for the reservation. */
  reason: string
  /** Whether this is an atomic lock (Rule 21). */
  atomicLock: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Capital State  (Chapter 5.5 §8, §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface CapitalState {
  /** Total available capital (quote currency). */
  totalCapital: number
  /** Currently available (unreserved) capital. */
  availableCapital: number
  /** Total reserved across all pending positions. */
  totalReserved: number
  /** Cash buffer (minimum reserve). */
  cashBuffer: number
  /** Active capital reservations. */
  reservations: CapitalReservation[]
  /** Per-strategy capital budgets. */
  strategyBudgets: Record<string, number>
  /** Per-strategy allocated capital. */
  strategyAllocated: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Sizing Configuration  (Chapter 5.5 §3, §7, Rule 23)
// Rule 23 — Hard-cap constraints may reduce but never increase.
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionSizingConfiguration {
  /** Default sizing method. */
  defaultMethod: PositionSizingMethod
  /** Per-strategy method overrides. */
  perStrategyMethod: Record<string, PositionSizingMethod>
  /** Rule 23 — Mathematical hard caps (safety boundaries). */
  hardCaps: PositionSizingHardCaps
  /** Method-specific parameters. */
  methodParameters: Record<PositionSizingMethod, SizingMethodParameters>
  /** Cash buffer fraction (minimum cash reserve). */
  cashBufferFraction: number
  /** Capital reservation timeout (ms). */
  reservationTimeoutMs: number
  /** Whether atomic capital locking is enabled (Rule 21). */
  atomicLockingEnabled: boolean
  versions: PositionVersionBundle
}

export interface PositionSizingHardCaps {
  /** Maximum fraction of NAV per single position (Rule 23). */
  maxPositionFraction: number
  /** Maximum absolute capital per position (quote currency). */
  maxAbsoluteCapital: number
  /** Maximum quantity per position. */
  maxQuantity: number
  /** Maximum leverage implied by position. */
  maxLeverage: number
  /** Minimum position size (below this → reject). */
  minPositionSize: number
  version: string
}

export interface SizingMethodParameters {
  // Fixed Fractional
  fractionalPercent: number // e.g., 0.02 = 2% of capital
  // Fixed Dollar
  fixedDollarAmount: number
  // Fixed Risk
  riskPerTrade: number // fraction of capital to risk
  stopLossPercent: number // stop loss distance
  // Kelly
  kellyFraction: number // full Kelly = 1.0, half Kelly = 0.5
  winRate: number
  winLossRatio: number
  // Volatility Targeting
  targetVolatility: number // annualized
  assetVolatility: number // annualized
  // ATR-Based
  atrPeriod: number
  atrMultiplier: number
  // Risk Budgeting
  riskBudget: number
  // Equal Risk Allocation
  assetCorrelation: number
  // Dynamic Capital Allocation
  dynamicAdjustmentFactor: number
  // Conviction-Based
  convictionScale: number
  minConviction: number
  maxConviction: number
  version: string
}

export const DEFAULT_HARD_CAPS: PositionSizingHardCaps = {
  maxPositionFraction: 0.25,
  maxAbsoluteCapital: 500000,
  maxQuantity: 1000000,
  maxLeverage: 3.0,
  minPositionSize: 10,
  version: '1.0.0',
}

export const DEFAULT_METHOD_PARAMETERS: SizingMethodParameters = {
  fractionalPercent: 0.02,
  fixedDollarAmount: 10000,
  riskPerTrade: 0.01,
  stopLossPercent: 0.05,
  kellyFraction: 0.5, // half Kelly
  winRate: 0.55,
  winLossRatio: 1.5,
  targetVolatility: 0.15,
  assetVolatility: 0.60,
  atrPeriod: 14,
  atrMultiplier: 2.0,
  riskBudget: 0.02,
  assetCorrelation: 0.3,
  dynamicAdjustmentFactor: 1.0,
  convictionScale: 1.0,
  minConviction: 0.3,
  maxConviction: 1.0,
  version: '1.0.0',
}

export const DEFAULT_SIZING_CONFIG: Omit<PositionSizingConfiguration, 'versions'> = {
  defaultMethod: 'FIXED_FRACTIONAL',
  perStrategyMethod: {},
  hardCaps: { ...DEFAULT_HARD_CAPS },
  methodParameters: Object.fromEntries(
    ([
      'FIXED_FRACTIONAL', 'FIXED_DOLLAR', 'FIXED_RISK', 'KELLY_CRITERION',
      'FRACTIONAL_KELLY', 'VOLATILITY_TARGETING', 'ATR_BASED', 'RISK_BUDGETING',
      'EQUAL_RISK_ALLOCATION', 'DYNAMIC_CAPITAL_ALLOCATION', 'CONVICTION_BASED', 'CUSTOM',
    ] as PositionSizingMethod[]).map((m) => [m, { ...DEFAULT_METHOD_PARAMETERS }])
  ) as Record<PositionSizingMethod, SizingMethodParameters>,
  cashBufferFraction: 0.05,
  reservationTimeoutMs: 30000, // 30 seconds
  atomicLockingEnabled: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Version Bundle  (Chapter 5.5 §11, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionVersionBundle {
  positionVersion: string
  riskVersion: string
  portfolioVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Lineage  (Chapter 5.5 Rule 7)
// Links risk assessments, portfolio allocations, sizing configs, exchange rules, governance.
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionLineage {
  riskAssessmentId: string
  riskVersion: string
  portfolioId: string
  portfolioVersion: string
  allocationId: string
  strategyDecisionIds: string[]
  sizingMethodVersion: string
  exchangeRulesVersion: string
  priceOracleSource: string
  priceOracleVersion: string
  fxOracleSource: string
  fxOracleVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Governance Metadata  (Chapter 5.5 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  reviewHistory: Array<PositionReviewEvent>
  auditHistory: Array<PositionAuditEvent>
  creationTimestamp: number
  retirementStatus: RetirementStatus
  governanceNotes: string[]
}

export interface PositionReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface PositionAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Metadata  (Chapter 5.5 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionMetadata {
  positionId: string
  positionVersion: string
  versions: PositionVersionBundle
  lineage: PositionLineage
  sizingMethod: PositionSizingMethod
  sizingMethodVersion: string
  exchangeNormalizationStatus: ExchangeNormalizationStatus
  capitalReservationStatus: CapitalReservationStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Approved Allocation (from Ch 5.4 Risk Contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovedAllocationInput {
  symbol: string
  approvedWeight: number
  contributingStrategies: string[]
  allocationRiskScore: number
  atomicGroupId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Position Contract  (Chapter 5.5 §4, §6, Rule 4)
// Every position conforms to this contract. Alternative formats PROHIBITED.
// Positions are immutable (Rule 5). Never modifies Risk Contracts (Rule 8).
// Exchange normalization never increases risk (Rule 10).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPositionContract {
  // §4 — Required identifiers
  positionId: string // Rule 3 — unique
  positionVersion: string
  riskAssessmentId: string
  portfolioId: string
  symbol: string
  positionTimestamp: number

  // §6 — Canonical Position Contract fields
  targetPositionSize: number // capital allocation (quote currency)
  targetQuantity: number // executable quantity
  capitalAllocation: number // capital committed
  estimatedNotionalValue: number // quantity × price
  lotSize: number
  tickSize: number
  positionSizingMethod: PositionSizingMethod
  positionConfidence: number // 0..1
  exchangeNormalizationStatus: ExchangeNormalizationStatus

  // §4 — Price + FX
  price: number
  quoteCurrency: string
  fxRate: number
  baseCurrency: string

  // §4 — Capital reservation
  capitalReservationId: string | null
  capitalReservationStatus: CapitalReservationStatus

  // Rule 9 — Capital allocation INDEPENDENT from quantity normalization
  capitalAllocationPreNormalization: number
  capitalAllocationPostNormalization: number
  normalizationDelta: number

  // §4, Rule 7 — Metadata + Governance
  positionMetadata: PositionMetadata
  governanceMetadata: PositionGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Sizing Pipeline Stages  (Chapter 5.5 §5 — 17 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const POSITION_SIZING_STAGES = [
  'RISK_CONTRACT_RECEPTION',
  'RISK_VALIDATION',
  'ATOMIC_CAPITAL_LOCK_ACQUISITION',
  'CAPITAL_AVAILABILITY_VERIFICATION',
  'CAPITAL_RESERVATION_VERIFICATION',
  'PRICE_FX_TRANSLATION',
  'POSITION_SIZING_METHOD_SELECTION',
  'POSITION_SIZE_CALCULATION',
  'VOLATILITY_ADJUSTMENT',
  'MATHEMATICAL_HARD_CAP_ENFORCEMENT',
  'EXCHANGE_CONSTRAINT_NORMALIZATION',
  'QUANTITY_CONSTRUCTION',
  'POSITION_VALIDATION',
  'CAPITAL_RESERVATION_COMMIT',
  'POSITION_PUBLICATION',
  'METADATA_RECORDING',
  'POSITION_COMPLETION',
] as const

export type PositionSizingStage = (typeof POSITION_SIZING_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const PSE_VERSION = '1.0.0'
export const POSITION_CONTRACT_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalRiskContract } from '../risk-management/types'
