// CHAPTER 6.4 — AI Feature Selection & Feature Intelligence Engine Types
//
// The AFSFIE is the exclusive feature optimization layer between the AI Label
// Engineering Engine (Chapter 6.3) and every downstream AI Training Engine.
// No AI model may independently select or discard features (§1).
//
// 22 architectural rules enforced (see §17), including the critical:
//   Rule 21 — Feature selection ONLY on TRAIN partition (no val/test leakage)
//   Rule 22 — Runtime consumes only immutable Feature Manifests (no heavy compute)
// Dual feature ecosystems: Swing + Instant Scalping.

// ─────────────────────────────────────────────────────────────────────────────
// Research Pipelines  (§3, Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPipeline = 'SWING' | 'INSTANT_SCALPING'

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Environments  (§7, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationEnvironment = 'LOCAL_RUNTIME' | 'OFFLINE_RESEARCH'

/** §7A — Local Runtime Feature Evaluation methods (lightweight). */
export type LocalEvaluationMethod =
  | 'VARIANCE_THRESHOLD' | 'CORRELATION_FILTERING' | 'MISSING_VALUE_FILTERING'
  | 'CONSTANT_FEATURE_DETECTION' | 'DUPLICATE_FEATURE_DETECTION'
  | 'BASIC_INFORMATION_GAIN' | 'MUTUAL_INFORMATION'
  | 'STATISTICAL_STABILITY_ANALYSIS' | 'TEMPORAL_STABILITY_ANALYSIS'

/** §7B — Offline Research Feature Evaluation methods (Python/Colab — heavy). */
export type OfflineResearchMethod =
  | 'SHAP' | 'BORUTA' | 'RFE' | 'SEQUENTIAL_FORWARD_SELECTION'
  | 'SEQUENTIAL_BACKWARD_SELECTION' | 'TREE_BASED_IMPORTANCE'
  | 'L1_REGULARIZATION' | 'MRMR' | 'PERMUTATION_IMPORTANCE'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Categories  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  // Swing pipeline categories (§3 Pipeline A)
  | 'TREND' | 'MOMENTUM' | 'VOLATILITY' | 'MACRO' | 'CROSS_ASSET_CORRELATION'
  | 'MARKET_REGIME' | 'ALTERNATIVE_DATA' | 'LIQUIDITY' | 'LONG_TERM_STATISTICAL'
  // Scalping pipeline categories (§3 Pipeline B)
  | 'ORDER_BOOK' | 'TRADE_FLOW' | 'MICROSTRUCTURE' | 'SPREAD_DYNAMICS'
  | 'LIQUIDITY_IMBALANCE' | 'QUEUE_POSITION' | 'EXECUTION_COST'
  | 'SHORT_TERM_MOMENTUM' | 'LATENCY_AWARE'

// ─────────────────────────────────────────────────────────────────────────────
// Statuses  (§5, Rule 4/13/16)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT' | 'VALIDATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PUBLISHED' | 'REJECTED' | 'QUARANTINED' | 'RECALLED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Descriptor  (Rule 17 — pluggable)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureDescriptor {
  featureId: string
  name: string
  category: FeatureCategory
  /** Allowed pipelines (Rule 7 — ecosystem isolation). */
  allowedPipelines: ResearchPipeline[]
  valueType: 'NUMBER' | 'BOOLEAN' | 'CATEGORICAL'
  unit: string | null
  description: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Quality Scores  (§8)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureQualityScore {
  featureId: string
  /** §8 — 11 quality dimensions. */
  predictivePower: number // 0..1
  featureStability: number // 0..1
  temporalStability: number // 0..1
  noiseSensitivity: number // 0..1 (lower = less sensitive)
  missingValueRate: number // 0..1
  correlationStrength: number // 0..1
  featureRedundancy: number // 0..1 (lower = less redundant)
  informationDensity: number // 0..1
  distributionStability: number // 0..1
  marketRegimeRobustness: number // 0..1
  crossAssetRobustness: number // 0..1
  /** Overall quality score (weighted average). */
  overallScore: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation Report  (§5, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrelationPair {
  featureA: string
  featureB: string
  correlation: number // -1..1
  /** Whether this pair exceeds the correlation threshold. */
  exceedsThreshold: boolean
}

export interface CorrelationReport {
  pairs: CorrelationPair[]
  maxAbsoluteCorrelation: number
  /** Features recommended for removal due to high correlation. */
  highCorrelationFeatures: string[]
  threshold: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Redundancy Report  (§5, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface RedundancyReport {
  /** Groups of redundant features. */
  redundantGroups: Array<{ features: string[]; representativeFeature: string }>
  redundantFeatureCount: number
  /** Features recommended for removal. */
  removedFeatures: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Importance Rankings  (§5, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureImportanceRanking {
  featureId: string
  importance: number // 0..1
  rank: number // 1-based
  /** §7 — Method used to compute importance. */
  method: LocalEvaluationMethod | OfflineResearchMethod
}

export interface FeatureImportanceSnapshot {
  rankings: FeatureImportanceRanking[]
  /** Rule 19 — Importance rankings version controlled. */
  rankingVersion: string
  /** §7 — Environment where importance was computed. */
  evaluationEnvironment: EvaluationEnvironment
  /** §7 — Method used (local or offline). */
  selectionMethod: string
  computedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Stability Scores  (§5, §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureStabilityScore {
  featureId: string
  statisticalStability: number // 0..1
  temporalStability: number // 0..1
  /** Overall stability (weighted average). */
  overallStability: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Report  (§11, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureValidationCheck {
  checkName: string
  passed: boolean
  details: string
  affectedFeatures: string[]
}

export interface FeatureValidationReport {
  /** §11 — 9 validation checks. */
  checks: FeatureValidationCheck[]
  /** Rule 21 — Verified that selection used TRAIN partition only. */
  trainOnlySelectionVerified: boolean
  overallPassed: boolean
  checkedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Manifest  (Rule 14, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureManifest {
  /** Rule 14 — Every published feature set generates a complete manifest. */
  manifestId: string
  featureSetIdentifier: string
  featureSetVersion: string
  selectedFeatures: string[]
  importanceSnapshot: FeatureImportanceSnapshot
  qualityScores: FeatureQualityScore[]
  stabilityScores: FeatureStabilityScore[]
  correlationReport: CorrelationReport
  redundancyReport: RedundancyReport
  /** Rule 22 — Runtime consumes this manifest (no heavy computation). */
  runtimeConsumable: true
  contentHash: string
  generatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Lineage  (Rule 5, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureLineage {
  /** Rule 5 — Complete lineage linking datasets, labels, configurations,
   *  governance metadata, registry records, and publication metadata. */
  sourceDatasetEventIds: string[]
  sourceDatasetVersions: string[]
  sourceLabelEventIds: string[]
  sourceLabelVersions: string[]
  sourceDatasetRegistryEntryIds: string[]
  sourceLabelRegistryEntryIds: string[]
  sourceFeatureMetadataVersions: string[]
  researchConfigurationVersionIds: string[]
  governanceEventIds: string[]
  registryEntryIds: string[]
  publicationMetadataIds: string[]
  upstreamEngines: string[]
  /** Rule 6 — Feature selection never modifies source datasets or labels. */
  sourceDatasetsModified: false
  sourceLabelsModified: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Version Bundle  (§10, Rule 4/19)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureVersionBundle {
  featureVersion: string
  datasetVersion: string
  labelVersion: string
  configurationVersion: string
  pipelineVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Governance Metadata  (§12)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  reviewHistory: Array<{
    action: string
    at: number
    actor: string
    note: string
    outcome: string
  }>
  auditHistory: Array<{
    action: string
    at: number
    actor: string
    note: string
    before?: unknown
    after?: unknown
  }>
  creationTimestamp: number
  publicationTimestamp: number | null
  governanceNotes: string[]
  /** Rule 7 — Cross-pipeline feature selection approval. */
  crossPipelineApproved: boolean
  /** §9 — Approval reviewer. */
  approvalReviewer: string
  /** §9 — Research experiment identifier. */
  researchExperimentId: string | null
  /** §9 — Research environment (LOCAL_RUNTIME or OFFLINE_RESEARCH). */
  researchEnvironment: EvaluationEnvironment
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Feature Selection Contract  (§5, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalFeatureSelectionContract {
  /** Rule 2 — Unique Feature Event ID. */
  featureEventId: string
  /** §5 — Feature set identifier. */
  featureSetIdentifier: string
  /** §5 — Feature set version. */
  featureSetVersion: string
  /** §5 — Research pipeline. */
  researchPipeline: ResearchPipeline
  /** §5 — Selected feature list. */
  selectedFeatures: string[]
  /** §5 — Feature importance rankings (Rule 19). */
  importanceRankings: FeatureImportanceSnapshot
  /** §5 — Feature quality scores. */
  qualityScores: FeatureQualityScore[]
  /** §5 — Feature stability scores. */
  stabilityScores: FeatureStabilityScore[]
  /** §5 — Correlation report. */
  correlationReport: CorrelationReport
  /** §5 — Redundancy report. */
  redundancyReport: RedundancyReport
  /** §5 — Validation report. */
  validationReport: FeatureValidationReport
  /** §5 — Configuration version. */
  configurationVersion: string
  /** §5 — Lineage metadata. */
  lineage: FeatureLineage
  /** §5 — Governance metadata. */
  governanceMetadata: FeatureGovernanceMetadata
  /** §5 — Publication status. */
  publicationStatus: PublicationStatus
  /** §5 — Feature manifest (Rule 14, Rule 22). */
  featureManifest: FeatureManifest
  /** §7 — Evaluation environment (LOCAL_RUNTIME or OFFLINE_RESEARCH). */
  evaluationEnvironment: EvaluationEnvironment
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
  /** Rule 11/18 — Content hash for deterministic replay. */
  contentHash: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Registry Entry  (§9, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureRegistryEntry {
  /** §9 — Feature set identifier. */
  featureSetIdentifier: string
  /** §9 — Feature set version. */
  featureSetVersion: string
  /** §9 — Dataset version. */
  datasetVersion: string
  /** §9 — Label version. */
  labelVersion: string
  /** §9 — Selection method. */
  selectionMethod: string
  /** §9 — Configuration version. */
  configurationVersion: string
  /** §9 — Creation timestamp. */
  creationTimestamp: number
  /** §9 — Governance status. */
  governanceStatus: ApprovalStatus
  /** §9 — Quality score. */
  qualityScore: number
  /** §9 — Storage location. */
  storageLocation: string
  /** §9 — Feature selection method. */
  featureSelectionMethod: string
  /** §9 — Feature importance snapshot. */
  featureImportanceSnapshot: FeatureImportanceSnapshot
  /** §9 — Research experiment identifier. */
  researchExperimentId: string | null
  /** §9 — Research environment. */
  researchEnvironment: EvaluationEnvironment
  /** §9 — Approval reviewer. */
  approvalReviewer: string
  /** §9 — Feature manifest identifier. */
  featureManifestId: string
  /** §9 — Feature event ID (link back to contract). */
  featureEventId: string
  /** Rule 16 — Immutable after publication. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Selection Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureSelectionConfiguration {
  featureSetIdentifier: string
  researchPipeline: ResearchPipeline
  /** §7 — Evaluation environment (LOCAL_RUNTIME or OFFLINE_RESEARCH). */
  evaluationEnvironment: EvaluationEnvironment
  /** §7 — Selection methods to apply. */
  selectionMethods: LocalEvaluationMethod[] | OfflineResearchMethod[]
  /** Candidate features to evaluate. */
  candidateFeatureIds: string[]
  /** §3 — Feature categories to include. */
  featureCategories: FeatureCategory[]
  /** Source dataset event IDs (Rule 1 — only governed datasets). */
  sourceDatasetEventIds: string[]
  /** Source label event IDs (Rule 1 — only governed labels). */
  sourceLabelEventIds: string[]
  /** Rule 21 — Train partition only (val/test never participate). */
  trainPartitionOnly: true
  /** Maximum number of features to select. */
  maxFeatures: number
  /** §11 — Correlation threshold (features above this are flagged). */
  correlationThreshold: number
  /** §11 — Minimum quality score for selection. */
  minQualityScore: number
  /** §11 — Minimum stability score for selection. */
  minStabilityScore: number
  /** Rule 7 — Cross-pipeline selection (requires governance approval). */
  crossPipelineApproved: boolean
  /** Rule 12 — Selection methodology version. */
  methodologyVersion: string
  /** Rule 19 — Importance ranking version. */
  importanceRankingVersion: string
  /** §9 — Research experiment ID (for offline research). */
  researchExperimentId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Selection Input Contract  (§4)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureSelectionInput {
  /** §4 — Governed AI Datasets (from Ch 6.2). */
  governedDatasets: Array<{ datasetEventId: string; version: string; registryEntryId: string }>
  /** §4 — Governed label sets (from Ch 6.3). */
  governedLabels: Array<{ labelEventId: string; version: string; registryEntryId: string }>
  /** §4 — Dataset registry. */
  datasetRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Label registry. */
  labelRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Feature metadata. */
  featureMetadata: Array<{ featureId: string; version: string }>
  /** §4 — Research configuration. */
  researchConfiguration: Array<{ researchId: string; version: string }>
  /** §4 — Governance metadata. */
  governanceMetadata: Array<{ governanceId: string; version: string }>
  /** §4 — Configuration metadata. */
  configurationMetadata: Array<{ configId: string; version: string }>
  /** §4 — Asset metadata. */
  assetMetadata: Array<{ assetId: string; version: string }>
  /** Rule 21 — Train partition data (val/test NEVER passed to feature selection). */
  trainPartitionData: Array<Record<string, unknown>>
  trainPartitionTimestamps: number[]
  /** Rule 21 — Verification that validation/test partitions are NOT included. */
  validationPartitionIncluded: false
  testPartitionIncluded: false
  /** Engine never consumes predictions, trading orders, etc. (§4). */
  predictionsConsumed: false
  tradingOrdersConsumed: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AFSFIEConfiguration {
  /** Rule 7 — Enforce ecosystem isolation. */
  enforceEcosystemIsolation: boolean
  /** Rule 8/9 — Enforce no feature leakage. */
  enforceNoFeatureLeakage: boolean
  /** Rule 21 — Enforce train-only selection. */
  enforceTrainOnlySelection: boolean
  /** Rule 22 — Runtime consumes manifests only (no heavy compute). */
  enforceRuntimeManifestOnly: boolean
  /** Rule 11 — Enable deterministic replay. */
  enableDeterministicReplay: boolean
  /** Rule 13 — Fail-closed. */
  failClosed: boolean
  /** §8 — Default quality thresholds. */
  qualityThresholds: {
    minPredictivePower: number
    minStability: number
    maxMissingRate: number
    maxRedundancy: number
  }
  /** §11 — Default correlation threshold. */
  defaultCorrelationThreshold: number
  /** §14 — Observability enabled. */
  observabilityEnabled: boolean
  /** Versions for default feature sets. */
  versions: FeatureVersionBundle
}

export const DEFAULT_AFSFIE_CONFIG: Omit<AFSFIEConfiguration, 'versions'> = {
  enforceEcosystemIsolation: true,
  enforceNoFeatureLeakage: true,
  enforceTrainOnlySelection: true,
  enforceRuntimeManifestOnly: true,
  enableDeterministicReplay: true,
  failClosed: true,
  qualityThresholds: {
    minPredictivePower: 0.05,
    minStability: 0.6,
    maxMissingRate: 0.1,
    maxRedundancy: 0.8,
  },
  defaultCorrelationThreshold: 0.85,
  observabilityEnabled: true,
}

// Pipeline Stages (§6)
export const FEATURE_SELECTION_STAGES = [
  'GOVERNED_DATASET_RETRIEVAL',
  'GOVERNED_LABEL_RETRIEVAL',
  'CONFIGURATION_VALIDATION',
  'FEATURE_QUALITY_EVALUATION',
  'CORRELATION_ANALYSIS',
  'REDUNDANCY_ELIMINATION',
  'IMPORTANCE_RANKING',
  'STABILITY_EVALUATION',
  'FEATURE_SELECTION',
  'VALIDATION',
  'VERSION_ASSIGNMENT',
  'GOVERNANCE_VALIDATION',
  'IMMUTABLE_PUBLICATION',
  'REGISTRY_REGISTRATION',
  'METADATA_RECORDING',
  'FEATURE_SELECTION_COMPLETION',
] as const

export const AFSFIE_VERSION = '1.0.0'
export const FEATURE_SELECTION_SCHEMA_VERSION = '1.0.0'
