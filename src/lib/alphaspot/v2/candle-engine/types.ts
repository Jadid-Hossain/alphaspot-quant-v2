// CHAPTER 3.5 — Candle Construction Engine: Types & Contracts
//
// The CCE transforms Canonical Market Events (Ch 3.2) into deterministic
// canonical OHLCV candles. Given identical events, the CCE always produces
// identical candles (§2, Rule 10). Live and replay use identical algorithms
// (Rule 4). All boundaries follow canonical UTC (§6.1, Rule 11).

// ─────────────────────────────────────────────────────────────────────────────
// Candle lifecycle  (Chapter 3.5 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type CandleLifecycleState = 'OPEN' | 'UPDATING' | 'FINALIZED'

// ─────────────────────────────────────────────────────────────────────────────
// Timeframe + dependency graph  (Chapter 3.5 §6, §6.1)
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalTimeframe =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '12h'
  | '1d' | '1w' | '1M'

/** Timeframe duration in seconds (for UTC boundary calculation §6.1). */
export const TIMEFRAME_SECONDS: Record<CanonicalTimeframe, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
  '1d': 86400, '1w': 604800, '1M': 2629800, // 1M ≈ 30.44 days average
}

/**
 * The timeframe dependency graph (§6 — config-driven, not hardcoded).
 * Each higher timeframe maps to its canonical parent.
 * New timeframes can be added dynamically by mapping to an existing parent.
 */
export const TIMEFRAME_DEPENDENCY_GRAPH: Record<CanonicalTimeframe, CanonicalTimeframe | null> = {
  '1m': null,   // base — no parent
  '3m': '1m',
  '5m': '1m',
  '15m': '5m',
  '30m': '15m',
  '1h': '15m',
  '2h': '1h',
  '4h': '1h',
  '6h': '4h',
  '12h': '6h',
  '1d': '1h',
  '1w': '1d',
  '1M': '1d',
}

/** Get the parent timeframe for incremental aggregation (§6). */
export function getParentTimeframe(tf: CanonicalTimeframe): CanonicalTimeframe | null {
  return TIMEFRAME_DEPENDENCY_GRAPH[tf] ?? null
}

/** Detect circular dependencies in the timeframe graph (§6 — prohibited). */
export function detectTimeframeCycles(): string[][] {
  const cycles: string[][] = []
  const visited = new Set<CanonicalTimeframe>()
  const stack = new Set<CanonicalTimeframe>()
  const path: CanonicalTimeframe[] = []

  const dfs = (tf: CanonicalTimeframe): void => {
    if (stack.has(tf)) {
      const idx = path.indexOf(tf)
      cycles.push([...path.slice(idx), tf])
      return
    }
    if (visited.has(tf)) return
    visited.add(tf)
    stack.add(tf)
    path.push(tf)
    const parent = getParentTimeframe(tf)
    if (parent) dfs(parent)
    path.pop()
    stack.delete(tf)
  }

  for (const tf of Object.keys(TIMEFRAME_DEPENDENCY_GRAPH) as CanonicalTimeframe[]) {
    dfs(tf)
  }
  return cycles
}

/**
 * Calculate the UTC boundary for a given timestamp + timeframe (§6.1).
 * Returns the open time (start of the candle period) as UTC epoch seconds.
 */
export function getCandleOpenTime(timestampSec: number, tf: CanonicalTimeframe): number {
  const seconds = TIMEFRAME_SECONDS[tf]

  if (tf === '1w') {
    // §6.1 — 1W starts at 00:00:00 UTC every Monday
    const date = new Date(timestampSec * 1000)
    const day = date.getUTCDay() // 0=Sun, 1=Mon
    const daysSinceMonday = (day === 0 ? 6 : day - 1)
    const mondayStart = Math.floor(timestampSec / 86400) * 86400 - daysSinceMonday * 86400
    return mondayStart
  }
  if (tf === '1M') {
    // §6.1 — 1M starts at 00:00:00 UTC on the first day of the month
    const date = new Date(timestampSec * 1000)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000
  }
  // All other timeframes: align to UTC epoch
  return Math.floor(timestampSec / seconds) * seconds
}

