// CHAPTER 5.18 — Market Simulation & Backtesting Engine Types
//
// The MSBE is the exclusive bridge between Alternative Data, Feature Store,
// AI Prediction Layer, and Paper Trading / Shadow Execution (§1).
// Evaluates strategies via deterministic, event-driven, historically reproducible simulation.
//
// 20 architectural rules enforced (see §17, including Rule 9A + 15A).
// 17-stage pipeline (§5 — no skips).

// ─────────────────────────────────────────────────────────────────────────────
// Simulation Methodologies  (§9)
// ─────────────────────────────────────────────────────────────────────────────

export type SimulationMethod =
  | 'HISTORICAL_REPLAY' | 'WALK_FORWARD' | 'ROLLING_WINDOW' | 'EXPANDING_WINDOW'
  | 'MONTE_CARLO' | 'BOOTSTRAP_RESAMPLING' | 'REGIME_SWITCHING' | 'SCENARIO_ANALYSIS'

// ─────────────────────────────────────────────────────────────────────────────
// Market Replay Types  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type ReplayType =
  | 'TICK_REPLAY' | 'CANDLE_REPLAY' | 'TRADE_REPLAY' | 'ORDER_BOOK_REPLAY'
  | 'FUNDING_REPLAY' | 'LIQUIDATION_REPLAY' | 'ON_CHAIN_REPLAY'
  | 'NEWS_REPLAY' | 'SOCIAL_SENTIMENT_REPLAY' | 'MACROECONOMIC_REPLAY'

// ─────────────────────────────────────────────────────────────────────────────
// Execution Simulation  (§8, Rule 10/11)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP'

export interface ExecutionAssumptions {
  slippageModel: string
  spreadModel: string
  marketImpactModel: string
  liquidityModel: string
  latencySimulationMs: number
  exchangeFeeRate: number
  partialFillEnabled: boolean
  version: string // Rule 10
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Metrics  (§10)
// ─────────────────────────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  cagr: number
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number
  sortinoRatio: number
  calmarRatio: number
  profitFactor: number
  winRate: number
  maxDrawdown: number
  recoveryFactor: number
  expectancy: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  avgWin: number
  avgLoss: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Metrics  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskMetrics {
  volatility: number
  var95: number
  var99: number
  expectedShortfall: number
  beta: number
  maxDrawdownDuration: number
  avgDrawdown: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade + Order Logs  (§6)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulatedTrade {
  tradeId: string
  timestamp: number
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  fees: number
  slippage: number
  marketImpact: number
  orderType: OrderType
  pnl: number
}

export interface SimulatedOrder {
  orderId: string
  timestamp: number
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: OrderType
  requestedQuantity: number
  filledQuantity: number
  requestedPrice: number | null
  executedPrice: number
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'CANCELLED'
  fees: number
  slippage: number
}

export interface PortfolioEvolutionPoint {
  timestamp: number
  nav: number
  cash: number
  positions: Record<string, { quantity: number; marketValue: number; weight: number }>
  grossExposure: number
  netExposure: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark Comparison  (§5, §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface BenchmarkComparison {
  benchmarkId: string
  benchmarkReturn: number
  portfolioReturn: number
  alpha: number
  beta: number
  trackingError: number
  informationRatio: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation Lineage  (Rule 6, Rule 15A)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationLineage {
  strategyIdentifier: string // Rule 15A
  portfolioIdentifier: string // Rule 15A
  modelIdentifier: string // Rule 15A
  modelVersion: string // Rule 15A
  featureVersion: string // Rule 15A
  datasetVersion: string // Rule 15A
  alternativeDatasetVersion: string
  simulationConfigVersion: string // Rule 15A
  executionAssumptionsVersion: string // Rule 10
  governanceVersion: string
}

export interface SimulationVersionBundle {
  simulationVersion: string
  datasetVersion: string
  featureVersion: string
  modelVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface SimulationGovernanceMetadata {
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
// Canonical Simulation Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalSimulationContract {
  simulationEventId: string // Rule 3
  simulationVersion: string
  simulationIdentifier: string
  strategyIdentifier: string
  portfolioIdentifier: string
  simulationTimestamp: number

  // §6 — Canonical Simulation Contract fields
  tradeHistory: SimulatedTrade[]
  orderHistory: SimulatedOrder[]
  portfolioEvolution: PortfolioEvolutionPoint[]
  performanceMetrics: PerformanceMetrics
  riskMetrics: RiskMetrics
  benchmarkComparison: BenchmarkComparison

  // Metadata + Governance
  simulationMetadata: {
    simulationEventId: string
    simulationVersion: string
    versions: SimulationVersionBundle
    lineage: SimulationLineage
    methodology: SimulationMethod
    executionAssumptions: ExecutionAssumptions
  }
  governanceMetadata: SimulationGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationConfiguration {
  methodology: SimulationMethod
  startDate: number
  endDate: number
  initialCapital: number
  replayType: ReplayType
  executionAssumptions: ExecutionAssumptions
  benchmarkId: string
  /** Rule 17 — Prevent look-ahead bias. */
  preventLookAheadBias: boolean
  /** Rule 9A — Point-in-time AI inference (no pre-computed predictions). */
  pointInTimeAIInference: boolean
  /** Rule 18 — Walk-forward independent from in-sample optimization. */
  walkForwardIndependent: boolean
  versions: SimulationVersionBundle
}

export const DEFAULT_SIMULATION_CONFIG: Omit<SimulationConfiguration, 'versions'> = {
  methodology: 'HISTORICAL_REPLAY',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 30, // 30 days ago
  endDate: Date.now(),
  initialCapital: 100000,
  replayType: 'CANDLE_REPLAY',
  executionAssumptions: {
    slippageModel: 'linear', spreadModel: 'half_spread', marketImpactModel: 'sqrt',
    liquidityModel: 'adv_based', latencySimulationMs: 100, exchangeFeeRate: 0.001,
    partialFillEnabled: true, version: '1.0.0',
  },
  benchmarkId: 'btc-benchmark',
  preventLookAheadBias: true,
  pointInTimeAIInference: true,
  walkForwardIndependent: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages  (§5 — 17 stages)
// ─────────────────────────────────────────────────────────────────────────────

export const SIMULATION_STAGES = [
  'SIMULATION_CONFIGURATION', 'HISTORICAL_DATASET_LOADING', 'POINT_IN_TIME_DATASET_VALIDATION',
  'CANONICAL_FEATURE_SNAPSHOT_LOADING', 'CANONICAL_ALTERNATIVE_DATASET_LOADING',
  'AI_MODEL_LOADING', 'POINT_IN_TIME_AI_INFERENCE_GENERATION',
  'MARKET_EVENT_REPLAY', 'ORDER_EXECUTION_SIMULATION', 'PORTFOLIO_EVOLUTION',
  'PERFORMANCE_CALCULATION', 'RISK_EVALUATION', 'BENCHMARK_COMPARISON',
  'SIMULATION_VALIDATION', 'SIMULATION_PUBLICATION', 'METADATA_RECORDING',
  'SIMULATION_COMPLETION',
] as const

export const MSBE_VERSION = '1.0.0'
export const SIMULATION_SCHEMA_VERSION = '1.0.0'
