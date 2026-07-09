// CHAPTER 3.3 — Market State Cache
//
// The authoritative, low-latency, in-memory representation of current market
// state. All downstream analytical domains consume from this cache (Rule 1).
// No downstream domain consumes raw exchange messages (Rule 2).
//
// Updates occur ONLY through Canonical Market Events (Rule 3). Cache updates
// are atomic (Rule 4). Versions are monotonically increasing (Rule 5). Reads
// never mutate state (Rule 6). Writes are centrally controlled (Rule 7).
// Historical storage is separated from live state (Rule 8). Invalid state is
// never published (Rule 9). Every partition is independently recoverable (Rule 10).

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalMarketEvent, HighResolutionTimestamp } from '../market-data/canonical-event'
import { hrNow, hrDiffMs } from '../market-data/canonical-event'

const log = createLogger('market-state-cache')

// ─────────────────────────────────────────────────────────────────────────────
// Market State Object  (Chapter 3.3 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type MarketStatus = 'LIVE' | 'STALE' | 'INVALID' | 'RECOVERING' | 'DISCONNECTED'

export interface OrderBookSummary {
  bestBid: number | null
  bestAsk: number | null
  bidVolume: number | null
  askVolume: number | null
  imbalance: number | null // (bidVol - askVol) / (bidVol + askVol)
  lastUpdateId: number | null
}

export interface LastTrade {
  price: number
  quantity: number
  side: 'BUY' | 'SELL' | 'UNKNOWN'
  timestamp: number
  tradeId: string | null
}

/**
 * The immutable logical state of one asset (§5).
 * Each field is the authoritative value for that asset (§3 — single source of truth).
 */
