// CHAPTER 3.4 — Historical Data Manager (HDM) Facade
//
// The authoritative source of historical market data (§1, §3, Rule 3).
// Provides validated, versioned, immutable, reproducible historical datasets.
//
// Responsibilities:
//   • Import + validate datasets (§4, §7, §8)
//   • Store metadata in Prisma, payloads in columnar store (§15)
//   • Version datasets monotonically (§7, Rule 2)
//   • Detect + repair gaps (§11, §12)
//   • Query datasets with versioned interfaces (§14)
//   • Stitch historical + live data (§14.1)
//   • Feature compatibility contract (§18.1)
//   • Reproducibility provenance (§18)

import { createLogger } from '../domains/01-core-infrastructure'
import { db } from '../../../db'
import { getPayloadStore } from './payload-store'
import { validateDataset, detectGaps, repairGaps, type RepairResult } from './validation'
import {
  ACTIVE_FEATURE_COMPATIBILITY_VERSION,
  NORMALIZATION_VERSION,
  type CanonicalHistoricalCandle,
  type DatasetQuery,
  type DatasetVersion,
  type DataQuality,
  type ExperimentProvenance,
  type FeatureCompatibilityContract,
  type HistoricalDatasetSnapshot,
  type SupportedTimeframe,
} from './types'

const log = createLogger('historical-data:manager')

// ─────────────────────────────────────────────────────────────────────────────
// Historical Data Manager  (Chapter 3.4 §1, §3)
// ─────────────────────────────────────────────────────────────────────────────

class HistoricalDataManager {
  private queryLatencySamples: number[] = []
  private cacheHits = 0
  private cacheMisses = 0
  private stats = {
    totalImports: 0,
    totalValidations: 0,
    totalRepairs: 0,
    totalQueries: 0,
  }

  /**
   * Import a historical dataset (§4, §7, §8).
   * Validates the data, stores metadata in Prisma, stores payload in the
   * columnar payload store (§15 — physically separated).
   * Returns the new dataset version.
   */
  async import(
    exchange: string,
    symbol: string,
    timeframe: SupportedTimeframe,
    candles: CanonicalHistoricalCandle[],
    source: 'exchange-rest' | 'exchange-archive' | 'internal-replay' | 'institutional-provider',
    expectedStartTime: number,
    expectedEndTime: number,
  ): Promise<DatasetVersion> {
    this.stats.totalImports++
    log.info(`importing dataset: ${exchange}:${symbol}:${timeframe} (${candles.length} candles from ${source})`)

    // §8 — validate the dataset
    this.stats.totalValidations++
    const validation = validateDataset(candles, timeframe, expectedStartTime, expectedEndTime)

    // Determine the next version number (§7, Rule 2 — monotonically increasing)
    const existing = await db.historicalDataset.findFirst({
      where: { exchange, symbol, timeframe },
      orderBy: { version: 'desc' },
    })
    const nextVersion = (existing?.version ?? 0) + 1
    const datasetId = `ds-${exchange}-${symbol.replace('/', '-')}-${timeframe}`
    const storageLocation = `${exchange}/${symbol.replace('/', '-')}/${timeframe}/v${nextVersion}`

    // §15 — store payload in the columnar payload store
    const payloadStore = getPayloadStore()
    await payloadStore.write(storageLocation, candles)

    // §15 — store metadata in Prisma (physically separated from payload)
    const record = await db.historicalDataset.create({
      data: {
        datasetId: `${datasetId}-v${nextVersion}`,
        version: nextVersion,
        exchange,
        symbol,
        timeframe,
        startTime: expectedStartTime,
        endTime: expectedEndTime,
        candleCount: candles.length,
        importTimestamp: BigInt(Date.now()),
        source,
        validationStatus: validation.passed ? 'VALIDATED' : validation.quality.validationResult === 'FAIL' ? 'FAILED' : 'QUARANTINED',
        normalizationVersion: NORMALIZATION_VERSION,
        featureCompatibilityVersion: ACTIVE_FEATURE_COMPATIBILITY_VERSION,
        storageLocation,
        storageFormat: payloadStore.getFormat(),
        coveragePct: validation.quality.coveragePct,
        missingCandleCount: validation.quality.missingCandleCount,
        repairCount: 0,
        importErrorCount: validation.quality.importErrors.length,
        healthScore: validation.quality.healthScore,
        retentionStatus: 'ACTIVE',
      },
    })

    log.info(`dataset imported: ${record.datasetId} v${nextVersion} (status: ${record.validationStatus}, health: ${record.healthScore.toFixed(2)})`)

    return this.recordToVersion(record)
  }

