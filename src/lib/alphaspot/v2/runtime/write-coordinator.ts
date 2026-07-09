// CHAPTER 2.3 §7, §8, §9, §10, §16 — Write Coordination
//
// Business domains NEVER write directly to persistent storage (Rule 2).
// All write operations pass through this centralized Write Coordination layer
// (Chapter 2.3 §8). Responsibilities:
//   • transaction coordination    • durability
//   • batching                    • retry
//   • ordering                    • storage abstraction
//   • validation
//
// Read/write separation (§9): reads never block writes; writes never interrupt
// analytical processing. Business domains consume published state, not DB tx.
//
// Storage abstraction (§10): the underlying engine is interchangeable —
// embedded (SQLite today), relational, distributed, cloud. Changing it must
// not require business-logic modifications (Rule 9).

import { createLogger } from '../domains/01-core-infrastructure'
import { idempotency } from '../events/idempotency'

const log = createLogger('write-coordinator')

// ─────────────────────────────────────────────────────────────────────────────
// Storage abstraction  (Chapter 2.3 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageBackend {
  /** Insert a single row into a named collection/table. */
  insert(collection: string, row: unknown): Promise<void>
  /** Insert many rows in one batch (§8 batching). */
  insertBatch(collection: string, rows: unknown[]): Promise<void>
  /** Update a row by id. */
  update(collection: string, id: string, patch: unknown): Promise<void>
  /** Delete a row by id. */
  delete(collection: string, id: string): Promise<void>
  /** Run a transaction (§8 transaction coordination). */
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>
}

