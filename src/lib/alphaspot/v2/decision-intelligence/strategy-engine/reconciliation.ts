// CHAPTER 5.2 §9, Rule 16, Rule 17 — Cross-Strategy Decision Reconciliation
//
// §9 — Prior to publication, the SIE evaluates all active Strategy Decisions
//      for logical conflicts on the same tradable instrument.
//
// Conflict analysis may include:
//   • Opposing Direction Detection
//   • Net Exposure Calculation
//   • Strategy Priority
//   • Strategy Confidence
//   • Strategy Horizon
//   • Capital Efficiency
//   • Historical Strategy Reliability
//
// The engine may generate:
//   • Independent Decisions
//   • Consolidated Decisions
//   • Partially Offset Decisions
//   • Deferred Decisions
//
// Rule 16 — Reconciliation minimizes unnecessary opposing market exposure
//           while preserving complete decision lineage.
// Rule 17 — Reconciliation NEVER modifies internal decision logic of constituent
//           strategies. Only the published Decision Intent may be consolidated.
//
// This prevents internal self-trading.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalStrategyDecision, ReconciliationLineage } from './types'

const log = createLogger('decision-intelligence:strategy-engine:reconciliation')

// ─────────────────────────────────────────────────────────────────────────────
// Conflict Analysis Result
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictAnalysis {
  /** All decisions targeting the same tradable instrument. */
  instrumentDecisions: CanonicalStrategyDecision[]
  /** True if any pair has opposing directions. */
  opposingDetected: boolean
  /** Net exposure fraction across all decisions (LONG positive, SHORT negative). */
  netExposureFraction: number
  /** Identified conflicts. */
  conflicts: Array<StrategyConflict>
  /** Recommended reconciliation type. */
  recommendedAction: ReconciliationType
}

export interface StrategyConflict {
  decisionA: string
  decisionB: string
  conflictType: 'OPPOSING_DIRECTION' | 'EXPOSURE_CAP_EXCEEDED' | 'REDUNDANT' | 'PRIORITY_CONFLICT'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
}

export type ReconciliationType =
  | 'INDEPENDENT' // §9 — no conflicts, publish all as-is
  | 'CONSOLIDATED' // §9 — merge into single decision (preserve lineage Rule 16)
  | 'PARTIALLY_OFFSET' // §9 — net opposing exposure, publish reduced
  | 'DEFERRED' // §9 — defer lower-priority decisions

// ─────────────────────────────────────────────────────────────────────────────
// StrategyReconciler
// ─────────────────────────────────────────────────────────────────────────────