export interface MarketState {
  readonly symbol: string
  readonly exchange: string
  readonly currentPrice: number | null
  readonly bestBid: number | null
  readonly bestAsk: number | null
  readonly midPrice: number | null
  readonly spread: number | null
  readonly spreadPct: number | null
  readonly lastTrade: LastTrade | null
  readonly volume24h: number | null
  readonly quoteVolume24h: number | null
  readonly high24h: number | null
  readonly low24h: number | null
  readonly priceChangePct24h: number | null
  readonly orderBook: OrderBookSummary
  readonly lastUpdateTimestamp: number // exchange timestamp
  readonly lastPipelineTimestamp: HighResolutionTimestamp
  readonly marketStatus: MarketStatus
  readonly sequenceNumber: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Snapshot  (Chapter 3.3 §9 — immutable, read-only)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketStateSnapshot {
  readonly symbol: string
  readonly version: number
  readonly timestamp: number
  readonly state: Readonly<MarketState>
  readonly sequence: number | null
  readonly valid: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Quality  (Chapter 3.3 §15)
// ─────────────────────────────────────────────────────────────────────────────

export interface CacheQuality {
  symbol: string
  synchronizationStatus: 'SYNCED' | 'SYNCING' | 'OUT_OF_SYNC' | 'UNKNOWN'
  updateLatencyMs: number | null
  eventAgeMs: number | null
  validity: 'VALID' | 'INVALID' | 'QUARANTINED' | 'RECOVERING'
  recoveryStatus: 'NONE' | 'PAUSED' | 'FETCHING_SNAPSHOT' | 'VALIDATING' | 'REPLACING' | 'RESUMED'
  healthScore: number // 0..1
  lastUpdateAt: number | null
  updateCount: number
  invalidationCount: number
  recoveryCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Partition  (Chapter 3.3 §4, §6, §7, §8)
// Each asset owns an isolated partition. Updates are atomic. Versions monotonic.
// ─────────────────────────────────────────────────────────────────────────────

export class CachePartition {
  private _state: MarketState
  private _version: number = 0
  private _quality: CacheQuality
  private _paused: boolean = false
  private _subscribers = new Set<(snapshot: MarketStateSnapshot) => void>()

  constructor(
    private readonly _symbol: string,
    private readonly _exchange: string,
  ) {
    this._state = this.emptyState()
    this._quality = {
      symbol: _symbol,
      synchronizationStatus: 'UNKNOWN',
      updateLatencyMs: null,
      eventAgeMs: null,
      validity: 'VALID',
      recoveryStatus: 'NONE',
      healthScore: 0,
      lastUpdateAt: null,
      updateCount: 0,
      invalidationCount: 0,
      recoveryCount: 0,
    }
  }

  /**
   * Apply a Canonical Market Event atomically (§6, §7, Rule 3, Rule 4).
   * Consumers observe either the previous state or the fully updated state.
   * Every successful update produces a new version (§6, Rule 5).
   */
  applyEvent(event: CanonicalMarketEvent): MarketStateSnapshot | null {
    // §13 — don't update if partition is paused (during recovery) or invalid
    if (this._paused) {
      log.debug(`${this._symbol} partition paused — skipping update`)
      return null
    }
    if (this._quality.validity === 'INVALID' || this._quality.validity === 'QUARANTINED') {
      log.debug(`${this._symbol} partition invalid — skipping update`)
      return null
    }

    const pipelineStart = hrNow()
    const newState = this.mergeEventIntoState(this._state, event)

    // §7 — Atomic update: build the full new state, then swap atomically
    this._state = newState
    this._version++ // §8 — monotonic version increment
    this._quality.updateCount++
    this._quality.lastUpdateAt = Date.now()
    this._quality.synchronizationStatus = 'SYNCED'
    this._quality.validity = 'VALID'

    const latencyMs = hrDiffMs(pipelineStart, hrNow())
    this._quality.updateLatencyMs = latencyMs
    this._quality.eventAgeMs = Date.now() - event.exchangeTimestamp
    this._quality.healthScore = this.computeHealthScore()

    const snapshot = this.snapshot()
    this._notifySubscribers(snapshot)
    return snapshot
  }

  /** Merge a canonical event into the state (returns a new immutable state — §7 atomicity). */
  private mergeEventIntoState(current: MarketState, event: CanonicalMarketEvent): MarketState {
    const p = event.payload as Record<string, unknown>
    let next: MarketState = { ...current }

    switch (event.eventType) {
      case 'TRADE':
        next = {
          ...next,
          currentPrice: Number(p.price ?? current.currentPrice),
          lastTrade: {
            price: Number(p.price),
            quantity: Number(p.quantity),
            side: (p.side as 'BUY' | 'SELL' | 'UNKNOWN') ?? 'UNKNOWN',
            timestamp: event.exchangeTimestamp,
            tradeId: String(p.tradeId ?? ''),
          },
          lastUpdateTimestamp: event.exchangeTimestamp,
          lastPipelineTimestamp: event.pipelineTimestamp,
          sequenceNumber: event.sequenceNumber ?? current.sequenceNumber,
        }
        break
      case 'TICKER':
        next = {
          ...next,
          currentPrice: Number(p.lastPrice ?? current.currentPrice),
          volume24h: Number(p.volume ?? current.volume24h),
          quoteVolume24h: Number(p.quoteVolume ?? current.quoteVolume24h),
          high24h: Number(p.highPrice ?? current.high24h),
          low24h: Number(p.lowPrice ?? current.low24h),
          priceChangePct24h: Number(p.priceChangePct ?? current.priceChangePct24h),
          lastUpdateTimestamp: event.exchangeTimestamp,
          lastPipelineTimestamp: event.pipelineTimestamp,
        }
        break
      case 'MINI_TICKER':
        next = {
          ...next,
          currentPrice: Number(p.close ?? current.currentPrice),
          volume24h: Number(p.volume ?? current.volume24h),
          quoteVolume24h: Number(p.quoteVolume ?? current.quoteVolume24h),
          high24h: Number(p.high ?? current.high24h),
          low24h: Number(p.low ?? current.low24h),
          lastUpdateTimestamp: event.exchangeTimestamp,
          lastPipelineTimestamp: event.pipelineTimestamp,
        }
        break
      case 'BOOK_TICKER': {
        const bid = Number(p.bidPrice)
        const ask = Number(p.askPrice)
        next = {
          ...next,
          bestBid: bid,
          bestAsk: ask,
          midPrice: (bid + ask) / 2,
          spread: ask - bid,
          spreadPct: bid > 0 ? ((ask - bid) / bid) * 100 : null,
          orderBook: {
            ...next.orderBook,
            bestBid: bid,
            bestAsk: ask,
            bidVolume: Number(p.bidQuantity) || next.orderBook.bidVolume,
            askVolume: Number(p.askQuantity) || next.orderBook.askVolume,
          },
          lastUpdateTimestamp: event.exchangeTimestamp,
          lastPipelineTimestamp: event.pipelineTimestamp,
        }
        break
      }
      case 'DEPTH_UPDATE': {
        const bids = (p.bids ?? []) as Array<[number, number]>
        const asks = (p.asks ?? []) as Array<[number, number]>
        const bestBid = bids.length > 0 ? bids[0][0] : current.orderBook.bestBid
        const bestAsk = asks.length > 0 ? asks[0][0] : current.orderBook.bestAsk
        const bidVol = bids.reduce((a, b) => a + b[1], 0)
        const askVol = asks.reduce((a, b) => a + b[1], 0)
        next = {
          ...next,
          bestBid: bestBid ?? current.bestBid,
          bestAsk: bestAsk ?? current.bestAsk,
          midPrice: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : current.midPrice,
          spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : current.spread,
          orderBook: {
            bestBid,
            bestAsk,
            bidVolume: bidVol,
            askVolume: askVol,
            imbalance: bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : null,
            lastUpdateId: Number(p.lastUpdateId ?? current.orderBook.lastUpdateId),
          },
          lastUpdateTimestamp: event.exchangeTimestamp,
          lastPipelineTimestamp: event.pipelineTimestamp,
          sequenceNumber: event.sequenceNumber ?? current.sequenceNumber,
        }
        break
      }
      case 'KLINE':
        // Kline updates the current price (close) but doesn't override best bid/ask
        next = {
          ...next,
          currentPrice: Number(p.close ?? current.currentPrice),
          lastUpdateTimestamp: event.exchangeTimestamp,
          lastPipelineTimestamp: event.pipelineTimestamp,
        }
        break
      default:
        // Other event types don't update market state
        break
    }

    // Recalculate mid/spread if bid/ask changed
    if (next.bestBid != null && next.bestAsk != null) {
      next = {
        ...next,
        midPrice: (next.bestBid + next.bestAsk) / 2,
        spread: next.bestAsk - next.bestBid,
        spreadPct: next.bestBid > 0 ? ((next.bestAsk - next.bestBid) / next.bestBid) * 100 : null,
      }
    }

    return Object.freeze(next) // §5 — immutable logical state
  }

  /** Generate an immutable snapshot (§9). */
  snapshot(): MarketStateSnapshot {
    return Object.freeze({
      symbol: this._symbol,
      version: this._version,
      timestamp: Date.now(),
      state: this._state,
      sequence: this._state.sequenceNumber,
      valid: this._quality.validity === 'VALID',
    })
  }

  /** Read the current state (§11 — reads never mutate, multiple concurrent readers). */
  getState(): Readonly<MarketState> {
    return this._state
  }

  /** Read the current version (§8). */
  getVersion(): number {
    return this._version
  }

  /** Read cache quality (§15). */
  getQuality(): CacheQuality {
    return { ...this._quality }
  }

  /** Invalidate the partition (§13 — quarantine). */
  invalidate(reason: string): void {
    this._quality.validity = 'QUARANTINED'
    this._quality.invalidationCount++
    this._quality.healthScore = 0
    log.warn(`partition ${this._symbol} INVALIDATED: ${reason}`)
  }

  /** Pause updates (§14 — recovery step 1). */
  pauseUpdates(): void {
    this._paused = true
    this._quality.recoveryStatus = 'PAUSED'
    log.info(`partition ${this._symbol} updates PAUSED (recovery)`)
  }

  /** Resume updates (§14 — recovery step 5). */
  resumeUpdates(): void {
    this._paused = false
    this._quality.recoveryStatus = 'RESUMED'
    this._quality.validity = 'VALID'
    this._quality.synchronizationStatus = 'SYNCED'
    this._quality.healthScore = this.computeHealthScore()
    log.info(`partition ${this._symbol} updates RESUMED (recovery complete)`)
  }

  /** Replace the entire cache state (§14 — recovery step 4: Replace Cache). */
  replaceState(newState: MarketState, newSequence: number | null): void {
    this._state = Object.freeze({ ...newState, sequenceNumber: newSequence })
    this._version++
    this._quality.recoveryStatus = 'REPLACING'
    log.info(`partition ${this._symbol} state REPLACED (recovery)`)
  }

  /** Subscribe to state updates (§9 — snapshot publication). */
  subscribe(handler: (snapshot: MarketStateSnapshot) => void): () => void {
    this._subscribers.add(handler)
    return () => this._subscribers.delete(handler)
  }

  private _notifySubscribers(snapshot: MarketStateSnapshot): void {
    for (const sub of this._subscribers) {
      try {
        sub(snapshot)
      } catch (e) {
        // §18 — subscriber failure isolated
        log.error(`subscriber failed for ${this._symbol}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  /** Compute the health score (§15) — 0..1 based on freshness + validity. */
  private computeHealthScore(): number {
    if (this._quality.validity !== 'VALID') return 0
    if (!this._quality.lastUpdateAt) return 0
    const ageMs = Date.now() - this._quality.lastUpdateAt
    // Fresh (< 1s) = 1.0, stale (> 30s) = 0.0
    if (ageMs < 1000) return 1.0
    if (ageMs > 30_000) return 0.0
    return 1.0 - ageMs / 30_000
  }

  private emptyState(): MarketState {
    return Object.freeze({
      symbol: this._symbol,
      exchange: this._exchange,
      currentPrice: null,
      bestBid: null,
      bestAsk: null,
      midPrice: null,
      spread: null,
      spreadPct: null,
      lastTrade: null,
      volume24h: null,
      quoteVolume24h: null,
      high24h: null,
      low24h: null,
      priceChangePct24h: null,
      orderBook: {
        bestBid: null,
        bestAsk: null,
        bidVolume: null,
        askVolume: null,
        imbalance: null,
        lastUpdateId: null,
      },
      lastUpdateTimestamp: 0,
      lastPipelineTimestamp: hrNow(),
      marketStatus: 'DISCONNECTED',
      sequenceNumber: null,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Market State Cache  (Chapter 3.3 §3, §4 — single source of truth, partitioned)
// ─────────────────────────────────────────────────────────────────────────────

class MarketStateCache {
  private partitions = new Map<string, CachePartition>()
  private subscribers = new Set<(symbol: string, snapshot: MarketStateSnapshot) => void>()
  private stats = {
    totalUpdates: 0,
    totalReads: 0,
    totalInvalidations: 0,
    totalRecoveries: 0,
    partitionCount: 0,
  }

  /** Get or create a partition for an asset (§4 — isolated per asset). */
  getPartition(symbol: string, exchange = 'binance'): CachePartition {
    let partition = this.partitions.get(symbol)
    if (!partition) {
      partition = new CachePartition(symbol, exchange)
      this.partitions.set(symbol, partition)
      this.stats.partitionCount = this.partitions.size
      log.debug(`partition created for ${symbol}`)
    }
    return partition
  }

  /**
   * Apply a Canonical Market Event to the appropriate partition (§6, Rule 3).
   * This is the ONLY way cache state is updated (Rule 7 — centrally controlled).
   */
  applyEvent(event: CanonicalMarketEvent): MarketStateSnapshot | null {
    const partition = this.getPartition(event.symbol, event.sourceExchange)
    const snapshot = partition.applyEvent(event)
    if (snapshot) {
      this.stats.totalUpdates++
      for (const sub of this.subscribers) sub(event.symbol, snapshot)
    }
    return snapshot
  }

  /** Read the current state for an asset (§11 — reads never mutate). */
  getState(symbol: string): Readonly<MarketState> | null {
    this.stats.totalReads++
    return this.partitions.get(symbol)?.getState() ?? null
  }

  /** Read a specific field (§3 — single source of truth). */
  getCurrentPrice(symbol: string): number | null {
    return this.getState(symbol)?.currentPrice ?? null
  }

  getBestBid(symbol: string): number | null {
    return this.getState(symbol)?.bestBid ?? null
  }

  getBestAsk(symbol: string): number | null {
    return this.getState(symbol)?.bestAsk ?? null
  }

  getVolume24h(symbol: string): number | null {
    return this.getState(symbol)?.volume24h ?? null
  }

  /** Generate a snapshot for an asset (§9 — immutable, read-only). */
  snapshot(symbol: string): MarketStateSnapshot | null {
    return this.partitions.get(symbol)?.snapshot() ?? null
  }

  /** Get quality metrics for a partition (§15). */
  getQuality(symbol: string): CacheQuality | null {
    return this.partitions.get(symbol)?.getQuality() ?? null
  }

  /** Get quality for all partitions (§15, §17). */
  getAllQuality(): CacheQuality[] {
    return Array.from(this.partitions.values()).map((p) => p.getQuality())
  }

  /** Invalidate a partition (§13 — quarantine). */
  invalidate(symbol: string, reason: string): void {
    const partition = this.partitions.get(symbol)
    if (partition) {
      partition.invalidate(reason)
      this.stats.totalInvalidations++
    }
  }

  /**
   * Recover a partition (§14 — 5-stage recovery):
   * Pause Updates → Acquire Authoritative Snapshot → Validate → Replace Cache → Resume
   */
  async recover(
    symbol: string,
    fetchAuthoritativeSnapshot: () => Promise<MarketState>,
    validate: (state: MarketState) => boolean,
  ): Promise<boolean> {
    const partition = this.partitions.get(symbol)
    if (!partition) return false

    this.stats.totalRecoveries++
    log.info(`recovery initiated for ${symbol} (§14 5-stage)`)

    // Stage 1: Pause Updates
    partition.pauseUpdates()

    try {
      // Stage 2: Acquire Authoritative Snapshot
      const authoritative = await fetchAuthoritativeSnapshot()

      // Stage 3: Validate
      if (!validate(authoritative)) {
        log.error(`recovery validation FAILED for ${symbol} — staying invalid`)
        partition.invalidate('recovery validation failed')
        return false
      }

      // Stage 4: Replace Cache
      partition.replaceState(authoritative, authoritative.sequenceNumber)

      // Stage 5: Resume Publication
      partition.resumeUpdates()
      log.info(`recovery COMPLETE for ${symbol}`)
      return true
    } catch (e) {
      log.error(`recovery ERROR for ${symbol}: ${e instanceof Error ? e.message : String(e)}`)
      partition.invalidate(`recovery error: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  /** Subscribe to all partition updates (§9). */
  subscribe(handler: (symbol: string, snapshot: MarketStateSnapshot) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** List all tracked symbols. */
  getTrackedSymbols(): string[] {
    return Array.from(this.partitions.keys())
  }

  /** Get observability stats (§17). */
  getStats() {
    const qualities = this.getAllQuality()
    return {
      ...this.stats,
      avgHealthScore: qualities.length > 0 ? qualities.reduce((a, q) => a + q.healthScore, 0) / qualities.length : 0,
      validPartitions: qualities.filter((q) => q.validity === 'VALID').length,
      invalidPartitions: qualities.filter((q) => q.validity !== 'VALID').length,
      recoveringPartitions: qualities.filter((q) => q.recoveryStatus !== 'NONE' && q.recoveryStatus !== 'RESUMED').length,
    }
  }

  /** Remove a partition (for memory management — §16 bounded). */
  evict(symbol: string): boolean {
    const deleted = this.partitions.delete(symbol)
    if (deleted) this.stats.partitionCount = this.partitions.size
    return deleted
  }
}

export const marketStateCache = new MarketStateCache()
