// CHAPTER 6.3 — AI Label Engineering & Target Generation Engine Types
//
// The AILETGE is the exclusive target generation layer between the AI Dataset
// Construction & Dataset Registry Engine (Chapter 6.2) and every downstream AI
// Training Engine in Chapter 6. No AI model may construct labels independently (§1).
//
// 21 architectural rules enforced (see §17), including the critical
// Rule 8/9/10 (no future leakage — feature windows and future label windows
// must never overlap) and Rule 21 (no hard-coded thresholds).
// Dual label ecosystems: Swing (Dynamic Triple Barrier) + Scalping (Micro TB).

// ─────────────────────────────────────────────────────────────────────────────
// Research Pipelines  (§3, Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPipeline = 'SWING' | 'INSTANT_SCALPING'

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Horizons  (§8)
// ─────────────────────────────────────────────────────────────────────────────

export type PredictionHorizon =
  | '1_MINUTE' | '5_MINUTES' | '15_MINUTES' | '20_MINUTES'
  | '1_HOUR' | '4_HOURS'
  | '1_DAY' | '3_DAYS' | '5_DAYS' | '10_DAYS'

/** §8 — Horizon in milliseconds for deterministic computation. */
export const HORIZON_MS: Record<PredictionHorizon, number> = {
  '1_MINUTE': 60_000,
  '5_MINUTES': 5 * 60_000,
  '15_MINUTES': 15 * 60_000,
  '20_MINUTES': 20 * 60_000,
  '1_HOUR': 60 * 60_000,
  '4_HOURS': 4 * 60 * 60_000,
  '1_DAY': 24 * 60 * 60_000,
  '3_DAYS': 3 * 24 * 60 * 60_000,
  '5_DAYS': 5 * 24 * 60 * 60_000,
  '10_DAYS': 10 * 24 * 60 * 60_000,
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Types  (§7 — 17 types)
// ─────────────────────────────────────────────────────────────────────────────

export type LabelType =
  | 'BINARY_CLASSIFICATION' | 'MULTI_CLASS_CLASSIFICATION' | 'REGRESSION'
  | 'PROBABILITY_TARGETS' | 'FUTURE_RETURN' | 'LOG_RETURN'
  | 'VOLATILITY_TARGETS' | 'MAXIMUM_DRAWDOWN' | 'MAXIMUM_FAVORABLE_EXCURSION'
  | 'MAXIMUM_ADVERSE_EXCURSION' | 'TRADE_SUCCESS' | 'EXPECTED_VALUE'
  | 'TRADE_QUALITY_SCORE' | 'RISK_SCORE' | 'HOLDING_TIME'
  | 'MARKET_REGIME' | 'MULTI_HORIZON'

// ─────────────────────────────────────────────────────────────────────────────
// Barrier Methods  (§3 — Dynamic / Micro Triple Barrier, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export type BarrierMethod =
  | 'PERCENTAGE_RETURN' | 'ATR_MULTIPLE' | 'VOLATILITY_ADJUSTED'
  | 'VOLATILITY_BASED' | 'TICK_BASED'

export type ExitReason = 'UPPER_BARRIER' | 'LOWER_BARRIER' | 'VERTICAL_BARRIER' | 'NO_EXIT'

/** Rule 21 — All thresholds externally configurable (never hard-coded). */
export interface BarrierConfiguration {
  /** Rule 21 — Barrier methodology (no hard-coding). */
  upperBarrierMethod: BarrierMethod
  upperBarrierValue: number
  lowerBarrierMethod: BarrierMethod
  lowerBarrierValue: number
  /** Vertical barrier = prediction horizon expiration. */
  verticalBarrierHorizon: PredictionHorizon
}

// ─────────────────────────────────────────────────────────────────────────────
// Target Definition  (§5, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface TargetDefinition {
  targetId: string
  labelType: LabelType
  predictionHorizon: PredictionHorizon
  /** Rule 19 — Target definition version controlled. */
  targetVersion: string
  /** Rule 21 — Barrier config (externally configurable, no hard-coding). */
  barrierConfig: BarrierConfiguration
  description: string
  /** Generated targets for this definition. */
  generatedTargets: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Statuses  (§5, Rule 4/13/16)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT' | 'VALIDATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PUBLISHED' | 'REJECTED' | 'QUARANTINED' | 'RECALLED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// Label Statistics + Class Distribution  (§5, §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelStatistics {
  totalLabels: number
  totalTargets: number
  dateRangeStart: number
  dateRangeEnd: number
  uniqueSymbols: number
  /** Per-target statistics. */
  targetStats: Array<{
    targetId: string
    mean: number
    stdDev: number
    min: number
    max: number
    median: number
    nullCount: number
  }>
  /** Overall label quality score (0..1). */
  qualityScore: number
}

