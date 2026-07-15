// CHAPTER 6.2 — AI Dataset Construction & Dataset Registry Engine Types
//
// The ADCDRE is the exclusive dataset production layer between the governed
// Data Platform (Chapter 3) and every downstream AI engine in Chapter 6.
// No AI model may directly consume raw market data or feature stores (§1).
//
// 22 architectural rules enforced (see §17), including the critical
// Rule 7A (transient→persistent promotion) and Rule 9A/9B (purged/embargo).
// Dual dataset ecosystems: Swing (persistent) + Instant Scalping (transient).

// ─────────────────────────────────────────────────────────────────────────────
// Research Pipelines  (§3, Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPipeline = 'SWING' | 'INSTANT_SCALPING'

// ─────────────────────────────────────────────────────────────────────────────
// Storage Policy  (§3 — Swing persistent, Scalping transient)
// ─────────────────────────────────────────────────────────────────────────────

export type StoragePolicy = 'PERSISTENT' | 'TRANSIENT'

/** §3 — Reasons a transient dataset may be promoted to the persistent registry. */
export type RegistryPromotionTrigger =
  | 'GOVERNANCE_APPROVED_SNAPSHOT' // §3 Pipeline B
  | 'SCHEDULED_WEEKLY_CHECKPOINT' // §3 Pipeline B
  | 'MANUAL_EXPORT' // §3 Pipeline B
  | 'VALIDATION_ANOMALY' // §3 Pipeline B / §16
  | 'CRITICAL_AUDIT_EVENT' // §3 Pipeline B / §16
  | 'CHECKPOINT_POLICY' // §16 — periodic checkpoint policies

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Categories  (§7 — 16 construction methods)
// ─────────────────────────────────────────────────────────────────────────────

export type ConstructionMethod =
  | 'HISTORICAL' | 'SLIDING_WINDOW' | 'ROLLING_WINDOW' | 'WALK_FORWARD'
  | 'EXPANDING_WINDOW' | 'INCREMENTAL' | 'RESEARCH_SNAPSHOT' | 'CROSS_ASSET'
  | 'MULTI_TIMEFRAME' | 'SYNTHETIC' | 'BENCHMARK' | 'STRESS_TESTING'
  | 'SHADOW_EVALUATION' | 'PAPER_TRADING' | 'OFFLINE_RESEARCH'

// ─────────────────────────────────────────────────────────────────────────────
// Partitioning Types  (§8 — 11 types)
// ─────────────────────────────────────────────────────────────────────────────

export type PartitionType =
  | 'TRAINING' | 'VALIDATION' | 'TESTING'
  | 'WALK_FORWARD_VALIDATION' | 'ROLLING_VALIDATION'
  | 'PURGED_CROSS_VALIDATION' | 'EMBARGO_VALIDATION'
  | 'CHRONOLOGICAL_HOLDOUT' | 'SHADOW_EVALUATION'
  | 'BENCHMARK' | 'HISTORICAL_REPLAY'

// ─────────────────────────────────────────────────────────────────────────────
// Storage Formats  (Rule 19 — independently configurable)
// ─────────────────────────────────────────────────────────────────────────────

export type StorageFormat = 'PARQUET' | 'ARROW' | 'FEATHER' | 'SQL' | 'JSON' | 'CSV' | 'CUSTOM'

// ─────────────────────────────────────────────────────────────────────────────
// Statuses  (§5, Rule 4/13/16)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT' | 'VALIDATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PUBLISHED' | 'REJECTED' | 'QUARANTINED' | 'RECALLED' | 'EXPIRED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Manifest  (Rule 14 — complete manifest required)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetSchema {
  schemaVersion: string
  featureSchemaIds: string[]
  featureValueTypes: Record<string, 'NUMBER' | 'BOOLEAN' | 'CATEGORICAL' | 'TIMESTAMP'>
  timestampField: string
  symbolField: string
  /** Rule 19 — Storage format independently configurable. */
  storageFormat: StorageFormat
}

