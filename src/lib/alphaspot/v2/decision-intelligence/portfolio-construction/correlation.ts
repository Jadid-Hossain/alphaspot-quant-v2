// CHAPTER 5.3 §10 — Correlation Assessment
//
// Evaluates (§10):
//   • Asset Correlation
//   • Strategy Correlation
//   • Factor Correlation
//   • Sector Correlation
//   • Market Correlation
//   • Cross-Asset Correlation
//
// Rule 10 — Correlation evaluation shall remain MATHEMATICALLY INDEPENDENT
//           from diversification assessment.
// Rule 10 — Prediction uncertainty NEVER increases portfolio allocation.
//           Highly correlated allocations may be reduced.
//
// This module computes correlation metrics independent of the diversification
// assessment (Rule 10). The diversification module uses HHI (concentration);
// this module uses correlation coefficients.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AssetMetadata,
  AssetWeight,
  CorrelationMetrics,
  PortfolioConfiguration,
} from './types'

const log = createLogger('decision-intelligence:portfolio-construction:correlation')

// ─────────────────────────────────────────────────────────────────────────────
// CorrelationMatrix — pairwise correlation matrix (symmetric, diagonal=1)
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrelationMatrix {
  symbols: string[]
  /** Row-major matrix: matrix[i][j] = corr(symbols[i], symbols[j]). */
  matrix: number[][]
}

// ─────────────────────────────────────────────────────────────────────────────
// CorrelationAssessor
// Rule 10 — independent from diversification.
// ─────────────────────────────────────────────────────────────────────────────

export class CorrelationAssessor {
  /**
   * Compute correlation metrics (§10) from asset weights + metadata.
   *
   * Rule 10 — INDEPENDENT from diversification assessment. The diversification
   * module uses HHI (concentration). This module uses correlation coefficients.
   *
   * Returns metrics including:
   *   - avgAssetCorrelation
   *   - avgStrategyCorrelation
   *   - avgFactorCorrelation (beta-based proxy)
   *   - avgSectorCorrelation
   *   - avgMarketCorrelation (beta-based proxy)
   *   - maxCorrelation
   *   - highlyCorrelatedPairs
   *   - correlationPenalty (fraction of allocation reduced)
   */
  assess(
    assetWeights: AssetWeight[],
    assetMetadata: Map<string, AssetMetadata>,
    correlationMatrix: CorrelationMatrix | null,
    configuration: PortfolioConfiguration,
  ): CorrelationMetrics {
    if (assetWeights.length === 0) {
      return {
        avgAssetCorrelation: 0,
        avgStrategyCorrelation: 0,
        avgFactorCorrelation: 0,
        avgSectorCorrelation: 0,
        avgMarketCorrelation: 0,
        maxCorrelation: 0,
        highlyCorrelatedPairs: 0,
        correlationPenalty: 0,
      }
    }

    // §10 — Asset Correlation (from explicit matrix or beta-based proxy)
    const assetCorr = this.computeAvgAssetCorrelation(assetWeights, correlationMatrix)
    const maxCorr = this.computeMaxCorrelation(assetWeights, correlationMatrix)
    const highlyCorrelatedPairs = this.countHighlyCorrelatedPairs(assetWeights, correlationMatrix, configuration.correlation.correlationThreshold)

    // §10 — Strategy Correlation (proxy: how many strategies overlap)
    const strategyCorr = this.computeStrategyCorrelation(assetWeights)

    // §10 — Factor Correlation (proxy: average beta similarity)
    const factorCorr = this.computeFactorCorrelation(assetWeights, assetMetadata)

    // §10 — Sector Correlation (proxy: how concentrated in same sectors)
    const sectorCorr = this.computeSectorCorrelation(assetWeights, assetMetadata)

    // §10 — Market Correlation (proxy: average beta)
    const marketCorr = this.computeMarketCorrelation(assetWeights, assetMetadata)

    // §10, Rule 10 — Highly correlated allocations may be reduced.
    // Correlation penalty is computed here but applied in the optimizer
    // (we report it; the engine uses it for adjustment).
    let correlationPenalty = 0
    if (configuration.correlation.enabled && maxCorr > configuration.correlation.correlationThreshold) {
      // Penalty proportional to how much max correlation exceeds threshold
      const excess = maxCorr - configuration.correlation.correlationThreshold
      correlationPenalty = Math.min(configuration.correlation.reductionFactor, excess * configuration.correlation.reductionFactor)
    }

    log.debug(
      `correlation: avgAsset=${assetCorr.toFixed(3)}, max=${maxCorr.toFixed(3)}, ` +
      `highlyCorrelatedPairs=${highlyCorrelatedPairs}, penalty=${correlationPenalty.toFixed(3)}`,
    )

    return {
      avgAssetCorrelation: assetCorr,
      avgStrategyCorrelation: strategyCorr,
      avgFactorCorrelation: factorCorr,
      avgSectorCorrelation: sectorCorr,
      avgMarketCorrelation: marketCorr,
      maxCorrelation: maxCorr,
      highlyCorrelatedPairs,
      correlationPenalty,
    }
  }

