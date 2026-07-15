// CHAPTER 5.16 — Feature Store Engine Types
//
// The FSE is the exclusive bridge between Data Engineering and all AI
// Prediction, Backtesting, Paper Trading, Market Simulation, and Model Training
// components. Guarantees identical feature definitions across training + production (§1).
//
// 21 architectural rules enforced (see §17).
// Dual pipeline: Write (14 stages) + Read (Online 6 stages / Offline 6 stages).

// ─────────────────────────────────────────────────────────────────────────────
// Feature Engineering Types  (§7 — 19 categories)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | 'TECHNICAL_INDICATORS' | 'ROLLING_STATISTICS' | 'WINDOW_AGGREGATIONS'
  | 'LAG_FEATURES' | 'LEAD_FEATURES' | 'PRICE_DERIVATIVES'
  | 'VOLUME_FEATURES' | 'VOLATILITY_FEATURES' | 'LIQUIDITY_FEATURES'
  | 'MICROSTRUCTURE_FEATURES' | 'ORDER_BOOK_FEATURES' | 'BLOCKCHAIN_FEATURES'
  | 'WALLET_ACTIVITY_FEATURES' | 'NEWS_FEATURES' | 'SENTIMENT_FEATURES'
  | 'MACROECONOMIC_FEATURES' | 'CROSS_ASSET_FEATURES' | 'CROSS_EXCHANGE_FEATURES'
  | 'CUSTOM_FEATURES'

// ─────────────────────────────────────────────────────────────────────────────
// Data Source Types  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export type DataSourceType =
  | 'MARKET_DATA' | 'ORDER_BOOK_DATA' | 'TRADE_DATA' | 'BLOCKCHAIN_DATA'
  | 'ALTERNATIVE_DATA' | 'NEWS_INTELLIGENCE' | 'SOCIAL_SENTIMENT'
  | 'MACROECONOMIC_DATA' | 'ON_CHAIN_METRICS' | 'CROSS_EXCHANGE_DATA'
  | 'ENGINEERED_FEATURE_SETS'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Freshness Status  (§4, §8, Rule 11)
// ─────────────────────────────────────────────────────────────────────────────

