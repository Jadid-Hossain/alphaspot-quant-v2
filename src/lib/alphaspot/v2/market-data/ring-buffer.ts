// CHAPTER 3.2 §4, §4.1 — Raw Message Buffer + Bounded Ingestion Buffer
//
// Incoming exchange messages are first written to a temporary in-memory
// bounded ring buffer (§4). The buffer:
//   • absorbs bursts (§4)
//   • preserves arrival order (§4)
//   • isolates exchange latency (§4)
//   • prevents downstream overload (§4)
//
// §4.1 Bounded Ingestion Buffer:
//   • Fixed-capacity bounded ring buffer (e.g. 50,000 events)
//   • When capacity reached, apply Backpressure Policy before allocating more
//   • Runtime must NEVER permit unlimited buffer growth (Rule 11)
//   • Priority order (highest first): Trade > Depth > BookTicker > Kline > MiniTicker > Ticker
//   • Dropping high-priority events prohibited unless emergency degradation
//   • Every discarded event must generate operational metrics (§4.1)

import { createLogger } from '../domains/01-core-infrastructure'
import { hrNow, type HighResolutionTimestamp, type CanonicalEventType, EVENT_TYPE_PRIORITY } from './canonical-event'

const log = createLogger('market-data:ring-buffer')

// ─────────────────────────────────────────────────────────────────────────────
// Raw message  (pre-validation, exchange-specific)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawMessage {
  /** Monotonic high-res reception timestamp (§6.1). */
  receptionTimestamp: HighResolutionTimestamp
  /** The exchange stream name (e.g. "btcusdt@kline_15m"). */
  stream: string
  /** Canonical symbol (e.g. "BTC/USDT"). */
  symbol: string
  /** Event type hint (for priority-based dropping §4.1). */
  eventType: CanonicalEventType
  /** The raw exchange payload (unvalidated). */
  payload: unknown
  /** Sequence number from the exchange (if available). */
  sequenceNumber: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded Ring Buffer  (Chapter 3.2 §4.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface RingBufferConfig {
  /** Max events in the buffer (§4.1 — default 50,000). */
  capacity: number
  /** Whether to allow dropping high-priority events in emergencies (§4.1). */
  allowEmergencyDrops: boolean
}

export const DEFAULT_RING_BUFFER_CONFIG: RingBufferConfig = {
  capacity: 50_000,
  allowEmergencyDrops: false,
}

export interface RingBufferStats {
  capacity: number
  currentSize: number
  totalPushed: number
  totalPopped: number
  totalDropped: number
  dropsByPriority: Record<number, number>
  highWaterMark: number
  burstCount: number
}

class BoundedRingBuffer {
  private buffer: (RawMessage | null)[]
  private head = 0 // next write position
  private tail = 0 // next read position
  private size = 0
  private config: RingBufferConfig = { ...DEFAULT_RING_BUFFER_CONFIG }
  private stats: RingBufferStats = {
    capacity: this.config.capacity,
    currentSize: 0,
    totalPushed: 0,
    totalPopped: 0,
    totalDropped: 0,
    dropsByPriority: {},
    highWaterMark: 0,
    burstCount: 0,
  }
  private subscribers = new Set<(msg: RawMessage) => void>()

  constructor() {
    this.buffer = new Array(this.config.capacity).fill(null)
  }

  setConfig(patch: Partial<RingBufferConfig>): void {
    this.config = { ...this.config, ...patch }
    if (patch.capacity && patch.capacity !== this.buffer.length) {
      // Reallocate the buffer
      const old = this.drain()
      this.buffer = new Array(patch.capacity).fill(null)
      this.head = 0
      this.tail = 0
      this.size = 0
      this.stats.capacity = patch.capacity
      // Re-queue old messages (up to new capacity)
      for (const msg of old.slice(-patch.capacity)) this.push(msg)
    }
    log.info(`ring buffer config: capacity=${this.config.capacity}, emergencyDrops=${this.config.allowEmergencyDrops}`)
  }

  /**
   * Push a raw message into the buffer (§4.1).
   * If the buffer is full, apply Backpressure Policy (§4.1):
   *   drop the LOWEST-priority message in the buffer to make room.
   * Dropping high-priority events (Trade, Depth) is prohibited unless
   * emergency degradation is explicitly enabled (§4.1).
   */
  push(msg: RawMessage): boolean {
    this.stats.totalPushed++

    if (this.size >= this.config.capacity) {
      // §4.1 — buffer full, apply backpressure by dropping lowest-priority event
      const dropped = this.dropLowestPriority(msg)
      if (!dropped) {
        // Could not drop — buffer stays full, reject the new message
        this.stats.totalDropped++
        const pri = EVENT_TYPE_PRIORITY[msg.eventType] ?? 99
        this.stats.dropsByPriority[pri] = (this.stats.dropsByPriority[pri] ?? 0) + 1
        log.warn(`ring buffer FULL — rejected ${msg.eventType} for ${msg.symbol} (priority ${pri})`)
        return false
      }
      this.stats.burstCount++
    }

    this.buffer[this.head] = msg
    this.head = (this.head + 1) % this.config.capacity
    this.size++
    this.stats.currentSize = this.size
    if (this.size > this.stats.highWaterMark) this.stats.highWaterMark = this.size

    return true
  }

  /** Pop the next message in arrival order (FIFO). */
  pop(): RawMessage | null {
    if (this.size === 0) return null
    const msg = this.buffer[this.tail]
    this.buffer[this.tail] = null
    this.tail = (this.tail + 1) % this.config.capacity
    this.size--
    this.stats.currentSize = this.size
    this.stats.totalPopped++
    return msg
  }

  /** Drain all messages (for replay or shutdown). */
  drain(): RawMessage[] {
    const out: RawMessage[] = []
    let msg: RawMessage | null
    while ((msg = this.pop()) !== null) out.push(msg)
    return out
  }

  /**
   * Drop the lowest-priority message currently in the buffer to make room
   * for a new higher-priority message (§4.1 backpressure policy).
   * Returns true if a message was dropped, false if none could be dropped
   * (all are high-priority and emergency drops are not enabled).
   */
  private dropLowestPriority(incoming: RawMessage): boolean {
    const incomingPriority = EVENT_TYPE_PRIORITY[incoming.eventType] ?? 99

    // Scan the buffer for the lowest-priority message
    let lowestIdx = -1
    let lowestPriority = -1
    for (let i = 0; i < this.size; i++) {
      const idx = (this.tail + i) % this.config.capacity
      const msg = this.buffer[idx]
      if (!msg) continue
      const pri = EVENT_TYPE_PRIORITY[msg.eventType] ?? 99
      // §4.1 — don't drop Trade or Depth unless emergency drops enabled
      const isProtected = pri <= 2 // Trade (1) or Depth (2)
      if (isProtected && !this.config.allowEmergencyDrops) continue
      if (pri > lowestPriority && pri > incomingPriority) {
        lowestPriority = pri
        lowestIdx = idx
      }
    }

    if (lowestIdx === -1) return false

    // Drop the lowest-priority message
    const dropped = this.buffer[lowestIdx]!
    this.buffer[lowestIdx] = null
    this.stats.totalDropped++
    const pri = EVENT_TYPE_PRIORITY[dropped.eventType] ?? 99
    this.stats.dropsByPriority[pri] = (this.stats.dropsByPriority[pri] ?? 0) + 1
    log.warn(`backpressure: dropped ${dropped.eventType} for ${dropped.symbol} (priority ${pri}) to make room for ${incoming.eventType} (priority ${incomingPriority})`)

    // Note: we don't compact the ring buffer here; the null slot will be
    // skipped on pop. For simplicity, we mark it as a gap.
    this.size--
    this.stats.currentSize = this.size
    return true
  }

  getStats(): RingBufferStats {
    return { ...this.stats, dropsByPriority: { ...this.stats.dropsByPriority } }
  }

  getSize(): number {
    return this.size
  }

  isFull(): boolean {
    return this.size >= this.config.capacity
  }

  isEmpty(): boolean {
    return this.size === 0
  }

  clear(): void {
    this.buffer.fill(null)
    this.head = 0
    this.tail = 0
    this.size = 0
    this.stats.currentSize = 0
  }
}

export const ringBuffer = new BoundedRingBuffer()
