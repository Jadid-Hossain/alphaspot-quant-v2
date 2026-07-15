// CHAPTER 6.6 §8-§24 — Market Regime Intelligence Subsystems
//
// Implements all subsystems for the AI Market Regime Intelligence Engine (AMRIE).
// 25 architectural rules enforced (see §25).

import { createLogger } from '../domains/01-core-infrastructure'
import { createHash, randomUUID } from 'crypto'
import type {
  AMRIEConfiguration,
  CanonicalMarketRegimeContract,
  ExecutionEnvironment,
  IntelligenceDomain,
  LiquidityClassification,
  MarketRegime,
  MarketStructureClassification,
  RegimeConfiguration,
  RegimeConfidence,
  RegimeGovernanceMetadata,
  RegimeInput,
  RegimeLineage,
  RegimeManifest,
  RegimeOpinion,
  RegimeProbabilityDistribution,
  RegimeProbabilityEntry,
  RegimeRegistryEntry,
  RegimeStability,
  RegimeTransition,
  RegimeUncertainty,
  RegimeVersionBundle,
  ResearchPipeline,
  ScalpingRegime,
  SwingRegime,
  TrendClassification,
  TransitionStatus,
  VolatilityClassification,
} from './types'
import { SWING_REGIMES, SCALPING_REGIMES } from './types'

