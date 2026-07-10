// CHAPTER 5.3 §7 — Portfolio Construction Methodologies
//
// Supports 17 portfolio optimization methodologies for constructing target
// portfolio allocations from validated Strategy Decision Contracts.
//
// All methodologies remain: configurable, version controlled, reproducible,
// independently governed (§7).
//
// §7.1 — Uncertainty-Aware: epistemic uncertainty proportionally REDUCES
//         allocation (NEVER increases — Rule 10).
// §7.2 — Liquidity-Constrained: respects ADV, depth, participation limits.
// §7.3 — Transaction Cost-Aware: includes commissions, fees, slippage, impact.
// §7.4 — Multi-Objective: simultaneous optimization across competing objectives.
// §7.5 — Optimization Governance: full audit trail for every optimization.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalStrategyDecision } from '../strategy-engine/types'
import type {
  AssetMetadata,
  PortfolioConfiguration,
  PortfolioMethod,
} from './types'

const log = createLogger('decision-intelligence:portfolio-construction:methods')

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Input — bundled data needed by all methods
// ─────────────────────────────────────────────────────────────────────────────

export interface OptimizationInput {
  /** Strategy decisions to allocate across. */
  decisions: CanonicalStrategyDecision[]
  /** Asset metadata for each tradable instrument. */
  assetMetadata: Map<string, AssetMetadata>
  /** Total portfolio NAV (quote currency). */
  totalNav: number
  /** Current invested capital (for capital-aware methods). */
  currentInvestedCapital: number
  /** Portfolio configuration. */
  configuration: PortfolioConfiguration
  /** Random seed (for reproducibility — Rule 6). */
  randomSeed: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Result — raw weights produced by a method
// ─────────────────────────────────────────────────────────────────────────────

export interface OptimizationResult {
  method: PortfolioMethod
  /** Per-symbol target weights (signed: positive = long, negative = short). */
  weights: Map<string, number>
  /** Expected return of the portfolio. */
  expectedReturn: number
  /** Expected portfolio volatility (annualized). */
  expectedVolatility: number
  /** Allocation confidence computed by the method (Rule 14). */
  allocationConfidence: number
  /** Method-specific metadata. */
  metadata: Record<string, unknown>
  /** Warnings during optimization. */
  warnings: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioMethodOptimizer interface (§7 — algorithm-independent)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioMethodOptimizer {
  method: PortfolioMethod
  optimize(input: OptimizationInput): OptimizationResult
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Extract per-asset aggregate from strategy decisions
// ─────────────────────────────────────────────────────────────────────────────

interface AssetAggregate {
  symbol: string
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  exposureFraction: number
  decisionConfidence: number
  decisionStrength: number
  expectedReturn: number
  strategyIds: string[]
  decisionIds: string[]
  /** From §7.1 — prediction uncertainty (epistemic) for uncertainty-aware methods. */
  epistemicUncertainty: number
  aleatoricUncertainty: number
  predictionConfidence: number
}

function aggregateDecisions(decisions: CanonicalStrategyDecision[]): Map<string, AssetAggregate> {
  // Group decisions by symbol (extracted from signalId — but in our model the
  // decision carries the signal ID, not the symbol directly; we use the
  // exposureIntent + strategyMetadata to group). For this implementation we
  // group by the strategyMetadata.lineage.signalId's instrument context which
  // is passed in via the decision's exposureIntent.
  //
  // NOTE: Chapter 5.2 CanonicalStrategyDecision does not carry a `symbol` field
  // directly. The instrument is provided by the caller via the assetMetadata map
  // and the strategy decisions implicitly target instruments via their exposure
  // intent. For portfolio construction, we use a "decision key" based on
  // exposure direction to allocate capital across distinct positions.
  //
  // In a production system, the Canonical Strategy Decision Contract would
  // include an explicit `instrument` field. Here we treat each unique
  // (decisionId) as a distinct allocation slot, and the assetMetadata map
  // provides the tradable instrument context.
  const aggregates = new Map<string, AssetAggregate>()

  for (const decision of decisions) {
    if (decision.decisionType === 'NO_ACTION' || decision.decisionType === 'HOLD') continue
    if (decision.capitalReservationStatus === 'INVALIDATED') continue
    if (decision.capitalReservationStatus === 'INSUFFICIENT_CAPACITY') continue

    // Use strategyId as the allocation key (each strategy gets its own slot).
    // In a real portfolio, multiple decisions from the same strategy on the
    // same instrument would aggregate, but here we treat each strategy as a
    // distinct allocation slot.
    const key = decision.strategyId
    const existing = aggregates.get(key)

    const direction = decision.exposureIntent.direction
    const exposure = decision.exposureIntent.exposureFraction
    const confidence = decision.decisionConfidence
    const strength = decision.decisionStrength

    if (existing) {
      existing.exposureFraction = Math.max(existing.exposureFraction, exposure)
      existing.decisionConfidence = Math.max(existing.decisionConfidence, confidence)
      existing.decisionStrength = Math.max(existing.decisionStrength, strength)
      if (!existing.strategyIds.includes(decision.strategyId)) {
        existing.strategyIds.push(decision.strategyId)
      }
      if (!existing.decisionIds.includes(decision.decisionId)) {
        existing.decisionIds.push(decision.decisionId)
      }
    } else {
      aggregates.set(key, {
        symbol: key,
        direction,
        exposureFraction: exposure,
        decisionConfidence: confidence,
        decisionStrength: strength,
        expectedReturn: 0, // populated by caller from asset metadata
        strategyIds: [decision.strategyId],
        decisionIds: [decision.decisionId],
        epistemicUncertainty: 0.15, // default; would come from upstream
        aleatoricUncertainty: 0.10,
        predictionConfidence: 0.7,
      })
    }
  }

  return aggregates
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Equal Weight (§7)
// Allocates equally across all qualifying decisions.
// ─────────────────────────────────────────────────────────────────────────────

export class EqualWeightOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'EQUAL_WEIGHT'

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const n = aggregates.size
    const weights = new Map<string, number>()
    const warnings: string[] = []

    if (n === 0) {
      warnings.push('no qualifying decisions — empty portfolio')
      return { method: this.method, weights, expectedReturn: 0, expectedVolatility: 0, allocationConfidence: 0, metadata: { assetCount: 0 }, warnings }
    }

    // §7.1 — Apply uncertainty penalty (NEVER increases allocation — Rule 10)
    const baseWeight = 1 / n
    let totalAdjustedWeight = 0
    const adjustedWeights = new Map<string, number>()

    for (const [key, agg] of aggregates) {
      let w = baseWeight
      if (input.configuration.uncertaintyAware.enabled) {
        const epistemicPenalty = agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight
        const aleatoricPenalty = agg.aleatoricUncertainty * input.configuration.uncertaintyAware.aleatoricPenaltyWeight
        const penalty = Math.max(0, Math.min(0.9, epistemicPenalty + aleatoricPenalty))
        w = baseWeight * (1 - penalty) // NEVER increase (Rule 10)
      }
      // Apply direction sign
      const signedW = agg.direction === 'SHORT' ? -w : agg.direction === 'NEUTRAL' ? 0 : w
      adjustedWeights.set(key, signedW)
      totalAdjustedWeight += Math.abs(signedW)
    }

    // Normalize so total = 1.0 (or scale to gross exposure limit)
    const grossLimit = input.configuration.constraints.maxGrossExposure
    const scale = totalAdjustedWeight > 0 ? Math.min(1, grossLimit / totalAdjustedWeight) : 1
    for (const [key, w] of adjustedWeights) {
      weights.set(key, w * scale)
    }

    // Compute portfolio expected return and volatility (simple aggregate)
    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let liquiditySum = 0
    let liquidityWeight = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) {
        weightedVol += Math.abs(w) * meta.volatility
        // Rule 14 — Allocation confidence INDEPENDENT from Strategy Decision Confidence.
        // We incorporate method-specific factors (liquidity, volatility, diversification)
        // and only use signal confidence as ONE input (capped at 30% weight).
        liquiditySum += meta.liquidityScore * Math.abs(w)
        liquidityWeight += Math.abs(w)
      }
      confidenceSum += agg.decisionConfidence * Math.abs(w)
    }
    // Rule 14 — Independent formula:
    //   allocation_conf = 0.3 * signal_conf + 0.3 * liquidity_score + 0.2 * (1 - normalized_vol) + 0.2 * diversification_factor
    const signalConfComponent = totalAdjustedWeight > 0 ? confidenceSum / totalAdjustedWeight : 0
    const liquidityComponent = liquidityWeight > 0 ? liquiditySum / liquidityWeight : 0.5
    const normalizedVol = Math.min(1, weightedVol / Math.max(0.01, totalAdjustedWeight))
    const volComponent = 1 - normalizedVol
    const diversificationComponent = Math.min(1, n / 10) // more assets = more diversified = higher confidence
    const allocationConfidence = Math.max(0, Math.min(1,
      0.3 * signalConfComponent +
      0.3 * liquidityComponent +
      0.2 * volComponent +
      0.2 * diversificationComponent,
    ))

