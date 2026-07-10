// CHAPTER 3.5 — Candle Construction Engine Facade
//
// Transforms Canonical Market Events into deterministic canonical OHLCV candles.
// Guarantees: deterministic construction (Rule 10), immutable finalized candles
// (Rule 2, Rule 8), multi-asset isolation (Rule 6), incremental aggregation
// (Rule 12), constant memory (Rule 13), checkpoint recovery (Rule 14),
// watermark-based completion (Rule 17), late events → v+1 (Rule 18).

import { createLogger } from '../domains/01-core-infrastructure'
import { CandleAccumulator, type AccumulatorCheckpoint } from './accumulator'
import type { CanonicalMarketEvent } from '../market-data/canonical-event'
import type {
  CanonicalCandle,
  CanonicalTimeframe,
  CandleSnapshot,
  EventWatermark,
} from './types'
import { getCandleOpenTime, detectTimeframeCycles, DEFAULT_LATE_ARRIVAL_TOLERANCE_SEC } from './types'

const log = createLogger('candle-engine')

// ─────────────────────────────────────────────────────────────────────────────
// Candle Construction Engine  (Chapter 3.5 §1)
// ─────────────────────────────────────────────────────────────────────────────

class CandleConstructionEngine {
  /** Per-asset-per-timeframe accumulators (§7, §14 — partitioned by asset). */
  private accumulators = new Map<string, CandleAccumulator>()
  /** Finalized candles (archived — §10, Rule 2). */
  private finalized = new Map<string, CanonicalCandle[]>()
  /** Event watermark (§8, Rule 17). */
  private watermark: EventWatermark = {
    currentWatermark: 0,
    lateArrivalToleranceSec: DEFAULT_LATE_ARRIVAL_TOLERANCE_SEC,
  }
  /** Subscribers to finalized candles. */
  private finalizeSubscribers = new Set<(candle: CanonicalCandle) => void>()
  /** Subscribers to v+1 corrections (§9.1). */
  private correctionSubscribers = new Set<(original: CanonicalCandle, corrected: CanonicalCandle) => void>()
  /** Checkpoint history (§15.1). */
  private checkpoints: AccumulatorCheckpoint[] = []
  private stats = {
    candlesBuilt: 0,
    aggregations: 0,
    gapCount: 0,
    repairCount: 0,
    versionCorrections: 0,
    constructionErrors: 0,
    finalizedCount: 0,
    openCount: 0,
  }

  constructor() {
    // §6 — validate no circular timeframe dependencies at construction
    const cycles = detectTimeframeCycles()
    if (cycles.length > 0) {
      throw new Error(`[candle-engine] CIRCULAR TIMEFRAME DEPENDENCY DETECTED (§6 — prohibited): ${cycles.map((c) => c.join('→')).join(', ')}`)
    }
  }

  /**
   * Ingest a Canonical Market Event (§3, Rule 1 — only canonical events).
   * Routes to the appropriate accumulator + attempts finalization.
   */
  ingest(event: CanonicalMarketEvent): void {
    // Update watermark (§8, Rule 17)
    const eventTimeSec = Math.floor(event.exchangeTimestamp / 1000)
    if (eventTimeSec > this.watermark.currentWatermark) {
      this.watermark.currentWatermark = eventTimeSec
    }

    // Route to all timeframes for this symbol (each asset has independent pipelines §14)
    const timeframes: CanonicalTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d']
    for (const tf of timeframes) {
      const openTime = getCandleOpenTime(eventTimeSec, tf)
      const key = this.accKey(event.symbol, tf, openTime)
      let acc = this.accumulators.get(key)
      if (!acc) {
        acc = new CandleAccumulator(event.sourceExchange, event.symbol, tf, openTime, event.provenance !== 'LIVE')
        this.accumulators.set(key, acc)
        this.stats.openCount++
      }
      acc.applyEvent(event)

      // Try to finalize (§8)
      const finalized = acc.tryFinalize(this.watermark)
      if (finalized) {
        this.handleFinalization(key, finalized, event.symbol, tf)
      }
    }
  }

