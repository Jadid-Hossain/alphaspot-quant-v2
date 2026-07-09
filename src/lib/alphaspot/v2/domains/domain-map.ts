// DOMAIN MAP — I/O Flow Chain  (Chapter 2.1 §3, §6)
//
// Documents the 14 domains, their order in the processing chain, and the
// data contract that flows between each pair. This is the single source of
// truth for "which domain publishes what" and "which domain consumes what".
//
// Chapter 2.1 §6 flow:
//   Market Gateway → Raw Market Events
//   → Market Data → Historical Dataset
//   → Feature Engineering → Feature Snapshot
//   → Market Intelligence → Market Context
//   → Machine Learning → Prediction
//   → Decision Engine → Trade Candidate
//   → Portfolio Intelligence → Portfolio Assessment
//   → Risk Engine → Risk Assessment
//   → Execution Engine → Execution Result
//   → Presentation
//
// Workflow Orchestration (02) coordinates the entire chain.
// Core Infrastructure (01) is depended on by ALL domains.
// Persistence (12) is consumed by Data, Candidates, Recommendations, Executions.
// Research Platform (13) runs OFFLINE — never in the production chain.

import type {
  Asset,
  AssetMeta,
  EngineeredFeatures,
  MarketContext,
  StatisticalMetrics,
  ExpectedValue,
  TradeCandidate,
  Recommendation,
  MarketSnapshot,
} from '../types'

export type DomainId =
  | '01-core-infrastructure'
  | '02-workflow-orchestration'
  | '03-market-gateway'
  | '04-market-data'
  | '05-feature-engineering'
  | '06-market-intelligence'
  | '07-machine-learning'
  | '08-decision-engine'
  | '09-portfolio-intelligence'
  | '10-risk-engine'
  | '11-execution-engine'
  | '12-persistence'
  | '13-research-platform'
  | '14-presentation-layer'

export interface DomainDescriptor {
  id: DomainId
  number: number
  name: string
  purpose: string
  responsibilities: string[]
  forbidden: string[]
  publishes: string // the contract name this domain outputs
  consumes: string[] // contract names this domain reads
  inProductionChain: boolean // false for Research (13) which runs offline
}

export const DOMAINS: DomainDescriptor[] = [
  {
    id: '01-core-infrastructure',
    number: 1,
    name: 'Core Infrastructure',
    purpose: 'Provide shared platform capabilities',
    responsibilities: ['configuration', 'logging', 'metrics', 'health checks', 'scheduling', 'time sync', 'secrets', 'DI registry'],
    forbidden: ['business logic', 'analysis'],
    publishes: 'PlatformConfig, Logger, Metrics, HealthStatus, ScheduledTask',
    consumes: [],
    inProductionChain: false,
  },
  {
    id: '02-workflow-orchestration',
    number: 2,
    name: 'Workflow Orchestration',
    purpose: 'Coordinate the execution lifecycle',
    responsibilities: ['execution order', 'snapshot lifecycle', 'retry/timeout policy', 'pipeline completion'],
    forbidden: ['calculations', 'predictions', 'feature engineering'],
    publishes: 'MarketSnapshot',
    consumes: ['all domain contracts (coordinates only)'],
    inProductionChain: true,
  },
  {
    id: '03-market-gateway',
    number: 3,
    name: 'Market Gateway',
    purpose: 'Communicate with external exchanges',
    responsibilities: ['websocket connections', 'REST sync', 'symbol discovery', 'reconnect strategy', 'exchange health'],
    forbidden: ['analysis', 'feature engineering', 'trading decisions'],
    publishes: 'RawMarketEvent',
    consumes: [],
    inProductionChain: true,
  },
  {
    id: '04-market-data',
    number: 4,
    name: 'Market Data',
    purpose: 'Store raw market information',
    responsibilities: ['tick/candle/orderbook/funding history', 'structural validation (eligibility gate)', 'historical archive'],
    forbidden: ['calculations', 'trading decisions'],
    publishes: 'AssetEligibility, raw data accessors',
    consumes: ['RawMarketEvent (from Gateway)'],
    inProductionChain: true,
  },
  {
    id: '05-feature-engineering',
    number: 5,
    name: 'Feature Engineering',
    purpose: 'Transform raw market information into analytical features',
    responsibilities: ['feature generation', 'normalization', 'validation', 'quality', 'versioning'],
    forbidden: ['machine learning', 'trading decisions'],
    publishes: 'EngineeredFeatures',
    consumes: ['Candle[] (from Market Data)'],
    inProductionChain: true,
  },
  {
    id: '06-market-intelligence',
    number: 6,
    name: 'Market Intelligence',
    purpose: 'Convert analytical features into market understanding',
    responsibilities: ['market structure', 'trend', 'volatility', 'liquidity', 'regime', 'relative strength', 'correlation'],
    forbidden: ['trade recommendations'],
    publishes: 'MarketContext',
    consumes: ['EngineeredFeatures (from Feature Engineering)'],
    inProductionChain: true,
  },
  {
    id: '07-machine-learning',
    number: 7,
    name: 'Machine Learning',
    purpose: 'Generate probabilistic forecasts',
    responsibilities: ['inference', 'confidence estimation', 'probability calibration', 'ensemble aggregation'],
    forbidden: ['portfolio management', 'trade recommendations'],
    publishes: 'StatisticalMetrics (probabilities, never recommendations)',
    consumes: ['EngineeredFeatures', 'MarketContext'],
    inProductionChain: true,
  },
  {
    id: '08-decision-engine',
    number: 8,
    name: 'Decision Engine',
    purpose: 'Transform intelligence into Trade Candidates',
    responsibilities: ['expected value estimation', 'candidate scoring', 'ranking', 'trade quality', 'reasoning'],
    forbidden: ['portfolio management', 'risk override'],
    publishes: 'TradeCandidate[] (ONLY this domain creates them)',
    consumes: ['EngineeredFeatures', 'MarketContext', 'StatisticalMetrics'],
    inProductionChain: true,
  },
  {
    id: '09-portfolio-intelligence',
    number: 9,
    name: 'Portfolio Intelligence',
    purpose: 'Evaluate every Trade Candidate inside portfolio context',
    responsibilities: ['diversification', 'exposure', 'sector concentration', 'correlation', 'capital allocation'],
    forbidden: ['prediction', 'risk override'],
    publishes: 'TradeCandidate[] (portfolio-adjusted) + PortfolioAssessment',
    consumes: ['TradeCandidate[] (from Decision Engine)'],
    inProductionChain: true,
  },
  {
    id: '10-risk-engine',
    number: 10,
    name: 'Risk Engine',
    purpose: 'Protect capital',
    responsibilities: ['stop loss', 'take profit', 'position sizing', 'portfolio risk', 'drawdown control', 'recommendation invalidation'],
    forbidden: ['prediction'],
    publishes: 'RiskAssessment[] (may INVALIDATE candidates)',
    consumes: ['TradeCandidate[] (from Portfolio Intelligence)'],
    inProductionChain: true,
  },
  {
    id: '11-execution-engine',
    number: 11,
    name: 'Execution Engine',
    purpose: 'Manage trade execution',
    responsibilities: ['paper execution', 'order simulation', 'execution monitoring', 'trade lifecycle', 'execution reports'],
    forbidden: ['signal generation', 'prediction'],
    publishes: 'ExecutionResult',
    consumes: ['Recommendation[] (approved by Risk Engine)'],
    inProductionChain: true,
  },
  {
    id: '12-persistence',
    number: 12,
    name: 'Persistence',
    purpose: 'Persist platform state',
    responsibilities: ['database writes', 'transactions', 'batching', 'storage abstraction', 'data durability'],
    forbidden: ['business logic', 'analysis'],
    publishes: 'storage abstraction (save/load helpers)',
    consumes: ['MarketSnapshot, TradeCandidate, Recommendation, ExecutionResult (to persist)'],
    inProductionChain: true,
  },
  {
    id: '13-research-platform',
    number: 13,
    name: 'Research Platform',
    purpose: 'Continuously improve the platform',
    responsibilities: ['backtesting', 'walk-forward validation', 'optimization', 'experiment tracking'],
    forbidden: ['production trading'],
    publishes: 'BacktestResult, PerformanceMetrics (OFFLINE only)',
    consumes: ['historical MarketSnapshot[], Recommendation[], ExecutionResult[]'],
    inProductionChain: false, // never in the live chain
  },
  {
    id: '14-presentation-layer',
    number: 14,
    name: 'Presentation Layer',
    purpose: 'Deliver information to the user',
    responsibilities: ['dashboard', 'charts', 'watchlists', 'explanations', 'recommendation display', 'historical performance'],
    forbidden: ['business logic', 'calculations'],
    publishes: 'PresentationView (read-only)',
    consumes: ['MarketSnapshot (from Workflow Orchestration)'],
    inProductionChain: true,
  },
]

