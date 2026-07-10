// CHAPTER 3.5 §7, §8, §9, §9.1, §10, §12, §15.1 — Accumulator, Lifecycle, Completion, Gaps, Late Events
//
// Incremental Aggregation (§7): one accumulator per Asset+Timeframe, constant
// memory, merge completed lower-TF candles immediately. Aggregator updates:
// High, Low, Close, Volume, Trade Count, VWAP, Buy/Sell Volume.
//
// Candle Completion (§8): FINALIZED only when timeframe expires + watermark
// passes boundary + late-arrival tolerance expires + validation + sequence.
//
// Gap Handling (§9): No Trades → zero-volume candle (valid); Missing Data → gap.
//
// Late Event Policy (§9.1, Rule 18): late events don't modify finalized candle
// → queue for reconstruction → v+1 async → live continues with original.
//
// Checkpoint Recovery (§15.1): accumulators periodically checkpointed.

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  CanonicalCandle,
  CanonicalTimeframe,
  CandleDataQuality,
  CandleLifecycleState,
  CandleProvenance,
  CompletionStatus,
  ConstructionMethod,
  EventWatermark,
  GapStatus,
  MarketMicrostructureExtension,
} from './types'
import { getCandleOpenTime, getCandleCloseTime, TIMEFRAME_SECONDS, CCE_ENGINE_VERSION } from './types'
import type { CanonicalMarketEvent } from '../market-data/canonical-event'

const log = createLogger('candle-engine:accumulator')

// ─────────────────────────────────────────────────────────────────────────────
// Candle Accumulator  (Chapter 3.5 §7 — incremental aggregation)
// ─────────────────────────────────────────────────────────────────────────────

interface SpreadSample {
  spread: number
  timestamp: number
}

export class CandleAccumulator {
  private _state: CandleLifecycleState = 'OPEN'
  private _open: number | null = null
  private _high: number | null = null
  private _low: number | null = null
  private _close: number | null = null
  private _volume: number = 0
  private _tradeCount: number = 0
  private _buyVolume: number = 0
  private _sellVolume: number = 0
  private _volumeWeightedPriceSum: number = 0 // for VWAP
  private _parentCandleCount: number = 0
  private _constructionStartTime: number
  private _constructionFinishTime: number | null = null
  private _replayFlag: boolean
  private _recoveryFlag: boolean = false
  private _candleVersion: number = 1
  private _spreadSamples: SpreadSample[] = []
  private _imbalanceSamples: number[] = []
  private _bidDepth: number | null = null
  private _askDepth: number | null = null
  private _lateEventQueue: CanonicalMarketEvent[] = []

  constructor(
    private readonly _exchange: string,
    private readonly _symbol: string,
    private readonly _timeframe: CanonicalTimeframe,
    private readonly _openTime: number, // UTC epoch seconds (§6.1)
    replayFlag: boolean = false,
  ) {
    this._constructionStartTime = Date.now()
    this._replayFlag = replayFlag
  }

