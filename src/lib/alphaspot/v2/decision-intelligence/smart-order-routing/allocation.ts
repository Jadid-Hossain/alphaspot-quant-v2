// CHAPTER 5.8 §9 — Multi-Venue Allocation & Latency Synchronization
//
// §9 — Child orders may be distributed across multiple execution venues.
// Allocation methodologies: Equal, Liquidity-Proportional, Cost-Optimized,
// Latency-Optimized, Queue-Optimized, Toxicity-Aware, Adaptive.
//
// Rule 9 — Aggregate routed quantity EXACTLY equals approved child-order quantity.
// Rule 14 — Multi-venue routing preserves total execution intent.
// Rule 22 — Latency-matched execution synchronization.
// Rule 23 — Network transit latency incorporated into synchronization.

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AllocationMethodology,
  LatencySynchronization,
  VenueAllocation,
  VenueEvaluation,
  VenueMetadata,
} from './types'

const log = createLogger('decision-intelligence:smart-order-routing:allocation')

// ─────────────────────────────────────────────────────────────────────────────
// MultiVenueAllocator (§9, Rule 9, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export class MultiVenueAllocator {
  /**
   * Allocate child order quantity across multiple venues (§9, Rule 9, Rule 14).
   * Rule 9 — Aggregate routed quantity EXACTLY equals child-order quantity.
   */
  allocate(
    childOrderQuantity: number,
    rankedVenues: VenueEvaluation[],
    venueMetadata: Map<string, VenueMetadata>,
    methodology: AllocationMethodology,
    maxVenues: number,
    currentTime: number = Date.now(),
  ): { allocations: VenueAllocation[]; aggregateVerified: boolean } {
    // Limit to maxVenues
    const selectedVenues = rankedVenues.slice(0, maxVenues)
    if (selectedVenues.length === 0) {
      return { allocations: [], aggregateVerified: false }
    }

    const allocations: VenueAllocation[] = []
    const totalScore = selectedVenues.reduce((sum, v) => sum + Math.max(0.01, v.compositeScore), 0)

    let remainingQuantity = childOrderQuantity

    for (let i = 0; i < selectedVenues.length; i++) {
      const evalResult = selectedVenues[i]
      const venue = venueMetadata.get(evalResult.venueId)
      if (!venue) continue

      const isLast = i === selectedVenues.length - 1

      // §9 — Allocation methodology
      let allocationFraction: number
      switch (methodology) {
        case 'EQUAL_ALLOCATION':
          allocationFraction = 1 / selectedVenues.length
          break
        case 'LIQUIDITY_PROPORTIONAL':
          allocationFraction = evalResult.liquidityScore / totalScore
          break
        case 'COST_OPTIMIZED':
          // Inverse cost weighting (lower cost → higher allocation)
          allocationFraction = (1 / Math.max(0.01, evalResult.expectedVenueCost)) /
            selectedVenues.reduce((s, v) => s + 1 / Math.max(0.01, v.expectedVenueCost), 0)
          break
        case 'LATENCY_OPTIMIZED':
          allocationFraction = (1 / Math.max(1, evalResult.expectedVenueLatency)) /
            selectedVenues.reduce((s, v) => s + 1 / Math.max(1, v.expectedVenueLatency), 0)
          break
        case 'QUEUE_OPTIMIZED':
          allocationFraction = evalResult.queuePositionProbability / totalScore
          break
        case 'TOXICITY_AWARE':
          // Penalize toxic venues in allocation
          const toxicityWeight = 1 - evalResult.toxicityAssessment.venueToxicityScore
          allocationFraction = (evalResult.compositeScore * toxicityWeight) / totalScore
          break
        case 'ADAPTIVE':
          allocationFraction = evalResult.compositeScore / totalScore
          break
        default:
          allocationFraction = evalResult.compositeScore / totalScore
      }

      // Rule 9 — Last venue gets residual to ensure exact aggregate
      let allocatedQuantity: number
      if (isLast) {
        allocatedQuantity = remainingQuantity
        allocationFraction = allocatedQuantity / childOrderQuantity
      } else {
        allocatedQuantity = childOrderQuantity * allocationFraction
      }

      allocations.push({
        venueId: venue.venueId,
        exchange: venue.exchange,
        allocatedQuantity,
        allocationFraction,
        queuePositionEstimate: venue.queueLength,
        expectedFillProbability: evalResult.expectedFillProbability,
        expectedVenueCost: evalResult.expectedVenueCost * allocationFraction,
        expectedVenueLatency: evalResult.expectedVenueLatency,
        synchronizedReleaseTime: currentTime, // will be adjusted by latency sync
        latencyCompensationMs: 0, // will be computed by latency synchronizer
      })

      remainingQuantity -= allocatedQuantity
    }

    // Rule 9 — Verify aggregate
    const aggregate = allocations.reduce((s, a) => s + a.allocatedQuantity, 0)
    const aggregateVerified = Math.abs(aggregate - childOrderQuantity) < 1e-10

    if (!aggregateVerified) {
      log.warn(`Rule 9 violation: aggregate ${aggregate} ≠ child quantity ${childOrderQuantity}`)
    }

    log.debug(
      `allocated ${childOrderQuantity} across ${allocations.length} venues (${methodology}): ` +
      `${allocations.map((a) => `${a.venueId}=${a.allocatedQuantity.toFixed(4)}`).join(', ')}`,
    )

    return { allocations, aggregateVerified }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LatencySynchronizer (§9, Rule 22, Rule 23)
// Rule 22 — Latency-matched execution synchronization.
// Rule 23 — Network transit latency incorporated.
// ─────────────────────────────────────────────────────────────────────────────

export class LatencySynchronizer {
  /**
   * Compute latency-matched release times for multi-venue routing (§9, Rule 22, Rule 23).
   * Ensures logically simultaneous child orders arrive at matching engines within tolerance.
   */
  synchronize(
    allocations: VenueAllocation[],
    venueMetadata: Map<string, VenueMetadata>,
    synchronizationToleranceMs: number,
    enabled: boolean,
    currentTime: number = Date.now(),
    modelVersion: string = '1.0.0',
  ): { synchronizedAllocations: VenueAllocation[]; synchronization: LatencySynchronization } {
    if (!enabled || allocations.length <= 1) {
      // No synchronization needed
      const synchronization: LatencySynchronization = {
        enabled: false,
        targetArrivalTime: currentTime,
        synchronizationToleranceMs,
        perVenueReleaseTimes: {},
        perVenueTransitTimes: {},
        perVenueGatewayLatencies: {},
        clockSyncReference: 'local',
        modelVersion,
      }
      return { synchronizedAllocations: allocations, synchronization }
    }

    // §9 — Compute per-venue total latency (network transit + gateway + venue processing)
    const perVenueTransitTimes: Record<string, number> = {}
    const perVenueGatewayLatencies: Record<string, number> = {}
    const perVenueTotalLatencies: Record<string, number> = {}

    let maxLatency = 0
    for (const alloc of allocations) {
      const venue = venueMetadata.get(alloc.venueId)
      const transit = venue?.networkTransitTime ?? 0
      const gateway = venue?.gatewayLatency ?? 0
      const venueLatency = venue?.venueLatency ?? 0
      const totalLatency = transit + gateway + venueLatency

      perVenueTransitTimes[alloc.venueId] = transit
      perVenueGatewayLatencies[alloc.venueId] = gateway
      perVenueTotalLatencies[alloc.venueId] = totalLatency

      if (totalLatency > maxLatency) maxLatency = totalLatency
    }

    // §9 — Target arrival time = now + max latency (so all arrive at same time)
    const targetArrivalTime = currentTime + maxLatency

    // §9 — Per-venue release times (delay faster venues so all arrive together)
    const perVenueReleaseTimes: Record<string, number> = {}
    const synchronizedAllocations: VenueAllocation[] = allocations.map((alloc) => {
      const totalLatency = perVenueTotalLatencies[alloc.venueId] ?? 0
      const releaseTime = targetArrivalTime - totalLatency
      const compensationMs = maxLatency - totalLatency

      perVenueReleaseTimes[alloc.venueId] = releaseTime

      return {
        ...alloc,
        synchronizedReleaseTime: releaseTime,
        latencyCompensationMs: compensationMs,
      }
    })

    const synchronization: LatencySynchronization = {
      enabled: true,
      targetArrivalTime,
      synchronizationToleranceMs,
      perVenueReleaseTimes,
      perVenueTransitTimes,
      perVenueGatewayLatencies,
      clockSyncReference: 'local',
      modelVersion,
    }

    log.debug(
      `latency synchronization: ${allocations.length} venues, target arrival ${targetArrivalTime}, ` +
      `max latency ${maxLatency}ms, tolerance ${synchronizationToleranceMs}ms`,
    )

    return { synchronizedAllocations, synchronization }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const multiVenueAllocator = new MultiVenueAllocator()
export const latencySynchronizer = new LatencySynchronizer()
