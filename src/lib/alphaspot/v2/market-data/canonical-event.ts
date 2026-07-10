// CHAPTER 3.2 §6.1, §10, §11, §12 — Canonical Market Event Types
//
// Every published event is canonical (Rule 3), immutable (Rule 4), versioned
// (§11). Exchange-specific formats never escape the pipeline (Rule 9).
//
// High-Resolution Timestamp Policy (§6.1):
//   Every canonical event contains 3 timestamps:
//     • Exchange Timestamp  — from the exchange (ms epoch)
//     • Reception Timestamp — monotonic high-res when we received it
//     • Pipeline Timestamp  — monotonic high-res when the pipeline processed it
//   Reception/Pipeline use monotonic high-resolution timestamps with sufficient
//   precision to uniquely order events arriving within the same millisecond.
//   Timestamp precision is implementation-independent (§6.1).
//   Business logic never depends on a specific timing API (§6.1).

// ─────────────────────────────────────────────────────────────────────────────
// High-resolution timestamp  (Chapter 3.2 §6.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A high-resolution monotonic timestamp. Uses BigInt nanoseconds since
 * a fixed epoch to provide sub-millisecond precision for deterministic
 * event ordering (§6.1, Rule 12).
 *
 * Implementation-independent: the internal representation is nanoseconds,
 * but the API exposes hrMs() (high-res milliseconds with sub-ms fraction)
 * and hrNs() (full nanosecond precision). Business logic never depends
 * on the internal representation (§6.1).
 */
export interface HighResolutionTimestamp {
  /** Monotonic nanoseconds since the HR epoch (implementation detail). */
  ns: bigint
}

/** Get the current high-resolution monotonic timestamp. */
export function hrNow(): HighResolutionTimestamp {
  // process.hrtime.bigint() is monotonic and high-resolution (nanoseconds).
  // On platforms without process.hrtime, fall back to performance.now().
  if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
    return { ns: process.hrtime.bigint() }
  }
  // Browser/fallback: performance.now() is also monotonic high-res (microseconds)
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return { ns: BigInt(Math.floor(performance.now() * 1_000_000)) }
  }
  // Last resort: Date.now() in nanoseconds (ms precision only)
  return { ns: BigInt(Date.now() * 1_000_000) }
}

/** Convert HR timestamp to milliseconds (with sub-ms fraction). */
export function hrMs(ts: HighResolutionTimestamp): number {
  return Number(ts.ns) / 1_000_000
}

/** Convert HR timestamp to nanoseconds. */
export function hrNs(ts: HighResolutionTimestamp): bigint {
  return ts.ns
}

/** Compare two HR timestamps: -1 if a < b, 0 if equal, 1 if a > b. */
export function hrCompare(a: HighResolutionTimestamp, b: HighResolutionTimestamp): number {
  if (a.ns < b.ns) return -1
  if (a.ns > b.ns) return 1
  return 0
}

/** Difference in nanoseconds (b - a). */
export function hrDiffNs(a: HighResolutionTimestamp, b: HighResolutionTimestamp): bigint {
  return b.ns - a.ns
}