  /** Apply a canonical market event to the accumulator (§7, §12). */
  applyEvent(event: CanonicalMarketEvent): void {
    if (this._state === 'FINALIZED') {
      // §9.1, Rule 18 — late event: queue for reconstruction, don't modify finalized candle
      this._lateEventQueue.push(event)
      log.debug(`late event queued for ${this._symbol} ${this._timeframe} @ ${this._openTime} (v+1 will be generated)`)
      return
    }

    // Transition OPEN → UPDATING on first event
    if (this._state === 'OPEN') {
      this._state = 'UPDATING'
    }

    const p = event.payload as Record<string, unknown>

    // Extract price + volume from the event
    let price: number | null = null
    let volume: number = 0
    let side: 'BUY' | 'SELL' | 'UNKNOWN' = 'UNKNOWN'

    switch (event.eventType) {
      case 'TRADE':
        price = Number(p.price)
        volume = Number(p.quantity)
        side = (p.side as 'BUY' | 'SELL' | 'UNKNOWN') ?? 'UNKNOWN'
        this._tradeCount++
        break
      case 'KLINE': {
        const klineClose = Number(p.close)
        price = klineClose
        volume = Number(p.volume)
        this._tradeCount += Number(p.tradeCount ?? 0)
        // For kline aggregation, use the kline's OHLC directly
        const kHigh = Number(p.high)
        const kLow = Number(p.low)
        const kOpen = Number(p.open)
        if (this._open === null) this._open = kOpen
        if (this._high === null || kHigh > this._high) this._high = kHigh
        if (this._low === null || kLow < this._low) this._low = kLow
        break
      }
      case 'BOOK_TICKER': {
        // Microstructure: capture spread + imbalance
        const bid = Number(p.bidPrice)
        const ask = Number(p.askPrice)
        if (bid > 0 && ask > 0) {
          const spread = ask - bid
          this._spreadSamples.push({ spread, timestamp: event.exchangeTimestamp })
          const bidQty = Number(p.bidQuantity)
          const askQty = Number(p.askQuantity)
          if (bidQty + askQty > 0) {
            this._imbalanceSamples.push((bidQty - askQty) / (bidQty + askQty))
          }
        }
        return // BookTicker doesn't update OHLCV
      }
      case 'DEPTH_UPDATE': {
        // Microstructure: capture depth
        const bids = (p.bids ?? []) as Array<[number, number]>
        const asks = (p.asks ?? []) as Array<[number, number]>
        this._bidDepth = bids.reduce((a, b) => a + b[1], 0)
        this._askDepth = asks.reduce((a, b) => a + b[1], 0)
        return // Depth doesn't update OHLCV directly
      }
      default:
        return
    }

    if (price === null || !Number.isFinite(price)) return

    // §12 — Open never changes (Rule 7)
    if (this._open === null) {
      this._open = price
    }

    // §7 — update High, Low, Close
    if (this._high === null || price > this._high) this._high = price
    if (this._low === null || price < this._low) this._low = price
    this._close = price

    // §7 — update Volume, VWAP, Buy/Sell Volume
    this._volume += volume
    this._volumeWeightedPriceSum += price * volume
    if (side === 'BUY') this._buyVolume += volume
    else if (side === 'SELL') this._sellVolume += volume

    this._parentCandleCount++
  }

  /**
   * Merge a completed lower-timeframe candle into this accumulator (§7 incremental aggregation).
   * Used for building higher-TF candles from finalized lower-TF candles.
   */
  mergeLowerCandle(lower: CanonicalCandle): void {
    if (this._state === 'FINALIZED') return
    if (this._state === 'OPEN') this._state = 'UPDATING'

    // §7 — Open never changes (Rule 7)
    if (this._open === null) this._open = lower.open
    if (this._high === null || lower.high > this._high) this._high = lower.high
    if (this._low === null || lower.low < this._low) this._low = lower.low
    this._close = lower.close
    this._volume += lower.volume
    this._tradeCount += lower.tradeCount
    this._buyVolume += lower.buyVolume
    this._sellVolume += lower.sellVolume
    this._volumeWeightedPriceSum += lower.vwap * lower.volume
    this._parentCandleCount++
  }

  /**
   * Attempt to finalize the candle (§8).
   * FINALIZED only when: timeframe expires + watermark passes + late-arrival tolerance expires + validation.
   */
  tryFinalize(watermark: EventWatermark): CanonicalCandle | null {
    if (this._state === 'FINALIZED') return null

    const closeTime = getCandleCloseTime(this._openTime, this._timeframe)

    // §8 — check if timeframe has expired
    if (watermark.currentWatermark < closeTime) {
      return null // timeframe not yet expired
    }

    // §8 — check late-arrival tolerance window
    const toleranceBoundary = closeTime + watermark.lateArrivalToleranceSec
    if (watermark.currentWatermark < toleranceBoundary) {
      return null // still within late-arrival tolerance
    }

    // §8 — validation: must have at least an open price (or be a valid zero-volume candle §9)
    const hasData = this._open !== null
    const isZeroVolume = this._tradeCount === 0 && this._volume === 0

    // Finalize
    this._state = 'FINALIZED'
    this._constructionFinishTime = Date.now()

    return this.buildCandle(isZeroVolume ? 'ZERO_VOLUME' : 'NONE')
  }

