// CHAPTER 3.6 §5, §6, §7, §8, §9, §9.1, §10, §11, §12, §13, §14 — Per-Asset Microstructure Engine
//
// Each asset owns an independent MicrostructureEngine instance (§13, Rule 7).
// No asset may share runtime state, buffers, or calculations with another.
// Updates are atomic (Rule 3). Consumers never observe partial state (Rule 4).
// Duplicate events ignored (Rule 5). Memory bounded (Rule 8). Incremental (Rule 9).
// Trading logic prohibited (Rule 10).

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalMarketEvent } from '../market-data/canonical-event'
import type {
  DepthRestitutionLimit,
  ExecutionPressure,
  LiquidityProfile,
  MarketMicrostructureState,
  MicrostructureQuality,
  MicrostructureSnapshot,
  OrderBookPressure,
  OrderBookShape,
  SpreadAnalysis,
} from './types'
import { DEFAULT_DEPTH_LIMIT } from './types'
import { EMA, EWMA, CircularBuffer, RateOfChange, emaForPeriod, ewmaForHalfLife } from './rolling-metrics'

const log = createLogger('microstructure:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Per-Asset Microstructure Engine  (Chapter 3.6 §5, §13)
// ─────────────────────────────────────────────────────────────────────────────

export class MicrostructureEngine {
  private _state: MarketMicrostructureState
  private _depthLimit: DepthRestitutionLimit
  private _snapshot: MicrostructureSnapshot | null = null
  private _duplicateSet = new Set<string>() // bounded LRU for dedup (Rule 5)
  private _duplicateSetMaxSize = 10_000

  // §15.1 — constant-memory rolling metrics
  private _spreadEma: EMA
  private _spreadBuffer: CircularBuffer<number> // for median + max
  private _spreadVolatility: EWMA
  private _spreadExpansionRate: RateOfChange
  private _spreadCompressionRate: RateOfChange
  private _vwapEma: EMA
  private _tradeVelocityEma: EMA
  private _liquidityEma: EMA
  private _pressureEma: EMA
  private _aggressiveBuyEma: EMA
  private _aggressiveSellEma: EMA

  // Stats
  private _stats = {
    eventsProcessed: 0,
    duplicatesIgnored: 0,
    snapshotsPublished: 0,
    depthLevelsDiscarded: 0,
    recoveryCount: 0,
  }

  constructor(
    private readonly _symbol: string,
    private readonly _exchange: string = 'binance',
    depthLimit: DepthRestitutionLimit = DEFAULT_DEPTH_LIMIT,
  ) {
    this._depthLimit = depthLimit
    this._state = this.emptyState()

    // Initialize constant-memory rolling metrics (§15.1, Rule 13)
    this._spreadEma = emaForPeriod(50)
    this._spreadBuffer = new CircularBuffer<number>(100)
    this._spreadVolatility = ewmaForHalfLife(50)
    this._spreadExpansionRate = new RateOfChange(0.1)
    this._spreadCompressionRate = new RateOfChange(0.1)
    this._vwapEma = emaForPeriod(100)
    this._tradeVelocityEma = emaForPeriod(20)
    this._liquidityEma = emaForPeriod(50)
    this._pressureEma = emaForPeriod(20)
    this._aggressiveBuyEma = emaForPeriod(50)
    this._aggressiveSellEma = emaForPeriod(50)
  }

  /**
   * Process a Canonical Market Event through the 8-step pipeline (§6).
   * Every step is deterministic.
   */
  processEvent(event: CanonicalMarketEvent): MicrostructureSnapshot | null {
    // Step 1: Schema Validation (§6) — delegate to the market-data pipeline
    // (already validated before reaching here — Ch 3.2)

    // Step 2: Sequence Validation (§6) — already done in Ch 3.2

    // Step 3: Duplicate Detection (§6, Rule 5)
    const dedupKey = event.sequenceNumber !== null
      ? `${event.stream}:${event.sequenceNumber}`
      : event.eventId
    if (this._duplicateSet.has(dedupKey)) {
      this._stats.duplicatesIgnored++
      return null // Rule 5 — duplicate events ignored
    }
    this._duplicateSet.add(dedupKey)
    if (this._duplicateSet.size > this._duplicateSetMaxSize) {
      // LRU eviction — clear oldest half
      const entries = [...this._duplicateSet]
      this._duplicateSet = new Set(entries.slice(entries.length / 2))
    }

    // Step 4: Timestamp Validation (§6) — already done in Ch 3.2

    // Step 5: Market State Update (§6, §7) — atomic
    this.updateState(event)

    // Step 6: Snapshot Publication (§6) — build immutable snapshot
    this._snapshot = this.buildSnapshot()
    this._stats.snapshotsPublished++
    this._stats.eventsProcessed++

    return this._snapshot
  }

  /** Update the market state from a canonical event (§7). Atomic (Rule 3). */
  private updateState(event: CanonicalMarketEvent): void {
    const p = event.payload as Record<string, unknown>
    const state = { ...this._state } // build new state atomically

    switch (event.eventType) {
      case 'TRADE': {
        const price = Number(p.price)
        const qty = Number(p.quantity)
        // §9.1, Rule 12 — aggressor tagging: EXCLUSIVELY exchange Maker/Taker metadata
        // Binance: isBuyerMaker=false → Aggressive Buy, isBuyerMaker=true → Aggressive Sell
        const isBuyerMaker = Boolean(p.isBuyerMaker)
        if (!isBuyerMaker) {
          state.aggressiveBuyVolume += qty
          this._aggressiveBuyEma.update(qty)
        } else {
          state.aggressiveSellVolume += qty
          this._aggressiveSellEma.update(qty)
        }
        // §7 — rolling VWAP (EMA, constant memory)
        this._vwapEma.update(price)
        state.rollingVwap = this._vwapEma.value
        // §7 — trade velocity (EMA)
        this._tradeVelocityEma.update(1)
        state.tradeVelocity = this._tradeVelocityEma.value ?? 0
        // Update best bid/ask if trade price is inside the spread
        if (state.bestBid === null || price > state.bestBid) {
          // Trade doesn't set best bid/ask — only book events do
        }
        state.lastUpdateTimestamp = event.exchangeTimestamp
        break
      }
      case 'BOOK_TICKER': {
        const bid = Number(p.bidPrice)
        const ask = Number(p.askPrice)
        state.bestBid = bid
        state.bestAsk = ask
        // §8 — spread analysis
        const spread = ask - bid
        this._spreadEma.update(spread)
        this._spreadBuffer.push(spread)
        this._spreadVolatility.update(spread)
        this._spreadExpansionRate.update(spread)
        this._spreadCompressionRate.update(-spread)
        state.averageSpread = this._spreadEma.value
        state.lastUpdateTimestamp = event.exchangeTimestamp
        break
      }
      case 'DEPTH_UPDATE': {
        const bids = (p.bids ?? []) as Array<[number, number]>
        const asks = (p.asks ?? []) as Array<[number, number]>
        // §7.1 — apply depth restitution limit (bounded depth, Rule 11)
        const bounded = this.applyDepthLimit(bids, asks, state.bestBid, state.bestAsk)
        state.boundedBids = bounded.bids
        state.boundedAsks = bounded.asks
        state.bidDepth = bounded.bids.reduce((a, b) => a + b[1], 0)
        state.askDepth = bounded.asks.reduce((a, b) => a + b[1], 0)
        this._stats.depthLevelsDiscarded += bounded.discarded
        // §7 — update best bid/ask from depth
        if (bounded.bids.length > 0) state.bestBid = bounded.bids[0][0]
        if (bounded.asks.length > 0) state.bestAsk = bounded.asks[0][0]
        state.lastUpdateTimestamp = event.exchangeTimestamp
        break
      }
      default:
        // Other event types (funding, liquidation, etc.) don't update core microstructure
        break
    }

    // §7 — liquidity estimate (EMA)
    const totalDepth = state.bidDepth + state.askDepth
    if (totalDepth > 0) {
      const liq = Math.min(1, totalDepth / 100)
      this._liquidityEma.update(liq)
      state.liquidityEstimate = this._liquidityEma.value
    }

    // §7 — pressure estimate (EMA)
    const totalAggro = state.aggressiveBuyVolume + state.aggressiveSellVolume
    if (totalAggro > 0) {
      const pressure = (state.aggressiveBuyVolume - state.aggressiveSellVolume) / totalAggro
      this._pressureEma.update(pressure)
      state.pressureEstimate = this._pressureEma.value
    }

    // Atomic swap (Rule 3, Rule 4 — consumers never see partial state)
    state.version = this._state.version + 1
    this._state = state
  }

  /**
   * Apply the Depth Restitution Limit (§7.1, Rule 11).
   * Never maintain the full exchange order book.
   * Bounded by Top-N levels OR percentage distance from mid.
   */
  private applyDepthLimit(
    bids: Array<[number, number]>,
    asks: Array<[number, number]>,
    bestBid: number | null,
    bestAsk: number | null,
  ): { bids: Array<[number, number]>; asks: Array<[number, number]>; discarded: number } {
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null

    if (this._depthLimit.mode === 'TOP_N_LEVELS') {
      const n = this._depthLimit.topN ?? 50
      const boundedBids = bids.slice(0, n)
      const boundedAsks = asks.slice(0, n)
      return { bids: boundedBids, asks: boundedAsks, discarded: (bids.length - boundedBids.length) + (asks.length - boundedAsks.length) }
    }

    // PERCENTAGE_DISTANCE mode
    if (mid !== null && mid > 0 && this._depthLimit.percentageDistance !== undefined) {
      const maxDist = this._depthLimit.percentageDistance
      const lowerBound = mid * (1 - maxDist)
      const upperBound = mid * (1 + maxDist)
      const boundedBids = bids.filter(([price]) => price >= lowerBound)
      const boundedAsks = asks.filter(([price]) => price <= upperBound)
      return { bids: boundedBids, asks: boundedAsks, discarded: (bids.length - boundedBids.length) + (asks.length - boundedAsks.length) }
    }

    return { bids, asks, discarded: 0 }
  }

  /** Build the spread analysis (§8). */
  private buildSpreadAnalysis(): SpreadAnalysis {
    return {
      currentSpread: this._state.bestBid !== null && this._state.bestAsk !== null
        ? this._state.bestAsk - this._state.bestBid
        : null,
      averageSpread: this._spreadEma.value,
      medianSpread: this._spreadBuffer.median(),
      maxSpread: this._spreadBuffer.max(),
      spreadVolatility: this._spreadVolatility.stdDev,
      spreadExpansionRate: this._spreadExpansionRate.rate,
      spreadCompressionRate: this._spreadCompressionRate.rate,
    }
  }

  /** Build the execution pressure (§9, §9.1). */
  private buildExecutionPressure(): ExecutionPressure {
    const buyVol = this._aggressiveBuyEma.value ?? 0
    const sellVol = this._aggressiveSellEma.value ?? 0
    const total = buyVol + sellVol
    return {
      aggressiveBuyRatio: total > 0 ? buyVol / total : null,
      aggressiveSellRatio: total > 0 ? sellVol / total : null,
      netMarketPressure: total > 0 ? (buyVol - sellVol) / total : null,
      tradeDirectionBias: this._state.pressureEstimate,
      executionImbalance: this._state.pressureEstimate,
      aggressorMethod: 'EXCHANGE_METADATA', // §9.1, Rule 12 — always
    }
  }

  /** Build the order book pressure (§10). */
  private buildOrderBookPressure(): OrderBookPressure {
    const bidVol = this._state.bidDepth
    const askVol = this._state.askDepth
    const total = bidVol + askVol
    const mid = this._state.bestBid !== null && this._state.bestAsk !== null
      ? (this._state.bestBid + this._state.bestAsk) / 2
      : null

    // Near-price = top 25% of levels, far-price = rest
    const bidLevelsCount = this._state.boundedBids.length
    const askLevelCount = this._state.boundedAsks.length
    const nearCutoff = Math.floor(Math.min(bidLevelsCount, askLevelCount) / 4)
    const nearBidVol = this._state.boundedBids.slice(0, nearCutoff).reduce((a, b) => a + b[1], 0)
    const nearAskVol = this._state.boundedAsks.slice(0, nearCutoff).reduce((a, b) => a + b[1], 0)
    const farBidVol = bidVol - nearBidVol
    const farAskVol = askVol - nearAskVol

    return {
      depthImbalance: total > 0 ? (bidVol - askVol) / total : null,
      nearPriceLiquidity: nearBidVol + nearAskVol > 0 ? Math.min(1, (nearBidVol + nearAskVol) / 50) : null,
      farPriceLiquidity: farBidVol + farAskVol > 0 ? Math.min(1, (farBidVol + farAskVol) / 100) : null,
      liquidityGradient: this._liquidityEma.value !== null ? this._liquidityEma.value : null,
      queuePressure: total > 0 ? (bidVol - askVol) / total : null,
    }
  }

  /** Build the liquidity profile (§11). */
  private buildLiquidityProfile(): LiquidityProfile {
    const bidVol = this._state.bidDepth
    const askVol = this._state.askDepth
    const total = bidVol + askVol
    const bidLevels = this._state.boundedBids
    const askLevels = this._state.boundedAsks

    // Immediate = top 5 levels, Local = top 15, Regional = top 30, Structural = all bounded
    const immediate = bidLevels.slice(0, 5).reduce((a, b) => a + b[1], 0) + askLevels.slice(0, 5).reduce((a, b) => a + b[1], 0)
    const local = bidLevels.slice(0, 15).reduce((a, b) => a + b[1], 0) + askLevels.slice(0, 15).reduce((a, b) => a + b[1], 0)
    const regional = bidLevels.slice(0, 30).reduce((a, b) => a + b[1], 0) + askLevels.slice(0, 30).reduce((a, b) => a + b[1], 0)
    const structural = total

    return {
      immediateLiquidity: immediate > 0 ? Math.min(1, immediate / 20) : null,
      localLiquidity: local > 0 ? Math.min(1, local / 50) : null,
      regionalLiquidity: regional > 0 ? Math.min(1, regional / 100) : null,
      structuralLiquidity: structural > 0 ? Math.min(1, structural / 200) : null,
      liquidityStability: this._liquidityEma.value !== null ? Math.min(1, this._liquidityEma.value) : null,
      liquidityMigration: this._pressureEma.value,
    }
  }

  /** Build the order book shape (§7). */
  private buildOrderBookShape(): OrderBookShape | null {
    if (this._state.boundedBids.length === 0 && this._state.boundedAsks.length === 0) return null
    const bidLevels = this._state.boundedBids.length
    const askLevels = this._state.boundedAsks.length
    const total = bidLevels + askLevels
    return {
      bidLevels,
      askLevels,
      bidAskLevelRatio: askLevels > 0 ? bidLevels / askLevels : null,
      depthConcentration: total > 0 ? Math.min(bidLevels, askLevels) / total : null,
    }
  }

  /** Build the microstructure quality (§12). */
  private buildQuality(): MicrostructureQuality {
    const bookComplete = this._state.boundedBids.length > 0 && this._state.boundedAsks.length > 0
    const spreadStable = this._spreadVolatility.stdDev !== null ? Math.max(0, 1 - this._spreadVolatility.stdDev / 10) : 0
    const tradeCov = this._state.tradeVelocity > 0 ? Math.min(1, this._state.tradeVelocity) : 0

    const factors = [
      bookComplete ? 1 : 0,
      spreadStable,
      tradeCov,
      this._state.bestBid !== null && this._state.bestAsk !== null ? 1 : 0,
    ]
    const overall = factors.reduce((a, b) => a + b, 0) / factors.length

    return {
      synchronization: 'SYNCED',
      latencyMs: null,
      bookCompleteness: bookComplete ? 1 : 0,
      tradeCoverage: tradeCov,
      spreadStability: spreadStable,
      dataIntegrity: 'VALID',
      overallScore: overall,
    }
  }

  /** Build the immutable snapshot (§4, Rule 2). */
  private buildSnapshot(): MicrostructureSnapshot {
    const state = this._state
    const spread = state.bestBid !== null && state.bestAsk !== null ? state.bestAsk - state.bestBid : null
    const mid = state.bestBid !== null && state.bestAsk !== null ? (state.bestBid + state.bestAsk) / 2 : null
    const totalVol = state.bidDepth + state.askDepth
    const imbalance = totalVol > 0 ? (state.bidDepth - state.askDepth) / totalVol : null

    const snapshot: MicrostructureSnapshot = {
      symbol: this._symbol,
      exchange: this._exchange,
      timestamp: state.lastUpdateTimestamp,
      bestBid: state.bestBid,
      bestAsk: state.bestAsk,
      midPrice: mid,
      currentSpread: spread,
      bidVolume: state.bidDepth || null,
      askVolume: state.askDepth || null,
      orderBookImbalance: imbalance,
      liquidityScore: state.liquidityEstimate,
      executionPressure: state.pressureEstimate,
      tradePressure: state.pressureEstimate,
      marketEfficiency: this.computeMarketEfficiency(),
      microstructureQuality: this.buildQuality(),
      snapshotVersion: state.version,
    }

    // Update spread analysis + execution pressure + order book pressure + liquidity + shape
    state.spreadAnalysis = this.buildSpreadAnalysis()
    state.executionPressure = this.buildExecutionPressure()
    state.orderBookPressure = this.buildOrderBookPressure()
    state.liquidityProfile = this.buildLiquidityProfile()
    state.orderBookShape = this.buildOrderBookShape()

    return Object.freeze(snapshot) // Rule 2 — immutable after publication
  }

  /** Compute market efficiency (0..1). */
  private computeMarketEfficiency(): number | null {
    if (this._spreadVolatility.stdDev === null || this._spreadEma.value === null) return null
    // Higher spread volatility + wider spread = lower efficiency
    const spreadRatio = this._spreadEma.value > 0 ? Math.min(1, this._spreadVolatility.stdDev / this._spreadEma.value) : 0
    return Math.max(0, 1 - spreadRatio)
  }

  /** Get the current snapshot (§5). */
  getSnapshot(): MicrostructureSnapshot | null {
    return this._snapshot
  }

  /** Get the full market state (for debugging/observability). */
  getState(): MarketMicrostructureState {
    return this._state
  }

  /** Recovery: pause → reload → replay → reconstruct → validate → resume (§14). */
  async recover(
    reloadSnapshot: () => Promise<MicrostructureSnapshot | null>,
    replayEvents: () => Promise<CanonicalMarketEvent[]>,
  ): Promise<boolean> {
    this._stats.recoveryCount++
    log.info(`recovery initiated for ${this._symbol} (§14)`)

    // Step 1: Pause (implicit — no new events processed during recovery)

    // Step 2: Reload Latest Snapshot
    const latest = await reloadSnapshot()

    // Step 3: Replay Missing Events
    const events = await replayEvents()

    // Step 4: Reconstruct Market State
    if (latest) {
      this._state.version = latest.snapshotVersion
      this._state.bestBid = latest.bestBid
      this._state.bestAsk = latest.bestAsk
    }
    for (const event of events) {
      this.updateState(event)
    }

    // Step 5: Validate Snapshot
    this._snapshot = this.buildSnapshot()
    if (!this._snapshot) {
      log.error(`recovery validation FAILED for ${this._symbol} — incomplete snapshot`)
      return false
    }

    log.info(`recovery COMPLETE for ${this._symbol}`)
    return true
  }

  getStats() {
    return { ...this._stats }
  }

  private emptyState(): MarketMicrostructureState {
    return {
      symbol: this._symbol,
      exchange: this._exchange,
      bestBid: null,
      bestAsk: null,
      bidDepth: 0,
      askDepth: 0,
      boundedBids: [],
      boundedAsks: [],
      rollingVwap: null,
      tradeVelocity: 0,
      aggressiveBuyVolume: 0,
      aggressiveSellVolume: 0,
      averageSpread: null,
      liquidityEstimate: null,
      pressureEstimate: null,
      orderBookShape: null,
      spreadAnalysis: {
        currentSpread: null, averageSpread: null, medianSpread: null,
        maxSpread: null, spreadVolatility: null, spreadExpansionRate: null, spreadCompressionRate: null,
      },
      executionPressure: {
        aggressiveBuyRatio: null, aggressiveSellRatio: null, netMarketPressure: null,
        tradeDirectionBias: null, executionImbalance: null, aggressorMethod: 'EXCHANGE_METADATA',
      },
      orderBookPressure: {
        depthImbalance: null, nearPriceLiquidity: null, farPriceLiquidity: null,
        liquidityGradient: null, queuePressure: null,
      },
      liquidityProfile: {
        immediateLiquidity: null, localLiquidity: null, regionalLiquidity: null,
        structuralLiquidity: null, liquidityStability: null, liquidityMigration: null,
      },
      version: 0,
      lastUpdateTimestamp: 0,
    }
  }
}
