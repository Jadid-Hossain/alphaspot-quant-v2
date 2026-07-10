// CHAPTER 3.2 §5, §6, §7, §8, §9 — Pipeline Validation Stages
//
// Schema Validation (§5): required fields, field types, numeric ranges,
//   symbol format, interval identifiers. Malformed → reject.
// Timestamp Validation (§6, §6.1): chronological consistency, acceptable
//   latency, clock synchronization. Out-of-tolerance → flag.
// Sequence Validation (§7): continuity, missing, duplicated, replay,
//   out-of-order. Broken → reconcile.
// Duplicate Detection (§8): discard duplicates by sequence/timestamp/tradeId.
// Out-of-Order Handling (§9): buffer + reorder, or discard if window expires.

import { createLogger } from '../domains/01-core-infrastructure'
import { hrNow, hrDiffMs, type HighResolutionTimestamp, type CanonicalEventType } from './canonical-event'
import type { RawMessage } from './ring-buffer'

const log = createLogger('market-data:validation')

// ─────────────────────────────────────────────────────────────────────────────
// Validation result type
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean
  stage: 'SCHEMA' | 'TIMESTAMP' | 'SEQUENCE' | 'DUPLICATE' | 'OUT_OF_ORDER'
  error?: string
  /** Metadata for observability (§19). */
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Validation  (Chapter 3.2 §5)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaValidationConfig {
  /** Max age of exchange timestamp before flagging (ms). */
  maxExchangeTimestampAgeMs: number
  /** Max future drift allowed (ms). */
  maxFutureDriftMs: number
  /** Valid symbol pattern. */
  symbolPattern: RegExp
  /** Valid intervals for kline events. */
  validIntervals: string[]
}

export const DEFAULT_SCHEMA_CONFIG: SchemaValidationConfig = {
  maxExchangeTimestampAgeMs: 60_000,
  maxFutureDriftMs: 5_000,
  symbolPattern: /^[A-Z0-9]+\/[A-Z0-9]+$/,
  validIntervals: ['15m', '1h', '4h', '1m', '5m', '1d'],
}

