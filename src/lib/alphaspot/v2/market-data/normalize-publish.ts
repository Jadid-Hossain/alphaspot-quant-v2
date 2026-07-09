// CHAPTER 3.2 §10, §13, §14 — Normalization, Integrity Verification, Publication
//
// Normalization (§10): validated messages → canonical market events with
//   normalized fields (symbol, event type, timestamps, price, quantity, side,
//   source exchange, event version). Exchange-specific formats encapsulated.
//
// Integrity Verification (§13): before publication — valid symbol, positive
//   quantity, positive price, valid timestamps, sequence integrity, supported
//   version. Invalid → quarantine.
//
// Publication (§14): only verified canonical events published. Every published
//   event is immutable (Rule 4). Follows Chapter 2.2 event architecture.

import { createLogger } from '../domains/01-core-infrastructure'
import { hrNow, type CanonicalMarketEvent, type CanonicalEventType, type CanonicalPayload, CANONICAL_EVENT_VERSION, type HighResolutionTimestamp } from './canonical-event'
import type { RawMessage } from './ring-buffer'

const log = createLogger('market-data:normalize-publish')

// ─────────────────────────────────────────────────────────────────────────────
// Normalization  (Chapter 3.2 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface IntegrityResult {
  passed: boolean
  checks: Array<{ name: string; passed: boolean; detail: string }>
}

/**
 * Normalize a validated raw message into a canonical market event (§10).
 * Exchange-specific payload is transformed into the canonical payload type.
 * Exchange-specific formats NEVER escape the pipeline (Rule 9).
 */
