// CHAPTER 5.4 Rule 15, Rule 23 — Atomic Dependency Verification
//
// Rule 15 — Risk evaluation may support partial approval ONLY for allocations
//           that are mathematically INDEPENDENT.
//           Portfolio allocations belonging to an Atomic Dependency Group
//           (statistical arbitrage pairs, delta-neutral portfolios, option
//           hedges, spread trades, multi-leg strategies) shall be evaluated
//           ATOMICALLY.
//           If any mandatory component of an Atomic Dependency Group violates
//           a risk constraint, the ENTIRE dependency group shall be rejected
//           to preserve portfolio neutrality and prevent unintended directional
//           exposure.
//
// Rule 23 — Risk evaluation shall preserve atomic consistency across
//           mathematically linked portfolio allocations. Approval, rejection,
//           or modification of one allocation shall NEVER invalidate the risk
//           characteristics of dependent allocations.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPortfolioContract } from '../portfolio-construction/types'
import type {
  ApprovedAllocation,
  AtomicDependencyGroup,
  ConstraintViolation,
  RejectedAllocation,
} from './types'

const log = createLogger('decision-intelligence:risk-management:atomic')

// ─────────────────────────────────────────────────────────────────────────────
// AtomicDependencyVerifier
// ─────────────────────────────────────────────────────────────────────────────

export interface AtomicVerificationResult {
  /** All groups that passed (all members compliant). */
  passedGroups: string[]
  /** All groups that failed (at least one mandatory member violated). */
  failedGroups: string[]
  /** Allocations to reject because their atomic group failed (Rule 15). */
  allocationsToReject: Array<{
    symbol: string
    groupId: string
    reason: string
  }>
  /** Whether any atomic group failed. */
  hasAtomicFailures: boolean
}

export class AtomicDependencyVerifier {
  /**
   * Verify atomic dependency groups (Rule 15, Rule 23).
   * If any mandatory member of a group violates a risk constraint, the ENTIRE
   * group is rejected.
   */
  verify(
    portfolio: CanonicalPortfolioContract,
    atomicGroups: AtomicDependencyGroup[],
    violations: ConstraintViolation[],
    proposedApproved: ApprovedAllocation[],
    proposedRejected: RejectedAllocation[],
  ): AtomicVerificationResult {
    const passedGroups: string[] = []
    const failedGroups: string[] = []
    const allocationsToReject: Array<{ symbol: string; groupId: string; reason: string }> = []

    // Build a map of which symbols have violations
    const symbolsWithViolations = new Set<string>()
    for (const v of violations) {
      for (const sym of v.affectedSymbols) {
        symbolsWithViolations.add(sym)
      }
    }
    // Also include symbols already proposed for rejection
    for (const r of proposedRejected) {
      symbolsWithViolations.add(r.symbol)
    }

    for (const group of atomicGroups) {
      if (!group.atomic) continue

      // Check if any mandatory member has violations
      const violatedMembers = group.members.filter(
        (m) => m.mandatory && symbolsWithViolations.has(m.symbol),
      )

      if (violatedMembers.length > 0) {
        // Rule 15 — Entire group rejected
        failedGroups.push(group.groupId)
        for (const member of group.members) {
          allocationsToReject.push({
            symbol: member.symbol,
            groupId: group.groupId,
            reason: `atomic group ${group.groupId} (${group.groupType}) failed — member ${violatedMembers[0].symbol} violated risk constraint (Rule 15)`,
          })
        }
        log.warn(
          `atomic group ${group.groupId} (${group.groupType}) REJECTED — ${violatedMembers.length} mandatory members violated (Rule 15: entire group rejected)`,
        )
      } else {
        passedGroups.push(group.groupId)
        // Rule 23 — Verify that approving remaining members doesn't invalidate
        // the group's risk characteristics. Check that all members are either
        // all approved or all rejected.
        const approvedMembers = group.members.filter((m) =>
          proposedApproved.some((a) => a.symbol === m.symbol),
        )
        const rejectedMembers = group.members.filter((m) =>
          proposedRejected.some((r) => r.symbol === m.symbol),
        )

        if (approvedMembers.length > 0 && rejectedMembers.length > 0) {
          // Mixed state — would invalidate risk characteristics (Rule 23)
          // Reject all to maintain atomicity
          failedGroups.push(group.groupId)
          for (const member of group.members) {
            allocationsToReject.push({
              symbol: member.symbol,
              groupId: group.groupId,
              reason: `atomic group ${group.groupId} has mixed approval state (Rule 23: cannot approve some members while rejecting others)`,
            })
          }
          log.warn(
            `atomic group ${group.groupId} REJECTED — mixed approval state violates Rule 23`,
          )
        }
      }
    }

    return {
      passedGroups,
      failedGroups,
      allocationsToReject,
      hasAtomicFailures: failedGroups.length > 0,
    }
  }

  /**
   * Apply atomic verification results to approved/rejected lists (Rule 15, Rule 23).
   * Moves any atomic-group-rejected allocations from approved to rejected.
   */
  applyAtomicResults(
    approved: ApprovedAllocation[],
    rejected: RejectedAllocation[],
    atomicResult: AtomicVerificationResult,
  ): { approved: ApprovedAllocation[]; rejected: RejectedAllocation[] } {
    if (atomicResult.allocationsToReject.length === 0) {
      return { approved, rejected }
    }

    const symbolsToReject = new Set(atomicResult.allocationsToReject.map((a) => a.symbol))
    const newApproved: ApprovedAllocation[] = []
    const newRejected: RejectedAllocation[] = [...rejected]

    for (const alloc of approved) {
      if (symbolsToReject.has(alloc.symbol)) {
        // Move to rejected
        const atomicInfo = atomicResult.allocationsToReject.find((a) => a.symbol === alloc.symbol)
        newRejected.push({
          symbol: alloc.symbol,
          proposedWeight: alloc.proposedWeight,
          rejectionReason: atomicInfo?.reason ?? 'atomic group rejection',
          rejectionCategory: 'PORTFOLIO_RISK',
          severity: 'CRITICAL',
          atomicGroupRejection: true,
          atomicGroupId: atomicInfo?.groupId ?? null,
          violatedConstraint: 'ATOMIC_DEPENDENCY_INTEGRITY',
        })
        log.info(
          `allocation ${alloc.symbol} moved to rejected — atomic group ${atomicInfo?.groupId} (Rule 15)`,
        )
      } else {
        newApproved.push(alloc)
      }
    }

    return { approved: newApproved, rejected: newRejected }
  }

  /**
   * Check if a symbol belongs to any atomic dependency group.
   */
  getGroupForSymbol(symbol: string, atomicGroups: AtomicDependencyGroup[]): AtomicDependencyGroup | null {
    for (const group of atomicGroups) {
      if (group.members.some((m) => m.symbol === symbol)) {
        return group
      }
    }
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton verifier
// ─────────────────────────────────────────────────────────────────────────────

export const atomicDependencyVerifier = new AtomicDependencyVerifier()
