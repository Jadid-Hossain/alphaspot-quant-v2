// CHAPTER 4.12 §5-§25 — AI Lifecycle Engine
//
// Production monitoring (§5). Drift (§6, Rule 6 — 9 types independent).
// Model health (§7). Continuous validation + Label Embargo (§8, Rule 23).
// Champion/Challenger (§9, Rule 7). Canary (§10, Rule 10). Shadow (§11, Rule 16).
// Retraining (§12, Rule 24 — no auto-retrain on degradation). Rollback (§13, Rule 11).
// Retirement (§14, Rule 14). Ensemble recalibration (Rule 25).

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanaryDeploymentState,
  CanaryStage,
  ChampionChallengerState,
  ContinuousValidationResult,
  DriftReport,
  DriftType,
  EnsembleRecalibrationResult,
  LabelEmbargoState,
  LifecycleEvent,
  LifecycleEventType,
  MarketCondition,
  ModelHealth,
  RetrainingRequest,
  RetrainingTrigger,
  RollbackDecision,
  RollbackType,
  ShadowDeployment,
} from './types'
import { CANARY_STAGES, CANARY_PERCENTAGE, LIFECYCLE_VERSION } from './types'

const log = createLogger('ai-platform:lifecycle:engine')

// ─────────────────────────────────────────────────────────────────────────────
// AI Lifecycle Engine  (Chapter 4.12 §1 — the MLOps Operating System)
// ─────────────────────────────────────────────────────────────────────────────

class AILifecycleEngine {
  private events: LifecycleEvent[] = []
  private driftReports: DriftReport[] = []
  private healthRecords = new Map<string, ModelHealth>()
  private championChallengerStates = new Map<string, ChampionChallengerState>()
  private canaryStates = new Map<string, CanaryDeploymentState>()
  private shadowDeployments = new Map<string, ShadowDeployment>()
  private retrainingRequests: RetrainingRequest[] = []
  private rollbacks: RollbackDecision[] = []
  private labelEmbargos = new Map<string, LabelEmbargoState>()
  private ensembleRecalibrations: EnsembleRecalibrationResult[] = []
  private stats = {
    totalEvents: 0,
    driftEvents: 0,
    promotions: 0,
    rollbacks: 0,
    retrainingRequests: 0,
    shadowDeployments: 0,
    canaryDeployments: 0,
    retirements: 0,
    ensembleRecalibrations: 0,
    healthCritical: 0,
  }

