// CHAPTER 5.20 — Configuration & Version Control Engine Types
//
// The CVCE is the exclusive source of truth for all system configurations and
// immutable version histories consumed by every engine within AlphaSpot (§1).
// Guarantees complete reproducibility — every prediction/simulation/backtest/
// paper trading session/portfolio decision can be reconstructed from exact config state.
//
// 20 architectural rules + 2 sub-rules enforced (see §17, including Rule 18A/18B).
// 13-stage pipeline (§5 — no skips).

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Categories  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type ConfigurationCategory =
  | 'AI_MODEL' | 'PROMPT' | 'FEATURE_DEFINITION' | 'STRATEGY_PARAMETER'
  | 'RISK_PARAMETER' | 'PORTFOLIO_POLICY' | 'EXECUTION_PARAMETER'
  | 'EXCHANGE_PROFILE' | 'DATA_PROVIDER' | 'ALTERNATIVE_DATA_SOURCE'
  | 'GOVERNANCE_POLICY' | 'INFRASTRUCTURE' | 'ENVIRONMENT_VARIABLE'
  | 'ENCRYPTED_SECRET_REFERENCE' | 'VAULT_REFERENCE' | 'CREDENTIAL_REFERENCE'
  | 'CUSTOM'

// ─────────────────────────────────────────────────────────────────────────────
// Environment Types  (§9)
// ─────────────────────────────────────────────────────────────────────────────

export type EnvironmentType =
  | 'DEVELOPMENT' | 'RESEARCH' | 'BACKTESTING' | 'SIMULATION'
  | 'PAPER_TRADING' | 'STAGING' | 'PRODUCTION' | 'DISASTER_RECOVERY'
  | 'MULTI_CLOUD' | 'REGIONAL'

// ─────────────────────────────────────────────────────────────────────────────
// Version + Publication Status  (§8, §4)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'ROLLED_BACK' | 'DEPRECATED'
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'EMERGENCY_APPROVED'
export type ReleaseChannel = 'EXPERIMENTAL' | 'STAGING' | 'PRODUCTION' | 'ROLLBACK'

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Graph  (§4, Rule 10/14)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigurationDependency {
  dependencyId: string
  dependencyType: ConfigurationCategory
  /** Rule 14 — Immutable dependency version. */
  dependencyVersion: string
  /** Rule 18B — If secret, only encrypted reference (never plaintext). */
  isSecretReference: boolean
  /** Vault pointer if secret (Rule 18B). */
  vaultPointer: string | null
}

export interface DependencyGraph {
  /** Direct dependencies. */
  dependencies: ConfigurationDependency[]
  /** Transitive dependency hash (composite). */
  compositeDependencyHash: string
  /** Rule 18 — Complete dependency graph for composite hash. */
  allTransitiveDependencies: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Snapshot  (§4, Rule 5/7/18)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigurationSnapshot {
  /** The actual configuration data (JSON-serializable). */
  data: Record<string, unknown>
  /** Rule 18 — Deterministic composite cryptographic hash. */
  configurationHash: string
  /** Hash computed from snapshot + complete dependency graph. */
  compositeHash: string
  /** Schema version used for validation. */
  schemaVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineage + Version + Governance  (§6, §11, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigurationLineage {
  engineVersions: string[]
  modelVersions: string[]
  featureVersions: string[]
  strategyVersions: string[]
  governancePolicyVersions: string[]
  infrastructureVersions: string[]
  environmentVersion: string
}

export interface ConfigurationVersionBundle {
  configurationVersion: string
  dependencyVersion: string
  engineVersion: string
  environmentVersion: string
  governanceVersion: string
}

export interface ConfigurationGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  publicationTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
  /** §10 — Four-eyes principle. */
  fourEyesApproved: boolean
  /** §10 — Digital sign-off. */
  digitalSignOff: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Configuration Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalConfigurationContract {
  configurationEventId: string // Rule 3
  configurationVersion: string
  configurationIdentifier: string
  configurationCategory: ConfigurationCategory
  environmentIdentifier: EnvironmentType
  configurationTimestamp: number

  // §6 — Canonical Configuration Contract fields
  configurationHash: string // Rule 18 — composite cryptographic hash
  dependencyGraph: DependencyGraph
  configurationSnapshot: ConfigurationSnapshot
  approvalStatus: ApprovalStatus
  publicationStatus: PublicationStatus
  rollbackIdentifier: string | null // Rule 8
  releaseChannel: ReleaseChannel

  // Metadata + Governance
  configurationMetadata: {
    configurationEventId: string
    configurationVersion: string
    versions: ConfigurationVersionBundle
    lineage: ConfigurationLineage
    category: ConfigurationCategory
    environment: EnvironmentType
  }
  governanceMetadata: ConfigurationGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigurationSubmission {
  configurationIdentifier: string
  category: ConfigurationCategory
  environment: EnvironmentType
  data: Record<string, unknown>
  dependencies: ConfigurationDependency[]
  /** Rule 18B — Plaintext secrets rejected; only vault references. */
  containsSecrets: boolean
  schemaVersion: string
  releaseChannel: ReleaseChannel
  /** §10 — Change request ID. */
  changeRequestId: string | null
}

export interface CVCEConfiguration {
  /** §10 — Four-eyes principle required. */
  fourEyesRequired: boolean
  /** §10 — Emergency change allowed. */
  emergencyChangesAllowed: boolean
  /** Rule 18A — Hot-reload streaming enabled. */
  hotReloadEnabled: boolean
  /** Rule 18B — Reject plaintext secrets. */
  rejectPlaintextSecrets: boolean
  /** Rule 15 — Drift monitoring. */
  driftMonitoringEnabled: boolean
  /** Registered environments. */
  environments: EnvironmentType[]
  versions: ConfigurationVersionBundle
}

export const DEFAULT_CVCE_CONFIG: Omit<CVCEConfiguration, 'versions'> = {
  fourEyesRequired: true,
  emergencyChangesAllowed: true,
  hotReloadEnabled: true,
  rejectPlaintextSecrets: true,
  driftMonitoringEnabled: true,
  environments: ['DEVELOPMENT', 'STAGING', 'PRODUCTION'],
}

// Pipeline Stages (§5 — 13 stages)
export const CONFIGURATION_STAGES = [
  'CONFIGURATION_SUBMISSION', 'SCHEMA_VALIDATION', 'DEPENDENCY_RESOLUTION',
  'INTEGRITY_VERIFICATION', 'VERSION_ASSIGNMENT', 'CONFIGURATION_SNAPSHOT_CREATION',
  'APPROVAL_WORKFLOW', 'IMMUTABLE_PUBLICATION', 'ENVIRONMENT_DISTRIBUTION',
  'DYNAMIC_CONFIGURATION_STREAMING', 'HOT_RELOAD_VALIDATION',
  'METADATA_RECORDING', 'CONFIGURATION_COMPLETION',
] as const

export const CVCE_VERSION = '1.0.0'
export const CONFIGURATION_SCHEMA_VERSION = '1.0.0'