    log.debug(`EqualWeight: ${n} assets, gross=${totalAdjustedWeight.toFixed(3)}, scale=${scale.toFixed(3)}, allocConf=${allocationConfidence.toFixed(3)} (Rule 14 independent)`)

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence,
      metadata: { assetCount: n, baseWeight, grossScale: scale, signalConf: signalConfComponent, liquidity: liquidityComponent, vol: volComponent, diversification: diversificationComponent },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fixed Allocation (§7)
// Allocates per a fixed allocation map (e.g., 60/40).
// ─────────────────────────────────────────────────────────────────────────────

export class FixedAllocationOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'FIXED_ALLOCATION'
  constructor(private fixedWeights: Map<string, number>) {}

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const weights = new Map<string, number>()
    const warnings: string[] = []

    for (const [key, agg] of aggregates) {
      const fixed = this.fixedWeights.get(key) ?? 0
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, fixed * direction)
    }

    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let totalAbs = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) weightedVol += Math.abs(w) * meta.volatility
      confidenceSum += agg.decisionConfidence * Math.abs(w)
      totalAbs += Math.abs(w)
    }

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence: totalAbs > 0 ? confidenceSum / totalAbs : 0,
      metadata: { fixedWeightsCount: this.fixedWeights.size },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Market Cap Weight (§7)
