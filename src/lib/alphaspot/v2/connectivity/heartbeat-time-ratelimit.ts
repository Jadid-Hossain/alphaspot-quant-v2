// CHAPTER 3.1 §8 — Heartbeat Monitoring
// CHAPTER 3.1 §9 — Time Synchronization
// CHAPTER 3.1 §10 — Rate Limit Governance
//
// Heartbeat (§8): every connection reports last message time, heartbeat latency,
//   synchronization status, reconnect count, error state. Heartbeat failure
//   initiates recovery.
//
// Time sync (§9): exchange server time is authoritative for market timestamps.
//   Local clock drift must never determine market ordering.
//
// Rate limits (§10): connectivity layer owns all rate management. Monitors
//   request frequency, subscription count, reconnect frequency, bandwidth.
//   Business domains remain unaware of limits.

import { createLogger, now } from '../domains/01-core-infrastructure'
import type { RateLimitDescriptor } from './types'

const log = createLogger('heartbeat-time-ratelimit')

// ─────────────────────────────────────────────────────────────────────────────
// Heartbeat Monitor  (Chapter 3.1 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface HeartbeatState {
  connectionId: string
  lastMessageAt: number | null
  lastHeartbeatAt: number | null
  heartbeatLatencyMs: number | null
  synchronizationStatus: 'SYNCED' | 'SYNCING' | 'OUT_OF_SYNC' | 'UNKNOWN'
  reconnectCount: number
  errorState: string | null
  consecutiveFailures: number
  isAlive: boolean
}

class HeartbeatMonitor {
  private states = new Map<string, HeartbeatState>()
  private thresholds = {
    heartbeatTimeoutMs: 30_000, // §8 — heartbeat failure after 30s silence
    maxConsecutiveFailures: 3,
  }
  private subscribers = new Set<(connId: string, state: HeartbeatState) => void>()
  private checkTimer: ReturnType<typeof setInterval> | null = null

  /** Register a connection for heartbeat monitoring (§8). */
  register(connectionId: string): void {
    this.states.set(connectionId, {
      connectionId,
      lastMessageAt: null,
      lastHeartbeatAt: null,
      heartbeatLatencyMs: null,
      synchronizationStatus: 'UNKNOWN',
      reconnectCount: 0,
      errorState: null,
      consecutiveFailures: 0,
      isAlive: false,
    })
  }

  /** Record a message received on a connection (§8 — last message time). */
  recordMessage(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (!state) return
    state.lastMessageAt = now()
    state.isAlive = true
    state.consecutiveFailures = 0
  }

  /** Record a heartbeat response (§8 — heartbeat latency). */
  recordHeartbeat(connectionId: string, serverTime: number): void {
    const state = this.states.get(connectionId)
    if (!state) return
    const localTime = now()
    state.lastHeartbeatAt = localTime
    state.heartbeatLatencyMs = Math.abs(localTime - serverTime)
    state.isAlive = true
    state.consecutiveFailures = 0
  }

  /** Record a synchronization status change (§8). */
  setSyncStatus(connectionId: string, status: HeartbeatState['synchronizationStatus']): void {
    const state = this.states.get(connectionId)
    if (state) state.synchronizationStatus = status
  }

  /** Record a reconnection (§8 — reconnect count). */
  recordReconnect(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (state) state.reconnectCount++
  }

  /** Record an error state (§8). */
  recordError(connectionId: string, error: string): void {
    const state = this.states.get(connectionId)
    if (!state) return
    state.errorState = error
    state.consecutiveFailures++
    if (state.consecutiveFailures >= this.thresholds.maxConsecutiveFailures) {
      state.isAlive = false
      log.error(`heartbeat failure: ${connectionId} — ${state.consecutiveFailures} consecutive failures (§8 initiates recovery)`)
    }
  }

  /** Check all connections for heartbeat failures (§8 — initiates recovery). */
  checkAll(): Array<{ connectionId: string; timedOut: boolean }> {
    const timed: Array<{ connectionId: string; timedOut: boolean }> = []
    const cutoff = now() - this.thresholds.heartbeatTimeoutMs
    for (const [connId, state] of this.states) {
      const lastActivity = state.lastMessageAt ?? state.lastHeartbeatAt
      if (lastActivity !== null && lastActivity < cutoff) {
        state.isAlive = false
        timed.push({ connectionId: connId, timedOut: true })
        log.warn(`heartbeat timeout: ${connId} — no message for ${Math.round((now() - lastActivity) / 1000)}s`)
        for (const sub of this.subscribers) sub(connId, state)
      } else {
        timed.push({ connectionId: connId, timedOut: false })
      }
    }
    return timed
  }

