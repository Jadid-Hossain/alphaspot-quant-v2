// CHAPTER 2.5 §6 — Confidence Governance
// CHAPTER 2.5 §7 — Model Performance Monitoring
// CHAPTER 2.5 §13 — Self-Evaluation Loop (evaluation stage)
//
// Confidence is NOT probability (§6). Confidence measures the model's trust
// in its own prediction. The platform continuously calibrates confidence
// against actual historical outcomes. Poorly calibrated confidence reduces
// recommendation priority (§6).
//
// Performance monitoring (§7) over rolling evaluation windows:
//   prediction accuracy, directional accuracy, precision, recall,
//   calibration quality, expected value realization, win rate, loss rate,
//   average return, average drawdown.

import { createLogger } from '../../domains/01-core-infrastructure'
import { predictionTraceability, type TraceablePrediction } from './prediction-traceability'

const log = createLogger('ai-governance:performance')

// ─────────────────────────────────────────────────────────────────────────────
// Rolling-window performance metrics  (Chapter 2.5 §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface RollingPerformanceMetrics {
  modelId: string
  windowMs: number
  evaluatedAt: number
  sampleSize: number

  // §7 metrics
  predictionAccuracy: number // correct outcome / total
  directionalAccuracy: number // correct direction / total
  precision: number // true wins / predicted wins
  recall: number // true wins / actual wins
  calibrationQuality: number // 1 - |predicted_prob - actual_freq|
  expectedValueRealization: number // actual EV / predicted EV
  winRate: number
  lossRate: number
  averageReturnPct: number
  averageDrawdownPct: number
  sharpeRatio: number | null

  // Confidence calibration (§6)
  confidenceCalibration: number // how well confidence correlates with accuracy
  confidenceDecay: number // multiplier applied to future confidence (§6 — poorly calibrated → reduced priority)
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Monitor  (Chapter 2.5 §7)
// ─────────────────────────────────────────────────────────────────────────────

class PerformanceMonitor {
  private history = new Map<string, RollingPerformanceMetrics[]>() // modelId → history
  private readonly historyLimit = 500
  private subscribers = new Set<(metrics: RollingPerformanceMetrics) => void>()

