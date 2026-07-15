// CHAPTER 4.5 — Feature Selection & Feature Governance Types
//
// The FSG evaluates, selects, validates, monitors, and governs ML features (§1).
// Every feature registered before use (Rule 5). Historical immutable (Rule 7).
// Drift continuously monitored (Rule 8). Lifecycle transitions auditable (Rule 10).
// No bypassing governance (Rule 11). Acyclic dependencies (Rule 12).
// FSG never directly suspends inference — publishes alerts (Rule 17).

// ─────────────────────────────────────────────────────────────────────────────
// Feature Lifecycle  (Chapter 4.5 §12, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureLifecycleState =
  | 'DEVELOPMENT'
  | 'EXPERIMENTAL'
  | 'CANDIDATE'
  | 'APPROVED'
  | 'PRODUCTION'
  | 'DEPRECATED'
  | 'RETIRED'

const ALLOWED_FEATURE_TRANSITIONS: Record<FeatureLifecycleState, FeatureLifecycleState[]> = {
  DEVELOPMENT: ['EXPERIMENTAL', 'RETIRED'],
  EXPERIMENTAL: ['CANDIDATE', 'DEVELOPMENT', 'RETIRED'],
  CANDIDATE: ['APPROVED', 'EXPERIMENTAL', 'RETIRED'],
  APPROVED: ['PRODUCTION', 'CANDIDATE', 'RETIRED'],
  PRODUCTION: ['DEPRECATED', 'RETIRED'],
  DEPRECATED: ['RETIRED', 'PRODUCTION'], // can un-deprecate
  RETIRED: [], // terminal
}

export function canTransitionFeatureLifecycle(from: FeatureLifecycleState, to: FeatureLifecycleState): boolean {
  return ALLOWED_FEATURE_TRANSITIONS[from]?.includes(to) ?? false
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Registry Entry  (Chapter 4.5 §5, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | 'PRICE' | 'TREND' | 'MOMENTUM' | 'VOLUME' | 'VOLATILITY'
  | 'LIQUIDITY' | 'SPREAD' | 'MICROSTRUCTURE' | 'ORDER_BOOK'
  | 'TRADE_FLOW' | 'STATISTICAL' | 'RELATIVE_STRENGTH'
  | 'CROSS_ASSET' | 'REGIME' | 'TIME' | 'RISK' | 'META'

export interface FeatureEntry {
  featureName: string
  description: string
  category: FeatureCategory
  version: FeatureVersion
  owner: string
  dataSource: string
  createdAt: number
  retiredAt: number | null
  lifecycleState: FeatureLifecycleState
  dependencies: string[] // upstream feature names (acyclic Rule 12)
  governance: FeatureGovernance
}

export interface FeatureVersion {
  featureVersion: string
  schemaVersion: string
  extractionVersion: string
  processingVersion: string
  governanceVersion: string
  registryVersion: string
}

export interface FeatureGovernance {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  reviewer: string | null
  reviewTimestamp: number | null
  governanceNotes: string[]
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  retirementReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Quality  (Chapter 4.5 §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureQuality {
  featureName: string
  missingRate: number // 0..1
  variance: number
  entropy: number | null
  cardinality: number
  distributionStability: number // 0..1
  temporalStability: number // 0..1
  noiseLevel: number | null // 0..1
  outlierRate: number // 0..1
  overallQuality: number // 0..1
  quarantined: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Importance  (Chapter 4.5 §7, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export type ImportanceMethod =
  | 'SHAP' | 'PERMUTATION' | 'GAIN' | 'SPLIT'
  | 'MUTUAL_INFORMATION' | 'INFORMATION_GAIN' | 'CORRELATION_CONTRIBUTION'

export interface FeatureImportance {
  featureName: string
  method: ImportanceMethod
  importanceScore: number // 0..1
  rank: number
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Stability  (Chapter 4.5 §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureStability {
  featureName: string
  rollingVariance: number
  distributionDrift: number // 0..1
  temporalConsistency: number // 0..1
  regimeStability: number // 0..1
  statisticalPersistence: number // 0..1
  availability: number // 0..1
  overallStability: number // 0..1
  downgraded: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Drift  (Chapter 4.5 §10, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export type DriftMethod =
  | 'PSI' | 'JENSEN_SHANNON' | 'KOLMOGOROV_SMIRNOV' | 'WASSERSTEIN' | 'DISTRIBUTION_SHIFT'

export interface FeatureDrift {
  featureName: string
  method: DriftMethod
  driftScore: number // 0..1 (higher = more drift)
  threshold: number
  isDrifting: boolean
  isCatastrophic: boolean
  detectedAt: number
  baseline: { mean: number; std: number } | null
  current: { mean: number; std: number } | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Governance Snapshot  (Chapter 4.5 §4 — Output Contract)
// Immutable (Rule 7).
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureGovernanceSnapshot {
  featureSetId: string
  featureVersion: string
  schemaVersion: string
  selectedFeatures: string[]
  rejectedFeatures: Array<{ feature: string; reason: string }>
  importanceScores: Record<string, number>
  driftScores: Record<string, number>
  stabilityScores: Record<string, number>
  qualityScores: Record<string, number>
  governanceStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  metadata: Record<string, unknown>
  version: number
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Integrity Alert  (Chapter 4.5 Rule 15, Rule 17)
// FSG never directly suspends inference — publishes alerts (Rule 17).
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface FeatureIntegrityAlert {
  alertId: string
  type: 'CATACLYSMIC_DRIFT' | 'FEATURE_CORRUPTION' | 'SCHEMA_VIOLATION' | 'REGISTRY_FAILURE'
  severity: AlertSeverity
  featureName: string
  driftScore: number
  threshold: number
  message: string
  publishedAt: number
  // Rule 17 — downstream systems decide response, not FSG
  triggersAction: false
}

export const FSG_VERSION = '1.0.0'
export const FSG_GOVERNANCE_VERSION = '1.0.0'
export const FSG_REGISTRY_VERSION = '1.0.0'
