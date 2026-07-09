// AlphaSpot Quant V2 — Core Type System
//
// This file defines the foundational types mandated by Chapter 1 of the MDS:
//   • Multi-lane processing (Lane A / B / C)
//   • The 10-stage recommendation pipeline
//   • Trade Candidate lifecycle
//   • Market Snapshot architecture
//   • Structural constraints vs statistical evaluation
//   • Expected Value + Risk Metrics
//   • Recommendations with expiration
//
// These types are the contract every pipeline stage depends on. Later chapters
// of the MDS will specify the exact algorithms; here we establish the shapes.

import type { Candle, Timeframe } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Assets & Symbols
// ─────────────────────────────────────────────────────────────────────────────

export type Asset = string // canonical "BASE/USDT" form, e.g. "BTC/USDT"

export interface AssetMeta {
  asset: Asset
  base: string
  quote: string
  exchangeStatus: 'TRADING' | 'BREAK' | 'HALT' | 'OTHER'
  isSpotTradable: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Regime & Context  (Chapter 1 §5, §7-B, Principle 5)
// ─────────────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITIONAL'
  | 'UNKNOWN'

export interface MarketContext {
  regime: MarketRegime
  regimeConfidence: number // 0..1
  volatilityPct: number | null // annualized or rolling % vol
  volatilityRank: number | null // 0..1 — where current vol sits vs its own history
  liquidityScore: number | null // 0..1 — normalized
  spreadPct: number | null // bid-ask spread as % of price
  marketStructure: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED'
  relativeStrength: number | null // 0..1 vs the broader market
  statisticalEdge: number | null // 0..1 — provisional edge before full EV
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural Constraints  (Chapter 1 §7-A)
// Hard gates that determine eligibility BEFORE any statistical work.
// ─────────────────────────────────────────────────────────────────────────────

export interface StructuralConstraints {
  minHistoryBars: number // e.g. 200 — enough for EMA200 + indicators
  minQuoteVolume24h: number // e.g. 1_000_000 USDT — liquidity floor
  maxSpreadPct: number // e.g. 0.5 — acceptable bid-ask spread
  requireExchangeTrading: boolean // status must be 'TRADING'
  requireSpotTradable: boolean
  minAtr: number | null // reject dead-flat coins (optional)
}

export const DEFAULT_CONSTRAINTS: StructuralConstraints = {
  minHistoryBars: 200,
  minQuoteVolume24h: 1_000_000,
  maxSpreadPct: 0.5,
  requireExchangeTrading: true,
  requireSpotTradable: true,
  minAtr: null,
}

export interface AssetEligibility {
  asset: Asset
  eligible: boolean
  failedChecks: string[] // human-readable reasons if ineligible
  checkedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Engineering Output  (Chapter 1 §6, pipeline stage 3)
// Wraps the V1 indicators + patterns + derived structural features.
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineeredFeatures {
  asset: Asset
  timeframe: Timeframe
  candles: Candle[]
  // V1 indicator bundle (re-exported for reuse)
  indicators: import('../types').Indicators
  patterns: import('../types').Patterns
  // Derived structural features (Chapter 1 §7-B mentions momentum, volatility behavior)
  momentumScore: number | null // -1..1
  volatilityScore: number | null // 0..1
  trendAlignment: number | null // -1..1 across timeframes
  liquidityScore: number | null // 0..1
  computedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical Metrics  (Chapter 1 §7-B, §10)
// Probabilistic outputs of the statistical evaluation stage.
// ─────────────────────────────────────────────────────────────────────────────

export interface StatisticalMetrics {
  asset: Asset
  probabilityOfSuccess: number | null // 0..1 — P(trade reaches target before stop)
  expectedReturnPct: number | null // expected % move in favor
  expectedDrawdownPct: number | null // expected adverse excursion
  confidence: number | null // 0..1 — model confidence in the estimate
  edgeScore: number | null // 0..1 — synthesized statistical edge
  sampleQuality: number | null // 0..1 — how reliable the sample is
  evidenceCount: number // number of independent evidence sources
}

// ─────────────────────────────────────────────────────────────────────────────
// Expected Value  (Chapter 1 §7-B, §11)
// Unified EV assessment synthesized from statistical + context factors.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpectedValueComponent {
  key: string
  label: string
  contribution: number // signed contribution to EV
  detail: string
}

export interface ExpectedValue {
  asset: Asset
  ev: number | null // unified expected value, signed (positive = favorable)
  evPercent: number | null // EV as % of capital
  components: ExpectedValueComponent[]
  confidence: number | null // 0..1
  regimeAlignment: number | null // -1..1 — how well it fits current regime
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Metrics  (Chapter 1 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskMetrics {
  asset: Asset
  maxRiskPct: number | null // max loss if stop hits, as % of allocated capital
  rewardToRisk: number | null // R multiple (expected reward / risk)
  kellyFraction: number | null // 0..1 — suggested position sizing fraction
  varEstimate: number | null // value-at-risk estimate
  suggestedStopPrice: number | null
  suggestedTargetPrice: number | null
  suggestedEntryPrice: number | null
  positionSizePct: number | null // 0..1 — fraction of capital to deploy
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade Candidate  (Chapter 1 §10)
// The central artifact of the system. Every recommendation begins here.
// ─────────────────────────────────────────────────────────────────────────────

export type CandidateStage =
  | 'CREATED'
  | 'STRUCTURAL_VALIDATION'
  | 'STATISTICAL_EVALUATION'
  | 'PORTFOLIO_OPTIMIZATION'
  | 'RECOMMENDATION_VALIDATION'
  | 'PUBLISHED'
  | 'EXPIRED'
  | 'REJECTED'

export type CandidateAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH'

export interface TradeCandidate {
  id: string
  asset: Asset
  version: number // bumped on every re-evaluation
  createdAt: number
  stage: CandidateStage
  action: CandidateAction
  // Pipeline outputs (filled in progressively)
  eligibility: AssetEligibility | null
  features: EngineeredFeatures | null
  context: MarketContext | null
  statistics: StatisticalMetrics | null
  expectedValue: ExpectedValue | null
  risk: RiskMetrics | null
  rationale: string // human-readable explanation (Principle 6)
  rejectionReason: string | null
  expiresAt: number // every candidate expires (Principle 7)
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation  (Chapter 1 §6, §10, §12)
// A published, validated, ranked recommendation.
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendationRank = 'A' | 'B' | 'C' | 'D' // quality tier

export interface Recommendation {
  id: string
  candidateId: string
  asset: Asset
  action: CandidateAction
  rank: RecommendationRank
  // Pricing & sizing
  entryPrice: number | null
  targetPrice: number | null
  stopPrice: number | null
  positionSizePct: number | null
  // Statistical backing
  expectedValue: number | null
  probabilityOfSuccess: number | null
  rewardToRisk: number | null
  // Explainability (Principle 6, Rule 3)
  rationale: string
  evidence: ExpectedValueComponent[]
  // Lifecycle (Principle 7, Rule 5)
  publishedAt: number
  expiresAt: number
  status: 'ACTIVE' | 'EXPIRED' | 'FILLED' | 'INVALIDATED' | 'CLOSED'
  // Reproducibility (Rule 2)
  snapshotVersion: number
  pipelineVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Snapshot  (Chapter 1 §9)
// Immutable analytical result published for the dashboard.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketSnapshot {
  version: number // monotonic snapshot counter
  timestamp: number
  pipelineVersion: string
  regime: MarketRegime
  regimeConfidence: number
  // The full evaluated universe for this snapshot
  evaluatedAssets: string[]
  eligibleAssets: string[]
  // Ranking — assets sorted by statistical quality (Principle 4)
  rankings: Array<{
    asset: Asset
    ev: number | null
    edgeScore: number | null
    rank: number
    tier: RecommendationRank | null
  }>
  // Candidates that survived the pipeline
  tradeCandidates: TradeCandidate[]
  // Published recommendations (subset of candidates)
  recommendations: Recommendation[]
  // Portfolio-level analysis
  portfolioAnalysis: PortfolioAnalysis
  // Traceability
  stageTimings: Record<string, number> // ms spent in each pipeline stage
  generatedAt: number
}

export interface PortfolioAnalysis {
  totalEligible: number
  totalCandidates: number
  activeRecommendations: number
  capitalDeployedPct: number
  openPositions: number
  averagePositionQuality: number | null
  riskBudgetUsedPct: number | null
  marketBreadth: number | null // % of eligible assets with positive EV
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline stage contracts  (Chapter 1 §6, §11)
// Each stage is a pure function: input → output. No stage publishes directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineStageResult<T> {
  output: T
  durationMs: number
  errors: string[]
}

export interface PipelineContext {
  snapshotVersion: number
  pipelineVersion: string
  constraints: StructuralConstraints
  generatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Lane contracts  (Chapter 1 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface LaneARealtime {
  // Real-time market cache — short-lived in-memory state
  getPrice(asset: Asset): number | null
  getOrderBook(asset: Asset): import('../types').OrderBookImbalance | null
  getFunding(asset: Asset): import('../types').FundingData | null
  get24hStats(asset: Asset): { changePct: number | null; volume: number | null; quoteVolume: number | null } | null
  getCandles(asset: Asset, tf: Timeframe): Candle[] | null
  subscribe(handler: (asset: Asset, event: LaneAEvent) => void): () => void
}

export type LaneAEvent =
  | { type: 'PRICE_TICK'; price: number; time: number }
  | { type: 'CANDLE_UPDATE'; timeframe: Timeframe; candle: Candle; isFinal: boolean }
  | { type: 'ORDER_BOOK'; imbalance: import('../types').OrderBookImbalance }
  | { type: 'FUNDING'; funding: import('../types').FundingData }

export interface LaneBAnalytical {
  // Produces immutable Market Snapshots on a schedule (not per-tick)
  runPipeline(): Promise<MarketSnapshot>
  getLatestSnapshot(): MarketSnapshot | null
  getSnapshotHistory(): MarketSnapshot[]
  subscribe(handler: (snapshot: MarketSnapshot) => void): () => void
}

export interface LaneCResearch {
  // Research & validation — never blocks production
  backtest(strategy: string, from: number, to: number): Promise<unknown>
  validatePrediction(recommendationId: string): Promise<unknown>
  getPerformanceMetrics(): Promise<unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PIPELINE_VERSION = '2.0.0-ch1'

export const PIPELINE_STAGES = [
  'market-observation',
  'structural-validation',
  'feature-engineering',
  'market-context',
  'statistical-evaluation',
  'expected-value',
  'candidate-generation',
  'portfolio-optimization',
  'recommendation-validation',
  'ranking-engine',
  'snapshot-generation',
] as const

export type PipelineStageName = (typeof PIPELINE_STAGES)[number]

export const DEFAULT_RECOMMENDATION_TTL_MS = 15 * 60 * 1000 // 15 minutes

export const RANK_THRESHOLDS = {
  A: { minEv: 2.0, minConfidence: 0.7, minEdge: 0.75 }, // tier A: strongest
  B: { minEv: 1.0, minConfidence: 0.55, minEdge: 0.6 },
  C: { minEv: 0.3, minConfidence: 0.4, minEdge: 0.45 },
  D: { minEv: 0, minConfidence: 0.3, minEdge: 0.3 },
} as const
