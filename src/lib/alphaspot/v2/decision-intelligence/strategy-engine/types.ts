// CHAPTER 5.2 — Strategy Intelligence Engine Types
//
// The SIE is the exclusive bridge between Signal Generation (Ch 5.1) and
// Portfolio Construction (Ch 5.3). It transforms Canonical Signals into
// strategy-specific Strategy Decisions (§1).
//
// Core principles (§2):
//   • Signals are informational; strategies are decision systems.
//   • A valid signal does NOT automatically imply a trade.
//   • Every strategy independently determines whether a signal qualifies.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Strategy independent — multiple strategies may consume the same signal.
//
// The engine performs NO: feature engineering, ML inference, portfolio optimization,
// position sizing, risk management, order execution, broker communication (§1).
//
// 22 architectural rules enforced (see §17).

import type { CanonicalSignal, MarketRegime, SignalType } from '../signal-generation/types'

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Types  (Chapter 5.2 §7 — configurable taxonomy)
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyType =
  | 'TREND_FOLLOWING'
  | 'MEAN_REVERSION'
  | 'BREAKOUT'
  | 'MOMENTUM'
  | 'STATISTICAL_ARBITRAGE'
  | 'MARKET_MAKING'
  | 'PAIRS_TRADING'
  | 'SWING_TRADING'
  | 'SCALPING'
  | 'VOLATILITY_TRADING'
  | 'OPTIONS_STRATEGIES'
  | 'HYBRID_STRATEGIES'

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Coordination Mode  (Chapter 5.2 §9)
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyCoordinationMode =
  | 'INDEPENDENT' // §9 — operates without coordination
  | 'COOPERATIVE' // §9 — coordinates with other strategies
  | 'HIERARCHICAL' // §9 — parent/child relationship
  | 'PARALLEL' // §9 — runs in parallel with siblings
  | 'META' // §9 — meta-strategy wrapping others
  | 'COMPOSITE' // §9 — composite of multiple strategies

// ─────────────────────────────────────────────────────────────────────────────
// Strategy State  (Chapter 5.2 §10 — institutional lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyState =
  | 'ACTIVE' // Normal operation
  | 'COOLDOWN' // §10 — temporary suspension after losses/drawdown
  | 'SUSPENDED' // §10 — manual or governance suspension
  | 'RECOVERY' // §10 — recovering from cooldown/suspension
  | 'OBSERVATION' // §10 — running in shadow mode
  | 'RETIRED' // §10 — permanent retirement

// ─────────────────────────────────────────────────────────────────────────────
// Decision Type  (Chapter 5.2 §6)
// ─────────────────────────────────────────────────────────────────────────────

export type DecisionType =
  | 'ENTER_LONG'
  | 'ENTER_SHORT'
  | 'EXIT_LONG'
  | 'EXIT_SHORT'
  | 'INCREASE_POSITION'
  | 'DECREASE_POSITION'
  | 'HOLD'
  | 'NO_ACTION'
  | 'REVERSE_POSITION'

// ─────────────────────────────────────────────────────────────────────────────
// Capital Reservation Status  (Chapter 5.2 §4, Rule 20, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export type CapitalReservationStatus =
  | 'NOT_REQUESTED' // Strategy requested no capital reservation
  | 'REQUESTED' // Capital reservation requested but not yet validated
  | 'RESERVED' // Capital validated as available by portfolio capacity
  | 'INSUFFICIENT_CAPACITY' // §21 — portfolio capacity insufficient → decision invalidated
  | 'INVALIDATED' // §21 — invalidated by capacity constraints (lineage preserved)

// ─────────────────────────────────────────────────────────────────────────────
// Exposure Intent  (Chapter 5.2 §4, §6, Rule 20)
// Intent, NOT actual allocation. Portfolio Construction (Ch 5.3) is the sole
// allocator of capital, leverage, and exposure.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExposureIntent {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  /** Desired exposure as a fraction of portfolio NAV (0..1). Intent only. */
  exposureFraction: number
  /** Optional desired leverage (intent; Portfolio Construction may override). */
  leverageHint: number | null
  /** Optional maximum acceptable holding period in ms. */
  maxHoldingPeriodMs: number | null
  /** Optional minimum acceptable fill ratio. */
  minFillRatio: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Requested Capital  (Chapter 5.2 §4, §6, Rule 20)
