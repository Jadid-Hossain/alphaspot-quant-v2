// CHAPTER 5.14 — Risk Analytics & Exposure Engine Types
//
// The RAEE is the exclusive bridge between PnL & Performance Attribution
// (Ch 5.13) and downstream Compliance/Portfolio Optimization/Strategy
// Governance/Executive/Capital/Regulatory systems. Transforms immutable
// Portfolio Accounting + Performance records into risk measurements (§1).
//
// 30 architectural rules enforced (see §17).
// 15-stage pipeline (§5 — no skips).

import type { CanonicalPortfolioAccountingContract } from '../portfolio-accounting/types'
import type { CanonicalPerformanceContract } from '../pnl-performance/types'

// ─────────────────────────────────────────────────────────────────────────────
// VaR Methods  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type VaRMethod =
  | 'HISTORICAL_VAR' | 'PARAMETRIC_VAR' | 'MONTE_CARLO_VAR'
  | 'INCREMENTAL_VAR' | 'MARGINAL_VAR' | 'COMPONENT_VAR'

export type ESMethod = 'HISTORICAL_ES' | 'PARAMETRIC_ES' | 'MONTE_CARLO_ES'

// ─────────────────────────────────────────────────────────────────────────────
// Stress Test Types  (§8)
// ─────────────────────────────────────────────────────────────────────────────

export type StressTestType =
  | 'HISTORICAL_CRISIS_REPLAY' | 'HYPOTHETICAL_SCENARIO' | 'INTEREST_RATE_SHOCK'
  | 'FX_SHOCK' | 'EQUITY_CRASH' | 'COMMODITY_SHOCK' | 'VOLATILITY_SPIKE'
  | 'LIQUIDITY_CRISIS' | 'COUNTERPARTY_DEFAULT'

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Types  (§9)
// ─────────────────────────────────────────────────────────────────────────────

export type ScenarioType =
  | 'MACRO_SCENARIO' | 'SECTOR_ROTATION' | 'INFLATION_SHOCK' | 'RECESSION'
  | 'YIELD_CURVE_SHIFT' | 'CREDIT_SPREAD_WIDENING' | 'CORRELATION_BREAKDOWN'

// ─────────────────────────────────────────────────────────────────────────────
// Market Regime  (§10A, Rule 21/22/28/29)
// ─────────────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | 'NORMAL' | 'ELEVATED_VOLATILITY' | 'HIGH_VOLATILITY' | 'CRISIS'
  | 'CORRELATION_BREAKDOWN' | 'LIQUIDITY_STRESS' | 'TAIL_EVENT'

export interface RegimeTransitionEvent {
  regimeEventId: string
  previousRegime: MarketRegime
  currentRegime: MarketRegime
  transitionTimestamp: number
  correlationModelVersion: string
  covarianceVersion: string
  governanceMetadata: { approved: boolean; actor: string; note: string }
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk State Types  (§15A, Rule 23/24)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskStateType = 'STREAMING_INTRADAY' | 'OFFICIAL_EOD'

// ─────────────────────────────────────────────────────────────────────────────
// Exposure Metrics  (§6)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExposureMetrics {
  positionExposure: number
  grossExposure: number
  netExposure: number
  longExposure: number
  shortExposure: number
  perAsset: Record<string, number>
  perSector: Record<string, number>
  perCountry: Record<string, number>
  perCurrency: Record<string, number>
  perStrategy: Record<string, number>
  perFactor: Record<string, number>
  leverage: number
  marginUtilization: number
  beta: number
}

// ─────────────────────────────────────────────────────────────────────────────
// VaR + ES Results  (§7, Rule 9 — independent)
// ─────────────────────────────────────────────────────────────────────────────

export interface VaRResult {
  method: VaRMethod
  value: number
  confidenceLevel: number
  timeHorizonDays: number
  modelVersion: string
}

