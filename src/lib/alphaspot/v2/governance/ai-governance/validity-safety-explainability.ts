// CHAPTER 2.5 §12 — Recommendation Validity
// CHAPTER 2.5 §14 — Operational Safety
// CHAPTER 2.5 §15 — Human Oversight
// CHAPTER 2.5 §16 — Explainability
//
// Recommendations auto-expire when (§12): market structure changes, confidence
// falls, snapshot expires, risk limits change, volatility changes significantly.
//
// Operational safety (§14): suspend on exchange instability, abnormal volatility,
// severe model degradation, insufficient data quality, corrupted features,
// infrastructure instability. Safety overrides prediction frequency.
//
// Human oversight (§15): always expose reasoning, evidence, confidence, EV, risk.
// Users remain responsible for final decisions. The system assists, not decides.
//
// Explainability (§16): every recommendation includes WHY it exists, why
// alternatives were rejected, major contributing factors, dominant risk factors,
// expiration reason, confidence explanation. No black boxes.

import { createLogger } from '../../domains/01-core-infrastructure'
import { governanceAlerts } from './governance-alerts'
import { performanceMonitor } from './performance-monitoring'
import { aiModelRegistry } from './model-lifecycle'
import type { Recommendation } from '../../types'

const log = createLogger('ai-governance:validity-safety')

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation validity  (Chapter 2.5 §12)
// ─────────────────────────────────────────────────────────────────────────────

export type ExpirationReason =
  | 'MARKET_STRUCTURE_CHANGED'
  | 'CONFIDENCE_FELL'
  | 'SNAPSHOT_EXPIRED'
  | 'RISK_LIMITS_CHANGED'
  | 'VOLATILITY_CHANGED_SIGNIFICANTLY'
  | 'TIME_EXPIRED'
  | 'MODEL_SUSPENDED'
  | 'MANUAL_INVALIDATION'

export interface RecommendationValidityState {
  recommendationId: string
  valid: boolean
  expirationReason: ExpirationReason | null
  expiredAt: number | null
  checks: Array<{ check: string; passed: boolean; detail: string }>
}

class RecommendationValidityManager {
  private states = new Map<string, RecommendationValidityState>()
  private subscribers = new Set<(state: RecommendationValidityState) => void>()

  /** Validate a recommendation against §12 expiration conditions. */
  validate(
    rec: Recommendation,
    context: {
      currentConfidence: number
      originalConfidence: number
      snapshotExpired: boolean
      currentVolatility: number
      originalVolatility: number
      modelSuspended: boolean
    },
  ): RecommendationValidityState {
    const checks: RecommendationValidityState['checks'] = []

    // §12 — confidence fell
    const confidenceDrop = context.originalConfidence - context.currentConfidence
    checks.push({
      check: 'CONFIDENCE_FELL',
      passed: confidenceDrop < 0.2,
      detail: confidenceDrop >= 0.2 ? `Confidence dropped ${confidenceDrop.toFixed(2)} (from ${context.originalConfidence.toFixed(2)} to ${context.currentConfidence.toFixed(2)})` : 'Confidence stable',
    })

    // §12 — snapshot expired
    checks.push({
      check: 'SNAPSHOT_EXPIRED',
      passed: !context.snapshotExpired,
      detail: context.snapshotExpired ? 'Snapshot has expired' : 'Snapshot valid',
    })

    // §12 — volatility changed significantly
    const volChange = context.originalVolatility > 0 ? Math.abs(context.currentVolatility - context.originalVolatility) / context.originalVolatility : 0
    checks.push({
      check: 'VOLATILITY_CHANGED_SIGNIFICANTLY',
      passed: volChange < 0.5,
      detail: volChange >= 0.5 ? `Volatility changed ${(volChange * 100).toFixed(0)}%` : 'Volatility stable',
    })

    // §12 — model suspended
    checks.push({
      check: 'MODEL_SUSPENDED',
      passed: !context.modelSuspended,
      detail: context.modelSuspended ? 'Model is suspended' : 'Model active',
    })

    // §12 — time expired
    const timeExpired = Date.now() > rec.expiresAt
    checks.push({
      check: 'TIME_EXPIRED',
      passed: !timeExpired,
      detail: timeExpired ? `Expired at ${new Date(rec.expiresAt).toISOString()}` : `Expires in ${Math.max(0, (rec.expiresAt - Date.now()) / 60000).toFixed(1)} min`,
    })

    const failedCheck = checks.find((c) => !c.passed)
    const state: RecommendationValidityState = {
      recommendationId: rec.id,
      valid: !failedCheck,
      expirationReason: failedCheck ? (failedCheck.check as ExpirationReason) : null,
      expiredAt: failedCheck ? Date.now() : null,
      checks,
    }

    const prev = this.states.get(rec.id)
    this.states.set(rec.id, state)
    if (failedCheck && (!prev || prev.valid)) {
      log.warn(`recommendation ${rec.id} EXPIRED: ${failedCheck.check} — ${failedCheck.detail}`)
      predictionTraceability_audit({
        eventType: 'RECOMMENDATION_EXPIRED' as const,
        modelId: null,
        predictionId: rec.candidateId,
        snapshotId: rec.snapshotVersion.toString(),
        actor: 'ai-governance',
        decision: `Expire recommendation ${rec.id}`,
        reasoning: `${failedCheck.check}: ${failedCheck.detail}`,
        metadata: { recommendationId: rec.id, reason: failedCheck.check },
      })
    }
    for (const sub of this.subscribers) sub(state)
    return state
  }

