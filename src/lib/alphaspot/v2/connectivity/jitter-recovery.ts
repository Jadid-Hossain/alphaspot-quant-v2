// CHAPTER 3.1 §11 — Reconnection Policy
// CHAPTER 3.1 §12 — Data Gap Detection + Jitter Buffer
// CHAPTER 3.1 §13 — Data Recovery
//
// Reconnection (§11): Detect → Pause Publishing → Reconnect → Snapshot Sync →
//   Gap Detection → Gap Recovery → Resume Publishing. Realtime publishing
//   resumes only after successful synchronization.
//
// Jitter Buffer (§12): read native Update IDs (u/U). Hold out-of-order packets
//   in a micro-buffer for up to X ms. If the missing packet doesn't arrive,
//   trigger the Resynchronization protocol (§11) immediately.
//
// Data Recovery (§13): always prefer authoritative snapshots. Recovered data
//   must be validated before publication. Consumers never observe partially
//   recovered state.

import { createLogger, now } from '../domains/01-core-infrastructure'
import type { DataGap, RawMarketEvent, ReconnectionStage } from './types'

const log = createLogger('jitter-recovery')

// ─────────────────────────────────────────────────────────────────────────────
// Jitter Buffer  (Chapter 3.1 §12 — explicit mandate)
// ─────────────────────────────────────────────────────────────────────────────

interface BufferedPacket {
  event: RawMarketEvent
  bufferedAt: number
}

class JitterBuffer {
  private buffer = new Map<string, BufferedPacket[]>() // stream → pending packets
  private lastUpdateId = new Map<string, number>() // stream → last processed updateId
  private config: { maxHoldMs: number; maxBufferSize: number } = {
    maxHoldMs: 250, // hold out-of-order packets for up to 250ms
    maxBufferSize: 100,
  }
  private gapCallback: ((gap: DataGap) => void) | null = null
  private resyncCallback: ((stream: string, reason: string) => void) | null = null
  private stats = { processed: 0, buffered: 0, gapsDetected: 0, resyncsTriggered: 0 }

  /** Set the callback for when a gap is detected (§12). */
  onGap(cb: (gap: DataGap) => void): void {
    this.gapCallback = cb
  }

  /** Set the callback for when resync should be triggered (§12). */
  onResyncRequired(cb: (stream: string, reason: string) => void): void {
    this.resyncCallback = cb
  }