// Intent only. Never actual allocation.
// ─────────────────────────────────────────────────────────────────────────────

export interface RequestedCapital {
  /** Requested capital in quote currency (e.g., USDT). Intent only. */
  amount: number
  /** Whether the request is a hard requirement or a soft preference. */
  requirement: 'HARD' | 'SOFT'
  /** Justification metadata. */
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Version Bundle  (Chapter 5.2 §11, Rule 14 — historical immutable)
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyVersionBundle {
  strategyVersion: string
  configurationVersion: string
  ruleVersion: string
  signalVersion: string
  modelVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Lineage  (Chapter 5.2 Rule 9 — complete lineage)
// Links signals, configurations, versions, governance metadata.
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyLineage {
  signalId: string
  signalVersion: string
  predictionId: string
  predictionTarget: string
  predictionHorizon: string
  modelVersion: string
  ensembleVersion: string | null
  featureVersion: string
  configurationVersion: string
  ruleVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Governance Metadata  (Chapter 5.2 §12 — complete history mandatory)
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<StrategyReviewEvent>
  auditHistory: Array<StrategyAuditEvent>
  creationTimestamp: number
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface StrategyReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface StrategyAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Metadata  (Chapter 5.2 §4 — recorded with every decision)
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyMetadata {
  strategyId: string
  strategyName: string
  strategyType: StrategyType
  coordinationMode: StrategyCoordinationMode
  priority: number // Higher = higher priority (§9 conflict resolution)
  versions: StrategyVersionBundle
  lineage: StrategyLineage
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Lineage  (Chapter 5.2 §9, Rule 16, Rule 17)
// When decisions are consolidated, complete lineage to original decisions is
// preserved. Original strategy logic NEVER modified (Rule 17) — only published
// Decision Intent may be consolidated.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationLineage {
  reconciliationId: string
  reconciliationType: 'INDEPENDENT' | 'CONSOLIDATED' | 'PARTIALLY_OFFSET' | 'DEFERRED'
  originalDecisionIds: string[]
  consolidatedAt: number
  reason: string
  netExposureFraction: number
  opposingDetected: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Strategy Decision Contract  (Chapter 5.2 §4, §6, Rule 4)
// Every decision conforms to this contract. Alternative formats PROHIBITED.
// Decisions are immutable (Rule 5). Intent, NOT allocation (Rule 20, Rule 22).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalStrategyDecision {
  // §4 — Required identifiers
  decisionId: string // Rule 3 — unique
  strategyId: string
  strategyVersion: string
  signalId: string
  decisionTimestamp: number

  // §6 — Canonical Strategy Decision Contract fields
  decisionType: DecisionType
  decisionConfidence: number // 0..1 (Rule 13 — independent from signal confidence)
  decisionStrength: number // 0..1
  decisionHorizon: string // ms-as-string or named horizon

  // §4 — State + reason
  strategyState: StrategyState
  decisionReason: string

  // Rule 20 — Requested Capital + Exposure Intent (intent only)
  requestedCapital: RequestedCapital | null
  capitalReservationStatus: CapitalReservationStatus
  exposureIntent: ExposureIntent

  // §4, Rule 9 — Metadata + Governance
  strategyMetadata: StrategyMetadata
  governanceMetadata: StrategyGovernanceMetadata

  // §16 — Reconciliation lineage (Rule 16/17 — complete lineage preserved)
  reconciliationLineage: ReconciliationLineage | null

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Rule Predicate  (Chapter 5.2 §8 — deterministic rule evaluation)
// Rules evaluate: Direction, Strength, Confidence, Quality, Regime, Horizon,
// Freshness, Strategy State, Time Constraints.
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyRuleOperator =
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'BETWEEN'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS'

export type StrategyRuleField =
  | 'signalDirection'
  | 'signalStrength'
  | 'signalConfidence'
  | 'signalQualityScore'
  | 'regimeCompatibilityScore'
  | 'predictionHorizon'
  | 'signalFreshness'
  | 'strategyState'
  | 'timestamp'
  | 'marketRegime'
  | 'signalType'

export interface StrategyRule {
  ruleId: string
  ruleVersion: string
  field: StrategyRuleField
  operator: StrategyRuleOperator
  value: number | string | number[] | string[]
  description: string
  weight: number // 0..1 — weight in qualification scoring
}

export interface StrategyRuleSet {
  rulesetId: string
  ruleVersion: string
  /** All rules must pass (AND semantics). */
  qualifyingRules: StrategyRule[]
  /** Scoring rules contribute to decision strength. */
  scoringRules: StrategyRule[]
}

export interface RuleEvaluationResult {
  passed: boolean
  score: number // 0..1 — weighted aggregate
  evaluatedRules: Array<{
    ruleId: string
    field: StrategyRuleField
    passed: boolean
    contribution: number
    actualValue: unknown
  }>
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Definition  (Chapter 5.2 §3, §7, §8, §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyDefinition {
  strategyId: string
  strategyName: string
  strategyType: StrategyType
  coordinationMode: StrategyCoordinationMode
  priority: number

  // §11 — Versioning
  versions: StrategyVersionBundle

  // §8 — Rules
  ruleSet: StrategyRuleSet

  // §7 — Directional bias (which signal directions this strategy accepts)
  acceptedDirections: Array<'LONG' | 'SHORT' | 'NEUTRAL'>
  acceptedSignalTypes: SignalType[]

  // §10 — Cooldown policy
  cooldownPolicy: CooldownPolicy

  // Regime compatibility (§8 — which regimes this strategy is active in)
  regimeCompatibility: Partial<Record<MarketRegime, number>> // 0..1

  // §4 — Default capital intent (configurable, may be overridden per signal)
  defaultCapitalIntent: {
    amount: number
    requirement: 'HARD' | 'SOFT'
    exposureFraction: number
    maxHoldingPeriodMs: number | null
  } | null

  // §6 — Decision horizon for this strategy
  decisionHorizon: string

  // Rule 13 — Decision confidence formula weights (independent from signal confidence)
  confidenceWeights: DecisionConfidenceWeights

  // §10 — Lifecycle configuration
  observationMode: boolean
  enabled: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision Confidence Weights  (Chapter 5.2 Rule 13)
// Decision confidence is MATHEMATICALLY INDEPENDENT from signal confidence.
// Strategies may use signal confidence as ONE input, but the decision confidence
// is computed via a strategy-specific formula.
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionConfidenceWeights {
  /** Weight on signal confidence (must be < 1 to preserve independence). */
  signalConfidenceWeight: number
  /** Weight on rule evaluation score (strategy-specific). */
  ruleScoreWeight: number
  /** Weight on regime compatibility. */
  regimeWeight: number
  /** Weight on strategy historical reliability. */
  historicalReliabilityWeight: number
  /** Weight on strategy state health. */
  stateHealthWeight: number
  /** Weight on signal quality (≠ confidence). */
  signalQualityWeight: number
}

export const DEFAULT_CONFIDENCE_WEIGHTS: DecisionConfidenceWeights = {
  signalConfidenceWeight: 0.2, // capped — must remain independent (Rule 13)
  ruleScoreWeight: 0.3,
  regimeWeight: 0.15,
  historicalReliabilityWeight: 0.15,
  stateHealthWeight: 0.1,
  signalQualityWeight: 0.1,
}

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown Policy  (Chapter 5.2 §10, Rule 19)
// Configurable activation. Cooldown expiration NEVER resets historical stats.
// ─────────────────────────────────────────────────────────────────────────────

export interface CooldownPolicy {
  enabled: boolean
  // §10 — Activation criteria
  consecutiveLossThreshold: number // trigger cooldown after N consecutive losses
  drawdownThreshold: number // 0..1 — trigger after this drawdown fraction
  // §10 — Cooldown duration
  cooldownDurationMs: number
  // §10 — Recovery policy
  recoveryMode: 'IMMEDIATE' | 'STAGED' | 'OBSERVATION_FIRST'
  observationPeriodMs: number
  // Rule 19 — NEVER auto-reset historical stats on cooldown expiration
  resetHistoricalStatsOnExpiry: false
  // Manual override
  allowManualOverride: boolean
}

export const DEFAULT_COOLDOWN_POLICY: CooldownPolicy = {
  enabled: true,
  consecutiveLossThreshold: 3,
  drawdownThreshold: 0.1,
  cooldownDurationMs: 1000 * 60 * 30, // 30 minutes
  recoveryMode: 'STAGED',
  observationPeriodMs: 1000 * 60 * 15,
  resetHistoricalStatsOnExpiry: false, // Rule 19 — IMMUTABLE
  allowManualOverride: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Operational State  (Chapter 5.2 §10, Rule 18)
// Deterministic, fully auditable, version controlled.
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyOperationalState {
  strategyId: string
  currentState: StrategyState
  previousState: StrategyState | null
  stateEnteredAt: number
  stateTransitionHistory: Array<StrategyStateTransition>

  // §10 — Performance tracking
  consecutiveWins: number
  consecutiveLosses: number
  totalDecisions: number
  totalAccepted: number
  totalRejected: number
  totalWins: number
  totalLosses: number
  drawdownState: number // 0..1 — current drawdown fraction from peak
  peakPerformanceScore: number

  // §10 — Cooldown
  cooldownStatus: 'NOT_IN_COOLDOWN' | 'IN_COOLDOWN' | 'RECOVERING'
  cooldownRemaining: number // ms
  cooldownStartedAt: number | null
  cooldownReason: string | null
  cooldownTrigger: CooldownTrigger | null

  // §10 — Active signals tracking
  activeSignals: string[] // signal IDs currently being evaluated
  lastDecisionId: string | null
  lastDecisionAt: number | null

  // Rule 18 — Audit trail
  auditLog: Array<StrategyAuditEvent>

  // §11 — Version pinning (state pinned to strategy version)
  pinnedVersion: StrategyVersionBundle
}

export interface StrategyStateTransition {
  from: StrategyState
  to: StrategyState
  at: number
  reason: string
  actor: string
  trigger: 'AUTOMATIC' | 'MANUAL' | 'GOVERNANCE' | 'COOLDOWN_EXPIRY' | 'SYSTEM'
}

export type CooldownTrigger =
  | 'CONSECUTIVE_LOSS_THRESHOLD'
  | 'DRAWDOWN_THRESHOLD'
  | 'RISK_GOVERNANCE_EVENT'
  | 'MANUAL_ACTION'
  | 'AUTOMATIC_RECOVERY'

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Capacity Metadata  (Chapter 5.2 §3, Rule 21)
// The engine consumes ONLY portfolio-level capacity metadata to determine
// operational feasibility. NEVER allocates capital (Rule 20).
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioCapacityMetadata {
  availableCapital: number
  totalExposureFraction: number // current exposure as fraction of NAV
  maxExposureFraction: number
  availableLeverage: number
  perStrategyAllocationRemaining: Record<string, number> // strategyId → remaining capital
  perSymbolExposureRemaining: Record<string, number> // symbol → remaining exposure fraction
  exposureConstraints: ExposureConstraints
  reservationMetadata: CapitalReservationMetadata
}

export interface ExposureConstraints {
  maxPerSymbolFraction: number
  maxPerStrategyFraction: number
  maxTotalLeverage: number
  maxCorrelatedExposureFraction: number
  prohibitedSymbols: string[]
}

export interface CapitalReservationMetadata {
  activeReservations: Array<{
    reservationId: string
    strategyId: string
    amount: number
    reservedAt: number
    expiresAt: number
  }>
  totalReserved: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Metadata  (Chapter 5.2 §3, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeMetadata {
  currentRegime: MarketRegime
  regimeConfidence: number // 0..1
  regimeDuration: number // ms in current regime
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME'
  trendStrength: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision Pipeline Stages  (Chapter 5.2 §5 — 11 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_DECISION_STAGES = [
  'CANONICAL_SIGNAL_RECEPTION',
  'SIGNAL_VALIDATION',
  'STRATEGY_SELECTION',
  'STRATEGY_STATE_LOADING',
  'RULE_EVALUATION',
  'REGIME_COMPATIBILITY_ASSESSMENT',
  'DECISION_CONSTRUCTION',
  'DECISION_VALIDATION',
  'DECISION_PUBLICATION',
  'METADATA_RECORDING',
  'DECISION_COMPLETION',
] as const

export type StrategyDecisionStage = (typeof STRATEGY_DECISION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const SIE_VERSION = '1.0.0'
export const STRATEGY_DECISION_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalSignal, MarketRegime, SignalType } from '../signal-generation/types'
