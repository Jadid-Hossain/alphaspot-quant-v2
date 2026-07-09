// CHAPTER 3.1 §4 — Exchange Abstraction
//
// Business domains never depend on exchange-specific implementations (§4).
// Each exchange connector exposes this common interface. Adding a new
// exchange requires only a new connector implementation (§4, Rule 3).
//
// The connector performs NO analytics (Rule 1). It only collects market data.

import type {
  ConnectionCategory,
  ConnectionState,
  ExchangeCapabilities,
  RawMarketEvent,
  StreamType,
  Subscription,
  ConnectorHealth,
} from './types'
import type { Candle, Timeframe, OrderBookImbalance, FundingData } from '../../types'

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Connector interface  (Chapter 3.1 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeConnector {
  /** Unique exchange identifier (e.g. 'binance'). */
  readonly exchangeId: string

  // §4 — Lifecycle methods
  connect(): Promise<void>
  disconnect(): Promise<void>
  reconnect(): Promise<void>

  // §4 — Subscription management
  subscribe(streams: string[]): Promise<Subscription[]>
  unsubscribe(streams: string[]): Promise<void>

  // §4 — Heartbeat + synchronization
  heartbeat(): Promise<{ latencyMs: number; serverTime: number }>
  snapshotSynchronize(symbol: string): Promise<void>

  // §4 — Capability discovery
  getCapabilities(): ExchangeCapabilities

  // §4 — Snapshot APIs (Category B)
  fetchOrderBookSnapshot(symbol: string, depth?: number): Promise<OrderBookImbalance>
  fetchHistoricalCandles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>
  fetchFundingRate(symbol: string): Promise<FundingData>

  // §4 — Reference APIs (Category C)
  fetchExchangeInfo(): Promise<{ symbols: Array<{ symbol: string; base: string; quote: string; status: string; isSpotTradingAllowed: boolean }> }>

  // §4 — Operational APIs (Category D)
  ping(): Promise<boolean>
  getServerTime(): Promise<number>

  // Event handler registration — the connector emits raw events to this handler
  onEvent(handler: (event: RawMarketEvent) => void): () => void
  onStateChange(handler: (state: ConnectionState, connectionId: string) => void): () => void

  // Health + observability (§8, §15)
  getHealth(connectionId?: string): ConnectorHealth | ConnectorHealth[]
  getConnectionState(connectionId?: string): ConnectionState

  // Subscription query
  getActiveSubscriptions(): Subscription[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Abstract base class — partial implementation shared by all connectors.
// Concrete connectors (Binance, etc.) extend this and implement the
// exchange-specific methods.
// ─────────────────────────────────────────────────────────────────────────────

export abstract class BaseExchangeConnector implements ExchangeConnector {
  abstract readonly exchangeId: string

  protected eventHandlers = new Set<(event: RawMarketEvent) => void>()
  protected stateHandlers = new Set<(state: ConnectionState, connectionId: string) => void>()
  protected subscriptions = new Map<string, Subscription>()
  protected connectionStates = new Map<string, ConnectionState>()

  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract reconnect(): Promise<void>
  abstract subscribe(streams: string[]): Promise<Subscription[]>
  abstract unsubscribe(streams: string[]): Promise<void>
  abstract heartbeat(): Promise<{ latencyMs: number; serverTime: number }>
  abstract snapshotSynchronize(symbol: string): Promise<void>
  abstract getCapabilities(): ExchangeCapabilities
  abstract fetchOrderBookSnapshot(symbol: string, depth?: number): Promise<OrderBookImbalance>
  abstract fetchHistoricalCandles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>
  abstract fetchFundingRate(symbol: string): Promise<FundingData>
  abstract fetchExchangeInfo(): Promise<{ symbols: Array<{ symbol: string; base: string; quote: string; status: string; isSpotTradingAllowed: boolean }> }>
  abstract ping(): Promise<boolean>
  abstract getServerTime(): Promise<number>
  abstract getHealth(connectionId?: string): ConnectorHealth | ConnectorHealth[]

  /** Emit a raw market event to all registered handlers. */
  protected emitEvent(event: RawMarketEvent): void {
    for (const handler of this.eventHandlers) handler(event)
  }

  /** Emit a state change to all registered handlers. */
  protected emitStateChange(state: ConnectionState, connectionId: string): void {
    this.connectionStates.set(connectionId, state)
    for (const handler of this.stateHandlers) handler(state, connectionId)
  }

  onEvent(handler: (event: RawMarketEvent) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onStateChange(handler: (state: ConnectionState, connectionId: string) => void): () => void {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  getConnectionState(connectionId?: string): ConnectionState {
    if (connectionId) return this.connectionStates.get(connectionId) ?? 'INITIALIZING'
    // Return the worst state across all connections
    const states = Array.from(this.connectionStates.values())
    if (states.length === 0) return 'INITIALIZING'
    if (states.some((s) => s === 'FAILED')) return 'FAILED'
    if (states.some((s) => s === 'RECONNECTING')) return 'RECONNECTING'
    if (states.every((s) => s === 'LIVE')) return 'LIVE'
    return 'CONNECTING'
  }

  getActiveSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values())
  }

  /** Register a subscription internally (called by concrete subscribe()). */
  protected registerSubscription(sub: Subscription): void {
    this.subscriptions.set(sub.stream, sub)
  }

  /** Remove a subscription internally. */
  protected removeSubscription(stream: string): void {
    this.subscriptions.delete(stream)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector registry  (Chapter 3.1 §4 — adding a new exchange = new connector)
// ─────────────────────────────────────────────────────────────────────────────

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('exchange-connectivity')

class ConnectorRegistry {
  private connectors = new Map<string, ExchangeConnector>()
  private activeConnectorId: string | null = null

  register(connector: ExchangeConnector): void {
    if (this.connectors.has(connector.exchangeId)) {
      throw new Error(`[connectivity] connector "${connector.exchangeId}" already registered`)
    }
    this.connectors.set(connector.exchangeId, connector)
    if (!this.activeConnectorId) this.activeConnectorId = connector.exchangeId
    log.info(`exchange connector registered: ${connector.exchangeId}`)
  }

  get(exchangeId: string): ExchangeConnector | undefined {
    return this.connectors.get(exchangeId)
  }

  getActive(): ExchangeConnector | null {
    return this.activeConnectorId ? this.connectors.get(this.activeConnectorId) ?? null : null
  }

  setActive(exchangeId: string): void {
    if (!this.connectors.has(exchangeId)) {
      throw new Error(`[connectivity] cannot set active — connector "${exchangeId}" not registered`)
    }
    this.activeConnectorId = exchangeId
    log.info(`active exchange connector set: ${exchangeId}`)
  }

  list(): ExchangeConnector[] {
    return Array.from(this.connectors.values())
  }
}

export const connectorRegistry = new ConnectorRegistry()
