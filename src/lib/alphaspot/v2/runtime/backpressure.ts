// CHAPTER 2.3 §13, §14 — Backpressure Management & Resource Scheduling
//
// When workload exceeds processing capacity, the platform must slow intake
// gracefully (§13). Realtime ingestion ALWAYS receives highest priority.
//
// Possible actions (§13):
//   • queueing
//   • prioritization
//   • temporary sampling
//   • deferred analytics
//
// Resource scheduling (§14): continuously balance CPU, memory, storage,
// worker utilization, queue depth. Long-running workloads never starve
// higher-priority processing.

import { createLogger } from '../domains/01-core-infrastructure'
import { workerPool } from './worker-pool'
import { writeCoordinator } from './write-coordinator'
import { cacheHierarchy } from './cache-hierarchy'

const log = createLogger('backpressure')

// ─────────────────────────────────────────────────────────────────────────────
// System load snapshot  (Chapter 2.3 §14)
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemLoad {
  workerQueueDepth: number
  workerActiveCount: number
  workerUtilization: number // 0..1
  writeQueueDepth: number
  cacheL1Entries: number
  cacheL2Entries: number
  cacheL1HitRate: number
  cacheL2HitRate: number
  memoryPressure: number // 0..1 (heuristic from cache fill)
  overallPressure: number // 0..1 (composite)
  timestamp: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Backpressure level  (Chapter 2.3 §13 — graceful slowdown)
// ─────────────────────────────────────────────────────────────────────────────

export type BackpressureLevel = 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL'

const LEVEL_THRESHOLDS = {
  NORMAL: 0.0,
  ELEVATED: 0.5,
  HIGH: 0.75,
  CRITICAL: 0.9,
}

export interface BackpressureAction {
  level: BackpressureLevel
  deferAnalytics: boolean
  sampleRealtime: boolean // drop some realtime ticks (last resort)
  freezeBackground: boolean
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Backpressure Manager  (Chapter 2.3 §13)
// ─────────────────────────────────────────────────────────────────────────────

class BackpressureManager {
  private currentLevel: BackpressureLevel = 'NORMAL'
  private currentAction: BackpressureAction = {
    level: 'NORMAL',
    deferAnalytics: false,
    sampleRealtime: false,
    freezeBackground: false,
    reason: 'System operating normally',
  }
  private history: Array<{ at: number; load: SystemLoad; action: BackpressureAction }> = []
  private readonly historyLimit = 500
  private monitorTimer: ReturnType<typeof setInterval> | null = null
  private samplingRatio = 1.0 // 1.0 = keep all ticks; <1.0 = drop some

  /** Start monitoring system load and applying backpressure. */
  start(intervalMs = 2000): void {
    if (this.monitorTimer) return
    this.monitorTimer = setInterval(() => this.assess(), intervalMs)
    log.info(`backpressure monitor started — assess every ${intervalMs}ms`)
  }

  stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = null
    }
  }

  /** Capture the current system load (§14). */
  captureLoad(): SystemLoad {
    const workerStats = workerPool.getStats()
    const writeStats = writeCoordinator.getStats()
    const cacheStats = cacheHierarchy.getStats()

    const workerUtilization = workerStats.activeWorkers / Math.max(1, workerPool.getConfig().maxConcurrency)
    const l1Fill = cacheStats.l1.entries / Math.max(1, 1000)
    const l2Fill = cacheStats.l2.entries / Math.max(1, 5000)
    const memoryPressure = Math.max(l1Fill, l2Fill)

    // Composite pressure: weighted blend of worker utilization, queue depth, memory
    const queuePressure = Math.min(1, (workerStats.queueDepth + writeStats.currentQueueDepth) / 1000)
    const overallPressure = Math.max(
      workerUtilization * 0.5 + queuePressure * 0.3 + memoryPressure * 0.2,
    )

    return {
      workerQueueDepth: workerStats.queueDepth,
      workerActiveCount: workerStats.activeWorkers,
      workerUtilization,
      writeQueueDepth: writeStats.currentQueueDepth,
      cacheL1Entries: cacheStats.l1.entries,
      cacheL2Entries: cacheStats.l2.entries,
      cacheL1HitRate: cacheStats.l1.hitRate,
      cacheL2HitRate: cacheStats.l2.hitRate,
      memoryPressure,
      overallPressure,
      timestamp: Date.now(),
    }
  }

  /** Assess load and determine the backpressure action (§13). */
  assess(): BackpressureAction {
    const load = this.captureLoad()
    const p = load.overallPressure

    let level: BackpressureLevel
    if (p >= LEVEL_THRESHOLDS.CRITICAL) level = 'CRITICAL'
    else if (p >= LEVEL_THRESHOLDS.HIGH) level = 'HIGH'
    else if (p >= LEVEL_THRESHOLDS.ELEVATED) level = 'ELEVATED'
    else level = 'NORMAL'

    const action: BackpressureAction = {
      level,
      deferAnalytics: level === 'ELEVATED' || level === 'HIGH' || level === 'CRITICAL',
      sampleRealtime: level === 'CRITICAL', // last resort only
      freezeBackground: level === 'HIGH' || level === 'CRITICAL',
      reason: `Pressure ${(p * 100).toFixed(0)}% — worker util ${(load.workerUtilization * 100).toFixed(0)}%, queue depth ${load.workerQueueDepth + load.writeQueueDepth}, mem ${(load.memoryPressure * 100).toFixed(0)}%`,
    }

    // Adjust realtime sampling ratio (§13 temporary sampling)
    if (action.sampleRealtime) {
      this.samplingRatio = 0.5 // drop half of realtime ticks under CRITICAL load
    } else if (level === 'HIGH') {
      this.samplingRatio = 0.8
    } else {
      this.samplingRatio = 1.0
    }

    if (level !== this.currentLevel) {
      log.warn(`backpressure ${this.currentLevel} → ${level}: ${action.reason}`)
    }

    this.currentLevel = level
    this.currentAction = action
    this.history.push({ at: Date.now(), load, action })
    if (this.history.length > this.historyLimit) this.history.shift()

    return action
  }

  /** Should this realtime tick be processed? (§13 — realtime always highest priority, but sampling under CRITICAL) */
  shouldProcessRealtimeTick(): boolean {
    if (this.samplingRatio >= 1.0) return true
    return Math.random() < this.samplingRatio
  }

  /** Should analytical work be deferred right now? (§13 deferred analytics) */
  shouldDeferAnalytics(): boolean {
    return this.currentAction.deferAnalytics
  }

  /** Should background work be frozen? (§13) */
  shouldFreezeBackground(): boolean {
    return this.currentAction.freezeBackground
  }

  getCurrentAction(): BackpressureAction {
    return this.currentAction
  }

  getCurrentLevel(): BackpressureLevel {
    return this.currentLevel
  }

  getHistory(limit = 50): Array<{ at: number; load: SystemLoad; action: BackpressureAction }> {
    return this.history.slice(-limit)
  }
}

export const backpressure = new BackpressureManager()
