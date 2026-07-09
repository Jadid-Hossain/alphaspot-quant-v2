// CHAPTER 2.5 §17 — Governance Alerts
//
// The platform generates alerts for (§17):
//   Model degradation, confidence collapse, feature drift, market drift,
//   pipeline instability, prediction anomalies, repeated recommendation
//   failures, risk threshold violations.
//
// Governance alerts NEVER trigger trades (§17).

import { createLogger } from '../../domains/01-core-infrastructure'
import { predictionTraceability } from './prediction-traceability'

const log = createLogger('ai-governance:alerts')

// ─────────────────────────────────────────────────────────────────────────────
// Alert types  (Chapter 2.5 §17)
// ─────────────────────────────────────────────────────────────────────────────

export type AlertType =
  | 'MODEL_DEGRADATION'
  | 'CONFIDENCE_COLLAPSE'
  | 'FEATURE_DRIFT'
  | 'MARKET_DRIFT'
  | 'PIPELINE_INSTABILITY'
  | 'PREDICTION_ANOMALY'
  | 'REPEATED_RECOMMENDATION_FAILURES'
  | 'RISK_THRESHOLD_VIOLATION'

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface GovernanceAlert {
  alertId: string
  type: AlertType
  severity: AlertSeverity
  component: string
  message: string
  metadata: Record<string, unknown>
  raisedAt: number
  acknowledgedAt: number | null
  acknowledgedBy: string | null
  // §17 — governance alerts NEVER trigger trades
  triggersTrade: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance Alert system  (Chapter 2.5 §17)
// ─────────────────────────────────────────────────────────────────────────────

class GovernanceAlertSystem {
  private alerts: GovernanceAlert[] = []
  private readonly limit = 10_000
  private subscribers = new Set<(alert: GovernanceAlert) => void>()
  private stats: Record<AlertType, number> = {
    MODEL_DEGRADATION: 0,
    CONFIDENCE_COLLAPSE: 0,
    FEATURE_DRIFT: 0,
    MARKET_DRIFT: 0,
    PIPELINE_INSTABILITY: 0,
    PREDICTION_ANOMALY: 0,
    REPEATED_RECOMMENDATION_FAILURES: 0,
    RISK_THRESHOLD_VIOLATION: 0,
  }

  /** Raise a governance alert (§17 — never triggers a trade). */
  alert(opts: {
    type: AlertType
    severity: AlertSeverity
    component: string
    message: string
    metadata?: Record<string, unknown>
  }): GovernanceAlert {
    const alert: GovernanceAlert = {
      alertId: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: opts.type,
      severity: opts.severity,
      component: opts.component,
      message: opts.message,
      metadata: opts.metadata ?? {},
      raisedAt: Date.now(),
      acknowledgedAt: null,
      acknowledgedBy: null,
      triggersTrade: false, // §17 — hardcoded false, NEVER trades
    }
    this.alerts.push(alert)
    if (this.alerts.length > this.limit) this.alerts.shift()
    this.stats[opts.type]++

    const fn = opts.severity === 'CRITICAL' ? log.error : opts.severity === 'HIGH' ? log.error : opts.severity === 'MEDIUM' ? log.warn : log.info
    fn(`[${opts.type}] ${opts.component}: ${opts.message}`)

    for (const sub of this.subscribers) sub(alert)
    return alert
  }

  /** Acknowledge an alert (human oversight — §15). */
  acknowledge(alertId: string, acknowledgedBy: string): void {
    const alert = this.alerts.find((a) => a.alertId === alertId)
    if (alert) {
      alert.acknowledgedAt = Date.now()
      alert.acknowledgedBy = acknowledgedBy
      log.info(`alert ${alertId} acknowledged by ${acknowledgedBy}`)
    }
  }

  /** Detect repeated recommendation failures (§17). */
  detectRepeatedFailures(modelId: string, threshold = 5): void {
    const recent = predictionTraceability.getResolvedByModel(modelId, 20)
    const recentLosses = recent.filter((p) => p.outcome?.outcome === 'LOSS')
    if (recentLosses.length >= threshold) {
      this.alert({
        type: 'REPEATED_RECOMMENDATION_FAILURES',
        severity: 'HIGH',
        component: 'ai-governance',
        message: `Model "${modelId}" has ${recentLosses.length} losses in the last ${recent.length} resolved predictions`,
        metadata: { modelId, losses: recentLosses.length, sampleSize: recent.length },
      })
    }
  }

  /** Detect confidence collapse (§17). */
  detectConfidenceCollapse(modelId: string, threshold = 0.3): void {
    const recent = predictionTraceability.getRecent(50).filter((p) => p.modelId === modelId)
    if (recent.length < 10) return
    const avgConf = recent.reduce((a, p) => a + p.confidence, 0) / recent.length
    if (avgConf < threshold) {
      this.alert({
        type: 'CONFIDENCE_COLLAPSE',
        severity: 'CRITICAL',
        component: 'ai-governance',
        message: `Model "${modelId}" average confidence collapsed to ${avgConf.toFixed(2)} (threshold ${threshold})`,
        metadata: { modelId, averageConfidence: avgConf, threshold },
      })
    }
  }

  getActive(): GovernanceAlert[] {
    return this.alerts.filter((a) => a.acknowledgedAt === null)
  }

  getHistory(limit = 100): GovernanceAlert[] {
    return this.alerts.slice(-limit)
  }

  getStats(): Record<AlertType, number> & { total: number; active: number } {
    const total = Object.values(this.stats).reduce((a, b) => a + b, 0)
    return { ...this.stats, total, active: this.getActive().length }
  }

  subscribe(handler: (alert: GovernanceAlert) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const governanceAlerts = new GovernanceAlertSystem()
