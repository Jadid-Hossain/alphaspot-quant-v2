// CHAPTER 2.2 §10 — Idempotent Processing
// CHAPTER 2.2 §20 — Correlation Model
//
// Every consumer must tolerate duplicate delivery (Chapter 2.2 §10, Rule 5).
// Consumers identify duplicates using: Event ID, Correlation ID, Snapshot ID,
// Sequence metadata.
//
// Every event in one analytical cycle shares the same Correlation ID
// (Chapter 2.2 §20) — enables distributed tracing, debugging, replay, audit.

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('idempotency')

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency tracker — dedup by eventId (Chapter 2.2 §10)
// ─────────────────────────────────────────────────────────────────────────────

class IdempotencyTracker {
  private seen = new Map<string, number>() // eventId → first-seen timestamp
  private readonly maxSize = 10_000

  /** Returns true if this eventId has already been processed. */
  has(eventId: string): boolean {
    return this.seen.has(eventId)
  }

  /** Mark an eventId as processed. Returns false if it was already seen. */
  mark(eventId: string): boolean {
    if (this.seen.has(eventId)) {
      log.debug(`duplicate event suppressed: ${eventId}`)
      return false
    }
    this.seen.set(eventId, Date.now())
    // Evict oldest entries if we exceed the cap (LRU-ish)
    if (this.seen.size > this.maxSize) {
      const oldest = [...this.seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, 1000)
      for (const [id] of oldest) this.seen.delete(id)
    }
    return true
  }

  /** Check + mark in one call. Returns true if this is a NEW event (process it). */
  check(eventId: string): boolean {
    if (this.has(eventId)) return false
    this.mark(eventId)
    return true
  }

  stats(): { tracked: number; maxSize: number } {
    return { tracked: this.seen.size, maxSize: this.maxSize }
  }
}

export const idempotency = new IdempotencyTracker()

// ─────────────────────────────────────────────────────────────────────────────
// Correlation context  (Chapter 2.2 §20)
// AsyncLocalStorage-style context propagation: every event in one analytical
// cycle shares the same correlationId.
// ─────────────────────────────────────────────────────────────────────────────

interface CorrelationContext {
  correlationId: string
  snapshotId: string | null
  startedAt: number
}

// Simple stack-based context (sufficient for single-process; for distributed,
// the Event Transport would propagate correlationId in headers).
let activeCorrelation: CorrelationContext | null = null

/** Begin a new analytical cycle with a fresh correlation ID. */
export function beginCorrelation(): string {
  const correlationId = `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  activeCorrelation = { correlationId, snapshotId: null, startedAt: Date.now() }
  return correlationId
}

/** Bind a snapshot ID to the active correlation (Chapter 2.2 §12). */
export function bindSnapshot(snapshotId: string): void {
  if (!activeCorrelation) {
    log.warn('bindSnapshot called with no active correlation — creating one')
    beginCorrelation()
  }
  activeCorrelation!.snapshotId = snapshotId
}

/** Get the active correlation context (or null if none active). */
export function getCorrelation(): CorrelationContext | null {
  return activeCorrelation
}

/** End the active correlation. */
export function endCorrelation(): void {
  if (activeCorrelation) {
    const dur = Date.now() - activeCorrelation.startedAt
    log.debug(`correlation ${activeCorrelation.correlationId} ended (${dur}ms)`)
  }
  activeCorrelation = null
}