// Allocates proportional to market capitalization (proxied via ADDV here).
// ─────────────────────────────────────────────────────────────────────────────

export class MarketCapWeightOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'MARKET_CAP_WEIGHT'

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const weights = new Map<string, number>()
    const warnings: string[] = []

    // Use ADDV as market cap proxy
    let totalCap = 0
    const caps = new Map<string, number>()
    for (const key of aggregates.keys()) {
      const meta = input.assetMetadata.get(key)
      const cap = meta?.averageDailyDollarVolume ?? 1
      caps.set(key, cap)
      totalCap += cap
    }

    if (totalCap === 0) {
      warnings.push('no market cap data — equal weight fallback')
      return new EqualWeightOptimizer().optimize(input)
    }

    for (const [key, agg] of aggregates) {
      const cap = caps.get(key) ?? 0
      let w = cap / totalCap
      // §7.1 — uncertainty penalty
      if (input.configuration.uncertaintyAware.enabled) {
        const penalty = Math.max(0, Math.min(0.9,
          agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight +
          agg.aleatoricUncertainty * input.configuration.uncertaintyAware.aleatoricPenaltyWeight,
        ))
        w *= (1 - penalty)
      }
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, w * direction)
    }

    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let totalAbs = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) weightedVol += Math.abs(w) * meta.volatility
      confidenceSum += agg.decisionConfidence * Math.abs(w)
      totalAbs += Math.abs(w)
    }

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence: totalAbs > 0 ? confidenceSum / totalAbs : 0,
      metadata: { totalCap },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Equal Risk Contribution (ERC) (§7)
// Each asset contributes equally to portfolio risk.
// ─────────────────────────────────────────────────────────────────────────────

export class ERCOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'EQUAL_RISK_CONTRIBUTION'

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const n = aggregates.size
    const weights = new Map<string, number>()
    const warnings: string[] = []

    if (n === 0) {
      return { method: this.method, weights, expectedReturn: 0, expectedVolatility: 0, allocationConfidence: 0, metadata: {}, warnings: ['no assets'] }
    }

    // ERC: weight ∝ 1/volatility (inverse volatility weighting — common ERC approximation)
    let totalInverseVol = 0
    const inverseVols = new Map<string, number>()
    for (const [key, agg] of aggregates) {
      const meta = input.assetMetadata.get(key)
      const vol = meta?.volatility ?? 0.5
      const inv = 1 / Math.max(0.001, vol)
      inverseVols.set(key, inv)
      totalInverseVol += inv
    }

    for (const [key, agg] of aggregates) {
      const inv = inverseVols.get(key) ?? 0
      let w = inv / totalInverseVol
      // §7.1 — uncertainty penalty
      if (input.configuration.uncertaintyAware.enabled) {
        const penalty = Math.max(0, Math.min(0.9,
          agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight +
          agg.aleatoricUncertainty * input.configuration.uncertaintyAware.aleatoricPenaltyWeight,
        ))
        w *= (1 - penalty)
      }
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, w * direction)
    }

    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let totalAbs = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) weightedVol += Math.abs(w) * meta.volatility
      confidenceSum += agg.decisionConfidence * Math.abs(w)
      totalAbs += Math.abs(w)
    }

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence: totalAbs > 0 ? confidenceSum / totalAbs : 0,
      metadata: { assetCount: n, totalInverseVol },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Risk Parity (§7)