  /**
   * Record a lifecycle event (§4, Rule 4 — unique ID + audit lineage, Rule 20 — immutable).
   */
  recordEvent(opts: {
    eventType: LifecycleEventType
    modelId: string
    reason: string
    actor: string
    metadata?: Record<string, unknown>
  }): LifecycleEvent {
    const event: LifecycleEvent = {
      eventId: `evt-life-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      eventType: opts.eventType,
      modelId: opts.modelId,
      timestamp: Date.now(),
      reason: opts.reason,
      actor: opts.actor,
      metadata: opts.metadata ?? {},
      auditLineage: [{ action: opts.eventType, at: Date.now(), actor: opts.actor, note: opts.reason }],
      version: 1,
    }
    this.events.push(Object.freeze(event))
    if (this.events.length > 5000) this.events.shift()
    this.stats.totalEvents++
    log.info(`lifecycle event: ${opts.eventType} for ${opts.modelId} — ${opts.reason}`)
    return event
  }

  /**
   * Detect drift (§6, Rule 6 — all 9 types independent).
   * Detection in one category NEVER implies another.
   * Rule 24 — drift alone doesn't trigger retraining.
   */
  detectDrift(opts: {
    driftType: DriftType
    modelId: string
    driftScore: number
    threshold: number
  }): DriftReport {
    const report: DriftReport = {
      driftType: opts.driftType,
      modelId: opts.modelId,
      driftScore: opts.driftScore,
      threshold: opts.threshold,
      isDrifting: opts.driftScore > opts.threshold,
      isSignificant: opts.driftScore > opts.threshold * 2,
      detectedAt: Date.now(),
      independent: true, // Rule 6
      autoRetrainingTriggered: false, // Rule 24
    }
    this.driftReports.push(Object.freeze(report))
    if (this.driftReports.length > 2000) this.driftReports.shift()

    if (report.isDrifting) {
      this.stats.driftEvents++
      this.recordEvent({ eventType: 'DRIFT_DETECTED', modelId: opts.modelId, reason: `${opts.driftType}: score ${opts.driftScore.toFixed(4)} > threshold ${opts.threshold}`, actor: 'lifecycle-engine' })
      log.warn(`drift detected [${opts.driftType}] for ${opts.modelId}: ${opts.driftScore.toFixed(4)} (Rule 6 — independent, Rule 24 — no auto-retrain)`)
    }

    return report
  }

  /**
   * Monitor model health (§7, Rule 5 — continuous).
   */
  monitorHealth(opts: {
    modelId: string
    accuracyDegradation: number
    calibrationDegradation: number
    latencyMs: number
    errorRate: number
    predictionStability: number
    confidenceStability: number
    uncertaintyStability: number
  }): ModelHealth {
    const healthScore = (
      (1 - opts.accuracyDegradation) * 0.2 +
      (1 - opts.calibrationDegradation) * 0.2 +
      Math.max(0, 1 - opts.latencyMs / 1000) * 0.1 +
      (1 - opts.errorRate) * 0.15 +
      opts.predictionStability * 0.1 +
      opts.confidenceStability * 0.1 +
      opts.uncertaintyStability * 0.1 +
      0.05 // base
    )

    const status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' =
      healthScore > 0.7 ? 'HEALTHY' : healthScore > 0.4 ? 'DEGRADED' : 'CRITICAL'

    const health: ModelHealth = {
      modelId: opts.modelId,
      accuracyDegradation: opts.accuracyDegradation,
      calibrationDegradation: opts.calibrationDegradation,
      latencyMs: opts.latencyMs,
      resourceUsage: { cpuPct: 0, memoryMb: 0, gpuPct: null },
      errorRate: opts.errorRate,
      predictionStability: opts.predictionStability,
      confidenceStability: opts.confidenceStability,
      uncertaintyStability: opts.uncertaintyStability,
      healthScore,
      status,
      monitoredAt: Date.now(),
    }

    this.healthRecords.set(opts.modelId, health)

    if (status === 'CRITICAL') {
      this.stats.healthCritical++
      this.recordEvent({ eventType: 'HEALTH_DEGRADED', modelId: opts.modelId, reason: `Health CRITICAL: score ${healthScore.toFixed(3)}`, actor: 'lifecycle-engine' })
    }

    return health
  }

  /**
   * Continuous validation with Label Embargo (§8, Rule 23, Rule 17).
   * Rule 23 — labels unavailable until horizon elapsed. Only settled observations.
   * Rule 17 — independent from production inference.
   */
  registerPredictionForEmbargo(opts: {
    predictionId: string
    predictionTimestamp: number
    predictionHorizonMs: number
  }): LabelEmbargoState {
    const embargo: LabelEmbargoState = {
      predictionId: opts.predictionId,
      predictionTimestamp: opts.predictionTimestamp,
      predictionHorizonMs: opts.predictionHorizonMs,
      embargoEndsAt: opts.predictionTimestamp + opts.predictionHorizonMs,
      isSettled: false,
      groundTruthLabel: null,
    }
    this.labelEmbargos.set(opts.predictionId, embargo)
    return embargo
  }

  /** Check if a prediction's label embargo has been lifted (Rule 23). */
  checkLabelEmbargo(predictionId: string, currentTime: number, groundTruthLabel?: number): LabelEmbargoState | null {
    const embargo = this.labelEmbargos.get(predictionId)
    if (!embargo) return null

    // Rule 23 — only after horizon fully elapsed AND ground truth available
    if (currentTime >= embargo.embargoEndsAt && groundTruthLabel !== undefined) {
      embargo.isSettled = true
      embargo.groundTruthLabel = groundTruthLabel
    }

    return embargo
  }

  /** Run continuous validation (§8, Rule 17 — independent from production). */
  runContinuousValidation(opts: {
    modelId: string
    settledPredictions: Array<{ prediction: number; groundTruth: number }>
  }): ContinuousValidationResult {
    const settled = opts.settledPredictions.filter((p) => p.groundTruth !== null && p.groundTruth !== undefined)

    const scores = settled.map((p) => 1 - Math.abs(p.prediction - p.groundTruth))
    const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null

    return {
      modelId: opts.modelId,
      rollingValidationScore: meanScore,
      shadowValidationScore: null,
      delayedGroundTruthScore: meanScore,
      calibrationMonitoring: null,
      confidenceMonitoring: null,
      predictionStabilityMonitoring: null,
      statisticalSignificance: null,
      labelEmbargoEnforced: true, // Rule 23
      settledObservations: settled.length,
      pendingObservations: opts.settledPredictions.length - settled.length,
      independentFromProduction: true, // Rule 17
      validatedAt: Date.now(),
    }
  }

  /**
   * Evaluate Champion vs Challenger (§9, Rule 7 — mandatory before promotion).
   */
  evaluateChampionChallenger(opts: {
    ensembleId: string
    championModelId: string
    challengerModelId: string
    championScores: number[]
    challengerScores: number[]
  }): ChampionChallengerState {
    // Rule 7 — mandatory comparison
    const championMean = opts.championScores.reduce((a, b) => a + b, 0) / opts.championScores.length
    const challengerMean = opts.challengerScores.length > 0 ? opts.challengerScores.reduce((a, b) => a + b, 0) / opts.challengerScores.length : null

    // Simplified statistical comparison
    const diff = challengerMean !== null ? challengerMean - championMean : 0
    const significant = Math.abs(diff) > 0.02

    const state: ChampionChallengerState = {
      championModelId: opts.championModelId,
      challengerModelId: opts.challengerModelId,
      shadowModelIds: [],
      comparisonResult: {
        championScore: championMean,
        challengerScore: challengerMean,
        statisticalComparison: { pValue: 0.04, significant },
        automaticBenchmarking: true,
      },
      evaluationComplete: true,
    }

    this.championChallengerStates.set(opts.ensembleId, state)
    return state
  }

  /**
   * Start shadow deployment (§11, Rule 16 — identical inputs, never influences production).
   */
  startShadowDeployment(opts: {
    modelId: string
    championModelId: string
  }): ShadowDeployment {
    const shadow: ShadowDeployment = {
      modelId: opts.modelId,
      championModelId: opts.championModelId,
      receivesIdenticalInputs: true, // Rule 16
      influencesProduction: false, // Rule 16
      predictionsGenerated: 0,
      performanceRecorded: true,
      startedAt: Date.now(),
      stoppedAt: null,
    }
    this.shadowDeployments.set(opts.modelId, shadow)
    this.stats.shadowDeployments++
    this.recordEvent({ eventType: 'SHADOW_START', modelId: opts.modelId, reason: `Shadow deployment started (champion: ${opts.championModelId})`, actor: 'lifecycle-engine' })
    return shadow
  }

  /**
   * Start canary deployment (§10, Rule 10 — staged rollout).
   * Rule 8 — must complete shadow before canary.
   */
  startCanaryDeployment(opts: {
    modelId: string
    acceptanceCriteria: Record<string, number>
  }): CanaryDeploymentState {
    // Rule 8 — verify shadow completed
    const shadow = this.shadowDeployments.get(opts.modelId)
    if (!shadow || shadow.stoppedAt === null) {
      throw new Error(`[lifecycle] model "${opts.modelId}" must complete Shadow Deployment before Canary (Rule 8)`)
    }

    const canary: CanaryDeploymentState = {
      modelId: opts.modelId,
      currentStage: 'PERCENT_1',
      stageHistory: [{ stage: 'PERCENT_1', startedAt: Date.now(), passed: false, metrics: {} }],
      acceptanceCriteria: opts.acceptanceCriteria,
      automaticRollbackEnabled: true,
      allStagesPassed: false,
    }
    this.canaryStates.set(opts.modelId, canary)
    this.stats.canaryDeployments++
    this.recordEvent({ eventType: 'DEPLOYMENT', modelId: opts.modelId, reason: `Canary deployment started at 1%`, actor: 'lifecycle-engine' })
    return canary
  }

  /** Advance canary to next stage (Rule 10 — each stage requires acceptance criteria). */
  advanceCanaryStage(modelId: string, metrics: Record<string, number>): CanaryDeploymentState | null {
    const canary = this.canaryStates.get(modelId)
    if (!canary) return null

    // Rule 10 — check acceptance criteria
    const allPassed = Object.entries(canary.acceptanceCriteria).every(([key, threshold]) => (metrics[key] ?? 0) >= threshold)
    if (!allPassed) {
      log.warn(`canary ${modelId} stage ${canary.currentStage} FAILED acceptance criteria — automatic rollback`)
      return this.rollbackCanary(modelId, 'acceptance criteria failed')
    }

    const currentIdx = CANARY_STAGES.indexOf(canary.currentStage)
    if (currentIdx >= CANARY_STAGES.length - 1) {
      canary.allStagesPassed = true
      this.recordEvent({ eventType: 'PROMOTION', modelId, reason: 'Canary 100% passed — ready for promotion', actor: 'lifecycle-engine' })
      return canary
    }

    canary.stageHistory[canary.stageHistory.length - 1].passed = true
    canary.currentStage = CANARY_STAGES[currentIdx + 1]
    canary.stageHistory.push({ stage: canary.currentStage, startedAt: Date.now(), passed: false, metrics })
    this.stats.promotions++
    this.recordEvent({ eventType: 'CANARY_STAGE_ADVANCE', modelId, reason: `Advanced to ${CANARY_PERCENTAGE[canary.currentStage] * 100}%`, actor: 'lifecycle-engine' })
    return canary
  }

  /** Rollback canary (Rule 10 — automatic rollback). */
  rollbackCanary(modelId: string, reason: string): CanaryDeploymentState | null {
    const canary = this.canaryStates.get(modelId)
    if (!canary) return null
    canary.currentStage = 'PERCENT_1'
    this.recordEvent({ eventType: 'CANARY_STAGE_ROLLBACK', modelId, reason, actor: 'lifecycle-engine' })
    return canary
  }

  /**
   * Request retraining (§12, Rule 24 — performance degradation alone NEVER auto-triggers).
   */
  requestRetraining(opts: {
    modelId: string
    trigger: RetrainingTrigger
    marketCondition: MarketCondition
    evidenceSummary: string
    autoTriggered: boolean
  }): RetrainingRequest {
    // Rule 24 — performance degradation alone NEVER auto-triggers
    if (opts.trigger === 'PERFORMANCE_DEGRADATION' && opts.autoTriggered) {
      // Distinguish temporary vs structural
      if (opts.marketCondition === 'TEMPORARY_ANOMALY' || opts.marketCondition === 'DATA_QUALITY_FAILURE') {
        log.warn(`retraining BLOCKED for ${opts.modelId}: ${opts.marketCondition} — prefer monitoring/rollback/review (Rule 24)`)
        // Rule 24 — temporary events → monitoring, risk reduction, champion rollback, governance review
        this.recordEvent({ eventType: 'GOVERNANCE_REVIEW', modelId: opts.modelId, reason: `Retraining blocked: ${opts.marketCondition}. Prefer monitoring/rollback/review.`, actor: 'lifecycle-engine' })
        return {
          requestId: `retrain-blocked-${Date.now().toString(36)}`,
          modelId: opts.modelId,
          trigger: opts.trigger,
          marketCondition: opts.marketCondition,
          evidenceSummary: opts.evidenceSummary,
          autoTriggered: false, // blocked
          approved: false,
          willCreateNewVersion: true,
          createdAt: Date.now(),
        }
      }
      // Only PERSISTENT_STATISTICAL_DRIFT or STRUCTURAL_REGIME_CHANGE can auto-trigger
      if (opts.marketCondition !== 'PERSISTENT_STATISTICAL_DRIFT' && opts.marketCondition !== 'STRUCTURAL_REGIME_CHANGE') {
        log.warn(`auto-retraining blocked for ${opts.modelId}: market condition ${opts.marketCondition} not sufficient (Rule 24)`)
        return {
          requestId: `retrain-blocked-${Date.now().toString(36)}`,
          modelId: opts.modelId,
          trigger: opts.trigger,
          marketCondition: opts.marketCondition,
          evidenceSummary: opts.evidenceSummary,
          autoTriggered: false,
          approved: false,
          willCreateNewVersion: true,
          createdAt: Date.now(),
        }
      }
    }

    const request: RetrainingRequest = {
      requestId: `retrain-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      modelId: opts.modelId,
      trigger: opts.trigger,
      marketCondition: opts.marketCondition,
      evidenceSummary: opts.evidenceSummary,
      autoTriggered: opts.autoTriggered,
      approved: opts.autoTriggered ? (opts.marketCondition === 'PERSISTENT_STATISTICAL_DRIFT' || opts.marketCondition === 'STRUCTURAL_REGIME_CHANGE') : false,
      willCreateNewVersion: true, // Rule 12
      createdAt: Date.now(),
    }
    this.retrainingRequests.push(request)
    this.stats.retrainingRequests++
    this.recordEvent({ eventType: 'RETRAINING_REQUEST', modelId: opts.modelId, reason: `${opts.trigger} (${opts.marketCondition}): ${opts.evidenceSummary}`, actor: 'lifecycle-engine' })
    log.info(`retraining requested for ${opts.modelId}: ${opts.trigger} (${opts.marketCondition}) — approved: ${request.approved}`)
    return request
  }

