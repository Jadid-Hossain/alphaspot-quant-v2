// CHAPTER 5.9 §10C, §10D — Active Rate Governor & Clock Synchronization
//
// §10C — Active Rate Governor:
//   • Enforces exchange communication limits before transmission
//   • Mechanisms: Token Bucket, Leaky Bucket, Sliding Window, Adaptive Burst,
//     Priority Queue, Emergency Shaping
//   • Evaluates: API weight, RPS, RPM, burst limits, dynamic limits, remaining capacity
//   • Actions: delay, buffer, reprioritize, reject, reroute
//   • Throttling occurs BEFORE any broker protocol message emitted
//
// §10D — Clock Synchronization Management:
//   • Mechanisms: PTP, NTP, Hardware Timestamping, GPS, Exchange Sync
//   • Monitors: drift, offset, sync health, accuracy, reference availability
//   • If drift exceeds tolerance → outbound suspended
//
// Rule 25 — Rate Governor prevents violations of exchange limits.
// Rule 26 — Throttling before communication, not after rejection.
// Rule 27 — Outbound suspended when clock drift exceeds tolerance.
// Rule 28 — Clock sync metadata preserved in immutable lineage.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  ClockSyncMechanism,
  ClockSyncState,
  ClockSyncStatus,
  RateGovernorAction,
  RateGovernorMechanism,
  RateGovernorState,
  RateLimitConfiguration,
} from './types'

const log = createLogger('decision-intelligence:broker-gateway:rate-clock')

// ─────────────────────────────────────────────────────────────────────────────
// ActiveRateGovernor (§10C, Rule 25, Rule 26)
// ─────────────────────────────────────────────────────────────────────────────

export class ActiveRateGovernor {
  private states = new Map<string, RateGovernorState>()
  /** Token bucket state per broker. */
  private tokenBuckets = new Map<string, { tokens: number; lastRefill: number }>()

  /**
   * Check if a transmission is allowed (§10C, Rule 25, Rule 26).
   * Throttling occurs BEFORE any broker protocol message is emitted.
   */
  checkTransmission(
    brokerId: string,
    config: RateLimitConfiguration,
    apiWeight: number = 1,
    currentTime: number = Date.now(),
  ): { action: RateGovernorAction; reason: string; waitMs: number } {
    let state = this.states.get(brokerId)
    if (!state) {
      state = {
        brokerId,
        currentRps: 0,
        currentRpm: 0,
        apiWeightUsed: 0,
        remainingBurst: config.burstLimit,
        remainingCapacity: 1,
        lastUpdate: currentTime,
      }
      this.states.set(brokerId, state)
    }

    // §10C — Apply rate governor mechanism
    switch (config.mechanism) {
      case 'TOKEN_BUCKET':
        return this.checkTokenBucket(brokerId, config, apiWeight, currentTime)
      case 'LEAKY_BUCKET':
        return this.checkLeakyBucket(brokerId, config, apiWeight, currentTime)
      case 'SLIDING_WINDOW':
        return this.checkSlidingWindow(brokerId, config, apiWeight, currentTime)
      case 'ADAPTIVE_BURST':
        return this.checkAdaptiveBurst(brokerId, config, apiWeight, currentTime)
      case 'PRIORITY_QUEUE':
        return this.checkPriorityQueue(brokerId, config, apiWeight, currentTime)
      case 'EMERGENCY_SHAPING':
        return { action: 'REJECT', reason: 'emergency traffic shaping active', waitMs: 0 }
      default:
        return { action: 'ALLOW', reason: 'no governor mechanism', waitMs: 0 }
    }
  }