  /** Handle a finalized candle (§10 archive, notify subscribers, check for v+1). */
  private handleFinalization(key: string, candle: CanonicalCandle, symbol: string, tf: CanonicalTimeframe): void {
    this.stats.candlesBuilt++
    this.stats.finalizedCount++
    this.stats.openCount = Math.max(0, this.stats.openCount - 1)

    // §10 — archive the finalized candle
    const archiveKey = this.archiveKey(symbol, tf)
    const archive = this.finalized.get(archiveKey) ?? []
    archive.push(candle)
    if (archive.length > 1000) archive.shift() // bounded
    this.finalized.set(archiveKey, archive)

    // Remove the accumulator from active set
    this.accumulators.delete(key)

    // Notify subscribers
    for (const sub of this.finalizeSubscribers) {
      try {
        sub(candle)
      } catch (e) {
        log.error(`finalize subscriber failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // §9.1 — check if v+1 correction is needed (late events)
    const acc = this.accumulators.get(key)
    if (acc?.needsVersionCorrection()) {
      const corrected = acc.generateCorrectedVersion()
      if (corrected) {
        this.stats.versionCorrections++
        for (const sub of this.correctionSubscribers) {
          try {
            sub(candle, corrected)
          } catch (e) {
            log.error(`correction subscriber failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
    }

    log.debug(`finalized ${symbol} ${tf} @ ${candle.openTime} (O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume} trades:${candle.tradeCount})`)
  }

  /** Get the current open candle snapshot for a symbol+timeframe (§16). */
  getOpenCandle(symbol: string, tf: CanonicalTimeframe): CandleSnapshot | null {
    // Find the accumulator with the latest open time for this symbol+tf
    let latest: CandleAccumulator | null = null
    let latestTime = 0
    for (const [key, acc] of this.accumulators) {
      if (key.startsWith(`${symbol}:${tf}:`)) {
        const cp = acc.checkpoint()
        if (cp.openTime > latestTime) {
          latestTime = cp.openTime
          latest = acc
        }
      }
    }
    if (!latest) return null
    return {
      candle: latest.snapshot(),
      snapshotAt: Date.now(),
      isFinalized: false,
    }
  }

  /** Get a finalized candle snapshot (§16). */
  getFinalizedCandle(symbol: string, tf: CanonicalTimeframe, openTime: number): CandleSnapshot | null {
    const archiveKey = this.archiveKey(symbol, tf)
    const archive = this.finalized.get(archiveKey) ?? []
    const candle = archive.find((c) => c.openTime === openTime)
    if (!candle) return null
    return { candle, snapshotAt: Date.now(), isFinalized: true }
  }

  /** Get finalized candle history for a symbol+timeframe (§16). */
  getFinalizedHistory(symbol: string, tf: CanonicalTimeframe, limit = 100): CanonicalCandle[] {
    const archiveKey = this.archiveKey(symbol, tf)
    return (this.finalized.get(archiveKey) ?? []).slice(-limit)
  }

  /** Subscribe to finalized candle events. */
  onFinalized(handler: (candle: CanonicalCandle) => void): () => void {
    this.finalizeSubscribers.add(handler)
    return () => this.finalizeSubscribers.delete(handler)
  }

  /** Subscribe to v+1 correction events (§9.1). */
  onCorrection(handler: (original: CanonicalCandle, corrected: CanonicalCandle) => void): () => void {
    this.correctionSubscribers.add(handler)
    return () => this.correctionSubscribers.delete(handler)
  }

  /** Checkpoint all active accumulators (§15.1). */
  checkpoint(): AccumulatorCheckpoint[] {
    this.checkpoints = []
    for (const acc of this.accumulators.values()) {
      this.checkpoints.push(acc.checkpoint())
    }
    log.info(`checkpointed ${this.checkpoints.length} accumulators (§15.1)`)
    return this.checkpoints
  }

  /** Restore accumulators from checkpoints (§15.1). */
  restore(checkpoints: AccumulatorCheckpoint[]): void {
    this.accumulators.clear()
    for (const cp of checkpoints) {
      const key = this.accKey(cp.symbol, cp.timeframe, cp.openTime)
      this.accumulators.set(key, CandleAccumulator.fromCheckpoint(cp))
    }
    log.info(`restored ${this.accumulators.size} accumulators from checkpoints (§15.1)`)
  }

  /** Set the late-arrival tolerance window (§8). */
  setLateArrivalTolerance(sec: number): void {
    this.watermark.lateArrivalToleranceSec = sec
  }

  /** Get the current watermark (§8). */
  getWatermark(): EventWatermark {
    return { ...this.watermark }
  }

  /** Observability stats (§17). */
  getStats() {
    return {
      ...this.stats,
      activeAccumulators: this.accumulators.size,
      finalizedArchives: Array.from(this.finalized.values()).reduce((a, b) => a + b.length, 0),
      checkpointCount: this.checkpoints.length,
    }
  }

  private accKey(symbol: string, tf: CanonicalTimeframe, openTime: number): string {
    return `${symbol}:${tf}:${openTime}`
  }

  private archiveKey(symbol: string, tf: CanonicalTimeframe): string {
    return `${symbol}:${tf}`
  }
}

export const candleConstructionEngine = new CandleConstructionEngine()