export class StrategyReconciler {
  /**
   * Analyze conflicts in a set of decisions targeting the same tradable
   * instrument (§9, Rule 16).
   */
  analyzeConflicts(decisions: CanonicalStrategyDecision[]): ConflictAnalysis {
    if (decisions.length === 0) {
      return {
        instrumentDecisions: [],
        opposingDetected: false,
        netExposureFraction: 0,
        conflicts: [],
        recommendedAction: 'INDEPENDENT',
      }
    }

    if (decisions.length === 1) {
      // Single decision — no reconciliation needed
      return {
        instrumentDecisions: decisions,
        opposingDetected: false,
        netExposureFraction: this.computeNetExposure(decisions),
        conflicts: [],
        recommendedAction: 'INDEPENDENT',
      }
    }

    const conflicts: StrategyConflict[] = []

    // Opposing Direction Detection (§9)
    let opposingDetected = false
    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        const a = decisions[i]
        const b = decisions[j]
        if (this.areOpposing(a, b)) {
          opposingDetected = true
          conflicts.push({
            decisionA: a.decisionId,
            decisionB: b.decisionId,
            conflictType: 'OPPOSING_DIRECTION',
            severity: this.severityForOpposing(a, b),
            description: `${a.strategyId} (${a.exposureIntent.direction}) vs ${b.strategyId} (${b.exposureIntent.direction})`,
          })
        }
      }
    }

    // Net Exposure Calculation (§9)
    const netExposure = this.computeNetExposure(decisions)

    // Redundancy detection (same direction, same type — maybe consolidate)
    if (!opposingDetected && decisions.length > 1) {
      const allSameDirection = decisions.every(
        (d) => d.exposureIntent.direction === decisions[0].exposureIntent.direction,
      )
      if (allSameDirection && decisions.length > 1) {
        // Check if consolidation is beneficial
        const totalExposure = decisions.reduce(
          (sum, d) => sum + d.exposureIntent.exposureFraction,
          0,
        )
        if (totalExposure > 0.5) {
          // High combined exposure — consolidate
          conflicts.push({
            decisionA: decisions[0].decisionId,
            decisionB: decisions[1].decisionId,
            conflictType: 'REDUNDANT',
            severity: 'LOW',
            description: `${decisions.length} same-direction decisions totaling ${(totalExposure * 100).toFixed(2)}% exposure`,
          })
        }
      }
    }

    // Recommended action
    let recommendedAction: ReconciliationType
    if (conflicts.length === 0) {
      recommendedAction = 'INDEPENDENT'
    } else if (opposingDetected) {
      // If opposing AND high priority differential → defer lower priority
      const priorities = new Set(decisions.map((d) => d.strategyMetadata.priority))
      if (priorities.size > 1) {
        recommendedAction = 'DEFERRED'
      } else {
        // Same priority — partially offset
        recommendedAction = 'PARTIALLY_OFFSET'
      }
    } else if (conflicts.some((c) => c.conflictType === 'REDUNDANT')) {
      recommendedAction = 'CONSOLIDATED'
    } else {
      recommendedAction = 'INDEPENDENT'
    }

    return {
      instrumentDecisions: decisions,
      opposingDetected,
      netExposureFraction: netExposure,
      conflicts,
      recommendedAction,
    }
  }

  /**
   * Apply reconciliation to a set of decisions (Rule 16, Rule 17).
   * Returns the reconciled decisions ready for publication.
   *
   * CRITICAL (Rule 17): Original decision logic is NEVER modified.
   * Only the published Decision Intent may be consolidated/offset/deferred.
   * Complete lineage is preserved (Rule 16).
   */
  reconcile(
    decisions: CanonicalStrategyDecision[],
    analysis: ConflictAnalysis,
    currentTime: number = Date.now(),
  ): CanonicalStrategyDecision[] {
    if (decisions.length === 0) return []

    switch (analysis.recommendedAction) {
      case 'INDEPENDENT':
        // §9 — publish all as-is. Add reconciliation lineage noting no conflicts.
        return decisions.map((d) => this.withIndependentLineage(d, currentTime))

      case 'CONSOLIDATED': {
        // §9 — merge into single decision (preserve lineage Rule 16)
        const consolidated = this.consolidate(decisions, currentTime)
        return consolidated ? [consolidated] : decisions.map((d) => this.withIndependentLineage(d, currentTime))
      }

      case 'PARTIALLY_OFFSET': {
        // §9 — net opposing exposure, publish reduced
        // Pick the higher-priority/higher-confidence decision and reduce its
        // exposure by the opposing decision's exposure.
        return this.partiallyOffset(decisions, analysis, currentTime)
      }

      case 'DEFERRED': {
        // §9 — defer lower-priority decisions
        const maxPriority = Math.max(...decisions.map((d) => d.strategyMetadata.priority))
        const published: CanonicalStrategyDecision[] = []
        const deferred: CanonicalStrategyDecision[] = []

        for (const d of decisions) {
          if (d.strategyMetadata.priority >= maxPriority) {
            published.push(this.withIndependentLineage(d, currentTime))
          } else {
            deferred.push(this.withDeferredLineage(d, decisions, currentTime))
          }
        }

        return [...published, ...deferred]
      }

      default:
        return decisions.map((d) => this.withIndependentLineage(d, currentTime))
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────────

  private areOpposing(a: CanonicalStrategyDecision, b: CanonicalStrategyDecision): boolean {
    const dirA = a.exposureIntent.direction
    const dirB = b.exposureIntent.direction
    return (
      (dirA === 'LONG' && dirB === 'SHORT') ||
      (dirA === 'SHORT' && dirB === 'LONG')
    )
  }

  private severityForOpposing(a: CanonicalStrategyDecision, b: CanonicalStrategyDecision): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const combinedExposure = a.exposureIntent.exposureFraction + b.exposureIntent.exposureFraction
    const combinedConfidence = Math.max(a.decisionConfidence, b.decisionConfidence)
    if (combinedExposure > 0.5 && combinedConfidence > 0.7) return 'CRITICAL'
    if (combinedExposure > 0.3) return 'HIGH'
    if (combinedConfidence > 0.5) return 'MEDIUM'
    return 'LOW'
  }

  private computeNetExposure(decisions: CanonicalStrategyDecision[]): number {
    return decisions.reduce((sum, d) => {
      const sign = d.exposureIntent.direction === 'LONG' ? 1 : d.exposureIntent.direction === 'SHORT' ? -1 : 0
      return sum + sign * d.exposureIntent.exposureFraction
    }, 0)
  }

  /**
   * Add reconciliation lineage to a decision published as-is (§9, Rule 16).
   * The original decision is unchanged — only the lineage metadata is added.
   */
  private withIndependentLineage(decision: CanonicalStrategyDecision, currentTime: number): CanonicalStrategyDecision {
    const lineage: ReconciliationLineage = {
      reconciliationId: `recon-ind-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      reconciliationType: 'INDEPENDENT',
      originalDecisionIds: [decision.decisionId],
      consolidatedAt: currentTime,
      reason: 'no conflicts — published as independent decision',
      netExposureFraction: decision.exposureIntent.exposureFraction,
      opposingDetected: false,
    }
    // Rule 17 — original decision logic unchanged. We return a new frozen
    // object with the reconciliation lineage attached (the original is already
    // frozen/immutable per Rule 5).
    return Object.freeze({
      ...decision,
      reconciliationLineage: lineage,
    }) as CanonicalStrategyDecision
  }

  /**
   * Consolidate multiple decisions into a single decision (§9, Rule 16, Rule 17).
   * The resulting decision preserves lineage to all originals.
   */
  private consolidate(decisions: CanonicalStrategyDecision[], currentTime: number): CanonicalStrategyDecision | null {
    if (decisions.length === 0) return null
    if (decisions.length === 1) return this.withIndependentLineage(decisions[0], currentTime)

    // Pick the highest-priority decision as the base
    const sorted = [...decisions].sort((a, b) => b.strategyMetadata.priority - a.strategyMetadata.priority)
    const base = sorted[0]

    // Combine exposure (sum, capped at 1.0)
    const totalExposure = Math.min(
      1.0,
      decisions.reduce((sum, d) => sum + d.exposureIntent.exposureFraction, 0),
    )

    // Aggregate confidence (weighted by priority)
    const totalPriority = decisions.reduce((sum, d) => sum + d.strategyMetadata.priority, 0)
    const weightedConfidence = decisions.reduce(
      (sum, d) => sum + d.decisionConfidence * d.strategyMetadata.priority,
      0,
    ) / Math.max(1, totalPriority)

    // Aggregate requested capital (sum)
    const totalCapital = decisions.reduce(
      (sum, d) => sum + (d.requestedCapital?.amount ?? 0),
      0,
    )

    const lineage: ReconciliationLineage = {
      reconciliationId: `recon-cons-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      reconciliationType: 'CONSOLIDATED',
      originalDecisionIds: decisions.map((d) => d.decisionId),
      consolidatedAt: currentTime,
      reason: `${decisions.length} same-direction decisions consolidated to minimize redundant exposure`,
      netExposureFraction: totalExposure,
      opposingDetected: false,
    }

    const consolidated: CanonicalStrategyDecision = Object.freeze({
      ...base,
      decisionId: `dec-cons-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      decisionConfidence: weightedConfidence,
      decisionStrength: Math.min(1.0, base.decisionStrength),
      exposureIntent: {
        ...base.exposureIntent,
        exposureFraction: totalExposure,
      },
      requestedCapital: totalCapital > 0
        ? {
            amount: totalCapital,
            requirement: base.requestedCapital?.requirement ?? 'SOFT',
            reason: `consolidated capital request from ${decisions.length} decisions`,
          }
        : null,
      decisionReason: `consolidated ${decisions.length} decisions [${decisions.map((d) => d.decisionId).join(', ')}]`,
      reconciliationLineage: lineage,
    }) as CanonicalStrategyDecision

    log.info(
      `consolidated ${decisions.length} decisions for instrument ${base.signalId} → ${consolidated.decisionId} (net exposure ${totalExposure.toFixed(3)})`,
    )

    return consolidated
  }

  /**
   * Partially offset opposing decisions (§9, Rule 16, Rule 17).
   * The higher-priority/higher-confidence decision is published with reduced
   * exposure (net of the opposing decision's exposure).
   * The lower-priority decision is recorded as "partially offset" — its lineage
   * is preserved but it's not published as an active decision.
   */
  private partiallyOffset(
    decisions: CanonicalStrategyDecision[],
    analysis: ConflictAnalysis,
    currentTime: number,
  ): CanonicalStrategyDecision[] {
    if (decisions.length < 2) return decisions.map((d) => this.withIndependentLineage(d, currentTime))

    // Sort by priority desc, then confidence desc
    const sorted = [...decisions].sort(
      (a, b) =>
        b.strategyMetadata.priority - a.strategyMetadata.priority ||
        b.decisionConfidence - a.decisionConfidence,
    )

    const published: CanonicalStrategyDecision[] = []
    let netExposure = analysis.netExposureFraction

    // Publish the dominant decision with reduced exposure (net of opposing)
    const dominant = sorted[0]
    const opposing = sorted.slice(1)

    const opposingExposure = opposing
      .filter((d) => d.exposureIntent.direction !== dominant.exposureIntent.direction)
      .reduce((sum, d) => sum + d.exposureIntent.exposureFraction, 0)

    const reducedExposure = Math.max(
      0,
      dominant.exposureIntent.exposureFraction - opposingExposure,
    )

    const dominantDirection = dominant.exposureIntent.direction
    const offsetLineage: ReconciliationLineage = {
      reconciliationId: `recon-offset-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      reconciliationType: 'PARTIALLY_OFFSET',
      originalDecisionIds: decisions.map((d) => d.decisionId),
      consolidatedAt: currentTime,
      reason: `opposing decisions partially offset (net exposure ${netExposure.toFixed(3)})`,
      netExposureFraction: netExposure,
      opposingDetected: true,
    }

    if (reducedExposure > 0) {
      // Publish the dominant decision with reduced exposure
      const offset: CanonicalStrategyDecision = Object.freeze({
        ...dominant,
        decisionId: `dec-offset-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        exposureIntent: {
          ...dominant.exposureIntent,
          exposureFraction: reducedExposure,
        },
        decisionReason: `partially offset by opposing decisions [${opposing.map((d) => d.decisionId).join(', ')}]`,
        reconciliationLineage: offsetLineage,
      }) as CanonicalStrategyDecision

      published.push(offset)
    }

    // The opposing decisions are recorded as "partially offset" — published as
    // NO_ACTION with full lineage preserved (Rule 16).
    for (const opp of opposing) {
      const offsetOppLineage: ReconciliationLineage = {
        reconciliationId: `recon-offset-opp-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        reconciliationType: 'PARTIALLY_OFFSET',
        originalDecisionIds: [opp.decisionId],
        consolidatedAt: currentTime,
        reason: `partially offset by dominant decision ${dominant.decisionId} (direction ${dominantDirection})`,
        netExposureFraction: 0,
        opposingDetected: true,
      }
      published.push(Object.freeze({
        ...opp,
        decisionType: 'NO_ACTION',
        exposureIntent: {
          ...opp.exposureIntent,
          exposureFraction: 0,
          direction: 'NEUTRAL',
        },
        decisionReason: `partially offset by dominant decision ${dominant.decisionId}`,
        reconciliationLineage: offsetOppLineage,
      }) as CanonicalStrategyDecision)
    }

    log.info(
      `partially offset ${decisions.length} opposing decisions → ${published.length} published (net ${netExposure.toFixed(3)})`,
    )

    return published
  }

  /**
   * Mark a decision as deferred (§9, Rule 16).
   * The decision is published but with NO_ACTION type, preserving full lineage.
   */
  private withDeferredLineage(
    decision: CanonicalStrategyDecision,
    allDecisions: CanonicalStrategyDecision[],
    currentTime: number,
  ): CanonicalStrategyDecision {
    const lineage: ReconciliationLineage = {
      reconciliationId: `recon-defer-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      reconciliationType: 'DEFERRED',
      originalDecisionIds: [decision.decisionId],
      consolidatedAt: currentTime,
      reason: `deferred due to higher-priority decisions [${allDecisions
        .filter((d) => d.decisionId !== decision.decisionId && d.strategyMetadata.priority > decision.strategyMetadata.priority)
        .map((d) => d.decisionId)
        .join(', ')}]`,
      netExposureFraction: 0,
      opposingDetected: true,
    }
    return Object.freeze({
      ...decision,
      decisionType: 'NO_ACTION',
      exposureIntent: {
        ...decision.exposureIntent,
        exposureFraction: 0,
        direction: 'NEUTRAL',
      },
      decisionReason: `deferred due to higher-priority opposing decisions`,
      reconciliationLineage: lineage,
    }) as CanonicalStrategyDecision
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton reconciler
// ─────────────────────────────────────────────────────────────────────────────

export const strategyReconciler = new StrategyReconciler()