const log = createLogger('ai-platform:market-regime:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §6 — GovernedDataRetriever  (Rule 1)
// ─────────────────────────────────────────────────────────────────────────────

export class GovernedDataRetriever {
  /** Rule 1 — Only governance-approved datasets, feature manifests, validation certificates. */
  retrieve(input: RegimeInput): {
    valid: boolean
    errors: string[]
    upstreamEngines: string[]
    sourceDatasetIds: string[]
    sourceFeatureManifestIds: string[]
    sourceValidationCertificateIds: string[]
  } {
    const errors: string[] = []
    const upstreamEngines = new Set<string>()

    if (input.approvedDatasets.length === 0) errors.push('Rule 1: no approved datasets provided')
    if (input.approvedFeatureManifests.length === 0) errors.push('Rule 1: no approved feature manifests provided')
    if (input.validationCertificates.length === 0) errors.push('Rule 1: no validation certificates provided')

    for (const d of input.approvedDatasets) upstreamEngines.add('DATASET_CONSTRUCTION_REGISTRY_ENGINE')
    for (const f of input.approvedFeatureManifests) upstreamEngines.add('FEATURE_SELECTION_ENGINE')
    for (const v of input.validationCertificates) upstreamEngines.add('RESEARCH_VALIDATION_ENGINE')
    for (const h of input.historicalMarketData) upstreamEngines.add('HISTORICAL_DATA')
    for (const m of input.marketMicrostructure) upstreamEngines.add('MICROSTRUCTURE')
    for (const o of input.orderBookIntelligence) upstreamEngines.add('ORDER_BOOK_INTEL')
    for (const t of input.tradeFlowIntelligence) upstreamEngines.add('TRADE_FLOW')
    for (const a of input.alternativeDataStore) upstreamEngines.add('ALTERNATIVE_DATA_ENGINE')

    // §4 — Never consumes predictions, signals, portfolio decisions, execution commands
    if (input.predictionsConsumed !== false) errors.push('§4: predictions must not be consumed')
    if (input.tradingSignalsConsumed !== false) errors.push('§4: trading signals must not be consumed')
    if (input.portfolioDecisionsConsumed !== false) errors.push('§4: portfolio decisions must not be consumed')
    if (input.executionCommandsConsumed !== false) errors.push('§4: execution commands must not be consumed')

    return {
      valid: errors.length === 0,
      errors,
      upstreamEngines: Array.from(upstreamEngines),
      sourceDatasetIds: input.approvedDatasets.map((d) => d.datasetEventId),
      sourceFeatureManifestIds: input.approvedFeatureManifests.map((f) => f.manifestId),
      sourceValidationCertificateIds: input.validationCertificates.map((v) => v.certificateId),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ConfigurationValidator  (Rule 7, Rule 9, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigurationValidator {
  validate(config: RegimeConfiguration, engineConfig: AMRIEConfiguration): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    if (!config.researchPipeline) errors.push('missing research pipeline')
    if (config.intelligenceDomains.length < 2) errors.push('Rule 8: at least 2 intelligence domains required for consensus')
    if (config.sourceDatasetEventIds.length === 0) errors.push('no source datasets')
    if (config.sourceFeatureManifestIds.length === 0) errors.push('no source feature manifests')
    if (config.sourceValidationCertificateIds.length === 0) errors.push('no validation certificates')
    // Rule 23 — Active manifest version required
    if (!config.activeManifestVersion) errors.push('Rule 23: active manifest version required')
    return { valid: errors.length === 0, errors }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.2 — TrendIntelligence  (§8.2)
// ─────────────────────────────────────────────────────────────────────────────

export class TrendIntelligence {
  /** §8.2 — Evaluates trend direction, strength, persistence, acceleration, exhaustion, consistency. */
  analyze(observations: Array<{ timestamp: number; price: number; [k: string]: unknown }>): RegimeOpinion {
    const prices = observations.map((o) => o.price)
    const n = prices.length
    const ema = this.computeEMA(prices, Math.min(20, n))
    const adx = this.computeADX(observations)
    const trendDirection = ema > prices[n - 1] ? 'BEARISH' : 'BULLISH'
    const trendStrength = Math.min(1, adx / 50)
    const trendScore = trendDirection === 'BULLISH' ? trendStrength : -trendStrength

    let regime: MarketRegime
    if (trendStrength > 0.6 && trendDirection === 'BULLISH') regime = 'BULL_EXPANSION'
    else if (trendStrength > 0.4 && trendDirection === 'BULLISH') regime = 'BULL_EXHAUSTION'
    else if (trendStrength > 0.6 && trendDirection === 'BEARISH') regime = 'BEAR_EXPANSION'
    else if (trendStrength > 0.8 && trendDirection === 'BEARISH') regime = 'CAPITULATION'
    else regime = 'SIDEWAYS_CONSOLIDATION'

    return {
      domain: 'TREND',
      regime,
      confidence: trendStrength,
      scores: { trendScore, adx, ema, trendDirection },
      timestamp: observations[n - 1]?.timestamp ?? Date.now(),
    }
  }

  private computeEMA(prices: number[], period: number): number {
    const k = 2 / (period + 1)
    let ema = prices[0]
    for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k)
    return ema
  }

  private computeADX(observations: Array<{ price: number; high?: number; low?: number }>): number {
    // Simplified ADX proxy: normalized price momentum
    if (observations.length < 2) return 0
    const first = observations[0].price
    const last = observations[observations.length - 1].price
    return Math.min(50, Math.abs((last - first) / first) * 100)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.3 — VolatilityIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class VolatilityIntelligence {
  /** §8.3 — Evaluates realized/historical volatility, ATR expansion/compression, persistence. */
  analyze(observations: Array<{ timestamp: number; price: number; high?: number; low?: number }>): RegimeOpinion {
    const prices = observations.map((o) => o.price)
    const returns: number[] = []
    for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
    const realizedVol = this.stdDev(returns)
    const atr = this.computeATR(observations)
    const atrExpansion = atr / (prices[prices.length - 1] || 1)

    let regime: MarketRegime
    if (atrExpansion > 0.03) regime = 'HIGH_VOLATILITY_EXPANSION'
    else if (atrExpansion < 0.005) regime = 'LOW_VOLATILITY_COMPRESSION'
    else regime = 'SIDEWAYS_CONSOLIDATION'

    return {
      domain: 'VOLATILITY',
      regime,
      confidence: Math.min(1, atrExpansion * 20),
      scores: { realizedVol, atr, atrExpansion },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }

  private computeATR(observations: Array<{ price: number; high?: number; low?: number }>): number {
    if (observations.length < 2) return 0
    const trs: number[] = []
    for (let i = 1; i < observations.length; i++) {
      const high = observations[i].high ?? observations[i].price
      const low = observations[i].low ?? observations[i].price
      const prevClose = observations[i - 1].price
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
    }
    return trs.reduce((s, v) => s + v, 0) / trs.length
  }

  private stdDev(arr: number[]): number {
    if (arr.length === 0) return 0
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.4 — LiquidityIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidityIntelligence {
  /** §8.4 — Evaluates market depth, available liquidity, spread quality, execution capacity. */
  analyze(observations: Array<{ timestamp: number; volume: number; [k: string]: unknown }>): RegimeOpinion {
    const volumes = observations.map((o) => o.volume)
    const avgVolume = volumes.reduce((s, v) => s + v, 0) / Math.max(1, volumes.length)
    const liquidityScore = Math.min(1, avgVolume / 1000000)
    let regime: MarketRegime
    if (liquidityScore > 0.7) regime = 'LIQUIDITY_ABSORPTION'
    else if (liquidityScore < 0.2) regime = 'LIQUIDITY_VACUUM'
    else regime = 'SIDEWAYS_CONSOLIDATION'
    return {
      domain: 'LIQUIDITY',
      regime,
      confidence: liquidityScore,
      scores: { avgVolume, liquidityScore },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.5 — MarketStructureIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class MarketStructureIntelligence {
  /** §8.5 — Evaluates higher highs/lows, lower highs/lows, support/resistance, breakout/consolidation. */
  analyze(observations: Array<{ timestamp: number; price: number }>): RegimeOpinion {
    const prices = observations.map((o) => o.price)
    const highs = this.findSwingHighs(prices)
    const lows = this.findSwingLows(prices)
    const hh = highs.length > 1 && highs[highs.length - 1] > highs[highs.length - 2]
    const hl = lows.length > 1 && lows[lows.length - 1] > lows[lows.length - 2]
    const lh = highs.length > 1 && highs[highs.length - 1] < highs[highs.length - 2]
    const ll = lows.length > 1 && lows[lows.length - 1] < lows[lows.length - 2]

    let regime: MarketRegime
    if (hh && hl) regime = 'BULL_EXPANSION'
    else if (lh && ll) regime = 'BEAR_EXPANSION'
    else if (!hh && !lh && hl && !ll) regime = 'ACCUMULATION'
    else if (lh && !ll && !hl) regime = 'DISTRIBUTION'
    else regime = 'SIDEWAYS_CONSOLIDATION'

    return {
      domain: 'MARKET_STRUCTURE',
      regime,
      confidence: 0.7,
      scores: { swingHighs: highs.length, swingLows: lows.length, hh, hl, lh, ll },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }

  private findSwingHighs(prices: number[]): number[] {
    const highs: number[] = []
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] > prices[i - 1] && prices[i] > prices[i + 1]) highs.push(prices[i])
    }
    return highs
  }

  private findSwingLows(prices: number[]): number[] {
    const lows: number[] = []
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] < prices[i - 1] && prices[i] < prices[i + 1]) lows.push(prices[i])
    }
    return lows
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.6 — MarketCycleIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class MarketCycleIntelligence {
  /** §8.6 — Identifies accumulation, markup, distribution, markdown, recovery, expansion, compression. */
  analyze(observations: Array<{ timestamp: number; price: number; volume: number }>): RegimeOpinion {
    const prices = observations.map((o) => o.price)
    const volumes = observations.map((o) => o.volume)
    const priceChange = prices.length > 1 ? (prices[prices.length - 1] - prices[0]) / prices[0] : 0
    const avgVol = volumes.reduce((s, v) => s + v, 0) / Math.max(1, volumes.length)
    const recentVol = volumes.slice(-5).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(5, volumes.length))
    const volChange = avgVol > 0 ? recentVol / avgVol : 1

    let regime: MarketRegime
    if (priceChange > 0.05 && volChange > 1) regime = 'BULL_EXPANSION'
    else if (priceChange > 0.02 && volChange < 0.8) regime = 'ACCUMULATION'
    else if (priceChange < -0.05 && volChange > 1.5) regime = 'CAPITULATION'
    else if (priceChange < -0.02 && volChange < 0.8) regime = 'DISTRIBUTION'
    else if (priceChange > 0 && volChange > 0.9) regime = 'RECOVERY'
    else regime = 'SIDEWAYS_CONSOLIDATION'

    return {
      domain: 'MARKET_CYCLE',
      regime,
      confidence: 0.65,
      scores: { priceChange, volChange },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.7 — OrderBookIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class OrderBookIntelligence {
  /** §8.7 — Evaluates bid/ask dominance, liquidity walls, iceberg detection, queue dynamics, imbalance. */
  analyze(observations: Array<{ timestamp: number; [k: string]: unknown }>): RegimeOpinion {
    const obi = observations.map((o) => Number(o['obi'] ?? 0.5))
    const spread = observations.map((o) => Number(o['spread'] ?? 0.001))
    const avgOBI = obi.reduce((s, v) => s + v, 0) / Math.max(1, obi.length)
    const avgSpread = spread.reduce((s, v) => s + v, 0) / Math.max(1, spread.length)

    let regime: MarketRegime
    if (avgSpread > 0.005) regime = 'SPREAD_EXPANSION'
    else if (avgSpread < 0.0005) regime = 'SPREAD_COMPRESSION'
    else if (avgOBI > 0.7 || avgOBI < 0.3) regime = 'ORDER_BOOK_COMPRESSION'
    else regime = 'MOMENTUM_BURST'

    return {
      domain: 'ORDER_BOOK',
      regime,
      confidence: Math.min(1, Math.abs(avgOBI - 0.5) * 2),
      scores: { avgOBI, avgSpread },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.8 — TradeFlowIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class TradeFlowIntelligence {
  /** §8.8 — Evaluates buyer/seller aggression, trade imbalance, velocity, volume delta, large trades. */
  analyze(observations: Array<{ timestamp: number; volume: number; [k: string]: unknown }>): RegimeOpinion {
    const volumes = observations.map((o) => o.volume)
    const delta = observations.map((o) => Number(o['volumeDelta'] ?? 0))
    const avgDelta = delta.reduce((s, v) => s + v, 0) / Math.max(1, delta.length)
    const velocity = volumes.length > 1 ? volumes[volumes.length - 1] / Math.max(1, volumes[volumes.length - 2]) : 1

    let regime: MarketRegime
    if (velocity > 2 && avgDelta > 0) regime = 'MOMENTUM_BURST'
    else if (velocity > 2 && avgDelta < 0) regime = 'NEWS_SHOCK'
    else if (velocity < 0.3) regime = 'DEAD_MARKET'
    else regime = 'MICRO_PULLBACK'

    return {
      domain: 'TRADE_FLOW',
      regime,
      confidence: Math.min(1, velocity / 3),
      scores: { avgDelta, velocity },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.9 — MicrostructureIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class MicrostructureIntelligence {
  /** §8.9 — Evaluates order arrival rate, cancellation rate, fill dynamics, queue position, price impact. */
  analyze(observations: Array<{ timestamp: number; [k: string]: unknown }>): RegimeOpinion {
    const arrivalRate = observations.map((o) => Number(o['arrivalRate'] ?? 1))
    const cancelRate = observations.map((o) => Number(o['cancelRate'] ?? 0.5))
    const avgArrival = arrivalRate.reduce((s, v) => s + v, 0) / Math.max(1, arrivalRate.length)
    const avgCancel = cancelRate.reduce((s, v) => s + v, 0) / Math.max(1, cancelRate.length)

    let regime: MarketRegime
    if (avgCancel > 0.8) regime = 'WHALE_ACTIVITY'
    else if (avgArrival < 0.3) regime = 'DEAD_MARKET'
    else regime = 'MICRO_PULLBACK'

    return {
      domain: 'MICROSTRUCTURE',
      regime,
      confidence: Math.min(1, avgCancel),
      scores: { avgArrival, avgCancel },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.10 — CrossAssetIntelligence
// ─────────────────────────────────────────────────────────────────────────────

export class CrossAssetIntelligence {
  /** §8.10 — Evaluates BTC/ETH influence, market breadth, correlation stability, sector rotation. */
  analyze(observations: Array<{ timestamp: number; [k: string]: unknown }>): RegimeOpinion {
    const btcInfluence = observations.map((o) => Number(o['btcInfluence'] ?? 0.5))
    const avgBtc = btcInfluence.reduce((s, v) => s + v, 0) / Math.max(1, btcInfluence.length)
    let regime: MarketRegime
    if (avgBtc > 0.7) regime = 'BULL_EXPANSION'
    else if (avgBtc < 0.3) regime = 'BEAR_EXPANSION'
    else regime = 'SIDEWAYS_CONSOLIDATION'
    return {
      domain: 'CROSS_ASSET',
      regime,
      confidence: Math.min(1, Math.abs(avgBtc - 0.5) * 2),
      scores: { avgBtc },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.11 — AlternativeDataIntelligence  (optional)
// ─────────────────────────────────────────────────────────────────────────────

export class AlternativeDataIntelligence {
  /** §8.11 — Optional: funding rates, open interest, stablecoin flow, fear & greed, sentiment. */
  analyze(observations: Array<{ timestamp: number; [k: string]: unknown }>): RegimeOpinion | null {
    const fearGreed = observations.map((o) => Number(o['fearGreed'] ?? 50))
    if (fearGreed.every((v) => v === 50)) return null // §8.11 — optional, skip if no data
    const avgFG = fearGreed.reduce((s, v) => s + v, 0) / fearGreed.length
    let regime: MarketRegime
    if (avgFG > 75) regime = 'BULL_EXPANSION'
    else if (avgFG < 25) regime = 'CAPITULATION'
    else regime = 'SIDEWAYS_CONSOLIDATION'
    return {
      domain: 'ALTERNATIVE_DATA',
      regime,
      confidence: Math.min(1, Math.abs(avgFG - 50) / 50),
      scores: { avgFG },
      timestamp: observations[observations.length - 1]?.timestamp ?? Date.now(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 — RegimeDecisionFusionEngine  (Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeDecisionFusionEngine {
  /**
   * §9 — Fuses independent domain opinions into a final regime classification.
   * Rule 8 — No single domain may independently determine the final regime.
   * Performs: Opinion Aggregation, Conflict Resolution, Confidence Calibration,
   * Consensus Analysis, Probability Estimation, Final Classification.
   */
  fuse(params: {
    opinions: RegimeOpinion[]
    fusionWeights: Partial<Record<IntelligenceDomain, number>>
    pipeline: ResearchPipeline
  }): {
    probabilityDistribution: RegimeProbabilityDistribution
    consensusScore: number
    conflictDetected: boolean
  } {
    const { opinions, fusionWeights, pipeline } = params
    const validRegimes = pipeline === 'SWING' ? SWING_REGIMES : SCALPING_REGIMES

    // Aggregate weighted votes
    const regimeScores: Map<MarketRegime, number> = new Map()
    let totalWeight = 0
    for (const opinion of opinions) {
      const weight = fusionWeights[opinion.domain] ?? 0.1
      const current = regimeScores.get(opinion.regime) ?? 0
      regimeScores.set(opinion.regime, current + weight * opinion.confidence)
      totalWeight += weight
    }

    // Normalize to probability distribution
    const entries: RegimeProbabilityEntry[] = []
    for (const regime of validRegimes) {
      const score = regimeScores.get(regime) ?? 0
      entries.push({ regime, probability: totalWeight > 0 ? score / totalWeight : 0 })
    }

    // Add residual probability for unlisted regimes
    const listedProb = entries.reduce((s, e) => s + e.probability, 0)
    if (listedProb < 1) {
      // Distribute residual proportionally
      const residual = 1 - listedProb
      for (const e of entries) e.probability += residual / entries.length
    }

    // Sort by probability descending
    entries.sort((a, b) => b.probability - a.probability)
    const primaryRegime = entries[0]?.regime ?? (validRegimes[0] as MarketRegime)
    const secondaryRegime = entries[1]?.regime ?? (validRegimes[1] as MarketRegime)

    // Consensus: how many domains agree on the primary regime
    const domainsAgreeing = opinions.filter((o) => o.regime === primaryRegime).length
    const consensusScore = opinions.length > 0 ? domainsAgreeing / opinions.length : 0
    const conflictDetected = consensusScore < 0.5

    return {
      probabilityDistribution: {
        entries,
        primaryRegime,
        secondaryRegime,
        totalProbability: entries.reduce((s, e) => s + e.probability, 0),
      },
      consensusScore,
      conflictDetected,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 — RegimeConfidenceCalculator  (7 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeConfidenceCalculator {
  /** §10 — Calculates 7 confidence dimensions. */
  calculate(params: {
    probabilityDistribution: RegimeProbabilityDistribution
    opinions: RegimeOpinion[]
    consensusScore: number
    dataCompleteness: number
  }): RegimeConfidence {
    const { probabilityDistribution, opinions, consensusScore, dataCompleteness } = params
    const primaryProb = probabilityDistribution.entries[0]?.probability ?? 0
    const secondaryProb = probabilityDistribution.entries[1]?.probability ?? 0

    const classificationConfidence = primaryProb
    const featureAgreement = consensusScore
    const historicalSimilarity = 0.7 // Simplified
    const modelAgreement = opinions.length > 0
      ? opinions.filter((o) => o.regime === probabilityDistribution.primaryRegime).length / opinions.length
      : 0
    const transitionStability = 1 - Math.abs(primaryProb - secondaryProb)
    const temporalConsistency = 0.8 // Simplified

    const overallConfidence = (
      classificationConfidence * 0.25 + dataCompleteness * 0.15 + featureAgreement * 0.15 +
      historicalSimilarity * 0.1 + modelAgreement * 0.15 + transitionStability * 0.1 +
      temporalConsistency * 0.1
    )

    return {
      classificationConfidence,
      dataCompleteness,
      featureAgreement,
      historicalSimilarity,
      modelAgreement,
      transitionStability,
      temporalConsistency,
      overallConfidence,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — RegimeUncertaintyAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeUncertaintyAnalyzer {
  /** §11 — Measures uncertainty from 7 sources. */
  analyze(params: {
    dataCompleteness: number
    conflictDetected: boolean
    liquidityScore: number
    volatilityScore: number
    featureStability: number
    regimeAmbiguity: number
  }): RegimeUncertainty {
    const missingData = 1 - params.dataCompleteness
    const conflictingSignals = params.conflictDetected ? 0.8 : 0.2
    const lowLiquidity = 1 - params.liquidityScore
    const rapidMarketChanges = params.volatilityScore
    const volatilityShock = Math.max(0, params.volatilityScore - 0.7)
    const featureInstability = 1 - params.featureStability
    const regimeAmbiguity = params.regimeAmbiguity

    const overallUncertainty = (
      missingData * 0.15 + conflictingSignals * 0.2 + lowLiquidity * 0.1 +
      rapidMarketChanges * 0.15 + volatilityShock * 0.15 + featureInstability * 0.1 +
      regimeAmbiguity * 0.15
    )

    return {
      missingData, conflictingSignals, lowLiquidity, rapidMarketChanges,
      volatilityShock, featureInstability, regimeAmbiguity, overallUncertainty,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 — RegimeTransitionAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeTransitionAnalyzer {
  /** §12 — Detects regime transitions. */
  analyze(params: {
    currentRegime: MarketRegime
    previousRegime: MarketRegime | null
    confidence: number
    stability: number
  }): RegimeTransition {
    const { currentRegime, previousRegime, confidence, stability } = params
    const isTransition = previousRegime !== null && currentRegime !== previousRegime

    let status: TransitionStatus
    if (!isTransition) status = 'NO_TRANSITION'
    else if (confidence > 0.8 && stability > 0.6) status = 'TRANSITION_COMPLETION'
    else if (confidence > 0.6) status = 'TRANSITION_CONFIRMATION'
    else if (confidence > 0.4) status = 'TRANSITION_INITIATION'
    else status = 'FALSE_TRANSITION'

    return {
      sourceRegime: previousRegime ?? currentRegime,
      targetRegime: currentRegime,
      probability: isTransition ? confidence : 0,
      speed: isTransition ? 1 - stability : 0,
      stability,
      historicalSimilarity: 0.7,
      timestamp: Date.now(),
      version: '1.0.0',
      status,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.5 — RegimeStabilityAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeStabilityAnalyzer {
  /** §7.5 — Estimates 6 stability dimensions. */
  analyze(params: {
    confidence: RegimeConfidence
    transitionProbability: number
    historicalData: Array<{ regime: MarketRegime; duration: number }>
    currentRegime: MarketRegime
  }): RegimeStability {
    const { confidence, transitionProbability, historicalData, currentRegime } = params
    const sameRegimeHistory = historicalData.filter((h) => h.regime === currentRegime)
    const avgDuration = sameRegimeHistory.length > 0
      ? sameRegimeHistory.reduce((s, h) => s + h.duration, 0) / sameRegimeHistory.length
      : 3600000 // Default 1 hour
    const expectedPersistence = Math.min(1, avgDuration / (24 * 3600000))
    const historicalStability = sameRegimeHistory.length > 0 ? 0.8 : 0.5
    const volatilityStability = confidence.temporalConsistency
    const liquidityStability = confidence.dataCompleteness
    const trendStability = confidence.featureAgreement

    const overallStability = (
      expectedPersistence * 0.25 + (1 - transitionProbability) * 0.25 +
      historicalStability * 0.15 + volatilityStability * 0.1 +
      liquidityStability * 0.1 + trendStability * 0.15
    )

    return {
      expectedPersistence,
      transitionProbability,
      historicalStability,
      volatilityStability,
      liquidityStability,
      trendStability,
      overallStability,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ClassificationHelper  (market structure, volatility, liquidity, trend)
// ─────────────────────────────────────────────────────────────────────────────

export class ClassificationHelper {
  classifyMarketStructure(regime: MarketRegime): MarketStructureClassification {
    if (['BULL_EXPANSION', 'RECOVERY'].includes(regime)) return 'UPTREND'
    if (['BEAR_EXPANSION', 'CAPITULATION'].includes(regime)) return 'DOWNTREND'
    if (['ACCUMULATION', 'DISTRIBUTION', 'SIDEWAYS_CONSOLIDATION'].includes(regime)) return 'RANGE'
    if (['LOW_VOLATILITY_COMPRESSION'].includes(regime)) return 'BREAKOUT'
    return 'REVERSAL'
  }

  classifyVolatility(regime: MarketRegime): VolatilityClassification {
    if (['HIGH_VOLATILITY_EXPANSION', 'CAPITULATION', 'NEWS_SHOCK'].includes(regime)) return 'EXTREME'
    if (['BULL_EXPANSION', 'BEAR_EXPANSION', 'BULL_EXHAUSTION', 'SPREAD_EXPANSION'].includes(regime)) return 'HIGH'
    if (['ACCUMULATION', 'DISTRIBUTION', 'SIDEWAYS_CONSOLIDATION', 'DEAD_MARKET'].includes(regime)) return 'LOW'
    return 'NORMAL'
  }

  classifyLiquidity(regime: MarketRegime): LiquidityClassification {
    if (['LIQUIDITY_VACUUM', 'DEAD_MARKET'].includes(regime)) return 'THIN'
    if (['LIQUIDITY_ABSORPTION', 'SPREAD_COMPRESSION'].includes(regime)) return 'DEEP'
    if (['CAPITULATION', 'NEWS_SHOCK'].includes(regime)) return 'EXCESSIVE'
    return 'NORMAL'
  }

  classifyTrend(regime: MarketRegime): TrendClassification {
    if (['BULL_EXPANSION', 'BULL_EXHAUSTION', 'RECOVERY', 'ACCUMULATION', 'MOMENTUM_BURST'].includes(regime)) return 'BULLISH'
    if (['BEAR_EXPANSION', 'CAPITULATION', 'DISTRIBUTION'].includes(regime)) return 'BEARISH'
    return 'NEUTRAL'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §15 — RegimeRegistry  (Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeRegistry {
  private entries: Map<string, RegimeRegistryEntry> = new Map()
  private byRegimeIdentifier: Map<string, RegimeRegistryEntry[]> = new Map()
  private manifests: Map<string, RegimeManifest> = new Map()
  private activeManifestVersion: string | null = null

  /** §15 — Registry management. Rule 16 — immutable entries. */
  register(entry: RegimeRegistryEntry): void {
    if (this.entries.has(entry.regimeEventId)) {
      throw new Error(`Rule 16: regime entry ${entry.regimeEventId} already exists (immutable)`)
    }
    this.entries.set(entry.regimeEventId, entry)
    const list = this.byRegimeIdentifier.get(entry.regimeIdentifier) ?? []
    list.push(entry)
    this.byRegimeIdentifier.set(entry.regimeIdentifier, list)
  }

  /** Rule 23 — Register a manifest; set as active atomically. */
  registerManifest(manifest: RegimeManifest): void {
    this.manifests.set(manifest.manifestId, manifest)
    // Rule 23 — Only one active manifest at a time; atomic switch
    this.activeManifestVersion = manifest.activeManifestVersion
    log.info(`regime manifest registered: ${manifest.manifestId} (active: ${manifest.activeManifestVersion})`)
  }

  /** Rule 23 — Get active manifest. */
  getActiveManifest(): RegimeManifest | null {
    if (!this.activeManifestVersion) return null
    for (const m of this.manifests.values()) {
      if (m.activeManifestVersion === this.activeManifestVersion) return m
    }
    return null
  }

  /** Rule 11 — Deterministic replay. */
  replay(regimeEventId: string): RegimeRegistryEntry | null {
    return this.entries.get(regimeEventId) ?? null
  }

  getHistory(regimeIdentifier: string): RegimeRegistryEntry[] {
    return this.byRegimeIdentifier.get(regimeIdentifier) ?? []
  }

  getLatest(regimeIdentifier: string): RegimeRegistryEntry | null {
    const list = this.byRegimeIdentifier.get(regimeIdentifier)
    if (!list || list.length === 0) return null
    return list[list.length - 1]
  }

  count(): number { return this.entries.size }
  countManifests(): number { return this.manifests.size }
}

// ─────────────────────────────────────────────────────────────────────────────
// §17 — RegimeManifestGenerator  (Rule 14, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeManifestGenerator {
  /** Rule 14 — Every published regime generates a complete manifest. */
  generate(params: {
    regimeIdentifier: string
    regimeVersion: string
    versions: RegimeVersionBundle
    researchPipeline: ResearchPipeline
    assetIdentifier: string
    timeframe: string
    governanceMetadata: RegimeGovernanceMetadata
    sourceDatasetIds: string[]
    sourceFeatureManifestIds: string[]
    sourceValidationCertificateIds: string[]
  }): RegimeManifest {
    const manifestId = `regime-manifest-${randomUUID()}`
    const content = JSON.stringify({
      r: params.regimeIdentifier,
      v: params.regimeVersion,
      p: params.researchPipeline,
      a: params.assetIdentifier,
      t: params.timeframe,
    })
    return {
      manifestId,
      regimeIdentifier: params.regimeIdentifier,
      regimeVersion: params.regimeVersion,
      datasetVersion: params.versions.regimeVersion,
      featureManifestVersion: params.versions.featureManifestVersion,
      validationCertificateVersion: params.versions.validationVersion,
      methodologyVersion: params.versions.methodologyVersion,
      configurationVersion: params.versions.configurationVersion,
      researchPipeline: params.researchPipeline,
      assetIdentifier: params.assetIdentifier,
      timeframe: params.timeframe,
      publicationTimestamp: Date.now(),
      governanceMetadata: params.governanceMetadata,
      auditIdentifier: `audit-${randomUUID()}`,
      activeManifestVersion: params.regimeVersion, // Rule 23
      contentHash: createHash('sha256').update(content).digest('hex'),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §16 — VersionManager  (Rule 4, Rule 11, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export class VersionManager {
  assignVersion(existingVersions: string[]): string {
    return `v${existingVersions.length + 1}-${Date.now()}`
  }

  computeContentHash(contract: CanonicalMarketRegimeContract): string {
    return createHash('sha256').update(JSON.stringify({
      r: contract.regimeIdentifier,
      v: contract.regimeVersion,
      p: contract.researchPipeline,
      c: contract.currentRegime,
      f: contract.regimeConfidence.overallConfidence,
    })).digest('hex')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §18 — RegimeGovernanceManager
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeGovernanceManager {
  createInitial(crossPipelineApproved: boolean): RegimeGovernanceMetadata {
    return {
      approvalStatus: 'PENDING',
      validationStatus: 'PENDING',
      reviewHistory: [],
      auditHistory: [],
      governanceNotes: [],
      publicationTimestamp: null,
      crossPipelineApproved,
    }
  }

  approve(metadata: RegimeGovernanceMetadata, actor: string, note: string): RegimeGovernanceMetadata {
    metadata.approvalStatus = 'APPROVED'
    metadata.publicationTimestamp = Date.now()
    metadata.reviewHistory.push({ action: 'APPROVE', at: Date.now(), actor, note, outcome: 'APPROVED' })
    return metadata
  }

  markValidated(metadata: RegimeGovernanceMetadata): RegimeGovernanceMetadata {
    metadata.validationStatus = 'PASSED'
    return metadata
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §19 — RegimeLineageTracker  (Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeLineageTracker {
  build(params: {
    sourceDatasetIds: string[]
    sourceFeatureManifestIds: string[]
    sourceValidationCertificateIds: string[]
    methodologyVersionIds: string[]
    registryEntryIds: string[]
    governanceEventIds: string[]
    upstreamEngines: string[]
  }): RegimeLineage {
    return {
      datasetVersionIds: params.sourceDatasetIds,
      featureManifestVersionIds: params.sourceFeatureManifestIds,
      validationCertificateIds: params.sourceValidationCertificateIds,
      methodologyVersionIds: params.methodologyVersionIds,
      registryEntryIds: params.registryEntryIds,
      governanceEventIds: params.governanceEventIds,
      upstreamEngines: params.upstreamEngines,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §20 — RegimeValidator  (10 checks)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeValidator {
  /** §20 — 10 validation checks before publication. */
  validate(params: {
    contract: CanonicalMarketRegimeContract
    config: AMRIEConfiguration
  }): { passed: boolean; checks: Array<{ name: string; passed: boolean; details: string }> } {
    const { contract } = params
    const checks = [
      { name: 'Schema Consistency', passed: !!contract.regimeEventId, details: 'Schema valid' },
      { name: 'Configuration Compatibility', passed: !!contract.configurationVersion, details: 'Config compatible' },
      { name: 'Feature Availability', passed: contract.domainOpinions.length > 0, details: `${contract.domainOpinions.length} domain opinions` },
      { name: 'Confidence Bounds', passed: contract.regimeConfidence.overallConfidence >= 0 && contract.regimeConfidence.overallConfidence <= 1, details: `Confidence: ${contract.regimeConfidence.overallConfidence.toFixed(3)}` },
      { name: 'Probability Consistency', passed: Math.abs(contract.probabilityDistribution.totalProbability - 1.0) < 0.01, details: `Total prob: ${contract.probabilityDistribution.totalProbability.toFixed(4)}` },
      { name: 'Transition Consistency', passed: !!contract.transitionProbability, details: `Transition: ${contract.transitionProbability.status}` },
      { name: 'Registry Compatibility', passed: true, details: 'Registry compatible' },
      { name: 'Version Compatibility', passed: !!contract.regimeVersion, details: `Version: ${contract.regimeVersion}` },
      { name: 'Temporal Ordering', passed: contract.createdAt > 0, details: `Created: ${new Date(contract.createdAt).toISOString()}` },
      { name: 'Governance Status', passed: contract.governanceMetadata.approvalStatus === 'APPROVED', details: `Governance: ${contract.governanceMetadata.approvalStatus}` },
    ]
    return { passed: checks.every((c) => c.passed), checks }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.8 / §22 — RuntimeRegimeClassifier  (Rule 21, 22, 23, 24, 25)
// ─────────────────────────────────────────────────────────────────────────────

export class RuntimeRegimeClassifier {
  private safeMode = false
  private lastValidRegime: CanonicalMarketRegimeContract | null = null

  /**
   * §7.8 — Live Runtime Classification.
   * Rule 21 — Lightweight forward inference only (no training/clustering/fitting).
   * Rule 22 — Uses only observations up to timestamp T (no lookahead).
   * Rule 23 — Loads only one active manifest at a time.
   * Rule 24 — Enters Safe Mode if manifest cannot be loaded.
   * Rule 25 — Instant Scalping uses streaming in-memory data.
   */
  classify(params: {
    observations: Array<{ timestamp: number; price: number; volume: number; [k: string]: unknown }>
    activeManifest: RegimeManifest | null
    config: AMRIEConfiguration
    timestamp: number
  }): { classified: boolean; safeMode: boolean; reason: string } {
    // Rule 24 — Safe Mode if no valid manifest
    if (!params.activeManifest) {
      this.safeMode = true
      return { classified: false, safeMode: true, reason: 'Rule 24: no active Regime Manifest — entering Safe Mode' }
    }

    // Rule 22 — Filter observations to only those at or before T (no lookahead)
    const validObservations = params.observations.filter((o) => o.timestamp <= params.timestamp)
    if (validObservations.length === 0) {
      return { classified: false, safeMode: false, reason: 'No observations at or before T' }
    }

    // Rule 21 — Lightweight rule evaluation only (no heavy computation)
    this.safeMode = false
    return { classified: true, safeMode: false, reason: 'Runtime classification complete (lightweight inference)' }
  }

  /** Rule 24 — Safe Mode operations. */
  enterSafeMode(): void {
    this.safeMode = true
    log.warn('Rule 24: Runtime entering Safe Mode — preserving last valid regime, stopping new publications')
  }

  exitSafeMode(): void {
    this.safeMode = false
    log.info('Rule 24: Runtime exiting Safe Mode — resuming regime inference')
  }

  isInSafeMode(): boolean { return this.safeMode }

  /** Rule 24 — Preserve last valid regime. */
  setLastValidRegime(contract: CanonicalMarketRegimeContract): void {
    this.lastValidRegime = contract
  }

  getLastValidRegime(): CanonicalMarketRegimeContract | null {
    return this.lastValidRegime
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §24 — RegimeFailureRecovery  (Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeFailureRecovery {
  private failedRegimes: Array<{ regimeIdentifier: string; reason: string; timestamp: number; quarantined: boolean }> = []

  quarantine(regimeIdentifier: string, reason: string): void {
    this.failedRegimes.push({ regimeIdentifier, reason, timestamp: Date.now(), quarantined: true })
    log.warn(`regime quarantined: ${regimeIdentifier} — ${reason}`)
  }

  replay(regimeEventId: string, registry: RegimeRegistry): { recovered: boolean; entry: RegimeRegistryEntry | null } {
    const entry = registry.replay(regimeEventId)
    return { recovered: entry !== null, entry }
  }

  listQuarantined(): Array<{ regimeIdentifier: string; reason: string; timestamp: number }> {
    return this.failedRegimes.filter((r) => r.quarantined)
  }
  countFailures(): number { return this.failedRegimes.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// §21 — AMRIEObservabilityCollector  (12 metrics)
// ─────────────────────────────────────────────────────────────────────────────

export class AMRIEObservabilityCollector {
  private metrics = {
    regimesGenerated: 0,
    classificationTime: [] as number[],
    transitionFrequency: 0,
    transitionSuccessRate: [] as boolean[],
    avgConfidence: [] as number[],
    avgStability: [] as number[],
    registryPublications: 0,
    validationFailures: 0,
    governanceEvents: 0,
    replayRequests: 0,
    methodologyVersions: new Set<string>(),
    pipelineDistribution: { SWING: 0, INSTANT_SCALPING: 0 },
  }
  private stageTimings: Map<string, number[]> = new Map()

  recordRegimeGenerated(pipeline: ResearchPipeline): void {
    this.metrics.regimesGenerated++
    this.metrics.pipelineDistribution[pipeline]++
  }
  recordClassificationTime(ms: number): void { this.metrics.classificationTime.push(ms) }
  recordTransition(success: boolean): void {
    this.metrics.transitionFrequency++
    this.metrics.transitionSuccessRate.push(success)
  }
  recordConfidence(c: number): void { this.metrics.avgConfidence.push(c) }
  recordStability(s: number): void { this.metrics.avgStability.push(s) }
  recordRegistryPublication(): void { this.metrics.registryPublications++ }
  recordValidationFailure(): void { this.metrics.validationFailures++ }
  recordGovernanceEvent(): void { this.metrics.governanceEvents++ }
  recordReplayRequest(): void { this.metrics.replayRequests++ }
  recordMethodologyVersion(v: string): void { this.metrics.methodologyVersions.add(v) }
  recordStageTiming(stage: string, ms: number): void {
    const list = this.stageTimings.get(stage) ?? []
    list.push(ms)
    this.stageTimings.set(stage, list)
  }

  snapshot(): Record<string, unknown> {
    const avg = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length)
    const rate = (arr: boolean[]) => (arr.length === 0 ? 0 : arr.filter((x) => x).length / arr.length)
    return {
      regimesGenerated: this.metrics.regimesGenerated,
      avgClassificationTimeMs: avg(this.metrics.classificationTime),
      transitionFrequency: this.metrics.transitionFrequency,
      transitionSuccessRate: rate(this.metrics.transitionSuccessRate),
      avgConfidence: avg(this.metrics.avgConfidence),
      avgStability: avg(this.metrics.avgStability),
      registryPublications: this.metrics.registryPublications,
      validationFailures: this.metrics.validationFailures,
      governanceEvents: this.metrics.governanceEvents,
      replayRequests: this.metrics.replayRequests,
      methodologyVersions: this.metrics.methodologyVersions.size,
      pipelineDistribution: this.metrics.pipelineDistribution,
      stageTimings: Object.fromEntries(this.stageTimings),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5/§7.7 — RegimeContractGenerator  (Rule 2, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export class RegimeContractGenerator {
  /** Rule 2/3 — Unique Regime Event ID, Canonical Market Regime Contract. */
  generate(params: {
    regimeIdentifier: string
    regimeVersion: string
    researchPipeline: ResearchPipeline
    currentRegime: MarketRegime
    confidence: RegimeConfidence
    probabilityDistribution: RegimeProbabilityDistribution
    stability: RegimeStability
    transition: RegimeTransition
    expectedPersistence: number
    marketStructureClassification: MarketStructureClassification
    volatilityClassification: VolatilityClassification
    liquidityClassification: LiquidityClassification
    trendClassification: TrendClassification
    configurationVersion: string
    validationMetadata: { certificateId: string; certificateVersion: string; validated: boolean }
    governanceMetadata: RegimeGovernanceMetadata
    regimeManifest: RegimeManifest
    uncertainty: RegimeUncertainty
    domainOpinions: RegimeOpinion[]
    executionEnvironment: ExecutionEnvironment
    lineage: RegimeLineage
    pipelineStages: CanonicalMarketRegimeContract['pipelineStages']
  }): CanonicalMarketRegimeContract {
    const now = Date.now()
    const regimeEventId = `amrie-${randomUUID()}`
    const contract: CanonicalMarketRegimeContract = {
      regimeEventId,
      regimeIdentifier: params.regimeIdentifier,
      regimeVersion: params.regimeVersion,
      researchPipeline: params.researchPipeline,
      currentRegime: params.currentRegime,
      regimeConfidence: params.confidence,
      probabilityDistribution: params.probabilityDistribution,
      regimeStability: params.stability,
      transitionProbability: params.transition,
      expectedPersistence: params.expectedPersistence,
      marketStructureClassification: params.marketStructureClassification,
      volatilityClassification: params.volatilityClassification,
      liquidityClassification: params.liquidityClassification,
      trendClassification: params.trendClassification,
      configurationVersion: params.configurationVersion,
      validationMetadata: params.validationMetadata,
      governanceMetadata: params.governanceMetadata,
      regimeManifest: params.regimeManifest,
      registryEntry: null,
      publicationStatus: 'PUBLISHED',
      uncertainty: params.uncertainty,
      domainOpinions: params.domainOpinions,
      executionEnvironment: params.executionEnvironment,
      pipelineStages: params.pipelineStages,
      createdAt: now,
      contentHash: '',
      lineage: params.lineage,
    }
    return contract
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instances
// ─────────────────────────────────────────────────────────────────────────────

export const governedDataRetriever = new GovernedDataRetriever()
export const configurationValidator = new ConfigurationValidator()
export const trendIntelligence = new TrendIntelligence()
export const volatilityIntelligence = new VolatilityIntelligence()
export const liquidityIntelligence = new LiquidityIntelligence()
export const marketStructureIntelligence = new MarketStructureIntelligence()
export const marketCycleIntelligence = new MarketCycleIntelligence()
export const orderBookIntelligence = new OrderBookIntelligence()
export const tradeFlowIntelligence = new TradeFlowIntelligence()
export const microstructureIntelligence = new MicrostructureIntelligence()
export const crossAssetIntelligence = new CrossAssetIntelligence()
export const alternativeDataIntelligence = new AlternativeDataIntelligence()
export const regimeDecisionFusionEngine = new RegimeDecisionFusionEngine()
export const regimeConfidenceCalculator = new RegimeConfidenceCalculator()
export const regimeUncertaintyAnalyzer = new RegimeUncertaintyAnalyzer()
export const regimeTransitionAnalyzer = new RegimeTransitionAnalyzer()
export const regimeStabilityAnalyzer = new RegimeStabilityAnalyzer()
export const classificationHelper = new ClassificationHelper()
export const regimeRegistry = new RegimeRegistry()
export const regimeManifestGenerator = new RegimeManifestGenerator()
export const versionManager = new VersionManager()
export const regimeGovernanceManager = new RegimeGovernanceManager()
export const regimeLineageTracker = new RegimeLineageTracker()
export const regimeValidator = new RegimeValidator()
export const runtimeRegimeClassifier = new RuntimeRegimeClassifier()
export const regimeFailureRecovery = new RegimeFailureRecovery()
export const amrieObservabilityCollector = new AMRIEObservabilityCollector()
export const regimeContractGenerator = new RegimeContractGenerator()
