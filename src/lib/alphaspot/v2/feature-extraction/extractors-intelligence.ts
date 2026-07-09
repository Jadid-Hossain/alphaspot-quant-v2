// CHAPTER 3.9 §8, §9, §10, §12 — Intelligence Feature Extractors
//
// Extracts features from Microstructure (§8, Ch 3.6), Order Book Intelligence
// (§9, Ch 3.7), Trade Flow Intelligence (§10, Ch 3.8), and Cross-Asset (§12).
// All deterministic (Rule 2, Rule 3). Temporal integrity (Rule 4-6).

import type { MicrostructureSnapshot } from '../microstructure/types'
import type { OrderBookIntelligenceSnapshot } from '../order-book-intel/types'
import type { TradeFlowSnapshot } from '../trade-flow/types'
import type { FeatureValue } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Market Microstructure Features  (Chapter 3.9 §8 — from Ch 3.6)
// ─────────────────────────────────────────────────────────────────────────────

export function extractMicrostructureFeatures(snap: MicrostructureSnapshot | undefined): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (!snap) return features

  features['microstructure.spread'] = snap.currentSpread
  features['microstructure.spread_pct'] = snap.midPrice !== null && snap.midPrice > 0 && snap.currentSpread !== null
    ? snap.currentSpread / snap.midPrice : null
  features['microstructure.bid_volume'] = snap.bidVolume
  features['microstructure.ask_volume'] = snap.askVolume
  features['microstructure.imbalance'] = snap.orderBookImbalance
  features['microstructure.liquidity_score'] = snap.liquidityScore
  features['microstructure.execution_pressure'] = snap.executionPressure
  features['microstructure.trade_pressure'] = snap.tradePressure
  features['microstructure.market_efficiency'] = snap.marketEfficiency

  // §8 — Spread Z-Score (computed via microstructure quality)
  features['microstructure.spread_stability'] = snap.microstructureQuality?.spreadStability ?? null
  features['microstructure.book_completeness'] = snap.microstructureQuality?.bookCompleteness ?? null
  features['microstructure.trade_coverage'] = snap.microstructureQuality?.tradeCoverage ?? null
  features['microstructure.quality_score'] = snap.microstructureQuality?.overallScore ?? null

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Book Intelligence Features  (Chapter 3.9 §9 — from Ch 3.7)
// ─────────────────────────────────────────────────────────────────────────────

export function extractOrderBookFeatures(obi: OrderBookIntelligenceSnapshot | undefined): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (!obi) return features

  features['orderbook.wall_strength'] = obi.liquidityWallStrength
  features['orderbook.wall_authenticity'] = obi.liquidityWallAuthenticity
  features['orderbook.vacuum_score'] = obi.liquidityVacuumScore
  features['orderbook.spoofing_probability'] = obi.spoofingProbability
  features['orderbook.iceberg_probability'] = obi.icebergProbability
  features['orderbook.hidden_volume'] = obi.hiddenVolumeEstimate
  features['orderbook.buyer_absorption'] = obi.buyerAbsorptionScore
  features['orderbook.seller_absorption'] = obi.sellerAbsorptionScore
  features['orderbook.queue_pressure'] = obi.queuePressureScore
  features['orderbook.liquidity_migration'] = obi.liquidityMigrationScore
  features['orderbook.support_strength'] = obi.structuralSupportScore
  features['orderbook.resistance_strength'] = obi.structuralResistanceScore
  features['orderbook.institutional_participation'] = obi.institutionalParticipationScore
  features['orderbook.structural_confidence'] = obi.structuralConfidence
  features['orderbook.wall_count'] = obi.wallClassifications.length
  features['orderbook.genuine_wall_count'] = obi.wallClassifications.filter((w) => w.isGenuine).length

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade Flow Features  (Chapter 3.9 §10 — from Ch 3.8)
// ─────────────────────────────────────────────────────────────────────────────

