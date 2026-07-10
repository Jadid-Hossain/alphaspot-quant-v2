// CHAPTER 4.1 — AI Platform: Prediction Framework Types
//
// The AI Platform transforms processed features into probabilistic forecasts.
// AI produces probabilities, NOT trading decisions (Rule 1, Rule 13).
// Probability ≠ Confidence (Rule 3): Probability = aleatoric (event likelihood),
// Confidence = epistemic (model's certainty in its own forecast).
// Inference is deterministic (Rule 4). Every prediction is versioned (Rule 6),
// explainable (Rule 7), governed (Rule 10). No raw market data (Rule 15).

import type { ProcessedFeatureVector } from '../../feature-processing/types'

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Targets  (Chapter 4.1 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type PredictionTargetType =
  | 'PRICE_DIRECTION'
  | 'RETURN_DISTRIBUTION'
  | 'EXPECTED_RETURN'
  | 'EXPECTED_DRAWDOWN'
  | 'VOLATILITY'
  | 'BREAKOUT_PROBABILITY'
  | 'TREND_CONTINUATION'
  | 'TREND_REVERSAL'
  | 'MOMENTUM_PERSISTENCE'
  | 'LIQUIDITY_CHANGE'
  | 'MARKET_REGIME'
  | 'RISK_ESTIMATION'

export interface PredictionTarget {
  type: PredictionTargetType
  description: string
  // The specific question this target answers (§3)
  question: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Horizons  (Chapter 4.1 §6, Rule 12)
// Predictions from different horizons remain statistically independent.
// ─────────────────────────────────────────────────────────────────────────────

export type PredictionHorizon =
  | '15m' | '30m' | '1h' | '4h' | '1d' | '3d' | '7d'

export const HORIZON_MS: Record<PredictionHorizon, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

export const ALL_HORIZONS: PredictionHorizon[] = ['15m', '30m', '1h', '4h', '1d', '3d', '7d']

// ─────────────────────────────────────────────────────────────────────────────
// Uncertainty Estimation  (Chapter 4.1 §11, Rule 2)
// ─────────────────────────────────────────────────────────────────────────────

export interface UncertaintyEstimate {
  /** Aleatoric uncertainty — inherent market noise (irreducible). */
  dataUncertainty: number // 0..1
  /** Epistemic uncertainty — model doesn't know (reducible with more data). */
  modelUncertainty: number // 0..1
  /** Quality of the input features (from Feature Processing). */
  featureQuality: number // 0..1
  /** How well the current market regime matches the model's training distribution. */
  regimeAlignment: number // 0..1
  /** How stable this prediction has been over recent samples. */
  predictionStability: number // 0..1
  /** Composite uncertainty score (0=low, 1=high). */
  overallUncertainty: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Explanation  (Chapter 4.1 §12, Rule 7)
// Model-independent explainability.
// ─────────────────────────────────────────────────────────────────────────────

export interface PredictionExplanation {
  /** Which features contributed most to this prediction. */
  featureImportance: Array<{ feature: string; importance: number; direction: 'positive' | 'negative' | 'neutral' }>
  /** The top factors driving this prediction. */
  predictionDrivers: string[]
  /** Why the confidence is what it is. */
  confidenceExplanation: string
  /** Historical situations similar to the current state. */
  historicalSimilarity: Array<{ timestamp: number; similarity: number; outcome: string }> | null
  /** Which model(s) in the ensemble contributed most. */
  modelContribution: Array<{ modelId: string; contribution: number }> | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Result  (Chapter 4.1 §7 — the core output)
//
// §7: "Probability and confidence are distinct concepts.
//  Probability = forecasted likelihood of the target event (Aleatoric).
//  Confidence = model's certainty in its own forecast (Epistemic)."
// ─────────────────────────────────────────────────────────────────────────────

export interface PredictionResult {
  /** Unique prediction ID (for audit/lineage). */
  predictionId: string
  /** The asset this prediction is for. */
  symbol: string
  /** What we're predicting (§5). */
  target: PredictionTargetType
  /** The forecast horizon (§6). */
  horizon: PredictionHorizon
  /** When the prediction was made (UTC epoch ms). */
  predictionTimestamp: number

  // §7 — Core prediction outputs
  /** Probability of the target event occurring (Aleatoric — §7, Rule 3). 0..1 */
  probability: number
  /** Model's certainty in its own forecast (Epistemic — §7, Rule 3). 0..1 */
  confidence: number
  /** Prediction interval [lower, upper] for the predicted value. */
  predictionInterval: [number, number] | null
  /** Expected value of the prediction (§3 — optimize EV, not accuracy). */
  expectedValue: number
  /** How many models in the ensemble agree (0..1). */
  modelAgreement: number
  /** Calibration score from monitoring (§9, Rule 9). 0..1 */
  calibrationScore: number

  // §11 — Uncertainty (Rule 2)
  uncertainty: UncertaintyEstimate

  // §12 — Explainability (Rule 7)
  explanation: PredictionExplanation

  // §10 — Versioning (Rule 6, Rule 14)
  modelVersion: ModelVersion

  // §8 — The input that produced this prediction (for reproducibility Rule 14)
  inputHash: string // hash of the ProcessedFeatureVector for reproducibility
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Version  (Chapter 4.1 §10, Rule 6, Rule 14)
// Every prediction records 7 version dimensions.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelVersion {
  modelVersion: string // the model's own version
  trainingDatasetVersion: string // which dataset the model was trained on
  featureVersion: string // feature extraction version
  hyperparameterVersion: string // hyperparameter config version
  calibrationVersion: string // calibration method version
  inferenceEngineVersion: string // inference engine version
  predictionSchemaVersion: string // prediction output schema version
}

export const INFERENCE_ENGINE_VERSION = '1.0.0'
export const PREDICTION_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Model Interface  (Chapter 4.1 §8, Rule 5)
// Prediction interfaces remain independent of specific algorithms.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelFamily = 'GRADIENT_BOOSTING' | 'DEEP_LEARNING' | 'LINEAR' | 'PROBABILISTIC' | 'ENSEMBLE'

export interface ModelInterface {
  modelId: string
  modelVersion: ModelVersion
  family: ModelFamily
  supportedTargets: PredictionTargetType[]
  supportedHorizons: PredictionHorizon[]

  /**
   * Run deterministic inference (§9, Rule 4).
   * Identical model + features + config → identical predictions.
   * Randomness during inference is PROHIBITED.
   *
   * Input: ProcessedFeatureVector ONLY (Rule 15 — no raw market data).
   * Output: partial prediction (probability + interval + EV).
   * Confidence + uncertainty + explanation are computed by the inference engine.
   */
  infer(input: ProcessedFeatureVector, target: PredictionTargetType, horizon: PredictionHorizon): Promise<ModelInferenceOutput>

  /** Get feature importance for explainability (§12, Rule 7). */
  getFeatureImportance(input: ProcessedFeatureVector): Array<{ feature: string; importance: number; direction: 'positive' | 'negative' | 'neutral' }>

  /** Check if the model is calibrated (§9, Rule 9). */
  getCalibrationScore(): number
}

export interface ModelInferenceOutput {
  probability: number // 0..1
  predictionInterval: [number, number] | null
  expectedValue: number
  rawOutput: number // the model's raw score (before calibration)
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Governance  (Chapter 4.1 §13, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceAction =
  | 'APPROVED'
  | 'CALIBRATION_WARNING'
  | 'DRIFT_WARNING'
  | 'PERFORMANCE_DEGRADED'
  | 'SUSPENDED'
  | 'ROLLED_BACK'

export interface PredictionGovernanceState {
  modelId: string
  calibrationStatus: 'CALIBRATED' | 'DEGRADED' | 'UNKNOWN'
  performanceStatus: 'HEALTHY' | 'DEGRADED' | 'FAILED'
  driftStatus: 'STABLE' | 'DRIFTING' | 'SEVERE'
  currentAction: GovernanceAction
  lastAuditAt: number
  promotionEligible: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Request  (the input to the inference engine)
// ─────────────────────────────────────────────────────────────────────────────

export interface PredictionRequest {
  symbol: string
  target: PredictionTargetType
  horizon: PredictionHorizon
  features: ProcessedFeatureVector // Rule 15 — only processed features
}

// Re-export
export type { ProcessedFeatureVector }
