// DOMAIN 05 — FEATURE ENGINEERING  (Chapter 2.1 §4, Domain 05)
//
// Purpose: Transform raw market information into analytical features.
//
// Responsibilities:
//   • feature generation      • feature quality
//   • feature normalization   • feature versioning
//   • feature validation      • feature storage
//
// FORBIDDEN (Chapter 2.1 §7): Machine Learning. It does not understand trading.
// This domain owns feature vectors.

import type { Candle, Timeframe } from '../../../types'
import type { Asset, EngineeredFeatures } from '../../types'

export interface FeatureEngineeringContract {
  /** Generate the full feature bundle for an asset on a primary timeframe. */
  generateFeatures(asset: Asset, tf: Timeframe, candles: Candle[]): EngineeredFeatures
  /** Batch-generate features for all eligible assets. */
  generateForAssets(assets: Asset[], ctx: { primaryTf: Timeframe }): Map<Asset, EngineeredFeatures>
  /** Validate that a feature vector is complete and sane. */
  validateFeatures(features: EngineeredFeatures): { valid: boolean; issues: string[] }
  /** Feature schema version (for reproducibility — Rule 2). */
  getFeatureVersion(): string
}

export const FEATURE_ENGINEERING_TOKEN = 'domain.feature-engineering'
export const FEATURE_VERSION = '2.0.0-ch2.1'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Feature Engineering × Machine Learning
 *   Feature Engineering × Trading Decisions
 *
 * This domain may NOT: run inference, estimate probabilities, score trades, or
 * recommend actions. It transforms raw data into features — nothing more.
 */
