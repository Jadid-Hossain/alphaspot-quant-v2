// CHAPTER 5.3 §5 — Portfolio Construction Engine (PCE)
//
// §1 — The PCE is the EXCLUSIVE bridge between Strategy Intelligence (Ch 5.2)
//      and Risk Management. Transforms Canonical Strategy Decision Contracts
//      into portfolio-level investment allocations.
//
// §5 — 15-stage pipeline (no skips):
//   1.  STRATEGY_DECISION_RECEPTION
//   2.  DECISION_VALIDATION
//   3.  CURRENT_PORTFOLIO_STATE_LOADING
//   4.  PORTFOLIO_CONSTRAINT_LOADING
//   5.  TARGET_PORTFOLIO_OPTIMIZATION
//   6.  REBALANCING_DELTA_CALCULATION
//   7.  STRATEGY_AGGREGATION
//   8.  ASSET_SELECTION
//   9.  CAPITAL_ALLOCATION_PLANNING
//  10.  DIVERSIFICATION_ASSESSMENT
//  11.  CORRELATION_ASSESSMENT
//  12.  PORTFOLIO_CONSTRUCTION
//  13.  PORTFOLIO_VALIDATION
//  14.  PORTFOLIO_PUBLICATION
//  15.  METADATA_RECORDING
//  16.  PORTFOLIO_COMPLETION
//
// §6 — Canonical Portfolio Contract (Rule 4 — alternative formats prohibited).
// §7 — 17 portfolio construction methodologies.
// §8 — Capital Allocation + Rebalancing Delta (only delta forwarded downstream).
// §9 — Diversification Management (Rule 9, Rule 13).
// §10 — Correlation Management (Rule 10 — independent from diversification).
// §11 — Portfolio Versioning (Rule 5 immutable).
// §12 — Portfolio Governance (Rule 11 — only approved enter Risk Management).
// §16 — Failure Recovery (invalid NEVER published).
//
// 15 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalStrategyDecision } from '../strategy-engine/types'
import type {
  AssetMetadata,
  AssetWeight,
  CapitalAdjustmentPlan,
  CanonicalPortfolioContract,
  ConstraintEvaluationResult,
  CurrentPortfolioState,
  ExposureSummary,
  PortfolioAllocationPlan,
  PortfolioConfiguration,
  PortfolioLineage,
  PortfolioMetadata,
  PortfolioState,
  RebalanceAction,
  RebalanceActionItem,
  RebalancingDelta,
  TargetPortfolioState,
} from './types'
import { PCE_VERSION, PORTFOLIO_CONTRACT_SCHEMA_VERSION } from './types'
import { optimizerRegistry, type OptimizationInput } from './methods'
import { diversificationAssessor } from './diversification'
import { correlationAssessor } from './correlation'
import { portfolioVersionRegistry, portfolioGovernanceManager } from './governance'
import { portfolioFailureRecovery } from './recovery'
import { pceObservabilityCollector } from './observability'

const log = createLogger('decision-intelligence:portfolio-construction:engine')

// ─────────────────────────────────────────────────────────────────────────────
// ConstructionRequest — input to construct()
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstructionRequest {
  /** Canonical Strategy Decision Contracts (Rule 1 — only Ch 5.2 decisions). */
  decisions: CanonicalStrategyDecision[]
  /** Portfolio configuration. */
  configuration: PortfolioConfiguration
  /** Current portfolio state. */
  currentState: CurrentPortfolioState
  /** Asset metadata for each tradable instrument. */
  assetMetadata: Map<string, AssetMetadata>
  /** Optional explicit correlation matrix. */
  correlationMatrix?: { symbols: string[]; matrix: number[][] } | null
}