  /** Compute rolling performance metrics for a model over a time window (§7). */
  evaluate(modelId: string, windowMs: number = 7 * 24 * 60 * 60 * 1000): RollingPerformanceMetrics {
    const cutoff = Date.now() - windowMs
    const predictions = predictionTraceability.getByModel(modelId).filter(
      (p) => p.predictionTimestamp >= cutoff && p.outcome !== null,
    )

    const sampleSize = predictions.length
    if (sampleSize === 0) {
      return this.emptyMetrics(modelId, windowMs)
    }

    let correctDirection = 0
    let trueWins = 0
    let predictedWins = 0
    let actualWins = 0
    let totalReturn = 0
    let totalDrawdown = 0
    let returns: number[] = []
    let confidenceCorrectSum = 0
    let evPredictedSum = 0
    let evRealizedSum = 0

    for (const p of predictions) {
      const outcome = p.outcome!
      const predictedPositive = p.expectedValue > 0
      const actualPositive = outcome.actualReturnPct > 0
      if (predictedPositive === actualPositive) correctDirection++

      if (predictedPositive) predictedWins++
      if (actualPositive) {
        actualWins++
        if (predictedPositive) trueWins++
      }

      totalReturn += outcome.actualReturnPct
      totalDrawdown += outcome.actualDrawdownPct
      returns.push(outcome.actualReturnPct)

      // Confidence calibration: did higher-confidence predictions have better outcomes?
      if ((p.confidence > 0.6 && outcome.outcome === 'WIN') || (p.confidence < 0.4 && outcome.outcome !== 'WIN')) {
        confidenceCorrectSum++
      }
      evPredictedSum += p.expectedValue
      evRealizedSum += outcome.actualReturnPct
    }

    const wins = predictions.filter((p) => p.outcome!.outcome === 'WIN').length
    const losses = predictions.filter((p) => p.outcome!.outcome === 'LOSS').length

    // Sharpe ratio (simplified): mean return / std return
    const meanReturn = totalReturn / sampleSize
    const variance = returns.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / sampleSize
    const stdReturn = Math.sqrt(variance)
    const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : null // annualized (daily equivalent)

    // Calibration quality: how close predicted probability was to actual frequency
    const avgConfidence = predictions.reduce((a, p) => a + p.confidence, 0) / sampleSize
    const actualWinFreq = wins / sampleSize
    const calibrationQuality = Math.max(0, 1 - Math.abs(avgConfidence - actualWinFreq))

    // Expected value realization
    const expectedValueRealization = evPredictedSum !== 0 ? evRealizedSum / Math.abs(evPredictedSum) : 0

    // Confidence calibration (§6) — fraction of predictions where confidence matched outcome
    const confidenceCalibration = confidenceCorrectSum / sampleSize

    // Confidence decay (§6): poorly calibrated confidence reduces priority
    // If calibration < 0.5, apply a decay multiplier
    const confidenceDecay = confidenceCalibration >= 0.6 ? 1.0 : confidenceCalibration >= 0.4 ? 0.8 : 0.5

    const metrics: RollingPerformanceMetrics = {
      modelId,
      windowMs,
      evaluatedAt: Date.now(),
      sampleSize,
      predictionAccuracy: wins / sampleSize,
      directionalAccuracy: correctDirection / sampleSize,
      precision: predictedWins > 0 ? trueWins / predictedWins : 0,
      recall: actualWins > 0 ? trueWins / actualWins : 0,
      calibrationQuality,
      expectedValueRealization,
      winRate: wins / sampleSize,
      lossRate: losses / sampleSize,
      averageReturnPct: totalReturn / sampleSize,
      averageDrawdownPct: totalDrawdown / sampleSize,
      sharpeRatio,
      confidenceCalibration,
      confidenceDecay,
    }

    // Store in history
    const hist = this.history.get(modelId) ?? []
    hist.push(metrics)
    if (hist.length > this.historyLimit) hist.shift()
    this.history.set(modelId, hist)

    log.info(
      `performance [${modelId}] (n=${sampleSize}, ${windowMs / 86400000}d): accuracy=${metrics.predictionAccuracy.toFixed(2)}, dir=${metrics.directionalAccuracy.toFixed(2)}, win=${metrics.winRate.toFixed(2)}, EV realization=${metrics.expectedValueRealization.toFixed(2)}, calibration=${metrics.calibrationQuality.toFixed(2)}, decay=${metrics.confidenceDecay}`,
    )

    for (const sub of this.subscribers) sub(metrics)
    return metrics
  }

  /** Get the latest metrics for a model. */
  getLatest(modelId: string): RollingPerformanceMetrics | undefined {
    const hist = this.history.get(modelId)
    return hist?.[hist.length - 1]
  }

  /** Get the full history for a model (for trend analysis). */
  getHistory(modelId: string, limit = 50): RollingPerformanceMetrics[] {
    return (this.history.get(modelId) ?? []).slice(-limit)
  }

  /** Get the confidence decay multiplier for a model (§6 — reduces recommendation priority). */
  getConfidenceDecay(modelId: string): number {
    return this.getLatest(modelId)?.confidenceDecay ?? 1.0
  }

  private emptyMetrics(modelId: string, windowMs: number): RollingPerformanceMetrics {
    return {
      modelId, windowMs, evaluatedAt: Date.now(), sampleSize: 0,
      predictionAccuracy: 0, directionalAccuracy: 0, precision: 0, recall: 0,
      calibrationQuality: 0, expectedValueRealization: 0, winRate: 0, lossRate: 0,
      averageReturnPct: 0, averageDrawdownPct: 0, sharpeRatio: null,
      confidenceCalibration: 0, confidenceDecay: 1.0,
    }
  }

  subscribe(handler: (metrics: RollingPerformanceMetrics) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const performanceMonitor = new PerformanceMonitor()

// Re-export for convenience
export type { TraceablePrediction }
