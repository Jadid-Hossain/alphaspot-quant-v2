// CHAPTER 3.6 §4, §7, §7.1, §12 — Microstructure Types & Contracts
//
// The MME transforms Canonical Market Events (Ch 3.2) into deterministic
// microstructure snapshots. Snapshots are immutable after publication (Rule 2).
// Updates are atomic (Rule 3). Consumers never observe partial state (Rule 4).

// ─────────────────────────────────────────────────────────────────────────────
// Depth Restitution Limit  (Chapter 3.6 §7.1, Rule 11)
// ─────────────────────────────────────────────────────────────────────────────

export type DepthRestitutionMode = 'TOP_N_LEVELS' | 'PERCENTAGE_DISTANCE'

export interface DepthRestitutionLimit {
  mode: DepthRestitutionMode
  /** For TOP_N_LEVELS: max price levels to retain (e.g. 50). */
  topN?: number
  /** For PERCENTAGE_DISTANCE: max distance from mid price (e.g. 0.02 = ±2%). */
  percentageDistance?: number
}

export const DEFAULT_DEPTH_LIMIT: DepthRestitutionLimit = {
  mode: 'TOP_N_LEVELS',
  topN: 50,
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Microstructure Snapshot  (Chapter 3.6 §4 — Output Contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface MicrostructureSnapshot {
  symbol: string
  exchange: string
  timestamp: number // UTC epoch ms
  bestBid: number | null
  bestAsk: number | null
  midPrice: number | null
  currentSpread: number | null
  bidVolume: number | null
  askVolume: number | null
  orderBookImbalance: number | null // -1..1
  liquidityScore: number | null // 0..1
  executionPressure: number | null // -1..1 (negative=sell pressure, positive=buy)
  tradePressure: number | null // -1..1
  marketEfficiency: number | null // 0..1
  microstructureQuality: MicrostructureQuality
  snapshotVersion: number // monotonically increasing
}

// ─────────────────────────────────────────────────────────────────────────────
// Microstructure Quality  (Chapter 3.6 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface MicrostructureQuality {
  synchronization: 'SYNCED' | 'OUT_OF_SYNC' | 'UNKNOWN'
  latencyMs: number | null
  bookCompleteness: number // 0..1
  tradeCoverage: number // 0..1
  spreadStability: number // 0..1
  dataIntegrity: 'VALID' | 'INVALID' | 'DEGRADED'
  overallScore: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Market State Model  (Chapter 3.6 §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketMicrostructureState {
  symbol: string
  exchange: string
  // §7 — best bid/ask
  bestBid: number | null
  bestAsk: number | null
  // §7 — depth (bounded by §7.1)
  bidDepth: number
  askDepth: number
  boundedBids: Array<[number, number]> // [price, quantity] — bounded by DepthRestitutionLimit
  boundedAsks: Array<[number, number]>
  // §7 — rolling VWAP (EMA-based, constant memory §15.1)
  rollingVwap: number | null
  // §7 — trade velocity
  tradeVelocity: number // trades per second (EMA)
  // §7 — aggressive volumes (§9.1 aggressor tagging)
  aggressiveBuyVolume: number
  aggressiveSellVolume: number
  // §7 — average spread (EMA)
  averageSpread: number | null
  // §7 — liquidity estimate
  liquidityEstimate: number | null // 0..1
  // §7 — pressure estimate
  pressureEstimate: number | null // -1..1
  // §7 — order book shape (bounded representation)
  orderBookShape: OrderBookShape | null
  // §8 — spread analysis
  spreadAnalysis: SpreadAnalysis
  // §9 — execution pressure
  executionPressure: ExecutionPressure
  // §10 — order book pressure
  orderBookPressure: OrderBookPressure
  // §11 — liquidity profile
  liquidityProfile: LiquidityProfile
  // Versioning
  version: number
  lastUpdateTimestamp: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Spread Analysis  (Chapter 3.6 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpreadAnalysis {
  currentSpread: number | null
  averageSpread: number | null // EMA
  medianSpread: number | null // from circular buffer
  maxSpread: number | null
  spreadVolatility: number | null // EWMA of spread changes
  spreadExpansionRate: number | null // rate of spread widening
  spreadCompressionRate: number | null // rate of spread tightening
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Pressure  (Chapter 3.6 §9, §9.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionPressure {
  aggressiveBuyRatio: number | null // 0..1
  aggressiveSellRatio: number | null // 0..1
  netMarketPressure: number | null // -1..1
  tradeDirectionBias: number | null // -1..1
  executionImbalance: number | null // -1..1
  // §9.1 — aggressor tagging uses exchange Maker/Taker metadata only (Rule 12)
  aggressorMethod: 'EXCHANGE_METADATA' // always — price-based inference prohibited
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Book Pressure  (Chapter 3.6 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderBookPressure {
  depthImbalance: number | null // -1..1
  nearPriceLiquidity: number | null
  farPriceLiquidity: number | null
  liquidityGradient: number | null // rate of liquidity change
  queuePressure: number | null // -1..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Profile  (Chapter 3.6 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidityProfile {
  immediateLiquidity: number | null // 0..1
  localLiquidity: number | null // 0..1
  regionalLiquidity: number | null // 0..1
  structuralLiquidity: number | null // 0..1
  liquidityStability: number | null // 0..1
  liquidityMigration: number | null // -1..1 (direction of liquidity shift)
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Book Shape  (Chapter 3.6 §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderBookShape {
  bidLevels: number
  askLevels: number
  bidAskLevelRatio: number | null
  depthConcentration: number | null // 0..1 (how concentrated near mid)
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded depth level  (for §7.1 depth restitution)
// ─────────────────────────────────────────────────────────────────────────────

export interface BoundedDepthLevel {
  price: number
  quantity: number
  side: 'BID' | 'ASK'
  distanceFromMid: number // percentage
}