// Like ERC but with target volatility budgeting.
// ─────────────────────────────────────────────────────────────────────────────

export class RiskParityOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'RISK_PARITY'

  optimize(input: OptimizationInput): OptimizationResult {
    // Risk parity ≈ ERC for our purposes (inverse-volatility weighting)
    // The difference is that Risk Parity targets a specific portfolio volatility
    const ercResult = new ERCOptimizer().optimize(input)
    const targetVol = 0.15 // 15% annualized target
    let actualVol = ercResult.expectedVolatility
    let scale = 1
    if (actualVol > 0) {
      scale = Math.min(input.configuration.constraints.maxGrossExposure, targetVol / actualVol)
    }
    const weights = new Map<string, number>()
    for (const [k, w] of ercResult.weights) {
      weights.set(k, w * scale)
    }
    return {
      ...ercResult,
      method: this.method,
      weights,
      metadata: { ...ercResult.metadata, targetVol, scale, actualVol },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Minimum Variance (§7)
// Minimizes portfolio variance (closed-form for diagonal covariance).
// ─────────────────────────────────────────────────────────────────────────────

export class MinimumVarianceOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'MINIMUM_VARIANCE'

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const weights = new Map<string, number>()
    const warnings: string[] = []

    if (aggregates.size === 0) {
      return { method: this.method, weights, expectedReturn: 0, expectedVolatility: 0, allocationConfidence: 0, metadata: {}, warnings }
    }

    // Min-variance (diagonal approx): w_i ∝ 1/σ_i^2
    let totalInvVar = 0
    const invVars = new Map<string, number>()
    for (const [key] of aggregates) {
      const meta = input.assetMetadata.get(key)
      const vol = meta?.volatility ?? 0.5
      const invVar = 1 / Math.max(0.0001, vol * vol)
      invVars.set(key, invVar)
      totalInvVar += invVar
    }

    for (const [key, agg] of aggregates) {
      const invVar = invVars.get(key) ?? 0
      let w = invVar / totalInvVar
      if (input.configuration.uncertaintyAware.enabled) {
        const penalty = Math.max(0, Math.min(0.9,
          agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight +
          agg.aleatoricUncertainty * input.configuration.uncertaintyAware.aleatoricPenaltyWeight,
        ))
        w *= (1 - penalty)
      }
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, w * direction)
    }

    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let totalAbs = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) weightedVol += Math.abs(w) * meta.volatility
      confidenceSum += agg.decisionConfidence * Math.abs(w)
      totalAbs += Math.abs(w)
    }

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence: totalAbs > 0 ? confidenceSum / totalAbs : 0,
      metadata: { totalInvVar },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Mean-Variance Optimization (§7)
// Markowitz: maximize w'μ - (λ/2) w'Σw
// Closed-form for diagonal Σ.
// ─────────────────────────────────────────────────────────────────────────────

export class MeanVarianceOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'MEAN_VARIANCE'
  constructor(private riskAversion: number = 2.0) {}

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const weights = new Map<string, number>()
    const warnings: string[] = []

    if (aggregates.size === 0) {
      return { method: this.method, weights, expectedReturn: 0, expectedVolatility: 0, allocationConfidence: 0, metadata: {}, warnings }
    }

    // Closed-form for diagonal Σ: w_i ∝ μ_i / (λ * σ_i^2)
    let totalRaw = 0
    const rawWeights = new Map<string, number>()
    for (const [key, agg] of aggregates) {
      const meta = input.assetMetadata.get(key)
      const vol = meta?.volatility ?? 0.5
      const mu = agg.expectedReturn || (agg.decisionStrength * 0.05) // estimate
      const w = mu / (this.riskAversion * Math.max(0.0001, vol * vol))
      rawWeights.set(key, w)
      totalRaw += Math.abs(w)
    }

    if (totalRaw === 0) {
      warnings.push('zero raw weights — falling back to equal weight')
      return new EqualWeightOptimizer().optimize(input)
    }

    for (const [key, agg] of aggregates) {
      const raw = rawWeights.get(key) ?? 0
      let w = raw / totalRaw
      if (input.configuration.uncertaintyAware.enabled) {
        const penalty = Math.max(0, Math.min(0.9,
          agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight +
          agg.aleatoricUncertainty * input.configuration.uncertaintyAware.aleatoricPenaltyWeight,
        ))
        w *= (1 - penalty)
      }
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, w * direction)
    }

    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let totalAbs = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) weightedVol += Math.abs(w) * meta.volatility
      confidenceSum += agg.decisionConfidence * Math.abs(w)
      totalAbs += Math.abs(w)
    }

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence: totalAbs > 0 ? confidenceSum / totalAbs : 0,
      metadata: { riskAversion: this.riskAversion, totalRaw },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Maximum Diversification (§7)
