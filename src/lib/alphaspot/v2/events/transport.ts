// CHAPTER 2.2 §4 — Event Transport Abstraction
// CHAPTER 2.2 §7 — Event Contracts
// CHAPTER 2.2 §8 — Event Immutability
//
// All inter-domain communication passes through this abstract Event Transport
// Layer. The transport implementation is interchangeable (in-memory, IPC,
// pub/sub, distributed broker). No business domain depends on a specific
// transport technology (Chapter 2.2 §4).
//
// Every event is an immutable EventEnvelope (Chapter 2.2 §7, §8, Rule 2).

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('event-transport')

// ─────────────────────────────────────────────────────────────────────────────
// Event Envelope  (Chapter 2.2 §7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The standard envelope every published event must conform to.
 * Immutable after publication (Chapter 2.2 §8, Rule 2).
 */
export interface EventEnvelope<TPayload = unknown> {
  /** Unique event identifier (used for idempotency dedup — §10) */
  eventId: string
  /** Event type from the catalog (Chapter 2.2 §15) */
  eventType: string
  /** Schema version of this event's payload (Chapter 2.2 §9) */
  eventVersion: string
  /** When the event was produced (ms epoch) */
  timestamp: number
  /** Shared across all events in one analytical cycle (Chapter 2.2 §20) */
  correlationId: string
  /** The snapshot this event belongs to (Chapter 2.2 §12) */
  snapshotId: string | null
  /** The domain that produced this event (Chapter 2.2 §7) */
  producer: string
  /** The typed payload — frozen on publish (§8) */
  payload: Readonly<TPayload>
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Priority  (Chapter 2.2 §16)
// ─────────────────────────────────────────────────────────────────────────────

export type EventPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export const PRIORITY_RANK: Record<EventPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport abstraction  (Chapter 2.2 §4)
// ─────────────────────────────────────────────────────────────────────────────

export type EventHandler<TPayload = unknown> = (event: EventEnvelope<TPayload>) => void | Promise<void>

export interface EventHandlerSubscription {
  handler: EventHandler
  eventTypes: string[] | null // null = wildcard (all events)
  consumerName: string
}

export interface EventTransport {
  /** Publish an immutable event. The payload is deep-frozen before dispatch. */
  publish<TPayload>(envelope: EventEnvelope<TPayload>, priority?: EventPriority): void
  /** Subscribe to events. Pass null for eventTypes to receive all (wildcard). */
  subscribe(handler: EventHandler, opts?: { eventTypes?: string[] | null; consumerName?: string }): () => void
  /** Flush any queued events (for batched transports). */
  flush?(): Promise<void>
  /** Transport health for observability (Chapter 2.2 §21). */
  getStats(): EventTransportStats
}

export interface EventTransportStats {
  published: number
  delivered: number
  failed: number
  queued: number
  subscribers: number
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Transport Implementation  (default)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default in-memory transport. Suitable for single-process deployments.
 * The transport interface (Chapter 2.2 §4) allows swapping to IPC, Redis
 * pub/sub, or a distributed broker without business-logic changes.
 *
 * Dispatches synchronously to preserve event ordering within a correlation.
 * Priority is tracked for the orchestrator's scheduling decisions (§16).
 */
export class InMemoryEventTransport implements EventTransport {
  private handlers = new Set<EventHandlerSubscription>()
  private stats = { published: 0, delivered: 0, failed: 0, queued: 0, subscribers: 0 }
  private history: Array<{ envelope: EventEnvelope; priority: EventPriority; deliveredTo: number }> = []
  private readonly historyLimit = 5000