  /**
   * Process an incoming event with Update IDs (§12 — u/U in Binance payloads).
   * Returns the events that are ready to be published (in order).
   */
  process(event: RawMarketEvent): RawMarketEvent[] {
    this.stats.processed++

    // If the event has no update IDs, pass through (not all streams have them)
    if (event.lastUpdateId === null) {
      return [event]
    }

    const stream = event.stream
    const lastId = this.lastUpdateId.get(stream)
    const buffer = this.buffer.get(stream) ?? []

    // First event for this stream — initialize
    if (lastId === undefined) {
      this.lastUpdateId.set(stream, event.lastUpdateId)
      return [event]
    }

    // §12 — check for sequence continuity
    const expectedNext = lastId + 1
    const firstUpdateId = event.firstUpdateId ?? event.lastUpdateId

    if (firstUpdateId > expectedNext) {
      // §12 — GAP DETECTED: out-of-order or missing packet
      log.warn(`gap detected [${stream}]: expected updateId ${expectedNext}, got ${firstUpdateId} — buffering (§12 jitter buffer)`)
      this.stats.gapsDetected++
      this.stats.buffered++

      // Emit gap event
      if (this.gapCallback) {
        this.gapCallback({
          gapId: `gap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          exchangeId: event.exchangeId,
          stream,
          symbol: event.symbol,
          expectedUpdateId: expectedNext,
          receivedUpdateId: firstUpdateId,
          detectedAt: now(),
          recoveredAt: null,
          recoveryMethod: 'JITTER_BUFFER',
          severity: firstUpdateId - expectedNext > 10 ? 'HIGH' : 'MEDIUM',
        })
      }

      // Hold the packet in the micro-buffer (§12)
      buffer.push({ event, bufferedAt: now() })
      if (buffer.length > this.config.maxBufferSize) {
        // Buffer overflow — trigger resync (§12)
        log.error(`jitter buffer overflow [${stream}] — triggering resync (§12)`)
        this.stats.resyncsTriggered++
        this.buffer.set(stream, [])
        if (this.resyncCallback) this.resyncCallback(stream, 'Jitter buffer overflow')
        return []
      }
      this.buffer.set(stream, buffer)

      // Check if any buffered packets can now be released (maybe the missing one arrived)
      return this.tryReleaseBuffered(stream)
    }

    if (firstUpdateId < expectedNext) {
      // Stale/duplicate packet — skip (§12)
      log.debug(`stale packet [${stream}]: updateId ${firstUpdateId} <= last ${lastId} — dropping`)
      return []
    }

    // In-order packet — update lastId and release
    this.lastUpdateId.set(stream, event.lastUpdateId)

    // Check if buffered packets can now be released
    const released = this.tryReleaseBuffered(stream)
    return [event, ...released]
  }

  /** Try to release buffered packets that are now in-order (§12). */
  private tryReleaseBuffered(stream: string): RawMarketEvent[] {
    const buffer = this.buffer.get(stream)
    if (!buffer || buffer.length === 0) return []

    const released: RawMarketEvent[] = []
    let lastId = this.lastUpdateId.get(stream)!

    // Sort buffer by firstUpdateId
    buffer.sort((a, b) => (a.event.firstUpdateId ?? a.event.lastUpdateId!) - (b.event.firstUpdateId ?? b.event.lastUpdateId!))

    const remaining: BufferedPacket[] = []
    for (const pkt of buffer) {
      const firstId = pkt.event.firstUpdateId ?? pkt.event.lastUpdateId!
      if (firstId === lastId + 1) {
        // In-order now — release
        released.push(pkt.event)
        lastId = pkt.event.lastUpdateId!
      } else if (firstId > lastId + 1) {
        // Still a gap — keep buffered
        remaining.push(pkt)
      }
      // firstId <= lastId → stale, drop
    }

    this.lastUpdateId.set(stream, lastId)
    this.buffer.set(stream, remaining)

    // Check for expired packets (held too long — §12 trigger resync)
    const cutoff = now() - this.config.maxHoldMs
    for (const pkt of remaining) {
      if (pkt.bufferedAt < cutoff) {
        log.error(`jitter buffer timeout [${stream}] — packet held >${this.config.maxHoldMs}ms, triggering resync (§12)`)
        this.stats.resyncsTriggered++
        this.buffer.set(stream, [])
        if (this.resyncCallback) this.resyncCallback(stream, `Missing packet timeout (held >${this.config.maxHoldMs}ms)`)
        return released
      }
    }

    return released
  }

  /** Reset the jitter buffer for a stream (called after resync — §11). */
  reset(stream: string): void {
    this.buffer.delete(stream)
    this.lastUpdateId.delete(stream)
    log.info(`jitter buffer reset for ${stream}`)
  }

  /** Reset all buffers (full resync). */
  resetAll(): void {
    this.buffer.clear()
    this.lastUpdateId.clear()
    log.info('all jitter buffers reset')
  }

  setConfig(patch: Partial<{ maxHoldMs: number; maxBufferSize: number }>): void {
    this.config = { ...this.config, ...patch }
  }

  getStats(): { processed: number; buffered: number; gapsDetected: number; resyncsTriggered: number; activeBuffers: number } {
    return { ...this.stats, activeBuffers: this.buffer.size }
  }
}

export const jitterBuffer = new JitterBuffer()

// ─────────────────────────────────────────────────────────────────────────────
// Reconnection Policy  (Chapter 3.1 §11)
// ─────────────────────────────────────────────────────────────────────────────

interface ReconnectionState {
  connectionId: string
  stage: ReconnectionStage
  startedAt: number
  stageHistory: Array<{ stage: ReconnectionStage; at: number; note: string }>
  publishingPaused: boolean
}

const RECONNECTION_ORDER: ReconnectionStage[] = [
  'DETECT',
  'PAUSE_PUBLISHING',
  'RECONNECT',
  'SNAPSHOT_SYNCHRONIZATION',
  'GAP_DETECTION',
  'GAP_RECOVERY',
  'RESUME_PUBLISHING',
]

class ReconnectionPolicy {
  private states = new Map<string, ReconnectionState>()
  private subscribers = new Set<(connId: string, stage: ReconnectionStage) => void>()
  private stats = { totalReconnections: 0, completed: 0, failed: 0 }

  /** Begin the reconnection protocol for a connection (§11 — 7 stages). */
  begin(connectionId: string): ReconnectionState {
    const state: ReconnectionState = {
      connectionId,
      stage: 'DETECT',
      startedAt: now(),
      stageHistory: [{ stage: 'DETECT', at: now(), note: 'Disconnection detected' }],
      publishingPaused: false,
    }
    this.states.set(connectionId, state)
    this.stats.totalReconnections++
    log.warn(`reconnection protocol BEGIN [${connectionId}] — §11 7-stage sequence`)
    return state
  }

  /** Advance to the next stage (§11 — monotonic). */
  advance(connectionId: string, note: string): ReconnectionState | null {
    const state = this.states.get(connectionId)
    if (!state) return null
    const currentIdx = RECONNECTION_ORDER.indexOf(state.stage)
    if (currentIdx >= RECONNECTION_ORDER.length - 1) return state

    const nextStage = RECONNECTION_ORDER[currentIdx + 1]
    state.stage = nextStage
    state.stageHistory.push({ stage: nextStage, at: now(), note })

    // §11 — pause publishing at PAUSE_PUBLISHING stage
    if (nextStage === 'PAUSE_PUBLISHING') {
      state.publishingPaused = true
      log.warn(`publishing PAUSED [${connectionId}] — §11 realtime publishing paused`)
    }
    // §11 — resume publishing at RESUME_PUBLISHING (only after successful sync)
    if (nextStage === 'RESUME_PUBLISHING') {
      state.publishingPaused = false
      this.stats.completed++
      log.info(`publishing RESUMED [${connectionId}] — §11 synchronization complete`)
    }

    for (const sub of this.subscribers) sub(connectionId, nextStage)
    return state
  }

  /** Is publishing currently paused for a connection? (§11) */
  isPublishingPaused(connectionId: string): boolean {
    return this.states.get(connectionId)?.publishingPaused ?? false
  }

  /** Mark a reconnection as failed (§11). */
  fail(connectionId: string, reason: string): void {
    const state = this.states.get(connectionId)
    if (!state) return
    this.stats.failed++
    log.error(`reconnection FAILED [${connectionId}]: ${reason}`)
    this.states.delete(connectionId)
  }

  /** Complete a reconnection (§11). */
  complete(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (!state) return
    state.publishingPaused = false
    this.states.delete(connectionId)
  }

  getState(connectionId: string): ReconnectionState | undefined {
    return this.states.get(connectionId)
  }

  getStats() {
    return { ...this.stats, active: this.states.size }
  }

  subscribe(handler: (connId: string, stage: ReconnectionStage) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const reconnectionPolicy = new ReconnectionPolicy()

// ─────────────────────────────────────────────────────────────────────────────
// Data Recovery  (Chapter 3.1 §13)
// ─────────────────────────────────────────────────────────────────────────────

class DataRecovery {
  private stats = { recoveriesInitiated: 0, recoveriesCompleted: 0, recoveriesFailed: 0, validatedBeforePublish: 0 }

  /**
   * Recover data for a stream (§13 — always prefer authoritative snapshots).
   * Recovered data must be validated before publication (§13).
   * Consumers never observe partially recovered state (§13).
   */
  async recover(
    stream: string,
    fetchSnapshot: () => Promise<unknown>,
    validate: (data: unknown) => boolean,
  ): Promise<{ recovered: boolean; validated: boolean; data: unknown | null }> {
    this.stats.recoveriesInitiated++
    log.info(`data recovery initiated [${stream}] — fetching authoritative snapshot (§13)`)

    try {
      const snapshot = await fetchSnapshot()
      const valid = validate(snapshot)
      if (!valid) {
        log.error(`data recovery validation FAILED [${stream}] — not publishing (§13)`)
        this.stats.recoveriesFailed++
        return { recovered: false, validated: false, data: null }
      }
      this.stats.recoveriesCompleted++
      this.stats.validatedBeforePublish++
      log.info(`data recovery complete [${stream}] — validated, ready for publication (§13)`)
      return { recovered: true, validated: true, data: snapshot }
    } catch (e) {
      log.error(`data recovery ERROR [${stream}]: ${e instanceof Error ? e.message : String(e)}`)
      this.stats.recoveriesFailed++
      return { recovered: false, validated: false, data: null }
    }
  }

  getStats() {
    return { ...this.stats }
  }
}

export const dataRecovery = new DataRecovery()