export function extractTradeFlowFeatures(tfi: TradeFlowSnapshot | undefined): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  if (!tfi) return features

  features['tradeflow.session_cvd'] = tfi.sessionCVD
  features['tradeflow.rolling_cvd'] = tfi.rollingCVD
  features['tradeflow.cvd_momentum'] = tfi.cvdMomentum
  features['tradeflow.cvd_slope'] = tfi.cvdSlope
  features['tradeflow.price_cvd_divergence'] = tfi.priceCvdDivergence
  features['tradeflow.volume_delta'] = tfi.volumeDelta
  features['tradeflow.aggressive_buy_volume'] = tfi.aggressiveBuyVolume
  features['tradeflow.aggressive_sell_volume'] = tfi.aggressiveSellVolume
  features['tradeflow.block_trade_score'] = tfi.blockTradeScore
  features['tradeflow.trade_velocity'] = tfi.tradeVelocity
  features['tradeflow.volume_per_second'] = tfi.volumePerSecond
  features['tradeflow.execution_burst'] = tfi.executionBurstScore
  features['tradeflow.execution_imbalance'] = tfi.executionImbalance
  features['tradeflow.buyer_dominance'] = tfi.buyerDominance
  features['tradeflow.seller_dominance'] = tfi.sellerDominance
  features['tradeflow.buying_exhaustion'] = tfi.buyingExhaustion
  features['tradeflow.selling_exhaustion'] = tfi.sellingExhaustion
  features['tradeflow.institutional_activity'] = tfi.institutionalActivityScore
  features['tradeflow.flow_confidence'] = tfi.flowConfidence

  // §10 — Optional derivatives (NULL when unavailable — Rule 14 from Ch 3.8)
  features['tradeflow.long_liquidation'] = tfi.derivatives?.longLiquidationScore ?? null
  features['tradeflow.short_liquidation'] = tfi.derivatives?.shortLiquidationScore ?? null
  features['tradeflow.derivatives_pressure'] = tfi.derivatives?.derivativesPressureScore ?? null

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Asset Features  (Chapter 3.9 §12 — from dedicated workers, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export function extractCrossAssetFeatures(opts: {
  crossAssetRank?: number | null
  marketBreadth?: number | null
  btcRelativePerf?: number | null
  sectorStrength?: number | null
  dominance?: number | null
  correlationRank?: number | null
}): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}

  // §12 — Relative Strength Rank
  features['crossasset.relative_strength_rank'] = opts.crossAssetRank ?? null
  // §12 — Market Breadth
  features['crossasset.market_breadth'] = opts.marketBreadth ?? null
  // §12 — BTC Relative Performance
  features['crossasset.btc_relative_perf'] = opts.btcRelativePerf ?? null
  // §12 — Sector Strength
  features['crossasset.sector_strength'] = opts.sectorStrength ?? null
  // §12 — Dominance Metrics
  features['crossasset.dominance'] = opts.dominance ?? null
  // §12 — Correlation Rank
  features['crossasset.correlation_rank'] = opts.correlationRank ?? null

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime + Time + Risk + Meta Features
// ─────────────────────────────────────────────────────────────────────────────

export function extractRegimeFeatures(marketRegime: string | null | undefined): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  features['regime.current'] = marketRegime ?? null
  // Encode regime as categorical
  const regimeMap: Record<string, number> = {
    'TRENDING_UP': 1, 'TRENDING_DOWN': -1, 'RANGING': 0,
    'HIGH_VOLATILITY': 2, 'LOW_VOLATILITY': -2, 'TRANSITIONAL': 0.5,
  }
  features['regime.encoded'] = marketRegime ? (regimeMap[marketRegime] ?? 0) : null
  return features
}

export function extractTimeFeatures(timestamp: number): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  const date = new Date(timestamp)
  // Time of day (0-23 UTC)
  features['time.hour_utc'] = date.getUTCHours()
  // Day of week (0=Sunday, 6=Saturday)
  features['time.day_of_week'] = date.getUTCDay()
  // Is weekend
  features['time.is_weekend'] = date.getUTCDay() === 0 || date.getUTCDay() === 6
  // Minute within hour
  features['time.minute'] = date.getUTCMinutes()
  // Session (Asian=0, European=1, US=2, overlap=3)
  const hour = date.getUTCHours()
  if (hour >= 0 && hour < 8) features['time.session'] = 0 // Asian
  else if (hour >= 8 && hour < 14) features['time.session'] = 1 // European
  else if (hour >= 14 && hour < 21) features['time.session'] = 2 // US
  else features['time.session'] = 3 // Overlap/Off
  // Day of month
  features['time.day_of_month'] = date.getUTCDate()
  // Month
  features['time.month'] = date.getUTCMonth()

  return features
}

export function extractRiskFeatures(opts: {
  volatilityPct?: number | null
  liquidityScore?: number | null
  spreadPct?: number | null
  maxDrawdownPct?: number | null
}): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  features['risk.volatility_pct'] = opts.volatilityPct ?? null
  features['risk.liquidity_score'] = opts.liquidityScore ?? null
  features['risk.spread_pct'] = opts.spreadPct ?? null
  features['risk.max_drawdown_pct'] = opts.maxDrawdownPct ?? null
  // Composite risk score (0=safe, 1=dangerous)
  const volRisk = opts.volatilityPct != null ? Math.min(1, opts.volatilityPct / 0.1) : 0.5
  const liqRisk = opts.liquidityScore != null ? 1 - opts.liquidityScore : 0.5
  const spreadRisk = opts.spreadPct != null ? Math.min(1, opts.spreadPct / 0.01) : 0.5
  features['risk.composite'] = (volRisk + liqRisk + spreadRisk) / 3
  return features
}

export function extractMetaFeatures(opts: {
  featureCount: number
  extractionLatencyMs: number
  upstreamSourcesAvailable: number
  upstreamSourcesTotal: number
}): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {}
  features['meta.feature_count'] = opts.featureCount
  features['meta.extraction_latency_ms'] = opts.extractionLatencyMs
  features['meta.upstream_availability'] = opts.upstreamSourcesTotal > 0 ? opts.upstreamSourcesAvailable / opts.upstreamSourcesTotal : 0
  return features
}