export interface ClassDistribution {
  /** Per-target class distribution. */
  targetDistributions: Array<{
    targetId: string
    classCounts: Record<string, number>
    classImbalance: number // 0 = balanced, 1 = maximally imbalanced
  }>
  /** Overall class imbalance across all targets. */
  overallImbalance: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Manifest  (Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelManifest {
  /** Rule 14 — Every published label generates a complete manifest. */
  manifestId: string
  labelIdentifier: string
  labelVersion: string
  targetDefinitions: TargetDefinition[]
  predictionHorizons: PredictionHorizon[]
  recordCount: number
  dateRange: { start: number; end: number }
  symbols: string[]
  contentHash: string
  generatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation + Integrity Reports  (§9, Rule 9, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelValidationCheck {
  checkName: string
  passed: boolean
  details: string
  affectedTargets: string[]
}

export interface LabelValidationReport {
  /** §9 — 10 validation checks. */
  checks: LabelValidationCheck[]
  /** Rule 8/9/10 — Leakage detection (future leakage, temporal leakage, horizon overlap). */
  leakageDetected: boolean
  overallPassed: boolean
  checkedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

export interface LabelIntegrityReport {
  contentHashVerified: boolean
  manifestHashVerified: boolean
  targetDefinitionsValid: boolean
  lineageComplete: boolean
  /** Rule 6 — Source datasets not modified. */
  sourceDatasetsModified: false
  verifiedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Lineage  (Rule 5, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelLineage {
  /** Rule 5 — Complete lineage linking datasets, configurations, governance,
   *  registry records, and publication metadata. */
  sourceDatasetEventIds: string[]
  sourceDatasetVersions: string[]
  sourceDatasetRegistryEntryIds: string[]
  sourceFeatureMetadataVersions: string[]
  researchConfigurationVersionIds: string[]
  tradingHorizonConfigurationIds: string[]
  marketCalendarVersion: string
  datasetManifestIds: string[]
  governanceEventIds: string[]
  registryEntryIds: string[]
  publicationMetadataIds: string[]
  upstreamEngines: string[]
  /** Rule 6 — Labels never modify source datasets. */
  sourceDatasetsModified: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Version Bundle  (§11, Rule 4/19)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelVersionBundle {
  labelVersion: string
  datasetVersion: string
  targetVersion: string
  configurationVersion: string
  pipelineVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Governance Metadata  (§12)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelGovernanceMetadata {
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
  /** Rule 7 — Cross-pipeline label generation approval. */
  crossPipelineApproved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Label Contract  (§5, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalLabelContract {
  /** Rule 2 — Unique Label Event ID. */
  labelEventId: string
  /** §5 — Label identifier. */
  labelIdentifier: string
  /** §5 — Label version. */
  labelVersion: string
  /** §5 — Research pipeline. */
  researchPipeline: ResearchPipeline
  /** §5 — Label category (label type). */
  labelCategory: LabelType
  /** §5 — Target definition (Rule 19, Rule 21). */
  targetDefinition: TargetDefinition
  /** §5 — Prediction horizon. */
  predictionHorizon: PredictionHorizon
  /** §5 — Label statistics. */
  labelStatistics: LabelStatistics
  /** §5 — Class distribution. */
  classDistribution: ClassDistribution
  /** §5 — Configuration version. */
  configurationVersion: string
  /** §5 — Validation report. */
  validationReport: LabelValidationReport
  /** §5 — Integrity report. */
  integrityReport: LabelIntegrityReport
  /** §5 — Lineage metadata. */
  lineage: LabelLineage
  /** §5 — Governance metadata. */
  governanceMetadata: LabelGovernanceMetadata
  /** §5 — Publication status. */
  publicationStatus: PublicationStatus
  /** §5 — Label manifest (Rule 14). */
  labelManifest: LabelManifest
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
// Label Registry Entry  (§10, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelRegistryEntry {
  /** §10 — Label identifier. */
  labelIdentifier: string
  /** §10 — Label version. */
  labelVersion: string
  /** §10 — Dataset version. */
  datasetVersion: string
  /** §10 — Target definition. */
  targetDefinition: TargetDefinition
  /** §10 — Prediction horizon. */
  predictionHorizon: PredictionHorizon
  /** §10 — Configuration version. */
  configurationVersion: string
  /** §10 — Creation timestamp. */
  creationTimestamp: number
  /** §10 — Governance status. */
  governanceStatus: ApprovalStatus
  /** §10 — Quality score. */
  qualityScore: number
  /** §10 — Storage location. */
  storageLocation: string
  /** §10 — Label event ID (link back to contract). */
  labelEventId: string
  /** Rule 16 — Immutable after publication. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Configuration  (§3, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelConfiguration {
  labelIdentifier: string
  researchPipeline: ResearchPipeline
  /** Rule 21 — All thresholds externally configurable (no hard-coding). */
  barrierConfig: BarrierConfiguration
  /** §8 — Prediction horizon. */
  predictionHorizon: PredictionHorizon
  /** §7 — Label types to generate. */
  labelTypes: LabelType[]
  /** Dataset event IDs to generate labels from (Rule 1 — only governed datasets). */
  sourceDatasetEventIds: string[]
  /** Date range for label generation. */
  dateRange: { start: number; end: number }
  /** Symbols to include. */
  symbols: string[]
  /** Rule 7 — Cross-pipeline generation (requires governance approval). */
  crossPipelineApproved: boolean
  /** Rule 12 — Label methodology version. */
  methodologyVersion: string
  /** Rule 19 — Target definition version. */
  targetDefinitionVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Input Contract  (§4)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelInput {
  /** §4 — Governed AI Datasets (from Ch 6.2 ADCDRE). */
  governedDatasets: Array<{ datasetEventId: string; version: string; registryEntryId: string }>
  /** §4 — Dataset Registry. */
  datasetRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Feature metadata. */
  featureMetadata: Array<{ featureId: string; version: string }>
  /** §4 — Research configuration (Rule 21 — externally configurable thresholds). */
  researchConfiguration: Array<{ researchId: string; version: string }>
  /** §4 — Trading horizon configuration. */
  tradingHorizonConfiguration: Array<{ configId: string; version: string }>
  /** §4 — Market calendar. */
  marketCalendar: Array<{ calendarId: string; version: string }>
  /** §4 — Dataset manifest. */
  datasetManifest: Array<{ manifestId: string; version: string }>
  /** §4 — Governance metadata. */
  governanceMetadata: Array<{ governanceId: string; version: string }>
  /** §4 — Configuration metadata. */
  configurationMetadata: Array<{ configId: string; version: string }>
  /** §4 — Asset metadata. */
  assetMetadata: Array<{ assetId: string; version: string }>
  /** Engine never consumes predictions, model outputs, trading orders, etc. (§4). */
  predictionsConsumed: false
  modelOutputsConsumed: false
  tradingOrdersConsumed: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AILETGEConfiguration {
  /** Rule 7 — Enforce ecosystem isolation. */
  enforceEcosystemIsolation: boolean
  /** Rule 8/9/10 — Enforce no future leakage. */
  enforceNoFutureLeakage: boolean
  /** Rule 10 — Enforce horizon non-overlap with feature windows. */
  enforceHorizonNonOverlap: boolean
  /** Rule 11 — Enable deterministic replay. */
  enableDeterministicReplay: boolean
  /** Rule 13 — Fail-closed. */
  failClosed: boolean
  /** Rule 21 — Reject hard-coded thresholds (all must come from config). */
  rejectHardcodedThresholds: boolean
  /** §9 — Validation thresholds. */
  validationThresholds: {
    maxClassImbalance: number
    maxMissingLabelPct: number
    minQualityScore: number
    maxOutlierPct: number
  }
  /** §3 Pipeline A — Default swing horizons. */
  defaultSwingHorizon: PredictionHorizon
  /** §3 Pipeline B — Default scalping horizon. */
  defaultScalpingHorizon: PredictionHorizon
  /** §14 — Observability enabled. */
  observabilityEnabled: boolean
  /** Versions for default labels. */
  versions: LabelVersionBundle
}

export const DEFAULT_AILETGE_CONFIG: Omit<AILETGEConfiguration, 'versions'> = {
  enforceEcosystemIsolation: true,
  enforceNoFutureLeakage: true,
  enforceHorizonNonOverlap: true,
  enableDeterministicReplay: true,
  failClosed: true,
  rejectHardcodedThresholds: true,
  validationThresholds: {
    maxClassImbalance: 0.8,
    maxMissingLabelPct: 5.0,
    minQualityScore: 0.75,
    maxOutlierPct: 10.0,
  },
  defaultSwingHorizon: '3_DAYS', // §3 Pipeline A default = 72 hours
  defaultScalpingHorizon: '20_MINUTES', // §3 Pipeline B default = 20 minutes
  observabilityEnabled: true,
}

// Pipeline Stages (§6)
export const LABEL_GENERATION_STAGES = [
  'GOVERNED_DATASET_RETRIEVAL',
  'CONFIGURATION_VALIDATION',
  'PREDICTION_HORIZON_SELECTION',
  'TARGET_DEFINITION',
  'FUTURE_WINDOW_CONSTRUCTION',
  'LABEL_GENERATION',
  'LEAKAGE_VALIDATION',
  'STATISTICAL_VALIDATION',
  'CLASS_BALANCE_ANALYSIS',
  'VERSION_ASSIGNMENT',
  'GOVERNANCE_VALIDATION',
  'IMMUTABLE_PUBLICATION',
  'REGISTRY_REGISTRATION',
  'METADATA_RECORDING',
  'LABEL_COMPLETION',
] as const

export const AILETGE_VERSION = '1.0.0'
export const LABEL_ENGINEERING_SCHEMA_VERSION = '1.0.0'
