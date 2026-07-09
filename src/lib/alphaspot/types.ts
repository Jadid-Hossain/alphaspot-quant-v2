// AlphaSpot shared types — used by both the Next.js API routes and the socket.io mini-service

export type Symbol = 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT'

export type Timeframe = '15m' | '1h' | '4h'

export type TradeState = 'FLAT' | 'IN_TRADE' | 'RECOVERY_MODE'

export type SignalLabel =
  | 'STRONG_BUY'
  | 'BUY'
  | 'HOLD'
  | 'SELL'
  | 'STRONG_SELL'
  | 'RECOVERY_BUY'
  | 'TAKE_PROFIT'
  | 'EMERGENCY_EXIT'

export type TradeSide = 'BUY' | 'SELL'

export type TradeKind = 'INITIAL' | 'RECOVERY' | 'TAKE_PROFIT' | 'EMERGENCY_EXIT'

export interface Candle {
  time: number   // unix seconds (open time)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Indicators {
  rsi: number | null
  stochRsiK: number | null
  stochRsiD: number | null
  macd: number | null
  macdSignal: number | null
  macdHist: number | null
  ema50: number | null
  ema200: number | null
  bbUpper: number | null
  bbMiddle: number | null
  bbLower: number | null
  bbPercentB: number | null
  obv: number | null
  obvRising: boolean | null
  atr: number | null
}

export interface MultiTimeframeIndicators {
  '15m': Indicators
  '1h': Indicators
  '4h': Indicators
}

export interface PatternHit {
  name: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number // 0-100
  candleIndex: number
}

export interface Patterns {
  bullish: PatternHit[]
  bearish: PatternHit[]
  neutral: PatternHit[]
}

export interface SentimentData {
  fearGreed: number | null     // 0-100
  fearGreedLabel: string | null
  newsScore: number | null     // -1 to 1
  newsHeadlines: { title: string; score: number }[]
}

export interface OrderBookImbalance {
  bidVolume: number
  askVolume: number
  imbalance: number // (bid - ask) / (bid + ask), -1 to 1
}

export interface FundingData {
  fundingRate: number | null   // e.g. -0.0001
  openInterest: number | null
  nextFundingMs: number | null
}

export interface ConfluenceFactor {
  key: string
  label: string
  score: number     // contribution to total
  detail: string
}

export interface ConfluenceResult {
  score: number            // -100 to +100
  label: SignalLabel
  factors: ConfluenceFactor[]
}

export interface Position {
  state: TradeState
  symbol: Symbol
  avgEntryPrice: number | null
  quantity: number          // base asset qty (e.g. BTC)
  quoteValue: number        // USDT notional currently invested
  capitalUsedPct: number    // % of allocated capital deployed
  initialEntryPrice: number | null
  recoveryEntryPrice: number | null
  trades: number            // count of fills in this round
  openedAt: number | null   // ms timestamp
  lastPrice: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
}

export interface SymbolSnapshot {
  symbol: Symbol
  price: number
  change24hPct: number | null
  volume24h: number | null
  candles: Record<Timeframe, Candle[]>
  indicators: MultiTimeframeIndicators
  patterns: Patterns
  sentiment: SentimentData
  orderBook: OrderBookImbalance | null
  funding: FundingData | null
  confluence: ConfluenceResult
  position: Position
  updatedAt: number
}

export interface EngineState {
  enabled: boolean
  symbols: Symbol[]
  allocatedCapital: number
  config: {
    initialPct: number
    recoveryPct: number
    dropThresholdPct: number
    takeProfitPct: number
    strongBuyScore: number
    strongSellScore: number
  }
  snapshots: Record<Symbol, SymbolSnapshot | null>
  lastTickAt: number | null
}

// Socket.io event payloads (server -> client)
export interface ServerToClientEvents {
  snapshot: (snapshot: SymbolSnapshot) => void
  engine: (state: EngineState) => void
  log: (entry: { id: string; symbol: string; source: string; level: string; message: string; createdAt: string }) => void
  trade: (trade: {
    id: string
    symbol: string
    side: TradeSide
    kind: TradeKind
    price: number
    quantity: number
    quoteValue: number
    state: TradeState
    realizedPnl: number | null
    score: number
    reason: string
    createdAt: string
  }) => void
  status: (s: { ok: boolean; msg: string }) => void
}

// Socket.io event payloads (client -> server)
export interface ClientToServerEvents {
  subscribe: (symbols: Symbol[]) => void
  control: (cmd: { action: 'start' | 'stop' | 'reset'; symbol?: Symbol }) => void
}
