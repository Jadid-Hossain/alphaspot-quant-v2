// CHAPTER 3.4 — Historical Data Manager: Types & Contracts
//
// The HDM is the authoritative source of historical market data (§1).
// Historical data is immutable (§2, Rule 1). Every dataset is versioned (§7,
// Rule 2). Canonical timestamps use UTC Unix Epoch (§9.1, Rule 11).
// Historical and live market objects share the same canonical schema (§14.1,
// Rule 12) enabling deterministic stitching without runtime mapping.

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Historical Candle  (Chapter 3.4 §9, §9.1, §14.1)
//
// §14.1 — structurally compatible with live MarketState candles.
// §9.1 — timestamps are UTC Unix Epoch (integer seconds), timezone-independent.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalHistoricalCandle {
  /** UTC Unix Epoch in SECONDS (§9.1 — integer, monotonically increasing). */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume: number | null
  tradeCount: number | null
  /** Whether this candle is closed (historical) or still forming (live stitch). §14.1 */
  isClosed: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Supported timeframes  (Chapter 3.4 §6)
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedTimeframe =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '12h'
  | '1d' | '1w'

export const SUPPORTED_TIMEFRAMES: SupportedTimeframe[] = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w',
]

export const TIMEFRAME_MS: Record<SupportedTimeframe, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '12h': 43_200_000, '1d': 86_400_000, '1w': 604_800_000,
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset versioning  (Chapter 3.4 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type DataSource = 'exchange-rest' | 'exchange-archive' | 'internal-replay' | 'institutional-provider'
export type ValidationStatus = 'PENDING' | 'VALIDATED' | 'QUARANTINED' | 'FAILED'
export type RetentionStatus = 'ACTIVE' | 'ARCHIVED' | 'COMPRESSED' | 'RETIRED'
export type StorageFormat = 'columnar' | 'parquet' | 'arrow' | 'duckdb'

export interface DatasetVersion {
  datasetId: string
  version: number
  exchange: string
  symbol: string
  timeframe: SupportedTimeframe
  startTime: number // UTC epoch seconds
  endTime: number // UTC epoch seconds
  candleCount: number
  importTimestamp: number // UTC epoch ms
  source: DataSource
  validationStatus: ValidationStatus
  normalizationVersion: string
  featureCompatibilityVersion: string // §18.1
  storageLocation: string
  storageFormat: StorageFormat
  healthScore: number // 0..1
  retentionStatus: RetentionStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// Data quality  (Chapter 3.4 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataQuality {
  coveragePct: number
  missingCandleCount: number
  repairCount: number
  validationResult: 'PASS' | 'FAIL' | 'WARN'
  importErrors: string[]
  healthScore: number // 0..1
}

// ─────────────────────────────────────────────────────────────────────────────
// Gap detection  (Chapter 3.4 §11)
// ─────────────────────────────────────────────────────────────────────────────

export type GapType = 'MISSING' | 'DUPLICATE' | 'OVERLAP' | 'CLOCK_DISCONTINUITY' | 'CORRUPTED_RANGE'

export interface DataGap {
  gapId: string
  datasetId: string
  type: GapType
  startTime: number
  endTime: number
  expectedCount: number
  actualCount: number
  detectedAt: number
  repaired: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset query  (Chapter 3.4 §14)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetQuery {
  symbol: string
  timeframe: SupportedTimeframe
  startTime: number // UTC epoch seconds
  endTime: number
  datasetVersion?: number // optional — latest if omitted
  minHealthScore?: number // §10 — reject below threshold
  featureCompatibilityVersion?: string // §18.1 — only compatible datasets
}

export interface HistoricalDatasetSnapshot {
  dataset: DatasetVersion
  candles: ReadonlyArray<CanonicalHistoricalCandle>
  quality: DataQuality
  retrievedAt: number
  queryLatencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature compatibility contract  (Chapter 3.4 §18.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureCompatibilityContract {
  datasetFeatureVersion: string
  activePipelineVersion: string
  compatible: boolean
  reason: string | null
}

export const ACTIVE_FEATURE_COMPATIBILITY_VERSION = '2.0.0'
export const NORMALIZATION_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Experiment provenance  (Chapter 3.4 §18 — reproducibility)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExperimentProvenance {
  experimentId: string
  datasetVersion: string
  featureVersion: string
  modelVersion: string
  normalizationVersion: string
  recordedAt: number
}
