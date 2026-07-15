// CHAPTER 4.12 — AI Lifecycle Management & Continuous Learning Types
//
// The MLOps Operating System. Governs production models from deployment to retirement.
// Every model: monitored, measurable, reproducible, reversible, governed (§2).
// No production model is permanent. 25 architectural rules.

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle Events  (Chapter 4.12 §4, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export type LifecycleEventType =
  | 'DEPLOYMENT'
  | 'PROMOTION'
  | 'ROLLBACK'
  | 'RETRAINING_REQUEST'
  | 'RETRAINING_COMPLETE'
  | 'CANARY_STAGE_ADVANCE'
  | 'CANARY_STAGE_ROLLBACK'
  | 'SHADOW_START'
  | 'SHADOW_STOP'
  | 'DRIFT_DETECTED'
  | 'HEALTH_DEGRADED'
  | 'RETIREMENT'
  | 'GOVERNANCE_REVIEW'
  | 'EMERGENCY_ROLLBACK'
  | 'ENSEMBLE_RECALIBRATION'

export interface LifecycleEvent {
  eventId: string
  eventType: LifecycleEventType
  modelId: string
  timestamp: number
  reason: string
  actor: string
  metadata: Record<string, unknown>
  // Rule 4 — complete audit lineage
  auditLineage: Array<{ action: string; at: number; actor: string; note: string }>
  // Rule 20 — immutable
  version: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Drift Types  (Chapter 4.12 §6, Rule 6 — all independent)
// ─────────────────────────────────────────────────────────────────────────────

export type DriftType =
  | 'CONCEPT_DRIFT'
  | 'FEATURE_DRIFT'
  | 'LABEL_DRIFT'
  | 'PREDICTION_DRIFT'
  | 'COVARIATE_DRIFT'
  | 'ATTRIBUTION_DRIFT'
  | 'REGIME_DRIFT'
  | 'DATA_DRIFT'
  | 'POPULATION_DRIFT'

export interface DriftReport {
  driftType: DriftType
  modelId: string
  driftScore: number // 0..1
  threshold: number
  isDrifting: boolean
  isSignificant: boolean
  detectedAt: number
  // Rule 6 — detection in one category never implies another
  independent: true
  // Rule 24 — drift alone doesn't trigger retraining
  autoRetrainingTriggered: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Health  (Chapter 4.12 §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelHealth {
  modelId: string
  accuracyDegradation: number // 0..1 (0 = no degradation)
  calibrationDegradation: number // 0..1
  latencyMs: number
  resourceUsage: { cpuPct: number; memoryMb: number; gpuPct: number | null }
  errorRate: number // 0..1
  predictionStability: number // 0..1
  confidenceStability: number // 0..1
  uncertaintyStability: number // 0..1
  healthScore: number // 0..1 (1 = healthy)
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  monitoredAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Continuous Validation + Label Embargo  (Chapter 4.12 §8, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelEmbargoState {
  predictionId: string
  predictionTimestamp: number
  predictionHorizonMs: number
  embargoEndsAt: number // predictionTimestamp + horizonMs
  isSettled: boolean // true only after embargo ends AND ground truth available
  groundTruthLabel: number | null // null until settled
}

export interface ContinuousValidationResult {
  modelId: string
  rollingValidationScore: number | null
  shadowValidationScore: number | null
  delayedGroundTruthScore: number | null
  calibrationMonitoring: number | null
  confidenceMonitoring: number | null
  predictionStabilityMonitoring: number | null
  statisticalSignificance: { pValue: number; significant: boolean } | null
  // Rule 23 — label embargo enforced
  labelEmbargoEnforced: true
  settledObservations: number
  pendingObservations: number
  // Rule 17 — independent from production inference
  independentFromProduction: true
  validatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Champion/Challenger  (Chapter 4.12 §9, Rule 7, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export type DeploymentRole = 'CHAMPION' | 'CHALLENGER' | 'SHADOW' | 'OFFLINE_CANDIDATE'

export interface ChampionChallengerState {
  championModelId: string
  challengerModelId: string | null
  shadowModelIds: string[]
  comparisonResult: {
    championScore: number
    challengerScore: number | null
    statisticalComparison: { pValue: number; significant: boolean } | null
    automaticBenchmarking: boolean
  } | null
  // Rule 7 — mandatory before promotion
  evaluationComplete: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canary Deployment  (Chapter 4.12 §10, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export type CanaryStage = 'PERCENT_1' | 'PERCENT_5' | 'PERCENT_10' | 'PERCENT_25' | 'PERCENT_50' | 'PERCENT_100'

export const CANARY_STAGES: CanaryStage[] = ['PERCENT_1', 'PERCENT_5', 'PERCENT_10', 'PERCENT_25', 'PERCENT_50', 'PERCENT_100']

export const CANARY_PERCENTAGE: Record<CanaryStage, number> = {
  PERCENT_1: 0.01, PERCENT_5: 0.05, PERCENT_10: 0.10, PERCENT_25: 0.25, PERCENT_50: 0.50, PERCENT_100: 1.0,
}

export interface CanaryDeploymentState {
  modelId: string
  currentStage: CanaryStage
  stageHistory: Array<{ stage: CanaryStage; startedAt: number; passed: boolean; metrics: Record<string, number> }>
  acceptanceCriteria: Record<string, number>
  automaticRollbackEnabled: boolean
  // Rule 9 — staged deployment
  allStagesPassed: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow Deployment  (Chapter 4.12 §11, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowDeployment {
  modelId: string
  championModelId: string
  receivesIdenticalInputs: true // Rule 16
  influencesProduction: false // Rule 16
  predictionsGenerated: number
  performanceRecorded: boolean
  startedAt: number
  stoppedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Retraining Orchestration  (Chapter 4.12 §12, Rule 24)
// ─────────────────────────────────────────────────────────────────────────────

export type RetrainingTrigger =
  | 'PERFORMANCE_DEGRADATION'
  | 'CONCEPT_DRIFT'
  | 'FEATURE_DRIFT'
  | 'CALIBRATION_FAILURE'
  | 'GOVERNANCE_REQUEST'
  | 'SCHEDULED_RETRAINING'
  | 'MANUAL_REQUEST'
  | 'INFRASTRUCTURE_MIGRATION'

export type MarketCondition =
  | 'TEMPORARY_ANOMALY'
  | 'STRUCTURAL_REGIME_CHANGE'
  | 'DATA_QUALITY_FAILURE'
  | 'PERSISTENT_STATISTICAL_DRIFT'

export interface RetrainingRequest {
  requestId: string
  modelId: string
  trigger: RetrainingTrigger
  // Rule 24 — distinguish temporary vs structural
  marketCondition: MarketCondition
  evidenceSummary: string
  // Rule 24 — performance degradation alone NEVER auto-triggers
  autoTriggered: boolean
  approved: boolean
  // Rule 12 — new immutable version
  willCreateNewVersion: true
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback  (Chapter 4.12 §13, Rule 11, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export type RollbackType = 'AUTOMATIC' | 'MANUAL' | 'VERSION' | 'EMERGENCY' | 'HISTORICAL_RESTORATION'

export interface RollbackDecision {
  rollbackId: string
  modelId: string
  rollbackType: RollbackType
  targetVersion: string
  reason: string
  // Rule 11 — deterministic, reproducible, preserves lineage
  preservesLineage: true
  // Rule 11 — never overwrites historical artifacts
  overwritesHistorical: false
  approved: boolean
  executedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Retirement  (Chapter 4.12 §14, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export type RetirementState = 'DEPRECATED' | 'RETIRED' | 'ARCHIVED' | 'HISTORICAL' | 'FROZEN'

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Recalibration  (Chapter 4.12 Rule 25)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsembleRecalibrationResult {
  ensembleId: string
  replacedModelId: string
  newModelId: string
  recalibratedWeights: Record<string, number>
  recalibratedCalibration: Record<string, number>
  recalibratedConfidenceParams: Record<string, number>
  recalibratedUncertaintyParams: Record<string, number>
  validationResults: Record<string, number>
  governanceApprovalRequired: true // Rule 25
  governanceApproved: boolean
  reactivatedAt: number | null
}

export const LIFECYCLE_VERSION = '1.0.0'
