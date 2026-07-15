// CHAPTER 6.5 — AI Data Quality, Leakage Prevention & Research Validation Engine Types
//
// The AIDQLPRVE is the final research certification gateway between the AI
// Feature Selection Engine (Chapter 6.4) and the AI Model Training Engine (6.6).
// No model training may begin unless every validation stage has completed (§1).
//
// 24 architectural rules enforced (see §17) — the most of any chapter.
// Three execution environments: A (Runtime verify), B (Offline Research validate),
// C (Registry store). Rule 22/23 — Runtime never does heavy computation.

// ─────────────────────────────────────────────────────────────────────────────
// Research Pipelines  (§3, Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPipeline = 'SWING' | 'INSTANT_SCALPING'

// ─────────────────────────────────────────────────────────────────────────────
// Execution Environments  (§7, §13, Rule 22/23)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionEnvironment = 'RUNTIME' | 'OFFLINE_RESEARCH' | 'REGISTRY'

// ─────────────────────────────────────────────────────────────────────────────
// Certification Status  (§10, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export type CertificationStatus =
  | 'PASS' | 'PASS_WITH_WARNINGS' | 'REJECTED_LEAKAGE' | 'REJECTED_CORRUPTED' | 'FAIL'

// ─────────────────────────────────────────────────────────────────────────────
// Leakage Types  (§8 — 14 types)
// ─────────────────────────────────────────────────────────────────────────────

export type LeakageType =
  | 'LOOKAHEAD_BIAS' | 'FEATURE_LEAKAGE' | 'TARGET_LEAKAGE' | 'LABEL_LEAKAGE'
  | 'WINDOW_OVERLAP' | 'TRAIN_TEST_LEAKAGE' | 'VALIDATION_TEST_LEAKAGE'
  | 'WALK_FORWARD_LEAKAGE' | 'ROLLING_WINDOW_LEAKAGE' | 'INDEX_ALIGNMENT'
  | 'TIMESTAMP_BOUNDARY' | 'DATA_SNOOPING_BIAS' | 'MULTIPLE_HYPOTHESIS_TESTING'
  | 'RESEARCH_OVERFITTING'

export interface LeakageFinding {
  type: LeakageType
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  detectedAt: number
  /** Rule 16/17/18 — Any detected leakage immediately invalidates the artifact. */
  invalidatesArtifact: boolean
}

