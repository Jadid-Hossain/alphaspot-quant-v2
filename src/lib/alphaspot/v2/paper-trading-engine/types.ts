// CHAPTER 5.19 — Paper Trading & Shadow Execution Engine Types
//
// The PTSEE is the exclusive bridge between Market Simulation (Ch 5.18) and
// future Live Execution. Validates AI models under live market conditions
// without exposing capital to financial risk (§1).
//
// 20 architectural rules + 1 sub-rule enforced (see §17, including Rule 18A).
// 17-stage pipeline (§5 — no skips).

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Execution Modes  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type VirtualExecutionMode = 'PAPER_TRADING_SIMULATION' | 'SHADOW_EXECUTION'

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Order Types  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type VirtualOrderType = 'MARKET' | 'LIMIT' | 'STOP'
export type VirtualOrderStatus = 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED'

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Order + Execution  (§6, §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface VirtualOrder {
  orderId: string
  timestamp: number
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: VirtualOrderType
  requestedQuantity: number
  requestedPrice: number | null
  status: VirtualOrderStatus
  filledQuantity: number
  executedPrice: number
  fees: number
  slippage: number
  marketImpact: number
  /** Rule 8 — Virtual orders never generate real exchange orders. */
  isVirtual: true
}

export interface VirtualExecution {
  executionId: string
  orderId: string
  timestamp: number
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  fees: number
  slippage: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Portfolio  (§8)
// ─────────────────────────────────────────────────────────────────────────────

export interface VirtualPosition {
  symbol: string
  quantity: number
  avgEntryPrice: number
  marketValue: number
  unrealizedPnl: number
  weight: number
}

export interface VirtualPortfolio {
  cash: number
  positions: Map<string, VirtualPosition>
  totalNav: number
  grossExposure: number
  netExposure: number
  leverage: number
  /** Rule 9 — Logically isolated from production portfolios. */
  isIsolated: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance + Risk + Latency + Execution Quality Metrics  (§10, §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperPerformanceMetrics {
  totalReturn: number
  winRate: number
  profitFactor: number
  sharpeRatio: number
  maxDrawdown: number
  totalTrades: number
  avgLatencyMs: number
  avgSlippage: number
}

export interface PaperRiskMetrics {
  volatility: number
  var95: number
  maxExposure: number
  avgLeverage: number
}

export interface LatencyMetrics {
  avgInferenceLatencyMs: number
  avgOrderGenerationLatencyMs: number
  avgExecutionLatencyMs: number
  p95LatencyMs: number
}

export interface ExecutionQualityMetrics {
  avgSlippage: number
  avgMarketImpact: number
  fillRate: number
  partialFillRate: number
  rejectionRate: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployment Readiness  (§9, Rule 13/19)
// ─────────────────────────────────────────────────────────────────────────────

export interface DeploymentReadinessAssessment {
  readinessScore: number // 0..1
  predictionStability: number
  strategyStability: number
  executionStability: number
  riskStability: number
  latencyStability: number
  operationalStability: number
  infrastructureValidated: boolean
  modelConsistency: number
  configurationValidated: boolean
  /** Rule 19 — Not promoted to Live unless criteria satisfied. */
  deploymentApproved: boolean
  issues: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation Drift  (Rule 14/18)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationDriftMetrics {
  executionDrift: number
  modelDrift: number
  latencyDrift: number
  strategyDrift: number
  signalDrift: number
  /** Rule 14 — Drift generates immutable governance events. */
  driftEventsGenerated: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow Execution  (§7B, Rule 7/18A)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowComparison {
  championModelId: string
  challengerModelId: string
  predictionDivergence: number
  signalDivergence: number
  executionDivergence: number
  riskDivergence: number
  performanceComparison: { champion: number; challenger: number }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineage + Version + Governance  (§6, §11, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperTradingLineage {
  strategyIdentifier: string
  portfolioIdentifier: string
  modelIdentifier: string
  modelVersion: string
  featureVersion: string
  datasetVersion: string
  alternativeDatasetVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface PaperTradingVersionBundle {
  paperTradingVersion: string
  modelVersion: string
  strategyVersion: string
  featureVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface PaperTradingGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  completionTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Paper Trading Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPaperTradingContract {
  paperTradingEventId: string // Rule 3
  paperTradingVersion: string
  paperTradingSessionId: string
  strategyIdentifier: string
  portfolioIdentifier: string
  modelIdentifier: string
  modelVersion: string
  sessionTimestamp: number

  // §6 — Canonical Paper Trading Contract fields
  virtualOrders: VirtualOrder[]
  virtualExecutions: VirtualExecution[]
  virtualPositions: VirtualPosition[]
  virtualPortfolio: VirtualPortfolio
  performanceMetrics: PaperPerformanceMetrics
  riskMetrics: PaperRiskMetrics
  latencyMetrics: LatencyMetrics
  executionQualityMetrics: ExecutionQualityMetrics
  deploymentReadiness: DeploymentReadinessAssessment
  simulationDrift: SimulationDriftMetrics
  shadowComparisons: ShadowComparison[]

  // Metadata + Governance
  paperTradingMetadata: {
    paperTradingEventId: string
    paperTradingVersion: string
    versions: PaperTradingVersionBundle
    lineage: PaperTradingLineage
    executionMode: VirtualExecutionMode
  }
  governanceMetadata: PaperTradingGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperTradingConfiguration {
  executionMode: VirtualExecutionMode
  initialVirtualCapital: number
  /** Rule 10 — Execution assumptions configurable + version controlled. */
  executionAssumptions: {
    slippageModel: string
    spreadModel: string
    latencySimulationMs: number
    exchangeFeeRate: number
    partialFillEnabled: boolean
    version: string
  }
  /** Rule 13 — Deployment readiness criteria. */
  deploymentReadinessCriteria: {
    minReadinessScore: number
    minPredictionStability: number
    minStrategyStability: number
    minLatencyStability: number
  }
  /** Rule 7 — Shadow execution champion vs challenger. */
  shadowChallengerModelIds: string[]
  /** Rule 18 — Drift monitoring enabled. */
  driftMonitoringEnabled: boolean
  versions: PaperTradingVersionBundle
}

export const DEFAULT_PAPER_TRADING_CONFIG: Omit<PaperTradingConfiguration, 'versions'> = {
  executionMode: 'PAPER_TRADING_SIMULATION',
  initialVirtualCapital: 100000,
  executionAssumptions: {
    slippageModel: 'linear', spreadModel: 'half_spread', latencySimulationMs: 50,
    exchangeFeeRate: 0.001, partialFillEnabled: true, version: '1.0.0',
  },
  deploymentReadinessCriteria: {
    minReadinessScore: 0.8, minPredictionStability: 0.85,
    minStrategyStability: 0.85, minLatencyStability: 0.9,
  },
  shadowChallengerModelIds: [],
  driftMonitoringEnabled: true,
}

// Pipeline Stages (§5 — 17 stages)
export const PAPER_TRADING_STAGES = [
  'PAPER_TRADING_CONFIGURATION', 'LIVE_MARKET_DATA_RECEPTION', 'FEATURE_STORE_SUBSCRIPTION',
  'ALTERNATIVE_DATA_SUBSCRIPTION', 'AI_MODEL_LOADING', 'POINT_IN_TIME_AI_INFERENCE',
  'STRATEGY_EVALUATION', 'RISK_EVALUATION', 'VIRTUAL_ORDER_GENERATION',
  'VIRTUAL_EXECUTION_MODE_SELECTION', 'VIRTUAL_PORTFOLIO_UPDATE',
  'PERFORMANCE_EVALUATION', 'DEPLOYMENT_READINESS_ASSESSMENT',
  'PAPER_TRADING_VALIDATION', 'SESSION_PUBLICATION', 'METADATA_RECORDING',
  'PAPER_TRADING_COMPLETION',
] as const

export const PTSEE_VERSION = '1.0.0'
export const PAPER_TRADING_SCHEMA_VERSION = '1.0.0'
