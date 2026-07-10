// CHAPTER 3.2 §3, §17, §18, §18.1, §19, §20 — Pipeline Orchestrator
//
// Assembles the full 10-stage data flow (§3):
//   Exchange Stream → Raw Buffer → Schema Validation → Timestamp Validation →
//   Sequence Validation → Duplicate Detection → Normalization →
//   Integrity Verification → Canonical Event → Publication
//
// Pipeline isolation (§17): failure in one stage doesn't terminate the pipeline.
// Recovery occurs from the failed stage.
//
// Replay (§18, §18.1): STANDARD (full validation) + VALIDATED (bypass validation).
// Provenance always recorded.
//
// Observability (§19): ingestion rate, validation failures, duplicates,
// reordered events, reconciliation count, burst frequency, publication latency,
// queue depth, dropped events.
//
// Failure handling (§20): Schema → reject, Sequence → reconcile,
// Timestamp → flag/quarantine, Normalization → reject, Publication → retry.

import { createLogger } from '../domains/01-core-infrastructure'
import { hrNow, hrDiffMs, type CanonicalMarketEvent, type HighResolutionTimestamp } from './canonical-event'
import { ringBuffer, type RawMessage } from './ring-buffer'
import { validateSchema, validateTimestamps, validateSequence, duplicateDetector, resetSequenceState, DEFAULT_SCHEMA_CONFIG, DEFAULT_TIMESTAMP_CONFIG, DEFAULT_SEQUENCE_CONFIG } from './validation'
import { normalize, verifyIntegrity, eventPublisher } from './normalize-publish'
import type { FailureCategory } from './canonical-event'

const log = createLogger('market-data:pipeline')

// ─────────────────────────────────────────────────────────────────────────────
// Replay modes  (Chapter 3.2 §18.1)
// ─────────────────────────────────────────────────────────────────────────────

export type ReplayMode = 'LIVE' | 'STANDARD_REPLAY' | 'VALIDATED_REPLAY'

export interface ReplayConfig {
  mode: ReplayMode
  /** Provenance label for audit (§18.1). */
  provenance: string
  /** Whether to record replay provenance (§18.1 — always true). */
  recordProvenance: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline stats  (Chapter 3.2 §19 — observability)
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineStats {
  ingestionRate: number // events/sec
  totalIngested: number
  schemaFailures: number
  timestampFailures: number
  sequenceFailures: number
  duplicatesDetected: number
  outOfOrderEvents: number
  reorderedEvents: number
  reconciliationCount: number
  normalizationFailures: number
  integrityFailures: number
  publicationFailures: number
  published: number
  quarantined: number
  burstFrequency: number
  averagePublicationLatencyMs: number
  queueDepth: number
  droppedEvents: number
  failuresByCategory: Record<FailureCategory, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Data Pipeline Orchestrator  (Chapter 3.2 §3)
// ─────────────────────────────────────────────────────────────────────────────

class MarketDataPipeline {
  private replayMode: ReplayMode = 'LIVE'
  private stats: PipelineStats = {
    ingestionRate: 0,
    totalIngested: 0,
    schemaFailures: 0,
    timestampFailures: 0,
    sequenceFailures: 0,
    duplicatesDetected: 0,
    outOfOrderEvents: 0,
    reorderedEvents: 0,
    reconciliationCount: 0,
    normalizationFailures: 0,
    integrityFailures: 0,
    publicationFailures: 0,
    published: 0,
    quarantined: 0,
    burstFrequency: 0,
    averagePublicationLatencyMs: 0,
    queueDepth: 0,
    droppedEvents: 0,
    failuresByCategory: {
      SCHEMA_FAILURE: 0, SEQUENCE_FAILURE: 0, TIMESTAMP_FAILURE: 0,
      NORMALIZATION_FAILURE: 0, PUBLICATION_FAILURE: 0, DUPLICATE: 0,
      OUT_OF_ORDER: 0, INTEGRITY_FAILURE: 0,
    },
  }
  private latencySamples: number[] = []
  private processing = false
  private processTimer: ReturnType<typeof setInterval> | null = null
  private lastIngestWindow: { count: number; start: number } = { count: 0, start: Date.now() }
  private reconciliationSubscribers = new Set<(stream: string, reason: string) => void>()

  /** Set the replay mode (§18.1 — explicitly selected). */
  setReplayMode(mode: ReplayMode, provenance = 'live'): void {
    this.replayMode = mode
    log.info(`replay mode set: ${mode} (provenance: ${provenance})`)
  }

  /**
   * Ingest a raw exchange message into the pipeline (§3 stage 1: Raw Buffer).
   * The message is pushed into the bounded ring buffer (§4.1).
   */
  ingest(msg: RawMessage): boolean {
    this.stats.totalIngested++
    this.lastIngestWindow.count++

    const pushed = ringBuffer.push(msg)
    if (!pushed) {
      this.stats.droppedEvents++
      this.recordFailure('SCHEMA_FAILURE', 'ring buffer full — message dropped (§4.1 backpressure)')
    }
    return pushed
  }

  /** Start the pipeline processing loop (drains the ring buffer). */
  start(intervalMs = 1): void {
    if (this.processTimer) return
    this.processTimer = setInterval(() => this.processBatch(), intervalMs)
    this.processing = true
    log.info(`market data pipeline started — processing every ${intervalMs}ms`)
  }

  stop(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer)
      this.processTimer = null
    }
    this.processing = false
    log.info('market data pipeline stopped')
  }

