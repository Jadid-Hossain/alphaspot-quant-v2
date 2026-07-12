// CHAPTER 5.13 — PnL & Performance Attribution Engine Types
//
// The PPAE is the exclusive bridge between Portfolio Accounting (Ch 5.12) and
// downstream Compliance/Reporting/Risk/Client/Regulatory systems.
// Transforms immutable Portfolio Accounting records into PnL, returns,
// attribution, and risk-adjusted performance metrics (§1).
//
// 30 architectural rules enforced (see §18).
// 16-stage pipeline (§5 — no skips).

import type { CanonicalPortfolioAccountingContract } from '../portfolio-accounting/types'

// ─────────────────────────────────────────────────────────────────────────────
// PnL Types  (Chapter 5.13 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type PnLType =
  | 'REALIZED_PNL' | 'UNREALIZED_PNL' | 'MARK_TO_MARKET_PNL'
  | 'FX_PNL' | 'DIVIDEND_PNL' | 'INTEREST_PNL'
  | 'BORROW_COST' | 'FUNDING_COST' | 'CARRY_PNL'
  | 'TRANSACTION_COST_PNL' | 'SLIPPAGE_PNL'

export interface PnLBreakdown {
  realizedPnL: number
  unrealizedPnL: number
  totalPnL: number
  fxPnL: number
  fundingPnL: number
  borrowCost: number
  dividendIncome: number
  interestIncome: number
  transactionCost: number
  slippageCost: number
  carryPnL: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Return Types  (Chapter 5.13 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type ReturnMethod =
  | 'ABSOLUTE_RETURN' | 'SIMPLE_RETURN' | 'LOG_RETURN'
  | 'TWR' | 'MWR' | 'MODIFIED_DIETZ' | 'GEOMETRIC'
  | 'ANNUALIZED' | 'CUMULATIVE'

export interface ReturnMetrics {
  absoluteReturn: number
  simpleReturn: number
  logReturn: number
  twr: number
  mwr: number
  modifiedDietz: number
  geometricReturn: number
  annualizedReturn: number
  cumulativeReturn: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Attribution Types  (Chapter 5.13 §9, §9A)
// ─────────────────────────────────────────────────────────────────────────────

export interface AttributionBreakdown {
  strategyAttribution: Record<string, number>
  assetAttribution: Record<string, number>
  sectorAttribution: Record<string, number>
  countryAttribution: Record<string, number>
  currencyAttribution: Record<string, number>
  factorAttribution: Record<string, number>
  allocationEffect: number
  selectionEffect: number
  interactionEffect: number
  /** §9A — Derivative & Financing Attribution (Rule 23 — independent). */
  derivativeAttribution: DerivativeAttribution
}

export interface DerivativeAttribution {
  deltaAttribution: number
  gammaAttribution: number
  vegaAttribution: number
  thetaAttribution: number
  rhoAttribution: number
  crossGammaAttribution: number
  volatilityAttribution: number
  carryAttribution: number
  fundingAttribution: number
  borrowAttribution: number
  financingCostAttribution: number
  crossAssetAttribution: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk-Adjusted Metrics  (Chapter 5.13 §11, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskAdjustedMetrics {
  sharpeRatio: number
  sortinoRatio: number
  informationRatio: number
  treynorRatio: number
  jensensAlpha: number
  beta: number
  calmarRatio: number
  omegaRatio: number
  maxDrawdown: number
  volatility: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Valuation State  (Chapter 5.13 §10A, Rule 21/22)
// ─────────────────────────────────────────────────────────────────────────────

export type ValuationState =
  | 'STREAMING_INTRADAY' | 'OFFICIAL_EOD' | 'OFFICIAL_CLOSING_AUCTION'
  | 'INDICATIVE' | 'NAV' | 'PROVISIONAL' | 'FINAL'
  | 'FROZEN' | 'APPROVED' | 'RESTATEMENT'

export interface PricingSnapshot {
  snapshotId: string
  symbol: string
  price: number
  timestamp: number
  source: string
  sourceVersion: string
  valuationState: ValuationState
  /** Rule 25 — Pricing Snapshot Versions immutable + reproducible. */
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark  (Chapter 5.13 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface BenchmarkData {
  benchmarkId: string
  name: string
  returnRate: number
  trackingDifference: number
  trackingError: number
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Restatement  (Chapter 5.13 §17A, Rule 24)
// ─────────────────────────────────────────────────────────────────────────────

export type RestatementType =
  | 'MARKET_DATA_RESTATEMENT' | 'BENCHMARK_RESTATEMENT'
  | 'CORPORATE_ACTION_RESTATEMENT' | 'FX_RATE_RESTATEMENT'
  | 'PRICING_VENDOR_CORRECTION' | 'HISTORICAL_NAV_RESTATEMENT'

export interface PerformanceRestatement {
  restatementId: string
  type: RestatementType
  originalPerformanceEventId: string
  reason: string
  restatedAt: number
  newVersion: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Lineage  (Chapter 5.13 Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface PerformanceLineage {
  accountingEventId: string
  accountingVersion: string
  reconciliationId: string
  executionEventId: string
  portfolioId: string
  pricingSnapshotVersion: string
  pricingSourceVersion: string
  benchmarkVersion: string
  fxSnapshotVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Version Bundle + Governance  (Chapter 5.13 §12, §13)
// ─────────────────────────────────────────────────────────────────────────────

export interface PerformanceVersionBundle {
  performanceVersion: string
  accountingVersion: string
  benchmarkVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface PerformanceGovernanceMetadata {
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
// Canonical Performance Contract  (Chapter 5.13 §4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPerformanceContract {
  performanceEventId: string // Rule 3
  performanceVersion: string
  portfolioId: string
  positionId: string
  calculationTimestamp: number

  // §6 — Canonical Performance Contract fields
  pnlBreakdown: PnLBreakdown
  returnMetrics: ReturnMetrics
  attribution: AttributionBreakdown
  riskAdjustedMetrics: RiskAdjustedMetrics
  benchmark: BenchmarkData
  activeReturn: number
  valuationState: ValuationState
  pricingSnapshotVersion: string
  pricingSourceVersion: string
  performanceRestatementId: string | null
  intradayPerformanceState: boolean
  officialPerformanceState: boolean

  // Metadata + Governance
  performanceMetadata: {
    performanceEventId: string
    performanceVersion: string
    versions: PerformanceVersionBundle
    lineage: PerformanceLineage
    valuationState: ValuationState
    restatement: PerformanceRestatement | null
  }
  governanceMetadata: PerformanceGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (Chapter 5.13 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface PerformanceConfiguration {
  defaultReturnMethod: ReturnMethod
  riskFreeRate: number
  attributionEnabled: boolean
  derivativeAttributionEnabled: boolean
  restatementEnabled: boolean
  versions: PerformanceVersionBundle
}

export const DEFAULT_PERFORMANCE_CONFIG: Omit<PerformanceConfiguration, 'versions'> = {
  defaultReturnMethod: 'TWR',
  riskFreeRate: 0.04,
  attributionEnabled: true,
  derivativeAttributionEnabled: true,
  restatementEnabled: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages  (Chapter 5.13 §5 — 16 stages)
// ─────────────────────────────────────────────────────────────────────────────

export const PERFORMANCE_STAGES = [
  'ACCOUNTING_RECEPTION', 'VALIDATION', 'MARKET_VALUATION_LOADING',
  'PRICING_SOURCE_VALIDATION', 'VALUATION_STATE_SELECTION', 'FX_TRANSLATION',
  'BENCHMARK_LOADING', 'PNL_CALCULATION', 'RETURN_CALCULATION',
  'DERIVATIVE_ATTRIBUTION', 'PERFORMANCE_ATTRIBUTION',
  'RISK_ADJUSTED_METRIC_CALCULATION', 'PERFORMANCE_VALIDATION',
  'PERFORMANCE_PUBLICATION', 'METADATA_RECORDING', 'PERFORMANCE_COMPLETION',
] as const

export type PerformanceStage = (typeof PERFORMANCE_STAGES)[number]

export const PPAE_VERSION = '1.0.0'
export const PERFORMANCE_SCHEMA_VERSION = '1.0.0'

export type { CanonicalPortfolioAccountingContract } from '../portfolio-accounting/types'
