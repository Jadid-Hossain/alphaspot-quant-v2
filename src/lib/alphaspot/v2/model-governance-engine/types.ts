// CHAPTER 5.22 — AI Model Governance Engine Types
//
// The AMGE is the exclusive authority for determining which AI models are
// eligible for Research, Backtesting, Paper Trading, Shadow Execution,
// Production Prediction, and Automated Trading (§1).
//
// 20 architectural rules enforced (see §17).
// Dual pipeline: Onboarding (15 stages) + Continuous Governance (10 stages).

// ─────────────────────────────────────────────────────────────────────────────
// Model Lifecycle States  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type ModelStatus =
  | 'RESEARCH' | 'EXPERIMENTAL' | 'CANDIDATE' | 'CHALLENGER'
  | 'CHAMPION' | 'PRODUCTION' | 'DEPRECATED' | 'RETIRED' | 'ARCHIVED'

// ─────────────────────────────────────────────────────────────────────────────
// Deployment Eligibility  (§4, Rule 7/16/17)
// ─────────────────────────────────────────────────────────────────────────────

export type DeploymentEligibility =
  | 'ELIGIBLE_PRODUCTION' | 'ELIGIBLE_PAPER_TRADING' | 'ELIGIBLE_BACKTESTING'
  | 'ELIGIBLE_RESEARCH' | 'INELIGIBLE' | 'QUARANTINED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'REVOKED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// Drift Types  (§9, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export type DriftType =
  | 'FEATURE_DRIFT' | 'DATA_DRIFT' | 'PREDICTION_DRIFT' | 'CONCEPT_DRIFT'
  | 'PERFORMANCE_DRIFT' | 'CONFIDENCE_DRIFT' | 'REGIME_DRIFT'

