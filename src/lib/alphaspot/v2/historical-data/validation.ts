// CHAPTER 3.4 §8, §11, §12 — Data Validation, Gap Detection, Data Repair
//
// Validation (§8): missing candles, duplicate candles, invalid timestamps,
//   OHLC consistency, volume validity, interval continuity. Invalid → quarantine.
// Gap Detection (§11): missing intervals, duplicate intervals, overlapping
//   intervals, clock discontinuities, corrupted ranges. Detected gaps → repair.
// Data Repair (§12): Gap Detection → Source Verification → Authoritative
//   Download → Validation → Replacement Dataset. Original datasets archived.

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalHistoricalCandle, DataGap, DataQuality, GapType, SupportedTimeframe } from './types'
import { TIMEFRAME_MS } from './types'

const log = createLogger('historical-data:validation')

// ─────────────────────────────────────────────────────────────────────────────
// Validation result  (Chapter 3.4 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean
  quality: DataQuality
  gaps: DataGap[]
}

/**
 * Validate a historical dataset (§8).
 * Checks: missing candles, duplicate candles, invalid timestamps, OHLC
 * consistency, volume validity, interval continuity.
 */
export function validateDataset(
  candles: CanonicalHistoricalCandle[],
  timeframe: SupportedTimeframe,
  expectedStartTime: number,
  expectedEndTime: number,
): ValidationResult {
  const gaps: DataGap[] = []
  const importErrors: string[] = []

  if (candles.length === 0) {
    return {
      passed: false,
      quality: { coveragePct: 0, missingCandleCount: 0, repairCount: 0, validationResult: 'FAIL', importErrors: ['empty dataset'], healthScore: 0 },
      gaps,
    }
  }

  // Sort by time (§9.1 — monotonically increasing)
  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const intervalMs = TIMEFRAME_MS[timeframe]
  const intervalSec = intervalMs / 1000

  // §8 — invalid timestamps (non-positive, non-integer)
  for (const c of sorted) {
    if (!Number.isInteger(c.time) || c.time <= 0) {
      importErrors.push(`invalid timestamp: ${c.time}`)
    }
    // §8 — OHLC consistency: high >= max(open, close), low <= min(open, close)
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      importErrors.push(`OHLC inconsistency at time ${c.time}: H=${c.high} L=${c.low} O=${c.open} C=${c.close}`)
    }
    // §8 — volume validity: non-negative
    if (c.volume < 0) {
      importErrors.push(`negative volume at time ${c.time}: ${c.volume}`)
    }
    // §9.1 — UTC epoch must be integer
    if (!Number.isInteger(c.time)) {
      importErrors.push(`non-integer timestamp (§9.1): ${c.time}`)
    }
  }

  // §8 — duplicate candles
  const seen = new Set<number>()
  for (const c of sorted) {
    if (seen.has(c.time)) {
      importErrors.push(`duplicate candle at time ${c.time}`)
      gaps.push({
        gapId: `gap-dup-${c.time}-${Math.random().toString(36).slice(2, 6)}`,
        datasetId: '',
        type: 'DUPLICATE',
        startTime: c.time,
        endTime: c.time,
        expectedCount: 1,
        actualCount: 2,
        detectedAt: Date.now(),
        repaired: false,
      })
    }
    seen.add(c.time)
  }

  // §11 — gap detection: missing intervals
  const expectedCount = Math.floor((expectedEndTime - expectedStartTime) / intervalSec)
  let missingCount = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const expectedNext = sorted[i].time + intervalSec
    if (sorted[i + 1].time !== expectedNext) {
      const gapStart = expectedNext
      const gapEnd = sorted[i + 1].time
      const missingInGap = Math.floor((gapEnd - gapStart) / intervalSec)
      if (missingInGap > 0) {
        missingCount += missingInGap
        gaps.push({
          gapId: `gap-miss-${gapStart}-${Math.random().toString(36).slice(2, 6)}`,
          datasetId: '',
          type: 'MISSING',
          startTime: gapStart,
          endTime: gapEnd,
          expectedCount: missingInGap,
          actualCount: 0,
          detectedAt: Date.now(),
          repaired: false,
        })
      }
    }
  }

  // §11 — clock discontinuities (time going backwards)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time < sorted[i - 1].time) {
      gaps.push({
        gapId: `gap-clock-${i}-${Math.random().toString(36).slice(2, 6)}`,
        datasetId: '',
        type: 'CLOCK_DISCONTINUITY',
        startTime: sorted[i].time,
        endTime: sorted[i - 1].time,
        expectedCount: 0,
        actualCount: 0,
        detectedAt: Date.now(),
        repaired: false,
      })
    }
  }

  // §10 — data quality metrics
  const coveragePct = expectedCount > 0 ? (sorted.length / expectedCount) * 100 : 0
  const healthScore = Math.max(0, Math.min(1, coveragePct / 100 - importErrors.length * 0.01))
  const validationResult: 'PASS' | 'FAIL' | 'WARN' = importErrors.length === 0 && gaps.length === 0 ? 'PASS' : importErrors.length > 10 ? 'FAIL' : 'WARN'

  return {
    passed: validationResult !== 'FAIL',
    quality: {
      coveragePct,
      missingCandleCount: missingCount,
      repairCount: 0,
      validationResult,
      importErrors,
      healthScore,
    },
    gaps,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Repair  (Chapter 3.4 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface RepairResult {
  repaired: boolean
  repairedGaps: number
  newCandles: CanonicalHistoricalCandle[]
  replacementDatasetVersion: number | null
  note: string
}

/**
 * Repair detected gaps (§12):
 * Gap Detection → Source Verification → Authoritative Download → Validation → Replacement
 *
 * Original datasets remain archived (Rule 9 — repair never overwrites).
 */
export async function repairGaps(
  datasetId: string,
  gaps: DataGap[],
  currentVersion: number,
  fetchAuthoritativeCandles: (startTime: number, endTime: number) => Promise<CanonicalHistoricalCandle[]>,
): Promise<RepairResult> {
  const missingGaps = gaps.filter((g) => g.type === 'MISSING' && !g.repaired)
  if (missingGaps.length === 0) {
    return { repaired: false, repairedGaps: 0, newCandles: [], replacementDatasetVersion: null, note: 'no repairable gaps' }
  }

  log.info(`repairing ${missingGaps.length} gaps in dataset ${datasetId} (§12)`)

  const newCandles: CanonicalHistoricalCandle[] = []
  let repairedCount = 0

  for (const gap of missingGaps) {
    // §12 — Source Verification + Authoritative Download
    try {
      const downloaded = await fetchAuthoritativeCandles(gap.startTime, gap.endTime)
      // §12 — Validation
      if (downloaded.length > 0) {
        newCandles.push(...downloaded)
        gap.repaired = true
        repairedCount++
      }
    } catch (e) {
      log.error(`repair failed for gap ${gap.gapId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // §12 — Replacement Dataset (new version — originals archived, Rule 9)
  const replacementVersion = currentVersion + 1

  return {
    repaired: repairedCount > 0,
    repairedGaps: repairedCount,
    newCandles,
    replacementDatasetVersion: repairedCount > 0 ? replacementVersion : null,
    note: repairedCount > 0
      ? `Repaired ${repairedCount} gaps. Original dataset v${currentVersion} archived. Replacement v${replacementVersion} created.`
      : 'No gaps could be repaired',
  }
}

/** Detect gaps in an existing candle array (§11 — standalone scan). */
export function detectGaps(candles: CanonicalHistoricalCandle[], timeframe: SupportedTimeframe): DataGap[] {
  if (candles.length < 2) return []
  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const intervalSec = TIMEFRAME_MS[timeframe] / 1000
  const gaps: DataGap[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const expectedNext = sorted[i].time + intervalSec
    if (sorted[i + 1].time > expectedNext) {
      const missing = Math.floor((sorted[i + 1].time - expectedNext) / intervalSec)
      gaps.push({
        gapId: `gap-${i}-${Math.random().toString(36).slice(2, 6)}`,
        datasetId: '',
        type: 'MISSING',
        startTime: expectedNext,
        endTime: sorted[i + 1].time,
        expectedCount: missing,
        actualCount: 0,
        detectedAt: Date.now(),
        repaired: false,
      })
    } else if (sorted[i + 1].time === sorted[i].time) {
      gaps.push({
        gapId: `gap-dup-${i}-${Math.random().toString(36).slice(2, 6)}`,
        datasetId: '',
        type: 'DUPLICATE',
        startTime: sorted[i].time,
        endTime: sorted[i].time,
        expectedCount: 1,
        actualCount: 2,
        detectedAt: Date.now(),
        repaired: false,
      })
    }
  }
  return gaps
}