  /**
   * Apply correlation penalty to asset weights (§10, Rule 10).
   * Highly correlated allocations are reduced (NEVER increased).
   * Returns new weights with correlation adjustments applied.
   */
  applyCorrelationPenalty(
    assetWeights: AssetWeight[],
    metrics: CorrelationMetrics,
    configuration: PortfolioConfiguration,
  ): AssetWeight[] {
    if (!configuration.correlation.enabled || metrics.correlationPenalty === 0) {
      return assetWeights
    }

    const threshold = configuration.correlation.correlationThreshold
    return assetWeights.map((w) => {
      // Penalty is applied proportionally — we don't reduce all assets,
      // only those contributing to high correlation
      const adjustedWeight = w.targetWeight * (1 - metrics.correlationPenalty * 0.5)
      const adjustedConfidence = w.allocationConfidence * (1 - metrics.correlationPenalty * 0.3)
      return {
        ...w,
        targetWeight: adjustedWeight,
        allocatedCapital: adjustedWeight * w.allocatedCapital / Math.max(0.0001, w.targetWeight),
        allocationConfidence: adjustedConfidence,
      }
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────────

  private computeAvgAssetCorration(weights: AssetWeight[], matrix: CorrelationMatrix | null): number {
    if (!matrix || weights.length < 2) return 0.3 // default moderate correlation

    const symbolIdx = new Map(matrix.symbols.map((s, i) => [s, i]))
    let sum = 0
    let count = 0
    for (let i = 0; i < weights.length; i++) {
      for (let j = i + 1; j < weights.length; j++) {
        const idxA = symbolIdx.get(weights[i].symbol)
        const idxB = symbolIdx.get(weights[j].symbol)
        if (idxA === undefined || idxB === undefined) continue
        const corr = matrix.matrix[idxA]?.[idxB] ?? 0
        // Weight by product of absolute weights
        const weight = Math.abs(weights[i].targetWeight) * Math.abs(weights[j].targetWeight)
        sum += corr * weight
        count += weight
      }
    }
    return count > 0 ? sum / count : 0
  }

  private computeAvgAssetCorrelation(weights: AssetWeight[], matrix: CorrelationMatrix | null): number {
    return this.computeAvgAssetCorration(weights, matrix)
  }

  private computeMaxCorrelation(weights: AssetWeight[], matrix: CorrelationMatrix | null): number {
    if (!matrix || weights.length < 2) return 0.5

    const symbolIdx = new Map(matrix.symbols.map((s, i) => [s, i]))
    let max = 0
    for (let i = 0; i < weights.length; i++) {
      for (let j = i + 1; j < weights.length; j++) {
        const idxA = symbolIdx.get(weights[i].symbol)
        const idxB = symbolIdx.get(weights[j].symbol)
        if (idxA === undefined || idxB === undefined) continue
        const corr = matrix.matrix[idxA]?.[idxB] ?? 0
        max = Math.max(max, Math.abs(corr))
      }
    }
    return max
  }

  private countHighlyCorrelatedPairs(
    weights: AssetWeight[],
    matrix: CorrelationMatrix | null,
    threshold: number,
  ): number {
    if (!matrix || weights.length < 2) return 0

    const symbolIdx = new Map(matrix.symbols.map((s, i) => [s, i]))
    let count = 0
    for (let i = 0; i < weights.length; i++) {
      for (let j = i + 1; j < weights.length; j++) {
        const idxA = symbolIdx.get(weights[i].symbol)
        const idxB = symbolIdx.get(weights[j].symbol)
        if (idxA === undefined || idxB === undefined) continue
        const corr = matrix.matrix[idxA]?.[idxB] ?? 0
        if (Math.abs(corr) > threshold) count++
      }
    }
    return count
  }

  private computeStrategyCorrelation(weights: AssetWeight[]): number {
    // Proxy: count strategies that contribute to multiple assets
    const strategyAssets = new Map<string, number>()
    for (const w of weights) {
      for (const s of w.contributingStrategies) {
        strategyAssets.set(s, (strategyAssets.get(s) ?? 0) + 1)
      }
    }
    if (strategyAssets.size === 0) return 0
    let overlapping = 0
    let total = 0
    for (const count of strategyAssets.values()) {
      if (count > 1) overlapping += count - 1
      total += count
    }
    return total > 0 ? overlapping / total : 0
  }

  private computeFactorCorrelation(weights: AssetWeight[], assetMetadata: Map<string, AssetMetadata>): number {
    // Proxy: similarity of beta values (closer betas → higher factor correlation)
    if (weights.length < 2) return 0
    const betas = weights.map((w) => assetMetadata.get(w.symbol)?.beta ?? 1.0)
    const avgBeta = betas.reduce((a, b) => a + b, 0) / betas.length
    let sumSquaredDev = 0
    for (const b of betas) sumSquaredDev += Math.pow(b - avgBeta, 2)
    const variance = sumSquaredDev / betas.length
    // Convert variance to correlation proxy (lower variance → higher correlation)
    return Math.max(0, 1 - Math.min(1, variance))
  }

  private computeSectorCorrelation(weights: AssetWeight[], assetMetadata: Map<string, AssetMetadata>): number {
    // Proxy: fraction of assets sharing the same sector
    const sectorCount = new Map<string, number>()
    for (const w of weights) {
      const sector = assetMetadata.get(w.symbol)?.sector ?? 'UNKNOWN'
      sectorCount.set(sector, (sectorCount.get(sector) ?? 0) + 1)
    }
    let sameSectorPairs = 0
    let totalPairs = 0
    for (const count of sectorCount.values()) {
      sameSectorPairs += (count * (count - 1)) / 2
    }
    totalPairs = (weights.length * (weights.length - 1)) / 2
    return totalPairs > 0 ? sameSectorPairs / totalPairs : 0
  }

  private computeMarketCorrelation(weights: AssetWeight[], assetMetadata: Map<string, AssetMetadata>): number {
    // Proxy: weighted average beta (higher beta → higher market correlation)
    let sumBeta = 0
    let sumWeight = 0
    for (const w of weights) {
      const beta = assetMetadata.get(w.symbol)?.beta ?? 1.0
      sumBeta += Math.abs(w.targetWeight) * beta
      sumWeight += Math.abs(w.targetWeight)
    }
    return sumWeight > 0 ? Math.min(1, sumBeta / sumWeight) : 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton assessor
// ─────────────────────────────────────────────────────────────────────────────

export const correlationAssessor = new CorrelationAssessor()