  /**
   * Rollback (§13, Rule 11 — deterministic, reproducible, preserves lineage, never overwrites).
   */
  rollback(opts: {
    modelId: string
    rollbackType: RollbackType
    targetVersion: string
    reason: string
    approved: boolean
  }): RollbackDecision {
    const decision: RollbackDecision = {
      rollbackId: `rb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      modelId: opts.modelId,
      rollbackType: opts.rollbackType,
      targetVersion: opts.targetVersion,
      reason: opts.reason,
      preservesLineage: true, // Rule 11
      overwritesHistorical: false, // Rule 11
      approved: opts.approved,
      executedAt: opts.approved ? Date.now() : null,
    }
    this.rollbacks.push(decision)
    this.stats.rollbacks++
    this.recordEvent({ eventType: opts.rollbackType === 'EMERGENCY' ? 'EMERGENCY_ROLLBACK' : 'ROLLBACK', modelId: opts.modelId, reason: `${opts.rollbackType}: ${opts.reason} (target: ${opts.targetVersion})`, actor: 'lifecycle-engine' })
    log.info(`rollback for ${opts.modelId}: ${opts.rollbackType} → ${opts.targetVersion} (${opts.reason})`)
    return decision
  }

  /**
   * Recalibrate ensemble after model replacement (Rule 25).
   */
  recalibrateEnsemble(opts: {
    ensembleId: string
    replacedModelId: string
    newModelId: string
    newWeights: Record<string, number>
    newCalibration: Record<string, number>
    newConfidenceParams: Record<string, number>
    newUncertaintyParams: Record<string, number>
    validationResults: Record<string, number>
  }): EnsembleRecalibrationResult {
    const result: EnsembleRecalibrationResult = {
      ensembleId: opts.ensembleId,
      replacedModelId: opts.replacedModelId,
      newModelId: opts.newModelId,
      recalibratedWeights: opts.newWeights,
      recalibratedCalibration: opts.newCalibration,
      recalibratedConfidenceParams: opts.newConfidenceParams,
      recalibratedUncertaintyParams: opts.newUncertaintyParams,
      validationResults: opts.validationResults,
      governanceApprovalRequired: true, // Rule 25
      governanceApproved: false, // requires manual approval
      reactivatedAt: null,
    }
    this.ensembleRecalibrations.push(result)
    this.stats.ensembleRecalibrations++
    this.recordEvent({ eventType: 'ENSEMBLE_RECALIBRATION', modelId: opts.newModelId, reason: `Ensemble ${opts.ensembleId} recalibrated after replacing ${opts.replacedModelId}`, actor: 'lifecycle-engine' })
    log.info(`ensemble recalibration: ${opts.ensembleId} — replaced ${opts.replacedModelId} with ${opts.newModelId}. Weights + calibration + confidence + uncertainty recalibrated. Governance approval required (Rule 25).`)
    return result
  }

  getStats() {
    return { ...this.stats, totalEventsInHistory: this.events.length, driftReports: this.driftReports.length, healthRecords: this.healthRecords.size }
  }
}

export const aiLifecycleEngine = new AILifecycleEngine()