export interface DriftResult {
  type: DriftType
  driftScore: number // 0..1
  threshold: number
  triggered: boolean
  detectedAt: number
  /** Rule 13 — Generates immutable governance event. */
  governanceEventGenerated: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Certification  (§8, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface PerformanceCertification {
  accuracy: number
  precision: number
  recall: number
  f1Score: number
  rocAuc: number
  tradingAccuracy: number
  profitability: number
  maxDrawdown: number
  sharpeRatio: number
  stabilityScore: number
  robustnessScore: number
  stressTestPassed: boolean
  /** Rule 16 — Performance certification precedes production approval. */
  certified: boolean
  certificationVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Artifact  (Rule 1/9/18)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelArtifact {
  modelId: string
  modelVersion: string
  /** Rule 9 — Cryptographic signature. */
  artifactSignature: string
  /** Rule 18 — Immutable artifact hash. */
  artifactHash: string
  modelType: string
  modelArchitecture: string
  trainingConfig: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  featureCompatibilityVersion: string
  datasetCompatibilityVersion: string
  explainabilityReportId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Champion-Challenger  (§10, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChampionChallengerComparison {
  championModelId: string
  challengerModelId: string
  championPerformance: number
  challengerPerformance: number
  performanceDelta: number
  championApproved: boolean
  challengerPromoted: boolean
  /** Rule 8 — Logically independent while sharing identical feature inputs. */
  sharedFeatureInputs: boolean
  evaluatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance Deployment Signature  (Rule 7/9)
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceDeploymentSignature {
  signatureId: string
  modelId: string
  modelVersion: string
  /** Rule 9 — Cryptographic signature. */
  signature: string
  issuedAt: number
  expiresAt: number | null
  revokedAt: number | null
  /** Rule 7 — Cryptographically verified before production loading. */
  valid: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineage + Version + Governance  (§6, §11, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelLineage {
  modelArtifactHash: string
  featureVersion: string
  datasetVersion: string
  configurationVersion: string
  explainabilityReportId: string | null
  validationResultId: string
  backtestingResultId: string | null
  paperTradingResultId: string | null
  governanceVersion: string
}

export interface ModelVersionBundle {
  modelVersion: string
  datasetVersion: string
  featureVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface ModelGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  publicationTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Model Governance Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalModelGovernanceContract {
  modelGovernanceEventId: string // Rule 3
  modelVersion: string
  modelId: string
  governanceTimestamp: number

  // §6 — Canonical Model Governance Contract fields
  modelStatus: ModelStatus
  deploymentEligibility: DeploymentEligibility
  isChampion: boolean
  isChallenger: boolean
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  performanceCertification: PerformanceCertification
  featureCompatibilityVersion: string
  datasetCompatibilityVersion: string
  deploymentSignature: GovernanceDeploymentSignature | null
  driftResults: DriftResult[]
  championChallengerComparisons: ChampionChallengerComparison[]

  // Metadata + Governance
  modelMetadata: {
    modelGovernanceEventId: string
    versions: ModelVersionBundle
    lineage: ModelLineage
    pipelineType: 'ONBOARDING' | 'CONTINUOUS_GOVERNANCE'
  }
  governanceMetadata: ModelGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelGovernanceConfiguration {
  /** Rule 7 — Require deployment signature for production. */
  requireDeploymentSignature: boolean
  /** Rule 9 — Require cryptographic model signing. */
  requireModelSigning: boolean
  /** Rule 10 — Require feature compatibility validation. */
  requireFeatureCompatibility: boolean
  /** Rule 16 — Performance certification thresholds. */
  performanceThresholds: {
    minAccuracy: number
    minSharpeRatio: number
    maxDrawdown: number
    minStabilityScore: number
    minRobustnessScore: number
  }
  /** §9 — Drift thresholds. */
  driftThresholds: {
    featureDrift: number
    performanceDrift: number
    predictionDrift: number
  }
  /** §10 — Champion-challenger promotion rules. */
  championPromotionMargin: number
  /** Rule 17 — Fail-closed: governance failures never partially approved. */
  failClosed: boolean
  versions: ModelVersionBundle
}

export const DEFAULT_AMGE_CONFIG: Omit<ModelGovernanceConfiguration, 'versions'> = {
  requireDeploymentSignature: true,
  requireModelSigning: true,
  requireFeatureCompatibility: true,
  performanceThresholds: {
    minAccuracy: 0.55,
    minSharpeRatio: 0.5,
    maxDrawdown: 0.25,
    minStabilityScore: 0.7,
    minRobustnessScore: 0.65,
  },
  driftThresholds: { featureDrift: 0.3, performanceDrift: 0.2, predictionDrift: 0.25 },
  championPromotionMargin: 0.05,
  failClosed: true,
}

// Pipeline Stages
export const ONBOARDING_STAGES = [
  'MODEL_REGISTRATION', 'ARTIFACT_INTEGRITY_VALIDATION', 'SIGNATURE_VERIFICATION',
  'FEATURE_COMPATIBILITY_VALIDATION', 'DATASET_COMPATIBILITY_VALIDATION',
  'PERFORMANCE_VALIDATION', 'BACKTESTING_CERTIFICATION', 'PAPER_TRADING_CERTIFICATION',
  'GOVERNANCE_REVIEW', 'DEPLOYMENT_ELIGIBILITY_ASSESSMENT',
  'CHAMPION_CHALLENGER_EVALUATION', 'APPROVAL_DECISION',
  'DEPLOYMENT_SIGNATURE_GENERATION', 'MODEL_PUBLICATION', 'GOVERNANCE_COMPLETION',
] as const

export const CONTINUOUS_STAGES = [
  'LIVE_PERFORMANCE_MONITORING', 'DRIFT_DETECTION', 'PERFORMANCE_THRESHOLD_EVALUATION',
  'CHAMPION_CHALLENGER_REASSESSMENT', 'GOVERNANCE_POLICY_EVALUATION',
  'PROMOTION_DEMOTION_DECISION', 'SIGNATURE_UPDATE_OR_REVOCATION',
  'STATUS_PUBLICATION', 'METADATA_RECORDING', 'CONTINUOUS_GOVERNANCE_COMPLETION',
] as const

export const AMGE_VERSION = '1.0.0'
export const MODEL_GOVERNANCE_SCHEMA_VERSION = '1.0.0'
