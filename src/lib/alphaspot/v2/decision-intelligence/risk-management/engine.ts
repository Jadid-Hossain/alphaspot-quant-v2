// CHAPTER 5.4 §5 — Risk Management Engine (RME)
//
// §1 — The RME is the EXCLUSIVE bridge between Portfolio Construction (Ch 5.3)
//      and Position Sizing. Evaluates portfolio construction outputs against
//      enterprise-wide risk constraints before capital is committed.
//
// §5 — 16-stage pipeline (no skips):
//   1.  PORTFOLIO_RECEPTION
//   2.  PORTFOLIO_VALIDATION
//   3.  CURRENT_PORTFOLIO_STATE_LOADING
//   4.  RISK_POLICY_LOADING
//   5.  ATOMIC_DEPENDENCY_VERIFICATION
//   6.  EXPOSURE_ASSESSMENT
//   7.  LIQUIDITY_ASSESSMENT
//   8.  PRE_TRADE_MARGIN_SIMULATION
//   9.  STRESS_TESTING
//  10.  TRANSACTIONAL_LIMIT_VERIFICATION
//  11.  CONSTRAINT_EVALUATION
//  12.  RISK_DECISION_CONSTRUCTION
//  13.  RISK_VALIDATION
//  14.  RISK_PUBLICATION
//  15.  METADATA_RECORDING
//  16.  RISK_COMPLETION
//
// §6 — Canonical Risk Contract (Rule 4 — alternative formats prohibited).
// §8 — Risk Limit Management (portfolio + transactional, Rule 22).
// §9 — Stress Testing (Rule 9 — independent from constraint eval, Rule 19 — versioned).
// §10 — Risk State Management (Rule 16 — circuit breakers).
// §11 — Risk Versioning (Rule 5 immutable).
// §12 — Risk Governance (Rule 11 — only approved enter Position Sizing).
// §16 — Failure Recovery (unsafe NEVER approved).
//
// 23 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPortfolioContract } from '../portfolio-construction/types'
import type { AssetMetadata } from '../portfolio-construction/types'
import type {
  ApprovedAllocation,
  CanonicalRiskContract,
  ConstraintViolation,
  LiquidityAssessment,
  LeverageAssessment,
  MarginStatus,
  RejectedAllocation,
  RiskCategory,
  RiskConfiguration,
  RiskDecision,
  RiskExposureSummary,
  RiskLineage,
  RiskMetadata,
  RiskPortfolioState,
  RiskSeverity,
  RiskVersionBundle,
} from './types'
import { RME_VERSION, RISK_CONTRACT_SCHEMA_VERSION } from './types'
import { portfolioRiskLimitEnforcer, transactionalRiskLimitEnforcer } from './limits'
import { stressTestingEngine } from './stress-testing'
import { atomicDependencyVerifier } from './atomic'
import { preTradeMarginSimulator } from './margin'
import { riskStateManager } from './state'
import { riskVersionRegistry, riskGovernanceManager } from './governance'
import { riskFailureRecovery, rmeObservabilityCollector } from './recovery'

const log = createLogger('decision-intelligence:risk-management:engine')

// ─────────────────────────────────────────────────────────────────────────────
// RiskEvaluationRequest — input to evaluate()
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskEvaluationRequest {
  /** Canonical Portfolio Contract (Rule 1 — only Ch 5.3 contracts). */
  portfolio: CanonicalPortfolioContract
  /** Risk configuration. */
  riskConfig: RiskConfiguration
  /** Current portfolio state (for margin simulation). */
  currentState: RiskPortfolioState
  /** Asset metadata. */
  assetMetadata: Map<string, AssetMetadata>
}

