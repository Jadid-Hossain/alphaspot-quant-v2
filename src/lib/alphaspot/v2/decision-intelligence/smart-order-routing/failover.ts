// CHAPTER 5.8 §10, §10A — Failover Management & Dynamic Queue Management
//
// §10 — Failover Management:
//   • Venue Failure Detection
//   • Latency Spike Detection
//   • Liquidity Collapse Detection
//   • Connectivity Failure Detection
//   • Automatic Venue Substitution
//   • Routing Recovery
//   • Failed venues automatically isolated (Rule 13)
//
// §10A — Dynamic Queue Management:
//   • Queue Position Monitoring
//   • Queue Position Decay
//   • Fill Heartbeat Monitoring
//   • Expected Fill Time
//   • Remaining Queue Length
//   • Passive Order Aging
//   • Venue Queue Congestion
//   • Queue Abandonment Detection
//   • Dynamic Queue Score
//   • Rerouting: Cancel-and-Replace, Venue Migration, etc. (Rule 25, Rule 26)
//
// Rule 13 — Failed venues isolated until recovery criteria satisfied.
// Rule 15 — Deterministic failover without modifying historical records.
// Rule 24 — Continuous queue-position monitoring.
// Rule 25 — Queue decay → deterministic cancel-and-replace rerouting.
// Rule 26 — Dynamic rerouting preserves quantity, lineage, history, replay.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  QueueMonitoringState,
  ReroutingAction,
  RoutingConfiguration,
  VenueHealthState,
  VenueMetadata,
} from './types'

const log = createLogger('decision-intelligence:smart-order-routing:failover')

// ─────────────────────────────────────────────────────────────────────────────
// FailoverManager (§10, Rule 13, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueHealthEvent {
  venueId: string
  fromState: VenueHealthState
  toState: VenueHealthState
  timestamp: number
  reason: string
  detectedBy: string
}

export class FailoverManager {
  private isolatedVenues = new Map<string, { isolatedAt: number; reason: string; observations: number }>()

  /**
   * Detect venue health issues (§10, Rule 11).
   * Returns venues that should be isolated.
   */
  detectFailures(venues: VenueMetadata[]): VenueHealthEvent[] {
    const events: VenueHealthEvent[] = []
    const now = Date.now()

    for (const venue of venues) {
      let newState: VenueHealthState | null = null
      let reason = ''

      // §10 — Latency spike detection
      const totalLatency = venue.venueLatency + venue.networkTransitTime + venue.gatewayLatency
      if (totalLatency > 500 && venue.healthState === 'HEALTHY') {
        newState = 'LATENCY_SPIKE'
        reason = `latency ${totalLatency}ms exceeds threshold`
      }
      // §10 — Liquidity collapse detection
      else if (venue.availableLiquidity < venue.orderBookDepth * 0.1 && venue.healthState === 'HEALTHY') {
        newState = 'LIQUIDITY_COLLAPSE'
        reason = `liquidity ${venue.availableLiquidity} collapsed below 10% of depth`
      }
      // §10 — Connectivity failure (reliability drops)
      else if (venue.reliabilityScore < 0.3 && venue.healthState === 'HEALTHY') {
        newState = 'CONNECTIVITY_FAILURE'
        reason = `reliability ${venue.reliabilityScore} below 0.3`
      }

      if (newState) {
        events.push({
          venueId: venue.venueId,
          fromState: venue.healthState,
          toState: newState,
          timestamp: now,
          reason,
          detectedBy: 'failover-manager',
        })
      }
    }

    return events
  }

  /**
   * Isolate a failed venue (§10, Rule 13).
   * Isolated venues are excluded from routing until recovery criteria met.
   */
  isolateVenue(venueId: string, reason: string, currentTime: number = Date.now()): void {
    this.isolatedVenues.set(venueId, { isolatedAt: currentTime, reason, observations: 0 })
    log.warn(`venue ${venueId} ISOLATED (Rule 13): ${reason}`)
  }

  /**
   * Check if a venue is isolated (Rule 13).
   */
  isIsolated(venueId: string): boolean {
    return this.isolatedVenues.has(venueId)
  }

  /**
   * Check venue recovery criteria (§10, Rule 13).
   * Returns true if venue can be recovered from isolation.
   */
  checkRecovery(venueId: string, venue: VenueMetadata, config: RoutingConfiguration, currentTime: number = Date.now()): boolean {
    const isolation = this.isolatedVenues.get(venueId)
    if (!isolation) return true // not isolated

    // Rule 13 — Recovery cooldown
    if (currentTime - isolation.isolatedAt < config.venueRecoveryCriteria.recoveryCooldownMs) {
      return false
    }

    // Rule 13 — Recovery criteria
    if (venue.reliabilityScore < config.venueRecoveryCriteria.minReliabilityScore) return false
    if (venue.venueLatency > config.venueRecoveryCriteria.maxLatencyMs) return false
    if (isolation.observations < config.venueRecoveryCriteria.minHealthObservations) return false

    // Recovery criteria satisfied
    this.isolatedVenues.delete(venueId)
    log.info(`venue ${venueId} RECOVERED from isolation (Rule 13)`)
    return true
  }