  getValidity(recommendationId: string): RecommendationValidityState | undefined {
    return this.states.get(recommendationId)
  }

  /** Invalidate a recommendation manually (§12 — manual invalidation). */
  invalidate(recommendationId: string, reason: string): void {
    const state = this.states.get(recommendationId)
    if (state) {
      state.valid = false
      state.expirationReason = 'MANUAL_INVALIDATION'
      state.expiredAt = Date.now()
      log.warn(`recommendation ${recommendationId} manually invalidated: ${reason}`)
    }
  }

  subscribe(handler: (state: RecommendationValidityState) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const recommendationValidity = new RecommendationValidityManager()

// ─────────────────────────────────────────────────────────────────────────────
// Operational safety  (Chapter 2.5 §14)
// ─────────────────────────────────────────────────────────────────────────────

export type SafetyCondition =
  | 'EXCHANGE_INSTABILITY'
  | 'ABNORMAL_MARKET_VOLATILITY'
  | 'SEVERE_MODEL_DEGRADATION'
  | 'INSUFFICIENT_DATA_QUALITY'
  | 'CORRUPTED_FEATURE_GENERATION'
  | 'INFRASTRUCTURE_INSTABILITY'

export interface OperationalSafetyState {
  publicationSuspended: boolean
  activeConditions: SafetyCondition[]
  suspendedAt: number | null
  reason: string
}

class OperationalSafetyManager {
  private activeConditions = new Set<SafetyCondition>()
  private suspendedAt: number | null = null
  private subscribers = new Set<(state: OperationalSafetyState) => void>()

  /** Report a safety condition (§14). Safety overrides prediction frequency. */
  reportCondition(condition: SafetyCondition, detail: string): void {
    if (!this.activeConditions.has(condition)) {
      this.activeConditions.add(condition)
      log.warn(`operational safety condition: ${condition} — ${detail}`)
      governanceAlerts.alert({
        type: 'PIPELINE_INSTABILITY',
        severity: 'HIGH',
        component: 'operational-safety',
        message: `${condition}: ${detail}`,
        metadata: { condition },
      })
      if (this.activeConditions.size === 1) {
        this.suspendedAt = Date.now()
        log.error('recommendation publication SUSPENDED (§14 — safety overrides prediction frequency)')
      }
      this.notify()
    }
  }

  /** Clear a safety condition. */
  clearCondition(condition: SafetyCondition): void {
    if (this.activeConditions.delete(condition)) {
      log.info(`operational safety condition cleared: ${condition}`)
      if (this.activeConditions.size === 0) {
        this.suspendedAt = null
        log.info('recommendation publication RESUMED — all safety conditions cleared')
      }
      this.notify()
    }
  }

  /** Check whether recommendation publication is currently suspended (§14). */
  isPublicationSuspended(): boolean {
    return this.activeConditions.size > 0
  }

  getState(): OperationalSafetyState {
    return {
      publicationSuspended: this.activeConditions.size > 0,
      activeConditions: [...this.activeConditions],
      suspendedAt: this.suspendedAt,
      reason: this.activeConditions.size > 0 ? `Active conditions: ${[...this.activeConditions].join(', ')}` : 'Operational',
    }
  }

  /** Check if a model is severely degraded (§14) — via confidence decay. */
  checkModelDegradation(modelId: string): void {
    const decay = performanceMonitor.getConfidenceDecay(modelId)
    if (decay <= 0.5) {
      this.reportCondition('SEVERE_MODEL_DEGRADATION', `Model "${modelId}" confidence decay multiplier = ${decay} (≤0.5)`)
    } else {
      this.clearCondition('SEVERE_MODEL_DEGRADATION')
    }
  }

  subscribe(handler: (state: OperationalSafetyState) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  private notify(): void {
    const state = this.getState()
    for (const sub of this.subscribers) sub(state)
  }
}

export const operationalSafety = new OperationalSafetyManager()

// ─────────────────────────────────────────────────────────────────────────────
// Explainability  (Chapter 2.5 §16)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendationExplanation {
  recommendationId: string
  // §16 — why the recommendation exists
  whyItExists: string
  // §16 — why alternatives were rejected
  whyAlternativesRejected: Array<{ asset: string; reason: string }>
  // §16 — major contributing factors
  contributingFactors: Array<{ factor: string; weight: number; detail: string }>
  // §16 — dominant risk factors
  riskFactors: Array<{ factor: string; severity: string; detail: string }>
  // §16 — recommendation expiration reason
  expirationReason: string
  // §16 — confidence explanation
  confidenceExplanation: string
}

class ExplainabilityEngine {
  /** Generate a full explanation for a recommendation (§16 — no black boxes). */
  explain(
    rec: Recommendation,
    context: {
      alternatives: Array<{ asset: string; reason: string }>
      contributingFactors: Array<{ factor: string; weight: number; detail: string }>
      riskFactors: Array<{ factor: string; severity: string; detail: string }>
      confidenceCalibration: number
    },
  ): RecommendationExplanation {
    const topFactor = [...context.contributingFactors].sort((a, b) => b.weight - a.weight)[0]
    return {
      recommendationId: rec.id,
      whyItExists: `${rec.action} ${rec.asset.split('/')[0]}: EV ${rec.expectedValue?.toFixed(1) ?? 'N/A'} (rank ${rec.rank}), P(success) ${(rec.probabilityOfSuccess ?? 0).toFixed(2)}, R/R ${rec.rewardToRisk?.toFixed(2) ?? 'N/A'}. Primary driver: ${topFactor?.factor ?? 'multi-factor convergence'}.`,
      whyAlternativesRejected: context.alternatives,
      contributingFactors: context.contributingFactors,
      riskFactors: context.riskFactors,
      expirationReason: `Expires at ${new Date(rec.expiresAt).toISOString()} — recommendations auto-expire (§12) when market structure, confidence, snapshot, risk limits, or volatility change.`,
      confidenceExplanation: `Confidence ${(rec.probabilityOfSuccess ?? 0).toFixed(2)} calibrated against historical outcomes (calibration quality ${context.confidenceCalibration.toFixed(2)}). ${context.confidenceCalibration < 0.5 ? 'WARNING: poorly calibrated — confidence reduced per §6.' : 'Calibration within acceptable range.'}`,
    }
  }
}

export const explainability = new ExplainabilityEngine()

// ─────────────────────────────────────────────────────────────────────────────
// Circular import workaround: audit via the traceability singleton
// (prediction-traceability imports nothing from this module, so this is safe)
// ─────────────────────────────────────────────────────────────────────────────
import { predictionTraceability } from './prediction-traceability'
function predictionTraceability_audit(entry: Parameters<typeof predictionTraceability.audit>[0]): void {
  predictionTraceability.audit(entry)
}