/** Difference in milliseconds (b - a), with sub-ms fraction. */
export function hrDiffMs(a: HighResolutionTimestamp, b: HighResolutionTimestamp): number {
  return Number(hrDiffNs(a, b)) / 1_000_000
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical event types  (Chapter 3.2 §12)
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalEventType =
  | 'TRADE'
  | 'TICKER'
  | 'MINI_TICKER'
  | 'BOOK_TICKER'
  | 'DEPTH_UPDATE'
  | 'PARTIAL_DEPTH'
  | 'KLINE'
  | 'FUNDING'
  | 'REFERENCE_UPDATE'
  | 'HEARTBEAT'

/** Event type priority for backpressure dropping (§4.1 — highest first). */
export const EVENT_TYPE_PRIORITY: Record<CanonicalEventType, number> = {
  TRADE: 1, // highest — never drop unless emergency
  DEPTH_UPDATE: 2,
  BOOK_TICKER: 3,
  KLINE: 4,
  MINI_TICKER: 5,
  TICKER: 6, // lowest priority
  PARTIAL_DEPTH: 2, // same as depth
  FUNDING: 7,
  REFERENCE_UPDATE: 8,
  HEARTBEAT: 9,
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical payload types  (Chapter 3.2 §10 — normalized fields)
// ─────────────────────────────────────────────────────────────────────────────

export interface TradePayload {
  tradeId: string
  price: number
  quantity: number
  side: 'BUY' | 'SELL' | 'UNKNOWN'
  isBuyerMaker: boolean
}

export interface TickerPayload {
  lastPrice: number
  priceChangePct: number
  volume: number
  quoteVolume: number
  highPrice: number
  lowPrice: number
}

export interface MiniTickerPayload {
  close: number
  open: number
  high: number
  low: number
  volume: number
  quoteVolume: number
}

export interface BookTickerPayload {
  bidPrice: number
  bidQuantity: number
  askPrice: number
  askQuantity: number
  spread: number
}

export interface DepthUpdatePayload {
  firstUpdateId: number
  lastUpdateId: number
  bids: Array<[price: number, quantity: number]>
  asks: Array<[price: number, quantity: number]>
}

export interface PartialDepthPayload {
  lastUpdateId: number
  bids: Array<[price: number, quantity: number]>
  asks: Array<[price: number, quantity: number]>
  depthLevels: number
}

export interface KlinePayload {
  startTime: number
  endTime: number
  interval: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume: number
  tradeCount: number
  isClosed: boolean
}

export interface FundingPayload {
  fundingRate: number
  nextFundingTime: number
  markPrice: number | null
}

export interface ReferenceUpdatePayload {
  field: string
  oldValue: unknown
  newValue: unknown
}

export interface HeartbeatPayload {
  serverTime: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Market Event  (Chapter 3.2 §10, §11, §14)
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalPayload =
  | TradePayload
  | TickerPayload
  | MiniTickerPayload
  | BookTickerPayload
  | DepthUpdatePayload
  | PartialDepthPayload
  | KlinePayload
  | FundingPayload
  | ReferenceUpdatePayload
  | HeartbeatPayload

/**
 * The canonical, immutable market event (§10, Rule 3, Rule 4).
 * Every downstream domain operates on this type only (Rule 7).
 * Exchange-specific formats never escape the pipeline (Rule 9).
 */
export interface CanonicalMarketEvent<P = CanonicalPayload> {
  /** Unique event ID (for dedup — §8). */
  eventId: string
  /** Canonical event type (§12). */
  eventType: CanonicalEventType
  /** Schema version of this event's payload (§11). */
  eventVersion: string
  /** Canonical symbol (e.g. "BTC/USDT"). */
  symbol: string
  /** Source exchange ID (e.g. "binance"). */
  sourceExchange: string

  // §6.1 — three timestamps per event
  /** Exchange-provided timestamp (ms epoch). */
  exchangeTimestamp: number
  /** Monotonic high-res timestamp when we received the raw message (§6.1). */
  receptionTimestamp: HighResolutionTimestamp
  /** Monotonic high-res timestamp when the pipeline processed it (§6.1). */
  pipelineTimestamp: HighResolutionTimestamp

  /** Sequence number from the exchange (for §7 sequence validation). */
  sequenceNumber: number | null
  /** The normalized payload (§10). */
  payload: Readonly<P>

  /** Provenance: live or replay (§18, §18.1). */
  provenance: 'LIVE' | 'STANDARD_REPLAY' | 'VALIDATED_REPLAY'
}

export const CANONICAL_EVENT_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline stage results  (Chapter 3.2 §3 — 10-stage data flow)
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'RAW_BUFFER'
  | 'SCHEMA_VALIDATION'
  | 'TIMESTAMP_VALIDATION'
  | 'SEQUENCE_VALIDATION'
  | 'DUPLICATE_DETECTION'
  | 'NORMALIZATION'
  | 'INTEGRITY_VERIFICATION'
  | 'PUBLICATION'

export interface PipelineStageResult<T> {
  stage: PipelineStage
  passed: boolean
  output?: T
  error?: string
  durationNs: bigint
}

export type FailureCategory =
  | 'SCHEMA_FAILURE'
  | 'SEQUENCE_FAILURE'
  | 'TIMESTAMP_FAILURE'
  | 'NORMALIZATION_FAILURE'
  | 'PUBLICATION_FAILURE'
  | 'DUPLICATE'
  | 'OUT_OF_ORDER'
  | 'INTEGRITY_FAILURE'

export interface PipelineFailure {
  category: FailureCategory
  message: string
  stage: PipelineStage
  rawPayload?: unknown
  at: HighResolutionTimestamp
}
