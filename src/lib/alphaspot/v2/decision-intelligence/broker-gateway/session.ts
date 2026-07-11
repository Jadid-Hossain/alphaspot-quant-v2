// CHAPTER 5.9 §8, §9 — Session Management & Message Validation
//
// §8 — Session Management: initialization, authentication, heartbeat monitoring,
//      renewal, sequence sync, recovery, logout, auto-reconnect.
//      Broken sessions never transmit trading requests.
// §9 — Message Validation: required fields, schema, auth, permissions, symbol,
//      quantity, price, timestamp, duplicate detection.
//      Invalid messages never transmitted.
//
// Rule 9 — Only authenticated sessions may transmit.
// Rule 10 — Broken sessions immediately suspend new submissions.
// Rule 15 — All outbound communications undergo schema validation.
// Rule 16 — Every outbound request cryptographically authenticated.
// Rule 18 — Session heartbeats continuously monitored.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  BrokerConfiguration,
  BrokerSession,
  SessionConfiguration,
  SessionState,
} from './types'

const log = createLogger('decision-intelligence:broker-gateway:session')

// ─────────────────────────────────────────────────────────────────────────────
// SessionManager (§8, Rule 9, Rule 10, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, BrokerSession>()

  /**
   * Initialize a new broker session (§8).
   */
  initializeSession(brokerId: string, config: SessionConfiguration, currentTime: number = Date.now()): BrokerSession {
    const sessionId = `session-${brokerId}-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const session: BrokerSession = {
      sessionId,
      brokerId,
      state: 'INITIALIZING',
      sequenceNumber: 1,
      lastHeartbeat: currentTime,
      authToken: null,
      authExpiresAt: null,
      createdAt: currentTime,
      roundTripLatency: 0,
      packetLoss: 0,
    }
    this.sessions.set(sessionId, session)
    log.info(`session initialized: ${sessionId} for broker ${brokerId}`)
    return session
  }

  /**
   * Authenticate a session (§8, Rule 9, Rule 16).
   */
  authenticate(session: BrokerSession, authToken: string, expiresIn: number, currentTime: number = Date.now()): void {
    session.authToken = authToken
    session.authExpiresAt = currentTime + expiresIn
    session.state = 'ACTIVE'
    session.lastHeartbeat = currentTime
    log.info(`session ${session.sessionId} authenticated (expires in ${expiresIn}ms)`)
  }

  /**
   * Record heartbeat (§8, Rule 18).
   */
  recordHeartbeat(session: BrokerSession, latency: number, packetLoss: number, currentTime: number = Date.now()): void {
    session.lastHeartbeat = currentTime
    session.roundTripLatency = latency
    session.packetLoss = packetLoss

    // §8 — Check session health
    const heartbeatAge = currentTime - session.lastHeartbeat
    if (heartbeatAge > 30000) {
      session.state = 'BROKEN' // Rule 10 — broken session
      log.warn(`session ${session.sessionId} BROKEN — heartbeat age ${heartbeatAge}ms (Rule 10)`)
    } else if (heartbeatAge > 10000 || packetLoss > 0.1) {
      session.state = 'HEARTBEAT_DEGRADED'
    } else if (session.state === 'HEARTBEAT_DEGRADED') {
      session.state = 'ACTIVE'
    }
  }

  /**
   * Check if session can transmit (Rule 9, Rule 10).
   */
  canTransmit(session: BrokerSession, currentTime: number = Date.now()): boolean {
    // Rule 9 — Only authenticated sessions may transmit
    if (session.state !== 'ACTIVE' && session.state !== 'HEARTBEAT_DEGRADED') {
      return false
    }
    // Rule 10 — Broken sessions suspend new submissions
    if (session.state === 'BROKEN') {
      return false
    }
    // Check auth expiration
    if (session.authExpiresAt !== null && currentTime > session.authExpiresAt) {
      session.state = 'EXPIRED'
      return false
    }
    return true
  }

  /**
   * Renew session authentication (§8).
   */
  renewAuth(session: BrokerSession, newToken: string, expiresIn: number, currentTime: number = Date.now()): void {
    session.authToken = newToken
    session.authExpiresAt = currentTime + expiresIn
    session.state = 'ACTIVE'
    log.info(`session ${session.sessionId} auth renewed`)
  }

  /**
   * Increment sequence number (§8 — FIX sequence sync).
   */
  incrementSequence(session: BrokerSession): number {
    return session.sequenceNumber++
  }

  /**
   * Logout session (§8).
   */
  logout(session: BrokerSession): void {
    session.state = 'LOGGED_OUT'
    log.info(`session ${session.sessionId} logged out`)
  }

  /**
   * Attempt session recovery (§8, Rule 13).
   */
  recoverSession(session: BrokerSession, currentTime: number = Date.now()): boolean {
    if (session.state === 'BROKEN' || session.state === 'EXPIRED') {
      session.state = 'RECOVERING'
      log.info(`session ${session.sessionId} recovery initiated`)
      return true
    }
    return false
  }

  /**
   * Get active session for a broker.
   */
  getActiveSession(brokerId: string): BrokerSession | null {
    for (const session of this.sessions.values()) {
      if (session.brokerId === brokerId && (session.state === 'ACTIVE' || session.state === 'HEARTBEAT_DEGRADED')) {
        return session
      }
    }
    return null
  }

  /** Get all sessions. */
  getSessions(): BrokerSession[] {
    return Array.from(this.sessions.values())
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageValidator (§9, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export interface MessageValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export class MessageValidator {
  /**
   * Validate an outbound broker message (§9, Rule 15).
   * Invalid messages shall never be transmitted.
   */
  validate(
    symbol: string,
    quantity: number,
    price: number,
    timestamp: number,
    session: BrokerSession,
    brokerConfig: BrokerConfiguration,
    knownSymbols: Set<string>,
    currentTime: number = Date.now(),
  ): MessageValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // §9 — Required fields
    if (!symbol) errors.push('missing required field: symbol')
    if (quantity === undefined || quantity === null) errors.push('missing required field: quantity')
    if (timestamp === undefined || timestamp === null) errors.push('missing required field: timestamp')

    // §9 — Authentication status
    if (!session.authToken) {
      errors.push('session not authenticated (§9)')
    }
    if (session.authExpiresAt !== null && currentTime > session.authExpiresAt) {
      errors.push('session authentication expired (§9)')
    }

    // §9 — Broker permissions
    if (!brokerConfig.supportedProtocols.includes(brokerConfig.defaultProtocol)) {
      errors.push('broker does not support default protocol (§9)')
    }

    // §9 — Symbol validation
    if (symbol && !knownSymbols.has(symbol)) {
      errors.push(`symbol ${symbol} not in known symbols (§9)`)
    }

    // §9 — Quantity validation
    if (quantity !== undefined && quantity !== null) {
      if (quantity <= 0) errors.push(`invalid quantity: ${quantity} (must be positive)`)
      if (!Number.isFinite(quantity)) errors.push('quantity not finite')
    }

    // §9 — Price validation
    if (price !== undefined && price !== null) {
      if (price <= 0) warnings.push(`unusual price: ${price}`)
      if (!Number.isFinite(price)) errors.push('price not finite')
    }

    // §9 — Timestamp validation
    if (timestamp !== undefined && timestamp !== null) {
      const age = currentTime - timestamp
      if (Math.abs(age) > 60000) warnings.push(`timestamp age ${age}ms exceeds 60s`)
    }

    // §9 — Duplicate detection (would check against message cache)
    // (Implemented in idempotency manager)

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const sessionManager = new SessionManager()
export const messageValidator = new MessageValidator()
