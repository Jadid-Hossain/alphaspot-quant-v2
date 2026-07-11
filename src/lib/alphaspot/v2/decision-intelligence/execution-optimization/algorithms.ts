// CHAPTER 5.7 §7 — Execution Algorithms
//
// §7 — 12 execution algorithms:
//   1.  Market Execution
//   2.  Limit Execution
//   3.  TWAP (Time-Weighted Average Price)
//   4.  VWAP (Volume-Weighted Average Price)
//   5.  POV (Participation of Volume)
//   6.  Implementation Shortfall
//   7.  Arrival Price
//   8.  Iceberg Execution
//   9.  Sniper Execution
//  10.  Pegged Orders
//  11.  Adaptive Execution
//  12.  Hybrid Execution
//
// Rule 6 — Fully configurable + version controlled.
// Rule 7 — Parent-order decomposition preserves investment intent + total quantity.
// Rule 8 — Aggregate child quantity EXACTLY equals parent quantity.
// Rule 12 — Deterministic schedules.
// Rule 13 — Algorithm selection per urgency, liquidity, participation, cost.
// Rule 14 — Child-order timing + sizing independently version controlled.
// Rule 15 — Minimize implementation shortfall.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AlgorithmParameters,
  ChildOrderPlan,
  ExecutionAlgorithm,
  ExecutionSchedule,
} from './types'

const log = createLogger('decision-intelligence:execution-optimization:algorithms')

// ─────────────────────────────────────────────────────────────────────────────
// AlgorithmInput — bundled data needed by all algorithms
// ─────────────────────────────────────────────────────────────────────────────

export interface AlgorithmInput {
  parentOrderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  totalQuantity: number
  price: number
  averageDailyVolume: number
  orderBookDepth: number
  bidAskSpread: number
  volatility: number
  urgency: string
  startTime: number
  /** Max execution duration (ms). */
  maxDurationMs: number
  parameters: AlgorithmParameters
  randomSeed: number
}

// ─────────────────────────────────────────────────────────────────────────────
// AlgorithmResult — output of an algorithm
// ─────────────────────────────────────────────────────────────────────────────