export interface ExpectedShortfallResult {
  method: ESMethod
  value: number
  confidenceLevel: number
  timeHorizonDays: number
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Stress Test + Scenario Results  (§8/§9, Rule 8 — independent)
// ─────────────────────────────────────────────────────────────────────────────

export interface StressTestResult {
  type: StressTestType
  scenario: string
  projectedLoss: number
  projectedPortfolioValue: number
  passed: boolean
  modelVersion: string
}

export interface ScenarioResult {
  type: ScenarioType
  scenario: string
  projectedReturn: number
  projectedPortfolioValue: number
  probability: number
  modelVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Risk  (§11, Rule 10 — independent from market risk)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityRiskResult {
  advUtilization: number
  timeToLiquidateHours: number
  marketImpactEstimate: number
  liquidityGap: number
  fundingLiquidity: number
  assetLiquidity: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Concentration Risk  (§12, Rule 11 — independent from counterparty)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConcentrationRiskResult {
  singleAsset: Record<string, number>
  sector: Record<string, number>
  country: Record<string, number>
  currency: Record<string, number>
  counterparty: Record<string, number>
  strategy: Record<string, number>
  issuer: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical Aggregation  (§11A, Rule 25/26/27)
// ─────────────────────────────────────────────────────────────────────────────

export interface HierarchicalAggregation {
  positionLevel: Record<string, number>
  strategyLevel: Record<string, number>
  portfolioLevel: number
  fundLevel: number
  primeBrokerExposure: Record<string, number>
  enterpriseGrossExposure: number
  enterpriseNetExposure: number
  nettingMethodology: string
  aggregationVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Lineage  (Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskLineage {
  accountingEventId: string
  performanceEventId: string
  portfolioId: string
  marketSnapshotVersion: string
  correlationModelVersion: string
  covarianceVersion: string
  regimeVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface RiskVersionBundle {
  riskVersion: string
  accountingVersion: string
  performanceVersion: string
  marketSnapshotVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface RiskGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  calculationTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Risk Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalRiskContract {
  riskEventId: string // Rule 3
  riskVersion: string
  portfolioId: string
  positionId: string
  calculationTimestamp: number

  // §6 — Canonical Risk Contract fields
  exposure: ExposureMetrics
  varResults: VaRResult[]
  expectedShortfall: ExpectedShortfallResult[]
  stressTestResults: StressTestResult[]
  scenarioResults: ScenarioResult[]
  liquidityRisk: LiquidityRiskResult
  concentrationRisk: ConcentrationRiskResult
  hierarchicalAggregation: HierarchicalAggregation
  volatility: number

  // §15A — Dual-speed risk state
  riskStateType: RiskStateType
  marketSnapshotVersion: string
  calculationFrequency: string
  publicationStatus: 'PENDING' | 'PUBLISHED' | 'RESTATED'

  // §10A — Regime
  currentRegime: MarketRegime
  regimeTransition: RegimeTransitionEvent | null

  // Metadata + Governance
  riskMetadata: {
    riskEventId: string
    riskVersion: string
    versions: RiskVersionBundle
    lineage: RiskLineage
    riskStateType: RiskStateType
    regimeVersion: string
  }
  governanceMetadata: RiskGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 4 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskConfiguration {
  defaultVaRMethod: VaRMethod
  defaultESMethod: ESMethod
  varConfidenceLevel: number
  varTimeHorizonDays: number
  regimeDetectionEnabled: boolean
  hierarchicalAggregationEnabled: boolean
  dualSpeedEnabled: boolean
  versions: RiskVersionBundle
}

export const DEFAULT_RISK_CONFIG: Omit<RiskConfiguration, 'versions'> = {
  defaultVaRMethod: 'PARAMETRIC_VAR',
  defaultESMethod: 'PARAMETRIC_ES',
  varConfidenceLevel: 0.99,
  varTimeHorizonDays: 1,
  regimeDetectionEnabled: true,
  hierarchicalAggregationEnabled: true,
  dualSpeedEnabled: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages  (§5 — 15 stages)
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_PIPELINE_STAGES = [
  'PORTFOLIO_RECEPTION', 'VALIDATION', 'MARKET_DATA_LOADING',
  'CORRELATION_LOADING', 'VOLATILITY_LOADING', 'EXPOSURE_CALCULATION',
  'FACTOR_CALCULATION', 'SCENARIO_ANALYSIS', 'STRESS_TESTING',
  'LIQUIDITY_ANALYSIS', 'RISK_AGGREGATION', 'RISK_VALIDATION',
  'RISK_PUBLICATION', 'METADATA_RECORDING', 'RISK_COMPLETION',
] as const

export type RiskPipelineStage = (typeof RISK_PIPELINE_STAGES)[number]

export const RAEE_VERSION = '1.0.0'
export const RISK_SCHEMA_VERSION = '1.0.0'

export type { CanonicalPortfolioAccountingContract } from '../portfolio-accounting/types'
export type { CanonicalPerformanceContract } from '../pnl-performance/types'
