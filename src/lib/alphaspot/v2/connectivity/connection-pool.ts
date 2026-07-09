// CHAPTER 3.1 §7 — Connection Pool with Stream Sharding
//
// The platform manages a pool of exchange connections (§7). No single
// connection should become a bottleneck. Stream Sharding is EXPLICITLY
// MANDATED (§7): dynamically calculate total required payload and chunk
// subscriptions across multiple independent WebSocket connections.
//
// Example: Connection A handles coins 1-100, Connection B handles 101-200.

import { createLogger } from '../domains/01-core-infrastructure'
import type { ConnectionState, Subscription } from './types'
import { subscriptionManager } from './subscription-manager'

const log = createLogger('connection-pool')

// ─────────────────────────────────────────────────────────────────────────────
// Shard (individual WebSocket connection)  (Chapter 3.1 §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface Shard {
  shardId: string
  exchangeId: string
  index: number
  streams: Set<string>
  state: ConnectionState
  createdAt: number
  lastMessageAt: number | null
  reconnectCount: number
  droppedMessages: number
  bandwidthBytes: number
  maxStreams: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Pool  (Chapter 3.1 §7 — stream sharding)
// ─────────────────────────────────────────────────────────────────────────────

interface ConnectionPoolConfig {
  /** Max streams per shard (§7 — chunk size). Binance allows ~200 streams per WS. */
  maxStreamsPerShard: number
  /** Max shards per exchange. */
  maxShards: number
  /** Min streams to justify a new shard. */
  minStreamsForShard: number
}

const DEFAULT_CONFIG: ConnectionPoolConfig = {
  maxStreamsPerShard: 200,
  maxShards: 10,
  minStreamsForShard: 1,
}

class ConnectionPool {
  private shards = new Map<string, Shard>()
  private config: ConnectionPoolConfig = { ...DEFAULT_CONFIG }
  private exchangeId: string | null = null
  private subscribers = new Set<(shard: Shard) => void>()

  /** Initialize the pool for an exchange. */
  initialize(exchangeId: string): void {
    this.exchangeId = exchangeId
    log.info(`connection pool initialized for exchange "${exchangeId}" (maxStreamsPerShard=${this.config.maxStreamsPerShard})`)
  }

  /**
   * Dynamically calculate required shards and assign subscriptions (§7 stream sharding).
   * This is the core §7 mandate: chunk subscriptions across multiple WS connections.
   */
  assignShards(subscriptions: Subscription[]): Shard[] {
    if (subscriptions.length === 0) return []

    const requiredShards = Math.min(
      this.config.maxShards,
      Math.max(1, Math.ceil(subscriptions.length / this.config.maxStreamsPerShard)),
    )

    log.info(
      `stream sharding: ${subscriptions.length} subscriptions → ${requiredShards} shard(s) (max ${this.config.maxStreamsPerShard}/shard)`,
    )

    // Create or reuse shards
    const activeShards: Shard[] = []
    for (let i = 0; i < requiredShards; i++) {
      const shardId = `${this.exchangeId}-shard-${i}`
      let shard = this.shards.get(shardId)
      if (!shard) {
        shard = {
          shardId,
          exchangeId: this.exchangeId!,
          index: i,
          streams: new Set(),
          state: 'INITIALIZING',
          createdAt: Date.now(),
          lastMessageAt: null,
          reconnectCount: 0,
          droppedMessages: 0,
          bandwidthBytes: 0,
          maxStreams: this.config.maxStreamsPerShard,
        }
        this.shards.set(shardId, shard)
      }
      activeShards.push(shard)
    }

    // Remove excess shards if we now need fewer
    for (const [shardId, shard] of this.shards) {
      if (shard.index >= requiredShards) {
        log.info(`removing excess shard ${shardId}`)
        this.shards.delete(shardId)
      }
    }

    // Distribute subscriptions round-robin across shards (§7 workload distribution)
    // Clear existing assignments first
    for (const shard of activeShards) shard.streams.clear()

    subscriptions.forEach((sub, i) => {
      const shard = activeShards[i % activeShards.length]
      shard.streams.add(sub.stream)
      subscriptionManager.assignShard(sub.stream, shard.shardId)
    })

    for (const shard of activeShards) {
      log.info(`shard ${shard.shardId}: ${shard.streams.size} streams assigned`)
      for (const s of this.subscribers) s(shard)
    }

    return activeShards
  }

  /** Get a shard by ID. */
  get(shardId: string): Shard | undefined {
    return this.shards.get(shardId)
  }

  /** Get all shards. */
  getAll(): Shard[] {
    return Array.from(this.shards.values()).sort((a, b) => a.index - b.index)
  }

  /** Update a shard's state (§7 health monitoring). */
  updateShardState(shardId: string, state: ConnectionState): void {
    const shard = this.shards.get(shardId)
    if (!shard) return
    shard.state = state
    if (state === 'RECONNECTING') shard.reconnectCount++
    for (const s of this.subscribers) s(shard)
  }

  /** Record a message received on a shard (§7 health + §8 heartbeat). */
  recordMessage(shardId: string, bytes: number): void {
    const shard = this.shards.get(shardId)
    if (!shard) return
    shard.lastMessageAt = Date.now()
    shard.bandwidthBytes += bytes
  }

  /** Record a dropped message (§15 observability). */
  recordDroppedMessage(shardId: string): void {
    const shard = this.shards.get(shardId)
    if (!shard) return
    shard.droppedMessages++
  }

  /** Get the shard for a given stream. */
  getShardForStream(stream: string): Shard | undefined {
    for (const shard of this.shards.values()) {
      if (shard.streams.has(stream)) return shard
    }
    return undefined
  }

  /** Isolate a failed shard for reconnection (§7 reconnect isolation, §14 failover). */
  isolateShard(shardId: string): void {
    const shard = this.shards.get(shardId)
    if (!shard) return
    log.warn(`isolating shard ${shardId} for reconnection (§7 reconnect isolation)`)
    shard.state = 'RECONNECTING'
    for (const s of this.subscribers) s(shard)
  }

  /** Pool health summary (§7 health monitoring, §15 observability). */
  getPoolHealth(): {
    totalShards: number
    liveShards: number
    reconnectingShards: number
    failedShards: number
    totalStreams: number
    totalBandwidthBytes: number
    totalDroppedMessages: number
    totalReconnects: number
  } {
    let live = 0, reconnecting = 0, failed = 0, streams = 0, bandwidth = 0, dropped = 0, reconnects = 0
    for (const shard of this.shards.values()) {
      if (shard.state === 'LIVE') live++
      else if (shard.state === 'RECONNECTING') reconnecting++
      else if (shard.state === 'FAILED') failed++
      streams += shard.streams.size
      bandwidth += shard.bandwidthBytes
      dropped += shard.droppedMessages
      reconnects += shard.reconnectCount
    }
    return {
      totalShards: this.shards.size,
      liveShards: live,
      reconnectingShards: reconnecting,
      failedShards: failed,
      totalStreams: streams,
      totalBandwidthBytes: bandwidth,
      totalDroppedMessages: dropped,
      totalReconnects: reconnects,
    }
  }

  getConfig(): ConnectionPoolConfig {
    return { ...this.config }
  }

  setConfig(patch: Partial<ConnectionPoolConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  subscribe(handler: (shard: Shard) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  clear(): void {
    this.shards.clear()
  }
}

export const connectionPool = new ConnectionPool()