/** Calculate the close time (end of candle period) as UTC epoch seconds. */
export function getCandleCloseTime(openTimeSec: number, tf: CanonicalTimeframe): number {
  if (tf === '1M') {
    const date = new Date(openTimeSec * 1000)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000 - 1
  }
  return openTimeSec + TIMEFRAME_SECONDS[tf] - 1
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Candle  (Chapter 3.5 §4 — Canonical Candle Schema)
// ─────────────────────────────────────────────────────────────────────────────

export type CompletionStatus = 'OPEN' | 'UPDATING' | 'FINALIZED'
export type ConstructionMethod = 'LIVE' | 'REPLAY' | 'RECONSTRUCTION' | 'AGGREGATION'
export type GapStatus = 'NONE' | 'ZERO_VOLUME' | 'GAP_EVENT' | 'PARTIAL'
export type ValidationStatus = 'VALID' | 'INVALID' | 'PENDING'
export type RepairStatus = 'NONE' | 'REPAIRED' | 'PENDING_REPAIR'

/** Permanent Primary Identity (§4, Rule 16): Exchange + Symbol + Timeframe + Open Time. */
export interface CandlePrimaryIdentity {
  exchange: string
  symbol: string
  timeframe: CanonicalTimeframe
  openTime: number // UTC epoch seconds (§6.1)
}

/**
 * The canonical candle (§4 — 16 required fields + provenance).
 * Every candle must possess a permanent Primary Identity (Rule 16).
 * Finalized candles are immutable (Rule 2, Rule 8).
 */
export interface CanonicalCandle {
  // §4 — Primary Identity
  identity: CandlePrimaryIdentity

  // §4 — Required fields
  symbol: string
  exchange: string
  timeframe: CanonicalTimeframe
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  tradeCount: number
  vwap: number
  buyVolume: number
  sellVolume: number
  completionStatus: CompletionStatus
  candleVersion: number // §10 — increments on correction
  dataQuality: CandleDataQuality

  // §4 — Provenance metadata
  provenance: CandleProvenance

  // §4.1 — Optional microstructure extension (logically separate, Rule 15)
  microstructure?: MarketMicrostructureExtension
}

export interface CandleDataQuality {
  validationStatus: ValidationStatus
  constructionMethod: ConstructionMethod
  gapStatus: GapStatus
  repairStatus: RepairStatus
  sourceDataset: string | null
  qualityScore: number // 0..1
}

export interface CandleProvenance {
  constructionStartTime: number // UTC epoch ms
  constructionFinishTime: number | null
  engineVersion: string
  replayFlag: boolean
  recoveryFlag: boolean
  parentCandleCount: number // number of lower-TF candles aggregated
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Microstructure Extension  (Chapter 3.5 §4.1)
// Logically separate from core OHLCV (Rule 15). Consumers may ignore.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketMicrostructureExtension {
  averageSpread: number | null
  maxSpread: number | null
  minSpread: number | null
  timeWeightedAvgSpread: number | null
  averageOrderBookImbalance: number | null
  maxOrderBookImbalance: number | null
  bidDepth: number | null
  askDepth: number | null
  liquidityScore: number | null // 0..1
  microstructureQuality: number | null // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Candle snapshot  (Chapter 3.5 §16 — immutable, read-only)
// ─────────────────────────────────────────────────────────────────────────────

export interface CandleSnapshot {
  candle: Readonly<CanonicalCandle>
  snapshotAt: number
  isFinalized: boolean
}

export const CCE_ENGINE_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Event watermark  (Chapter 3.5 §8, Rule 17 — completion governed by watermarks)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventWatermark {
  /** The highest event timestamp observed by the CCE. */
  currentWatermark: number // UTC epoch seconds
  /** Late-arrival tolerance window (§8). */
  lateArrivalToleranceSec: number
}

export const DEFAULT_LATE_ARRIVAL_TOLERANCE_SEC = 5 // 5 seconds
