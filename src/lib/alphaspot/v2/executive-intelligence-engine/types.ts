// CHAPTER 5.23 — Executive Intelligence & Business Analytics Engine Types
//
// The EIBAE is the exclusive enterprise intelligence layer consuming governed
// outputs from every AlphaSpot engine while remaining completely independent
// of operational decision making (§1).
//
// 20 architectural rules enforced (see §17).
// Dual pipeline: Strategic Batch Reporting (13 stages) + Operational Telemetry
// Streaming (7 stages).

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Types  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineType = 'STRATEGIC_BATCH_REPORTING' | 'OPERATIONAL_TELEMETRY_STREAMING'

// ─────────────────────────────────────────────────────────────────────────────
// Business Domains  (§7, §8, §9)
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardType =
  | 'EXECUTIVE' | 'OPERATIONS' | 'TRADING' | 'AI' | 'INFRASTRUCTURE'
  | 'CUSTOMER' | 'REVENUE' | 'COMPLIANCE' | 'RISK' | 'CUSTOM'

export type BusinessDomain =
  | 'REVENUE' | 'COST' | 'PROFITABILITY' | 'CUSTOMER_RETENTION'
  | 'CUSTOMER_CHURN' | 'SUBSCRIPTION' | 'GROWTH' | 'MARKET'
  | 'TRADING_PERFORMANCE' | 'PREDICTION_ACCURACY' | 'OPERATIONAL_EFFICIENCY'
  | 'CAPACITY_PLANNING'

export type KPICategory =
  | 'FINANCIAL' | 'TRADING' | 'INFRASTRUCTURE' | 'CUSTOMER'
  | 'AI_PERFORMANCE' | 'PLATFORM' | 'OPERATIONAL' | 'GOVERNANCE'
  | 'SECURITY' | 'EXECUTIVE'

export type ForecastType =
  | 'HISTORICAL_TRENDS' | 'REVENUE_FORECAST' | 'GROWTH_FORECAST'
  | 'CAPACITY_FORECAST' | 'CUSTOMER_FORECAST' | 'OPERATIONAL_FORECAST'
  | 'AI_ADOPTION_TRENDS' | 'PLATFORM_UTILIZATION_TRENDS' | 'SCENARIO_ANALYSIS'

// ─────────────────────────────────────────────────────────────────────────────
// Publication Status  (§4, §6, Rule 5/16)
// ─────────────────────────────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT' | 'VALIDATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PUBLISHED' | 'REJECTED' | 'QUARANTINED' | 'RECALLED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'

// ─────────────────────────────────────────────────────────────────────────────
// KPI  (§9, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface KPI {
  kpiId: string
  name: string
  category: KPICategory
  /** Rule 9 — KPI references immutable governed datasets. */
  sourceDatasetVersions: string[]
  value: number
  unit: string
  target: number | null
  previousValue: number | null
  changePct: number | null
  /** Methodology version used to compute this KPI. */
  methodologyVersion: string
  computedAt: number
  /** Rule 9A/17A — tenant isolation. */
  tenantId: string | null // null = platform-wide (anonymized aggregation only)
  isCrossTenantAggregation: boolean
}

export interface KPICollection {
  kpis: KPI[]
  count: number
  computedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend Analysis  (§10)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  timestamp: number
  value: number
  label?: string
}