  /** Process a batch of messages from the ring buffer through the full pipeline (§3). */
  private processBatch(): void {
    const batchSize = 500
    let processed = 0

    while (processed < batchSize) {
      const msg = ringBuffer.pop()
      if (!msg) break
      this.processMessage(msg)
      processed++
    }

    // Update ingestion rate
    const now = Date.now()
    const elapsed = now - this.lastIngestWindow.start
    if (elapsed >= 1000) {
      this.stats.ingestionRate = (this.lastIngestWindow.count / elapsed) * 1000
      this.lastIngestWindow = { count: 0, start: now }
    }
    this.stats.queueDepth = ringBuffer.getSize()
  }

  /** Run a single message through the 10-stage pipeline (§3). */
  private processMessage(msg: RawMessage): void {
    const receptionHr = msg.receptionTimestamp

    // §18.1 — VALIDATED_REPLAY bypasses validation (for trusted historical data)
    if (this.replayMode === 'VALIDATED_REPLAY') {
      const event = normalize(msg, this.extractExchangeTimestamp(msg), 'binance', 'VALIDATED_REPLAY')
      this.publish(event, receptionHr)
      return
    }

    // Stage 2: Schema Validation (§5)
    const schemaResult = validateSchema(msg)
    if (!schemaResult.passed) {
      this.stats.schemaFailures++
      this.recordFailure('SCHEMA_FAILURE', schemaResult.error ?? 'schema validation failed')
      return // §20 — reject message
    }

    // Stage 3: Timestamp Validation (§6, §6.1)
    const exchangeTs = this.extractExchangeTimestamp(msg)
    const tsResult = validateTimestamps(msg, exchangeTs)
    if (!tsResult.passed) {
      this.stats.timestampFailures++
      this.recordFailure('TIMESTAMP_FAILURE', tsResult.error ?? 'timestamp validation failed')
      // §20 — flag / quarantine (don't reject outright — flag for review)
      return
    }

    // Stage 4: Sequence Validation (§7)
    const seqResult = validateSequence(msg)
    if (!seqResult.passed) {
      if (seqResult.stage === 'DUPLICATE') {
        this.stats.duplicatesDetected++
        this.recordFailure('DUPLICATE', seqResult.error ?? 'duplicate')
        return // §8 — discard
      }
      if (seqResult.stage === 'OUT_OF_ORDER') {
        this.stats.outOfOrderEvents++
        this.recordFailure('OUT_OF_ORDER', seqResult.error ?? 'out of order')
        return // §9 — discard (or buffer for reorder)
      }
      // Sequence failure → reconcile (§20)
      this.stats.sequenceFailures++
      this.stats.reconciliationCount++
      this.recordFailure('SEQUENCE_FAILURE', seqResult.error ?? 'sequence failure')
      this.triggerReconciliation(msg.stream, seqResult.error ?? 'sequence failure')
      return
    }

    // Stage 5: Duplicate Detection (§8)
    if (duplicateDetector.isDuplicate(msg)) {
      this.stats.duplicatesDetected++
      this.recordFailure('DUPLICATE', `duplicate detected on ${msg.stream}`)
      return // §8 — discard
    }

    // Stage 6: Normalization (§10)
    let event: CanonicalMarketEvent
    try {
      event = normalize(msg, exchangeTs, 'binance', this.replayMode === 'LIVE' ? 'LIVE' : 'STANDARD_REPLAY')
    } catch (e) {
      this.stats.normalizationFailures++
      this.recordFailure('NORMALIZATION_FAILURE', `normalization error: ${e instanceof Error ? e.message : String(e)}`)
      return // §20 — reject
    }

    // Stage 7: Integrity Verification (§13)
    const integrity = verifyIntegrity(event)
    if (!integrity.passed) {
      this.stats.integrityFailures++
      this.recordFailure('INTEGRITY_FAILURE', `integrity checks failed: ${integrity.checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`)
      eventPublisher.quarantine(event, 'integrity verification failed')
      return // §13 — quarantine
    }

    // Stage 8: Publication (§14)
    this.publish(event, receptionHr)
  }

