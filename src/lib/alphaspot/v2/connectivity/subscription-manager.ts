// CHAPTER 3.1 §6 — Subscription Management
//
// Subscriptions are centrally managed (§6). Responsibilities:
//   creation, batching, prioritization, monitoring, renewal, removal.
// Duplicate subscriptions are prohibited (§6).

import { createLogger } from '../domains/01-core-infrastructure'
import type { ConnectionCategory, StreamType, Subscription } from './types'

const log = createLogger('subscription-manager')

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Manager  (Chapter 3.1 §6)
// ─────────────────────────────────────────────────────────────────────────────

class SubscriptionManager {
  private subscriptions = new Map<string, Subscription>() // stream → Subscription
  private bySymbol = new Map<string, Set<string>>() // symbol → set of streams
  private subscribers = new Set<(sub: Subscription) => void>()

  /** Create a subscription (§6 — duplicate subscriptions prohibited). */
  create(opts: {
    exchangeId: string
    stream: string
    streamType: StreamType
    symbol: string
    category: ConnectionCategory
    priority?: number
  }): Subscription {
    // §6 — duplicate check
    const existing = this.subscriptions.get(opts.stream)
    if (existing) {
      log.debug(`subscription already exists for ${opts.stream} — returning existing (§6 no duplicates)`)
      return existing
    }

    const sub: Subscription = {
      subscriptionId: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      exchangeId: opts.exchangeId,
      stream: opts.stream,
      streamType: opts.streamType,
      symbol: opts.symbol,
      category: opts.category,
      priority: opts.priority ?? 5,
      createdAt: Date.now(),
      shardId: null,
    }
    this.subscriptions.set(opts.stream, sub)

    // Index by symbol
    if (!this.bySymbol.has(opts.symbol)) this.bySymbol.set(opts.symbol, new Set())
    this.bySymbol.get(opts.symbol)!.add(opts.stream)

    log.debug(`subscription created: ${opts.stream} (symbol ${opts.symbol}, category ${opts.category}, priority ${sub.priority})`)
    for (const s of this.subscribers) s(sub)
    return sub
  }

  /** Batch-create subscriptions (§6 batching). */
  createBatch(streams: Array<Omit<Subscription, 'subscriptionId' | 'createdAt' | 'shardId'>>): Subscription[] {
    return streams.map((s) => this.create(s))
  }

  /** Remove a subscription (§6 removal). */
  remove(stream: string): boolean {
    const sub = this.subscriptions.get(stream)
    if (!sub) return false
    this.subscriptions.delete(stream)
    const syms = this.bySymbol.get(sub.symbol)
    if (syms) {
      syms.delete(stream)
      if (syms.size === 0) this.bySymbol.delete(sub.symbol)
    }
    log.debug(`subscription removed: ${stream}`)
    return true
  }

  /** Remove all subscriptions for a symbol (§6). */
  removeBySymbol(symbol: string): number {
    const streams = this.bySymbol.get(symbol)
    if (!streams) return 0
    let count = 0
    for (const stream of streams) {
      this.subscriptions.delete(stream)
      count++
    }
    this.bySymbol.delete(symbol)
    log.info(`removed ${count} subscriptions for ${symbol}`)
    return count
  }

  /** Get a subscription by stream name. */
  get(stream: string): Subscription | undefined {
    return this.subscriptions.get(stream)
  }

  /** Get all subscriptions for a symbol (§6 monitoring). */
  getBySymbol(symbol: string): Subscription[] {
    const streams = this.bySymbol.get(symbol)
    if (!streams) return []
    return Array.from(streams).map((s) => this.subscriptions.get(s)!).filter(Boolean)
  }

  /** Get all subscriptions, sorted by priority (§6 prioritization). */
  getAll(): Subscription[] {
    return Array.from(this.subscriptions.values()).sort((a, b) => a.priority - b.priority)
  }

  /** Get subscriptions by category (§6). */
  getByCategory(category: ConnectionCategory): Subscription[] {
    return this.getAll().filter((s) => s.category === category)
  }

  /** Assign a shard ID to a subscription (§7 stream sharding). */
  assignShard(stream: string, shardId: string): void {
    const sub = this.subscriptions.get(stream)
    if (sub) sub.shardId = shardId
  }

  /** Renew a subscription (§6 renewal — e.g. after reconnect). */
  renew(stream: string): Subscription | undefined {
    const sub = this.subscriptions.get(stream)
    if (sub) {
      log.debug(`subscription renewed: ${stream}`)
    }
    return sub
  }

  /** Renew all subscriptions for a shard (§6 — after shard reconnect). */
  renewByShard(shardId: string): Subscription[] {
    const subs = this.getAll().filter((s) => s.shardId === shardId)
    for (const sub of subs) this.renew(sub.stream)
    return subs
  }

  /** Monitoring stats (§6). */
  getStats(): {
    total: number
    byCategory: Record<ConnectionCategory, number>
    byShard: Record<string, number>
    unassigned: number
  } {
    const byCategory: Record<ConnectionCategory, number> = {
      A_STREAMING: 0, B_SNAPSHOT: 0, C_REFERENCE: 0, D_OPERATIONAL: 0,
    }
    const byShard: Record<string, number> = {}
    let unassigned = 0
    for (const sub of this.subscriptions.values()) {
      byCategory[sub.category]++
      if (sub.shardId) byShard[sub.shardId] = (byShard[sub.shardId] ?? 0) + 1
      else unassigned++
    }
    return { total: this.subscriptions.size, byCategory, byShard, unassigned }
  }

  subscribe(handler: (sub: Subscription) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  clear(): void {
    this.subscriptions.clear()
    this.bySymbol.clear()
  }
}

export const subscriptionManager = new SubscriptionManager()