export function normalize(
  msg: RawMessage,
  exchangeTimestamp: number,
  sourceExchange: string,
  provenance: CanonicalMarketEvent['provenance'] = 'LIVE',
): CanonicalMarketEvent {
  const payload = normalizePayload(msg.eventType, msg.payload)

  const event: CanonicalMarketEvent = {
    eventId: `evt-${msg.stream}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: msg.eventType,
    eventVersion: CANONICAL_EVENT_VERSION,
    symbol: msg.symbol,
    sourceExchange,
    exchangeTimestamp,
    receptionTimestamp: msg.receptionTimestamp,
    pipelineTimestamp: hrNow(),
    sequenceNumber: msg.sequenceNumber,
    payload: Object.freeze(payload) as Readonly<CanonicalPayload>, // §14 immutable
    provenance,
  }

  return Object.freeze(event) as CanonicalMarketEvent // Rule 4 — immutable
}

/** Transform an exchange-specific payload into the canonical payload (§10). */
function normalizePayload(eventType: CanonicalEventType, raw: unknown): CanonicalPayload {
  const p = raw as Record<string, unknown>

  switch (eventType) {
    case 'TRADE':
      return {
        tradeId: String(p.id ?? p.tradeId ?? ''),
        price: Number(p.price ?? p.p),
        quantity: Number(p.quantity ?? p.q),
        side: p.isBuyerMaker ? 'SELL' : 'BUY',
        isBuyerMaker: Boolean(p.isBuyerMaker ?? p.m),
      }
    case 'TICKER':
      return {
        lastPrice: Number(p.c ?? p.lastPrice),
        priceChangePct: Number(p.P ?? p.priceChangePercent),
        volume: Number(p.v ?? p.volume),
        quoteVolume: Number(p.q ?? p.quoteVolume),
        highPrice: Number(p.h ?? p.highPrice),
        lowPrice: Number(p.l ?? p.lowPrice),
      }
    case 'MINI_TICKER':
      return {
        close: Number(p.c),
        open: Number(p.o),
        high: Number(p.h),
        low: Number(p.l),
        volume: Number(p.v),
        quoteVolume: Number(p.q),
      }
    case 'BOOK_TICKER':
      return {
        bidPrice: Number(p.b ?? p.bidPrice),
        bidQuantity: Number(p.B ?? p.bidQuantity),
        askPrice: Number(p.a ?? p.askPrice),
        askQuantity: Number(p.A ?? p.askQuantity),
        spread: Number(p.a ?? p.askPrice) - Number(p.b ?? p.bidPrice),
      }
    case 'DEPTH_UPDATE':
    case 'PARTIAL_DEPTH': {
      const bids = (p.b ?? p.bids ?? []) as Array<[string, string]>
      const asks = (p.a ?? p.asks ?? []) as Array<[string, string]>
      const normBids = bids.map(([price, qty]) => [Number(price), Number(qty)] as [number, number])
      const normAsks = asks.map(([price, qty]) => [Number(price), Number(qty)] as [number, number])
      const lastUpdateId = Number(p.u ?? p.lastUpdateId ?? 0)
      if (eventType === 'PARTIAL_DEPTH') {
        return { lastUpdateId, bids: normBids, asks: normAsks, depthLevels: normBids.length }
      }
      return {
        firstUpdateId: Number(p.U ?? lastUpdateId),
        lastUpdateId,
        bids: normBids,
        asks: normAsks,
      }
    }
    case 'KLINE': {
      const k = (p.k ?? p) as Record<string, unknown>
      return {
        startTime: Number(k.t ?? k.startTime),
        endTime: Number(k.T ?? k.endTime),
        interval: String(k.i ?? k.interval ?? ''),
        open: Number(k.o ?? k.open),
        high: Number(k.h ?? k.high),
        low: Number(k.l ?? k.low),
        close: Number(k.c ?? k.close),
        volume: Number(k.v ?? k.volume),
        quoteVolume: Number(k.q ?? k.quoteVolume),
        tradeCount: Number(k.n ?? k.tradeCount ?? 0),
        isClosed: Boolean(k.x ?? k.isClosed),
      }
    }
    case 'FUNDING':
      return {
        fundingRate: Number(p.r ?? p.fundingRate),
        nextFundingTime: Number(p.T ?? p.nextFundingTime),
        markPrice: p.p != null ? Number(p.p) : null,
      }
    case 'REFERENCE_UPDATE':
      return {
        field: String(p.field ?? ''),
        oldValue: p.oldValue,
        newValue: p.newValue,
      }
    case 'HEARTBEAT':
      return { serverTime: Number(p.serverTime ?? Date.now()) }
    default:
      return {} as CanonicalPayload
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrity Verification  (Chapter 3.2 §13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify integrity before publication (§13).
 * Checks: valid symbol, positive quantity, positive price, valid timestamps,
 * sequence integrity, supported version. Invalid → quarantine.
 */
export function verifyIntegrity(event: CanonicalMarketEvent): IntegrityResult {
  const checks: IntegrityResult['checks'] = []

  // §13 — valid symbol
  checks.push({
    name: 'valid_symbol',
    passed: Boolean(event.symbol) && /^[A-Z0-9]+\/[A-Z0-9]+$/.test(event.symbol),
    detail: event.symbol,
  })

  // §13 — positive price (if applicable)
  const payload = event.payload as Record<string, unknown>
  for (const key of ['price', 'lastPrice', 'close', 'bidPrice', 'askPrice', 'markPrice']) {
    if (key in payload && typeof payload[key] === 'number') {
      const v = payload[key] as number
      checks.push({ name: `positive_${key}`, passed: v > 0 && Number.isFinite(v), detail: String(v) })
    }
  }

  // §13 — positive quantity (if applicable)
  for (const key of ['quantity', 'volume', 'bidQuantity', 'askQuantity', 'quoteVolume']) {
    if (key in payload && typeof payload[key] === 'number') {
      const v = payload[key] as number
      checks.push({ name: `valid_${key}`, passed: v >= 0 && Number.isFinite(v), detail: String(v) })
    }
  }

  // §13 — valid timestamps
  checks.push({
    name: 'valid_exchange_timestamp',
    passed: event.exchangeTimestamp > 0 && Number.isFinite(event.exchangeTimestamp),
    detail: String(event.exchangeTimestamp),
  })
  checks.push({
    name: 'valid_reception_timestamp',
    passed: event.receptionTimestamp !== null && typeof event.receptionTimestamp.ns === 'bigint',
    detail: 'bigint',
  })
  checks.push({
    name: 'valid_pipeline_timestamp',
    passed: event.pipelineTimestamp !== null && typeof event.pipelineTimestamp.ns === 'bigint',
    detail: 'bigint',
  })

  // §13 — supported version
  checks.push({
    name: 'supported_version',
    passed: event.eventVersion === CANONICAL_EVENT_VERSION,
    detail: event.eventVersion,
  })

  // §13 — sequence integrity (if sequence present)
  if (event.sequenceNumber !== null) {
    checks.push({
      name: 'valid_sequence',
      passed: event.sequenceNumber >= 0,
      detail: String(event.sequenceNumber),
    })
  }

  const passed = checks.every((c) => c.passed)
  if (!passed) {
    const failed = checks.filter((c) => !c.passed)
    log.warn(`integrity verification FAILED for ${event.eventType} ${event.symbol}: ${failed.map((c) => c.name).join(', ')} — quarantined (§13)`)
  }

  return { passed, checks }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Publication  (Chapter 3.2 §14)
// ─────────────────────────────────────────────────────────────────────────────

type EventHandler = (event: CanonicalMarketEvent) => void

class EventPublisher {
  private subscribers = new Set<EventHandler>()
  private quarantined: CanonicalMarketEvent[] = []
  private stats = {
    published: 0,
    quarantined: 0,
    publishFailures: 0,
  }

  /** Subscribe to canonical events (§14 — consumers only receive canonical events, Rule 7). */
  subscribe(handler: EventHandler): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /**
   * Publish a verified canonical event (§14).
   * Only verified events may be published. Every published event is immutable (Rule 4).
   */
  publish(event: CanonicalMarketEvent): boolean {
    try {
      this.stats.published++
      for (const sub of this.subscribers) {
        try {
          sub(event)
        } catch (e) {
          // §17 — pipeline isolation: subscriber failure doesn't affect others
          log.error(`subscriber failed for ${event.eventType} ${event.symbol}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      return true
    } catch (e) {
      this.stats.publishFailures++
      log.error(`publication failure for ${event.eventType} ${event.symbol}: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  /** Quarantine an invalid event (§13). */
  quarantine(event: CanonicalMarketEvent, reason: string): void {
    this.stats.quarantined++
    this.quarantined.push(event)
    if (this.quarantined.length > 1000) this.quarantined.shift()
    log.warn(`event quarantined: ${event.eventType} ${event.symbol} — ${reason}`)
  }

  getQuarantined(limit = 50): CanonicalMarketEvent[] {
    return this.quarantined.slice(-limit)
  }

  getStats() {
    return { ...this.stats, subscribers: this.subscribers.size }
  }
}

export const eventPublisher = new EventPublisher()