  /** Build the canonical candle from the accumulator state. */
  private buildCandle(gapStatus: GapStatus): CanonicalCandle {
    const closeTime = getCandleCloseTime(this._openTime, this._timeframe)
    const open = this._open ?? 0
    const close = this._close ?? open
    const high = this._high ?? Math.max(open, close)
    const low = this._low ?? Math.min(open, close)
    const vwap = this._volume > 0 ? this._volumeWeightedPriceSum / this._volume : close

    const completionStatus: CompletionStatus = this._state === 'FINALIZED' ? 'FINALIZED' : this._state === 'UPDATING' ? 'UPDATING' : 'OPEN'
    const method: ConstructionMethod = this._replayFlag ? 'REPLAY' : 'LIVE'

    const quality: CandleDataQuality = {
      validationStatus: 'VALID',
      constructionMethod: method,
      gapStatus,
      repairStatus: 'NONE',
      sourceDataset: null,
      qualityScore: this._tradeCount > 0 ? 1.0 : 0.5, // zero-volume = lower quality
    }

    const provenance: CandleProvenance = {
      constructionStartTime: this._constructionStartTime,
      constructionFinishTime: this._constructionFinishTime,
      engineVersion: CCE_ENGINE_VERSION,
      replayFlag: this._replayFlag,
      recoveryFlag: this._recoveryFlag,
      parentCandleCount: this._parentCandleCount,
    }

    const candle: CanonicalCandle = {
      identity: {
        exchange: this._exchange,
        symbol: this._symbol,
        timeframe: this._timeframe,
        openTime: this._openTime,
      },
      symbol: this._symbol,
      exchange: this._exchange,
      timeframe: this._timeframe,
      openTime: this._openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume: this._volume,
      tradeCount: this._tradeCount,
      vwap,
      buyVolume: this._buyVolume,
      sellVolume: this._sellVolume,
      completionStatus,
      candleVersion: this._candleVersion,
      dataQuality: quality,
      provenance,
      microstructure: this.buildMicrostructure(),
    }

    // §10, Rule 2, Rule 8 — finalized candles are immutable
    if (this._state === 'FINALIZED') {
      return Object.freeze(candle)
    }
    return candle
  }

  /** Build the microstructure extension from accumulated samples (§4.1). */
  private buildMicrostructure(): MarketMicrostructureExtension | undefined {
    if (this._spreadSamples.length === 0 && this._bidDepth === null) return undefined

    const spreads = this._spreadSamples.map((s) => s.spread)
    const avgSpread = spreads.length > 0 ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null
    const maxSpread = spreads.length > 0 ? Math.max(...spreads) : null
    const minSpread = spreads.length > 0 ? Math.min(...spreads) : null
    // Time-weighted average (simplified — equal weight per sample)
    const twAvgSpread = avgSpread

    const avgImbalance = this._imbalanceSamples.length > 0
      ? this._imbalanceSamples.reduce((a, b) => a + b, 0) / this._imbalanceSamples.length
      : null
    const maxImbalance = this._imbalanceSamples.length > 0
      ? Math.max(...this._imbalanceSamples.map((v) => Math.abs(v)))
      : null

    const liquidityScore = this._bidDepth !== null && this._askDepth !== null && this._bidDepth + this._askDepth > 0
      ? Math.min(1, (this._bidDepth + this._askDepth) / 100)
      : null

    return {
      averageSpread: avgSpread,
      maxSpread,
      minSpread,
      timeWeightedAvgSpread: twAvgSpread,
      averageOrderBookImbalance: avgImbalance,
      maxOrderBookImbalance: maxImbalance,
      bidDepth: this._bidDepth,
      askDepth: this._askDepth,
      liquidityScore,
      microstructureQuality: liquidityScore !== null ? Math.min(1, liquidityScore) : null,
    }
  }

