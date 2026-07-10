// CHAPTER 3.4 §15 — Storage Architecture
//
// Historical market payloads and dataset metadata are PHYSICALLY SEPARATED
// (§15, Rule 13). Metadata lives in Prisma (transactional DB). Payloads
// (OHLCV, trades, order book snapshots) live in an optimized columnar store
// (Parquet, Arrow, DuckDB, or equivalent) — §15, Rule 14.
//
// Transactional databases shall NEVER become the primary storage for large
// historical market payloads (§15).
//
// Business domains remain completely independent of the physical storage
// implementation (Rule 10). The storage layer is responsible for compression,
// partition pruning, column projection, sequential streaming, efficient
// analytical retrieval (§15).

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalHistoricalCandle, DatasetVersion, StorageFormat } from './types'

const log = createLogger('historical-data:payload-store')

// ─────────────────────────────────────────────────────────────────────────────
// Payload Store interface  (Chapter 3.4 §15 — pluggable columnar storage)
// ─────────────────────────────────────────────────────────────────────────────

export interface PayloadStore {
  /** Write candles to a dataset's payload location (§15). */
  write(storageLocation: string, candles: CanonicalHistoricalCandle[]): Promise<void>
  /** Read candles from a dataset's payload location (§15 — sequential streaming, column projection). */
  read(storageLocation: string, startTime?: number, endTime?: number): Promise<CanonicalHistoricalCandle[]>
  /** Delete a payload (only for RETIRED datasets — §17). */
  delete(storageLocation: string): Promise<void>
  /** Get the storage format this store uses. */
  getFormat(): StorageFormat
  /** Get the byte size of a payload (for observability §19). */
  getSize(storageLocation: string): Promise<number>
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory payload store (default — for development / small datasets)
//
// In production this would be replaced by a Parquet/Arrow/DuckDB-backed store.
// The interface (§15) ensures business domains are storage-independent (Rule 10).
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryPayloadStore implements PayloadStore {
  private store = new Map<string, CanonicalHistoricalCandle[]>()
  private sizes = new Map<string, number>()

  async write(storageLocation: string, candles: CanonicalHistoricalCandle[]): Promise<void> {
    // Deep copy + freeze (Rule 1 — immutable)
    const frozen = candles.map((c) => Object.freeze({ ...c }))
    this.store.set(storageLocation, frozen)
    // Estimate size: ~72 bytes per candle (8 fields × 8 bytes + overhead)
    const size = candles.length * 72
    this.sizes.set(storageLocation, size)
    log.debug(`wrote ${candles.length} candles to ${storageLocation} (~${size} bytes)`)
  }

  async read(storageLocation: string, startTime?: number, endTime?: number): Promise<CanonicalHistoricalCandle[]> {
    const candles = this.store.get(storageLocation) ?? []
    if (startTime !== undefined && endTime !== undefined) {
      // Partition pruning (§15) — filter by time range
      return candles.filter((c) => c.time >= startTime && c.time <= endTime)
    }
    return candles
  }

  async delete(storageLocation: string): Promise<void> {
    this.store.delete(storageLocation)
    this.sizes.delete(storageLocation)
  }

  getFormat(): StorageFormat {
    return 'columnar'
  }

  async getSize(storageLocation: string): Promise<number> {
    return this.sizes.get(storageLocation) ?? 0
  }

  /** Get total stored bytes (for observability §19). */
  getTotalSize(): number {
    let total = 0
    for (const size of this.sizes.values()) total += size
    return total
  }

  /** Get total candle count (for observability §19). */
  getTotalCandles(): number {
    let total = 0
    for (const candles of this.store.values()) total += candles.length
    return total
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload store singleton (pluggable — §15, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

let activePayloadStore: PayloadStore | null = null

export function getPayloadStore(): PayloadStore {
  if (!activePayloadStore) {
    activePayloadStore = new InMemoryPayloadStore()
  }
  return activePayloadStore
}

/** Replace the payload store (§15 — pluggable: Parquet, Arrow, DuckDB). */
export function setPayloadStore(store: PayloadStore): void {
  activePayloadStore = store
  log.info(`payload store set: ${store.getFormat()}`)
}

export { InMemoryPayloadStore }