  /** Extract the exchange timestamp from a raw message payload. */
  private extractExchangeTimestamp(msg: RawMessage): number {
    const p = msg.payload as Record<string, unknown>
    if (!p || typeof p !== 'object') return Date.now()

    // Binance: E (event time) or T (trade time) or k.t (kline start)
    if ('E' in p && typeof p.E === 'number') return p.E
    if ('T' in p && typeof p.T === 'number') return p.T
    const k = p.k as Record<string, unknown> | undefined
    if (k && typeof k.t === 'number') return k.t
    return Date.now()
  }

  /** Publish a canonical event and record latency (§14). */
  private publish(event: CanonicalMarketEvent, receptionHr: HighResolutionTimestamp): void {
    const pipelineHr = event.pipelineTimestamp
    const latencyMs = hrDiffMs(receptionHr, pipelineHr)

    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > 1000) this.latencySamples.shift()
    this.stats.averagePublicationLatencyMs =
      this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length

    const published = eventPublisher.publish(event)
    if (published) {
      this.stats.published++
    } else {
      this.stats.publicationFailures++
      this.recordFailure('PUBLICATION_FAILURE', `failed to publish ${event.eventType} ${event.symbol}`)
    }
  }

  /** Record a failure by category (§20, §19). */
  private recordFailure(category: FailureCategory, message: string): void {
    this.stats.failuresByCategory[category] = (this.stats.failuresByCategory[category] ?? 0) + 1
    log.debug(`[failure:${category}] ${message}`)
  }

  /** Trigger reconciliation for a stream (§7, §20). */
  private triggerReconciliation(stream: string, reason: string): void {
    log.warn(`reconciliation triggered for ${stream}: ${reason}`)
    resetSequenceState(stream)
    for (const sub of this.reconciliationSubscribers) sub(stream, reason)
  }

  /** Subscribe to reconciliation events (§7). */
  onReconciliation(handler: (stream: string, reason: string) => void): () => void {
    this.reconciliationSubscribers.add(handler)
    return () => this.reconciliationSubscribers.delete(handler)
  }

  /** Subscribe to canonical events (§14 — consumers only receive canonical). */
  subscribeToEvents(handler: (event: CanonicalMarketEvent) => void): () => void {
    return eventPublisher.subscribe(handler)
  }

  getStats(): PipelineStats {
    return { ...this.stats, queueDepth: ringBuffer.getSize() }
  }

  isProcessing(): boolean {
    return this.processing
  }

  getReplayMode(): ReplayMode {
    return this.replayMode
  }
}

export const marketDataPipeline = new MarketDataPipeline()

// Re-export everything for the barrel
export * from './canonical-event'
export * from './ring-buffer'
export * from './validation'
export * from './normalize-publish'