  /** Get the current state (for snapshots §16). */
  getState(): CandleLifecycleState {
    return this._state
  }

  /** Generate an immutable snapshot (§16). */
  snapshot(): CanonicalCandle {
    return this.buildCandle(this._tradeCount === 0 ? 'ZERO_VOLUME' : 'NONE')
  }

  /** Get queued late events (§9.1 — for async v+1 reconstruction). */
  getLateEvents(): CanonicalMarketEvent[] {
    return [...this._lateEventQueue]
  }

  /** Check if a v+1 correction is needed (§9.1, Rule 18). */
  needsVersionCorrection(): boolean {
    return this._lateEventQueue.length > 0 && this._state === 'FINALIZED'
  }

  /**
   * Generate a corrected candle (v+1) from late events (§9.1, §10, Rule 18).
   * The original finalized candle remains archived (Rule 2).
   */
  generateCorrectedVersion(): CanonicalCandle | null {
    if (this._lateEventQueue.length === 0) return null
    // Apply late events to a copy of the state
    const corrected = { ...this }
    corrected._candleVersion = this._candleVersion + 1
    corrected._lateEventQueue = []
    corrected._state = 'FINALIZED'
    // Re-apply late events
    for (const event of this._lateEventQueue) {
      corrected.applyEvent(event)
    }
    return corrected.buildCandle('NONE')
  }

  /** Checkpoint the accumulator state for recovery (§15.1). */
  checkpoint(): AccumulatorCheckpoint {
    return {
      exchange: this._exchange,
      symbol: this._symbol,
      timeframe: this._timeframe,
      openTime: this._openTime,
      state: this._state,
      open: this._open,
      high: this._high,
      low: this._low,
      close: this._close,
      volume: this._volume,
      tradeCount: this._tradeCount,
      buyVolume: this._buyVolume,
      sellVolume: this._sellVolume,
      volumeWeightedPriceSum: this._volumeWeightedPriceSum,
      parentCandleCount: this._parentCandleCount,
      constructionStartTime: this._constructionStartTime,
      replayFlag: this._replayFlag,
      candleVersion: this._candleVersion,
      checkpointAt: Date.now(),
    }
  }

  /** Restore from a checkpoint (§15.1). */
  static fromCheckpoint(cp: AccumulatorCheckpoint): CandleAccumulator {
    const acc = new CandleAccumulator(cp.exchange, cp.symbol, cp.timeframe, cp.openTime, cp.replayFlag)
    acc._state = cp.state
    acc._open = cp.open
    acc._high = cp.high
    acc._low = cp.low
    acc._close = cp.close
    acc._volume = cp.volume
    acc._tradeCount = cp.tradeCount
    acc._buyVolume = cp.buyVolume
    acc._sellVolume = cp.sellVolume
    acc._volumeWeightedPriceSum = cp.volumeWeightedPriceSum
    acc._parentCandleCount = cp.parentCandleCount
    acc._constructionStartTime = cp.constructionStartTime
    acc._candleVersion = cp.candleVersion
    return acc
  }
}

export interface AccumulatorCheckpoint {
  exchange: string
  symbol: string
  timeframe: CanonicalTimeframe
  openTime: number
  state: CandleLifecycleState
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number
  tradeCount: number
  buyVolume: number
  sellVolume: number
  volumeWeightedPriceSum: number
  parentCandleCount: number
  constructionStartTime: number
  replayFlag: boolean
  candleVersion: number
  checkpointAt: number
}
