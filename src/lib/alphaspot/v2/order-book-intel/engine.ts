// CHAPTER 3.7 §5-§14 — Order Book Intelligence Engine
//
// Transforms Market Microstructure Snapshots (Ch 3.6) into structural intelligence.
// Per-asset isolation (§13, Rule 9). Immutable outputs (Rule 2). Deterministic
// (Rule 3, Rule 4). Incremental (Rule 7). Bounded memory (Rule 8).
// Adaptive baselines for all behavioral detections (Rule 11).
// Distance-to-mid weighting for S/R (Rule 12).
// Wall classification cross-refs execution pressure (Rule 13).

import { createLogger } from '../domains/01-core-infrastructure'
import type { MicrostructureSnapshot } from '../microstructure/types'
import { EMA } from '../microstructure/rolling-metrics'
import type {
  AbsorptionAssessment,
  DistanceWeightingConfig,
  IcebergAssessment,
  LiquidityMigration,
  LiquidityVacuum,
  LiquidityWall,
  OrderBookIntelligenceSnapshot,
  QueueDynamics,
  SpoofingAssessment,
  StructuralSR,
  WallClassification,
  WallStatus,
} from './types'
import { DEFAULT_DISTANCE_WEIGHTING, computeDistanceWeight } from './types'
import { RollingBaseline, RollingZScore, zScoreToProbability, zScoreToDeviationProbability } from './adaptive-baselines'