  publish<TPayload>(envelope: EventEnvelope<TPayload>, priority: EventPriority = 'MEDIUM'): void {
    // Deep-freeze the payload (Chapter 2.2 §8, Rule 2 — immutability)
    const frozen = deepFreeze(envelope.payload)
    const sealed: EventEnvelope<TPayload> = Object.freeze({ ...envelope, payload: frozen })

    this.stats.published++
    let deliveredTo = 0

    for (const sub of this.handlers) {
      // Filter by event type (null = wildcard)
      if (sub.eventTypes !== null && !sub.eventTypes.includes(sealed.eventType)) continue
      deliveredTo++
      // Dispatch asynchronously per handler so one slow consumer doesn't block others (§17 isolation)
      void this.deliver(sub, sealed)
    }

    this.history.push({ envelope: sealed, priority, deliveredTo })
    if (this.history.length > this.historyLimit) this.history.shift()
    this.stats.queued = 0
  }

  private async deliver<TPayload>(sub: EventHandlerSubscription, envelope: EventEnvelope<TPayload>): Promise<void> {
    try {
      await sub.handler(envelope as EventEnvelope<unknown>)
      this.stats.delivered++
    } catch (e) {
      this.stats.failed++
      log.error(`handler "${sub.consumerName}" failed for ${envelope.eventType}: ${e instanceof Error ? e.message : String(e)}`, {
        eventId: envelope.eventId,
        correlationId: envelope.correlationId,
      })
      // Failure is isolated (Chapter 2.2 §17) — does not affect other consumers.
    }
  }

  subscribe(
    handler: EventHandler,
    opts: { eventTypes?: string[] | null; consumerName?: string } = {},
  ): () => void {
    const sub: EventHandlerSubscription = {
      handler,
      eventTypes: opts.eventTypes ?? null,
      consumerName: opts.consumerName ?? 'anonymous',
    }
    this.handlers.add(sub)
    this.stats.subscribers = this.handlers.size
    return () => {
      this.handlers.delete(sub)
      this.stats.subscribers = this.handlers.size
    }
  }

  async flush(): Promise<void> {
    // In-memory transport dispatches synchronously; nothing to flush.
  }

  getStats(): EventTransportStats {
    return { ...this.stats }
  }

  /** Introspection: recent event history (for debugging/audit — §21 observability). */
  getHistory(limit = 100): Array<{ envelope: EventEnvelope; priority: EventPriority; deliveredTo: number }> {
    return this.history.slice(-limit)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deep-freeze a value (Chapter 2.2 §8 — event immutability). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    value.forEach(deepFreeze)
    return Object.freeze(value) as T
  }
  for (const key of Object.keys(value as object)) {
    const v = (value as Record<string, unknown>)[key]
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
  }
  return Object.freeze(value)
}

/** Generate a unique event ID. */
export function generateEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Generate a unique correlation ID (Chapter 2.2 §20). */
export function generateCorrelationId(): string {
  return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Generate a unique snapshot ID. */
export function generateSnapshotId(): string {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport singleton + DI registration
// ─────────────────────────────────────────────────────────────────────────────

let activeTransport: EventTransport | null = null

/** Get the active event transport (creates an in-memory one lazily). */
export function getEventTransport(): EventTransport {
  if (!activeTransport) {
    activeTransport = new InMemoryEventTransport()
  }
  return activeTransport
}

/** Replace the transport (Chapter 2.2 §4 — interchangeable implementation). */
export function setEventTransport(transport: EventTransport): void {
  activeTransport = transport
}

/**
 * Convenience publisher: builds the envelope, generates IDs, and publishes.
 * This is the canonical way domains emit events.
 */
export function publishEvent<TPayload>(opts: {
  eventType: string
  eventVersion?: string
  producer: string
  payload: TPayload
  correlationId: string
  snapshotId?: string | null
  priority?: EventPriority
}): EventEnvelope<TPayload> {
  const envelope: EventEnvelope<TPayload> = {
    eventId: generateEventId(),
    eventType: opts.eventType,
    eventVersion: opts.eventVersion ?? '1.0.0',
    timestamp: Date.now(),
    correlationId: opts.correlationId,
    snapshotId: opts.snapshotId ?? null,
    producer: opts.producer,
    payload: opts.payload,
  }
  getEventTransport().publish(envelope, opts.priority ?? 'MEDIUM')
  return envelope
}
