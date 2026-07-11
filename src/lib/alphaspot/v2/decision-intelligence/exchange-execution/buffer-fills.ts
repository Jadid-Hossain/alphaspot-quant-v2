// CHAPTER 5.10 §7, §8 — Asynchronous Sequence Buffer & Fill Aggregation
//
// §7 — Asynchronous Sequence Buffer:
//   • Safely processes out-of-order exchange events
//   • Events remain isolated until sufficient sequencing info exists
//   • Reconstructs canonical execution timeline deterministically
//   • No event discarded solely because prerequisites haven't arrived
//
// §8 — Fill Management:
//   • Partial/Complete/Multi-Venue Fill Aggregation
//   • Average Price Calculation (Rule 10 — solely from confirmed fills)
//   • Quantity Reconciliation, Fee/Cost Aggregation
//   • Fill Timestamp Ordering, Execution ID Deduplication
//
// Rule 6 — Asynchronous Sequence Buffer for non-linear event arrival.
// Rule 9 — Fill aggregation preserves exact quantities, IDs, timestamps, venue.
// Rule 10 — Average price computed solely from confirmed exchange fills.
// Rule 12 — Partial fills without losing execution lineage.
// Rule 17 — Timestamps preserve exchange ordering.
// Rule 21 — Out-of-order events buffered and reordered before state modification.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { ExchangeEvent, FillAggregation, FillRecord } from './types'

const log = createLogger('decision-intelligence:exchange-execution:buffer-fills')

// ─────────────────────────────────────────────────────────────────────────────
// AsynchronousSequenceBuffer (§7, Rule 6, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export interface BufferedEvent {
  event: ExchangeEvent
  bufferedAt: number
  /** Expected prerequisite sequence number. */
  expectedPrerequisite: number
}

export class AsynchronousSequenceBuffer {
  private buffer = new Map<number, BufferedEvent>()
  /** Last committed sequence number. */
  private lastCommittedSequence = 0
  private maxSize: number

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  /**
   * Buffer an out-of-order event (§7, Rule 6, Rule 21).
   * Events remain isolated until sequencing allows deterministic reconstruction.
   */
  bufferEvent(event: ExchangeEvent, currentTime: number = Date.now()): { buffered: boolean; reason: string } {
    // §8 — Execution ID deduplication (check for duplicate sequence)
    if (this.buffer.has(event.exchangeSequence)) {
      log.warn(`duplicate exchange sequence ${event.exchangeSequence} — ignored (§8 dedup)`)
      return { buffered: false, reason: 'duplicate sequence number' }
    }

    // Check if event is in order
    if (event.exchangeSequence === this.lastCommittedSequence + 1) {
      // In order — no buffering needed
      return { buffered: false, reason: 'event in order' }
    }

    // §7 — Out of order — buffer the event
    if (this.buffer.size >= this.maxSize) {
      log.warn(`sequence buffer full (${this.maxSize}) — evicting oldest`)
      const oldestSeq = Math.min(...this.buffer.keys())
      this.buffer.delete(oldestSeq)
    }

    this.buffer.set(event.exchangeSequence, {
      event,
      bufferedAt: currentTime,
      expectedPrerequisite: event.exchangeSequence - 1,
    })

    log.debug(
      `buffered out-of-order event: seq ${event.exchangeSequence} (expected ${this.lastCommittedSequence + 1}, buffered ${this.buffer.size})`,
    )

    return { buffered: true, reason: `out of order (expected ${this.lastCommittedSequence + 1}, got ${event.exchangeSequence})` }
  }

  /**
   * Get the next event in sequence (§7 — deterministic reconstruction).
   * Returns the next in-order event, or null if gap exists.
   */
  getNextInOrder(): ExchangeEvent | null {
    const expectedSeq = this.lastCommittedSequence + 1
    const buffered = this.buffer.get(expectedSeq)
    if (buffered) {
      this.buffer.delete(expectedSeq)
      this.lastCommittedSequence = expectedSeq
      return buffered.event
    }
    return null
  }

  /**
   * Commit a sequence number (advance the committed pointer).
   */
  commitSequence(seq: number): void {
    this.lastCommittedSequence = Math.max(this.lastCommittedSequence, seq)
  }

  /**
   * Detect gaps in the sequence (§5 — Event Ordering & Gap Detection).
   */
  detectGaps(): { hasGap: boolean; missingSequences: number[]; expectedNext: number } {
    const expectedNext = this.lastCommittedSequence + 1
    if (this.buffer.size === 0) {
      return { hasGap: false, missingSequences: [], expectedNext }
    }

    // Find the minimum buffered sequence
    const minBuffered = Math.min(...this.buffer.keys())
    if (minBuffered <= expectedNext) {
      return { hasGap: false, missingSequences: [], expectedNext }
    }

    // Gap detected — find all missing sequences
    const missing: number[] = []
    for (let seq = expectedNext; seq < minBuffered; seq++) {
      missing.push(seq)
    }

    log.warn(`gap detected: ${missing.length} missing sequences (${missing[0]}..${missing[missing.length - 1]})`)
    return { hasGap: true, missingSequences: missing, expectedNext }
  }

