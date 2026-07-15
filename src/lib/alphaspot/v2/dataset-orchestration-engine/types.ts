// CHAPTER 6.1 — AI Dataset Orchestration & Research Data Platform Types
//
// The ADORP is the exclusive gateway between the governed data platform
// (Chapter 3) and every AI model in Chapter 6. No AI model may directly
// consume market data — only governed datasets produced by this engine (§1).
//
// 20 architectural rules enforced (see §17).
// Dual research pipelines: Swing (Pipeline A) + Instant Scalping (Pipeline B).
// 16-stage dataset generation pipeline.

// ─────────────────────────────────────────────────────────────────────────────
// Research Pipelines  (§4, Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPipeline = 'SWING' | 'INSTANT_SCALPING'

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Types  (§8)
// ─────────────────────────────────────────────────────────────────────────────

export type DatasetType =
  | 'TRAINING' | 'VALIDATION' | 'TESTING' | 'SHADOW_EVALUATION'
  | 'BACKTESTING' | 'WALK_FORWARD' | 'PAPER_TRADING' | 'STRESS_TESTING'
  | 'SYNTHETIC' | 'BENCHMARK' | 'REFERENCE' | 'CALIBRATION'
  | 'RESEARCH_SNAPSHOT' | 'OFFLINE' | 'ONLINE_EVALUATION'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Categories  (§9)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | 'TECHNICAL' | 'PRICE' | 'VOLUME' | 'VOLATILITY' | 'LIQUIDITY'
  | 'MICROSTRUCTURE' | 'ORDER_BOOK' | 'TRADE_FLOW' | 'ALTERNATIVE_DATA'
  | 'MACRO' | 'SENTIMENT' | 'CROSS_ASSET' | 'REGIME' | 'TEMPORAL'
  | 'STATISTICAL' | 'DERIVED' | 'COMPOSITE'

// ─────────────────────────────────────────────────────────────────────────────
// Label Types  (§10)
// ─────────────────────────────────────────────────────────────────────────────

export type LabelType =
  | 'BINARY_CLASSIFICATION' | 'MULTI_CLASS_CLASSIFICATION' | 'REGRESSION'
  | 'PROBABILITY_TARGETS' | 'EXPECTED_RETURN' | 'EXPECTED_DRAWDOWN'
  | 'EXPECTED_VOLATILITY' | 'TRADE_QUALITY' | 'RISK_LABELS' | 'REWARD_LABELS'
  | 'ENTRY_LABELS' | 'EXIT_LABELS' | 'CONFIDENCE_LABELS' | 'CUSTOM_LABELS'

// ─────────────────────────────────────────────────────────────────────────────
// Statuses  (§4, §6, Rule 4/13)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT' | 'VALIDATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PUBLISHED' | 'REJECTED' | 'QUARANTINED' | 'RECALLED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Manifest  (§9, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureDescriptor {
  featureId: string
  name: string
  category: FeatureCategory
  /** Rule 17 — Feature schemas version controlled. */
  schemaVersion: string
  /** Which research pipelines may use this feature (Rule 7). */
  allowedPipelines: ResearchPipeline[]
  /** Feature value type for schema validation. */
  valueType: 'NUMBER' | 'BOOLEAN' | 'CATEGORICAL' | 'TIMESTAMP'
  unit: string | null
  description: string
}

