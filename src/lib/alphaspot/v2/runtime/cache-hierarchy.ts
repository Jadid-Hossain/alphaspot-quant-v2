// CHAPTER 2.3 §11, §12 — Cache Hierarchy & Memory Lifecycle
//
// 3-level cache hierarchy:
//   L1 — Realtime Memory Cache (lowest latency, short-lived)
//   L2 — Analytical Cache (intermediate computation)
//   L3 — Persistent Storage (long-term durability, delegated to Persistence)
//
// Data moves DOWNWARD through the hierarchy (§11).
// Memory usage must remain BOUNDED (§12, Rule 6). No component may retain
// unlimited historical state.

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('cache-hierarchy')

// ─────────────────────────────────────────────────────────────────────────────
// Cache entry  (Chapter 2.3 §12 — bounded memory)
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  createdAt: number
  lastAccessedAt: number
  hitCount: number
  sizeBytes: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded LRU cache  (Chapter 2.3 §12 — memory lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

class BoundedCache<T> {
  private store = new Map<string, CacheEntry<T>>()
  private totalBytes = 0
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly ttlMs: number
  private stats = { hits: 0, misses: 0, evictions: 0, sets: 0 }

  constructor(name: string, opts: { maxEntries: number; maxBytes: number; ttlMs: number }) {
    this.maxEntries = opts.maxEntries
    this.maxBytes = opts.maxBytes
    this.ttlMs = opts.ttlMs
    log.info(`L1/L2 cache "${name}" — max ${opts.maxEntries} entries, ${opts.maxBytes} bytes, TTL ${opts.ttlMs}ms`)
  }

  get(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) {
      this.stats.misses++
      return null
    }
    // TTL check (§12 — short-lived data)
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key)
      this.totalBytes -= entry.sizeBytes
      this.stats.misses++
      this.stats.evictions++
      return null
    }
    // LRU: re-insert to mark as recently used
    this.store.delete(key)
    entry.lastAccessedAt = Date.now()
    entry.hitCount++
    this.store.set(key, entry)
    this.stats.hits++
    return entry.value
  }

  set(key: string, value: T, sizeBytes = 1024): void {
    // Evict if at capacity (LRU — §12 bounded memory)
    while (this.store.size >= this.maxEntries || this.totalBytes + sizeBytes > this.maxBytes) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      const evicted = this.store.get(oldest)!
      this.store.delete(oldest)
      this.totalBytes -= evicted.sizeBytes
      this.stats.evictions++
    }
    this.store.set(key, { value, createdAt: Date.now(), lastAccessedAt: Date.now(), hitCount: 0, sizeBytes })
    this.totalBytes += sizeBytes
    this.stats.sets++
  }

  delete(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return false
    this.store.delete(key)
    this.totalBytes -= entry.sizeBytes
    return true
  }

  clear(): void {
    this.store.clear()
    this.totalBytes = 0
  }

  size(): number {
    return this.store.size
  }

  bytes(): number {
    return this.totalBytes
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      entries: this.store.size,
      bytes: this.totalBytes,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache hierarchy facade  (Chapter 2.3 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface CacheStats {
  l1: ReturnType<BoundedCache<unknown>['getStats']>
  l2: ReturnType<BoundedCache<unknown>['getStats']>
}

class CacheHierarchy {
  // L1: Realtime — very short TTL, small, fastest
  readonly l1 = new BoundedCache<unknown>('L1-realtime', {
    maxEntries: 1000,
    maxBytes: 50 * 1024 * 1024, // 50MB
    ttlMs: 5_000, // 5 seconds
  })
  // L2: Analytical — longer TTL, larger, intermediate computation
  readonly l2 = new BoundedCache<unknown>('L2-analytical', {
    maxEntries: 5000,
    maxBytes: 200 * 1024 * 1024, // 200MB
    ttlMs: 5 * 60 * 1000, // 5 minutes
  })

  /** Get from L1, then L2. Returns null if not in either (caller queries L3/persistent). */
  get<T>(key: string): T | null {
    const l1 = this.l1.get(key)
    if (l1 != null) return l1 as T
    const l2 = this.l2.get(key)
    if (l2 != null) {
      // Promote to L1 (data moves UPWARD on read for hot data)
      this.l1.set(key, l2)
      return l2 as T
    }
    return null
  }

  /** Set in L1 (realtime data). */
  setL1<T>(key: string, value: T, sizeBytes?: number): void {
    this.l1.set(key, value, sizeBytes)
  }

  /** Set in L2 (analytical data). */
  setL2<T>(key: string, value: T, sizeBytes?: number): void {
    this.l2.set(key, value, sizeBytes)
  }

  /** Set in both L1 and L2 (hot analytical data). */
  setBoth<T>(key: string, value: T, sizeBytes?: number): void {
    this.l1.set(key, value, sizeBytes)
    this.l2.set(key, value, sizeBytes)
  }

  delete(key: string): void {
    this.l1.delete(key)
    this.l2.delete(key)
  }

  clear(): void {
    this.l1.clear()
    this.l2.clear()
  }

  getStats(): CacheStats {
    return { l1: this.l1.getStats(), l2: this.l2.getStats() }
  }
}

export const cacheHierarchy = new CacheHierarchy()