export interface StorageTx {
  insert(collection: string, row: unknown): Promise<void>
  update(collection: string, id: string, patch: unknown): Promise<void>
  delete(collection: string, id: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations  (Chapter 2.3 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type WriteKind = 'INSERT' | 'UPDATE' | 'DELETE' | 'BATCH_INSERT'

export interface WriteOperation {
  /** Unique ID for idempotency (§10 of Ch 2.2 — duplicate writes must not duplicate data). */
  writeId: string
  kind: WriteKind
  collection: string
  row?: unknown
  rows?: unknown[]
  id?: string
  patch?: unknown
  priority: WritePriority
  createdAt: number
}

export type WritePriority = 'REALTIME' | 'INTERACTIVE' | 'ANALYTICAL' | 'BACKGROUND'

const PRIORITY_RANK: Record<WritePriority, number> = {
  REALTIME: 0,
  INTERACTIVE: 1,
  ANALYTICAL: 2,
  BACKGROUND: 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Write Coordinator  (Chapter 2.3 §8)
// ─────────────────────────────────────────────────────────────────────────────

interface WriteCoordinatorConfig {
  /** Max writes per batch flush (§8 batching). */
  batchSize: number
  /** Batch flush interval in ms. */
  batchIntervalMs: number
  /** Max retries per write (§8 retry). */
  maxRetries: number
  /** Max queue depth before backpressure (§13, §22). */
  maxQueueDepth: number
}

const DEFAULT_CONFIG: WriteCoordinatorConfig = {
  batchSize: 50,
  batchIntervalMs: 1000,
  maxRetries: 3,
  maxQueueDepth: 5000,
}

class WriteCoordinator {
  private backend: StorageBackend | null = null
  private queue: WriteOperation[] = []
  private processing = false
  private config: WriteCoordinatorConfig = { ...DEFAULT_CONFIG }
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private stats = {
    totalWrites: 0,
    batchedWrites: 0,
    successfulWrites: 0,
    failedWrites: 0,
    retriedWrites: 0,
    duplicatesSuppressed: 0,
    currentQueueDepth: 0,
    maxQueueDepth: 0,
    lastFlushAt: 0,
    averageLatencyMs: 0,
  }
  private latencySamples: number[] = []

  /** Register the storage backend (§10 — replaceable). */
  setBackend(backend: StorageBackend): void {
    this.backend = backend
    log.info('storage backend registered')
  }

  /** Start the batch flush loop. */
  start(): void {
    if (this.flushTimer) return
    this.flushTimer = setInterval(() => {
      void this.flush().catch((e) => log.error(`flush failed: ${e instanceof Error ? e.message : String(e)}`))
    }, this.config.batchIntervalMs)
    log.info(`write coordinator started — batch every ${this.config.batchIntervalMs}ms, size ${this.config.batchSize}`)
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // Final flush
    void this.flush().catch(() => {})
    log.info('write coordinator stopped')
  }

  /** Enqueue a write operation (called by business domains — Rule 2). */
  enqueue(op: Omit<WriteOperation, 'createdAt'>): string {
    // Backpressure (§13): if queue is full, reject low-priority writes
    if (this.queue.length >= this.config.maxQueueDepth) {
      if (op.priority === 'BACKGROUND' || op.priority === 'ANALYTICAL') {
        log.warn(`write queue full (${this.queue.length}) — dropping ${op.priority} write ${op.writeId}`)
        this.stats.failedWrites++
        return op.writeId
      }
    }

    // Idempotency (Ch 2.2 §10): suppress duplicate writeIds
    if (!idempotency.check(op.writeId)) {
      this.stats.duplicatesSuppressed++
      return op.writeId
    }

    this.queue.push({ ...op, createdAt: Date.now() })
    this.stats.totalWrites++
    this.stats.currentQueueDepth = this.queue.length
    if (this.queue.length > this.stats.maxQueueDepth) {
      this.stats.maxQueueDepth = this.queue.length
    }

    // Trigger immediate flush if we hit batch size
    if (this.queue.length >= this.config.batchSize) {
      void this.flush().catch(() => {})
    }
    return op.writeId
  }

  /** Flush pending writes, batched by collection + priority (§8 batching, ordering). */
  async flush(): Promise<void> {
    if (this.processing || this.queue.length === 0 || !this.backend) return
    this.processing = true

    try {
      // Sort by priority (REALTIME first) then by enqueue time (FIFO) — §8 ordering
      this.queue.sort((a, b) => {
        const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        return p !== 0 ? p : a.createdAt - b.createdAt
      })

      // Group batchable inserts by collection
      const batch: WriteOperation[] = []
      const deferred: WriteOperation[] = []
      const batchByCollection = new Map<string, unknown[]>()

      while (this.queue.length > 0 && batch.length < this.config.batchSize) {
        const op = this.queue.shift()!
        if (op.kind === 'BATCH_INSERT' || op.kind === 'INSERT') {
          const rows = op.kind === 'BATCH_INSERT' ? op.rows! : [op.row]
          const existing = batchByCollection.get(op.collection) ?? []
          existing.push(...rows)
          batchByCollection.set(op.collection, existing)
          batch.push(op)
          this.stats.batchedWrites += rows.length
        } else {
          // UPDATE / DELETE — execute individually (can't safely batch)
          deferred.push(op)
        }
      }

      // Execute batched inserts
      for (const [collection, rows] of batchByCollection) {
        await this.executeWithRetry(() => this.backend!.insertBatch(collection, rows), `batch_insert:${collection}`)
      }

      // Execute deferred updates/deletes
      for (const op of deferred) {
        await this.executeWrite(op)
      }

      this.stats.successfulWrites += batch.length + deferred.length
      this.stats.currentQueueDepth = this.queue.length
      this.stats.lastFlushAt = Date.now()
    } finally {
      this.processing = false
    }
  }

  private async executeWrite(op: WriteOperation): Promise<void> {
    const start = Date.now()
    await this.executeWithRetry(() => {
      switch (op.kind) {
        case 'UPDATE':
          return this.backend!.update(op.collection, op.id!, op.patch)
        case 'DELETE':
          return this.backend!.delete(op.collection, op.id!)
        default:
          return Promise.resolve()
      }
    }, `${op.kind}:${op.collection}:${op.id ?? ''}`)
    this.recordLatency(Date.now() - start)
  }

  /** Execute a write with retry (§8 retry). */
  private async executeWithRetry(fn: () => Promise<void>, label: string): Promise<void> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await fn()
        return
      } catch (e) {
        lastErr = e
        if (attempt < this.config.maxRetries) {
          this.stats.retriedWrites++
          const delay = 200 * Math.pow(2, attempt) // exponential backoff
          log.warn(`write "${label}" failed (attempt ${attempt + 1}/${this.config.maxRetries + 1}): ${e instanceof Error ? e.message : String(e)} — retrying in ${delay}ms`)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
    this.stats.failedWrites++
    log.error(`write "${label}" permanently failed after ${this.config.maxRetries + 1} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
  }

  private recordLatency(ms: number): void {
    this.latencySamples.push(ms)
    if (this.latencySamples.length > 200) this.latencySamples.shift()
    const sum = this.latencySamples.reduce((a, b) => a + b, 0)
    this.stats.averageLatencyMs = sum / this.latencySamples.length
  }

  getStats() {
    return { ...this.stats }
  }

  getConfig(): WriteCoordinatorConfig {
    return { ...this.config }
  }

  setConfig(patch: Partial<WriteCoordinatorConfig>): void {
    this.config = { ...this.config, ...patch }
  }
}

export const writeCoordinator = new WriteCoordinator()

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: domain-facing write helpers (Rule 2 — domains use these, not the DB)
// ─────────────────────────────────────────────────────────────────────────────

let writeCounter = 0
function nextWriteId(prefix: string): string {
  writeCounter++
  return `write-${prefix}-${Date.now().toString(36)}-${writeCounter}`
}

export function queueInsert(collection: string, row: unknown, priority: WritePriority = 'ANALYTICAL'): string {
  return writeCoordinator.enqueue({ writeId: nextWriteId('ins'), kind: 'INSERT', collection, row, priority, createdAt: 0 })
}

export function queueBatchInsert(collection: string, rows: unknown[], priority: WritePriority = 'BACKGROUND'): string {
  return writeCoordinator.enqueue({ writeId: nextWriteId('bat'), kind: 'BATCH_INSERT', collection, rows, priority, createdAt: 0 })
}

export function queueUpdate(collection: string, id: string, patch: unknown, priority: WritePriority = 'ANALYTICAL'): string {
  return writeCoordinator.enqueue({ writeId: nextWriteId('upd'), kind: 'UPDATE', collection, id, patch, priority, createdAt: 0 })
}

export function queueDelete(collection: string, id: string, priority: WritePriority = 'BACKGROUND'): string {
  return writeCoordinator.enqueue({ writeId: nextWriteId('del'), kind: 'DELETE', collection, id, priority, createdAt: 0 })
}
