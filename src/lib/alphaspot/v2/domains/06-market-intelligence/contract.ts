// DOMAIN 06 — MARKET INTELLIGENCE  (Chapter 2.1 §4, Domain 06)
//
// Purpose: Convert analytical features into market understanding.
//
// Responsibilities:
//   • market structure        • market regime
//   • trend                   • relative strength
//   • volatility              • correlation analysis
//   • liquidity
//   • sentiment
//
// FORBIDDEN: recommend trades. It understands markets but does NOT recommend.
// Outputs a MarketContext — the "understanding" that downstream domains consume.

import type { Asset, EngineeredFeatures, MarketContext } from '../../types'

export interface MarketIntelligenceContract {
  /** Build the market context for a single asset from its features. */
  analyzeAsset(asset: Asset, features: EngineeredFeatures): MarketContext
  /** Batch-analyze all featured assets. */
  analyzeBatch(features: Map<Asset, EngineeredFeatures>): Map<Asset, MarketContext>
  /** Compute correlation matrix across the eligible universe. */
  computeCorrelations(assets: Asset[]): Map<string, number> // key: "A|B" → correlation
  /** Market-wide regime summary (dominant regime across all assets). */
  getMarketRegimeSummary(): { regime: import('../../types').MarketRegime; confidence: number; breadth: number }
}

export const MARKET_INTELLIGENCE_TOKEN = 'domain.market-intelligence'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Market Intelligence × Trade Recommendations
 *
 * This domain may NOT: create Trade Candidates, score trades, estimate
 * expected value, or recommend actions. It outputs MarketContext only.
 */