// Maximizes the diversification ratio: (w'σ) / sqrt(w'Σw)
// ─────────────────────────────────────────────────────────────────────────────

export class MaximumDiversificationOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'MAXIMUM_DIVERSIFICATION'

  optimize(input: OptimizationInput): OptimizationResult {
    // Max diversification (diagonal approx): w_i ∝ 1/σ_i (same as ERC)
    // The difference is the objective function, but for diagonal Σ the
    // solution converges to inverse-volatility weighting.
    const ercResult = new ERCOptimizer().optimize(input)
    return {
      ...ercResult,
      method: this.method,
      metadata: { ...ercResult.metadata, diversificationRatio: ercResult.expectedVolatility > 0 ? 1 / ercResult.expectedVolatility : 0 },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Uncertainty-Aware (§7.1)
// Explicit uncertainty-penalized optimization (extends any base method).
// Higher epistemic uncertainty → proportionally reduced allocation.
// Prediction uncertainty NEVER increases allocation (Rule 10).
// ─────────────────────────────────────────────────────────────────────────────

export class UncertaintyAwareOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'UNCERTAINTY_AWARE'
  constructor(private baseOptimizer: PortfolioMethodOptimizer = new MeanVarianceOptimizer()) {}

  optimize(input: OptimizationInput): OptimizationResult {
    // Force uncertainty-aware configuration
    const uncertaintyInput: OptimizationInput = {
      ...input,
      configuration: {
        ...input.configuration,
        uncertaintyAware: { ...input.configuration.uncertaintyAware, enabled: true },
      },
    }
    const baseResult = this.baseOptimizer.optimize(uncertaintyInput)

    // Additional explicit uncertainty penalty on top of base
    const aggregates = aggregateDecisions(input.decisions)
    const adjustedWeights = new Map<string, number>()
    let totalReduction = 0

    for (const [key, w] of baseResult.weights) {
      const agg = aggregates.get(key)
      if (!agg) {
        adjustedWeights.set(key, w)
        continue
      }
      // §7.1 — proportional reduction based on epistemic uncertainty
      const epistemicPenalty = Math.max(0, Math.min(0.95,
        agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight * 2,
      ))
      // Rule 10 — NEVER increase. (1 - penalty) is always ≤ 1.
      const adjustedW = w * (1 - epistemicPenalty)
      adjustedWeights.set(key, adjustedW)
      totalReduction += Math.abs(w - adjustedW)
    }

    log.debug(`UncertaintyAware: total reduction ${totalReduction.toFixed(4)} (Rule 10: never increased)`)

    return {
      ...baseResult,
      method: this.method,
      weights: adjustedWeights,
      metadata: { ...baseResult.metadata, baseMethod: this.baseOptimizer.method, totalReduction },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Liquidity-Constrained (§7.2)
// Reduces allocations exceeding participation rate / depth limits (§13, Rule 13).
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidityConstrainedOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'LIQUIDITY_CONSTRAINED'
  constructor(private baseOptimizer: PortfolioMethodOptimizer = new EqualWeightOptimizer()) {}

  optimize(input: OptimizationInput): OptimizationResult {
    const baseResult = this.baseOptimizer.optimize(input)
    const aggregates = aggregateDecisions(input.decisions)
    const adjustedWeights = new Map<string, number>()
    const warnings: string[] = [...baseResult.warnings]

    const maxParticipation = input.configuration.constraints.maxParticipationRate
    const maxDepthUtil = input.configuration.constraints.maxOrderBookDepthUtilization

    for (const [key, w] of baseResult.weights) {
      const meta = input.assetMetadata.get(key)
      if (!meta) {
        adjustedWeights.set(key, w)
        continue
      }

      const capitalAllocated = Math.abs(w) * input.totalNav
      // §7.2 — Participation rate: |capital| / ADDV ≤ maxParticipation
      const participationRate = meta.averageDailyDollarVolume > 0
        ? capitalAllocated / meta.averageDailyDollarVolume
        : 0
      // §7.2 — Order book depth utilization
      const depthUtilization = meta.orderBookDepth > 0
        ? capitalAllocated / meta.orderBookDepth
        : 0

      let scale = 1
      if (participationRate > maxParticipation) {
        scale = Math.min(scale, maxParticipation / Math.max(0.001, participationRate))
        warnings.push(`${key}: participation ${participationRate.toFixed(3)} > ${maxParticipation} — reduced`)
      }
      if (depthUtilization > maxDepthUtil) {
        scale = Math.min(scale, maxDepthUtil / Math.max(0.001, depthUtilization))
        warnings.push(`${key}: depth utilization ${depthUtilization.toFixed(3)} > ${maxDepthUtil} — reduced`)
      }

      // §13, Rule 13 — Allocations exceeding liquidity thresholds reduced before publication
      adjustedWeights.set(key, w * scale)
    }

    return {
      ...baseResult,
      method: this.method,
      weights: adjustedWeights,
      metadata: { ...baseResult.metadata, baseMethod: this.baseOptimizer.method, liquidityAdjustments: warnings.length },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Transaction Cost-Aware (§7.3)
// Maximizes risk-adjusted return AFTER estimated transaction costs.
// ─────────────────────────────────────────────────────────────────────────────

export class TransactionCostAwareOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'TRANSACTION_COST_AWARE'
  constructor(private baseOptimizer: PortfolioMethodOptimizer = new MeanVarianceOptimizer()) {}

  optimize(input: OptimizationInput): OptimizationResult {
    const baseResult = this.baseOptimizer.optimize(input)
    const aggregates = aggregateDecisions(input.decisions)
    const adjustedWeights = new Map<string, number>()
    const warnings: string[] = [...baseResult.warnings]

    let totalTransactionCost = 0

    for (const [key, w] of baseResult.weights) {
      const meta = input.assetMetadata.get(key)
      if (!meta) {
        adjustedWeights.set(key, w)
        continue
      }

      const capitalAllocated = Math.abs(w) * input.totalNav
      // §7.3 — Transaction cost components
      const commissionCost = capitalAllocated * meta.commissionRate
      const feeCost = capitalAllocated * meta.exchangeFee
      const spreadCost = capitalAllocated * meta.bidAskSpread * 0.5 // half-spread

      let marketImpactCost = 0
      let slippageCost = 0
      if (input.configuration.transactionCostAware.includeMarketImpact) {
        // Square-root impact model
        const participationRate = meta.averageDailyDollarVolume > 0
          ? capitalAllocated / meta.averageDailyDollarVolume
          : 0
        marketImpactCost = capitalAllocated * input.configuration.transactionCostAware.marketImpactCoefficient * Math.sqrt(participationRate)
      }
      if (input.configuration.transactionCostAware.includeSlippage) {
        slippageCost = capitalAllocated * input.configuration.transactionCostAware.slippageCoefficient * meta.bidAskSpread
      }

      const totalCost = commissionCost + feeCost + spreadCost + marketImpactCost + slippageCost
      const costFraction = capitalAllocated > 0 ? totalCost / capitalAllocated : 0
      totalTransactionCost += totalCost

      // §7.3 — Reduce allocation if transaction costs exceed threshold
      const maxCostFraction = 0.005 // 50 bps threshold
      let scale = 1
      if (costFraction > maxCostFraction) {
        scale = Math.max(0.1, 1 - (costFraction - maxCostFraction))
        warnings.push(`${key}: transaction cost ${(costFraction * 100).toFixed(2)} bps > threshold — scaled by ${scale.toFixed(2)}`)
      }

      adjustedWeights.set(key, w * scale)
    }

    return {
      ...baseResult,
      method: this.method,
      weights: adjustedWeights,
      metadata: {
        ...baseResult.metadata,
        baseMethod: this.baseOptimizer.method,
        totalTransactionCost,
        costAsFractionOfNav: input.totalNav > 0 ? totalTransactionCost / input.totalNav : 0,
      },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Multi-Objective (§7.4)
// Combines multiple objectives via weighted aggregation.
// ─────────────────────────────────────────────────────────────────────────────

export class MultiObjectiveOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'MULTI_OBJECTIVE'

  optimize(input: OptimizationInput): OptimizationResult {
    const aggregates = aggregateDecisions(input.decisions)
    const weights = new Map<string, number>()
    const warnings: string[] = []

    if (aggregates.size === 0) {
      return { method: this.method, weights, expectedReturn: 0, expectedVolatility: 0, allocationConfidence: 0, metadata: {}, warnings }
    }

    // Compute per-asset scores for each objective
    const objectives = input.configuration.multiObjective.objectives
    if (objectives.length === 0) {
      warnings.push('no objectives configured — falling back to equal weight')
      return new EqualWeightOptimizer().optimize(input)
    }

    const totalWeight = objectives.reduce((s, o) => s + o.weight, 0)
    if (totalWeight === 0) {
      warnings.push('zero total objective weight — falling back to equal weight')
      return new EqualWeightOptimizer().optimize(input)
    }

    // Per-asset composite score
    const scores = new Map<string, number>()
    for (const [key, agg] of aggregates) {
      const meta = input.assetMetadata.get(key)
      let score = 0
      for (const obj of objectives) {
        const normalizedWeight = obj.weight / totalWeight
        switch (obj.objective) {
          case 'EXPECTED_RETURN_MAX':
            score += normalizedWeight * Math.max(0, agg.expectedReturn || agg.decisionStrength * 0.05)
            break
          case 'PORTFOLIO_RISK_MIN': {
            const vol = meta?.volatility ?? 0.5
            score += normalizedWeight * (1 - Math.min(1, vol))
            break
          }
          case 'DIVERSIFICATION_MAX':
            score += normalizedWeight * 0.5 // placeholder
            break
          case 'LIQUIDITY_PRESERVATION': {
            const liq = meta?.liquidityScore ?? 0.5
            score += normalizedWeight * liq
            break
          }
          case 'CAPITAL_EFFICIENCY':
            score += normalizedWeight * agg.decisionConfidence
            break
          case 'STRATEGY_BALANCE':
            score += normalizedWeight * 0.5 // placeholder
            break
          case 'EXPOSURE_CONTROL':
            score += normalizedWeight * (1 - Math.abs(agg.exposureFraction))
            break
          case 'TRANSACTION_COST_MIN': {
            const cost = (meta?.commissionRate ?? 0) + (meta?.exchangeFee ?? 0) + (meta?.bidAskSpread ?? 0)
            score += normalizedWeight * (1 - Math.min(1, cost * 100))
            break
          }
          case 'UNCERTAINTY_REDUCTION':
            score += normalizedWeight * (1 - agg.epistemicUncertainty)
            break
          case 'REGULATORY_COMPLIANCE':
            score += normalizedWeight * 0.8 // placeholder
            break
        }
      }
      scores.set(key, Math.max(0, score))
    }

    // Normalize scores to weights
    let totalScore = 0
    for (const s of scores.values()) totalScore += s

    if (totalScore === 0) {
      warnings.push('zero total score — equal weight fallback')
      return new EqualWeightOptimizer().optimize(input)
    }

    for (const [key, agg] of aggregates) {
      const score = scores.get(key) ?? 0
      const w = score / totalScore
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, w * direction)
    }

    let expectedReturn = 0
    let weightedVol = 0
    let confidenceSum = 0
    let totalAbs = 0
    for (const [key, w] of weights) {
      const agg = aggregates.get(key)!
      expectedReturn += w * agg.expectedReturn
      const meta = input.assetMetadata.get(key)
      if (meta) weightedVol += Math.abs(w) * meta.volatility
      confidenceSum += agg.decisionConfidence * Math.abs(w)
      totalAbs += Math.abs(w)
    }

    return {
      method: this.method,
      weights,
      expectedReturn,
      expectedVolatility: weightedVol,
      allocationConfidence: totalAbs > 0 ? confidenceSum / totalAbs : 0,
      metadata: { objectives: objectives.map(o => ({ objective: o.objective, weight: o.weight })), totalScore },
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Hierarchical Risk Parity (HRP) (§7)
// Simplified HRP — uses inverse-volatility weighting as approximation.
// Full HRP would require hierarchical clustering + recursive bisection.
// ─────────────────────────────────────────────────────────────────────────────

export class HRPOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'HIERARCHICAL_RISK_PARITY'

  optimize(input: OptimizationInput): OptimizationResult {
    // HRP approximation via inverse-volatility weighting
    // (Full HRP requires covariance matrix + hierarchical clustering)
    const ercResult = new ERCOptimizer().optimize(input)
    return {
      ...ercResult,
      method: this.method,
      metadata: { ...ercResult.metadata, hrpApproximation: true },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Black-Litterman (§7)
// Simplified Black-Litterman — uses confidence-weighted views.
// ─────────────────────────────────────────────────────────────────────────────

export class BlackLittermanOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'BLACK_LITTERMAN'

  optimize(input: OptimizationInput): OptimizationResult {
    // Simplified: blend "market prior" (equal weight) with "views" (decision confidence)
    const aggregates = aggregateDecisions(input.decisions)
    const weights = new Map<string, number>()
    const n = aggregates.size

    if (n === 0) {
      return { method: this.method, weights, expectedReturn: 0, expectedVolatility: 0, allocationConfidence: 0, metadata: {}, warnings: [] }
    }

    const priorWeight = 1 / n
    const viewWeight = 0.5 // confidence in views

    for (const [key, agg] of aggregates) {
      // Blend prior with confidence-weighted view
      const view = priorWeight * (1 + (agg.decisionConfidence - 0.5)) // shift by confidence
      let w = priorWeight * (1 - viewWeight) + view * viewWeight
      if (input.configuration.uncertaintyAware.enabled) {
        const penalty = Math.max(0, Math.min(0.9,
          agg.epistemicUncertainty * input.configuration.uncertaintyAware.epistemicPenaltyWeight,
        ))
        w *= (1 - penalty)
      }
      const direction = agg.direction === 'SHORT' ? -1 : agg.direction === 'NEUTRAL' ? 0 : 1
      weights.set(key, w * direction)
    }

    // Normalize
    let totalAbs = 0
    for (const w of weights.values()) totalAbs += Math.abs(w)
    if (totalAbs > 0) {
      for (const [k, w] of weights) weights.set(k, w / totalAbs)
    }

    return {
      method: this.method,
      weights,
      expectedReturn: 0,
      expectedVolatility: 0,
      allocationConfidence: 0.7,
      metadata: { viewWeight, priorWeight },
      warnings: [],
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. Bayesian (§7)
// Bayesian updating of prior with new evidence.
// ─────────────────────────────────────────────────────────────────────────────

export class BayesianOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'BAYESIAN'

  optimize(input: OptimizationInput): OptimizationResult {
    // Simplified: treat decision confidence as posterior probability
    const bl = new BlackLittermanOptimizer().optimize(input)
    return { ...bl, method: this.method, metadata: { ...bl.metadata, bayesian: true } }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. Expected Utility (§7)
// Maximizes expected utility (e.g., mean-variance utility with risk aversion).
// ─────────────────────────────────────────────────────────────────────────────

export class ExpectedUtilityOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'EXPECTED_UTILITY'
  constructor(private riskAversion: number = 2.0) {}

  optimize(input: OptimizationInput): OptimizationResult {
    // Same as mean-variance for CRRA utility
    const mv = new MeanVarianceOptimizer(this.riskAversion).optimize(input)
    return { ...mv, method: this.method, metadata: { ...mv.metadata, utilityFunction: 'CRRA', riskAversion: this.riskAversion } }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 17. Custom (§7)
// User-defined optimization framework.
// ─────────────────────────────────────────────────────────────────────────────

export class CustomOptimizer implements PortfolioMethodOptimizer {
  method: PortfolioMethod = 'CUSTOM'
  constructor(private optimizeFn: (input: OptimizationInput) => OptimizationResult) {}

  optimize(input: OptimizationInput): OptimizationResult {
    return this.optimizeFn(input)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimizer Registry (§7.5 — versioned, governed)
// ─────────────────────────────────────────────────────────────────────────────

export class OptimizerRegistry {
  private optimizers = new Map<PortfolioMethod, PortfolioMethodOptimizer>()

  constructor() {
    // Register defaults
    this.register(new EqualWeightOptimizer())
    this.register(new MarketCapWeightOptimizer())
    this.register(new ERCOptimizer())
    this.register(new RiskParityOptimizer())
    this.register(new MinimumVarianceOptimizer())
    this.register(new MeanVarianceOptimizer())
    this.register(new MaximumDiversificationOptimizer())
    this.register(new UncertaintyAwareOptimizer())
    this.register(new LiquidityConstrainedOptimizer())
    this.register(new TransactionCostAwareOptimizer())
    this.register(new MultiObjectiveOptimizer())
    this.register(new HRPOptimizer())
    this.register(new BlackLittermanOptimizer())
    this.register(new BayesianOptimizer())
    this.register(new ExpectedUtilityOptimizer())
  }

  register(optimizer: PortfolioMethodOptimizer): void {
    this.optimizers.set(optimizer.method, optimizer)
    log.info(`registered optimizer: ${optimizer.method}`)
  }

  get(method: PortfolioMethod): PortfolioMethodOptimizer | null {
    return this.optimizers.get(method) ?? null
  }

  listMethods(): PortfolioMethod[] {
    return Array.from(this.optimizers.keys())
  }
}

export const optimizerRegistry = new OptimizerRegistry()