// ── Data contract flow (Chapter 2.1 §6) ────────────────────────────────────
export interface FlowStage {
  domain: DomainId
  input: string
  output: string
  outputType: string // TypeScript type name
}

export const PRODUCTION_FLOW: FlowStage[] = [
  { domain: '03-market-gateway', input: '—', output: 'Raw Market Events', outputType: 'RawMarketEvent' },
  { domain: '04-market-data', input: 'Raw Market Events', output: 'Historical Dataset + Eligibility', outputType: 'AssetEligibility' },
  { domain: '05-feature-engineering', input: 'Historical Dataset', output: 'Feature Snapshot', outputType: 'EngineeredFeatures' },
  { domain: '06-market-intelligence', input: 'Feature Snapshot', output: 'Market Context', outputType: 'MarketContext' },
  { domain: '07-machine-learning', input: 'Features + Context', output: 'Prediction', outputType: 'StatisticalMetrics' },
  { domain: '08-decision-engine', input: 'Features + Context + Prediction', output: 'Trade Candidate', outputType: 'TradeCandidate' },
  { domain: '09-portfolio-intelligence', input: 'Trade Candidate', output: 'Portfolio Assessment', outputType: 'TradeCandidate[] (adjusted)' },
  { domain: '10-risk-engine', input: 'Portfolio-adjusted Candidates', output: 'Risk Assessment', outputType: 'RiskAssessment' },
  { domain: '11-execution-engine', input: 'Approved Recommendations', output: 'Execution Result', outputType: 'ExecutionResult' },
  { domain: '14-presentation-layer', input: 'Market Snapshot', output: 'Dashboard', outputType: 'PresentationView' },
]

// ── Type re-exports for the contracts that flow between domains ─────────────
export type {
  Asset,
  AssetMeta,
  EngineeredFeatures,
  MarketContext,
  StatisticalMetrics,
  ExpectedValue,
  TradeCandidate,
  Recommendation,
  MarketSnapshot,
}

/** Lookup a domain descriptor by id. */
export function getDomain(id: DomainId): DomainDescriptor | undefined {
  return DOMAINS.find((d) => d.id === id)
}

/** All production-chain domains in order. */
export function getProductionChain(): DomainDescriptor[] {
  return DOMAINS.filter((d) => d.inProductionChain)
}