export interface TrendAnalysis {
  metricName: string
  points: TrendPoint[]
  trendDirection: 'INCREASING' | 'DECREASING' | 'STABLE' | 'VOLATILE'
  slope: number
  volatility: number
  rSquared: number
  methodologyVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Forecast  (§10, Rule 12, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface ForecastPoint {
  timestamp: number
  predictedValue: number
  lowerBound: number
  upperBound: number
  confidence: number
}

export interface ForecastMetadata {
  forecastType: ForecastType
  forecastPoints: ForecastPoint[]
  /** Rule 12 — Independent from operational AI prediction engines. */
  independentFromOperationalAI: boolean
  /** Rule 19 — Forecasting methodology version controlled. */
  methodologyVersion: string
  /** Rule 19 — Forecasts never overwrite historical analytical results. */
  historicalResultsOverwritten: false
  /** Rule 19 — Historical anchor range used to produce forecast. */
  historicalAnchorStart: number
  historicalAnchorEnd: number
  accuracy: number | null
  generatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Executive Alert  (§13, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY'
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED'

export interface ExecutiveAlert {
  alertId: string
  severity: AlertSeverity
  businessDomain: BusinessDomain
  message: string
  threshold: number
  observedValue: number
  /** Rule 13 — Alert generates immutable governance event. */
  governanceEventGenerated: boolean
  /** Rule 13 — Alerts never modify published reports. */
  reportModified: false
  triggeredAt: number
  status: AlertStatus
  tenantId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytical Model  (§4, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticalModel {
  modelId: string
  modelVersion: string
  /** Rule 12 — Independent from operational AI prediction engines. */
  isIndependentFromOperationalAI: boolean
  methodologyType: 'STATISTICAL' | 'TIME_SERIES' | 'REGRESSION' | 'SCENARIO' | 'DESCRIPTIVE'
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Freshness  (§4)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataFreshnessMetadata {
  sourceDatasetIds: string[]
  sourceDatasetVersions: string[]
  earliestEventTimestamp: number
  latestEventTimestamp: number
  lagMs: number
  completenessPct: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineage  (§4, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsLineage {
  /** Rule 6 — Complete lineage linking governed datasets, model governance
   *  events, configuration versions, operational metrics, business metadata,
   *  and governance metadata. */
  governedDatasetIds: string[]
  governedDatasetVersions: string[]
  modelGovernanceEventIds: string[]
  configurationVersionIds: string[]
  operationalMetricStreams: string[]
  businessMetadataVersion: string
  governanceMetadataVersion: string
  /** Upstream engine sources. */
  upstreamEngines: string[]
  /** Rule 17 — Engine accessed only governed outputs, not raw operational DBs. */
  accessedRawOperationalDB: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Version Bundle  (§11, Rule 5/10/11/14)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportVersionBundle {
  reportVersion: string
  metricDefinitionVersion: string
  datasetVersion: string
  configurationVersion: string
  governanceVersion: string
  dashboardVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Governance Metadata  (§12)
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsGovernanceMetadata {
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
  /** Rule 17A — Multi-tenant isolation enforced. */
  tenantIsolationEnforced: boolean
  /** Rule 17A — Cross-tenant aggregation approved via privacy-preserving methods. */
  crossTenantAggregationApproved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Executive Intelligence Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalExecutiveIntelligenceContract {
  /** Rule 3 — Unique analytics event ID. */
  analyticsEventId: string
  /** §4 — Report identifier. */
  reportIdentifier: string
  /** §4 — Report version. */
  reportVersion: string
  /** §4 — Dashboard identifier. */
  dashboardIdentifier: string
  /** §4 — Business domain. */
  businessDomain: BusinessDomain
  /** §4 — Reporting period. */
  reportingPeriod: { start: number; end: number }
  /** §4 — Data freshness metadata. */
  dataFreshness: DataFreshnessMetadata
  /** §4 — KPI collection. */
  kpiCollection: KPICollection
  /** §4 — Analytical results. */
  analyticalResults: Record<string, unknown>
  /** §4 — Analytical model identifier. */
  analyticalModelId: string
  /** §4 — Analytical model version. */
  analyticalModelVersion: string
  /** §4 — Forecast metadata. */
  forecastMetadata: ForecastMetadata | null
  /** §4 — Trend analysis. */
  trendAnalysis: TrendAnalysis[]
  /** §4 — Executive alerts. */
  executiveAlerts: ExecutiveAlert[]
  /** §4 — Lineage metadata. */
  lineage: AnalyticsLineage
  /** §4 — Governance metadata. */
  governanceMetadata: AnalyticsGovernanceMetadata
  /** §4 — Report publication status. */
  publicationStatus: PublicationStatus
  /** §5 — Pipeline type. */
  pipelineType: PipelineType
  /** §5 — Pipeline stages executed. */
  pipelineStages: Array<{
    stage: string
    startedAt: number
    completedAt: number
    durationMs: number
    success: boolean
  }>
  /** Rule 5 — Immutable creation timestamp. */
  createdAt: number
  /** Rule 5 — Immutable hash for replay verification. */
  contentHash: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportConfiguration {
  reportIdentifier: string
  dashboardType: DashboardType
  businessDomain: BusinessDomain
  pipelineType: PipelineType
  /** KPIs to compute for this report. */
  kpiDefinitions: KPIDefinition[]
  /** Forecast types to generate. */
  forecastTypes: ForecastType[]
  /** Thresholds for executive alerts. */
  alertThresholds: AlertThreshold[]
  /** Rule 17A — Multi-tenant isolation enforcement. */
  enforceTenantIsolation: boolean
  /** Rule 17A — Whether cross-tenant aggregation is permitted for this report. */
  crossTenantAggregationPermitted: boolean
  /** Rule 10 — Allow deterministic replay of historical reports. */
  allowHistoricalReplay: boolean
  /** Rule 11 — Independent configuration of report versioning. */
  independentVersioning: boolean
  /** Rule 16 — Fail-closed: publication failures never partially published. */
  failClosed: boolean
  /** Reporting period. */
  reportingPeriod: { start: number; end: number }
  /** Tenant scope. */
  tenantId: string | null // null = platform-wide (only if crossTenantAggregationPermitted)
}

export interface KPIDefinition {
  kpiId: string
  name: string
  category: KPICategory
  methodologyVersion: string
  target: number | null
  unit: string
}

export interface AlertThreshold {
  kpiName: string
  severity: AlertSeverity
  operator: '>' | '<' | '>=' | '<=' | '=='
  threshold: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Input Contract  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsInput {
  /** §3 — Canonical feature metadata. */
  featureMetadata: Array<{ featureId: string; version: string }>
  /** §3 — Canonical alternative data metadata. */
  alternativeDataMetadata: Array<{ sourceId: string; version: string }>
  /** §3 — Simulation results. */
  simulationResults: Array<{ simulationId: string; version: string }>
  /** §3 — Paper trading results. */
  paperTradingResults: Array<{ sessionId: string; version: string }>
  /** §3 — Production prediction metadata. */
  productionPredictionMetadata: Array<{ modelId: string; version: string }>
  /** §3 — Configuration metadata. */
  configurationMetadata: Array<{ configId: string; version: string }>
  /** §3 — Model governance metadata. */
  modelGovernanceMetadata: Array<{ governanceEventId: string; version: string }>
  /** §3 — Access governance metadata. */
  accessGovernanceMetadata: Array<{ accessEventId: string; version: string }>
  /** §3 — Infrastructure metrics. */
  infrastructureMetrics: Array<{ metricId: string; timestamp: number; value: number }>
  /** §3 — Platform telemetry. */
  platformTelemetry: Array<{ metricId: string; timestamp: number; value: number }>
  /** §3 — Customer activity metadata. */
  customerActivityMetadata: Array<{ customerId: string; tenantId: string; activityType: string; timestamp: number; value: number }>
  /** §3 — Subscription metadata. */
  subscriptionMetadata: Array<{ customerId: string; tenantId: string; plan: string; status: string; mrr: number; timestamp: number }>
  /** §3 — Revenue metadata. */
  revenueMetadata: Array<{ tenantId: string; source: string; amount: number; timestamp: number }>
  /** §3 — Cost metadata. */
  costMetadata: Array<{ tenantId: string; category: string; amount: number; timestamp: number }>
  /** §3 — Operational events. */
  operationalEvents: Array<{ eventId: string; type: string; timestamp: number; severity: string }>
  /** §3 — Audit events. */
  auditEvents: Array<{ auditId: string; actor: string; action: string; timestamp: number }>
  /** §3 — Governance events. */
  governanceEvents: Array<{ governanceId: string; type: string; timestamp: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface EIBAEConfiguration {
  /** Rule 17A — Strict tenant isolation required. */
  strictTenantIsolation: boolean
  /** Rule 17A — Cross-tenant aggregation requires governance approval. */
  requireCrossTenantAggregationApproval: boolean
  /** Rule 10 — Deterministic replay support. */
  enableHistoricalReplay: boolean
  /** Rule 16 — Fail-closed publication. */
  failClosed: boolean
  /** §10 — Forecast methodology versions (independently version controlled). */
  forecastMethodologyVersions: Partial<Record<ForecastType, string>>
  /** §9 — KPI methodology versions. */
  kpiMethodologyVersions: Partial<Record<KPICategory, string>>
  /** §13 — Operational streaming alert thresholds. */
  operationalAlertThresholds: AlertThreshold[]
  /** §14 — Observability configuration. */
  observabilityEnabled: boolean
  /** Versions for default reports. */
  versions: ReportVersionBundle
}

export const DEFAULT_EIBAE_CONFIG: Omit<EIBAEConfiguration, 'versions'> = {
  strictTenantIsolation: true,
  requireCrossTenantAggregationApproval: true,
  enableHistoricalReplay: true,
  failClosed: true,
  forecastMethodologyVersions: {
    REVENUE_FORECAST: '1.0.0',
    GROWTH_FORECAST: '1.0.0',
    CAPACITY_FORECAST: '1.0.0',
    CUSTOMER_FORECAST: '1.0.0',
    OPERATIONAL_FORECAST: '1.0.0',
    SCENARIO_ANALYSIS: '1.0.0',
  },
  kpiMethodologyVersions: {
    FINANCIAL: '1.0.0',
    TRADING: '1.0.0',
    INFRASTRUCTURE: '1.0.0',
    CUSTOMER: '1.0.0',
    AI_PERFORMANCE: '1.0.0',
    PLATFORM: '1.0.0',
    OPERATIONAL: '1.0.0',
    GOVERNANCE: '1.0.0',
    SECURITY: '1.0.0',
    EXECUTIVE: '1.0.0',
  },
  operationalAlertThresholds: [],
  observabilityEnabled: true,
}

// Pipeline Stages (§5A, §5B)
export const STRATEGIC_BATCH_STAGES = [
  'GOVERNED_DATA_COLLECTION',
  'DATA_VALIDATION',
  'BUSINESS_AGGREGATION',
  'KPI_CALCULATION',
  'TREND_ANALYSIS',
  'FORECAST_GENERATION',
  'EXECUTIVE_INSIGHT_GENERATION',
  'REPORT_GENERATION',
  'GOVERNANCE_VALIDATION',
  'PUBLICATION_APPROVAL',
  'DASHBOARD_PUBLICATION',
  'METADATA_RECORDING',
  'ANALYTICS_COMPLETION',
] as const

export const OPERATIONAL_STREAMING_STAGES = [
  'GOVERNED_EVENT_RECEPTION',
  'REAL_TIME_KPI_CALCULATION',
  'STREAMING_AGGREGATION',
  'OPERATIONAL_THRESHOLD_EVALUATION',
  'LIVE_DASHBOARD_PUBLICATION',
  'STREAMING_METADATA_RECORDING',
  'OBSERVABILITY_COMPLETION',
] as const

export const EIBAE_VERSION = '1.0.0'
export const EXECUTIVE_INTELLIGENCE_SCHEMA_VERSION = '1.0.0'