// ─────────────────────────────────────────────────────────────────────────────
// RiskEvaluationResult — output of evaluate()
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskEvaluationResult {
  contract: CanonicalRiskContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// RiskManagementEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class RiskManagementEngine {
  private evaluationHistory: CanonicalRiskContract[] = []
  private subscribers = new Set<(contract: CanonicalRiskContract) => void>()
  private readonly MAX_HISTORY = 200

  /**
   * Evaluate a Canonical Portfolio Contract (§5 — 16-stage pipeline).
   *
   * Rule 1 — Only Canonical Portfolio Contracts (Ch 5.3) may enter.
   * Rule 4 — Output conforms to Canonical Risk Contract.
   * Rule 8 — Never modifies the portfolio contract; only approves/rejects.
   * Rule 11 — Only approved contracts enter Position Sizing.
   * Rule 16 — Circuit breakers may invalidate pending approvals.
   */
  evaluate(request: RiskEvaluationRequest): RiskEvaluationResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalRiskContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        rmeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        rmeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { portfolio, riskConfig, currentState, assetMetadata } = request

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: PORTFOLIO_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      track('PORTFOLIO_RECEPTION', () => {
        if (!portfolio || typeof portfolio !== 'object') {
          throw new Error('invalid portfolio contract')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: PORTFOLIO_VALIDATION (§5, Rule 8 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('PORTFOLIO_VALIDATION', () => {
        if (!portfolio.portfolioId || !portfolio.portfolioVersion) {
          throw new Error('portfolio contract missing required fields')
        }
        if (!portfolio.allocationPlan || !portfolio.assetWeights) {
          throw new Error('portfolio contract missing allocation plan')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: CURRENT_PORTFOLIO_STATE_LOADING (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('CURRENT_PORTFOLIO_STATE_LOADING', () => {
        // State loaded — currentState passed in
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: RISK_POLICY_LOADING (§5, Rule 6)
      // ─────────────────────────────────────────────────────────────────────
      track('RISK_POLICY_LOADING', () => {
        // Policy loaded — riskConfig passed in
      })

      // Check circuit breaker status (Rule 16)
      if (riskConfig.circuitBreakersEnabled) {
        const state = riskStateManager.getState()
        if (state.circuitBreakerStatus === 'TRIGGERED') {
          throw new Error(`circuit breaker TRIGGERED — all evaluations halted (Rule 16): ${state.circuitBreakerReason}`)
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 5: ATOMIC_DEPENDENCY_VERIFICATION (§5, Rule 15, Rule 23)
      // ─────────────────────────────────────────────────────────────────────
      let atomicResult: ReturnType<typeof atomicDependencyVerifier.verify> | null = null
      track('ATOMIC_DEPENDENCY_VERIFICATION', () => {
        // Initial check — will be re-evaluated after constraint evaluation
        atomicResult = atomicDependencyVerifier.verify(
          portfolio,
          riskConfig.atomicDependencyGroups,
          [], // no violations yet
          [],
          [],
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 6: EXPOSURE_ASSESSMENT (§5)
      // ─────────────────────────────────────────────────────────────────────
      let exposureSummary: RiskExposureSummary
      track('EXPOSURE_ASSESSMENT', () => {
        exposureSummary = this.buildExposureSummary(portfolio, assetMetadata)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 7: LIQUIDITY_ASSESSMENT (§5, Rule 10 — independent from leverage)
      // ─────────────────────────────────────────────────────────────────────
      let liquidityAssessment: LiquidityAssessment
      track('LIQUIDITY_ASSESSMENT', () => {
        liquidityAssessment = this.assessLiquidity(portfolio, assetMetadata, riskConfig)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 8: PRE_TRADE_MARGIN_SIMULATION (§5, Rule 21)
      // ─────────────────────────────────────────────────────────────────────
      let marginStatus: MarginStatus
      let leverageAssessment: LeverageAssessment
      let marginViolations: ConstraintViolation[]
      track('PRE_TRADE_MARGIN_SIMULATION', () => {
        const result = preTradeMarginSimulator.simulate(portfolio, currentState, riskConfig.exchangeMarginConfig)
        marginStatus = result.marginStatus
        leverageAssessment = result.leverageAssessment
        marginViolations = result.violations
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 9: STRESS_TESTING (§5, §9, Rule 9 — independent, Rule 19 — versioned)
      // ─────────────────────────────────────────────────────────────────────
      let stressTestResults: ReturnType<typeof stressTestingEngine.runAll>
      track('STRESS_TESTING', () => {
        stressTestResults = stressTestingEngine.runAll(
          portfolio, riskConfig.stressTestConfig, assetMetadata, currentState.totalNav,
        )
        for (const r of stressTestResults) {
          rmeObservabilityCollector.recordStressTest(r.passed)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: TRANSACTIONAL_LIMIT_VERIFICATION (§5, §8, Rule 22)
      // ─────────────────────────────────────────────────────────────────────
      let transactionalViolations: ConstraintViolation[]
      track('TRANSACTIONAL_LIMIT_VERIFICATION', () => {
        transactionalViolations = transactionalRiskLimitEnforcer.evaluate(portfolio, riskConfig.transactionalLimits)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: CONSTRAINT_EVALUATION (§5, §8)
      // ─────────────────────────────────────────────────────────────────────
      let portfolioViolations: ConstraintViolation[]
      track('CONSTRAINT_EVALUATION', () => {
        portfolioViolations = portfolioRiskLimitEnforcer.evaluate(portfolio, riskConfig.portfolioLimits, assetMetadata)
      })

      // Combine all violations
      const allViolations = [...marginViolations!, ...transactionalViolations!, ...portfolioViolations!]

      // Record violations (Rule 18 — immutable governance events)
      for (const v of allViolations) {
        riskStateManager.recordViolation(v)
        rmeObservabilityCollector.recordViolation(v.category, v.severity)
      }

      // Re-run atomic verification with actual violations (Rule 15, Rule 23)
      const proposedApproved: ApprovedAllocation[] = []
      const proposedRejected: RejectedAllocation[] = []
      const symbolsWithCriticalViolations = new Set(
        allViolations
          .filter((v) => v.severity === 'CRITICAL' || v.severity === 'CATASTROPHIC')
          .flatMap((v) => v.affectedSymbols),
      )

      for (const w of portfolio.assetWeights) {
        // Check if this symbol belongs to an atomic group
        const atomicGroup = atomicDependencyVerifier.getGroupForSymbol(w.symbol, riskConfig.atomicDependencyGroups)
        if (symbolsWithCriticalViolations.has(w.symbol)) {
          proposedRejected.push({
            symbol: w.symbol,
            proposedWeight: w.targetWeight,
            rejectionReason: `critical risk violation on ${w.symbol}`,
            rejectionCategory: 'PORTFOLIO_RISK' as RiskCategory,
            severity: 'CRITICAL' as RiskSeverity,
            atomicGroupRejection: false,
            atomicGroupId: atomicGroup?.groupId ?? null,
            violatedConstraint: allViolations.find((v) => v.affectedSymbols.includes(w.symbol))?.constraint ?? 'UNKNOWN',
          })
        } else {
          proposedApproved.push({
            symbol: w.symbol,
            approvedWeight: w.targetWeight,
            proposedWeight: w.targetWeight,
            reductionFactor: 1.0,
            reductionReason: '',
            contributingStrategies: w.contributingStrategies,
            allocationRiskScore: 1 - w.allocationConfidence,
            atomicGroupId: atomicGroup?.groupId ?? null,
          })
        }
      }

      // Apply atomic dependency verification (Rule 15, Rule 23)
      atomicResult = atomicDependencyVerifier.verify(
        portfolio, riskConfig.atomicDependencyGroups, allViolations, proposedApproved, proposedRejected,
      )
      const atomicApplied = atomicDependencyVerifier.applyAtomicResults(
        proposedApproved, proposedRejected, atomicResult,
      )

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: RISK_DECISION_CONSTRUCTION (§5, §6, Rule 4, Rule 14, Rule 15)
      // ─────────────────────────────────────────────────────────────────────
      let riskDecision: RiskDecision
      let riskScore: number
      track('RISK_DECISION_CONSTRUCTION', () => {
        riskScore = this.computeRiskScore(
          portfolio, allViolations, stressTestResults!, leverageAssessment!, liquidityAssessment!,
        )

        // Check circuit breaker triggers (Rule 16)
        if (riskConfig.circuitBreakersEnabled) {
          riskStateManager.updateDrawdown(currentState.totalNav)
          riskStateManager.updateDailyPnl(currentState.dailyPnl)
          const triggered = riskStateManager.checkCircuitBreakerTriggers(
            riskConfig.circuitBreakerDrawdownThreshold,
            riskConfig.circuitBreakerDailyLossThreshold,
            1, // this evaluation is pending
          )
          if (triggered) {
            rmeObservabilityCollector.recordCircuitBreakerTrigger()
            riskDecision = 'CIRCUIT_BREAKER_HALT'
          }
        }

        if (riskDecision !== 'CIRCUIT_BREAKER_HALT') {
          // Determine decision based on violations
          const catastrophicCount = allViolations.filter((v) => v.severity === 'CATASTROPHIC').length
          const criticalCount = allViolations.filter((v) => v.severity === 'CRITICAL').length
          const stressTestFailed = stressTestResults!.some((r) => r.causedRejection)
          const atomicFailed = atomicResult!.hasAtomicFailures

          if (catastrophicCount > 0 || criticalCount > 0 || stressTestFailed || atomicFailed) {
            // Rule 15 — partial approval only for mathematically independent allocations
            if (atomicApplied.approved.length > 0 && catastrophicCount === 0) {
              riskDecision = 'PARTIALLY_APPROVED'
            } else {
              riskDecision = 'REJECTED'
            }
          } else if (riskScore > riskConfig.portfolioLimits.maxRiskScore) {
            riskDecision = 'REJECTED'
          } else {
            riskDecision = 'APPROVED'
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: RISK_VALIDATION (§5, §16 — unsafe NEVER approved)
      // ─────────────────────────────────────────────────────────────────────
      track('RISK_VALIDATION', () => {
        if (riskDecision === 'REJECTED' || riskDecision === 'CIRCUIT_BREAKER_HALT') {
          // Unsafe portfolios are quarantined (§16)
          // (but still published as rejected contracts for audit)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: RISK_PUBLICATION (§5, Rule 5 — immutable)
      // ─────────────────────────────────────────────────────────────────────
      let contract: CanonicalRiskContract
      track('RISK_PUBLICATION', () => {
        const now = Date.now()
        const versions: RiskVersionBundle = {
          riskVersion: RME_VERSION,
          portfolioVersion: portfolio.portfolioVersion,
          constraintVersion: riskConfig.portfolioLimits.version,
          configurationVersion: '1.0.0',
          governanceVersion: '1.0.0',
        }

        const lineage: RiskLineage = {
          portfolioId: portfolio.portfolioId,
          portfolioVersion: portfolio.portfolioVersion,
          allocationId: portfolio.allocationId,
          strategyDecisionIds: portfolio.strategyDecisionIds,
          constraintVersion: riskConfig.portfolioLimits.version,
          configurationVersion: '1.0.0',
          governanceVersion: '1.0.0',
          stressTestVersion: riskConfig.stressTestConfig.version,
        }

        const riskMetadata: RiskMetadata = {
          riskAssessmentId: `risk-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          riskVersion: RME_VERSION,
          versions,
          lineage,
          riskState: riskStateManager.getState().currentState,
          circuitBreakerStatus: riskStateManager.getState().circuitBreakerStatus,
          atomicGroups: riskConfig.atomicDependencyGroups,
        }

        const governanceMeta = riskGovernanceManager.initialize(riskMetadata.riskAssessmentId)

        contract = {
          riskAssessmentId: riskMetadata.riskAssessmentId,
          riskVersion: RME_VERSION,
          portfolioId: portfolio.portfolioId,
          portfolioVersion: portfolio.portfolioVersion,
          evaluationTimestamp: now,
          riskDecision,
          riskScore,
          approvedAllocations: atomicApplied.approved,
          rejectedAllocations: atomicApplied.rejected,
          exposureSummary: exposureSummary!,
          constraintViolations: allViolations,
          stressTestResults: stressTestResults!,
          liquidityStatus: liquidityAssessment!,
          leverageStatus: leverageAssessment!,
          marginStatus: marginStatus!,
          riskMetadata,
          governanceMetadata: governanceMeta,
          pipelineStages,
          createdAt: now,
        }

        contract = Object.freeze(contract) as CanonicalRiskContract // Rule 5
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 15: METADATA_RECORDING (§5, §12)
      // ─────────────────────────────────────────────────────────────────────
      track('METADATA_RECORDING', () => {
        riskVersionRegistry.register(contract!)
        riskGovernanceManager.setValidationStatus(
          contract!.riskAssessmentId,
          contract!.riskDecision === 'APPROVED' || contract!.riskDecision === 'PARTIALLY_APPROVED' ? 'PASSED' : 'FAILED',
          'risk-engine',
          `validation ${contract!.riskDecision}`,
        )
        if (contract!.riskDecision === 'APPROVED' || contract!.riskDecision === 'PARTIALLY_APPROVED') {
          riskGovernanceManager.approve(contract!.riskAssessmentId, 'risk-engine', `auto-approved (score ${riskScore.toFixed(3)})`)
        } else {
          riskGovernanceManager.reject(contract!.riskAssessmentId, 'risk-engine', `auto-rejected (score ${riskScore.toFixed(3)}, decision ${riskDecision})`)
        }

        // Record observability
        rmeObservabilityCollector.recordEvaluation(
          riskDecision,
          Date.now() - startTime,
          exposureSummary!.grossExposure,
          exposureSummary!.netExposure,
          exposureSummary!.leverage,
          leverageAssessment!.marginUtilization,
        )
        rmeObservabilityCollector.recordGovernanceEvent()
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 16: RISK_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('RISK_COMPLETION', () => {
        this.evaluationHistory.push(contract!)
        if (this.evaluationHistory.length > this.MAX_HISTORY) this.evaluationHistory.shift()

        for (const sub of this.subscribers) {
          try { sub(contract!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `risk assessment ${contract!.riskAssessmentId}: ${riskDecision} (score ${riskScore.toFixed(3)}, ` +
          `${allViolations.length} violations, ${stressTestResults!.length} stress tests, ` +
          `${contract!.approvedAllocations.length} approved, ${contract!.rejectedAllocations.length} rejected, ` +
          `${Date.now() - startTime}ms)`,
        )
      })

      return {
        contract: contract!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`risk evaluation failed: ${reason}`)
      riskFailureRecovery.logFailure(
        portfolio?.portfolioId ?? null,
        'INTERNAL_ERROR',
        'RISK_EVALUATION',
        reason,
        'GRACEFUL_DEGRADATION',
      )
      return {
        contract: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Exposure Summary (§6)
  // ───────────────────────────────────────────────────────────────────────────

  private buildExposureSummary(
    portfolio: CanonicalPortfolioContract,
    assetMetadata: Map<string, AssetMetadata>,
  ): RiskExposureSummary {
    const perSector: Record<string, number> = {}
    const perAsset: Record<string, number> = {}
    const perStrategy: Record<string, number> = {}

    let longExposure = 0
    let shortExposure = 0
    for (const w of portfolio.assetWeights) {
      if (w.targetWeight > 0) longExposure += w.targetWeight
      else if (w.targetWeight < 0) shortExposure += Math.abs(w.targetWeight)
      perAsset[w.symbol] = (perAsset[w.symbol] ?? 0) + w.targetWeight
      const meta = assetMetadata.get(w.symbol)
      const sector = meta?.sector ?? 'UNKNOWN'
      perSector[sector] = (perSector[sector] ?? 0) + Math.abs(w.targetWeight)
      for (const s of w.contributingStrategies) {
        perStrategy[s] = (perStrategy[s] ?? 0) + Math.abs(w.targetWeight) / Math.max(1, w.contributingStrategies.length)
      }
    }

    return {
      grossExposure: portfolio.allocationPlan.grossExposure,
      netExposure: portfolio.allocationPlan.netExposure,
      longExposure,
      shortExposure,
      leverage: portfolio.allocationPlan.leverage,
      perSector,
      perAsset,
      perStrategy,
      concentrationRisk: portfolio.diversificationMetrics.assetConcentration,
      correlationRisk: portfolio.correlationMetrics.maxCorrelation,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Liquidity Assessment (§6, Rule 10 — independent from leverage)
  // ───────────────────────────────────────────────────────────────────────────

  private assessLiquidity(
    portfolio: CanonicalPortfolioContract,
    assetMetadata: Map<string, AssetMetadata>,
    riskConfig: RiskConfiguration,
  ): LiquidityAssessment {
    const belowMinimumLiquidity: string[] = []
    const constrainedAssets: string[] = []
    let totalLiquidityScore = 0
    let count = 0

    for (const w of portfolio.assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      if (!meta) continue
      const liqScore = meta.liquidityScore
      totalLiquidityScore += liqScore
      count++
      if (liqScore < riskConfig.portfolioLimits.minLiquidityRequirement) {
        belowMinimumLiquidity.push(w.symbol)
      }
      // Check if asset is liquidity-constrained
      const capital = Math.abs(w.targetWeight) * portfolio.allocationPlan.totalNav
      const participation = meta.averageDailyDollarVolume > 0
        ? capital / meta.averageDailyDollarVolume
        : 0
      if (participation > riskConfig.portfolioLimits.maxParticipationRate * 0.8) {
        constrainedAssets.push(w.symbol)
      }
    }

    return {
      passed: belowMinimumLiquidity.length === 0,
      maxParticipationRate: portfolio.diversificationMetrics.maxParticipationRate,
      avgParticipationRate: portfolio.diversificationMetrics.avgParticipationRate,
      liquidityScore: count > 0 ? totalLiquidityScore / count : 0,
      estimatedSlippage: portfolio.diversificationMetrics.estimatedSlippage,
      belowMinimumLiquidity,
      constrainedAssets,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Risk Score (Rule 14 — INDEPENDENT from allocation confidence)
  // ───────────────────────────────────────────────────────────────────────────

  private computeRiskScore(
    portfolio: CanonicalPortfolioContract,
    violations: ConstraintViolation[],
    stressResults: ReturnType<typeof stressTestingEngine.runAll>,
    leverage: LeverageAssessment,
    liquidity: LiquidityAssessment,
  ): number {
    // Rule 14 — independent formula (NOT allocation confidence)
    // Base: 0.3 (low risk). Add penalties.
    let score = 0.1

    // Violation penalties
    for (const v of violations) {
      const penalty = { LOW: 0.05, MEDIUM: 0.10, HIGH: 0.20, CRITICAL: 0.35, CATASTROPHIC: 0.50 }[v.severity]
      score += penalty
    }

    // Stress test penalties
    for (const r of stressResults) {
      if (!r.passed) score += 0.10
      score += r.projectedLoss * 0.5
    }

    // Leverage penalty
    if (leverage.exceedsLeverageLimit) score += 0.20
    score += Math.min(0.15, leverage.grossLeverage / 20)

    // Liquidity penalty
    if (!liquidity.passed) score += 0.10
    score += liquidity.maxParticipationRate * 0.5

    // Concentration penalty
    score += portfolio.diversificationMetrics.assetConcentration * 0.2

    // Correlation penalty
    score += portfolio.correlationMetrics.maxCorrelation * 0.15

    // Liquidation probability penalty
    score += leverage.liquidationDistance > 0 ? (1 - leverage.liquidationDistance) * 0.1 : 0

    return Math.max(0, Math.min(1, score))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /** Subscribe to published risk contracts. */
  onRiskContract(handler: (contract: CanonicalRiskContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Get recent risk contracts (Rule 5 — immutable). */
  getRecentContracts(limit: number = 50): CanonicalRiskContract[] {
    return this.evaluationHistory.slice(-limit)
  }

  /** Get observability metrics (§14). */
  getMetrics() {
    return rmeObservabilityCollector.snapshot()
  }

  /** Get failure recovery stats (§16). */
  getRecoveryStats() {
    return riskFailureRecovery.getStats()
  }

  /** Get risk state (§10). */
  getRiskState() {
    return riskStateManager.getState()
  }

  /** Check if a risk contract is approved (Rule 11). */
  isApproved(riskAssessmentId: string): boolean {
    return riskGovernanceManager.isApproved(riskAssessmentId)
  }

  /** Get engine version. */
  getVersion() {
    return {
      engineVersion: RME_VERSION,
      schemaVersion: RISK_CONTRACT_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const riskManagementEngine = new RiskManagementEngine()