export type FreshnessStatus =
  | 'FRESH' | 'STALE' | 'EXPIRED' | 'PENDING' | 'UNKNOWN'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Quality Status  (§11, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export type QualityStatus =
  | 'VALIDATED' | 'WARNING' | 'INVALID' | 'QUARANTINED'

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Types  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineType = 'WRITE' | 'READ_ONLINE' | 'READ_OFFLINE'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Definition  (§7, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureDefinition {
  featureId: string
  featureName: string
  featureGroup: string
  category: FeatureCategory
  description: string
  /** §7 — Engineering expression (deterministic, reproducible). */
  engineeringExpression: string
  /** §7 — Normalization methodology. */
  normalizationMethod: string
  /** §7 — Transformation pipeline. */
  transformationPipeline: string[]
  /** Rule 15 — Explicitly versioned dependencies. */
  dependencies: string[]
  /** Rule 8 — Version controlled. */
  version: string
  /** Data sources required. */
  requiredDataSources: DataSourceType[]
  /** Window size for rolling features. */
  windowSize: number | null
  /** Lag periods for lag features. */
  lagPeriods: number[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Vector  (§6)
// Rule 6 — Every Feature Vector uniquely associated with exactly one Asset + Exchange.
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureVector {
  featureId: string
  assetIdentifier: string
  exchangeIdentifier: string
  timestamp: number
  /** The computed feature value(s). */
  values: Record<string, number>
  /** Rule 5 — Immutable once published. */
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Quality Result  (§11)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureQualityResult {
  status: QualityStatus
  missingValues: number
  nullPercentage: number
  duplicateCount: number
  outlierCount: number
  statisticalStability: number
  distributionShift: number
  driftScore: number
  schemaValid: boolean
  dependenciesValid: boolean
  issues: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformation Metadata  (§4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface TransformationMetadata {
  normalizationMethod: string
  transformationPipeline: string[]
  transformationVersion: string
  /** Rule 17 — Mathematically reproducible parameters. */
  parameters: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Metadata  (§4, §6, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export interface DependencyMetadata {
  sourceDatasets: string[]
  sourceVersions: string[]
  featureDependencies: string[]
  dependencyVersions: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Lineage  (Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureLineage {
  rawDatasetIds: string[]
  rawDatasetVersions: string[]
  featureDefinitionVersion: string
  transformationVersion: string
  normalizationVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Version Bundle + Governance  (§10, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureVersionBundle {
  featureVersion: string
  transformationVersion: string
  datasetVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface FeatureGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  publicationTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Feature Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalFeatureContract {
  featureEventId: string // Rule 3
  featureVersion: string
  featureGroupId: string
  featureIdentifier: string
  assetIdentifier: string
  exchangeIdentifier: string
  featureTimestamp: number

  // §6 — Canonical Feature Contract fields
  featureVector: FeatureVector
  freshnessStatus: FreshnessStatus
  qualityStatus: QualityStatus
  qualityResult: FeatureQualityResult
  transformationMetadata: TransformationMetadata
  dependencyMetadata: DependencyMetadata

  // Metadata + Governance
  featureMetadata: {
    featureEventId: string
    featureVersion: string
    versions: FeatureVersionBundle
    lineage: FeatureLineage
    pipelineType: PipelineType
  }
  governanceMetadata: FeatureGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Store Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureStoreConfiguration {
  /** Registered feature definitions (Rule 8 — version controlled). */
  featureDefinitions: Map<string, FeatureDefinition>
  /** §11 — Quality thresholds. */
  qualityThresholds: {
    maxNullPercentage: number
    maxMissingValues: number
    minStatisticalStability: number
    maxDistributionShift: number
    maxDriftScore: number
  }
  /** §8 — Online store freshness timeout (ms). */
  onlineFreshnessTimeoutMs: number
  /** Rule 9 — Sync mode between online and offline. */
  syncMode: 'EVENT_DRIVEN' | 'BATCH' | 'HYBRID'
  /** Rule 10 — Serving independence. */
  servingIndependent: boolean
  /** Rule 6 — Enforce training/production identity. */
  enforceTrainingProductionIdentity: boolean
  versions: FeatureVersionBundle
}

export const DEFAULT_FEATURE_STORE_CONFIG: Omit<FeatureStoreConfiguration, 'versions' | 'featureDefinitions'> = {
  qualityThresholds: {
    maxNullPercentage: 0.05,
    maxMissingValues: 10,
    minStatisticalStability: 0.7,
    maxDistributionShift: 0.3,
    maxDriftScore: 0.5,
  },
  onlineFreshnessTimeoutMs: 60000,
  syncMode: 'EVENT_DRIVEN',
  servingIndependent: true,
  enforceTrainingProductionIdentity: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export const WRITE_PIPELINE_STAGES = [
  'DATA_RECEPTION', 'SOURCE_VALIDATION', 'DATA_QUALITY_VERIFICATION',
  'SCHEMA_HARMONIZATION', 'FEATURE_DEPENDENCY_RESOLUTION', 'FEATURE_ENGINEERING',
  'NORMALIZATION', 'TRANSFORMATION', 'FEATURE_VALIDATION',
  'FEATURE_VERSION_ASSIGNMENT', 'ONLINE_STORE_WRITE', 'OFFLINE_STORE_WRITE',
  'METADATA_RECORDING', 'FEATURE_PUBLICATION',
] as const

export const ONLINE_READ_STAGES = [
  'INFERENCE_REQUEST', 'FEATURE_LOOKUP', 'FRESHNESS_VALIDATION',
  'VERSION_RESOLUTION', 'LOW_LATENCY_RETRIEVAL', 'FEATURE_DELIVERY',
] as const

export const OFFLINE_READ_STAGES = [
  'RESEARCH_REQUEST', 'POINT_IN_TIME_VERSION_RESOLUTION',
  'HISTORICAL_SNAPSHOT_RETRIEVAL', 'FEATURE_RECONSTRUCTION',
  'DATASET_ASSEMBLY', 'RESEARCH_DELIVERY',
] as const

export const FSE_VERSION = '1.0.0'
export const FEATURE_SCHEMA_VERSION = '1.0.0'