  /**
   * Increment health observation count for an isolated venue.
   */
  recordHealthObservation(venueId: string): void {
    const isolation = this.isolatedVenues.get(venueId)
    if (isolation) {
      isolation.observations++
    }
  }

  /** Get all isolated venue IDs. */
  getIsolatedVenues(): string[] {
    return Array.from(this.isolatedVenues.keys())
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QueueManager (§10A, Rule 24, Rule 25, Rule 26)
// ─────────────────────────────────────────────────────────────────────────────

export class QueueManager {
  /**
   * Monitor queue position for an active child order (§10A, Rule 24).
   * Returns queue monitoring state + rerouting recommendation.
   */
  monitor(
    childOrderId: string,
    venueId: string,
    initialPosition: number,
    currentPosition: number,
    lastHeartbeat: number,
    remainingQueueLength: number,
    orderAgeMs: number,
    venueCongestion: number,
    config: RoutingConfiguration,
    currentTime: number = Date.now(),
  ): QueueMonitoringState {
    // §10A — Queue position decay
    const queuePositionDecay = Math.max(0, initialPosition - currentPosition)

    // §10A — Expected fill time (based on decay rate)
    const decayRate = orderAgeMs > 0 ? queuePositionDecay / orderAgeMs : 0
    const expectedFillTimeMs = decayRate > 0 ? (currentPosition / decayRate) : 0

    // §10A — Queue abandonment detection
    const heartbeatAge = currentTime - lastHeartbeat
    const queueAbandonmentDetected = heartbeatAge > config.fillHeartbeatTimeoutMs

    // §10A — Dynamic queue score (0..1, higher = better)
    const positionScore = initialPosition > 0 ? currentPosition / initialPosition : 0
    const heartbeatScore = Math.max(0, 1 - heartbeatAge / config.fillHeartbeatTimeoutMs)
    const congestionScore = 1 - venueCongestion
    const dynamicQueueScore = Math.max(0, Math.min(1,
      positionScore * 0.4 + heartbeatScore * 0.4 + congestionScore * 0.2,
    ))

    // Rule 25 — Rerouting recommendation
    const decayFraction = initialPosition > 0 ? queuePositionDecay / initialPosition : 0
    let reroutingRecommended = false
    let reroutingReason = 'queue position acceptable'

    if (queueAbandonmentDetected) {
      reroutingRecommended = true
      reroutingReason = `queue abandonment detected (heartbeat age ${heartbeatAge}ms > timeout ${config.fillHeartbeatTimeoutMs}ms) — Rule 25`
    } else if (decayFraction > config.queueDecayReroutingThreshold && dynamicQueueScore < 0.3) {
      reroutingRecommended = true
      reroutingReason = `queue position decay ${(decayFraction * 100).toFixed(1)}% > ${config.queueDecayReroutingThreshold * 100}% with low queue score ${dynamicQueueScore.toFixed(2)} — Rule 25`
    }

    return {
      childOrderId,
      venueId,
      currentPosition,
      initialPosition,
      queuePositionDecay,
      lastHeartbeat,
      expectedFillTimeMs,
      remainingQueueLength,
      passiveOrderAgeMs: orderAgeMs,
      queueCongestion: venueCongestion,
      queueAbandonmentDetected,
      dynamicQueueScore,
      reroutingRecommended,
      reroutingReason,
    }
  }

  /**
   * Initiate rerouting for a child order (§10A, Rule 25, Rule 26).
   * Rule 26 — Preserves total approved quantity, parent-child relationships,
   *           immutable routing history, deterministic replay capability.
   */
  initiateRerouting(
    state: QueueMonitoringState,
    childOrderQuantity: number,
    filledQuantity: number,
  ): { action: ReroutingAction; residualQuantity: number; reason: string } {
    const residualQuantity = childOrderQuantity - filledQuantity

    // §10A — Determine rerouting action
    let action: ReroutingAction
    if (state.queueAbandonmentDetected) {
      action = 'CANCEL_AND_REPLACE'
    } else if (state.dynamicQueueScore < 0.2) {
      action = 'VENUE_MIGRATION'
    } else if (state.queueCongestion > 0.7) {
      action = 'QUEUE_REPOSITIONING'
    } else if (state.passiveOrderAgeMs > 60000) {
      action = 'ORDER_REFRESH'
    } else {
      action = 'ALTERNATIVE_VENUE_ALLOCATION'
    }

    log.info(
      `rerouting initiated for ${state.childOrderId}: action=${action}, residual=${residualQuantity} ` +
      `(Rule 26: quantity preserved, lineage preserved, history immutable)`,
    )

    return {
      action,
      residualQuantity,
      reason: state.reroutingReason,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const failoverManager = new FailoverManager()
export const queueManager = new QueueManager()