  /**
   * Check if buffer can be flushed (all prerequisites met).
   */
  canFlush(): boolean {
    return this.buffer.has(this.lastCommittedSequence + 1)
  }

  /**
   * Get buffer depth (§14 — observability).
   */
  getDepth(): number {
    return this.buffer.size
  }

  /**
   * Get all buffered events (for replay/recovery).
   */
  getBufferedEvents(): ExchangeEvent[] {
    return Array.from(this.buffer.values()).map((b) => b.event).sort((a, b) => a.exchangeSequence - b.exchangeSequence)
  }

  /**
   * Get last committed sequence.
   */
  getLastCommitted(): number {
    return this.lastCommittedSequence
  }

  /**
   * Clear the buffer (after recovery).
   */
  clear(): void {
    this.buffer.clear()
    this.lastCommittedSequence = 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FillAggregator (§8, Rule 9, Rule 10, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export class FillAggregator {
  /**
   * Aggregate fills for an order (§8, Rule 9, Rule 10, Rule 12).
   * Rule 9 — Preserves exact quantities, IDs, timestamps, venue provenance.
   * Rule 10 — Average price computed solely from confirmed exchange fills.
   * Rule 12 — Partial fills without losing execution lineage.
   */
  aggregate(fills: FillRecord[], orderQuantity: number): FillAggregation {
    // §8 — Filter out busted fills
    const activeFills = fills.filter((f) => !f.busted)

    // §8 — Execution ID deduplication
    const seenExecutionIds = new Set<string>()
    const deduplicatedFills = activeFills.filter((f) => {
      if (seenExecutionIds.has(f.exchangeExecutionId)) {
        log.warn(`duplicate fill execution ID ${f.exchangeExecutionId} — filtered (§8)`)
        return false
      }
      seenExecutionIds.add(f.exchangeExecutionId)
      return true
    })

    // §8 — Sort by fill timestamp (Rule 17 — preserve exchange ordering)
    const sortedFills = [...deduplicatedFills].sort((a, b) => a.fillTimestamp - b.fillTimestamp)

    // §8 — Total filled quantity
    const totalFilledQuantity = sortedFills.reduce((sum, f) => sum + f.fillQuantity, 0)

    // §8 — Remaining quantity
    const remainingQuantity = Math.max(0, orderQuantity - totalFilledQuantity)

    // Rule 10 — Average execution price (weighted by quantity, solely from confirmed fills)
    const totalNotional = sortedFills.reduce((sum, f) => sum + f.fillQuantity * f.fillPrice, 0)
    const averageExecutionPrice = totalFilledQuantity > 0 ? totalNotional / totalFilledQuantity : 0

    // §8 — Fee aggregation
    const totalFees = sortedFills.reduce((sum, f) => sum + f.fee, 0)

    // §8 — Execution cost aggregation
    const totalExecutionCost = totalFees + sortedFills.reduce((sum, f) => sum + f.fillQuantity * f.fillPrice * 0.001, 0) // estimate

    // §8 — Per-venue breakdown (multi-venue fill aggregation)
    const perVenueBreakdown: Record<string, { quantity: number; averagePrice: number; fillCount: number }> = {}
    for (const fill of sortedFills) {
      if (!perVenueBreakdown[fill.venue]) {
        perVenueBreakdown[fill.venue] = { quantity: 0, averagePrice: 0, fillCount: 0 }
      }
      perVenueBreakdown[fill.venue].quantity += fill.fillQuantity
      perVenueBreakdown[fill.venue].fillCount++
    }
    // Compute per-venue average prices
    for (const venue of Object.keys(perVenueBreakdown)) {
      const venueFills = sortedFills.filter((f) => f.venue === venue)
      const venueNotional = venueFills.reduce((sum, f) => sum + f.fillQuantity * f.fillPrice, 0)
      perVenueBreakdown[venue].averagePrice = perVenueBreakdown[venue].quantity > 0
        ? venueNotional / perVenueBreakdown[venue].quantity
        : 0
    }

    log.debug(
      `fill aggregation: ${sortedFills.length} fills, qty=${totalFilledQuantity.toFixed(6)}, ` +
      `avgPrice=${averageExecutionPrice.toFixed(2)}, fees=${totalFees.toFixed(2)}, venues=${Object.keys(perVenueBreakdown).length}`,
    )

    return {
      totalFilledQuantity,
      remainingQuantity,
      averageExecutionPrice,
      totalFees,
      totalExecutionCost,
      fillCount: sortedFills.length,
      fills: sortedFills,
      perVenueBreakdown,
    }
  }

  /**
   * Create a new fill record (§8).
   */
  createFill(
    exchangeExecutionId: string,
    fillQuantity: number,
    fillPrice: number,
    fillTimestamp: number,
    venue: string,
    fee: number = 0,
  ): FillRecord {
    return {
      fillId: `fill-${fillTimestamp.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      exchangeExecutionId,
      fillQuantity,
      fillPrice,
      fillTimestamp,
      venue,
      fee,
      busted: false,
      corrected: false,
      correctionEventId: null,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const sequenceBuffer = new AsynchronousSequenceBuffer()
export const fillAggregator = new FillAggregator()