export interface LeakageAssessment {
  findings: LeakageFinding[]
  leakageDetected: boolean
  /** Rule 16 — Lookahead bias check. */
  lookaheadBiasDetected: boolean
  /** Rule 17 — Feature leakage check. */
  featureLeakageDetected: boolean
  /** Rule 18 — Target leakage check. */
  targetLeakageDetected: boolean
  assessedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Scores  (§9 — 12 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataQualityScores {
  datasetQuality: number // 0..1
  labelQuality: number // 0..1
  featureQuality: number // 0..1
  partitionIntegrity: number // 0..1
  windowIntegrity: number // 0..1
  chronologicalIntegrity: number // 0..1
  leakageRisk: number // 0..1 (lower = less risk)
  statisticalStability: number // 0..1
  researchIntegrity: number // 0..1
  temporalIntegrity: number // 0..1
  certificationConfidence: number // 0..1
  /** §9 — Overall Research Readiness Score (weighted aggregate). */
  researchReadinessScore: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Reports  (§7, §11, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationCheckResult {
  module: string // §7 — Dataset/Feature/Label/Statistical/Research Validation
  checkName: string
  passed: boolean
  details: string
  affectedComponents: string[]
}

export interface ValidationReport {
  /** §7 — All validation checks across 5 modules. */
  checks: ValidationCheckResult[]
  /** §7 — Dataset Validation (6 checks). */
  datasetValidationPassed: boolean
  /** §7 — Feature Validation (7 checks). */
  featureValidationPassed: boolean
  /** §7 — Label Validation (5 checks). */
  labelValidationPassed: boolean
  /** §7 — Statistical Validation (6 checks). */
  statisticalValidationPassed: boolean
  /** §7 — Research Validation (4 checks). */
  researchValidationPassed: boolean
  overallPassed: boolean
  checkedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

export interface IntegrityReport {
  schemaValid: boolean
  temporalIntegrityValid: boolean
  partitionIntegrityValid: boolean
  manifestIntegrityValid: boolean
  registryConsistencyValid: boolean
  verifiedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

export interface StatisticalReport {
  distributionShiftDetected: boolean
  covariateShiftDetected: boolean
  classImbalance: number
  outlierCount: number
  varianceStability: number
  correlationStability: number
  /** §7B — PSI (Population Stability Index) if computed offline. */
  psiScore: number | null
  /** §7B — KS test p-value if computed offline. */
  ksTestPValue: number | null
  analyzedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Certificate  (Rule 3, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationCertificate {
  /** Rule 3 — Every validation generates a Validation Certificate. */
  certificateId: string
  validationEventId: string
  /** §10 — Certification status (PASS / PASS_WITH_WARNINGS / REJECTED / FAIL). */
  certificationStatus: CertificationStatus
  /** §9 — Research Readiness Score. */
  researchReadinessScore: number
  /** §5 — Research pipeline. */
  researchPipeline: ResearchPipeline
  /** §11 — Versions of all validated artifacts. */
  datasetVersion: string
  labelVersion: string
  featureManifestVersion: string
  configurationVersion: string
  validationVersion: string
  /** §11 — Git commit hash for reproducibility. */
  gitCommitHash: string
  /** §11 — Research experiment ID. */
  researchExperimentId: string | null
  /** §11 — Training session ID (linked to future training). */
  trainingSessionId: string | null
  /** Rule 19 — Only PASS certificates allow model training. */
  trainingApproved: boolean
  /** Rule 19 — Only PASS-certified models enter Runtime (Environment A). */
  runtimeAdmissionApproved: boolean
  /** Rule 24 — Hash of all validated artifacts (for invalidation on modification). */
  artifactFingerprint: string
  issuedAt: number
  expiresAt: number | null
  /** Rule 24 — Whether this certificate has been invalidated by artifact modification. */
  invalidated: boolean
  /** Rule 4 — immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Lineage  (Rule 4, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationLineage {
  sourceDatasetEventIds: string[]
  sourceDatasetVersions: string[]
  sourceLabelEventIds: string[]
  sourceLabelVersions: string[]
  sourceFeatureManifestIds: string[]
  sourceFeatureManifestVersions: string[]
  sourceDatasetRegistryEntryIds: string[]
  sourceLabelRegistryEntryIds: string[]
  sourceFeatureRegistryEntryIds: string[]
  researchConfigurationVersionIds: string[]
  governanceEventIds: string[]
  registryEntryIds: string[]
  upstreamEngines: string[]
  /** Rule 5 — Validation never modifies source artifacts. */
  sourceDatasetsModified: false
  sourceLabelsModified: false
  sourceFeaturesModified: false
  sourceManifestsModified: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Governance Metadata  (§12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
  validationHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  reviewNotes: string[]
  publicationTimestamp: number | null
  governanceNotes: string[]
  /** Rule 7 — Cross-pipeline validation approval. */
  crossPipelineApproved: boolean
  /** §10 — PASS_WITH_WARNINGS requires explicit governance approval. */
  warningsApproved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Validation Contract  (§5, Rule 2/3/4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalValidationContract {
  /** Rule 2 — Unique Validation Event ID. */
  validationEventId: string
  /** Rule 3 — Validation Certificate. */
  certificate: ValidationCertificate
  /** §5 — Validation report. */
  validationReport: ValidationReport
  /** §5 — Leakage assessment. */
  leakageAssessment: LeakageAssessment
  /** §5 — Data quality scores. */
  qualityScores: DataQualityScores
  /** §5 — Integrity report. */
  integrityReport: IntegrityReport
  /** §5 — Statistical report. */
  statisticalReport: StatisticalReport
  /** §5 — Lineage metadata. */
  lineage: ValidationLineage
  /** §5 — Governance metadata. */
  governanceMetadata: ValidationGovernanceMetadata
  /** §5 — Research pipeline. */
  researchPipeline: ResearchPipeline
  /** §13 — Execution environment (B for offline validation). */
  executionEnvironment: ExecutionEnvironment
  /** §6 — Pipeline stages executed. */
  pipelineStages: Array<{
    stage: string
    startedAt: number
    completedAt: number
    durationMs: number
    success: boolean
  }>
  /** Rule 4 — Immutable creation timestamp. */
  createdAt: number
  /** Rule 20 — Content hash for reproducibility. */
  contentHash: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Registry Entry  (§11, Rule 4, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationRegistryEntry {
  /** §11 — Validation ID. */
  validationId: string
  /** §11 — Dataset version. */
  datasetVersion: string
  /** §11 — Label version. */
  labelVersion: string
  /** §11 — Feature manifest version. */
  featureManifestVersion: string
  /** §11 — Configuration version. */
  configurationVersion: string
  /** §11 — Validation version. */
  validationVersion: string
  /** §11 — Validation timestamp. */
  validationTimestamp: number
  /** §11 — Research score. */
  researchScore: number
  /** §11 — Leakage assessment (summary). */
  leakageAssessment: { leakageDetected: boolean; findingCount: number }
  /** §11 — Certification status. */
  certificationStatus: CertificationStatus
  /** §11 — Governance status. */
  governanceStatus: string
  /** §11 — Git commit hash. */
  gitCommitHash: string
  /** §11 — Research experiment ID. */
  researchExperimentId: string | null
  /** §11 — Training session ID. */
  trainingSessionId: string | null
  /** Link to validation event. */
  validationEventId: string
  /** Link to certificate. */
  certificateId: string
  /** Rule 4/16 — Immutable after publication. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationConfiguration {
  researchPipeline: ResearchPipeline
  /** §13 — Execution environment (OFFLINE_RESEARCH for full validation). */
  executionEnvironment: ExecutionEnvironment
  /** Source artifact IDs to validate (Rule 1 — only governance-approved). */
  sourceDatasetEventIds: string[]
  sourceLabelEventIds: string[]
  sourceFeatureManifestIds: string[]
  /** §9 — Quality thresholds. */
  qualityThresholds: {
    minResearchReadinessScore: number
    maxLeakageRisk: number
    minPartitionIntegrity: number
    maxClassImbalance: number
  }
  /** §8 — Leakage detection enabled. */
  leakageDetectionEnabled: boolean
  /** Rule 7 — Cross-pipeline validation (requires governance approval). */
  crossPipelineApproved: boolean
  /** §11 — Git commit hash. */
  gitCommitHash: string
  /** §11 — Research experiment ID. */
  researchExperimentId: string | null
  /** Rule 12 — Partition data for validation. */
  partitions: {
    train: { timestamps: number[]; recordCount: number }
    validation: { timestamps: number[]; recordCount: number }
    test: { timestamps: number[]; recordCount: number }
  }
  /** Rule 12 — Verify mutual exclusivity. */
  enforceMutualExclusivity: boolean
  /** Rule 13 — Walk-forward window overlap check. */
  walkForwardWindows: Array<{ start: number; end: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Input Contract  (§4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationInput {
  /** §4 — Approved datasets (from Ch 6.2). */
  approvedDatasets: Array<{ datasetEventId: string; version: string; registryEntryId: string }>
  /** §4 — Approved label sets (from Ch 6.3). */
  approvedLabels: Array<{ labelEventId: string; version: string; registryEntryId: string }>
  /** §4 — Approved feature manifests (from Ch 6.4). */
  approvedFeatureManifests: Array<{ manifestId: string; version: string; registryEntryId: string }>
  /** §4 — Dataset registry. */
  datasetRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Label registry. */
  labelRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Feature registry. */
  featureRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Research configuration. */
  researchConfiguration: Array<{ researchId: string; version: string }>
  /** §4 — Validation configuration. */
  validationConfiguration: Array<{ configId: string; version: string }>
  /** §4 — Governance metadata. */
  governanceMetadata: Array<{ governanceId: string; version: string }>
  /** §4 — Asset metadata. */
  assetMetadata: Array<{ assetId: string; version: string }>
  /** Rule 5 — Validation never modifies source artifacts. */
  sourceArtifactsModified: false
  /** §4 — Never consumes predictions, live market data, trading orders, etc. */
  predictionsConsumed: false
  liveMarketDataConsumed: false
  tradingOrdersConsumed: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AIDQLPRVEConfiguration {
  /** Rule 7 — Enforce ecosystem isolation. */
  enforceEcosystemIsolation: boolean
  /** Rule 8/9/10/16/17/18 — Enforce leakage prevention. */
  enforceLeakagePrevention: boolean
  /** Rule 12 — Enforce partition mutual exclusivity. */
  enforcePartitionExclusivity: boolean
  /** Rule 13 — Enforce walk-forward non-overlap. */
  enforceWalkForwardNonOverlap: boolean
  /** Rule 19 — Only PASS allows training. */
  enforcePassRequiredForTraining: boolean
  /** Rule 22/23 — Runtime never does heavy computation. */
  enforceRuntimeNoHeavyComputation: boolean
  /** Rule 24 — Artifact modification invalidates certificates. */
  enforceModificationInvalidation: boolean
  /** Rule 20 — Enable deterministic replay. */
  enableDeterministicReplay: boolean
  /** §9 — Default quality thresholds. */
  qualityThresholds: {
    minResearchReadinessScore: number
    maxLeakageRisk: number
    minPartitionIntegrity: number
    maxClassImbalance: number
  }
  /** §14 — Observability enabled. */
  observabilityEnabled: boolean
}

export const DEFAULT_AIDQLPRVE_CONFIG: AIDQLPRVEConfiguration = {
  enforceEcosystemIsolation: true,
  enforceLeakagePrevention: true,
  enforcePartitionExclusivity: true,
  enforceWalkForwardNonOverlap: true,
  enforcePassRequiredForTraining: true,
  enforceRuntimeNoHeavyComputation: true,
  enforceModificationInvalidation: true,
  enableDeterministicReplay: true,
  qualityThresholds: {
    minResearchReadinessScore: 0.75,
    maxLeakageRisk: 0.1,
    minPartitionIntegrity: 0.95,
    maxClassImbalance: 0.8,
  },
  observabilityEnabled: true,
}

// Pipeline Stages (§6)
export const VALIDATION_STAGES = [
  'DATASET_RETRIEVAL',
  'LABEL_RETRIEVAL',
  'FEATURE_MANIFEST_RETRIEVAL',
  'CONFIGURATION_VALIDATION',
  'SCHEMA_VALIDATION',
  'TEMPORAL_VALIDATION',
  'DATA_QUALITY_VALIDATION',
  'LEAKAGE_DETECTION',
  'PARTITION_VALIDATION',
  'STATISTICAL_VALIDATION',
  'RESEARCH_INTEGRITY_VALIDATION',
  'RESEARCH_READINESS_SCORING',
  'GOVERNANCE_VALIDATION',
  'VALIDATION_CERTIFICATE_GENERATION',
  'REGISTRY_PUBLICATION',
] as const

export const AIDQLPRVE_VERSION = '1.0.0'
export const RESEARCH_VALIDATION_SCHEMA_VERSION = '1.0.0'