/** Validate a raw message's schema (§5). */
export function validateSchema(msg: RawMessage, config: SchemaValidationConfig = DEFAULT_SCHEMA_CONFIG): ValidationResult {
  // §5 — required fields
  if (!msg.stream || typeof msg.stream !== 'string') {
    return { passed: false, stage: 'SCHEMA', error: 'missing or invalid stream field' }
  }
  if (!msg.symbol || typeof msg.symbol !== 'string') {
    return { passed: false, stage: 'SCHEMA', error: 'missing or invalid symbol field' }
  }
  if (msg.payload === undefined || msg.payload === null) {
    return { passed: false, stage: 'SCHEMA', error: 'missing payload' }
  }

  // §5 — symbol format
  if (!config.symbolPattern.test(msg.symbol)) {
    return { passed: false, stage: 'SCHEMA', error: `invalid symbol format: "${msg.symbol}"` }
  }

  // §5 — payload must be an object
  if (typeof msg.payload !== 'object') {
    return { passed: false, stage: 'SCHEMA', error: `payload must be an object, got ${typeof msg.payload}` }
  }

  // §5 — numeric ranges (check common fields if present)
  const payload = msg.payload as Record<string, unknown>
  for (const key of ['price', 'quantity', 'close', 'lastPrice', 'bidPrice', 'askPrice']) {
    if (key in payload) {
      const v = payload[key]
      if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) {
        return { passed: false, stage: 'SCHEMA', error: `${key} must be a finite non-negative number, got ${v}` }
      }
    }
  }

  // §5 — interval identifier (for kline events)
  if (msg.eventType === 'KLINE' && 'interval' in payload) {
    if (!config.validIntervals.includes(String(payload.interval))) {
      return { passed: false, stage: 'SCHEMA', error: `invalid interval: ${payload.interval}` }
    }
  }

  return { passed: true, stage: 'SCHEMA' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp Validation  (Chapter 3.2 §6, §6.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface TimestampValidationConfig {
  /** Max acceptable latency between exchange timestamp and reception (ms). */
  maxLatencyMs: number
  /** Max clock skew between local and exchange time (ms). */
  maxClockSkewMs: number
}

export const DEFAULT_TIMESTAMP_CONFIG: TimestampValidationConfig = {
  maxLatencyMs: 10_000, // 10 seconds
  maxClockSkewMs: 5_000, // 5 seconds
}

/**
 * Validate timestamps (§6, §6.1).
 * Checks chronological consistency, acceptable latency, clock synchronization.
 */
export function validateTimestamps(
  msg: RawMessage,
  exchangeTimestamp: number,
  config: TimestampValidationConfig = DEFAULT_TIMESTAMP_CONFIG,
): ValidationResult {
  const now = Date.now()

  // §6 — chronological consistency: exchange time shouldn't be in the future
  if (exchangeTimestamp > now + config.maxClockSkewMs) {
    return {
      passed: false,
      stage: 'TIMESTAMP',
      error: `exchange timestamp is in the future: ${exchangeTimestamp} vs now ${now} (skew ${exchangeTimestamp - now}ms)`,
      metadata: { exchangeTimestamp, now, skewMs: exchangeTimestamp - now },
    }
  }

  // §6 — acceptable latency: exchange time shouldn't be too old
  const ageMs = now - exchangeTimestamp
  if (ageMs > config.maxLatencyMs) {
    return {
      passed: false,
      stage: 'TIMESTAMP',
      error: `exchange timestamp too old: ${ageMs}ms (max ${config.maxLatencyMs}ms)`,
      metadata: { exchangeTimestamp, now, ageMs },
    }
  }

  // §6.1 — high-resolution reception timestamp must be present
  if (!msg.receptionTimestamp || typeof msg.receptionTimestamp.ns !== 'bigint') {
    return { passed: false, stage: 'TIMESTAMP', error: 'missing high-resolution reception timestamp (§6.1)' }
  }

  return { passed: true, stage: 'TIMESTAMP' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence Validation  (Chapter 3.2 §7)
// ─────────────────────────────────────────────────────────────────────────────

interface SequenceState {
  lastSequence: number | null
  gapsDetected: number
  duplicatesDetected: number
  outOfOrderDetected: number
}

const sequenceStates = new Map<string, SequenceState>() // stream → state

export interface SequenceValidationConfig {
  /** Max gap before triggering reconciliation (§7). */
  maxGapBeforeReconcile: number
  /** Whether to allow out-of-order within a window (§9). */
  allowOutOfOrderReorder: boolean
  /** Window for out-of-order reordering (ms) (§9). */
  outOfOrderWindowMs: number
}

export const DEFAULT_SEQUENCE_CONFIG: SequenceValidationConfig = {
  maxGapBeforeReconcile: 100,
  allowOutOfOrderReorder: true,
  outOfOrderWindowMs: 250,
}

/**
 * Validate sequence continuity (§7).
 * Checks: sequence continuity, missing sequences, duplicated sequences,
 * replay sequences, out-of-order arrivals. Broken sequences trigger
 * reconciliation (§7).
 */
export function validateSequence(
  msg: RawMessage,
  config: SequenceValidationConfig = DEFAULT_SEQUENCE_CONFIG,
): ValidationResult {
  // If no sequence number, skip (not all streams have them)
  if (msg.sequenceNumber === null || msg.sequenceNumber === undefined) {
    return { passed: true, stage: 'SEQUENCE', metadata: { note: 'no sequence number — skipped' } }
  }

  const state = sequenceStates.get(msg.stream) ?? {
    lastSequence: null,
    gapsDetected: 0,
    duplicatesDetected: 0,
    outOfOrderDetected: 0,
  }

  // §8 — duplicated sequence
  if (state.lastSequence !== null && msg.sequenceNumber === state.lastSequence) {
    state.duplicatesDetected++
    return { passed: false, stage: 'DUPLICATE', error: `duplicate sequence ${msg.sequenceNumber} on ${msg.stream}` }
  }

  // §7 — out-of-order arrival
  if (state.lastSequence !== null && msg.sequenceNumber < state.lastSequence) {
    state.outOfOrderDetected++
    // §9 — out-of-order handling: buffer for reorder or discard
    if (!config.allowOutOfOrderReorder) {
      return { passed: false, stage: 'OUT_OF_ORDER', error: `out-of-order: ${msg.sequenceNumber} < last ${state.lastSequence}` }
    }
    // Allow it through (the out-of-order handler will buffer + reorder)
    return { passed: true, stage: 'SEQUENCE', metadata: { note: 'out-of-order — will be reordered (§9)' } }
  }

  // §7 — missing sequence (gap)
  if (state.lastSequence !== null && msg.sequenceNumber > state.lastSequence + 1) {
    const gap = msg.sequenceNumber - state.lastSequence - 1
    state.gapsDetected++
    if (gap > config.maxGapBeforeReconcile) {
      log.warn(`large sequence gap on ${msg.stream}: ${gap} missing (last ${state.lastSequence}, got ${msg.sequenceNumber}) — reconciliation triggered (§7)`)
      return {
        passed: false,
        stage: 'SEQUENCE',
        error: `sequence gap of ${gap} exceeds max ${config.maxGapBeforeReconcile} — reconciliation required (§7)`,
        metadata: { gap, lastSequence: state.lastSequence, receivedSequence: msg.sequenceNumber },
      }
    }
    log.debug(`sequence gap on ${msg.stream}: ${gap} missing — continuing`)
  }

  state.lastSequence = msg.sequenceNumber
  sequenceStates.set(msg.stream, state)
  return { passed: true, stage: 'SEQUENCE' }
}

/** Reset sequence state for a stream (after reconciliation — §7). */
export function resetSequenceState(stream: string): void {
  sequenceStates.delete(stream)
  log.info(`sequence state reset for ${stream} (post-reconciliation)`)
}

export function getSequenceStats(stream: string): SequenceState | undefined {
  return sequenceStates.get(stream)
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Detection  (Chapter 3.2 §8)
// ─────────────────────────────────────────────────────────────────────────────

class DuplicateDetector {
  private seen = new Map<string, number>() // dedupKey → first-seen time
  private readonly maxSize = 100_000
  private stats = { checked: 0, duplicates: 0, evictions: 0 }

  /** Check if a message is a duplicate (§8). Returns true if duplicate. */
  isDuplicate(msg: RawMessage): boolean {
    this.stats.checked++
    const key = this.dedupKey(msg)
    if (key === null) return false // no dedup key → can't check

    if (this.seen.has(key)) {
      this.stats.duplicates++
      return true
    }

    this.seen.set(key, Date.now())
    // LRU eviction
    if (this.seen.size > this.maxSize) {
      const oldest = [...this.seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, 10_000)
      for (const [k] of oldest) this.seen.delete(k)
      this.stats.evictions += oldest.length
    }
    return false
  }

  /** Build a dedup key from exchange sequence / tradeId / updateId (§8). */
  private dedupKey(msg: RawMessage): string | null {
    if (msg.sequenceNumber !== null && msg.sequenceNumber !== undefined) {
      return `${msg.stream}:${msg.sequenceNumber}`
    }
    // Try tradeId / updateId from payload
    const p = msg.payload as Record<string, unknown>
    if (p && typeof p === 'object') {
      if ('tradeId' in p && p.tradeId) return `${msg.stream}:trade:${p.tradeId}`
      if ('lastUpdateId' in p && p.lastUpdateId) return `${msg.stream}:upd:${p.lastUpdateId}`
      if ('id' in p && p.id) return `${msg.stream}:id:${p.id}`
    }
    return null
  }

  getStats() {
    return { ...this.stats, tracked: this.seen.size }
  }

  clear(): void {
    this.seen.clear()
  }
}

export const duplicateDetector = new DuplicateDetector()