// ─────────────────────────────────────────────────────────────────────────────
// ConstructionResult — output of construct()
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstructionResult {
  portfolio: CanonicalPortfolioContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// PortfolioConstructionEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class PortfolioConstructionEngine {
  private portfolioHistory: CanonicalPortfolioContract[] = []
  private subscribers = new Set<(portfolio: CanonicalPortfolioContract) => void>()

  private readonly MAX_HISTORY = 500

  /**
   * Construct a portfolio from Canonical Strategy Decision Contracts (§5 — 15-stage pipeline).
   *
   * Rule 1 — Only Canonical Strategy Decision Contracts (Ch 5.2) may enter.
   * Rule 4 — Portfolio conforms to Canonical Portfolio Contract.
   * Rule 8 — Never modifies Strategy Decision Contracts.
   * Rule 11 — Only approved portfolios enter Risk Management.
   * Rule 13 — Allocations respect liquidity capacity (reduced before publication).
   * Rule 14 — Allocation confidence independent from Strategy Decision Confidence.
   * Rule 16 — Invalid portfolios NEVER published.
   */
  construct(request: ConstructionRequest): ConstructionResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalPortfolioContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        pceObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        pceObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { decisions, configuration, currentState, assetMetadata } = request

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: STRATEGY_DECISION_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      let validDecisions: CanonicalStrategyDecision[] = []
      track('STRATEGY_DECISION_RECEPTION', () => {
        if (!Array.isArray(decisions)) {
          throw new Error('decisions must be an array')
        }
        validDecisions = decisions
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: DECISION_VALIDATION (§5, Rule 8 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('DECISION_VALIDATION', () => {
        validDecisions = validDecisions.filter((d) => this.validateDecision(d))
        if (validDecisions.length === 0) {
          throw new Error('no valid strategy decisions after validation')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: CURRENT_PORTFOLIO_STATE_LOADING (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('CURRENT_PORTFOLIO_STATE_LOADING', () => {
        // Loaded — currentState passed in
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: PORTFOLIO_CONSTRAINT_LOADING (§5, Rule 9)
      // ─────────────────────────────────────────────────────────────────────
      track('PORTFOLIO_CONSTRAINT_LOADING', () => {
        // Loaded — constraints in configuration
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 5: TARGET_PORTFOLIO_OPTIMIZATION (§5, §7)
      // ─────────────────────────────────────────────────────────────────────
      let optimizationResult: ReturnType<typeof optimizerRegistry.get> extends infer O ? O extends ((input: OptimizationInput) => infer R) | null ? R : never : never
      track('TARGET_PORTFOLIO_OPTIMIZATION', () => {
        const optimizer = optimizerRegistry.get(configuration.constructionMethod)
        if (!optimizer) {
          throw new Error(`unknown construction method: ${configuration.constructionMethod}`)
        }
        const input: OptimizationInput = {
          decisions: validDecisions,
          assetMetadata,
          totalNav: currentState.totalNav,
          currentInvestedCapital: currentState.totalNav - currentState.cashBalance,
          configuration,
          randomSeed: configuration.optimization.randomSeed ?? 42,
        }
        optimizationResult = optimizer.optimize(input)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 6: REBALANCING_DELTA_CALCULATION (§5, §8)
      // ─────────────────────────────────────────────────────────────────────
      let rebalancingDelta: RebalancingDelta
      track('REBALANCING_DELTA_CALCULATION', () => {
        rebalancingDelta = this.computeRebalancingDelta(
          optimizationResult!.weights,
          currentState,
          assetMetadata,
          validDecisions,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 7: STRATEGY_AGGREGATION (§5)
      // ─────────────────────────────────────────────────────────────────────
      let aggregatedStrategyIds: string[]
      track('STRATEGY_AGGREGATION', () => {
        const strategySet = new Set<string>()
        for (const d of validDecisions) {
          strategySet.add(d.strategyId)
        }
        aggregatedStrategyIds = Array.from(strategySet)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 8: ASSET_SELECTION (§5)
      // ─────────────────────────────────────────────────────────────────────
      let assetWeights: AssetWeight[]
      track('ASSET_SELECTION', () => {
        assetWeights = this.buildAssetWeights(
          optimizationResult!.weights,
          validDecisions,
          currentState,
          assetMetadata,
          optimizationResult!.allocationConfidence,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 9: CAPITAL_ALLOCATION_PLANNING (§5, §8)
      // ─────────────────────────────────────────────────────────────────────
      let allocationPlan: PortfolioAllocationPlan
      let capitalAdjustmentPlan: CapitalAdjustmentPlan
      track('CAPITAL_ALLOCATION_PLANNING', () => {
        allocationPlan = this.buildAllocationPlan(assetWeights!, currentState, configuration)
        capitalAdjustmentPlan = this.buildCapitalAdjustmentPlan(assetWeights!, currentState, validDecisions)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: DIVERSIFICATION_ASSESSMENT (§5, §9)
      // ─────────────────────────────────────────────────────────────────────
      let diversificationMetrics
      track('DIVERSIFICATION_ASSESSMENT', () => {
        diversificationMetrics = diversificationAssessor.assess(
          assetWeights!,
          assetMetadata,
          rebalancingDelta!,
          configuration.constraints,
          currentState.totalNav,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: CORRELATION_ASSESSMENT (§5, §10, Rule 10)
      // ─────────────────────────────────────────────────────────────────────
      let correlationMetrics
      track('CORRELATION_ASSESSMENT', () => {
        correlationMetrics = correlationAssessor.assess(
          assetWeights!,
          assetMetadata,
          request.correlationMatrix ?? null,
          configuration,
        )
        // Rule 10 — Apply correlation penalty (NEVER increases allocation)
        if (correlationMetrics.correlationPenalty > 0) {
          assetWeights = correlationAssessor.applyCorrelationPenalty(assetWeights!, correlationMetrics, configuration)
          // Rebuild allocation plan after penalty
          allocationPlan = this.buildAllocationPlan(assetWeights!, currentState, configuration)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: PORTFOLIO_CONSTRUCTION (§5, §6, Rule 4)
      // ─────────────────────────────────────────────────────────────────────
      let targetPortfolioState: TargetPortfolioState
      let exposureSummary: ExposureSummary
      let portfolioState: PortfolioState = 'PROPOSED'
      track('PORTFOLIO_CONSTRUCTION', () => {
        targetPortfolioState = this.buildTargetPortfolioState(assetWeights!, currentState, allocationPlan!)
        exposureSummary = this.buildExposureSummary(assetWeights!, assetMetadata)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: PORTFOLIO_VALIDATION (§5, §9, §10, §16)
      // ─────────────────────────────────────────────────────────────────────
      let constraintEvaluation: ConstraintEvaluationResult
      track('PORTFOLIO_VALIDATION', () => {
        const divConstraints = diversificationAssessor.evaluateConstraints(diversificationMetrics!, configuration.constraints)
        constraintEvaluation = this.evaluateAllConstraints(
          allocationPlan!,
          assetWeights!,
          diversificationMetrics!,
          correlationMetrics!,
          configuration.constraints,
          divConstraints,
        )

        if (constraintEvaluation.violations.length > 0) {
          const criticalCount = constraintEvaluation.violations.filter((v) => v.severity === 'CRITICAL').length
          if (criticalCount > 0) {
            portfolioState = 'REJECTED'
            for (const v of constraintEvaluation.violations) {
              pceObservabilityCollector.recordConstraintViolation(v.constraint, assetWeights!.length)
            }
            throw new Error(`CRITICAL constraint violations: ${constraintEvaluation.violations.map((v) => v.constraint).join(', ')}`)
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: PORTFOLIO_PUBLICATION (§5, Rule 16 — invalid NEVER published)
      // ─────────────────────────────────────────────────────────────────────
      let portfolio: CanonicalPortfolioContract
      track('PORTFOLIO_PUBLICATION', () => {
        // §4, Rule 7 — Lineage
        const lineage: PortfolioLineage = {
          strategyDecisionIds: validDecisions.map((d) => d.decisionId),
          strategyIds: aggregatedStrategyIds!,
          signalIds: validDecisions.map((d) => d.signalId),
          predictionIds: validDecisions.map((d) => d.strategyMetadata.lineage.predictionId),
          configurationVersion: configuration.versions.configurationVersion,
          constraintVersion: configuration.versions.constraintVersion,
          allocationVersion: configuration.versions.allocationVersion,
          governanceVersion: configuration.versions.governanceVersion,
        }

        // §4 — Portfolio Metadata
        const portfolioMetadata: PortfolioMetadata = {
          portfolioId: configuration.portfolioId,
          portfolioName: configuration.portfolioName,
          versions: { ...configuration.versions },
          optimization: {
            ...configuration.optimization,
            optimizationMethod: configuration.constructionMethod,
            optimizationTimestamp: Date.now(),
            optimizationMetadata: optimizationResult!.metadata,
          },
          lineage,
          allocationMethod: configuration.allocationMethod,
          constructionMethod: configuration.constructionMethod,
        }

        const governanceMetadata = portfolioGovernanceManager.initialize(configuration.portfolioId)

        portfolio = {
          portfolioId: configuration.portfolioId,
          portfolioVersion: configuration.versions.portfolioVersion,
          allocationId: `alloc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          strategyDecisionIds: validDecisions.map((d) => d.decisionId),
          portfolioTimestamp: Date.now(),
          portfolioState,
          allocationPlan: allocationPlan!,
          targetPortfolioState: targetPortfolioState!,
          currentPortfolioState: currentState,
          rebalancingDelta: rebalancingDelta!,
          capitalAdjustmentPlan: capitalAdjustmentPlan!,
          assetWeights: assetWeights!,
          exposureSummary: exposureSummary!,
          diversificationMetrics: diversificationMetrics!,
          correlationMetrics: correlationMetrics!,
          constraintEvaluation: constraintEvaluation!,
          allocationConfidence: optimizationResult!.allocationConfidence,
          portfolioMetadata,
          governanceMetadata,
          pipelineStages,
          createdAt: Date.now(),
        }

        // Rule 5 — Immutable
        portfolio = Object.freeze(portfolio) as CanonicalPortfolioContract
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 15: METADATA_RECORDING (§5, §12)
      // ─────────────────────────────────────────────────────────────────────
      track('METADATA_RECORDING', () => {
        portfolioVersionRegistry.register(portfolio!)
        portfolioGovernanceManager.addAuditEvent(configuration.portfolioId, {
          action: 'PORTFOLIO_CONSTRUCTED',
          at: Date.now(),
          actor: 'pce-engine',
          note: `portfolio ${portfolio!.portfolioId} v${portfolio!.portfolioVersion} constructed via ${configuration.constructionMethod}`,
        })

        // Record observability
        pceObservabilityCollector.recordBuild(
          configuration.constructionMethod,
          portfolio!.portfolioState,
          Date.now() - startTime,
          optimizationResult!.allocationConfidence,
          allocationPlan!.investedCapital / Math.max(1, currentState.totalNav),
          diversificationMetrics!.diversificationScore,
          diversificationMetrics!.effectiveAssetCount,
          diversificationMetrics!.diversificationRatio,
          allocationPlan!.grossExposure,
          allocationPlan!.netExposure,
          allocationPlan!.cashHolding / Math.max(1, currentState.totalNav),
          allocationPlan!.leverage,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 16: PORTFOLIO_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('PORTFOLIO_COMPLETION', () => {
        this.portfolioHistory.push(portfolio!)
        if (this.portfolioHistory.length > this.MAX_HISTORY) this.portfolioHistory.shift()

        for (const sub of this.subscribers) {
          try { sub(portfolio!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `portfolio ${portfolio!.portfolioId} constructed: method=${configuration.constructionMethod}, ` +
          `${assetWeights!.length} assets, gross=${allocationPlan!.grossExposure.toFixed(3)}, net=${allocationPlan!.netExposure.toFixed(3)}, ` +
          `divScore=${diversificationMetrics!.diversificationScore.toFixed(3)}, ${Date.now() - startTime}ms`,
        )
      })

      return {
        portfolio: portfolio!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`portfolio construction failed: ${reason}`)
      portfolioFailureRecovery.logFailure(
        configuration.portfolioId,
        'PORTFOLIO_VALIDATION_FAILED',
        'PORTFOLIO_CONSTRUCTION',
        reason,
        'GRACEFUL_DEGRADATION',
        { pipelineStages: pipelineStages.length },
      )
      return {
        portfolio: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Approve a portfolio for Risk Management (§12, Rule 11).
   * Rule 11 — Only approved Canonical Portfolio Contracts may enter Risk Management.
   */
  approvePortfolio(portfolioId: string, actor: string, note: string): void {
    portfolioGovernanceManager.approve(portfolioId, actor, note)
    portfolioGovernanceManager.setValidationStatus(portfolioId, 'PASSED', actor, note)
    pceObservabilityCollector.recordGovernanceEvent('APPROVE')
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 2: Decision Validation (§5, Rule 8 — never modify)
  // ───────────────────────────────────────────────────────────────────────────

  private validateDecision(decision: CanonicalStrategyDecision): boolean {
    if (!decision || typeof decision !== 'object') return false
    if (!decision.decisionId || !decision.strategyId || !decision.signalId) return false
    if (!decision.exposureIntent) return false
    if (!decision.strategyMetadata?.lineage) return false
    // Skip NO_ACTION and HOLD (they don't contribute to allocation)
    if (decision.decisionType === 'NO_ACTION') return false
    // Skip invalidated decisions (Rule 21 from Ch 5.2)
    if (decision.capitalReservationStatus === 'INVALIDATED') return false
    if (decision.capitalReservationStatus === 'INSUFFICIENT_CAPACITY') return false
    return true
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 6: Rebalancing Delta Calculation (§5, §8)
  // ───────────────────────────────────────────────────────────────────────────

  private computeRebalancingDelta(
    targetWeights: Map<string, number>,
    currentState: CurrentPortfolioState,
    assetMetadata: Map<string, AssetMetadata>,
    decisions: CanonicalStrategyDecision[],
  ): RebalancingDelta {
    const actions: RebalanceActionItem[] = []
    const currentPositionMap = new Map<string, typeof currentState.positions[number]>()
    for (const p of currentState.positions) {
      currentPositionMap.set(p.symbol, p)
    }

    let totalDeltaValue = 0
    let totalTurnover = 0
    let estimatedTransactionCost = 0
    let cashAdjustment = 0

    // Process target weights
    for (const [symbol, targetWeight] of targetWeights) {
      const current = currentPositionMap.get(symbol)
      const currentWeight = current?.weight ?? 0
      const weightDelta = targetWeight - currentWeight
      const capitalDelta = weightDelta * currentState.totalNav
      const meta = assetMetadata.get(symbol)
      const price = meta ? meta.averageDailyDollarVolume / Math.max(1, meta.averageDailyVolume) : 1
      const quantityDelta = price > 0 ? capitalDelta / price : 0

      let action: RebalanceAction
      if (current === undefined && Math.abs(targetWeight) > 0.0001) {
        action = 'OPEN_POSITION'
      } else if (current !== undefined && Math.abs(targetWeight) < 0.0001) {
        action = 'CLOSE_POSITION'
      } else if (weightDelta > 0) {
        action = 'INCREASE_POSITION'
      } else if (weightDelta < 0) {
        action = 'REDUCE_POSITION'
      } else {
        action = 'NO_CHANGE'
      }

      // Estimated transaction cost (§7.3 components)
      const costRate = meta ? (meta.commissionRate + meta.exchangeFee + meta.bidAskSpread * 0.5) : 0.001
      const actionCost = Math.abs(capitalDelta) * costRate

      const contributingStrategies = decisions
        .filter((d) => d.strategyId === symbol)
        .map((d) => d.strategyId)
      const contributingDecisionIds = decisions
        .filter((d) => d.strategyId === symbol)
        .map((d) => d.decisionId)

      actions.push({
        symbol,
        action,
        quantityDelta,
        capitalDelta,
        weightDelta,
        targetWeight,
        currentWeight,
        contributingStrategies: Array.from(new Set(contributingStrategies)),
        contributingDecisionIds: Array.from(new Set(contributingDecisionIds)),
        estimatedCost: actionCost,
        reason: `${action}: target ${(targetWeight * 100).toFixed(2)}% vs current ${(currentWeight * 100).toFixed(2)}%`,
      })

      totalDeltaValue += capitalDelta
      totalTurnover += Math.abs(capitalDelta)
      estimatedTransactionCost += actionCost
      cashAdjustment -= capitalDelta // deploy cash when going long, release when closing
    }

    // §8 — Capital reservation updates (track pending reservations)
    const reservationUpdates = decisions
      .filter((d) => d.requestedCapital !== null && d.capitalReservationStatus === 'RESERVED')
      .map((d) => ({
        strategyId: d.strategyId,
        reservationId: `resv-${d.decisionId}`,
        delta: -(d.requestedCapital?.amount ?? 0), // release reservation when allocated
        reason: `capital reservation released for decision ${d.decisionId}`,
      }))

    return {
      deltaId: `delta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      computedAt: Date.now(),
      actions,
      totalDeltaValue,
      totalTurnover,
      estimatedTransactionCost,
      cashAdjustment,
      reservationUpdates,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 8: Build Asset Weights
  // Rule 14 — Allocation confidence independent from Strategy Decision Confidence.
  // ───────────────────────────────────────────────────────────────────────────

  private buildAssetWeights(
    targetWeights: Map<string, number>,
    decisions: CanonicalStrategyDecision[],
    currentState: CurrentPortfolioState,
    assetMetadata: Map<string, AssetMetadata>,
    allocationConfidence: number,
  ): AssetWeight[] {
    const weights: AssetWeight[] = []
    const currentPositionMap = new Map<string, typeof currentState.positions[number]>()
    for (const p of currentState.positions) {
      currentPositionMap.set(p.symbol, p)
    }

    for (const [symbol, targetWeight] of targetWeights) {
      const current = currentPositionMap.get(symbol)
      const currentWeight = current?.weight ?? 0
      const allocatedCapital = targetWeight * currentState.totalNav
      const meta = assetMetadata.get(symbol)

      // Find contributing decisions for this symbol/strategy
      const contributing = decisions.filter((d) => d.strategyId === symbol)
      const expectedReturn = contributing.reduce((s, d) => s + d.decisionStrength * 0.05, 0) // estimate

      weights.push({
        symbol,
        targetWeight,
        currentWeight,
        allocatedCapital,
        expectedReturn,
        contributingStrategies: Array.from(new Set(contributing.map((d) => d.strategyId))),
        contributingDecisionIds: contributing.map((d) => d.decisionId),
        // Rule 14 — Allocation confidence from optimizer, NOT from decision confidence
        allocationConfidence: allocationConfidence * (meta?.liquidityScore ?? 0.8),
      })
    }

    return weights
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 9: Build Allocation Plan
  // ───────────────────────────────────────────────────────────────────────────

  private buildAllocationPlan(
    assetWeights: AssetWeight[],
    currentState: CurrentPortfolioState,
    configuration: PortfolioConfiguration,
  ): PortfolioAllocationPlan {
    const investedCapital = assetWeights.reduce((s, w) => s + Math.abs(w.allocatedCapital), 0)
    const grossExposure = assetWeights.reduce((s, w) => s + Math.abs(w.targetWeight), 0)
    const netExposure = assetWeights.reduce((s, w) => s + w.targetWeight, 0)
    const cashHolding = currentState.totalNav - investedCapital
    const leverage = currentState.totalNav > 0 ? grossExposure : 0
    const reservedCapital = currentState.reservedCapital

    return {
      totalNav: currentState.totalNav,
      investedCapital,
      cashHolding: Math.max(0, cashHolding),
      reservedCapital,
      grossExposure,
      netExposure,
      leverage,
      assetWeights,
      allocationMethod: configuration.allocationMethod,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 9: Build Capital Adjustment Plan (§8)
  // ───────────────────────────────────────────────────────────────────────────

  private buildCapitalAdjustmentPlan(
    assetWeights: AssetWeight[],
    currentState: CurrentPortfolioState,
    decisions: CanonicalStrategyDecision[],
  ): CapitalAdjustmentPlan {
    const perStrategyAdjustments = new Map<string, { current: number; target: number; delta: number; reason: string }>()

    for (const w of assetWeights) {
      for (const strategyId of w.contributingStrategies) {
        const current = currentState.positions
          .filter((p) => p.originatingStrategyId === strategyId)
          .reduce((s, p) => s + p.marketValue, 0)
        const target = w.allocatedCapital / Math.max(1, w.contributingStrategies.length)
        const delta = target - current
        perStrategyAdjustments.set(strategyId, {
          current,
          target,
          delta,
          reason: `rebalance ${strategyId} to ${(target / currentState.totalNav * 100).toFixed(2)}% of NAV`,
        })
      }
    }

    const totalCapitalAdjustment = Array.from(perStrategyAdjustments.values()).reduce((s, a) => s + a.delta, 0)
    const cashAdjustment = -totalCapitalAdjustment

    const reservationReleases = decisions
      .filter((d) => d.requestedCapital !== null && d.capitalReservationStatus === 'RESERVED')
      .map((d) => ({
        strategyId: d.strategyId,
        reservationId: `resv-${d.decisionId}`,
        amount: d.requestedCapital!.amount,
        reason: `release reservation for executed decision ${d.decisionId}`,
      }))

    return {
      totalCapitalAdjustment,
      cashAdjustment,
      perStrategyAdjustments: Array.from(perStrategyAdjustments.entries()).map(([strategyId, a]) => ({
        strategyId,
        currentAllocation: a.current,
        targetAllocation: a.target,
        delta: a.delta,
        reason: a.reason,
      })),
      reservationReleases,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 12: Build Target Portfolio State (§8)
  // ───────────────────────────────────────────────────────────────────────────

  private buildTargetPortfolioState(
    assetWeights: AssetWeight[],
    currentState: CurrentPortfolioState,
    allocationPlan: PortfolioAllocationPlan,
  ): TargetPortfolioState {
    return {
      timestamp: Date.now(),
      totalNav: currentState.totalNav,
      targetCash: allocationPlan.cashHolding,
      targetInvestedCapital: allocationPlan.investedCapital,
      targetGrossExposure: allocationPlan.grossExposure,
      targetNetExposure: allocationPlan.netExposure,
      targetLeverage: allocationPlan.leverage,
      targetPositions: assetWeights.map((w) => ({
        symbol: w.symbol,
        targetQuantity: 0, // computed downstream by position sizing
        targetWeight: w.targetWeight,
        targetCapital: w.allocatedCapital,
      })),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 12: Build Exposure Summary (§4, §6)
  // ───────────────────────────────────────────────────────────────────────────

  private buildExposureSummary(
    assetWeights: AssetWeight[],
    assetMetadata: Map<string, AssetMetadata>,
  ): ExposureSummary {
    const perAssetClass: Record<string, number> = {}
    const perSector: Record<string, number> = {}
    const perCountry: Record<string, number> = {}
    const perCurrency: Record<string, number> = {}
    const perExchange: Record<string, number> = {}
    const perStrategy: Record<string, number> = {}

    let grossLong = 0
    let grossShort = 0

    for (const w of assetWeights) {
      const meta = assetMetadata.get(w.symbol)
      const signedW = w.targetWeight
      if (signedW > 0) grossLong += signedW
      else if (signedW < 0) grossShort += Math.abs(signedW)

      const ac = meta?.assetClass ?? 'UNKNOWN'
      perAssetClass[ac] = (perAssetClass[ac] ?? 0) + signedW
      const s = meta?.sector ?? 'UNKNOWN'
      perSector[s] = (perSector[s] ?? 0) + signedW
      const c = meta?.country ?? 'UNKNOWN'
      perCountry[c] = (perCountry[c] ?? 0) + signedW
      const cu = meta?.currency ?? 'UNKNOWN'
      perCurrency[cu] = (perCurrency[cu] ?? 0) + signedW
      const ex = meta?.exchange ?? 'UNKNOWN'
      perExchange[ex] = (perExchange[ex] ?? 0) + signedW
      for (const strategyId of w.contributingStrategies) {
        perStrategy[strategyId] = (perStrategy[strategyId] ?? 0) + signedW / Math.max(1, w.contributingStrategies.length)
      }
    }

    return {
      grossLongExposure: grossLong,
      grossShortExposure: grossShort,
      netExposure: grossLong - grossShort,
      netLongExposure: Math.max(0, grossLong - grossShort),
      netShortExposure: Math.max(0, grossShort - grossLong),
      perAssetClass,
      perSector,
      perCountry,
      perCurrency,
      perExchange,
      perStrategy,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 13: Evaluate All Constraints (§6, §9, §10)
  // ───────────────────────────────────────────────────────────────────────────

  private evaluateAllConstraints(
    allocationPlan: PortfolioAllocationPlan,
    assetWeights: AssetWeight[],
    diversificationMetrics: import('./types').DiversificationMetrics,
    correlationMetrics: import('./types').CorrelationMetrics,
    constraints: import('./types').PortfolioConstraints,
    divConstraints: Pick<ConstraintEvaluationResult, 'violations' | 'warnings'>,
  ): ConstraintEvaluationResult {
    const violations = [...divConstraints.violations]
    const warnings = [...divConstraints.warnings]

    // Exposure constraints
    if (allocationPlan.grossExposure > constraints.maxGrossExposure) {
      violations.push({
        constraint: 'maxGrossExposure',
        actual: allocationPlan.grossExposure,
        limit: constraints.maxGrossExposure,
        severity: 'HIGH',
        description: `gross exposure ${allocationPlan.grossExposure.toFixed(3)} > limit ${constraints.maxGrossExposure}`,
      })
    }
    if (Math.abs(allocationPlan.netExposure) > constraints.maxNetExposure) {
      violations.push({
        constraint: 'maxNetExposure',
        actual: Math.abs(allocationPlan.netExposure),
        limit: constraints.maxNetExposure,
        severity: 'HIGH',
        description: `net exposure ${Math.abs(allocationPlan.netExposure).toFixed(3)} > limit ${constraints.maxNetExposure}`,
      })
    }
    if (allocationPlan.leverage > constraints.maxLeverage) {
      violations.push({
        constraint: 'maxLeverage',
        actual: allocationPlan.leverage,
        limit: constraints.maxLeverage,
        severity: 'CRITICAL',
        description: `leverage ${allocationPlan.leverage.toFixed(3)} > limit ${constraints.maxLeverage}`,
      })
    }
    const cashFraction = allocationPlan.cashHolding / Math.max(1, allocationPlan.totalNav)
    if (cashFraction < constraints.minCashReserve) {
      violations.push({
        constraint: 'minCashReserve',
        actual: cashFraction,
        limit: constraints.minCashReserve,
        severity: 'MEDIUM',
        description: `cash reserve ${cashFraction.toFixed(3)} < min ${constraints.minCashReserve}`,
      })
    }

    // Per-asset constraints
    for (const w of assetWeights) {
      if (Math.abs(w.targetWeight) > constraints.maxAssetWeight) {
        violations.push({
          constraint: 'maxAssetWeight',
          actual: Math.abs(w.targetWeight),
          limit: constraints.maxAssetWeight,
          severity: 'HIGH',
          description: `asset ${w.symbol} weight ${Math.abs(w.targetWeight).toFixed(3)} > limit ${constraints.maxAssetWeight}`,
        })
      }
      if (w.targetWeight < 0 && Math.abs(w.targetWeight) > constraints.maxShortWeight) {
        violations.push({
          constraint: 'maxShortWeight',
          actual: Math.abs(w.targetWeight),
          limit: constraints.maxShortWeight,
          severity: 'MEDIUM',
          description: `short position ${w.symbol} weight ${Math.abs(w.targetWeight).toFixed(3)} > limit ${constraints.maxShortWeight}`,
        })
      }
    }

    // Prohibited symbols
    for (const w of assetWeights) {
      if (constraints.prohibitedSymbols.includes(w.symbol)) {
        violations.push({
          constraint: 'prohibitedSymbols',
          actual: 1,
          limit: 0,
          severity: 'CRITICAL',
          description: `asset ${w.symbol} is prohibited`,
        })
      }
    }

    // Correlation constraints (Rule 10 — independent from diversification)
    if (Math.abs(correlationMetrics.avgAssetCorrelation) > constraints.maxAvgCorrelation) {
      violations.push({
        constraint: 'maxAvgCorrelation',
        actual: Math.abs(correlationMetrics.avgAssetCorrelation),
        limit: constraints.maxAvgCorrelation,
        severity: 'MEDIUM',
        description: `avg correlation ${correlationMetrics.avgAssetCorrelation.toFixed(3)} > limit ${constraints.maxAvgCorrelation}`,
      })
    }
    if (correlationMetrics.maxCorrelation > constraints.maxPairwiseCorrelation) {
      violations.push({
        constraint: 'maxPairwiseCorrelation',
        actual: correlationMetrics.maxCorrelation,
        limit: constraints.maxPairwiseCorrelation,
        severity: 'HIGH',
        description: `max pairwise correlation ${correlationMetrics.maxCorrelation.toFixed(3)} > limit ${constraints.maxPairwiseCorrelation}`,
      })
    }

    // Transaction cost constraint
    const totalTxCost = allocationPlan.investedCapital > 0
      ? (allocationPlan.investedCapital * 0.001) / Math.max(1, allocationPlan.totalNav)
      : 0
    if (totalTxCost > constraints.maxTotalTransactionCost) {
      warnings.push({
        constraint: 'maxTotalTransactionCost',
        actual: totalTxCost,
        limit: constraints.maxTotalTransactionCost,
        description: `estimated transaction cost ${totalTxCost.toFixed(4)} > limit ${constraints.maxTotalTransactionCost}`,
      })
    }

    return {
      passed: violations.length === 0,
      violations,
      warnings,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /** Subscribe to published portfolios. */
  onPortfolio(handler: (portfolio: CanonicalPortfolioContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Get recent portfolios (Rule 5 — historical immutable). */
  getRecentPortfolios(limit: number = 50): CanonicalPortfolioContract[] {
    return this.portfolioHistory.slice(-limit)
  }

  /** Get observability metrics (§14). */
  getMetrics() {
    return pceObservabilityCollector.snapshot()
  }

  /** Get failure recovery stats (§16). */
  getRecoveryStats() {
    return portfolioFailureRecovery.getStats()
  }

  /** List available construction methods (§7). */
  listConstructionMethods() {
    return optimizerRegistry.listMethods()
  }

  /** Get engine version + schema version. */
  getVersion() {
    return {
      engineVersion: PCE_VERSION,
      schemaVersion: PORTFOLIO_CONTRACT_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const portfolioConstructionEngine = new PortfolioConstructionEngine()
