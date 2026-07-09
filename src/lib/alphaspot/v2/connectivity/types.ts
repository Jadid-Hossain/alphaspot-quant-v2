// CHAPTER 3.1 — Exchange Connectivity Layer: Types & Contracts
//
// Shared types for the Exchange Connectivity Layer (Domain 03 — Market Gateway).
// This layer performs NO analytics (Rule 1). Business domains never communicate
// directly with exchanges (Rule 2). Every exchange implements the same interface
// (Rule 3). The Connectivity Layer owns all exchange communication (Rule 8).

// ─────────────────────────────────────────────────────────────────────────────
// Connection categories  (Chapter 3.1 §3)
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionCategory = 'A_STREAMING' | 'B_SNAPSHOT' | 'C_REFERENCE' | 'D_OPERATIONAL'

export interface ConnectionCategoryDescriptor {
  category: ConnectionCategory
  purpose: string
  examples: string[]
}

export const CONNECTION_CATEGORIES: ConnectionCategoryDescriptor[] = [
  { category: 'A_STREAMING', purpose: 'Realtime updates', examples: ['Trades', 'Ticker', 'MiniTicker', 'BookTicker', 'Depth', 'Kline'] },
  { category: 'B_SNAPSHOT', purpose: 'State synchronization', examples: ['Order Book Snapshot', 'Historical Candles', 'Exchange Information'] },
  { category: 'C_REFERENCE', purpose: 'Static metadata', examples: ['Trading Rules', 'Precision', 'Filters', 'Lot Sizes', 'Tick Sizes'] },
  { category: 'D_OPERATIONAL', purpose: 'Connectivity monitoring', examples: ['Ping', 'Server Time', 'System Status'] },
]

// ─────────────────────────────────────────────────────────────────────────────
// Connection lifecycle  (Chapter 3.1 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionState =
  | 'INITIALIZING'
  | 'AUTHENTICATING'
  | 'CONNECTING'
  | 'SUBSCRIBING'
  | 'SYNCHRONIZING'
  | 'LIVE'
  | 'RECONNECTING'
  | 'FAILED'

/** Allowed forward transitions (§5 — monotonic). */
const ALLOWED_CONNECTION_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  INITIALIZING: ['AUTHENTICATING', 'CONNECTING', 'FAILED'],
  AUTHENTICATING: ['CONNECTING', 'FAILED'],
  CONNECTING: ['SUBSCRIBING', 'FAILED'],
  SUBSCRIBING: ['SYNCHRONIZING', 'FAILED'],
  SYNCHRONIZING: ['LIVE', 'FAILED'],
  LIVE: ['RECONNECTING', 'FAILED'],
  RECONNECTING: ['CONNECTING', 'LIVE', 'FAILED'],
  FAILED: ['INITIALIZING'], // allow re-initialization for manual recovery
}

export function canTransitionConnectionState(from: ConnectionState, to: ConnectionState): boolean {
  return ALLOWED_CONNECTION_TRANSITIONS[from].includes(to)
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription types  (Chapter 3.1 §6)
// ─────────────────────────────────────────────────────────────────────────────

export type StreamType = 'trade' | 'ticker' | 'miniTicker' | 'bookTicker' | 'depth' | 'kline' | 'aggTrade'

export interface Subscription {
  subscriptionId: string
  exchangeId: string
  stream: string // e.g. "btcusdt@kline_15m"
  streamType: StreamType
  symbol: string // canonical "BTC/USDT"
  category: ConnectionCategory
  priority: number // lower = higher priority
  createdAt: number
  shardId: string | null // assigned by the connection pool
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw market events  (output of the connectivity layer)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawMarketEvent {
  exchangeId: string
  stream: string
  streamType: StreamType
  symbol: string
  timestamp: number // exchange server time (§9 — authoritative)
  localReceivedAt: number
  payload: unknown
  // Sequence IDs for gap detection (§12)
  firstUpdateId: number | null // U in Binance
  lastUpdateId: number | null // u in Binance
  sequenceNumber: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector capabilities  (Chapter 3.1 §4 — capability discovery)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeCapabilities {
  exchangeId: string
  supportsStreaming: boolean
  supportsSnapshots: boolean
  supportsReference: boolean
  supportsOperational: boolean
  maxStreamsPerConnection: number
  rateLimits: RateLimitDescriptor[]
  supportedStreamTypes: StreamType[]
  requiresAuth: boolean
  hasUpdateIds: boolean // whether payloads include u/U for jitter buffer (§12)
}

export interface RateLimitDescriptor {
  type: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS' | 'WEBSOCKET_CONNECTIONS' | 'WEBSOCKET_MESSAGES'
  interval: 'MINUTE' | 'SECOND' | 'DAY'
  intervalNum: number
  limit: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Heartbeat / health  (Chapter 3.1 §8, §15)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorHealth {
  exchangeId: string
  connectionId: string
  state: ConnectionState
  lastMessageAt: number | null
  heartbeatLatencyMs: number | null
  synchronizationStatus: 'SYNCED' | 'SYNCING' | 'OUT_OF_SYNC' | 'UNKNOWN'
  reconnectCount: number
  errorState: string | null
  uptime: number // ms since first LIVE
  bandwidthBytesPerSec: number
  droppedMessages: number
  isHealthy: boolean
  checkedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Data gap detection  (Chapter 3.1 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataGap {
  gapId: string
  exchangeId: string
  stream: string
  symbol: string
  expectedUpdateId: number
  receivedUpdateId: number | null
  detectedAt: number
  recoveredAt: number | null
  recoveryMethod: 'JITTER_BUFFER' | 'SNAPSHOT_RESYNC' | 'NONE' | null
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnection policy stages  (Chapter 3.1 §11)
// ─────────────────────────────────────────────────────────────────────────────

export type ReconnectionStage =
  | 'DETECT'
  | 'PAUSE_PUBLISHING'
  | 'RECONNECT'
  | 'SNAPSHOT_SYNCHRONIZATION'
  | 'GAP_DETECTION'
  | 'GAP_RECOVERY'
  | 'RESUME_PUBLISHING'
