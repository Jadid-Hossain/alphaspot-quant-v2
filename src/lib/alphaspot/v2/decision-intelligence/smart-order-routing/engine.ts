// CHAPTER 5.8 §5 — Smart Order Routing Engine (SORE)
//
// §1 — The SORE is the EXCLUSIVE bridge between Execution Optimization
//      (Ch 5.7) and the Broker Gateway. Transforms validated Execution Plans
//      into venue-specific Routing Decisions.
//
// §5 — 15-stage pipeline (no skips):
//   1.  EXECUTION_PLAN_RECEPTION
//   2.  EXECUTION_PLAN_VALIDATION
//   3.  VENUE_DISCOVERY
//   4.  VENUE_HEALTH_VERIFICATION
//   5.  LIQUIDITY_EVALUATION
//   6.  QUEUE_POSITION_ESTIMATION
//   7.  VENUE_COST_EVALUATION
//   8.  LATENCY_EVALUATION
//   9.  FILL_PROBABILITY_ESTIMATION
//  10.  VENUE_RANKING
//  11.  MULTI_VENUE_ALLOCATION
//  12.  ROUTING_VALIDATION
//  13.  ROUTING_PUBLICATION
//  14.  METADATA_RECORDING
//  15.  ROUTING_COMPLETION
//
// §6 — Canonical Routing Contract (Rule 4 — alternative formats prohibited).
// §7 — 10 Routing Strategies.
// §8 — Venue Evaluation + Toxicity Assessment (Rule 21).
// §9 — Multi-Venue Allocation + Latency Synchronization (Rule 22/23).
// §10 — Failover Management (Rule 13).
// §10A — Dynamic Queue Management (Rule 24/25/26).
// §11 — Routing Versioning (Rule 5 immutable).
// §12 — Routing Governance.
// §16 — Failure Recovery (invalid NEVER published).
//
// 26 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalExecutionPlanContract } from '../execution-optimization/types'
import type {
  CanonicalRoutingContract,
  QueueMonitoringState,
  RoutingConfiguration,
  RoutingGovernanceMetadata,
  RoutingLineage,
  RoutingMetadata,
  RoutingPriority,
  RoutingStrategy,
  RoutingVersionBundle,
  VenueAllocation,
  VenueEvaluation,
  VenueMetadata,
} from './types'
import { SORE_VERSION, ROUTING_CONTRACT_SCHEMA_VERSION } from './types'
import { venueEvaluator, venueRanker } from './evaluation'
import { multiVenueAllocator, latencySynchronizer } from './allocation'
import { failoverManager, queueManager } from './failover'
import { routingVersionRegistry, routingGovernanceManager } from './governance'
import { routingFailureRecovery, soreObservabilityCollector } from './recovery'

const log = createLogger('decision-intelligence:smart-order-routing:engine')

// ─────────────────────────────────────────────────────────────────────────────
// RoutingRequest — input to route()
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingRequest {
  /** Canonical Execution Plan Contract (Rule 1 — only Ch 5.7 plans). */
  executionPlan: CanonicalExecutionPlanContract
  /** Child order ID to route. */
  childOrderId: string
  /** Child order quantity to route. */
  childOrderQuantity: number
  /** Candidate venues. */
  venues: VenueMetadata[]
  /** Routing configuration. */
  config: RoutingConfiguration
  /** Current price (for order value computation). */
  price: number
}