  /** Start the periodic heartbeat check loop (§8). */
  start(intervalMs = 10_000): void {
    if (this.checkTimer) return
    this.checkTimer = setInterval(() => this.checkAll(), intervalMs)
    log.info(`heartbeat monitor started — check every ${intervalMs}ms, timeout ${this.thresholds.heartbeatTimeoutMs}ms`)
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  getState(connectionId: string): HeartbeatState | undefined {
    return this.states.get(connectionId)
  }

  getAllStates(): HeartbeatState[] {
    return Array.from(this.states.values())
  }

  /** Is a connection alive? (§8) */
  isAlive(connectionId: string): boolean {
    return this.states.get(connectionId)?.isAlive ?? false
  }

  subscribe(handler: (connId: string, state: HeartbeatState) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const heartbeatMonitor = new HeartbeatMonitor()

// ─────────────────────────────────────────────────────────────────────────────
// Time Synchronization  (Chapter 3.1 §9)
// ─────────────────────────────────────────────────────────────────────────────

class TimeSynchronizer {
  private exchangeOffsets = new Map<string, number>() // exchangeId → (serverTime - localTime) offset
  private lastSyncAt = new Map<string, number>()
  private syncIntervalMs = 5 * 60 * 1000 // resync every 5 minutes

  /** Synchronize with exchange server time (§9 — authoritative source). */
  async synchronize(exchangeId: string, getServerTime: () => Promise<number>): Promise<number> {
    const localBefore = now()
    const serverTime = await getServerTime()
    const localAfter = now()
    const localMid = (localBefore + localAfter) / 2
    const offset = serverTime - localMid // positive = server ahead
    this.exchangeOffsets.set(exchangeId, offset)
    this.lastSyncAt.set(exchangeId, now())
    log.debug(`time sync [${exchangeId}]: offset ${offset.toFixed(0)}ms (server ${serverTime}, local ${localMid.toFixed(0)})`)
    return offset
  }

  /** Get the exchange-time-corrected timestamp (§9 — local clock drift never determines ordering). */
  toExchangeTime(exchangeId: string, localTimestamp: number): number {
    const offset = this.exchangeOffsets.get(exchangeId) ?? 0
    return localTimestamp + offset
  }

  /** Get the current exchange time. */
  getExchangeNow(exchangeId: string): number {
    return this.toExchangeTime(exchangeId, now())
  }

  /** Get the offset for an exchange. */
  getOffset(exchangeId: string): number {
    return this.exchangeOffsets.get(exchangeId) ?? 0
  }

  /** Is the time sync stale (needs resync)? */
  isStale(exchangeId: string): boolean {
    const last = this.lastSyncAt.get(exchangeId)
    if (!last) return true
    return now() - last > this.syncIntervalMs
  }
}

export const timeSynchronizer = new TimeSynchronizer()

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limit Governance  (Chapter 3.1 §10)
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitState {
  descriptor: RateLimitDescriptor
  current: number
  windowStart: number
  exceeded: boolean
}

class RateLimitGovernance {
  private limits = new Map<string, RateLimitState[]>() // exchangeId → states
  private requestLog = new Map<string, number[]>() // exchangeId → request timestamps
  private subscribers = new Set<(exchangeId: string, limit: RateLimitDescriptor, exceeded: boolean) => void>()

  /** Register rate limits for an exchange (§10). */
  registerLimits(exchangeId: string, limits: RateLimitDescriptor[]): void {
    const states: RateLimitState[] = limits.map((d) => ({
      descriptor: d,
      current: 0,
      windowStart: now(),
      exceeded: false,
    }))
    this.limits.set(exchangeId, states)
    log.info(`rate limits registered for ${exchangeId}: ${limits.length} limit(s)`)
  }

  /** Record a request (§10 — request frequency monitoring). */
  recordRequest(exchangeId: string, weight = 1): void {
    const ts = now()
    const log_ = this.requestLog.get(exchangeId) ?? []
    log_.push(ts)
    // Trim entries older than 1 minute
    const cutoff = ts - 60_000
    while (log_.length > 0 && log_[0] < cutoff) log_.shift()
    this.requestLog.set(exchangeId, log_)

    // Update weight-based limits
    const states = this.limits.get(exchangeId) ?? []
    for (const state of states) {
      const windowMs = state.descriptor.interval === 'MINUTE' ? 60_000 : state.descriptor.interval === 'SECOND' ? 1000 : 86_400_000
      if (ts - state.windowStart > windowMs) {
        state.windowStart = ts
        state.current = 0
        state.exceeded = false
      }
      state.current += weight
      if (state.current > state.descriptor.limit && !state.exceeded) {
        state.exceeded = true
        log.warn(`rate limit EXCEEDED [${exchangeId}]: ${state.descriptor.type} ${state.current}/${state.descriptor.limit} per ${state.descriptor.interval}`)
        for (const sub of this.subscribers) sub(exchangeId, state.descriptor, true)
      }
    }
  }

  /** Check if a request would exceed rate limits (§10 — call before making a request). */
  canMakeRequest(exchangeId: string, weight = 1): boolean {
    const states = this.limits.get(exchangeId) ?? []
    for (const state of states) {
      if (state.exceeded) return false
      if (state.current + weight > state.descriptor.limit) return false
    }
    return true
  }

  /** Wait until rate limits allow a request (§10 — backpressure for business domains, who remain unaware). */
  async waitForAvailability(exchangeId: string, weight = 1, maxWaitMs = 10_000): Promise<boolean> {
    const start = now()
    while (!this.canMakeRequest(exchangeId, weight)) {
      if (now() - start > maxWaitMs) return false
      await new Promise((r) => setTimeout(r, 100))
    }
    return true
  }

  /** Get current rate limit utilization (§10 observability). */
  getUtilization(exchangeId: string): Array<{ descriptor: RateLimitDescriptor; current: number; limit: number; utilizationPct: number; exceeded: boolean }> {
    const states = this.limits.get(exchangeId) ?? []
    return states.map((s) => ({
      descriptor: s.descriptor,
      current: s.current,
      limit: s.descriptor.limit,
      utilizationPct: (s.current / s.descriptor.limit) * 100,
      exceeded: s.exceeded,
    }))
  }

  /** Get request frequency (requests per minute) for monitoring (§10). */
  getRequestFrequency(exchangeId: string): number {
    const log_ = this.requestLog.get(exchangeId) ?? []
    return log_.length // entries in the last 60s
  }

  subscribe(handler: (exchangeId: string, limit: RateLimitDescriptor, exceeded: boolean) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const rateLimitGovernance = new RateLimitGovernance()
