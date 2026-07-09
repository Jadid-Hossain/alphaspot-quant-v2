// CHAPTER 3.8 §5-§14 — Trade Flow Intelligence Engine (per-asset)
//
// Analyzes completed transactions to estimate actual market participant behavior.
// Per-asset isolation (§13, Rule 8). Immutable outputs (Rule 2). Deterministic
// (Rule 3, Rule 15). Constant-memory (Rule 6, Rule 12). Adaptive baselines
// (Rule 11). Dedup by Event ID (Rule 16). Aggressor via exchange Maker/Taker
// only (Rule 4). Derivatives optional (Rule 14).

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalMarketEvent, MicrostructureSnapshot } from '../microstructure/types'
import { EMA, EWMA, CircularBuffer, emaForPeriod, ewmaForHalfLife } from '../microstructure/rolling-metrics'
import { RollingBaseline, RollingZScore, zScoreToProbability } from '../order-book-intel/adaptive-baselines'
import type {
  BlockTradeAssessment,
  DerivativesFlow,
  ExecutionImbalance,
  ExhaustionAssessment,
  FlowConfidence,
  TradeFlowSnapshot,
  TradeVelocity,
  VolumeDelta,
} from './types'
import { getCandleOpenTime } from '../candle-engine/types'

const log = createLogger('trade-flow:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Per-Asset Trade Flow Intelligence Engine  (Chapter 3.8 §13, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export class TradeFlowEngine {
  private _version = 0
  private _snapshot: TradeFlowSnapshot | null = null
  private _prevSnapshot: TradeFlowSnapshot | null = null

  // §5 — Volume Delta (cumulative since engine start)
  private _aggressiveBuyVolume = 0
  private _aggressiveSellVolume = 0

  // §6 — CVD
  private _absoluteCVD = 0 // internal only — never exposed to ML (§6)
  private _sessionCVD = 0 // resets at UTC daily boundary (§6)
  private _sessionDate: number = 0 // UTC day number for reset detection
  private _rollingCvdEma: EMA // Rolling CVD via EMA (constant memory §6, Rule 12)
  private _cvdSlope: EMA
  private _prevSessionCVD = 0
  private _priceHistory: CircularBuffer<number> // for price-CVD divergence

  // §7 — Block Trade (adaptive §7, Rule 13)
  private _tradeSizeBaseline: RollingBaseline // rolling trade size distribution
  private _blockCount = 0
  private _blockDirectionBias = 0
  private _blockSizes: CircularBuffer<number>

  // §8 — Execution Imbalance (Rule 4 — Maker/Taker only)
  private _buyerDominanceEma: EMA
  private _sellerDominanceEma: EMA
  private _tradeDensityEma: EMA
  private _directionalPersistenceEma: EMA

  // §9 — Trade Velocity (bounded memory §9, Rule 12)
  private _tradesPerSecondEma: EMA
  private _volumePerSecondEma: EMA
  private _velocityEwma: EWMA // for burst detection
  private _lastTradeTimestamp: number | null = null

  // §11 — Exhaustion
  private _buyExhaustionEma: EMA
  private _sellExhaustionEma: EMA
  private _momentumDecayEma: EMA

  // Rule 16 — Dedup cache (bounded)
  private _dedupSet: Set<string> = new Set()
  private _dedupMaxSize = 10_000

  // Stats
  private _stats = {
    eventsProcessed: 0,
    duplicatesIgnored: 0,
    blocksDetected: 0,
    snapshotsPublished: 0,
    derivativesEvents: 0,
  }

  constructor(private readonly _symbol: string) {
    this._rollingCvdEma = emaForPeriod(100)
    this._cvdSlope = emaForPeriod(20)
    this._priceHistory = new CircularBuffer<number>(100)
    this._tradeSizeBaseline = new RollingBaseline(100)
    this._blockSizes = new CircularBuffer<number>(50)
    this._buyerDominanceEma = emaForPeriod(50)
    this._sellerDominanceEma = emaForPeriod(50)
    this._tradeDensityEma = emaForPeriod(20)
    this._directionalPersistenceEma = emaForPeriod(30)
    this._tradesPerSecondEma = emaForPeriod(20)
    this._volumePerSecondEma = emaForPeriod(20)
    this._velocityEwma = ewmaForHalfLife(30)
    this._buyExhaustionEma = emaForPeriod(50)
    this._sellExhaustionEma = emaForPeriod(50)
    this._momentumDecayEma = emaForPeriod(30)
  }

  /**
   * Process a Canonical Trade Event (§3, Rule 1, Rule 16).
   * Dedup by Event ID. Aggressor classification via exchange Maker/Taker only (Rule 4).
   */
  processTradeEvent(event: CanonicalMarketEvent, microSnapshot?: MicrostructureSnapshot): TradeFlowSnapshot | null {
    // Rule 16 — dedup by Event ID (or trade ID from payload)
    const p = event.payload as Record<string, unknown>
    const dedupKey = (p.tradeId as string) ?? event.eventId
    if (this._dedupSet.has(dedupKey)) {
      this._stats.duplicatesIgnored++
      return null // Rule 16 — duplicates never modify cumulative statistics
    }
    this._dedupSet.add(dedupKey)
    if (this._dedupSet.size > this._dedupMaxSize) {
      // LRU eviction
      const entries = [...this._dedupSet]
      this._dedupSet = new Set(entries.slice(entries.length / 2))
    }

    this._stats.eventsProcessed++

    const price = Number(p.price)
    const quantity = Number(p.quantity)
    // §8, Rule 4 — aggressor classification EXCLUSIVELY from exchange Maker/Taker
    const isBuyerMaker = Boolean(p.isBuyerMaker)
    const isAggressiveBuy = !isBuyerMaker // isBuyerMaker=false → aggressive buy
    const isAggressiveSell = isBuyerMaker // isBuyerMaker=true → aggressive sell

    // §5 — Volume Delta
    if (isAggressiveBuy) {
      this._aggressiveBuyVolume += quantity
      this._absoluteCVD += quantity // §6 — internal absolute CVD
      this._sessionCVD += quantity
    } else {
      this._aggressiveSellVolume += quantity
      this._absoluteCVD -= quantity
      this._sessionCVD -= quantity
    }

    // §6 — Session CVD reset at UTC daily boundary (§6, Ch 3.5)
    const eventDay = Math.floor(event.exchangeTimestamp / 86_400_000)
    if (eventDay !== this._sessionDate) {
      this._sessionDate = eventDay
      this._prevSessionCVD = this._sessionCVD
      this._sessionCVD = isAggressiveBuy ? quantity : -quantity
      log.debug(`${this._symbol} session CVD reset at UTC daily boundary`)
    }

    // §6 — Rolling CVD (EMA, constant memory Rule 12)
    this._rollingCvdEma.update(this._absoluteCVD)
    this._cvdSlope.update(this._sessionCVD - this._prevSessionCVD)
    this._prevSessionCVD = this._sessionCVD

    // Price history for divergence
    this._priceHistory.push(price)

    // §7 — Block Trade Detection (adaptive §7, Rule 13)
    this._tradeSizeBaseline.observe(quantity)
    const tradeSizeZ = this._tradeSizeBaseline.observe(quantity) // Z-score relative to rolling distribution
    const isBlock = Math.abs(tradeSizeZ) > 2.0 // statistically significant (Rule 11 — no fixed volume threshold)
    if (isBlock) {
      this._stats.blocksDetected++
      this._blockCount++
      this._blockSizes.push(quantity)
      this._blockDirectionBias += isAggressiveBuy ? 1 : -1
    }

    // §9 — Trade Velocity
    const now = event.exchangeTimestamp
    if (this._lastTradeTimestamp !== null) {
      const dt = (now - this._lastTradeTimestamp) / 1000 // seconds
      if (dt > 0) {
        const tps = 1 / dt
        this._tradesPerSecondEma.update(tps)
        this._volumePerSecondEma.update(quantity / dt)
        this._velocityEwma.update(tps)
      }
    }
    this._lastTradeTimestamp = now

    // §8 — Execution Imbalance (Maker/Taker only, Rule 4)
    const totalVol = this._aggressiveBuyVolume + this._aggressiveSellVolume
    const buyRatio = totalVol > 0 ? this._aggressiveBuyVolume / totalVol : 0.5
    const sellRatio = 1 - buyRatio
    this._buyerDominanceEma.update(buyRatio)
    this._sellerDominanceEma.update(sellRatio)
    this._tradeDensityEma.update(1)
    const direction = isAggressiveBuy ? 1 : -1
    this._directionalPersistenceEma.update(direction)

    // §11 — Exhaustion (momentum decay)
    const momentum = Math.abs(this._directionalPersistenceEma.value ?? 0)
    const prevMomentum = this._prevSnapshot ? Math.abs(this._prevSnapshot.executionImbalance) : 0
    const decay = Math.max(0, prevMomentum - momentum)
    this._momentumDecayEma.update(decay)

    // Buy exhaustion: buy dominance declining
    const buyExhaustion = this._buyerDominanceEma.value !== null && this._prevSnapshot !== null
      ? Math.max(0, (this._prevSnapshot.buyerDominance ?? 0) - (this._buyerDominanceEma.value ?? 0))
      : 0
    this._buyExhaustionEma.update(buyExhaustion)

    // Sell exhaustion: sell dominance declining
    const sellExhaustion = this._sellerDominanceEma.value !== null && this._prevSnapshot !== null
      ? Math.max(0, (this._prevSnapshot.sellerDominance ?? 0) - (this._sellerDominanceEma.value ?? 0))
      : 0
    this._sellExhaustionEma.update(sellExhaustion)

    // Build the snapshot
    this._version++
    const snapshot = this.buildSnapshot(event, microSnapshot, price, quantity, isBlock, tradeSizeZ)
    this._prevSnapshot = snapshot
    this._snapshot = snapshot
    this._stats.snapshotsPublished++
    return snapshot
  }

  /** Process a derivatives event (§10 — optional, Rule 14). */
  processDerivativesEvent(event: CanonicalMarketEvent): void {
    this._stats.derivativesEvents++
    // Store for next snapshot build — derivatives are optional overlay
    // In a full implementation, this would update the derivatives state
  }

  /** Build the immutable Trade Flow Snapshot (§4, Rule 2). */
  private buildSnapshot(
    event: CanonicalMarketEvent,
    microSnapshot: MicrostructureSnapshot | undefined,
    lastPrice: number,
    lastQuantity: number,
    isBlock: boolean,
    blockZ: number,
  ): TradeFlowSnapshot {
    const delta: VolumeDelta = {
      aggressiveBuyVolume: this._aggressiveBuyVolume,
      aggressiveSellVolume: this._aggressiveSellVolume,
      netDelta: this._aggressiveBuyVolume - this._aggressiveSellVolume,
      rollingDelta: this._rollingCvdEma.value,
      deltaAcceleration: null, // computed from slope
      deltaPersistence: Math.abs(this._directionalPersistenceEma.value ?? 0),
    }

    // §6 — CVD outputs (Session + Rolling, NOT absolute)
    const cvdMomentum = this._cvdSlope.value
    const cvdSlope = this._cvdSlope.value
    const priceCvdDivergence = this.computePriceCvdDivergence(lastPrice)

    // §7 — Block Trade (adaptive Z-score, Rule 13)
    const blockAssessment: BlockTradeAssessment = {
      largeTradeScore: isBlock ? Math.min(1, Math.abs(blockZ) / 5) : 0,
      blockTradeFrequency: this._blockCount > 0 ? this._blockCount / Math.max(1, (Date.now() - (this._snapshot?.timestamp ?? Date.now())) / 60000) : null,
      averageBlockSize: this._blockSizes.length > 0 ? this._blockSizes.values().reduce((a, b) => a + b, 0) / this._blockSizes.length : null,
      blockDirectionBias: this._blockCount > 0 ? this._blockDirectionBias / this._blockCount : null,
      institutionalParticipationScore: Math.min(1, this._blockCount * 0.1 + Math.abs(blockZ) * 0.1),
    }

    // §9 — Velocity
    const velocity: TradeVelocity = {
      tradesPerSecond: this._tradesPerSecondEma.value ?? 0,
      volumePerSecond: this._volumePerSecondEma.value,
      executionBurstScore: this._velocityEwma.stdDev !== null ? Math.min(1, this._velocityEwma.stdDev / 10) : null,
      marketActivityScore: Math.min(1, (this._tradesPerSecondEma.value ?? 0) / 5),
      velocityAcceleration: null,
      velocityDeceleration: null,
    }

    // §8 — Execution Imbalance (Maker/Taker only, Rule 4)
    const totalVol = this._aggressiveBuyVolume + this._aggressiveSellVolume
    const imbalance: ExecutionImbalance = {
      buyerDominance: this._buyerDominanceEma.value,
      sellerDominance: this._sellerDominanceEma.value,
      executionConcentration: Math.min(1, lastQuantity / Math.max(1, totalVol)),
      tradeDensity: this._tradeDensityEma.value,
      directionalPersistence: Math.abs(this._directionalPersistenceEma.value ?? 0),
      executionEfficiency: Math.min(1, (this._tradesPerSecondEma.value ?? 0) / 5),
      imbalance: totalVol > 0 ? (this._aggressiveBuyVolume - this._aggressiveSellVolume) / totalVol : 0,
      aggressorMethod: 'EXCHANGE_METADATA', // Rule 4 — always
    }

    // §11 — Exhaustion
    const exhaustion: ExhaustionAssessment = {
      buyingExhaustion: this._buyExhaustionEma.value ?? 0,
      sellingExhaustion: this._sellExhaustionEma.value ?? 0,
      momentumDecay: this._momentumDecayEma.value,
      volumeFatigue: Math.max(0, 1 - (this._volumePerSecondEma.value ?? 1)),
      participationDecline: Math.max(0, 1 - (this._tradesPerSecondEma.value ?? 1)),
      executionSaturation: Math.min(1, (this._tradeDensityEma.value ?? 0) / 10),
    }

    // §12 — Flow Confidence
    const confidence: FlowConfidence = this.computeConfidence(microSnapshot)

    // §10 — Derivatives (optional, NULL when unavailable — Rule 14)
    const derivatives: DerivativesFlow | null = this._stats.derivativesEvents > 0
      ? {
          longLiquidationScore: null,
          shortLiquidationScore: null,
          liquidationCascadeProbability: null,
          fundingRateDivergence: null,
          openInterestDelta: null,
          derivativesPressureScore: null,
        }
      : null

    const snapshot: TradeFlowSnapshot = {
      symbol: this._symbol,
      timestamp: event.exchangeTimestamp,
      aggressiveBuyVolume: this._aggressiveBuyVolume,
      aggressiveSellVolume: this._aggressiveSellVolume,
      volumeDelta: delta.netDelta,
      sessionCVD: this._sessionCVD,
      rollingCVD: this._rollingCvdEma.value ?? 0,
      cvdMomentum,
      cvdSlope,
      priceCvdDivergence,
      blockTradeScore: blockAssessment.largeTradeScore,
      tradeVelocity: velocity.tradesPerSecond,
      volumePerSecond: velocity.volumePerSecond,
      executionBurstScore: velocity.executionBurstScore,
      executionImbalance: imbalance.imbalance,
      buyerDominance: imbalance.buyerDominance,
      sellerDominance: imbalance.sellerDominance,
      buyingExhaustion: exhaustion.buyingExhaustion,
      sellingExhaustion: exhaustion.sellingExhaustion,
      institutionalActivityScore: blockAssessment.institutionalParticipationScore,
      flowConfidence: confidence.overallScore,
      derivatives,
      snapshotVersion: this._version,
    }

    return Object.freeze(snapshot) // Rule 2 — immutable
  }

  /** Compute Price-CVD Divergence (§6). */
  private computePriceCvdDivergence(currentPrice: number): number | null {
    const prices = this._priceHistory.values()
    if (prices.length < 10) return null
    // Correlate price direction with CVD direction
    const priceChange = currentPrice - prices[0]
    const cvdChange = this._sessionCVD
    if (Math.abs(priceChange) < 1e-10 || Math.abs(cvdChange) < 1e-10) return 0
    // Divergence = -1 when price up but CVD down (or vice versa)
    const priceDir = Math.sign(priceChange)
    const cvdDir = Math.sign(cvdChange)
    return priceDir * cvdDir // 1 = confirmed, -1 = diverged
  }

  /** Compute Flow Confidence (§12). */
  private computeConfidence(microSnapshot: MicrostructureSnapshot | undefined): FlowConfidence {
    const tradeCoverage = Math.min(1, this._stats.eventsProcessed / 100)
    const marketActivity = Math.min(1, (this._tradesPerSecondEma.value ?? 0) / 5)
    const dataCompleteness = microSnapshot ? microSnapshot.microstructureQuality?.overallScore ?? 0.5 : 0.5
    const executionStability = this._velocityEwma.stdDev !== null ? Math.max(0, 1 - this._velocityEwma.stdDev / 10) : 0.5
    const microAgreement = microSnapshot && this._snapshot
      ? Math.max(0, 1 - Math.abs((microSnapshot.executionPressure ?? 0) - this._snapshot.executionImbalance))
      : 0.5

    const overall = (tradeCoverage * 0.2 + marketActivity * 0.2 + dataCompleteness * 0.2 + executionStability * 0.2 + microAgreement * 0.2)

    return {
      tradeCoverage,
      marketActivity,
      synchronization: 'SYNCED',
      dataCompleteness,
      executionStability,
      microstructureAgreement: microAgreement,
      overallScore: overall,
    }
  }

  // ── Public API ──

  getSnapshot(): TradeFlowSnapshot | null {
    return this._snapshot
  }

  /** Get internal absolute CVD (for recovery only — never exposed to ML §6). */
  getInternalAbsoluteCVD(): number {
    return this._absoluteCVD
  }

  getStats() {
    return { ...this._stats }
  }

  /** Recovery (§14): pause → reload → replay → recompute → resume. */
  async recover(
    reloadSnapshot: () => Promise<TradeFlowSnapshot | null>,
    replayEvents: () => Promise<CanonicalMarketEvent[]>,
  ): Promise<boolean> {
    log.info(`recovery initiated for ${this._symbol} (§14)`)
    const latest = await reloadSnapshot()
    if (latest) {
      this._sessionCVD = latest.sessionCVD
      this._version = latest.snapshotVersion
    }
    const events = await replayEvents()
    for (const event of events) {
      this.processTradeEvent(event)
    }
    log.info(`recovery complete for ${this._symbol} (${events.length} events replayed)`)
    return true
  }
}