  /**
   * Query a historical dataset (§14 — versioned interface).
   * Consumers specify: Asset, Timeframe, Date Range, Dataset Version (optional).
   * Returns immutable historical snapshots.
   */
  async query(query: DatasetQuery): Promise<HistoricalDatasetSnapshot | null> {
    this.stats.totalQueries++
    const queryStart = Date.now()

    // Find the dataset version
    const where: Record<string, unknown> = {
      symbol: query.symbol,
      timeframe: query.timeframe,
      validationStatus: 'VALIDATED',
      retentionStatus: 'ACTIVE',
    }
    if (query.datasetVersion) {
      where.version = query.datasetVersion
    }

    let record = await db.historicalDataset.findFirst({ where, orderBy: { version: 'desc' } })

    // §10 — reject datasets below minimum health score
    if (record && query.minHealthScore && record.healthScore < query.minHealthScore) {
      log.warn(`dataset ${record.datasetId} health ${record.healthScore.toFixed(2)} below threshold ${query.minHealthScore}`)
      record = null
    }

    // §18.1 — feature compatibility check
    if (record && query.featureCompatibilityVersion) {
      const compat = this.checkFeatureCompatibility(record.featureCompatibilityVersion, query.featureCompatibilityVersion)
      if (!compat.compatible) {
        log.warn(`dataset ${record.datasetId} feature version ${record.featureCompatibilityVersion} incompatible with ${query.featureCompatibilityVersion}`)
        record = null
      }
    }

    if (!record) {
      this.cacheMisses++
      return null
    }

    // Read payload from the columnar store (§15)
    const payloadStore = getPayloadStore()
    const candles = await payloadStore.read(record.storageLocation, query.startTime, query.endTime)

    const latencyMs = Date.now() - queryStart
    this.recordLatency(latencyMs)
    this.cacheHits++

    const dataset = this.recordToVersion(record)
    const quality: DataQuality = {
      coveragePct: record.coveragePct,
      missingCandleCount: record.missingCandleCount,
      repairCount: record.repairCount,
      validationResult: 'PASS',
      importErrors: [],
      healthScore: record.healthScore,
    }

    return {
      dataset,
      candles: Object.freeze(candles) as ReadonlyArray<CanonicalHistoricalCandle>,
      quality,
      retrievedAt: Date.now(),
      queryLatencyMs: latencyMs,
    }
  }

  /**
   * Stitch historical + live data (§14.1 — deterministic concatenation).
   * Historical candles and live candles share the same canonical schema (Rule 12).
   * Consumers remain unaware whether observations originate from historical or live.
   */
  stitch(
    historical: CanonicalHistoricalCandle[],
    liveCandles: CanonicalHistoricalCandle[],
  ): CanonicalHistoricalCandle[] {
    // §14.1 — combine + deduplicate by timestamp, prefer the completed historical candle
    const map = new Map<number, CanonicalHistoricalCandle>()
    for (const c of historical) {
      if (c.isClosed) map.set(c.time, c) // historical completed candles are immutable
    }
    for (const c of liveCandles) {
      if (!map.has(c.time) || !map.get(c.time)!.isClosed) {
        map.set(c.time, c) // live candle fills a gap or updates an incomplete one
      }
    }
    // Sort by time (§9.1 — monotonically increasing)
    return [...map.values()].sort((a, b) => a.time - b.time)
  }

  /**
   * Check feature compatibility (§18.1).
   * Feature Engineering consumes only datasets whose schema version is compatible.
   */
  checkFeatureCompatibility(datasetVersion: string, pipelineVersion: string = ACTIVE_FEATURE_COMPATIBILITY_VERSION): FeatureCompatibilityContract {
    const compatible = datasetVersion === pipelineVersion
    return {
      datasetFeatureVersion: datasetVersion,
      activePipelineVersion: pipelineVersion,
      compatible,
      reason: compatible ? null : `Dataset feature version ${datasetVersion} != pipeline version ${pipelineVersion}`,
    }
  }

