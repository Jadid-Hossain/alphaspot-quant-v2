// CHAPTER 6.6 — AI Market Regime Intelligence Engine Types
//
// The AMRIE is the exclusive market state intelligence layer between the AI
// Data Quality, Leakage Prevention & Research Validation Engine (Chapter 6.5)
// and the AI Model Training & Experiment Orchestration Engine (Chapter 6.7).
// No downstream AI engine shall independently determine market conditions (§1).
//
// 25 architectural rules enforced (see §25) — the most of any chapter.
// Dual regime ecosystems: Swing (10 regimes S1-S10) + Instant Scalping (10 regimes I1-I10).
// 10 intelligence domains. 19-stage pipeline. 3 execution environments.

// ─────────────────────────────────────────────────────────────────────────────
// Research Pipelines  (§3, Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPipeline = 'SWING' | 'INSTANT_SCALPING'

// ─────────────────────────────────────────────────────────────────────────────
// Execution Environments  (§22, Rule 19/21)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionEnvironment = 'RUNTIME' | 'OFFLINE_RESEARCH' | 'REGISTRY'

// ─────────────────────────────────────────────────────────────────────────────
// Swing Trading Regime Taxonomy  (§7.1 — 10 regimes S1-S10)
// ─────────────────────────────────────────────────────────────────────────────

export type SwingRegime =
  | 'BULL_EXPANSION'        // S1
  | 'BULL_EXHAUSTION'       // S2
  | 'ACCUMULATION'          // S3
  | 'DISTRIBUTION'          // S4
  | 'BEAR_EXPANSION'        // S5
  | 'CAPITULATION'          // S6
  | 'RECOVERY'              // S7
  | 'SIDEWAYS_CONSOLIDATION' // S8
  | 'HIGH_VOLATILITY_EXPANSION' // S9
  | 'LOW_VOLATILITY_COMPRESSION' // S10

export const SWING_REGIMES: SwingRegime[] = [
  'BULL_EXPANSION', 'BULL_EXHAUSTION', 'ACCUMULATION', 'DISTRIBUTION',
  'BEAR_EXPANSION', 'CAPITULATION', 'RECOVERY', 'SIDEWAYS_CONSOLIDATION',
  'HIGH_VOLATILITY_EXPANSION', 'LOW_VOLATILITY_COMPRESSION',
]

// ─────────────────────────────────────────────────────────────────────────────
// Instant Scalping Regime Taxonomy  (§7.2 — 10 regimes I1-I10)
// ─────────────────────────────────────────────────────────────────────────────

export type ScalpingRegime =
  | 'MOMENTUM_BURST'          // I1
  | 'ORDER_BOOK_COMPRESSION'  // I2
  | 'LIQUIDITY_VACUUM'        // I3
  | 'LIQUIDITY_ABSORPTION'    // I4
  | 'SPREAD_EXPANSION'        // I5
  | 'SPREAD_COMPRESSION'      // I6
  | 'WHALE_ACTIVITY'          // I7
  | 'MICRO_PULLBACK'          // I8
  | 'DEAD_MARKET'             // I9
  | 'NEWS_SHOCK'              // I10

export const SCALPING_REGIMES: ScalpingRegime[] = [
  'MOMENTUM_BURST', 'ORDER_BOOK_COMPRESSION', 'LIQUIDITY_VACUUM',
  'LIQUIDITY_ABSORPTION', 'SPREAD_EXPANSION', 'SPREAD_COMPRESSION',
  'WHALE_ACTIVITY', 'MICRO_PULLBACK', 'DEAD_MARKET', 'NEWS_SHOCK',
]

// Union of all regime types
export type MarketRegime = SwingRegime | ScalpingRegime

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Domains  (§8.1 — 10 domains)
// ─────────────────────────────────────────────────────────────────────────────

export type IntelligenceDomain =
  | 'TREND' | 'VOLATILITY' | 'LIQUIDITY' | 'MARKET_STRUCTURE'
  | 'MARKET_CYCLE' | 'ORDER_BOOK' | 'TRADE_FLOW' | 'MICROSTRUCTURE'
  | 'CROSS_ASSET' | 'ALTERNATIVE_DATA'

