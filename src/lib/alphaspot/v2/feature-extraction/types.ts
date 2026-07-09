// CHAPTER 3.9 §4, §4.1, §5 — Feature Extraction Types & Contracts
//
// The FEE is the exclusive bridge between Market Intelligence and AI (§1).
// Consumes only canonical outputs (Rule 1). Outputs are immutable (Rule 10).
// Extraction is deterministic (Rule 2, Rule 3). Temporal integrity enforced
// (Rule 4, Rule 5, Rule 6). No preprocessing — extraction only (Rule 7).

import type { CanonicalCandle } from '../candle-engine/types'
import type { MicrostructureSnapshot } from '../microstructure/types'
import type { OrderBookIntelligenceSnapshot } from '../order-book-intel/types'
import type { TradeFlowSnapshot } from '../trade-flow/types'
import type { MarketState } from '../market-state/cache'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Vector  (Chapter 3.9 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureValue = number | string | boolean | null

export interface FeatureVector {
  symbol: string
  timestamp: number // UTC epoch ms — extraction timestamp
  featureVersion: string // schema version of individual features
  featureSetVersion: string // version of the complete feature set
  featureCount: number
  features: Readonly<Record<string, FeatureValue>>
  featureQualityScore: number // 0..1
  featureMetadataRef: string // reference to feature definitions
  dependencyVersions: Readonly<Record<string, string>> // versions of upstream inputs
  extractionTrigger: ExtractionTrigger
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction Triggers  (Chapter 3.9 §4.1)
// ─────────────────────────────────────────────────────────────────────────────

export type ExtractionTrigger =
  | { type: 'CANDLE_CLOSE'; timeframe: string; candleOpenTime: number }
  | { type: 'POLLING_EPOCH'; epochMs: number }

// ─────────────────────────────────────────────────────────────────────────────
// Feature Categories  (Chapter 3.9 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | 'PRICE'
  | 'TREND'
  | 'MOMENTUM'
  | 'VOLUME'
  | 'VOLATILITY'
  | 'LIQUIDITY'
  | 'SPREAD'
  | 'MICROSTRUCTURE'
  | 'ORDER_BOOK'
  | 'TRADE_FLOW'
  | 'STATISTICAL'
  | 'RELATIVE_STRENGTH'
  | 'CROSS_ASSET'
  | 'REGIME'
  | 'TIME'
  | 'RISK'
  | 'META'

export const ALL_FEATURE_CATEGORIES: FeatureCategory[] = [
  'PRICE', 'TREND', 'MOMENTUM', 'VOLUME', 'VOLATILITY', 'LIQUIDITY', 'SPREAD',
  'MICROSTRUCTURE', 'ORDER_BOOK', 'TRADE_FLOW', 'STATISTICAL', 'RELATIVE_STRENGTH',
  'CROSS_ASSET', 'REGIME', 'TIME', 'RISK', 'META',
]

// ─────────────────────────────────────────────────────────────────────────────
// Extraction Input  (Chapter 3.9 §3 — canonical inputs)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureExtractionInput {
  symbol: string
  timestamp: number
  // Canonical inputs (all optional — forward-filled if missing §4.1)
  candles?: CanonicalCandle[] // recent historical + current candle
  currentCandle?: CanonicalCandle
  microstructure?: MicrostructureSnapshot
  orderBookIntel?: OrderBookIntelligenceSnapshot
  tradeFlow?: TradeFlowSnapshot
  marketState?: MarketState
  // Cross-asset context (from dedicated workers §12, Rule 9)
  crossAssetRank?: number | null
  marketBreadth?: number | null
  btcRelativePerf?: number | null
  // Regime
  marketRegime?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature definitions  (for metadata reference)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureDefinition {
  featureId: string
  category: FeatureCategory
  name: string
  description: string
  version: string
  valueType: 'number' | 'string' | 'boolean'
  unit: string | null
  // Temporal integrity (§13) — what upstream inputs are needed
  dependencies: string[]
}

export const FEATURE_VERSION = '2.0.0'
export const FEATURE_SET_VERSION = '2.0.0-ch3.9'

// ─────────────────────────────────────────────────────────────────────────────
// Quality assessment  (Chapter 3.9 §4 — Feature Quality Score)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureQuality {
  completenessPct: number // % of features that are non-null
  upstreamAvailability: number // 0..1 — how many upstream sources were available
  temporalConsistency: number // 0..1 — how aligned the timestamps are
  overallScore: number // 0..1
}