  /**
   * Detect gaps in a dataset (§11).
   */
  async detectDatasetGaps(datasetId: string): Promise<{ gaps: import('./types').DataGap[]; datasetVersion: DatasetVersion | null }> {
    const record = await db.historicalDataset.findFirst({ where: { datasetId }, orderBy: { version: 'desc' } })
    if (!record) return { gaps: [], datasetVersion: null }

    const payloadStore = getPayloadStore()
    const candles = await payloadStore.read(record.storageLocation)
    const gaps = detectGaps(candles, record.timeframe as SupportedTimeframe)
    return { gaps, datasetVersion: this.recordToVersion(record) }
  }

  /**
   * Repair a dataset (§12 — 5-stage repair).
   * Original datasets remain archived (Rule 9).
   */
  async repair(
    datasetId: string,
    fetchAuthoritativeCandles: (startTime: number, endTime: number) => Promise<CanonicalHistoricalCandle[]>,
  ): Promise<RepairResult> {
    this.stats.totalRepairs++
    const { gaps, datasetVersion } = await this.detectDatasetGaps(datasetId)
    if (!datasetVersion) {
      return { repaired: false, repairedGaps: 0, newCandles: [], replacementDatasetVersion: null, note: 'dataset not found' }
    }
    return repairGaps(datasetId, gaps, datasetVersion.version, fetchAuthoritativeCandles)
  }

  /**
   * Record experiment provenance (§18 — reproducibility).
   * Every experiment must record: Dataset Version, Feature Version, Model Version, Normalization Version.
   */
  recordProvenance(opts: {
    experimentId: string
    datasetVersion: string
    featureVersion: string
    modelVersion: string
  }): ExperimentProvenance {
    const provenance: ExperimentProvenance = {
      experimentId: opts.experimentId,
      datasetVersion: opts.datasetVersion,
      featureVersion: opts.featureVersion,
      modelVersion: opts.modelVersion,
      normalizationVersion: NORMALIZATION_VERSION,
      recordedAt: Date.now(),
    }
    log.info(`experiment provenance recorded: ${opts.experimentId} (dataset ${opts.datasetVersion}, feature ${opts.featureVersion}, model ${opts.modelVersion})`)
    return provenance
  }

  /** Get all datasets for a symbol/timeframe. */
  async listDatasets(symbol?: string, timeframe?: SupportedTimeframe): Promise<DatasetVersion[]> {
    const where: Record<string, unknown> = {}
    if (symbol) where.symbol = symbol
    if (timeframe) where.timeframe = timeframe
    const records = await db.historicalDataset.findMany({ where, orderBy: { version: 'desc' } })
    return records.map((r) => this.recordToVersion(r))
  }

  /** Update retention status (§17). */
  async setRetention(datasetId: string, status: 'ACTIVE' | 'ARCHIVED' | 'COMPRESSED' | 'RETIRED'): Promise<void> {
    await db.historicalDataset.updateMany({ where: { datasetId }, data: { retentionStatus: status } })
    log.info(`dataset ${datasetId} retention → ${status}`)
  }

  /** Observability stats (§19). */
  getStats() {
    const avgLatency = this.queryLatencySamples.length > 0
      ? this.queryLatencySamples.reduce((a, b) => a + b, 0) / this.queryLatencySamples.length
      : 0
    const cacheHitRate = this.cacheHits + this.cacheMisses > 0
      ? this.cacheHits / (this.cacheHits + this.cacheMisses)
      : 0
    return {
      ...this.stats,
      avgQueryLatencyMs: avgLatency,
      cacheHitRate,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    }
  }

  private recordLatency(ms: number): void {
    this.queryLatencySamples.push(ms)
    if (this.queryLatencySamples.length > 500) this.queryLatencySamples.shift()
  }

  private recordToVersion(r: import('@prisma/client').HistoricalDataset): DatasetVersion {
    return {
      datasetId: r.datasetId,
      version: r.version,
      exchange: r.exchange,
      symbol: r.symbol,
      timeframe: r.timeframe as SupportedTimeframe,
      startTime: r.startTime,
      endTime: r.endTime,
      candleCount: r.candleCount,
      importTimestamp: Number(r.importTimestamp),
      source: r.source as DatasetVersion['source'],
      validationStatus: r.validationStatus as DatasetVersion['validationStatus'],
      normalizationVersion: r.normalizationVersion,
      featureCompatibilityVersion: r.featureCompatibilityVersion,
      storageLocation: r.storageLocation,
      storageFormat: r.storageFormat as DatasetVersion['storageFormat'],
      healthScore: r.healthScore,
      retentionStatus: r.retentionStatus as DatasetVersion['retentionStatus'],
    }
  }
}

export const historicalDataManager = new HistoricalDataManager()
