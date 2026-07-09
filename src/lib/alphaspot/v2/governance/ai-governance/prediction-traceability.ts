// CHAPTER 2.5 §5 — Prediction Traceability
// CHAPTER 2.5 §13 — Self-Evaluation Loop
// CHAPTER 2.5 §18 — Auditability
//
// Every recommendation must be traceable (§5). Each prediction stores:
//   Snapshot ID, Model Version, Feature Version, Prediction Timestamp,
//   Confidence, Expected Value, Market Regime, Supporting Evidence, Final Outcome.
//
// The self-evaluation loop (§13): Prediction → Execution → Outcome →
// Evaluation → Performance Database → Future Improvement.
//
// Every important AI decision is permanently recorded (§18 auditability).

import { createLogger } from '../../domains/01-core-infrastructure'

const log = createLogger('ai-governance:traceability')

// ─────────────────────────────────────────────────────────────────────────────
// Traceable prediction  (Chapter 2.5 §5)
// ─────────────────────────────────────────────────────────────────────────────

export interface TraceablePrediction {
  predictionId: string
  snapshotId: string
  correlationId: string
  modelId: string
  modelVersion: string
  featureVersion: string
  predictionTimestamp: number
  confidence: number
  expectedValue: number
  marketRegime: string
  supportingEvidence: Array<{ factor: string; contribution: number; detail: string }>
  asset: string
  action: string
  entryPrice: number | null
  targetPrice: number | null
  stopPrice: number | null

  // Final outcome (filled when the trade closes — §13 self-evaluation loop)
  outcome: PredictionOutcome | null
}

export interface PredictionOutcome {
  resolvedAt: number
  hitTarget: boolean
  hitStop: boolean
  actualReturnPct: number
  actualDrawdownPct: number
  holdingPeriodMs: number
  executionPrice: number | null
  outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'CANCELLED' | 'PENDING'
  note: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit entry  (Chapter 2.5 §18 — permanent recording of AI decisions)
// ─────────────────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'PREDICTION_GENERATED'
  | 'RECOMMENDATION_PUBLISHED'
  | 'RECOMMENDATION_REJECTED'
  | 'RECOMMENDATION_EXPIRED'
  | 'MODEL_REPLACED'
  | 'CONFIDENCE_RECALIBRATED'
  | 'GOVERNANCE_INTERVENTION'
  | 'MODEL_PROMOTED'
  | 'MODEL_SUSPENDED'
  | 'MODEL_RETIRED'
  | 'DRIFT_DETECTED'
  | 'SHADOW_EVALUATION_STARTED'
  | 'SHADOW_PROMOTION_APPROVED'
  | 'SHADOW_PROMOTION_REJECTED'

export interface AuditEntry {
  auditId: string
  eventType: AuditEventType
  timestamp: number
  modelId: string | null
  predictionId: string | null
  snapshotId: string | null
  actor: string // which component made the decision
  decision: string
  reasoning: string
  metadata: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction traceability + audit registry
// ─────────────────────────────────────────────────────────────────────────────

class PredictionTraceability {
  private predictions = new Map<string, TraceablePrediction>()
  private auditLog: AuditEntry[] = []
  private readonly auditLimit = 50_000
  private predictionSubscribers = new Set<(p: TraceablePrediction) => void>()
  private auditSubscribers = new Set<(a: AuditEntry) => void>()

  /** Record a traceable prediction (§5 — full provenance). */
  recordPrediction(pred: Omit<TraceablePrediction, 'outcome'>): TraceablePrediction {
    const full: TraceablePrediction = { ...pred, outcome: null }
    this.predictions.set(pred.predictionId, full)
    this.audit({
      eventType: 'PREDICTION_GENERATED',
      modelId: pred.modelId,
      predictionId: pred.predictionId,
      snapshotId: pred.snapshotId,
      actor: 'machine-learning',
      decision: `Generated prediction for ${pred.asset}`,
      reasoning: `Confidence ${pred.confidence.toFixed(2)}, EV ${pred.expectedValue.toFixed(1)}, regime ${pred.marketRegime}`,
      metadata: { action: pred.action, entryPrice: pred.entryPrice },
    })
    for (const sub of this.predictionSubscribers) sub(full)
    return full
  }