export interface AlgorithmResult {
  algorithm: ExecutionAlgorithm
  schedule: ExecutionSchedule
  childOrders: ChildOrderPlan[]
  /** Algorithm version (Rule 6, Rule 14). */
  algorithmVersion: string
  metadata: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// AlgorithmExecutor interface (§7, Rule 6, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface AlgorithmExecutor {
  algorithm: ExecutionAlgorithm
  version: string // Rule 6, Rule 14
  execute(input: AlgorithmInput): AlgorithmResult
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic pseudo-random generator (Rule 12, Rule 24)
// Same seed → same output → deterministic schedules.
// ─────────────────────────────────────────────────────────────────────────────

export class DeterministicRandom {
  private seed: number
  constructor(seed: number) {
    this.seed = seed
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Market Execution (§7)
// Single child order, immediate execution.
// ─────────────────────────────────────────────────────────────────────────────

export class MarketExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'MARKET'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    const now = input.startTime
    const childOrderId = `child-${now.toString(36)}-0`
    const child: ChildOrderPlan = {
      childOrderId,
      parentOrderId: input.parentOrderId,
      sequence: 1,
      quantity: input.totalQuantity, // Rule 8 — exact parent quantity
      scheduledTime: now,
      plannedDurationMs: 1000,
      algorithm: 'MARKET',
      state: 'PLANNED',
      filledQuantity: 0,
      residualQuantity: 0,
      randomized: false,
      executedAt: null,
    }
    const schedule: ExecutionSchedule = {
      startTime: now,
      expectedCompletionTime: now + 1000,
      totalDurationMs: 1000,
      sliceCount: 1,
      slices: [{ sequence: 1, scheduledTime: now, quantity: input.totalQuantity, participationRate: 0 }],
      targetParticipationRate: 1.0,
      randomized: false,
    }
    return {
      algorithm: this.algorithm,
      schedule,
      childOrders: [child],
      algorithmVersion: this.version,
      metadata: { immediate: true },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Limit Execution (§7)
// Single limit order at offset from mid.
// ─────────────────────────────────────────────────────────────────────────────

export class LimitExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'LIMIT'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    const now = input.startTime
    const offsetBps = input.parameters.limitOffsetBps
    const child: ChildOrderPlan = {
      childOrderId: `child-${now.toString(36)}-0`,
      parentOrderId: input.parentOrderId,
      sequence: 1,
      quantity: input.totalQuantity,
      scheduledTime: now,
      plannedDurationMs: input.parameters.maxChildDurationMs,
      algorithm: 'LIMIT',
      state: 'PLANNED',
      filledQuantity: 0,
      residualQuantity: 0,
      randomized: false,
      executedAt: null,
    }
    const schedule: ExecutionSchedule = {
      startTime: now,
      expectedCompletionTime: now + input.parameters.maxChildDurationMs,
      totalDurationMs: input.parameters.maxChildDurationMs,
      sliceCount: 1,
      slices: [{ sequence: 1, scheduledTime: now, quantity: input.totalQuantity, participationRate: 0 }],
      targetParticipationRate: 0,
      randomized: false,
    }
    return {
      algorithm: this.algorithm,
      schedule,
      childOrders: [child],
      algorithmVersion: this.version,
      metadata: { limitOffsetBps: offsetBps },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TWAP (§7)
// Time-Weighted Average Price — equal slices over time.
// ─────────────────────────────────────────────────────────────────────────────

export class TWAPExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'TWAP'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    const slices = Math.max(1, input.parameters.twapSlices)
    const sliceDuration = input.maxDurationMs / slices
    const baseSliceQty = input.totalQuantity / slices // Rule 8 — exact total

    const rng = new DeterministicRandom(input.randomSeed)
    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []

    let remainingQty = input.totalQuantity
    for (let i = 0; i < slices; i++) {
      const isLast = i === slices - 1
      // Apply quantity jitter (Rule 24) — last slice gets residual to ensure Rule 8
      let qty = baseSliceQty
      if (!isLast) {
        const jitter = (rng.next() - 0.5) * 2 * 0.05 // ±5%
        qty = baseSliceQty * (1 + jitter)
      } else {
        qty = remainingQty // Rule 8 — exact total
      }
      // Timing jitter (Rule 24)
      const timingJitter = rng.nextRange(-1000, 1000)
      const scheduledTime = input.startTime + i * sliceDuration + timingJitter

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: sliceDuration,
        algorithm: 'TWAP',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({
        sequence: i + 1,
        scheduledTime,
        quantity: qty,
        participationRate: 0,
      })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount: slices,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { slices, sliceDuration, totalQuantity: input.totalQuantity },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. VWAP (§7)
// Volume-Weighted Average Price — slices weighted by volume profile.
// ─────────────────────────────────────────────────────────────────────────────

export class VWAPExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'VWAP'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    const buckets = Math.max(1, input.parameters.vwapBuckets)
    const bucketDuration = input.maxDurationMs / buckets

    // Synthetic volume profile (U-shaped: higher at open/close)
    const volumeProfile: number[] = []
    let totalVolume = 0
    for (let i = 0; i < buckets; i++) {
      const t = i / buckets
      const vol = 1 + 0.5 * Math.abs(Math.sin(t * Math.PI)) // U-shape
      volumeProfile.push(vol)
      totalVolume += vol
    }

    const rng = new DeterministicRandom(input.randomSeed)
    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity

    for (let i = 0; i < buckets; i++) {
      const isLast = i === buckets - 1
      const fraction = volumeProfile[i] / totalVolume
      let qty = input.totalQuantity * fraction
      if (isLast) {
        qty = remainingQty // Rule 8 — exact total
      } else {
        const jitter = (rng.next() - 0.5) * 2 * 0.03
        qty = qty * (1 + jitter)
      }
      const timingJitter = rng.nextRange(-500, 500)
      const scheduledTime = input.startTime + i * bucketDuration + timingJitter

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: bucketDuration,
        algorithm: 'VWAP',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({
        sequence: i + 1,
        scheduledTime,
        quantity: qty,
        participationRate: 0,
      })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount: buckets,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { buckets, volumeProfile: 'U-shaped' },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. POV (§7)
// Participation of Volume — slices based on market volume.
// ─────────────────────────────────────────────────────────────────────────────

export class POVExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'POV'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    const targetRate = input.parameters.povTargetRate
    const advPerMs = input.averageDailyVolume / (1000 * 60 * 60 * 24) // ADV per ms
    // Estimate slices needed
    const estVolumeOverPeriod = advPerMs * input.maxDurationMs
    const estExecutedQty = estVolumeOverPeriod * targetRate
    const sliceCount = Math.max(1, Math.ceil(Math.min(input.totalQuantity, estExecutedQty) / Math.max(0.0001, input.parameters.minChildSize)))
    const sliceDuration = input.maxDurationMs / sliceCount

    const rng = new DeterministicRandom(input.randomSeed)
    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity
    const baseSliceQty = input.totalQuantity / sliceCount

    for (let i = 0; i < sliceCount; i++) {
      const isLast = i === sliceCount - 1
      let qty = isLast ? remainingQty : baseSliceQty
      if (!isLast) {
        const jitter = (rng.next() - 0.5) * 2 * 0.05
        qty = baseSliceQty * (1 + jitter)
      }
      const timingJitter = rng.nextRange(-500, 500)
      const scheduledTime = input.startTime + i * sliceDuration + timingJitter

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: sliceDuration,
        algorithm: 'POV',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({
        sequence: i + 1,
        scheduledTime,
        quantity: qty,
        participationRate: targetRate,
      })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount,
      slices: scheduleSlices,
      targetParticipationRate: targetRate,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { targetRate, advPerMs, sliceCount },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Implementation Shortfall (§7)
// Minimizes IS = market impact + timing risk + opportunity cost.
// Front-loads execution when urgency is high.
// ─────────────────────────────────────────────────────────────────────────────

export class ImplementationShortfallExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'IMPLEMENTATION_SHORTFALL'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    // IS front-loads: more quantity in early slices
    const slices = Math.max(1, input.parameters.twapSlices)
    const sliceDuration = input.maxDurationMs / slices
    const rng = new DeterministicRandom(input.randomSeed)

    // Decay schedule: front-loaded
    const decayFactors: number[] = []
    let totalDecay = 0
    for (let i = 0; i < slices; i++) {
      const factor = Math.exp(-i * 0.2) // exponential decay
      decayFactors.push(factor)
      totalDecay += factor
    }

    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity

    for (let i = 0; i < slices; i++) {
      const isLast = i === slices - 1
      const fraction = decayFactors[i] / totalDecay
      let qty = input.totalQuantity * fraction
      if (isLast) {
        qty = remainingQty
      } else {
        const jitter = (rng.next() - 0.5) * 2 * 0.03
        qty = qty * (1 + jitter)
      }
      const scheduledTime = input.startTime + i * sliceDuration + rng.nextRange(-500, 500)

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: sliceDuration,
        algorithm: 'IMPLEMENTATION_SHORTFALL',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({ sequence: i + 1, scheduledTime, quantity: qty, participationRate: 0 })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount: slices,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { schedule: 'front-loaded decay', slices },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Arrival Price (§7)
// Benchmark to arrival price — execute quickly to minimize deviation.
// ─────────────────────────────────────────────────────────────────────────────

export class ArrivalPriceExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'ARRIVAL_PRICE'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    // Arrival price: execute in few slices quickly
    const slices = Math.min(3, Math.max(1, input.parameters.twapSlices))
    const sliceDuration = Math.min(60000, input.maxDurationMs / slices) // max 1 min per slice
    const baseSliceQty = input.totalQuantity / slices
    const rng = new DeterministicRandom(input.randomSeed)

    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity

    for (let i = 0; i < slices; i++) {
      const isLast = i === slices - 1
      let qty = isLast ? remainingQty : baseSliceQty
      if (!isLast) {
        const jitter = (rng.next() - 0.5) * 2 * 0.02
        qty = baseSliceQty * (1 + jitter)
      }
      const scheduledTime = input.startTime + i * sliceDuration

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: sliceDuration,
        algorithm: 'ARRIVAL_PRICE',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({ sequence: i + 1, scheduledTime, quantity: qty, participationRate: 0 })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + slices * sliceDuration,
      totalDurationMs: slices * sliceDuration,
      sliceCount: slices,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { slices, benchmark: 'arrival_price' },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Iceberg Execution (§7)
// Hidden quantity — small visible slices.
// ─────────────────────────────────────────────────────────────────────────────

export class IcebergExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'ICEBERG'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    const visibleFraction = input.parameters.icebergVisibleFraction
    const visibleQty = Math.max(input.parameters.minChildSize, input.totalQuantity * visibleFraction)
    const sliceCount = Math.max(1, Math.ceil(input.totalQuantity / visibleQty))
    const sliceDuration = input.maxDurationMs / sliceCount
    const rng = new DeterministicRandom(input.randomSeed)

    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity

    for (let i = 0; i < sliceCount; i++) {
      const isLast = i === sliceCount - 1
      let qty = isLast ? remainingQty : Math.min(visibleQty, remainingQty)
      if (!isLast) {
        // Randomize visible tip slightly (Rule 24 — iceberg refresh)
        const jitter = (rng.next() - 0.5) * 2 * 0.1
        qty = Math.min(qty * (1 + jitter), remainingQty)
      }
      const scheduledTime = input.startTime + i * sliceDuration + rng.nextRange(-1000, 1000)

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: sliceDuration,
        algorithm: 'ICEBERG',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({ sequence: i + 1, scheduledTime, quantity: qty, participationRate: 0 })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { visibleFraction, sliceCount, visibleQty },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Sniper Execution (§7)
// Opportunistic aggressive — waits for liquidity, then strikes.
// ─────────────────────────────────────────────────────────────────────────────

export class SniperExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'SNIPER'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    // Sniper: few large slices when liquidity appears
    const aggressionThreshold = input.parameters.sniperAggressionThreshold
    const slices = Math.max(1, Math.ceil(input.totalQuantity / (input.averageDailyVolume * 0.01)))
    const sliceDuration = input.maxDurationMs / slices
    const rng = new DeterministicRandom(input.randomSeed)

    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity
    const baseSliceQty = input.totalQuantity / slices

    for (let i = 0; i < slices; i++) {
      const isLast = i === slices - 1
      let qty = isLast ? remainingQty : baseSliceQty
      if (!isLast) {
        const jitter = (rng.next() - 0.5) * 2 * 0.1
        qty = baseSliceQty * (1 + jitter)
      }
      // Random timing (sniper waits for opportunity)
      const timingJitter = rng.nextRange(-2000, 2000)
      const scheduledTime = input.startTime + i * sliceDuration + timingJitter

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: sliceDuration,
        algorithm: 'SNIPER',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({ sequence: i + 1, scheduledTime, quantity: qty, participationRate: 0 })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount: slices,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { aggressionThreshold, slices },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Pegged Orders (§7)
// Pegged to reference price (e.g., mid or best bid/ask).
// ─────────────────────────────────────────────────────────────────────────────

export class PeggedExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'PEGGED'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    // Pegged: single order pegged to mid, refreshed periodically
    const refreshCount = Math.max(1, Math.floor(input.maxDurationMs / input.parameters.maxChildDurationMs))
    const refreshDuration = input.maxDurationMs / refreshCount
    const rng = new DeterministicRandom(input.randomSeed)
    const baseSliceQty = input.totalQuantity / refreshCount

    const childOrders: ChildOrderPlan[] = []
    const scheduleSlices: ExecutionSchedule['slices'] = []
    let remainingQty = input.totalQuantity

    for (let i = 0; i < refreshCount; i++) {
      const isLast = i === refreshCount - 1
      let qty = isLast ? remainingQty : baseSliceQty
      if (!isLast) {
        const jitter = (rng.next() - 0.5) * 2 * 0.03
        qty = baseSliceQty * (1 + jitter)
      }
      const scheduledTime = input.startTime + i * refreshDuration

      childOrders.push({
        childOrderId: `child-${input.startTime.toString(36)}-${i}`,
        parentOrderId: input.parentOrderId,
        sequence: i + 1,
        quantity: qty,
        scheduledTime,
        plannedDurationMs: refreshDuration,
        algorithm: 'PEGGED',
        state: 'PLANNED',
        filledQuantity: 0,
        residualQuantity: 0,
        randomized: true,
        executedAt: null,
      })
      scheduleSlices.push({ sequence: i + 1, scheduledTime, quantity: qty, participationRate: 0 })
      remainingQty -= qty
    }

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: input.startTime + input.maxDurationMs,
      totalDurationMs: input.maxDurationMs,
      sliceCount: refreshCount,
      slices: scheduleSlices,
      targetParticipationRate: 0,
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { refreshCount, pegType: 'mid' },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Adaptive Execution (§7, §10A, Rule 19, Rule 26)
// Dynamically switches algorithm based on conditions.
// ─────────────────────────────────────────────────────────────────────────────

export class AdaptiveExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'ADAPTIVE'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    // Adaptive: start with TWAP, can switch mid-flight
    // Initial plan uses TWAP; adaptation engine handles switches
    const twap = new TWAPExecutor()
    const result = twap.execute(input)
    return {
      ...result,
      algorithm: this.algorithm,
      algorithmVersion: this.version,
      metadata: { ...result.metadata, adaptive: true, baseAlgorithm: 'TWAP' },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Hybrid Execution (§7)
// Combination of algorithms (e.g., 50% TWAP + 50% POV).
// ─────────────────────────────────────────────────────────────────────────────

export class HybridExecutor implements AlgorithmExecutor {
  algorithm: ExecutionAlgorithm = 'HYBRID'
  version = '1.0.0'

  execute(input: AlgorithmInput): AlgorithmResult {
    // Hybrid: split quantity between TWAP and POV
    const twapSplit = 0.5
    const twapQty = input.totalQuantity * twapSplit
    const povQty = input.totalQuantity * (1 - twapSplit)

    const twapInput = { ...input, totalQuantity: twapQty }
    const povInput = { ...input, totalQuantity: povQty, randomSeed: input.randomSeed + 1 }

    const twapResult = new TWAPExecutor().execute(twapInput)
    const povResult = new POVExecutor().execute(povInput)

    // Merge child orders
    const childOrders: ChildOrderPlan[] = [...twapResult.childOrders, ...povResult.childOrders]
    // Renumber sequences
    childOrders.forEach((c, i) => { c.sequence = i + 1 })

    const allSlices = [...twapResult.schedule.slices, ...povResult.schedule.slices]
    allSlices.sort((a, b) => a.scheduledTime - b.scheduledTime)
    allSlices.forEach((s, i) => { s.sequence = i + 1 })

    const schedule: ExecutionSchedule = {
      startTime: input.startTime,
      expectedCompletionTime: Math.max(twapResult.schedule.expectedCompletionTime, povResult.schedule.expectedCompletionTime),
      totalDurationMs: input.maxDurationMs,
      sliceCount: childOrders.length,
      slices: allSlices,
      targetParticipationRate: povResult.schedule.targetParticipationRate * (1 - twapSplit),
      randomized: true,
    }

    return {
      algorithm: this.algorithm,
      schedule,
      childOrders,
      algorithmVersion: this.version,
      metadata: { twapSplit, twapQty, povQty },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AlgorithmRegistry (§7, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export class AlgorithmRegistry {
  private executors = new Map<ExecutionAlgorithm, AlgorithmExecutor>()

  constructor() {
    this.register(new MarketExecutor())
    this.register(new LimitExecutor())
    this.register(new TWAPExecutor())
    this.register(new VWAPExecutor())
    this.register(new POVExecutor())
    this.register(new ImplementationShortfallExecutor())
    this.register(new ArrivalPriceExecutor())
    this.register(new IcebergExecutor())
    this.register(new SniperExecutor())
    this.register(new PeggedExecutor())
    this.register(new AdaptiveExecutor())
    this.register(new HybridExecutor())
  }

  register(executor: AlgorithmExecutor): void {
    this.executors.set(executor.algorithm, executor)
    log.info(`registered execution algorithm: ${executor.algorithm} v${executor.version}`)
  }

  get(algorithm: ExecutionAlgorithm): AlgorithmExecutor | null {
    return this.executors.get(algorithm) ?? null
  }

  listAlgorithms(): ExecutionAlgorithm[] {
    return Array.from(this.executors.keys())
  }
}

export const algorithmRegistry = new AlgorithmRegistry()