export interface FeatureManifest {
  features: FeatureDescriptor[]
  /** Rule 7 — All features belong to the pipeline being generated. */
  pipeline: ResearchPipeline
  featureSchemaVersion: string
  count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Manifest  (§10, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelDescriptor {
  labelId: string
  name: string
  type: LabelType
  /** Rule 18 — Label methodology independently version controlled. */
  methodologyVersion: string
  /** Horizon in seconds (e.g., 86400 for 1-day swing, 60 for 1-minute scalping). */
  horizonSeconds: number
  description: string
}

export interface LabelManifest {
  labels: LabelDescriptor[]
  labelMethodologyVersion: string
  count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Statistics  (Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetStatistics {
  totalRecords: number
  totalFeatures: number
  totalLabels: number
  dateRangeStart: number
  dateRangeEnd: number
  uniqueSymbols: number
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
  /** Per-label distribution. */
  labelDistribution: Array<{
    labelId: string
    classCounts: Record<string, number>
    classImbalance: number // 0 = balanced, 1 = maximally imbalanced
  }>
  /** Rule 14 — Complete statistical metadata recorded. */
  statisticalCompleteness: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Split Metadata  (Rule 9, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitMetadata {
  splitType: 'TRAINING' | 'VALIDATION' | 'TESTING'
  recordCount: number
  /** Rule 9 — Chronological ordering preserved. */
  chronological: true
  /** Rule 10 — No random shuffling across future timestamps. */
  randomShuffled: false
  startTime: number
  endTime: number
  /** Boundary between this split and the next (deterministic). */
  boundaryTimestamp: number
  /** Fraction of total dataset (e.g., 0.7 for 70% training). */
  fraction: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Leakage Validation Report  (Rule 8, §9)
// ─────────────────────────────────────────────────────────────────────────────

export type LeakageType =
  | 'TEMPORAL_LEAKAGE' | 'FEATURE_LEAKAGE' | 'LABEL_LEAKAGE'
  | 'CROSS_PIPELINE_LEAKAGE' | 'LOOKAHEAD_BIAS' | 'SURVIVORSHIP_BIAS'

export interface LeakageFinding {
  type: LeakageType
  featureId: string | null
  labelId: string | null
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  detectedAt: number
}

export interface LeakageValidationReport {
  /** Rule 8 — Dataset must pass leakage detection before publication. */
  passed: boolean
  findings: LeakageFinding[]
  /** Rule 7 — Cross-pipeline leakage check (swing features in scalping or vice versa). */
  crossPipelineLeakageDetected: boolean
  /** Rule 10 — Lookahead bias check (future data in training features). */
  lookaheadBiasDetected: boolean
  checkedAt: number
  /** Rule 16 — Quality reports are immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Validation Report  (§9, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface QualityCheckResult {
  checkName: string
  passed: boolean
  score: number // 0..1
  details: string
  affectedFeatures: string[]
}

export interface QualityValidationReport {
  /** §9 — 14 quality validations. */
  checks: QualityCheckResult[]
  overallScore: number // 0..1
  passed: boolean
  checkedAt: number
  /** Rule 16 — Quality reports are immutable. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Lineage  (Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetLineage {
  /** Rule 5 — Complete lineage linking features, labels, configurations,
   *  governance records, and source metadata. */
  sourceFeatureStoreVersions: string[]
  sourceAlternativeDataVersions: string[]
  sourceHistoricalDataVersions: string[]
  sourceMarketStateVersions: string[]
  sourceTradeFlowVersions: string[]
  sourceOrderBookVersions: string[]
  sourceMicrostructureVersions: string[]
  sourcePaperTradingResultIds: string[]
  sourceBacktestingResultIds: string[]
  sourceGovernedLabelVersions: string[]
  configurationVersionIds: string[]
  governanceEventIds: string[]
  /** Upstream engines that produced the source data. */
  upstreamEngines: string[]
  /** Rule 6 — Raw market data never consumed directly. */
  consumedRawMarketData: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Version Bundle  (§11, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetVersionBundle {
  datasetVersion: string
  featureVersion: string
  labelVersion: string
  configurationVersion: string
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
  /** Rule 7 — Cross-pipeline isolation approval (if explicitly approved). */
  crossPipelineIsolationApproved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Dataset Contract  (§4, §6, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalDatasetContract {
  /** Rule 2 — Unique Dataset Event ID. */
  datasetEventId: string
  /** §4 — Dataset identifier. */
  datasetIdentifier: string
  /** §4 — Dataset version. */
  datasetVersion: string
  /** §4 — Dataset type. */
  datasetType: DatasetType
  /** §4 — Research pipeline (Rule 7). */
  researchPipeline: ResearchPipeline
  /** §4 — Dataset configuration version. */
  datasetConfigurationVersion: string
  /** §4 — Feature manifest. */
  featureManifest: FeatureManifest
  /** §4 — Label manifest. */
  labelManifest: LabelManifest
  /** §4 — Dataset statistics. */
  datasetStatistics: DatasetStatistics
  /** §4 — Training split metadata. */
  trainingSplit: SplitMetadata
  /** §4 — Validation split metadata. */
  validationSplit: SplitMetadata
  /** §4 — Testing split metadata. */
  testingSplit: SplitMetadata
  /** §4 — Leakage validation report. */
  leakageValidationReport: LeakageValidationReport
  /** §4 — Quality validation report. */
  qualityValidationReport: QualityValidationReport
  /** §4 — Governance metadata. */
  governanceMetadata: DatasetGovernanceMetadata
  /** §4 — Lineage metadata. */
  lineage: DatasetLineage
  /** §4 — Publication status. */
  publicationStatus: PublicationStatus
  /** §5 — Pipeline stages executed. */
  pipelineStages: Array<{
    stage: string
    startedAt: number
    completedAt: number
    durationMs: number
    success: boolean
  }>
  /** Rule 4 — Immutable creation timestamp. */
  createdAt: number
  /** Rule 4/11 — Immutable content hash for deterministic replay. */
  contentHash: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetConfiguration {
  datasetIdentifier: string
  datasetType: DatasetType
  researchPipeline: ResearchPipeline
  /** Features to include in this dataset. */
  featureIds: string[]
  /** Labels to construct. */
  labelIds: string[]
  /** Date range for data collection. */
  dateRange: { start: number; end: number }
  /** Symbols to include. */
  symbols: string[]
  /** Split fractions (must sum to 1.0). */
  splitFractions: { training: number; validation: number; testing: number }
  /** Rule 9 — Chronological split boundaries. */
  chronologicalSplit: true
  /** Rule 10 — No random shuffling. */
  randomShuffle: false
  /** Rule 7 — Cross-pipeline feature usage (requires governance approval). */
  crossPipelineFeaturesApproved: boolean
  /** Rule 12 — Dataset methodology version. */
  methodologyVersion: string
  /** Rule 17 — Feature schema version. */
  featureSchemaVersion: string
  /** Rule 18 — Label methodology version. */
  labelMethodologyVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset Input Contract  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetInput {
  /** §3 — Canonical feature store metadata. */
  featureStoreMetadata: Array<{ featureId: string; version: string; pipeline: ResearchPipeline }>
  /** §3 — Alternative data store metadata. */
  alternativeDataMetadata: Array<{ sourceId: string; version: string }>
  /** §3 — Historical market data (governed, never raw — Rule 6). */
  historicalDataMetadata: Array<{ datasetId: string; version: string }>
  /** §3 — Market state store metadata. */
  marketStateMetadata: Array<{ storeId: string; version: string }>
  /** §3 — Trade flow features. */
  tradeFlowMetadata: Array<{ featureId: string; version: string }>
  /** §3 — Order book intelligence. */
  orderBookMetadata: Array<{ intelId: string; version: string }>
  /** §3 — Market microstructure. */
  microstructureMetadata: Array<{ metricId: string; version: string }>
  /** §3 — Paper trading results. */
  paperTradingResults: Array<{ sessionId: string; version: string }>
  /** §3 — Backtesting results. */
  backtestingResults: Array<{ simulationId: string; version: string }>
  /** §3 — Governed labels. */
  governedLabels: Array<{ labelId: string; version: string }>
  /** §3 — Configuration metadata. */
  configurationMetadata: Array<{ configId: string; version: string }>
  /** §3 — Dataset policies. */
  datasetPolicies: Array<{ policyId: string; version: string }>
  /** §3 — Research configuration. */
  researchConfiguration: Array<{ researchId: string; version: string }>
  /** §3 — Calendar metadata. */
  calendarMetadata: Array<{ calendarId: string; version: string }>
  /** §3 — Corporate action metadata. */
  corporateActionMetadata: Array<{ actionId: string; version: string }>
  /** §3 — Exchange metadata. */
  exchangeMetadata: Array<{ exchangeId: string; version: string }>
  /** §3 — Governance metadata. */
  governanceMetadata: Array<{ governanceId: string; version: string }>
  /** Rule 6 — Raw market data records (must always be false/empty). */
  rawMarketDataConsumed: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ADORPConfiguration {
  /** Rule 7 — Enforce strict pipeline isolation. */
  enforcePipelineIsolation: boolean
  /** Rule 8 — Require leakage detection before publication. */
  requireLeakageDetection: boolean
  /** Rule 9 — Enforce chronological splitting. */
  enforceChronologicalSplit: boolean
  /** Rule 10 — Prohibit random shuffling. */
  prohibitRandomShuffle: boolean
  /** Rule 11 — Enable deterministic replay. */
  enableDeterministicReplay: boolean
  /** Rule 13 — Fail-closed: publication failures never publish partial datasets. */
  failClosed: boolean
  /** §9 — Feature category → allowed pipelines (Rule 7 enforcement). */
  featureCategoryPipelineMap: Partial<Record<FeatureCategory, ResearchPipeline[]>>
  /** §10 — Label methodology versions. */
  labelMethodologyVersions: Partial<Record<LabelType, string>>
  /** §9 — Dataset quality thresholds. */
  qualityThresholds: {
    maxMissingValuePct: number
    maxClassImbalance: number
    minOverallQualityScore: number
    maxOutlierPct: number
  }
  /** §14 — Observability enabled. */
  observabilityEnabled: boolean
  /** §15 — Local retraining: weekly refresh interval (ms). */
  weeklyRetrainIntervalMs: number
  /** Versions for default datasets. */
  versions: DatasetVersionBundle
}

export const DEFAULT_ADORP_CONFIG: Omit<ADORPConfiguration, 'versions'> = {
  enforcePipelineIsolation: true,
  requireLeakageDetection: true,
  enforceChronologicalSplit: true,
  prohibitRandomShuffle: true,
  enableDeterministicReplay: true,
  failClosed: true,
  featureCategoryPipelineMap: {
    // Swing pipeline features (§4 Pipeline A)
    TECHNICAL: ['SWING'],
    PRICE: ['SWING', 'INSTANT_SCALPING'],
    VOLUME: ['SWING', 'INSTANT_SCALPING'],
    VOLATILITY: ['SWING', 'INSTANT_SCALPING'],
    LIQUIDITY: ['SWING', 'INSTANT_SCALPING'],
    ALTERNATIVE_DATA: ['SWING'],
    MACRO: ['SWING'],
    SENTIMENT: ['SWING'],
    CROSS_ASSET: ['SWING'],
    REGIME: ['SWING'],
    TEMPORAL: ['SWING', 'INSTANT_SCALPING'],
    STATISTICAL: ['SWING', 'INSTANT_SCALPING'],
    DERIVED: ['SWING', 'INSTANT_SCALPING'],
    COMPOSITE: ['SWING', 'INSTANT_SCALPING'],
    // Scalping pipeline features (§4 Pipeline B)
    MICROSTRUCTURE: ['INSTANT_SCALPING'],
    ORDER_BOOK: ['INSTANT_SCALPING'],
    TRADE_FLOW: ['INSTANT_SCALPING'],
  },
  labelMethodologyVersions: {
    BINARY_CLASSIFICATION: '1.0.0',
    MULTI_CLASS_CLASSIFICATION: '1.0.0',
    REGRESSION: '1.0.0',
    PROBABILITY_TARGETS: '1.0.0',
    EXPECTED_RETURN: '1.0.0',
    EXPECTED_DRAWDOWN: '1.0.0',
    EXPECTED_VOLATILITY: '1.0.0',
    TRADE_QUALITY: '1.0.0',
    RISK_LABELS: '1.0.0',
    REWARD_LABELS: '1.0.0',
    ENTRY_LABELS: '1.0.0',
    EXIT_LABELS: '1.0.0',
    CONFIDENCE_LABELS: '1.0.0',
    CUSTOM_LABELS: '1.0.0',
  },
  qualityThresholds: {
    maxMissingValuePct: 5.0,
    maxClassImbalance: 0.8,
    minOverallQualityScore: 0.7,
    maxOutlierPct: 10.0,
  },
  observabilityEnabled: true,
  weeklyRetrainIntervalMs: 7 * 24 * 60 * 60 * 1000,
}

// Pipeline Stages (§5)
export const DATASET_GENERATION_STAGES = [
  'GOVERNED_DATA_COLLECTION',
  'FEATURE_RESOLUTION',
  'FEATURE_VALIDATION',
  'TEMPORAL_ALIGNMENT',
  'MISSING_VALUE_PROCESSING',
  'OUTLIER_VALIDATION',
  'LABEL_CONSTRUCTION',
  'LEAKAGE_DETECTION',
  'QUALITY_VALIDATION',
  'DATASET_SPLITTING',
  'STATISTICAL_PROFILING',
  'DATASET_VERSION_ASSIGNMENT',
  'GOVERNANCE_VALIDATION',
  'IMMUTABLE_DATASET_PUBLICATION',
  'METADATA_RECORDING',
  'DATASET_COMPLETION',
] as const

// Dual Workflow Stages (§6)
export const SWING_WORKFLOW_STAGES = [
  'COLLECT',
  'ALIGN_MULTI_TIMEFRAME_FEATURES',
  'MERGE_ALTERNATIVE_DATA',
  'GENERATE_SWING_LABELS',
  'LEAKAGE_VALIDATION',
  'PUBLISH_SWING_DATASET',
] as const

export const SCALPING_WORKFLOW_STAGES = [
  'COLLECT',
  'ALIGN_ORDER_BOOK_FEATURES',
  'MICROSTRUCTURE_FEATURES',
  'TRADE_FLOW_FEATURES',
  'GENERATE_MINUTE_LABELS',
  'LEAKAGE_VALIDATION',
  'PUBLISH_SCALPING_DATASET',
] as const

export const ADORP_VERSION = '1.0.0'
export const DATASET_ORCHESTRATION_SCHEMA_VERSION = '1.0.0'