  /** Resolve a prediction's outcome (§13 — self-evaluation loop: Execution → Outcome → Evaluation). */
  resolveOutcome(predictionId: string, outcome: PredictionOutcome): TraceablePrediction {
    const pred = this.predictions.get(predictionId)
    if (!pred) throw new Error(`[traceability] prediction "${predictionId}" not found`)
    if (pred.outcome) {
      log.warn(`prediction "${predictionId}" already resolved — ignoring duplicate (idempotent)`)
      return pred
    }
    pred.outcome = outcome
    log.info(`prediction ${predictionId} resolved: ${outcome.outcome} (return ${outcome.actualReturnPct.toFixed(2)}%)`)
    return pred
  }

  /** Get a prediction by ID (§5 — traceable). */
  get(predictionId: string): TraceablePrediction | undefined {
    return this.predictions.get(predictionId)
  }

  /** Get predictions for a model (for performance monitoring §7). */
  getByModel(modelId: string, limit = 1000): TraceablePrediction[] {
    return Array.from(this.predictions.values())
      .filter((p) => p.modelId === modelId)
      .slice(-limit)
  }

  /** Get resolved predictions (with outcomes) for a model — feeds the self-evaluation loop (§13). */
  getResolvedByModel(modelId: string, limit = 1000): TraceablePrediction[] {
    return this.getByModel(modelId, limit).filter((p) => p.outcome !== null)
  }

  /** Get recent predictions (for audit/dashboard). */
  getRecent(limit = 100): TraceablePrediction[] {
    return Array.from(this.predictions.values()).slice(-limit)
  }

  /** Record an audit entry (§18 — permanent recording). */
  audit(entry: Omit<AuditEntry, 'auditId' | 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      auditId: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    }
    this.auditLog.push(full)
    if (this.auditLog.length > this.auditLimit) this.auditLog.shift()
    for (const sub of this.auditSubscribers) sub(full)
    return full
  }

  /** Query the audit log (§18 — historical audits always possible). */
  queryAudit(filter?: { eventType?: AuditEventType; modelId?: string; since?: number; limit?: number }): AuditEntry[] {
    let results = [...this.auditLog]
    if (filter?.eventType) results = results.filter((a) => a.eventType === filter.eventType)
    if (filter?.modelId) results = results.filter((a) => a.modelId === filter.modelId)
    if (filter?.since) results = results.filter((a) => a.timestamp >= filter.since!)
    return results.slice(-(filter?.limit ?? 100))
  }

  getStats(): {
    totalPredictions: number
    resolvedPredictions: number
    pendingPredictions: number
    winCount: number
    lossCount: number
    expiredCount: number
    auditEntries: number
  } {
    let resolved = 0, win = 0, loss = 0, expired = 0
    for (const p of this.predictions.values()) {
      if (p.outcome) {
        resolved++
        if (p.outcome.outcome === 'WIN') win++
        else if (p.outcome.outcome === 'LOSS') loss++
        else if (p.outcome.outcome === 'EXPIRED') expired++
      }
    }
    return {
      totalPredictions: this.predictions.size,
      resolvedPredictions: resolved,
      pendingPredictions: this.predictions.size - resolved,
      winCount: win,
      lossCount: loss,
      expiredCount: expired,
      auditEntries: this.auditLog.length,
    }
  }

  subscribePredictions(handler: (p: TraceablePrediction) => void): () => void {
    this.predictionSubscribers.add(handler)
    return () => this.predictionSubscribers.delete(handler)
  }

  subscribeAudit(handler: (a: AuditEntry) => void): () => void {
    this.auditSubscribers.add(handler)
    return () => this.auditSubscribers.delete(handler)
  }
}

export const predictionTraceability = new PredictionTraceability()