// ─────────────────────────────────────────────────────────────────────────────
// Regime Opinion  (§9 — each domain produces an independent opinion)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeOpinion {
  domain: IntelligenceDomain
  regime: MarketRegime
  confidence: number // 0..1
  scores: Record<string, number>
  timestamp: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Probability Distribution  (§7.3)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeProbabilityEntry {
  regime: MarketRegime
  probability: number // 0..1
}

export interface RegimeProbabilityDistribution {
  /** §7.3 — Probability distribution must sum to 1.0 (100%). */
  entries: RegimeProbabilityEntry[]
  /** Primary regime (highest probability). */
  primaryRegime: MarketRegime
  /** Secondary regime (second-highest probability). */
  secondaryRegime: MarketRegime
  /** Sum of all probabilities (must be 1.0). */
  totalProbability: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Confidence  (§7.4, §10 — 7 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeConfidence {
  classificationConfidence: number // 0..1
  dataCompleteness: number // 0..1
  featureAgreement: number // 0..1
  historicalSimilarity: number // 0..1
  modelAgreement: number // 0..1
  transitionStability: number // 0..1
  temporalConsistency: number // 0..1
  /** Overall confidence (weighted aggregate). */
  overallConfidence: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Stability  (§7.5 — 6 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeStability {
  expectedPersistence: number // 0..1 (how long regime expected to last)
  transitionProbability: number // 0..1 (probability of transition)
  historicalStability: number // 0..1
  volatilityStability: number // 0..1
  liquidityStability: number // 0..1
  trendStability: number // 0..1
  /** Overall stability (weighted aggregate). */
  overallStability: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Transition  (§7.6, §12)
// ─────────────────────────────────────────────────────────────────────────────

export type TransitionStatus = 'TRANSITION_INITIATION' | 'TRANSITION_CONFIRMATION' | 'TRANSITION_COMPLETION' | 'TRANSITION_FAILURE' | 'FALSE_TRANSITION' | 'NO_TRANSITION'

export interface RegimeTransition {
  sourceRegime: MarketRegime
  targetRegime: MarketRegime
  probability: number // 0..1
  speed: number // 0..1 (1 = instant)
  stability: number // 0..1
  historicalSimilarity: number // 0..1
  timestamp: number
  version: string
  status: TransitionStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Structure / Volatility / Liquidity / Trend Classifications  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export type MarketStructureClassification = 'UPTREND' | 'DOWNTREND' | 'RANGE' | 'BREAKOUT' | 'REVERSAL'
export type VolatilityClassification = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME'
export type LiquidityClassification = 'THIN' | 'NORMAL' | 'DEEP' | 'EXCESSIVE'
export type TrendClassification = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

// ─────────────────────────────────────────────────────────────────────────────
// Regime Uncertainty  (§11)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeUncertainty {
  missingData: number // 0..1
  conflictingSignals: number // 0..1
  lowLiquidity: number // 0..1
  rapidMarketChanges: number // 0..1
  volatilityShock: number // 0..1
  featureInstability: number // 0..1
  regimeAmbiguity: number // 0..1
  /** Overall uncertainty (higher = more uncertain). */
  overallUncertainty: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Statuses  (§5, Rule 4/13/16)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT' | 'VALIDATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PUBLISHED' | 'REJECTED' | 'QUARANTINED' | 'RECALLED' | 'SAFE_MODE'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// Regime Manifest  (§17, Rule 14, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeManifest {
  /** Rule 14 — Every published regime generates a complete manifest. */
  manifestId: string
  regimeIdentifier: string
  regimeVersion: string
  datasetVersion: string
  featureManifestVersion: string
  validationCertificateVersion: string
  methodologyVersion: string
  configurationVersion: string
  researchPipeline: ResearchPipeline
  assetIdentifier: string
  timeframe: string
  publicationTimestamp: number
  governanceMetadata: RegimeGovernanceMetadata
  auditIdentifier: string
  /** Rule 23 — Runtime loads only one active manifest version at a time. */
  activeManifestVersion: string
  /** Rule 23 — Manifest content hash for atomic loading verification. */
  contentHash: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Lineage  (§19, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeLineage {
  /** Rule 5 — Complete lineage linking datasets, feature manifests, validation
   *  certificates, methodologies, registry entries, and governance metadata. */
  datasetVersionIds: string[]
  featureManifestVersionIds: string[]
  validationCertificateIds: string[]
  methodologyVersionIds: string[]
  registryEntryIds: string[]
  governanceEventIds: string[]
  upstreamEngines: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Version Bundle  (§16)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeVersionBundle {
  regimeVersion: string
  methodologyVersion: string
  configurationVersion: string
  featureManifestVersion: string
  validationVersion: string
  researchVersion: string
  pipelineVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Governance Metadata  (§18)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  governanceNotes: string[]
  publicationTimestamp: number | null
  /** Rule 7 — Cross-pipeline regime generation approval. */
  crossPipelineApproved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Market Regime Contract  (§5, §7.7, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalMarketRegimeContract {
  /** Rule 2 — Unique Market Regime Event ID. */
  regimeEventId: string
  /** §5 — Regime identifier. */
  regimeIdentifier: string
  /** §5 — Regime version. */
  regimeVersion: string
  /** §5 — Research pipeline. */
  researchPipeline: ResearchPipeline
  /** §5 — Current market regime (primary). */
  currentRegime: MarketRegime
  /** §5 — Regime confidence. */
  regimeConfidence: RegimeConfidence
  /** §5 — Regime probability distribution. */
  probabilityDistribution: RegimeProbabilityDistribution
  /** §5 — Regime stability score. */
  regimeStability: RegimeStability
  /** §5 — Regime transition probability. */
  transitionProbability: RegimeTransition
  /** §5 — Expected regime persistence. */
  expectedPersistence: number
  /** §5 — Market structure classification. */
  marketStructureClassification: MarketStructureClassification
  /** §5 — Volatility classification. */
  volatilityClassification: VolatilityClassification
  /** §5 — Liquidity classification. */
  liquidityClassification: LiquidityClassification
  /** §5 — Trend classification. */
  trendClassification: TrendClassification
  /** §5 — Configuration version. */
  configurationVersion: string
  /** §5 — Validation metadata. */
  validationMetadata: { certificateId: string; certificateVersion: string; validated: boolean }
  /** §5 — Governance metadata. */
  governanceMetadata: RegimeGovernanceMetadata
  /** §5 — Regime manifest. */
  regimeManifest: RegimeManifest
  /** §5 — Regime registry entry. */
  registryEntry: RegimeRegistryEntry | null
  /** §5 — Publication status. */
  publicationStatus: PublicationStatus
  /** §5 — Regime uncertainty (§11). */
  uncertainty: RegimeUncertainty
  /** §9 — Intelligence domain opinions. */
  domainOpinions: RegimeOpinion[]
  /** §22 — Execution environment. */
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
  /** Rule 11/17 — Content hash for deterministic replay. */
  contentHash: string
  /** §19 — Lineage. */
  lineage: RegimeLineage
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Registry Entry  (§15.1, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeRegistryEntry {
  /** §15.1 — Market Regime Identifier. */
  regimeIdentifier: string
  /** §15.1 — Market Regime Event ID. */
  regimeEventId: string
  /** §15.1 — Pipeline identifier. */
  pipelineIdentifier: ResearchPipeline
  /** §15.1 — Research version. */
  researchVersion: string
  /** §15.1 — Methodology version. */
  methodologyVersion: string
  /** §15.1 — Configuration version. */
  configurationVersion: string
  /** §15.1 — Feature manifest version. */
  featureManifestVersion: string
  /** §15.1 — Validation certificate version. */
  validationCertificateVersion: string
  /** §15.1 — Primary regime. */
  primaryRegime: MarketRegime
  /** §15.1 — Secondary regime. */
  secondaryRegime: MarketRegime
  /** §15.1 — Probability distribution. */
  probabilityDistribution: RegimeProbabilityDistribution
  /** §15.1 — Confidence score. */
  confidenceScore: number
  /** §15.1 — Transition status. */
  transitionStatus: TransitionStatus
  /** §15.1 — Expected persistence. */
  expectedPersistence: number
  /** §15.1 — Publication timestamp. */
  publicationTimestamp: number
  /** §15.1 — Governance status. */
  governanceStatus: ApprovalStatus
  /** Rule 16 — Immutable after publication. */
  immutable: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeConfiguration {
  researchPipeline: ResearchPipeline
  /** §22 — Execution environment. */
  executionEnvironment: ExecutionEnvironment
  /** Source artifact IDs (Rule 1 — only governance-approved). */
  sourceDatasetEventIds: string[]
  sourceFeatureManifestIds: string[]
  sourceValidationCertificateIds: string[]
  /** §8 — Intelligence domains to evaluate. */
  intelligenceDomains: IntelligenceDomain[]
  /** §7.4 — Confidence thresholds. */
  confidenceThresholds: {
    minClassificationConfidence: number
    minDataCompleteness: number
    minOverallConfidence: number
  }
  /** §7.5 — Stability thresholds. */
  stabilityThresholds: {
    minExpectedPersistence: number
    maxTransitionProbability: number
  }
  /** §9 — Fusion weights per domain. */
  fusionWeights: Partial<Record<IntelligenceDomain, number>>
  /** Rule 7 — Cross-pipeline (requires governance approval). */
  crossPipelineApproved: boolean
  /** Rule 12 — Methodology version. */
  methodologyVersion: string
  /** Asset and timeframe. */
  assetIdentifier: string
  timeframe: string
  /** §22 — Active manifest version for runtime (Rule 23). */
  activeManifestVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Regime Input Contract  (§4)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeInput {
  /** §4 — Governance-approved datasets. */
  approvedDatasets: Array<{ datasetEventId: string; version: string }>
  /** §4 — Governance-approved feature manifests. */
  approvedFeatureManifests: Array<{ manifestId: string; version: string }>
  /** §4 — Validation certificates. */
  validationCertificates: Array<{ certificateId: string; version: string }>
  /** §4 — Historical market data. */
  historicalMarketData: Array<{ datasetId: string; version: string }>
  /** §4 — Market state store. */
  marketStateStore: Array<{ storeId: string; version: string }>
  /** §4 — Market microstructure engine. */
  marketMicrostructure: Array<{ engineId: string; version: string }>
  /** §4 — Order book intelligence engine. */
  orderBookIntelligence: Array<{ engineId: string; version: string }>
  /** §4 — Trade flow intelligence engine. */
  tradeFlowIntelligence: Array<{ engineId: string; version: string }>
  /** §4 — Alternative data store. */
  alternativeDataStore: Array<{ sourceId: string; version: string }>
  /** §4 — Research configuration. */
  researchConfiguration: Array<{ researchId: string; version: string }>
  /** §4 — Market calendar. */
  marketCalendar: Array<{ calendarId: string; version: string }>
  /** §4 — Exchange metadata. */
  exchangeMetadata: Array<{ exchangeId: string; version: string }>
  /** §4 — Asset metadata. */
  assetMetadata: Array<{ assetId: string; version: string }>
  /** §4 — Governance metadata. */
  governanceMetadata: Array<{ governanceId: string; version: string }>
  /** §4 — Configuration metadata. */
  configurationMetadata: Array<{ configId: string; version: string }>
  /** §4 — Feature registry. */
  featureRegistry: Array<{ entryId: string; version: string }>
  /** §4 — Validation registry. */
  validationRegistry: Array<{ entryId: string; version: string }>
  /** Market observations for regime classification. */
  marketObservations: Array<{ timestamp: number; symbol: string; price: number; volume: number; [key: string]: unknown }>
  /** §4 — Never consumes predictions, signals, portfolio decisions, etc. */
  predictionsConsumed: false
  tradingSignalsConsumed: false
  portfolioDecisionsConsumed: false
  executionCommandsConsumed: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AMRIEConfiguration {
  /** Rule 7 — Enforce ecosystem isolation. */
  enforceEcosystemIsolation: boolean
  /** Rule 8 — Enforce multi-domain consensus. */
  enforceMultiDomainConsensus: boolean
  /** Rule 9/22 — Enforce no lookahead (only observations at or before T). */
  enforceNoLookahead: boolean
  /** Rule 11 — Enable deterministic replay. */
  enableDeterministicReplay: boolean
  /** Rule 13 — Fail-closed. */
  failClosed: boolean
  /** Rule 19/21 — Runtime never does heavy computation. */
  enforceRuntimeNoHeavyComputation: boolean
  /** Rule 23 — Enforce single active manifest. */
  enforceSingleActiveManifest: boolean
  /** Rule 24 — Enable Safe Mode on manifest load failure. */
  enableSafeMode: boolean
  /** Rule 25 — Instant Scalping uses streaming in-memory data only. */
  enforceScalpingStreamingOnly: boolean
  /** §7.4 — Default confidence thresholds. */
  defaultConfidenceThresholds: {
    minClassificationConfidence: number
    minDataCompleteness: number
    minOverallConfidence: number
  }
  /** §7.5 — Default stability thresholds. */
  defaultStabilityThresholds: {
    minExpectedPersistence: number
    maxTransitionProbability: number
  }
  /** §9 — Default fusion weights. */
  defaultFusionWeights: Partial<Record<IntelligenceDomain, number>>
  /** §21 — Observability enabled. */
  observabilityEnabled: boolean
}

export const DEFAULT_AMRIE_CONFIG: AMRIEConfiguration = {
  enforceEcosystemIsolation: true,
  enforceMultiDomainConsensus: true,
  enforceNoLookahead: true,
  enableDeterministicReplay: true,
  failClosed: true,
  enforceRuntimeNoHeavyComputation: true,
  enforceSingleActiveManifest: true,
  enableSafeMode: true,
  enforceScalpingStreamingOnly: true,
  defaultConfidenceThresholds: {
    minClassificationConfidence: 0.5,
    minDataCompleteness: 0.8,
    minOverallConfidence: 0.6,
  },
  defaultStabilityThresholds: {
    minExpectedPersistence: 0.3,
    maxTransitionProbability: 0.7,
  },
  defaultFusionWeights: {
    TREND: 0.15, VOLATILITY: 0.12, LIQUIDITY: 0.12, MARKET_STRUCTURE: 0.15,
    MARKET_CYCLE: 0.10, ORDER_BOOK: 0.08, TRADE_FLOW: 0.08, MICROSTRUCTURE: 0.08,
    CROSS_ASSET: 0.07, ALTERNATIVE_DATA: 0.05,
  },
  observabilityEnabled: true,
}

// Pipeline Stages (§6 — 19 stages)
export const REGIME_PIPELINE_STAGES = [
  'GOVERNANCE_APPROVED_DATASET_RETRIEVAL',
  'VALIDATION_CERTIFICATE_VERIFICATION',
  'FEATURE_MANIFEST_RETRIEVAL',
  'CONFIGURATION_VALIDATION',
  'MULTI_TIMEFRAME_SYNCHRONIZATION',
  'MARKET_STRUCTURE_ANALYSIS',
  'VOLATILITY_ANALYSIS',
  'LIQUIDITY_ANALYSIS',
  'TREND_ANALYSIS',
  'MICROSTRUCTURE_ANALYSIS',
  'MARKET_CYCLE_ANALYSIS',
  'REGIME_CLASSIFICATION',
  'REGIME_CONFIDENCE_ESTIMATION',
  'TRANSITION_ANALYSIS',
  'STABILITY_ANALYSIS',
  'GOVERNANCE_VALIDATION',
  'REGIME_PUBLICATION',
  'REGISTRY_REGISTRATION',
  'MARKET_REGIME_COMPLETION',
] as const

// Live Runtime Inference Pipeline (§22)
export const RUNTIME_INFERENCE_STAGES = [
  'STREAMING_MARKET_DATA',
  'FEATURE_CACHE_UPDATE',
  'ROLLING_WINDOW_UPDATE',
  'LOAD_ACTIVE_REGIME_MANIFEST',
  'LIGHTWEIGHT_RULE_EVALUATION',
  'OPTIONAL_ONNX_FORWARD_PASS',
  'CONFIDENCE_CALCULATION',
  'REGIME_STABILITY_CHECK',
  'HYSTERESIS_FILTER',
  'PUBLISH_CURRENT_REGIME',
  'BROADCAST_TO_DECISION_ENGINES',
] as const

export const AMRIE_VERSION = '1.0.0'
export const MARKET_REGIME_SCHEMA_VERSION = '1.0.0'