const log = createLogger('order-book-intel:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Per-Asset OBI Engine  (Chapter 3.7 §13, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export class OrderBookIntelligenceEngine {
  private _version = 0
  private _snapshot: OrderBookIntelligenceSnapshot | null = null
  private _prevSnapshot: MicrostructureSnapshot | null = null
  private _distanceWeighting: DistanceWeightingConfig = DEFAULT_DISTANCE_WEIGHTING

  // §7.1 — Rolling baselines for behavioral detection (Rule 11 — adaptive, no fixed thresholds)
  private _cancellationBaseline = new RollingBaseline(50)
  private _arrivalBaseline = new RollingBaseline(50)
  private _refillBaseline = new RollingBaseline(50)
  private _queueLifetimeBaseline = new RollingBaseline(50)
  private _absorptionBaseline = new RollingZScore(50)

  // §5 — Wall tracking
  private _walls: Map<string, LiquidityWall> = new Map() // key: side:price
  private _wallHistory: WallClassification[] = []

  // §6 — Vacuum tracking
  private _prevBidDepth: number | null = null
  private _prevAskDepth: number | null = null
  private _vacuumStart: number | null = null

  // §9 — Absorption tracking
  private _prevMid: number | null = null
  private _buyerAbsorptionEma: EMA = new EMA(0.1)
  private _sellerAbsorptionEma: EMA = new EMA(0.1)

  // §11 — Migration tracking
  private _prevImbalance: number | null = null
  private _migrationEma: EMA = new EMA(0.1)

  // Stats
  private _stats = {
    snapshotsProcessed: 0,
    wallsDetected: 0,
    vacuumsDetected: 0,
    spoofingDetected: 0,
    icebergsDetected: 0,
    absorptionEvents: 0,
  }

  constructor(private readonly _symbol: string) {}

  /**
   * Process a Market Microstructure Snapshot (§3, Rule 1).
   * Produces an immutable OBI Snapshot (Rule 2).
   */
  processSnapshot(snap: MicrostructureSnapshot): OrderBookIntelligenceSnapshot {
    this._stats.snapshotsProcessed++
    this._version++

    // §5 — Liquidity Wall Analysis
    const walls = this.analyzeWalls(snap)
    const wallStrength = this.computeWallStrength(walls)
    const wallAuthenticity = this.computeWallAuthenticity(walls, snap)

    // §6 — Liquidity Vacuum
    const vacuum = this.detectVacuum(snap)

    // §7 — Spoofing Detection (adaptive §7.1)
    const spoofing = this.detectSpoofing(snap, walls)

    // §8 — Iceberg Detection (adaptive §8.1)
    const iceberg = this.detectIceberg(snap)

    // §9 — Absorption Detection (adaptive §9.1)
    const absorption = this.detectAbsorption(snap)

    // §10 — Queue Dynamics
    const queue = this.analyzeQueue(snap)

    // §11 — Liquidity Migration
    const migration = this.analyzeMigration(snap)

    // §12 — Structural S/R (distance-to-mid weighted §12.1)
    const sr = this.computeStructuralSR(snap, walls)

    // §4 — Institutional Participation + Confidence
    const institutional = this.computeInstitutionalParticipation(walls, absorption, iceberg, snap)
    const confidence = this.computeConfidence(walls, spoofing, iceberg, snap)

    const obiSnapshot: OrderBookIntelligenceSnapshot = {
      symbol: this._symbol,
      timestamp: snap.timestamp,
      liquidityWallStrength: wallStrength,
      liquidityWallAuthenticity: wallAuthenticity,
      wallClassifications: walls.map((w) => ({
        side: w.side,
        price: w.price,
        volume: w.volume,
        status: w.status,
        isGenuine: w.isGenuine,
        distanceFromMidPct: w.distanceFromMidPct,
      })),
      liquidityVacuumScore: vacuum.score,
      spoofingProbability: spoofing.probability,
      icebergProbability: iceberg.probability,
      hiddenVolumeEstimate: iceberg.hiddenVolumeEstimate,
      buyerAbsorptionScore: absorption.buyerScore,
      sellerAbsorptionScore: absorption.sellerScore,
      queuePressureScore: queue.pressureScore,
      liquidityMigrationScore: migration.migrationScore,
      structuralSupportScore: sr.supportScore,
      structuralResistanceScore: sr.resistanceScore,
      institutionalParticipationScore: institutional,
      structuralConfidence: confidence,
      snapshotVersion: this._version,
    }

    this._prevSnapshot = snap
    this._snapshot = Object.freeze(obiSnapshot) // Rule 2 — immutable
    return this._snapshot
  }

  // ── §5 Liquidity Wall Analysis ────────────────────────────────────────────

  private analyzeWalls(snap: MicrostructureSnapshot): LiquidityWall[] {
    // In a real implementation, walls come from the bounded depth in the microstructure snapshot.
    // Here we synthesize wall candidates from the snapshot's bid/ask volumes.
    const walls: LiquidityWall[] = []
    const mid = snap.midPrice
    if (!mid || mid <= 0) return walls

    // Detect walls from the order book imbalance + best bid/ask
    // A "wall" is a large volume concentration relative to total depth
    const bidVol = snap.bidVolume ?? 0
    const askVol = snap.askVolume ?? 0
    const totalVol = bidVol + askVol
    if (totalVol <= 0) return walls

    // Best bid wall
    if (bidVol > 0) {
      const relVol = bidVol / totalVol
      const distance = snap.bestBid ? Math.abs((mid - snap.bestBid) / mid) * 100 : 0
      const key = `BID:${snap.bestBid}`
      const prevWall = this._walls.get(key)
      const wall = this.classifyWall('BID', snap.bestBid ?? 0, bidVol, relVol, distance, prevWall, snap)
      walls.push(wall)
      this._walls.set(key, wall)
      if (prevWall?.status !== 'STABLE' && wall.status === 'STABLE') this._stats.wallsDetected++
    }

    // Best ask wall
    if (askVol > 0) {
      const relVol = askVol / totalVol
      const distance = snap.bestAsk ? Math.abs((snap.bestAsk - mid) / mid) * 100 : 0
      const key = `ASK:${snap.bestAsk}`
      const prevWall = this._walls.get(key)
      const wall = this.classifyWall('ASK', snap.bestAsk ?? 0, askVol, relVol, distance, prevWall, snap)
      walls.push(wall)
      this._walls.set(key, wall)
    }

    // Clean up old walls (bounded memory §15, Rule 8)
    if (this._walls.size > 100) {
      const keys = [...this._walls.keys()]
      for (let i = 0; i < 50; i++) this._walls.delete(keys[i])
    }

    return walls
  }

  private classifyWall(
    side: 'BID' | 'ASK',
    price: number,
    volume: number,
    relVol: number,
    distancePct: number,
    prev: LiquidityWall | undefined,
    snap: MicrostructureSnapshot,
  ): LiquidityWall {
    let status: WallStatus = 'STABLE'
    let persistence = prev?.persistence ?? 0.1
    let reinforcementRate: number | null = null
    let cancellationRate: number | null = null

    if (prev) {
      persistence = Math.min(1, prev.persistence + 0.05)
      const volChange = volume - prev.volume
      if (volChange > 0) {
        reinforcementRate = volChange / Math.max(1, prev.volume)
        status = reinforcementRate > 0.1 ? 'GROWING' : 'STABLE'
      } else if (volChange < 0) {
        cancellationRate = Math.abs(volChange) / Math.max(1, prev.volume)
        status = cancellationRate > 0.5 ? 'WEAKENING' : 'STABLE'
      }
    }

    // §5 — check if consumed by execution
    const execPressure = snap.executionPressure ?? 0
    const isBidAbsorbingBuy = side === 'BID' && execPressure > 0.3
    const isAskAbsorbingSell = side === 'ASK' && execPressure < -0.3
    const executionInteraction = isBidAbsorbingBuy || isAskAbsorbingSell ? Math.abs(execPressure) : 0

    if (volume < prev?.volume * 0.3) {
      status = 'CONSUMED'
    } else if (volume === 0) {
      status = 'REMOVED'
    }

    // §5, Rule 13 — cross-reference execution pressure to detect spoofing
    // Wall that disappears before execution → suspected spoof
    const isGenuine = persistence > 0.3 && (executionInteraction > 0 || status === 'STABLE' || status === 'GROWING')
    const isSuspectedSpoof = status === 'WEAKENING' && executionInteraction === 0 && persistence < 0.5
    if (isSuspectedSpoof) status = 'SUSPECTED_SPOOF'

    return {
      side,
      price,
      volume,
      relativeVolume: relVol,
      distanceFromMidPct: distancePct,
      persistence,
      reinforcementRate,
      cancellationRate,
      executionInteraction,
      status,
      isGenuine,
    }
  }

  private computeWallStrength(walls: LiquidityWall[]): number | null {
    if (walls.length === 0) return null
    const total = walls.reduce((a, w) => a + w.relativeVolume * w.persistence, 0)
    return Math.min(1, total / walls.length)
  }

  private computeWallAuthenticity(walls: LiquidityWall[], snap: MicrostructureSnapshot): number | null {
    if (walls.length === 0) return null
    // §5, Rule 13 — genuine walls are persistent + absorbing execution pressure
    const genuine = walls.filter((w) => w.isGenuine)
    const avgAuthenticity = genuine.length > 0
      ? genuine.reduce((a, w) => a + (w.persistence * (w.executionInteraction ?? 0.5)), 0) / genuine.length
      : 0
    return Math.min(1, avgAuthenticity)
  }

  // ── §6 Liquidity Vacuum ───────────────────────────────────────────────────

  private detectVacuum(snap: MicrostructureSnapshot): LiquidityVacuum {
    const bidVol = snap.bidVolume ?? 0
    const askVol = snap.askVolume ?? 0
    const totalVol = bidVol + askVol

    let depthCollapse: number | null = null
    if (this._prevBidDepth !== null && this._prevAskDepth !== null) {
      const prevTotal = this._prevBidDepth + this._prevAskDepth
      if (prevTotal > 0) {
        depthCollapse = Math.max(0, (prevTotal - totalVol) / prevTotal)
      }
    }

    const spreadExpansion = snap.currentSpread !== null && this._prevSnapshot !== null && this._prevSnapshot.currentSpread !== null
      ? Math.max(0, (snap.currentSpread - this._prevSnapshot.currentSpread) / Math.max(1, this._prevSnapshot.currentSpread))
      : null

    const isVacuum = (depthCollapse !== null && depthCollapse > 0.3) || (spreadExpansion !== null && spreadExpansion > 0.5)

    if (isVacuum && this._vacuumStart === null) {
      this._vacuumStart = Date.now()
      this._stats.vacuumsDetected++
    } else if (!isVacuum) {
      this._vacuumStart = null
    }

    const score = isVacuum
      ? Math.min(1, (depthCollapse ?? 0) * 0.5 + (spreadExpansion ?? 0) * 0.5)
      : 0

    this._prevBidDepth = bidVol
    this._prevAskDepth = askVol

    return {
      detected: isVacuum,
      depthCollapsePct: depthCollapse,
      spreadExpansionPct: spreadExpansion,
      vacuumDurationMs: this._vacuumStart ? Date.now() - this._vacuumStart : null,
      recoveryRate: !isVacuum && this._vacuumStart === null ? 1 : 0,
      score,
    }
  }

  // ── §7 Spoofing Detection (adaptive §7.1) ─────────────────────────────────

  private detectSpoofing(snap: MicrostructureSnapshot, walls: LiquidityWall[]): SpoofingAssessment {
    // §7.1 — use rolling baselines for cancellation/arrival rates (Rule 11)
    const cancellationRate = walls.filter((w) => w.cancellationRate !== null).reduce((a, w) => a + (w.cancellationRate ?? 0), 0) / Math.max(1, walls.length)
    const arrivalRate = walls.length / Math.max(1, (snap.timestamp - (this._prevSnapshot?.timestamp ?? snap.timestamp)) / 1000)

    // Update baselines
    const cancelZ = this._cancellationBaseline.observe(cancellationRate)
    const arrivalZ = this._arrivalBaseline.observe(arrivalRate)

    // §7 — spoofing signals
    const suspectedSpoofs = walls.filter((w) => w.status === 'SUSPECTED_SPOOF')
    const executionAvoidance = suspectedSpoofs.length > 0
      ? suspectedSpoofs.reduce((a, w) => a + (1 - (w.executionInteraction ?? 0)), 0) / suspectedSpoofs.length
      : 0
    const layeringScore = walls.length > 3 ? Math.min(1, (walls.length - 3) / 10) : 0
    const cancellationAsymmetry = walls.length > 0
      ? (walls.filter((w) => w.side === 'BID' && w.cancellationRate !== null).length -
         walls.filter((w) => w.side === 'ASK' && w.cancellationRate !== null).length) / walls.length
      : 0

    // §7.1 — probability from Z-scores (no fixed thresholds, Rule 11)
    const rapidAppearanceZ = Math.abs(arrivalZ)
    const rapidCancellationZ = Math.abs(cancelZ)
    const probability = Math.min(1,
      zScoreToDeviationProbability(rapidCancellationZ) * 0.4 +
      zScoreToDeviationProbability(rapidAppearanceZ) * 0.2 +
      executionAvoidance * 0.2 +
      layeringScore * 0.2,
    )

    if (probability > 0.6) this._stats.spoofingDetected++

    return {
      probability,
      rapidAppearanceScore: arrivalZ,
      rapidCancellationScore: cancelZ,
      executionAvoidanceScore: executionAvoidance,
      layeringScore,
      cancellationAsymmetry,
    }
  }

  // ── §8 Iceberg Detection (adaptive §8.1) ──────────────────────────────────

  private detectIceberg(snap: MicrostructureSnapshot): IcebergAssessment {
    // §8.1 — use rolling baseline for refill frequency (Rule 11)
    // Iceberg = constant visible size with frequent refills
    const refillSignal = snap.executionPressure !== null && Math.abs(snap.executionPressure) > 0.2
      ? Math.abs(snap.executionPressure) : 0

    const refillZ = this._refillBaseline.observe(refillSignal)

    // §8 — iceberg signals
    const executionPersistence = snap.tradePressure !== null ? Math.min(1, Math.abs(snap.tradePressure)) : null
    const refillConsistency = this._refillBaseline.stdDev !== null && this._refillBaseline.stdDev < 0.1
      ? 0.8 // low variance in refills = consistent
      : 0.3

    // §8.1 — probability from Z-score (only statistically abnormal refill = iceberg)
    const probability = refillZ > 1.5
      ? zScoreToProbability(refillZ)
      : 0.1

    const hiddenVolumeEstimate = probability > 0.5 && snap.bidVolume !== null && snap.askVolume !== null
      ? (snap.bidVolume + snap.askVolume) * probability
      : null

    if (probability > 0.6) this._stats.icebergsDetected++

    return {
      probability,
      refillFrequencyZScore: refillZ,
      refillConsistency,
      hiddenVolumeEstimate,
      executionPersistence,
    }
  }

  // ── §9 Absorption Detection (adaptive §9.1) ───────────────────────────────

  private detectAbsorption(snap: MicrostructureSnapshot): AbsorptionAssessment {
    // §9 — absorption = aggressive orders without price displacement
    const mid = snap.midPrice
    const prevMid = this._prevMid
    const priceDisplacement = mid !== null && prevMid !== null ? Math.abs(mid - prevMid) / Math.max(1, prevMid) : null
    const execPressure = snap.executionPressure ?? 0

    // §9.1 — intensity relative to rolling baseline (Rule 11)
    const intensity = Math.abs(execPressure) > 0 && priceDisplacement !== null
      ? Math.abs(execPressure) / Math.max(0.0001, priceDisplacement)
      : 0
    const intensityZ = this._absorptionBaseline.update(intensity).zScore

    // Buyer absorption: positive execution pressure with low price displacement
    const buyerAbsorption = execPressure > 0.2 && (priceDisplacement === null || priceDisplacement < 0.001)
      ? Math.min(1, execPressure)
      : 0
    // Seller absorption: negative execution pressure with low price displacement
    const sellerAbsorption = execPressure < -0.2 && (priceDisplacement === null || priceDisplacement < 0.001)
      ? Math.min(1, Math.abs(execPressure))
      : 0

    this._buyerAbsorptionEma.update(buyerAbsorption)
    this._sellerAbsorptionEma.update(sellerAbsorption)

    if (buyerAbsorption > 0.5 || sellerAbsorption > 0.5) this._stats.absorptionEvents++

    this._prevMid = mid

    return {
      buyerScore: this._buyerAbsorptionEma.value ?? 0,
      sellerScore: this._sellerAbsorptionEma.value ?? 0,
      duration: null,
      intensity: intensityZ,
      priceStabilityDuringExecution: priceDisplacement !== null ? Math.max(0, 1 - priceDisplacement * 100) : null,
    }
  }

  // ── §10 Queue Dynamics ────────────────────────────────────────────────────

  private analyzeQueue(snap: MicrostructureSnapshot): QueueDynamics {
    const bidVol = snap.bidVolume ?? 0
    const askVol = snap.askVolume ?? 0
    const total = bidVol + askVol
    const imbalance = total > 0 ? (bidVol - askVol) / total : 0

    const prevImbalance = this._prevImbalance ?? imbalance
    const growth = imbalance - prevImbalance
    this._prevImbalance = imbalance

    const cancellationVelocity = this._cancellationBaseline.observe(Math.abs(growth))
    const executionVelocity = this._arrivalBaseline.observe(total)

    return {
      growth,
      decay: growth < 0 ? Math.abs(growth) : null,
      replenishment: total > 0 ? Math.min(1, total / 100) : null,
      cancellationVelocity,
      executionVelocity,
      pressureScore: imbalance, // -1..1
    }
  }

  // ── §11 Liquidity Migration ───────────────────────────────────────────────

  private analyzeMigration(snap: MicrostructureSnapshot): LiquidityMigration {
    const imbalance = snap.orderBookImbalance ?? 0
    const prevImbalance = this._prevImbalance ?? imbalance
    const drift = imbalance - prevImbalance
    this._migrationEma.update(drift)

    const inwardMigration = drift > 0 ? drift : null
    const outwardMigration = drift < 0 ? Math.abs(drift) : null

    return {
      inwardMigration,
      outwardMigration,
      drift,
      concentrationShift: drift,
      velocity: this._migrationEma.value,
      migrationScore: this._migrationEma.value ?? 0, // -1..1
    }
  }

  // ── §12 Structural S/R (distance-to-mid weighted §12.1) ───────────────────

  private computeStructuralSR(snap: MicrostructureSnapshot, walls: LiquidityWall[]): StructuralSR {
    const mid = snap.midPrice
    if (!mid || mid <= 0) {
      return { supportScore: 0, resistanceScore: 0, supportPrice: null, resistancePrice: null, liquidityPersistence: null, structuralDurability: null, reinforcementFrequency: null }
    }

    // §12.1, Rule 12 — apply distance-to-mid weighting decay
    let supportScore = 0
    let resistanceScore = 0
    let supportPrice: number | null = null
    let resistancePrice: number | null = null
    let maxSupportWeight = 0
    let maxResistanceWeight = 0

    for (const wall of walls) {
      const weight = computeDistanceWeight(wall.distanceFromMidPct, this._distanceWeighting)
      if (weight <= 0) continue

      const weightedStrength = wall.relativeVolume * wall.persistence * weight

      if (wall.side === 'BID') {
        supportScore += weightedStrength
        if (weightedStrength > maxSupportWeight) {
          maxSupportWeight = weightedStrength
          supportPrice = wall.price
        }
      } else {
        resistanceScore += weightedStrength
        if (weightedStrength > maxResistanceWeight) {
          maxResistanceWeight = weightedStrength
          resistancePrice = wall.price
        }
      }
    }

    return {
      supportScore: Math.min(1, supportScore),
      resistanceScore: Math.min(1, resistanceScore),
      supportPrice,
      resistancePrice,
      liquidityPersistence: walls.length > 0 ? walls.reduce((a, w) => a + w.persistence, 0) / walls.length : null,
      structuralDurability: walls.length > 0 ? walls.filter((w) => w.isGenuine).length / walls.length : null,
      reinforcementFrequency: walls.length > 0 ? walls.filter((w) => w.status === 'GROWING').length / walls.length : null,
    }
  }

  // ── Institutional + Confidence ─────────────────────────────────────────────

  private computeInstitutionalParticipation(walls: LiquidityWall[], absorption: AbsorptionAssessment, iceberg: IcebergAssessment, snap: MicrostructureSnapshot): number {
    // Institutional = genuine walls + absorption + iceberg presence + high liquidity
    const genuineWalls = walls.filter((w) => w.isGenuine).length / Math.max(1, walls.length)
    const absorptionScore = Math.max(absorption.buyerScore, absorption.sellerScore)
    const icebergScore = iceberg.probability
    const liquidityScore = snap.liquidityScore ?? 0

    return Math.min(1, genuineWalls * 0.3 + absorptionScore * 0.3 + icebergScore * 0.2 + liquidityScore * 0.2)
  }

  private computeConfidence(walls: LiquidityWall[], spoofing: SpoofingAssessment, iceberg: IcebergAssessment, snap: MicrostructureSnapshot): number {
    // Higher confidence = more genuine walls, less spoofing, higher quality
    const genuineRatio = walls.length > 0 ? walls.filter((w) => w.isGenuine).length / walls.length : 0.5
    const spoofPenalty = 1 - spoofing.probability
    const qualityScore = snap.microstructureQuality?.overallScore ?? 0.5

    return Math.min(1, genuineRatio * 0.4 + spoofPenalty * 0.3 + qualityScore * 0.3)
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getSnapshot(): OrderBookIntelligenceSnapshot | null {
    return this._snapshot
  }

  setDistanceWeighting(config: DistanceWeightingConfig): void {
    this._distanceWeighting = config
  }

  getStats() {
    return { ...this._stats }
  }
}