  /** §10C — Token Bucket. */
  private checkTokenBucket(brokerId: string, config: RateLimitConfiguration, weight: number, currentTime: number): { action: RateGovernorAction; reason: string; waitMs: number } {
    let bucket = this.tokenBuckets.get(brokerId)
    if (!bucket) {
      bucket = { tokens: config.burstLimit, lastRefill: currentTime }
      this.tokenBuckets.set(brokerId, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = (currentTime - bucket.lastRefill) / 1000 // seconds
    const refillRate = config.requestsPerSecond
    bucket.tokens = Math.min(config.burstLimit, bucket.tokens + elapsed * refillRate)
    bucket.lastRefill = currentTime

    if (bucket.tokens >= weight) {
      bucket.tokens -= weight
      return { action: 'ALLOW', reason: 'token bucket has capacity', waitMs: 0 }
    }

    // Rule 26 — Throttle before communication
    const waitMs = ((weight - bucket.tokens) / refillRate) * 1000
    log.debug(`rate governor: token bucket throttled for ${brokerId} — wait ${waitMs}ms`)
    return { action: 'DELAY', reason: `token bucket exhausted (${bucket.tokens}/${weight})`, waitMs }
  }

  /** §10C — Leaky Bucket. */
  private checkLeakyBucket(brokerId: string, config: RateLimitConfiguration, weight: number, currentTime: number): { action: RateGovernorAction; reason: string; waitMs: number } {
    // Simplified: same as token bucket
    return this.checkTokenBucket(brokerId, config, weight, currentTime)
  }

  /** §10C — Sliding Window. */
  private checkSlidingWindow(brokerId: string, config: RateLimitConfiguration, weight: number, currentTime: number): { action: RateGovernorAction; reason: string; waitMs: number } {
    const state = this.states.get(brokerId)!
    // Check RPS limit
    if (state.currentRps + weight > config.requestsPerSecond) {
      const waitMs = 1000 // wait 1 second for window to slide
      return { action: 'DELAY', reason: `RPS ${state.currentRps} + ${weight} > ${config.requestsPerSecond}`, waitMs }
    }
    // Check RPM limit
    if (state.currentRpm + weight > config.requestsPerMinute) {
      const waitMs = 60000 // wait 1 minute
      return { action: 'BUFFER', reason: `RPM ${state.currentRpm} + ${weight} > ${config.requestsPerMinute}`, waitMs }
    }
    return { action: 'ALLOW', reason: 'within sliding window', waitMs: 0 }
  }

  /** §10C — Adaptive Burst. */
  private checkAdaptiveBurst(brokerId: string, config: RateLimitConfiguration, weight: number, currentTime: number): { action: RateGovernorAction; reason: string; waitMs: number } {
    const state = this.states.get(brokerId)!
    // Adaptive: allow burst if capacity is high, throttle if low
    if (state.remainingCapacity > 0.5) {
      return { action: 'ALLOW', reason: `adaptive burst — capacity ${(state.remainingCapacity * 100).toFixed(0)}%`, waitMs: 0 }
    } else if (state.remainingCapacity > 0.2) {
      return { action: 'REPRIORITIZE', reason: `adaptive burst — capacity low (${(state.remainingCapacity * 100).toFixed(0)}%)`, waitMs: 100 }
    } else {
      return { action: 'REJECT', reason: `adaptive burst — capacity critical (${(state.remainingCapacity * 100).toFixed(0)}%)`, waitMs: 0 }
    }
  }

  /** §10C — Priority Queue. */
  private checkPriorityQueue(brokerId: string, config: RateLimitConfiguration, weight: number, currentTime: number): { action: RateGovernorAction; reason: string; waitMs: number } {
    // Simplified: always allow (priority would be assigned by caller)
    return { action: 'ALLOW', reason: 'priority queue scheduling', waitMs: 0 }
  }

  /**
   * Record a transmission (update governor state).
   */
  recordTransmission(brokerId: string, apiWeight: number, currentTime: number = Date.now()): void {
    const state = this.states.get(brokerId)
    if (!state) return
    state.currentRps += 1
    state.currentRpm += 1
    state.apiWeightUsed += apiWeight
    state.lastUpdate = currentTime
  }

  /**
   * Get governor state for a broker.
   */
  getState(brokerId: string): RateGovernorState | null {
    return this.states.get(brokerId) ?? null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClockSynchronizationManager (§10D, Rule 27, Rule 28)
// ─────────────────────────────────────────────────────────────────────────────

export class ClockSynchronizationManager {
  private state: ClockSyncState
  private maxDriftMs: number
  private syncCheckIntervalMs: number

  constructor(
    mechanism: ClockSyncMechanism = 'NTP',
    maxDriftMs: number = 10,
    syncCheckIntervalMs: number = 1000,
    referenceClock: string = 'pool.ntp.org',
  ) {
    this.maxDriftMs = maxDriftMs
    this.syncCheckIntervalMs = syncCheckIntervalMs
    this.state = {
      status: 'SYNCHRONIZED',
      mechanism,
      drift: 0,
      offset: 0,
      accuracy: 1,
      referenceAvailable: true,
      lastSyncCheck: Date.now(),
    }
  }

  /**
   * Update clock synchronization state (§10D).
   */
  updateSync(drift: number, offset: number, accuracy: number, referenceAvailable: boolean, currentTime: number = Date.now()): void {
    this.state.drift = drift
    this.state.offset = offset
    this.state.accuracy = accuracy
    this.state.referenceAvailable = referenceAvailable
    this.state.lastSyncCheck = currentTime

    // Rule 27 — Determine sync status based on drift
    if (!referenceAvailable) {
      this.state.status = 'REFERENCE_LOST'
      log.error('clock sync: reference clock lost — Rule 27 outbound suspended')
    } else if (Math.abs(drift) > this.maxDriftMs) {
      this.state.status = 'DRIFT_EXCEEDED'
      log.error(`clock sync: drift ${drift}ms exceeds tolerance ${this.maxDriftMs}ms — Rule 27 outbound suspended`)
    } else if (Math.abs(drift) > this.maxDriftMs * 0.5) {
      this.state.status = 'DRIFT_WARNING'
      log.warn(`clock sync: drift ${drift}ms approaching tolerance ${this.maxDriftMs}ms`)
    } else {
      this.state.status = 'SYNCHRONIZED'
    }
  }

  /**
   * Check if outbound transmission is allowed (Rule 27).
   * Outbound suspended when clock drift exceeds tolerance.
   */
  canTransmit(): boolean {
    return this.state.status === 'SYNCHRONIZED' || this.state.status === 'DRIFT_WARNING'
  }

  /**
   * Get current clock sync state (Rule 28 — preserved in lineage).
   */
  getState(): ClockSyncState {
    return { ...this.state }
  }

  /**
   * Get sync status summary.
   */
  getSummary(): { status: ClockSyncStatus; drift: number; canTransmit: boolean } {
    return {
      status: this.state.status,
      drift: this.state.drift,
      canTransmit: this.canTransmit(),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const rateGovernor = new ActiveRateGovernor()
export const clockSyncManager = new ClockSynchronizationManager()
