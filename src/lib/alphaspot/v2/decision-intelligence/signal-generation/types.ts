// CHAPTER 5.1 — Signal Generation Engine Types
//
// The SGE transforms ML predictions into standardized trading signals (§1).
// Predictions are NOT trading decisions (§2). Deterministic (Rule 12).
// Strategy-independent (Rule 2). Historical immutable (Rule 7).
// Signal Quality ≠ Prediction Confidence (Rule 8). Confidence ≠ Uncertainty (Rule 9).
// Stateful Hysteresis (Rule 17). Validity Horizon (Rule 16, 18, 19).

// ─────────────────────────────────────────────────────────────────────────────
// Signal Types  (Chapter 5.1 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'NO_ACTION'
  | 'REDUCE_POSITION'
  | 'INCREASE_POSITION'
  | 'EXIT_LONG'
  | 'EXIT_SHORT'

export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL'

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Signal Contract  (Chapter 5.1 §6, Rule 4)
// All downstream Decision Intelligence components consume ONLY this.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalSignal {
  signalId: string
  signalVersion: string
  predictionId: string
  predictionTarget: string
  predictionHorizon: string

  // §6 — Canonical Signal Contract fields
  signalType: SignalType
  signalDirection: SignalDirection
  signalStrength: number // 0..1 (1 = strongest)
  signalConfidence: number // 0..1 (from prediction)
  signalUncertainty: number // 0..1 (from prediction)
  signalQualityScore: number // 0..1 (Rule 8 — ≠ confidence)
  regimeCompatibilityScore: number // 0..1
  thresholdStatus: 'PASSED' | 'FAILED' | 'MARGINAL'
  validityHorizon: ValidityHorizon

  // Metadata
  signalMetadata: SignalMetadata
  governanceMetadata: SignalGovernance
  createdAt: number
  // Rule 7 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Validity Horizon  (Chapter 5.1 §6, Rule 16, Rule 18, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidityHorizon {
  /** When the signal becomes valid. */
  validFrom: number
  /** Maximum temporal lifetime — after this, signal → NO_ACTION (Rule 16). */
  validUntil: number
  /** Remaining validity in ms (computed). */
  remainingMs: number
  /** Whether the signal has expired. */
  isExpired: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Threshold Configuration  (Chapter 5.1 §8, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface ThresholdConfig {
  minConfidence: number
  maxUncertainty: number
  minExpectedReturn: number
  minRiskAdjustedScore: number
  minPredictionStability: number
  minModelAgreement: number
  minRegimeCompatibility: number
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateful Hysteresis  (Chapter 5.1 §8, Rule 17)
// Asymmetric entry/exit to prevent signal chatter.
// ─────────────────────────────────────────────────────────────────────────────

export interface HysteresisConfig {
  enabled: boolean
  // Asymmetric entry/exit thresholds
  entryThreshold: number // e.g., 0.01 (1% expected return to enter BUY)
  exitThreshold: number // e.g., 0.008 (0.8% to exit BUY — lower than entry)
  minSignalPersistence: number // ms — signal must persist this long before transition
  directionChangeMargin: number // minimum score change to reverse direction
  confidenceDelta: number // minimum confidence change to trigger re-evaluation
  uncertaintyDelta: number // minimum uncertainty change to trigger re-evaluation
  debounceWindowMs: number // time-based debounce
  version: string
}

export interface HysteresisState {
  currentDirection: SignalDirection
  currentSignalType: SignalType
  enteredAt: number
  lastTransitionAt: number
  persistenceMs: number
}

export const DEFAULT_HYSTERESIS: HysteresisConfig = {
  enabled: true,
  entryThreshold: 0.01,
  exitThreshold: 0.008,
  minSignalPersistence: 5000,
  directionChangeMargin: 0.05,
  confidenceDelta: 0.1,
  uncertaintyDelta: 0.1,
  debounceWindowMs: 1000,
  version: '1.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal Quality  (Chapter 5.1 §9, Rule 8, Rule 18)
// Quality ≠ Prediction Confidence (Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalQuality {
  predictionConfidence: number
  predictionUncertainty: number
  ensembleAgreement: number
  historicalReliability: number
  calibrationQuality: number
  predictionStability: number
  featureQuality: number
  regimeCompatibility: number
  // Rule 18 — freshness
  signalFreshness: number // 0..1 (1 = fresh)
  validityHorizonRemaining: number // 0..1
  temporalConsistency: number
  hysteresisState: 'STABLE' | 'TRANSITIONING' | 'OSCILLATING'
  signalAge: number // ms
  // Rule 8 — overall quality ≠ confidence
  overallQualityScore: number
  // Rule 18 — expired signals fail
  isExpired: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Compatibility  (Chapter 5.1 §10)
// ─────────────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | 'BULL_MARKET' | 'BEAR_MARKET' | 'SIDEWAYS_MARKET'
  | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY'
  | 'TRENDING' | 'MEAN_REVERTING' | 'CRISIS_REGIME'

export interface RegimeCompatibilityResult {
  regime: MarketRegime
  compatibilityScore: number // 0..1
  action: 'ACCEPT' | 'DOWNGRADE' | 'REJECT'
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal Metadata & Governance  (Chapter 5.1 §11, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalMetadata {
  signalVersion: string
  predictionVersion: string
  modelVersion: string
  ensembleVersion: string | null
  featureVersion: string
  configurationVersion: string
  thresholdVersion: string
  // Rule 5 — complete lineage
  lineage: SignalLineage
}

export interface SignalLineage {
  predictionId: string
  modelVersion: string
  ensembleVersion: string | null
  featureVersion: string
  configurationVersion: string
  thresholdVersion: string
}

export interface SignalGovernance {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  creationTimestamp: number
  governanceNotes: string[]
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  reviewStatus: 'PENDING' | 'REVIEWED' | 'ESCALATED'
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal Generation Pipeline Stages  (Chapter 5.1 §5 — 13 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const SIGNAL_STAGES = [
  'CANONICAL_PREDICTION_RECEPTION',
  'PREDICTION_VALIDATION',
  'PREDICTION_COMPATIBILITY_VERIFICATION',
  'CONFIDENCE_EVALUATION',
  'UNCERTAINTY_EVALUATION',
  'THRESHOLD_EVALUATION',
  'SIGNAL_QUALITY_ASSESSMENT',
  'REGIME_COMPATIBILITY_ASSESSMENT',
  'SIGNAL_CONSTRUCTION',
  'SIGNAL_VALIDATION',
  'SIGNAL_PUBLICATION',
  'METADATA_RECORDING',
  'SIGNAL_COMPLETION',
] as const

export type SignalStage = (typeof SIGNAL_STAGES)[number]

export const SGE_VERSION = '1.0.0'
