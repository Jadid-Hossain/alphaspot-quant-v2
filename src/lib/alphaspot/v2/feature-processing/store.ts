// CHAPTER 3.10 §10, §11, §12, §13, §14, §16 — Feature Store
//
// Online Store (§11): live inference, low latency, latest features, no historical editing.
// Offline Store (§12): training, backtesting, columnar storage.
//   §16, Rule 16: metadata in transactional DB, payloads in immutable columnar storage.
//   Transactional DBs NEVER store large feature payloads.
// Lineage (§13, Rule 10): full traceability.
// Immutable (§14, Rule 8, Rule 14): modifications create new versions.
// Atomic writes (Rule 13): no partially processed vectors.

import { createLogger } from '../domains/01-core-infrastructure'
import type { ProcessedFeatureVector, FeatureLineage } from './types'

const log = createLogger('feature-processing:store')

// ─────────────────────────────────────────────────────────────────────────────
// Online Feature Store  (Chapter 3.10 §11)
// ─────────────────────────────────────────────────────────────────────────────

class OnlineFeatureStore {
  private latest = new Map<string, ProcessedFeatureVector>() // symbol → latest
  private stats = { writes: 0, reads: 0 }

  /** Write the latest processed vector for an asset (§11 — atomic, Rule 13). */
  write(vector: ProcessedFeatureVector): void {
    this.latest.set(vector.symbol, vector) // atomic replace
    this.stats.writes++
  }

  /** Read the latest processed vector (§11 — low latency, fast retrieval). */
  read(symbol: string): ProcessedFeatureVector | null {
    this.stats.reads++
    return this.latest.get(symbol) ?? null
  }

  /** Read all latest vectors. */
  readAll(): Array<{ symbol: string; vector: ProcessedFeatureVector }> {
    this.stats.reads++
    return Array.from(this.latest.entries()).map(([symbol, vector]) => ({ symbol, vector }))
  }

  getStats() {
    return { ...this.stats, assetCount: this.latest.size }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline Feature Store  (Chapter 3.10 §12, §16, Rule 16)
// Metadata in transactional DB, payloads in columnar storage (separate).
// ─────────────────────────────────────────────────────────────────────────────

interface OfflineMetadata {
  datasetId: string
  symbol: string
  timestamp: number
  featureVersion: string
  processingVersion: string
  scalingVersion: string
  schemaVersion: string
  storageLocation: string // path/key in the columnar payload store
  lineage: FeatureLineage | null
  createdAt: number
  version: number
}

class OfflineFeatureStore {
  private metadata = new Map<string, OfflineMetadata[]>() // symbol → metadata records
  private payloads = new Map<string, ProcessedFeatureVector>() // storageLocation → payload (in-memory; would be Parquet/Arrow in production)
  private versionCounters = new Map<string, number>() // symbol → latest version
  private stats = { totalStored: 0, totalReads: 0, payloadBytes: 0 }

  /**
   * Store a processed feature vector (§12, Rule 13, Rule 14, Rule 16).
   * Metadata → in-memory map (would be Prisma in production).
   * Payload → in-memory columnar (would be Parquet/Arrow in production).
   * Atomic + versioned. Historical datasets immutable.
   */
  store(vector: ProcessedFeatureVector, lineage?: FeatureLineage): string {
    const version = (this.versionCounters.get(vector.symbol) ?? 0) + 1
    this.versionCounters.set(vector.symbol, version)

    const datasetId = `ds-${vector.symbol}-${vector.timestamp}-${version}`
    const storageLocation = `offline/${vector.symbol}/v${version}/${vector.timestamp}`

    // §16, Rule 16 — store metadata separately from payload
    const meta: OfflineMetadata = {
      datasetId,
      symbol: vector.symbol,
      timestamp: vector.timestamp,
      featureVersion: vector.featureVersion,
      processingVersion: vector.processingVersion,
      scalingVersion: vector.scalingVersion,
      schemaVersion: '2.0.0',
      storageLocation,
      lineage: lineage ?? null,
      createdAt: Date.now(),
      version,
    }

    // Store metadata
    const metaList = this.metadata.get(vector.symbol) ?? []
    metaList.push(meta)
    if (metaList.length > 1000) metaList.shift() // bounded
    this.metadata.set(vector.symbol, metaList)

    // Store payload (columnar — in production: Parquet/Arrow)
    this.payloads.set(storageLocation, vector)
    this.stats.totalStored++
    this.stats.payloadBytes += JSON.stringify(vector.processedFeatures).length

    log.debug(`stored offline: ${datasetId} (v${version})`)
    return datasetId
  }

  /** Retrieve a processed vector by dataset ID (§12). */
  retrieve(datasetId: string): ProcessedFeatureVector | null {
    this.stats.totalReads++
    // Find metadata → get storage location → read payload
    for (const metaList of this.metadata.values()) {
      const meta = metaList.find((m) => m.datasetId === datasetId)
      if (meta) {
        return this.payloads.get(meta.storageLocation) ?? null
      }
    }
    return null
  }

  /** Get metadata for a symbol (§12 — lineage, statistics). */
  getMetadata(symbol: string, limit = 100): OfflineMetadata[] {
    return (this.metadata.get(symbol) ?? []).slice(-limit)
  }

  /** Get lineage for a dataset (§13, Rule 10). */
  getLineage(datasetId: string): FeatureLineage | null {
    for (const metaList of this.metadata.values()) {
      const meta = metaList.find((m) => m.datasetId === datasetId)
      if (meta) return meta.lineage
    }
    return null
  }

  /** Get the latest version for a symbol. */
  getLatestVersion(symbol: string): number {
    return this.versionCounters.get(symbol) ?? 0
  }

  getStats() {
    return { ...this.stats, symbols: this.metadata.size }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Store Facade  (Chapter 3.10 §10 — unified access)
// ─────────────────────────────────────────────────────────────────────────────

class FeatureStoreFacade {
  readonly online: OnlineFeatureStore = new OnlineFeatureStore()
  readonly offline: OfflineFeatureStore = new OfflineFeatureStore()

  /**
   * Store a processed vector in BOTH stores (§10).
   * Online: latest for live inference (§11).
   * Offline: versioned historical for training/research (§12).
   * Atomic writes (Rule 13).
   */
  store(vector: ProcessedFeatureVector, lineage?: FeatureLineage): void {
    // §11 — online store (latest, atomic)
    this.online.write(vector)
    // §12 — offline store (versioned, immutable, columnar)
    this.offline.store(vector, lineage)
  }

  /** Get the latest processed vector for live inference (§11). */
  getLatest(symbol: string): ProcessedFeatureVector | null {
    return this.online.read(symbol)
  }

  /** Get historical processed vectors for training (§12). */
  getHistory(symbol: string, limit = 100): ProcessedFeatureVector[] {
    const metas = this.offline.getMetadata(symbol, limit)
    const vectors: ProcessedFeatureVector[] = []
    for (const meta of metas) {
      const v = this.offline.retrieve(meta.datasetId)
      if (v) vectors.push(v)
    }
    return vectors
  }

  getStats() {
    return {
      online: this.online.getStats(),
      offline: this.offline.getStats(),
    }
  }
}

export const featureStore = new FeatureStoreFacade()