export interface DatasetManifest {
  /** Rule 14 — Every published dataset generates a complete manifest. */
  manifestId: string
  datasetIdentifier: string
  datasetVersion: string
  schema: DatasetSchema
  featureIds: string[]
  partitionTypes: PartitionType[]
  recordCount: number
  dateRange: { start: number; end: number }
  symbols: string[]
  /** Hash of the full dataset content for integrity verification. */
  contentHash: string
  generatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Statistics  (§6, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetStatistics {
  totalRecords: number
  totalFeatures: number
  totalPartitions: number
  dateRangeStart: number
  dateRangeEnd: number
  uniqueSymbols: number
  /** Per-partition record counts. */
  partitionCounts: Record<string, number>
  /** Per-feature statistics. */
  featureStats: Array<{
    featureId: string
    mean: number
    stdDev: number
    min: number
    max: number
    median: number
    nullCount: number
    nullPct: number
  }>
  /** Overall dataset completeness (0..1). */
  completeness: number
  /** Overall quality score (0..1). */
  qualityScore: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Partition Metadata  (Rule 8, Rule 9, Rule 9A, Rule 9B)
// ─────────────────────────────────────────────────────────────────────────────

export interface PartitionMetadata {
  partitionType: PartitionType
  recordCount: number
  startTime: number
  endTime: number
  /** Rule 8  — Chronological ordering never violated. */
  chronological: true
  /** Rule 9  — No random shuffling. */
  randomShuffled: false
  /** Rule 9A — Absolute temporal isolation enforced. */
  temporalIsolationEnforced: boolean
  /** Rule 9B — Purge/embargo gap applied (ms). */
  purgeGapMs: number
  /** Rule 9B — Embargo period applied (ms). */
  embargoMs: number
  /** Partition index (for walk-forward / rolling). */
  partitionIndex: number
}

export interface PartitionSet {
  partitions: PartitionMetadata[]
  /** Rule 9A — No boundary overlaps across all partitions. */
  noBoundaryOverlaps: boolean
  /** Rule 9A — Validation starts strictly after training ends. */
  validationFollowsTraining: boolean
  /** Rule 9A — Testing starts strictly after validation ends. */
  testingFollowsValidation: boolean
  /** Rule 9B — Purged observations removed. */
  purgedObservationCount: number
  /** Rule 9B — Embargo observations removed. */
  embargoedObservationCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation + Integrity Reports  (§11, Rule 10, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationCheckResult {
  checkName: string
  passed: boolean
  details: string
  affectedFeatures: string[]
}

export interface DatasetValidationReport {
  /** §11 — 11 validation checks. */
  checks: ValidationCheckResult[]
  overallPassed: boolean
  checkedAt: number
  /** Rule 16 — immutable after publication. */
  immutable: true
}

export interface DatasetIntegrityReport {
  contentHashVerified: boolean
  manifestHashVerified: boolean
  schemaValid: boolean
  partitionIntegrityVerified: boolean
  lineageComplete: boolean
  verifiedAt: number
  /** Rule 16 — immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Lineage  (Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetLineage {
  /** Rule 5 — Complete lineage linking source features, configurations,
   *  governance metadata, registry records, and publication metadata. */
  sourceFeatureStoreVersions: string[]
  sourceHistoricalDataVersions: string[]
  sourceAlternativeDataVersions: string[]
  sourceOrderBookVersions: string[]
  sourceTradeFlowVersions: string[]
  sourceMicrostructureVersions: string[]
  sourceMarketStateVersions: string[]
  sourcePaperTradingResultIds: string[]
  sourceBacktestingResultIds: string[]
  configurationVersionIds: string[]
  governanceEventIds: string[]
  registryEntryIds: string[]
  publicationMetadataIds: string[]
  upstreamEngines: string[]
  /** Rule 6 — Dataset construction never generates AI labels. */
  labelsGenerated: false
  /** For promoted transient datasets (Rule 7A), the source transient ID. */
  sourceTransientDatasetId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Version Bundle  (§10)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetVersionBundle {
  datasetVersion: string
  schemaVersion: string
  configurationVersion: string
  featureVersion: string
  pipelineVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Governance Metadata  (§12)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetGovernanceMetadata {
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
  /** Rule 7 — Cross-pipeline mixing approval. */
  crossPipelineMixingApproved: boolean
  /** Rule 7A — Transient→persistent promotion approval. */
  promotionApproved: boolean
  /** Rule 7A — Promotion trigger (if applicable). */
  promotionTrigger: RegistryPromotionTrigger | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Dataset Contract  (§5, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalDatasetContract {
  /** Rule 2 — Unique Dataset Event ID. */
  datasetEventId: string
  /** §5 — Dataset identifier. */
  datasetIdentifier: string
  /** §5 — Dataset version. */
  datasetVersion: string
  /** §5 — Research pipeline. */
  researchPipeline: ResearchPipeline
  /** §5 — Dataset category (construction method). */
  datasetCategory: ConstructionMethod
  /** §5 — Dataset manifest (Rule 14). */
  datasetManifest: DatasetManifest
  /** §5 — Dataset schema. */
  datasetSchema: DatasetSchema
  /** §5 — Dataset statistics. */
  datasetStatistics: DatasetStatistics
  /** §5 — Dataset configuration version. */
  datasetConfigurationVersion: string
  /** §5 — Dataset partition metadata. */
  partitionMetadata: PartitionSet
  /** §5 — Dataset validation report. */
  validationReport: DatasetValidationReport
  /** §5 — Dataset integrity report. */
  integrityReport: DatasetIntegrityReport
  /** §5 — Lineage metadata. */
  lineage: DatasetLineage
  /** §5 — Governance metadata. */
  governanceMetadata: DatasetGovernanceMetadata
  /** §5 — Publication status. */
  publicationStatus: PublicationStatus
  /** §3 — Storage policy (persistent or transient). */
  storagePolicy: StoragePolicy
  /** §3 — For transient datasets: expiry timestamp (null if persistent). */
  transientExpiresAt: number | null
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
// Dataset Registry Entry  (§9, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetRegistryEntry {
  /** §9 — Dataset identifier. */
  datasetIdentifier: string
  /** §9 — Dataset version. */
  datasetVersion: string
  /** §9 — Pipeline identifier. */
  pipelineIdentifier: ResearchPipeline
  /** §9 — Schema version. */
  schemaVersion: string
  /** §9 — Feature manifest. */
  featureManifest: { featureIds: string[]; count: number }
  /** §9 — Configuration version. */
  configurationVersion: string
  /** §9 — Creation timestamp. */
  creationTimestamp: number
  /** §9 — Owner. */
  owner: string
  /** §9 — Governance status. */
  governanceStatus: ApprovalStatus
  /** §9 — Storage location. */
  storageLocation: string
  /** §9 — Quality score. */
  qualityScore: number
  /** §9 — Lineage identifier. */
  lineageIdentifier: string
  /** §9 — Approval status. */
  approvalStatus: ApprovalStatus
  /** §9 — Dataset event ID (link back to contract). */
  datasetEventId: string
  /** Rule 16 — Immutable after publication. */
  immutable: true
  /** Rule 7A — Whether this entry was promoted from transient. */
  promotedFromTransient: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetConfiguration {
  datasetIdentifier: string
  researchPipeline: ResearchPipeline
  constructionMethod: ConstructionMethod
  /** Features to include (Rule 1 — only governed feature stores). */
  featureIds: string[]
  /** Date range for data collection. */
  dateRange: { start: number; end: number }
  /** Symbols to include. */
  symbols: string[]
  /** Partitioning configuration. */
  partitioning: {
    types: PartitionType[]
    /** Rule 9 — Chronological holdout fractions. */
    holdoutFractions: { training: number; validation: number; testing: number }
    /** Rule 9B — Purge gap (ms) between training and validation. */
    purgeGapMs: number
    /** Rule 9B — Embargo period (ms) after validation. */
    embargoMs: number
    /** Walk-forward window size (ms). */
    walkForwardWindowMs: number
    /** Walk-forward step size (ms). */
    walkForwardStepMs: number
  }
  /** Rule 7 — Cross-pipeline mixing (requires governance approval). */
  crossPipelineMixingApproved: boolean
  /** Rule 12 — Construction methodology version. */
  methodologyVersion: string
  /** Rule 19 — Storage format. */
  storageFormat: StorageFormat
  /** §3 Pipeline B — Transient retention (ms). */
  transientRetentionMs: number | null
  /** §3 Pipeline B — Auto-expire transient datasets. */
  autoExpire: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Input Contract  (§4, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetInput {
  featureStoreMetadata: Array<{ featureId: string; version: string }>
  historicalDataMetadata: Array<{ datasetId: string; version: string }>
  alternativeDataMetadata: Array<{ sourceId: string; version: string }>
  orderBookMetadata: Array<{ intelId: string; version: string }>
  tradeFlowMetadata: Array<{ featureId: string; version: string }>
  microstructureMetadata: Array<{ metricId: string; version: string }>
  marketStateMetadata: Array<{ storeId: string; version: string }>
  paperTradingResults: Array<{ sessionId: string; version: string }>
  backtestingResults: Array<{ simulationId: string; version: string }>
  researchConfiguration: Array<{ researchId: string; version: string }>
  calendarMetadata: Array<{ calendarId: string; version: string }>
  datasetPolicies: Array<{ policyId: string; version: string }>
  governanceMetadata: Array<{ governanceId: string; version: string }>
  configurationMetadata: Array<{ configId: string; version: string }>
  exchangeMetadata: Array<{ exchangeId: string; version: string }>
  assetMetadata: Array<{ assetId: string; version: string }>
  /** Rule 6 — Labels must never be consumed (construction never generates labels). */
  labelsConsumed: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ADCDREConfiguration {
  /** Rule 7 — Enforce ecosystem isolation. */
  enforceEcosystemIsolation: boolean
  /** Rule 8 — Enforce chronological ordering. */
  enforceChronologicalOrdering: boolean
  /** Rule 9 — Prohibit random shuffling. */
  prohibitRandomShuffle: boolean
  /** Rule 9A — Enforce absolute temporal isolation. */
  enforceTemporalIsolation: boolean
  /** Rule 9B — Require purge gap. */
  requirePurgeGap: boolean
  /** Rule 9B — Require embargo period. */
  requireEmbargo: boolean
  /** Rule 10 — Require validation before publication. */
  requireValidationBeforePublication: boolean
  /** Rule 11 — Enable deterministic replay. */
  enableDeterministicReplay: boolean
  /** Rule 13 — Fail-closed. */
  failClosed: boolean
  /** Rule 19 — Default storage format. */
  defaultStorageFormat: StorageFormat
  /** §3 Pipeline B — Default transient retention (ms). */
  defaultTransientRetentionMs: number
  /** §3 Pipeline B — Default checkpoint interval (ms). */
  defaultCheckpointIntervalMs: number
  /** §11 — Validation thresholds. */
  validationThresholds: {
    maxMissingPct: number
    maxDuplicatePct: number
    minCompleteness: number
    minQualityScore: number
  }
  /** §14 — Observability enabled. */
  observabilityEnabled: boolean
  /** Versions for default datasets. */
  versions: DatasetVersionBundle
}

export const DEFAULT_ADCDRE_CONFIG: Omit<ADCDREConfiguration, 'versions'> = {
  enforceEcosystemIsolation: true,
  enforceChronologicalOrdering: true,
  prohibitRandomShuffle: true,
  enforceTemporalIsolation: true,
  requirePurgeGap: true,
  requireEmbargo: true,
  requireValidationBeforePublication: true,
  enableDeterministicReplay: true,
  failClosed: true,
  defaultStorageFormat: 'PARQUET',
  defaultTransientRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
  defaultCheckpointIntervalMs: 7 * 24 * 60 * 60 * 1000, // weekly
  validationThresholds: {
    maxMissingPct: 5.0,
    maxDuplicatePct: 0.0,
    minCompleteness: 0.85,
    minQualityScore: 0.75,
  },
  observabilityEnabled: true,
}

// Pipeline Stages (§6)
export const DATASET_CONSTRUCTION_STAGES = [
  'GOVERNED_DATA_COLLECTION',
  'CONFIGURATION_VALIDATION',
  'TEMPORAL_ALIGNMENT',
  'FEATURE_RESOLUTION',
  'TIMEFRAME_SYNCHRONIZATION',
  'SLIDING_ROLLING_WINDOW_CONSTRUCTION',
  'DATASET_VALIDATION',
  'CHRONOLOGICAL_PARTITIONING',
  'DATASET_STATISTICS_GENERATION',
  'MANIFEST_GENERATION',
  'VERSION_ASSIGNMENT',
  'GOVERNANCE_VALIDATION',
  'IMMUTABLE_PUBLICATION',
  'REGISTRY_REGISTRATION',
  'METADATA_RECORDING',
  'DATASET_COMPLETION',
] as const

export const ADCDRE_VERSION = '1.0.0'
export const DATASET_REGISTRY_SCHEMA_VERSION = '1.0.0'