// ─────────────────────────────────────────────────────────────────────────────
// RoutingResult — output of route()
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutingResult {
  routing: CanonicalRoutingContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartOrderRoutingEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class SmartOrderRoutingEngine {
  private routingHistory: CanonicalRoutingContract[] = []
  private subscribers = new Set<(routing: CanonicalRoutingContract) => void>()
  private readonly MAX_HISTORY = 500

  /**
   * Route a child order to execution venues (§5 — 15-stage pipeline).
   *
   * Rule 1 — Only Canonical Execution Plan Contracts (Ch 5.7) may enter.
   * Rule 4 — Output conforms to Canonical Routing Contract.
   * Rule 8 — Never modifies Execution Plan Contracts.
   * Rule 9 — Aggregate routed quantity EXACTLY equals child-order quantity.
   * Rule 11 — Venue health verification precedes routing.
   * Rule 21 — Toxicity assessment precedes final venue ranking.
   * Rule 22/23 — Latency-matched execution synchronization.
   */
  route(request: RoutingRequest): RoutingResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalRoutingContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        soreObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        soreObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { executionPlan, childOrderId, childOrderQuantity, venues, config, price } = request

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: EXECUTION_PLAN_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      track('EXECUTION_PLAN_RECEPTION', () => {
        if (!executionPlan || typeof executionPlan !== 'object') {
          throw new Error('invalid execution plan contract')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: EXECUTION_PLAN_VALIDATION (§5, Rule 8 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('EXECUTION_PLAN_VALIDATION', () => {
        if (!executionPlan.executionPlanId || !executionPlan.parentOrderId) {
          throw new Error('execution plan missing required fields')
        }
        if (childOrderQuantity <= 0) {
          throw new Error(`invalid child order quantity: ${childOrderQuantity}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: VENUE_DISCOVERY (§5)
      // ─────────────────────────────────────────────────────────────────────
      let candidateVenues: VenueMetadata[]
      track('VENUE_DISCOVERY', () => {
        candidateVenues = venues.filter((v) => v.healthState !== 'ISOLATED')
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: VENUE_HEALTH_VERIFICATION (§5, Rule 11, Rule 13)
      // ─────────────────────────────────────────────────────────────────────
      track('VENUE_HEALTH_VERIFICATION', () => {
        // Rule 11 — Health verification precedes routing
        const healthEvents = failoverManager.detectFailures(candidateVenues!)
        for (const event of healthEvents) {
          soreObservabilityCollector.recordVenueFailure(event.toState)
          // Rule 13 — Isolate failed venues
          failoverManager.isolateVenue(event.venueId, event.reason)
        }
        // Filter out isolated venues
        candidateVenues = candidateVenues!.filter((v) => !failoverManager.isIsolated(v.venueId))
        if (candidateVenues.length === 0) {
          throw new Error('no healthy venues available after health verification')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGES 5-9: VENUE EVALUATION (§8)
      //   LIQUIDITY_EVALUATION, QUEUE_POSITION_ESTIMATION, VENUE_COST_EVALUATION,
      //   LATENCY_EVALUATION, FILL_PROBABILITY_ESTIMATION
      // ─────────────────────────────────────────────────────────────────────
      let evaluations: VenueEvaluation[]
      const orderValue = childOrderQuantity * price

      track('LIQUIDITY_EVALUATION', () => {
        evaluations = candidateVenues!.map((v) => venueEvaluator.evaluate(v, childOrderQuantity, orderValue, config))
      })
      track('QUEUE_POSITION_ESTIMATION', () => { /* computed in evaluation */ })
      track('VENUE_COST_EVALUATION', () => { /* computed in evaluation */ })
      track('LATENCY_EVALUATION', () => { /* computed in evaluation */ })
      track('FILL_PROBABILITY_ESTIMATION', () => { /* computed in evaluation */ })

      // Record toxicity metrics
      for (const eval_ of evaluations!) {
        if (eval_.toxicityExcluded) soreObservabilityCollector.recordToxicityExclusion()
        else if (eval_.toxicityPenalized) soreObservabilityCollector.recordToxicityPenalty()
      }

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: VENUE_RANKING (§5, Rule 21)
      // ─────────────────────────────────────────────────────────────────────
      let rankedVenues: VenueEvaluation[]
      track('VENUE_RANKING', () => {
        // Rule 21 — Toxicity assessment precedes final venue ranking
        rankedVenues = venueRanker.rank(evaluations!)
        if (rankedVenues.length === 0) {
          throw new Error('all venues excluded due to toxicity (Rule 21)')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: MULTI_VENUE_ALLOCATION (§5, §9, Rule 9, Rule 22, Rule 23)
      // ─────────────────────────────────────────────────────────────────────
      let allocations: VenueAllocation[]
      let synchronization: ReturnType<typeof latencySynchronizer.synchronize>['synchronization']
      const venueMap = new Map(venues.map((v) => [v.venueId, v]))
      track('MULTI_VENUE_ALLOCATION', () => {
        // §9 — Allocate across venues
        const strategy = config.perUrgencyStrategy[executionPlan.algorithm] ?? config.defaultStrategy
        const methodology = config.allocationMethodology
        const allocationResult = multiVenueAllocator.allocate(
          childOrderQuantity, rankedVenues!, venueMap, methodology, config.maxVenuesPerRouting,
        )
        if (!allocationResult.aggregateVerified) {
          throw new Error('Rule 9 violation: aggregate routed quantity ≠ child-order quantity')
        }
        allocations = allocationResult.allocations

        // Rule 22/23 — Latency-matched execution synchronization
        const syncResult = latencySynchronizer.synchronize(
          allocations!, venueMap,
          config.synchronizationToleranceMs, config.latencySyncEnabled,
          Date.now(), config.venueModelVersion,
        )
        allocations = syncResult.synchronizedAllocations
        synchronization = syncResult.synchronization
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: ROUTING_VALIDATION (§5, §16 — invalid NEVER published)
      // ─────────────────────────────────────────────────────────────────────
      track('ROUTING_VALIDATION', () => {
        if (allocations!.length === 0) {
          throw new Error('no venue allocations generated')
        }
        // Rule 9 — Verify aggregate
        const aggregate = allocations!.reduce((s, a) => s + a.allocatedQuantity, 0)
        if (Math.abs(aggregate - childOrderQuantity) > 1e-10) {
          throw new Error(`Rule 9 violation: aggregate ${aggregate} ≠ ${childOrderQuantity}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: ROUTING_PUBLICATION (§5, Rule 5 — immutable)
      // ─────────────────────────────────────────────────────────────────────
      let routing: CanonicalRoutingContract
      track('ROUTING_PUBLICATION', () => {
        const now = Date.now()
        const versions: RoutingVersionBundle = {
          routingVersion: SORE_VERSION,
          executionPlanVersion: String(executionPlan.executionPlanVersion),
          configurationVersion: config.versions.configurationVersion,
          venueModelVersion: config.venueModelVersion,
          governanceVersion: config.versions.governanceVersion,
        }

        const lineage: RoutingLineage = {
          executionPlanId: executionPlan.executionPlanId,
          executionPlanVersion: executionPlan.executionPlanVersion,
          orderDecisionId: executionPlan.parentOrderId,
          orderVersion: executionPlan.executionMetadata.versions.orderVersion,
          positionId: executionPlan.executionMetadata.lineage.positionId,
          riskAssessmentId: executionPlan.executionMetadata.lineage.riskAssessmentId,
          portfolioId: executionPlan.executionMetadata.lineage.portfolioId,
          strategyDecisionIds: executionPlan.executionMetadata.lineage.strategyDecisionIds,
          venueModelVersion: config.venueModelVersion,
          toxicityModelVersion: config.toxicityModelVersion,
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }

        const routingStrategy: RoutingStrategy = config.perUrgencyStrategy[executionPlan.algorithm] ?? config.defaultStrategy
        const routingPriority: RoutingPriority = this.computePriority(executionPlan.algorithm)

        const routingMetadata: RoutingMetadata = {
          routingDecisionId: `route-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          routingVersion: SORE_VERSION,
          versions,
          lineage,
          routingStrategy,
          allocationMethodology: config.allocationMethodology,
          routingPriority,
          reroutingAction: 'NONE',
        }

        const expirationTimestamp = now + 300000 // 5 min validity
        const governanceMeta: RoutingGovernanceMetadata = routingGovernanceManager.initialize(
          routingMetadata.routingDecisionId, expirationTimestamp, now,
        )

        // Compute aggregate metrics
        const selectedVenues = allocations!.map((a) => a.venueId)
        const selectedExchanges = allocations!.map((a) => a.exchange)
        const avgQueuePosition = allocations!.reduce((s, a) => s + a.queuePositionEstimate, 0) / allocations!.length
        const avgFillProb = allocations!.reduce((s, a) => s + a.expectedFillProbability, 0) / allocations!.length
        const totalVenueCost = allocations!.reduce((s, a) => s + a.expectedVenueCost, 0)
        const avgVenueLatency = allocations!.reduce((s, a) => s + a.expectedVenueLatency, 0) / allocations!.length
        const routingConfidence = avgFillProb * 0.7 + (1 - totalVenueCost / Math.max(1, orderValue)) * 0.3

        routing = {
          routingDecisionId: routingMetadata.routingDecisionId,
          routingVersion: SORE_VERSION,
          executionPlanId: executionPlan.executionPlanId,
          parentOrderId: executionPlan.parentOrderId,
          childOrderId,
          routingTimestamp: now,
          selectedVenues,
          selectedExchanges,
          venueAllocations: allocations!,
          routingPriority,
          routingStrategy,
          queuePositionEstimate: avgQueuePosition,
          expectedFillProbability: avgFillProb,
          expectedVenueCost: totalVenueCost,
          expectedVenueLatency: avgVenueLatency,
          routingConfidence: Math.max(0, Math.min(1, routingConfidence)),
          latencySynchronization: synchronization!,
          routingMetadata,
          governanceMetadata: governanceMeta,
          pipelineStages,
          createdAt: now,
        }

        routing = Object.freeze(routing) as CanonicalRoutingContract // Rule 5
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: METADATA_RECORDING (§5, §12)
      // ─────────────────────────────────────────────────────────────────────
      track('METADATA_RECORDING', () => {
        routingVersionRegistry.register(routing!)
        routingGovernanceManager.setValidationStatus(routing!.routingDecisionId, 'PASSED', 'sore-engine', 'routing validated')
        routingGovernanceManager.approve(routing!.routingDecisionId, 'sore-engine', `auto-approved (strategy ${routing!.routingStrategy})`)
        soreObservabilityCollector.recordGovernanceEvent()

        soreObservabilityCollector.recordRoutingDecision(
          routing!.routingStrategy,
          routing!.selectedVenues,
          Date.now() - startTime,
          routing!.expectedFillProbability,
          true,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 15: ROUTING_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('ROUTING_COMPLETION', () => {
        this.routingHistory.push(routing!)
        if (this.routingHistory.length > this.MAX_HISTORY) this.routingHistory.shift()

        for (const sub of this.subscribers) {
          try { sub(routing!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `routing decision ${routing!.routingDecisionId}: strategy=${routing!.routingStrategy}, ` +
          `${routing!.selectedVenues.length} venues, fillProb=${(routing!.expectedFillProbability * 100).toFixed(1)}%, ` +
          `cost=${routing!.expectedVenueCost.toFixed(2)}, latency=${routing!.expectedVenueLatency}ms, ` +
          `${Date.now() - startTime}ms`,
        )
      })

      return {
        routing: routing!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`routing failed: ${reason}`)
      routingFailureRecovery.logFailure(
        null, 'INTERNAL_ERROR', 'ROUTING', reason, 'GRACEFUL_DEGRADATION',
      )
      return {
        routing: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Compute routing priority from execution urgency (§4).
   */
  private computePriority(algorithm: string): RoutingPriority {
    switch (algorithm) {
      case 'MARKET': return 'CRITICAL'
      case 'SNIPER': return 'HIGH'
      case 'ARRIVAL_PRICE': return 'HIGH'
      case 'IMPLEMENTATION_SHORTFALL': return 'NORMAL'
      case 'TWAP':
      case 'VWAP':
      case 'POV': return 'NORMAL'
      case 'ICEBERG': return 'LOW'
      case 'PEGGED': return 'LOW'
      default: return 'NORMAL'
    }
  }

  /**
   * Monitor queue position for an active routed child order (§10A, Rule 24).
   */
  monitorQueue(
    childOrderId: string,
    venueId: string,
    initialPosition: number,
    currentPosition: number,
    lastHeartbeat: number,
    remainingQueueLength: number,
    orderAgeMs: number,
    venueCongestion: number,
    config: RoutingConfiguration,
  ): QueueMonitoringState {
    return queueManager.monitor(
      childOrderId, venueId, initialPosition, currentPosition,
      lastHeartbeat, remainingQueueLength, orderAgeMs, venueCongestion, config,
    )
  }

  /**
   * Initiate rerouting for a child order (§10A, Rule 25, Rule 26).
   */
  initiateRerouting(
    state: QueueMonitoringState,
    childOrderQuantity: number,
    filledQuantity: number,
  ): ReturnType<typeof queueManager.initiateRerouting> {
    const result = queueManager.initiateRerouting(state, childOrderQuantity, filledQuantity)
    soreObservabilityCollector.recordRerouting(result.action)
    return result
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  onRouting(handler: (routing: CanonicalRoutingContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getRecentRoutings(limit: number = 50): CanonicalRoutingContract[] {
    return this.routingHistory.slice(-limit)
  }

  getMetrics() {
    return soreObservabilityCollector.snapshot()
  }

  getRecoveryStats() {
    return routingFailureRecovery.getStats()
  }

  getIsolatedVenues(): string[] {
    return failoverManager.getIsolatedVenues()
  }

  getVersion() {
    return {
      engineVersion: SORE_VERSION,
      schemaVersion: ROUTING_CONTRACT_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const smartOrderRoutingEngine = new SmartOrderRoutingEngine()
