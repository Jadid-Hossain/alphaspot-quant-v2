// CHAPTER 5.17 — Alternative Data Management Engine Types
//
// The ADME is the exclusive bridge between external alternative data providers
// and the Feature Store Engine (§1). Guarantees every AI model consumes
// institutionally validated, deterministic, reproducible, fully governed datasets.
//
// 21 architectural rules enforced (see §17).
// 16-stage pipeline (§5 — no skips).

// ─────────────────────────────────────────────────────────────────────────────
// Data Source Types  (§3, §7)
// ─────────────────────────────────────────────────────────────────────────────

export type AlternativeDataSource =
  | 'BLOCKCHAIN_DATA' | 'ON_CHAIN_METRICS' | 'WHALE_WALLET_ACTIVITY'
  | 'EXCHANGE_RESERVE_DATA' | 'STABLECOIN_SUPPLY' | 'FUNDING_RATES'
  | 'OPEN_INTEREST' | 'LIQUIDATION_DATA' | 'ORDER_FLOW_DATA'
  | 'NEWS_INTELLIGENCE' | 'SOCIAL_MEDIA' | 'REDDIT_INTELLIGENCE'
  | 'GITHUB_ACTIVITY' | 'GOOGLE_TRENDS' | 'MACROECONOMIC_INDICATORS'
  | 'ETF_FLOW_DATA' | 'REGULATORY_ANNOUNCEMENTS'

export type ProviderType =
  | 'EXCHANGE_API' | 'BLOCKCHAIN_NODE' | 'NEWS_API' | 'SOCIAL_MEDIA_API'
  | 'GITHUB_API' | 'MACROECONOMIC_FEED' | 'ETF_DATA_PROVIDER'
  | 'ALTERNATIVE_DATA_VENDOR' | 'INTERNAL_RESEARCH_PIPELINE' | 'CUSTOM_DATA_SOURCE'

// ─────────────────────────────────────────────────────────────────────────────
// Data Structure Types  (§5, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export type DataStructureType = 'STRUCTURED' | 'UNSTRUCTURED'

// ─────────────────────────────────────────────────────────────────────────────
// Freshness + Quality + Completeness  (§4, §8)
// ─────────────────────────────────────────────────────────────────────────────

export type FreshnessStatus = 'FRESH' | 'STALE' | 'EXPIRED' | 'PENDING' | 'UNKNOWN'
export type QualityStatus = 'VALIDATED' | 'WARNING' | 'INVALID' | 'QUARANTINED'
export type CompletenessStatus = 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE' | 'MISSING'

// ─────────────────────────────────────────────────────────────────────────────
// Provider Registration  (§7, Rule 1/11)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataProvider {
  providerId: string
  providerName: string
  providerType: ProviderType
  dataSource: AlternativeDataSource
  endpoint: string
  /** Rule 11 — Provider metadata independently version controlled. */
  version: string
  /** §8 — Provider reliability score (0..1). */
  reliabilityScore: number
  /** Whether provider is currently active. */
  active: boolean
  /** Rate limits. */
  rateLimitPerMinute: number
  /** Authentication required. */
  authRequired: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Dataset  (§6)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalDataset {
  /** Standardized key-value data. */
  data: Record<string, number | string | boolean>
  /** Schema version used for standardization. */
  schemaVersion: string
  /** Whether data was originally unstructured (Rule 19). */
  originallyUnstructured: boolean
  /** Parsing pipeline version (Rule 19 — if unstructured). */
  parsingPipelineVersion: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Quality Result  (§8, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataQualityResult {
  status: QualityStatus
  qualityScore: number // 0..1
  missingDataCount: number
  duplicateCount: number
  outlierCount: number
  schemaValid: boolean
  timestampValid: boolean
  completenessScore: number // 0..1
  statisticalValid: boolean
  providerReliabilityScore: number
  consistencyVerified: boolean
  issues: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineage + Dependency  (§10, Rule 6/15)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataLineage {
  providerId: string
  providerVersion: string
  sourceEndpoint: string
  transformationSteps: string[]
  dependencyIds: string[]
  dependencyVersions: string[]
  configurationVersion: string
  governanceVersion: string
}

export interface DependencyMetadata {
  upstreamDatasetIds: string[]
  upstreamVersions: string[]
  downstreamConsumers: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Version Bundle + Governance  (§9, §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetVersionBundle {
  datasetVersion: string
  providerVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface DataGovernanceMetadata {
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
// Canonical Alternative Data Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalAlternativeDataContract {
  datasetEventId: string // Rule 3
  datasetVersion: string
  datasetIdentifier: string
  providerIdentifier: string
  assetIdentifier: string
  exchangeIdentifier: string

  // Rule 18 — Dual timestamps
  eventTimestamp: number // When the underlying event occurred
  ingestionTimestamp: number // When AlphaSpot ingested the data

  // §6 — Canonical contract fields
  canonicalDataset: CanonicalDataset
  qualityScore: number
  qualityResult: DataQualityResult
  freshnessStatus: FreshnessStatus
  completenessStatus: CompletenessStatus

  // Metadata
  dataMetadata: {
    datasetEventId: string
    datasetVersion: string
    versions: DatasetVersionBundle
    lineage: DataLineage
    dependencyMetadata: DependencyMetadata
    dataStructureType: DataStructureType
  }
  governanceMetadata: DataGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AlternativeDataConfiguration {
  /** §7 — Registered providers (Rule 1). */
  providers: Map<string, DataProvider>
  /** §8 — Quality thresholds. */
  qualityThresholds: {
    minQualityScore: number
    maxMissingDataCount: number
    maxDuplicateCount: number
    minCompletenessScore: number
    minProviderReliabilityScore: number
  }
  /** §13 — Freshness timeout (ms). */
  freshnessTimeoutMs: number
  /** §10 — Timestamp synchronization tolerance (ms). */
  timestampSyncToleranceMs: number
  /** Rule 19 — Unstructured data parsing enabled. */
  unstructuredParsingEnabled: boolean
  versions: DatasetVersionBundle
}

export const DEFAULT_ADME_CONFIG: Omit<AlternativeDataConfiguration, 'versions' | 'providers'> = {
  qualityThresholds: {
    minQualityScore: 0.7,
    maxMissingDataCount: 5,
    maxDuplicateCount: 2,
    minCompletenessScore: 0.85,
    minProviderReliabilityScore: 0.6,
  },
  freshnessTimeoutMs: 300000, // 5 minutes
  timestampSyncToleranceMs: 1000,
  unstructuredParsingEnabled: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages  (§5 — 16 stages)
// ─────────────────────────────────────────────────────────────────────────────

export const ADME_PIPELINE_STAGES = [
  'PROVIDER_REGISTRATION', 'DATA_ACQUISITION', 'INTEGRITY_VALIDATION',
  'DATA_CLASSIFICATION', 'UNSTRUCTURED_DATA_PARSING', 'SCHEMA_STANDARDIZATION',
  'TIMESTAMP_SYNCHRONIZATION', 'DATA_NORMALIZATION', 'QUALITY_ASSESSMENT',
  'DUPLICATE_DETECTION', 'MISSING_DATA_VALIDATION', 'MULTI_SOURCE_FUSION',
  'VERSION_ASSIGNMENT', 'DATASET_PUBLICATION', 'METADATA_RECORDING',
  'DATASET_COMPLETION',
] as const

export const ADME_VERSION = '1.0.0'
export const ALT_DATA_SCHEMA_VERSION = '1.0.0'
