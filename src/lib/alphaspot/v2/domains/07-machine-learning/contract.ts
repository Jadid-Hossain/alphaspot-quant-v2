// DOMAIN 07 — MACHINE LEARNING  (Chapter 2.1 §4, Domain 07)
//
// Purpose: Generate probabilistic forecasts.
//
// Responsibilities:
//   • inference               • ensemble aggregation
//   • confidence estimation   • prediction generation
//   • probability calibration
//
// FORBIDDEN (Chapter 2.1 §7): Portfolio Management.
// Outputs are PROBABILITIES. NEVER recommendations.

import type { Asset, EngineeredFeatures, MarketContext, StatisticalMetrics } from '../../types'

export interface MLPrediction {
  asset: Asset
  probabilityOfSuccess: number // 0..1
  expectedReturnPct: number
  expectedDrawdownPct: number
  confidence: number // 0..1
  modelVersion: string
  inferenceTimeMs: number
}

export interface MachineLearningContract {
  /** Run inference on a single asset. */
  predict(asset: Asset, features: EngineeredFeatures, context: MarketContext): Promise<MLPrediction>
  /** Batch inference for the eligible universe. */
  predictBatch(inputs: Map<Asset, { features: EngineeredFeatures; context: MarketContext }>): Promise<Map<Asset, MLPrediction>>
  /** Convert raw predictions into StatisticalMetrics (calibrated). */
  calibrate(prediction: MLPrediction): StatisticalMetrics
  /** Model metadata for reproducibility (Rule 2). */
  getModelInfo(): { version: string; type: string; trainedAt: number | null }
}

export const MACHINE_LEARNING_TOKEN = 'domain.machine-learning'
export const ML_MODEL_VERSION = 'baseline-v1-ch2.1'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Machine Learning × Portfolio Management
 *   Machine Learning × Trade Recommendations
 *
 * This domain may NOT: create candidates, allocate capital, manage positions,
 * or recommend actions. It outputs probabilities and confidence only.
 */
