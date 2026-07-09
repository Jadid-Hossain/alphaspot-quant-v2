// CHAPTER 2.5 §11, §11.1 — Shadow Evaluation & Promotion Policy
//
// New models initially operate silently (§11) — they generate predictions
// without influencing recommendations. Historical comparison determines
// whether the new model outperforms production.
//
// Promotion policy (§11.1):
//   • minimum evaluation duration (default 14 days)
//   • minimum completed paper trades (default 50)
//   • minimum statistical confidence
//   • minimum expected value improvement
//   • maximum allowable drawdown
//   • calibration quality requirements
// Promotion is NEVER automatic solely because of higher raw return (§11.1).
// Candidate must demonstrate superior RISK-ADJUSTED performance while
// maintaining acceptable calibration and governance metrics.
// Every promotion decision permanently recorded for auditability (§11.1).

import { createLogger } from '../../domains/01-core-infrastructure'
import { aiModelRegistry, type ExtendedModelArtifact } from './model-lifecycle'
import { performanceMonitor, type RollingPerformanceMetrics } from './performance-monitoring'
import { predictionTraceability } from './prediction-traceability'
import { governanceAlerts } from './governance-alerts'

const log = createLogger('ai-governance:shadow')

// ─────────────────────────────────────────────────────────────────────────────
// Promotion policy config  (Chapter 2.5 §11.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface PromotionPolicyConfig {
  minEvaluationDurationMs: number // §11.1 — default 14 days
  minCompletedPaperTrades: number // §11.1 — default 50
  minStatisticalConfidence: number // 0..1
  minExpectedValueImprovement: number // improvement over production EV realization
  maxAllowableDrawdownPct: number
  minCalibrationQuality: number
  minSharpeRatio: number | null
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicyConfig = {
  minEvaluationDurationMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  minCompletedPaperTrades: 50,
  minStatisticalConfidence: 0.6,
  minExpectedValueImprovement: 0.1, // 10% better EV realization
  maxAllowableDrawdownPct: -5.0,
  minCalibrationQuality: 0.7,
  minSharpeRatio: 0.5,
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow evaluation record
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowEvaluationRecord {
  shadowModelId: string
  productionModelId: string
  startedAt: number
  endedAt: number | null
  shadowPredictions: number
  productionPredictions: number
  shadowMetrics: RollingPerformanceMetrics | null
  productionMetrics: RollingPerformanceMetrics | null
  promotionEligible: boolean
  promotionDecision: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INCONCLUSIVE'
  rejectionReasons: string[]
  evaluationNotes: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow evaluation system  (Chapter 2.5 §11, §11.1)
// ─────────────────────────────────────────────────────────────────────────────

class ShadowEvaluationSystem {
  private config: PromotionPolicyConfig = { ...DEFAULT_PROMOTION_POLICY }
  private activeEvaluations = new Map<string, ShadowEvaluationRecord>() // shadowModelId → record
  private completedEvaluations: ShadowEvaluationRecord[] = []
  private subscribers = new Set<(record: ShadowEvaluationRecord) => void>()

  setConfig(patch: Partial<PromotionPolicyConfig>): void {
    this.config = { ...this.config, ...patch }
    log.info(`shadow promotion policy config updated`)
  }

  getConfig(): PromotionPolicyConfig {
    return { ...this.config }
  }

  /** Start shadow evaluation for a candidate model against production (§11). */
  startEvaluation(shadowModelId: string): ShadowEvaluationRecord {
    const shadow = aiModelRegistry.get(shadowModelId)
    if (!shadow) throw new Error(`[shadow] model "${shadowModelId}" not registered`)
    if (shadow.lifecycleState !== 'SHADOW_EVALUATION') {
      throw new Error(`[shadow] model "${shadowModelId}" must be in SHADOW_EVALUATION state (current: ${shadow.lifecycleState})`)
    }
    const production = aiModelRegistry.getActiveProduction()
    if (!production) throw new Error(`[shadow] no active production model to compare against`)

    const record: ShadowEvaluationRecord = {
      shadowModelId,
      productionModelId: production.modelId,
      startedAt: Date.now(),
      endedAt: null,
      shadowPredictions: 0,
      productionPredictions: 0,
      shadowMetrics: null,
      productionMetrics: null,
      promotionEligible: false,
      promotionDecision: 'PENDING',
      rejectionReasons: [],
      evaluationNotes: '',
    }
    this.activeEvaluations.set(shadowModelId, record)
    log.info(`shadow evaluation started: ${shadowModelId} vs ${production.modelId}`)
    predictionTraceability.audit({
      eventType: 'SHADOW_EVALUATION_STARTED',
      modelId: shadowModelId,
      predictionId: null,
      snapshotId: null,
      actor: 'ai-governance',
      decision: `Shadow evaluation of ${shadowModelId} against ${production.modelId}`,
      reasoning: 'New model enters silent shadow mode — predictions generated without influencing recommendations',
      metadata: { shadowModelId, productionModelId: production.modelId },
    })
    return record
  }

  /** Evaluate whether a shadow model is eligible for promotion (§11.1). */
  evaluatePromotion(shadowModelId: string): ShadowEvaluationRecord {
    const record = this.activeEvaluations.get(shadowModelId)
    if (!record) throw new Error(`[shadow] no active evaluation for "${shadowModelId}"`)

    const elapsed = Date.now() - record.startedAt
    const shadowMetrics = performanceMonitor.getLatest(shadowModelId)
    const productionMetrics = performanceMonitor.getLatest(record.productionModelId)
    record.shadowMetrics = shadowMetrics ?? null
    record.productionMetrics = productionMetrics ?? null
    record.shadowPredictions = predictionTraceability.getByModel(shadowModelId).length
    record.productionPredictions = productionMetrics?.sampleSize ?? 0

    const reasons: string[] = []

    // §11.1 checks — ALL must pass for promotion
    if (elapsed < this.config.minEvaluationDurationMs) {
      reasons.push(`Evaluation duration ${Math.floor(elapsed / 86400000)}d < minimum ${Math.floor(this.config.minEvaluationDurationMs / 86400000)}d`)
    }
    if (record.shadowPredictions < this.config.minCompletedPaperTrades) {
      reasons.push(`Completed trades ${record.shadowPredictions} < minimum ${this.config.minCompletedPaperTrades}`)
    }
    if (!shadowMetrics) {
      reasons.push('No shadow metrics available')
    } else {
      if (shadowMetrics.sampleSize < this.config.minCompletedPaperTrades) {
        reasons.push(`Sample size ${shadowMetrics.sampleSize} < minimum ${this.config.minCompletedPaperTrades}`)
      }
      // §11.1 — never promote solely on raw return. Must be superior RISK-ADJUSTED.
      if (shadowMetrics.sharpeRatio === null || (this.config.minSharpeRatio !== null && shadowMetrics.sharpeRatio < this.config.minSharpeRatio)) {
        reasons.push(`Sharpe ratio ${shadowMetrics.sharpeRatio} < minimum ${this.config.minSharpeRatio}`)
      }
      if (shadowMetrics.calibrationQuality < this.config.minCalibrationQuality) {
        reasons.push(`Calibration quality ${shadowMetrics.calibrationQuality.toFixed(2)} < minimum ${this.config.minCalibrationQuality}`)
      }
      if (shadowMetrics.averageDrawdownPct < this.config.maxAllowableDrawdownPct) {
        reasons.push(`Average drawdown ${shadowMetrics.averageDrawdownPct.toFixed(2)}% exceeds max ${this.config.maxAllowableDrawdownPct}%`)
      }
      // §11.1 — must demonstrate superior EV realization vs production
      if (productionMetrics && shadowMetrics.expectedValueRealization < productionMetrics.expectedValueRealization + this.config.minExpectedValueImprovement) {
        reasons.push(`EV realization ${shadowMetrics.expectedValueRealization.toFixed(2)} not sufficiently better than production ${productionMetrics.expectedValueRealization.toFixed(2)} (need +${this.config.minExpectedValueImprovement})`)
      }
    }

    record.rejectionReasons = reasons
    record.promotionEligible = reasons.length === 0
    record.promotionDecision = reasons.length === 0 ? 'APPROVED' : record.shadowPredictions < 10 ? 'INCONCLUSIVE' : 'REJECTED'
    record.endedAt = Date.now()

    if (record.promotionDecision === 'APPROVED') {
      log.info(`shadow promotion APPROVED: ${shadowModelId} — promoting to production`)
      predictionTraceability.audit({
        eventType: 'SHADOW_PROMOTION_APPROVED',
        modelId: shadowModelId,
        predictionId: null,
        snapshotId: null,
        actor: 'ai-governance',
        decision: `Promote ${shadowModelId} to production`,
        reasoning: `Passed all §11.1 checks: ${record.shadowPredictions} trades, Sharpe ${shadowMetrics?.sharpeRatio?.toFixed(2)}, calibration ${shadowMetrics?.calibrationQuality.toFixed(2)}, EV realization ${shadowMetrics?.expectedValueRealization.toFixed(2)}`,
        metadata: { shadowMetrics, productionMetrics },
      })
      // Promote the shadow model to production; archive the old production model
      aiModelRegistry.transition(shadowModelId, 'PRODUCTION', `Promoted from shadow — superior risk-adjusted performance`)
      if (productionMetrics) {
        const oldProd = aiModelRegistry.get(record.productionModelId)
        if (oldProd && oldProd.lifecycleState === 'PRODUCTION') {
          aiModelRegistry.transition(record.productionModelId, 'ARCHIVE', `Replaced by ${shadowModelId}`)
        }
      }
    } else if (record.promotionDecision === 'REJECTED') {
      log.warn(`shadow promotion REJECTED: ${shadowModelId} — ${reasons.join('; ')}`)
      predictionTraceability.audit({
        eventType: 'SHADOW_PROMOTION_REJECTED',
        modelId: shadowModelId,
        predictionId: null,
        snapshotId: null,
        actor: 'ai-governance',
        decision: `Reject promotion of ${shadowModelId}`,
        reasoning: reasons.join('; '),
        metadata: { shadowMetrics, productionMetrics },
      })
      governanceAlerts.alert({
        type: 'PREDICTION_ANOMALY',
        severity: 'MEDIUM',
        component: 'ai-governance',
        message: `Shadow model "${shadowModelId}" promotion rejected: ${reasons.slice(0, 2).join('; ')}`,
        metadata: { shadowModelId, reasons },
      })
    }

    this.completedEvaluations.push(record)
    this.activeEvaluations.delete(shadowModelId)
    for (const sub of this.subscribers) sub(record)
    return record
  }

  getActiveEvaluation(shadowModelId: string): ShadowEvaluationRecord | undefined {
    return this.activeEvaluations.get(shadowModelId)
  }

  getCompletedEvaluations(limit = 50): ShadowEvaluationRecord[] {
    return this.completedEvaluations.slice(-limit)
  }

  subscribe(handler: (record: ShadowEvaluationRecord) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const shadowEvaluation = new ShadowEvaluationSystem()

// Re-export
export type { ExtendedModelArtifact, RollingPerformanceMetrics }
