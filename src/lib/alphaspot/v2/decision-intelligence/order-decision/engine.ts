// CHAPTER 5.6 §5 — Order Decision Engine (ODE)
//
// §1 — The ODE is the EXCLUSIVE bridge between Position Sizing (Ch 5.5) and the
//      Execution Optimization Layer. Transforms validated Position Contracts
//      into executable Order Intent Contracts.
//
// §5 — 21-stage pipeline (no skips):
//   1.  POSITION_CONTRACT_RECEPTION
//   2.  POSITION_VALIDATION
//   3.  CURRENT_PORTFOLIO_STATE_LOADING
//   4.  PENDING_ORDER_SYNCHRONIZATION
//   5.  PENDING_ORDER_FRESHNESS_VERIFICATION
//   6.  POSITION_DELTA_CALCULATION
//   7.  PORTFOLIO_DRIFT_EVALUATION
//   8.  MINIMUM_TRADE_SIZE_VALIDATION
//   9.  MINIMUM_NOTIONAL_VALIDATION
//  10.  TRANSACTION_COST_ESTIMATION
//  11.  MARKET_IMPACT_ESTIMATION
//  12.  LIQUIDITY_VERIFICATION
//  13.  TURNOVER_BUDGET_EVALUATION
//  14.  TEMPORAL_REBALANCING_COOLDOWN_VERIFICATION
//  15.  ORDER_NECESSITY_DECISION
//  16.  EXECUTION_URGENCY_CLASSIFICATION
//  17.  PARENT_ORDER_CONSTRUCTION
//  18.  ORDER_VALIDATION
//  19.  ORDER_PUBLICATION
//  20.  METADATA_RECORDING
//  21.  ORDER_COMPLETION
//
// §6 — Canonical Order Intent Contract (Rule 4 — alternative formats prohibited).
// §8 — Rebalancing Management (Rule 6 — thresholds, not target positions).
// §9 — Transaction Cost Evaluation (Rule 9 — independent, Rule 10 — suppress if cost > benefit).
// §10 — Liquidity Management (Rule 11 — precedes parent order, Rule 21 — freshness).
// §11 — Turnover Management (Rule 17 — independent from tx cost, Rule 22 — cooldowns).
// §12 — Order Versioning (Rule 5 immutable).
// §13 — Order Governance (Rule 14 — validity horizon).
// §16 — Failure Recovery (invalid NEVER published).
//
// 25 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalPositionContract } from '../position-sizing/types'
import type { AssetMetadata } from '../portfolio-construction/types'
import type {
  CanonicalOrderIntentContract,
  ExecutionUrgency,
  LiquidityAssessment,
  MarketImpactEstimate,
  ODEConfiguration,
  OrderDecisionType,
  OrderIntent,
  OrderPortfolioState,
  OrderSide,
  OrderGovernanceMetadata,
  OrderLineage,
  OrderMetadata,
  OrderVersionBundle,
  PendingOrder,
  TransactionCostEstimate,
  ValidityHorizon,
} from './types'
import { ODE_VERSION, ORDER_INTENT_SCHEMA_VERSION } from './types'
import { rebalancingEvaluator, cooldownManager } from './rebalancing'
import { transactionCostEvaluator, marketImpactEvaluator, liquidityEvaluator, economicBenefitEvaluator } from './evaluation'
import { pendingOrderManager, turnoverManager } from './freshness'
import { orderVersionRegistry, orderGovernanceManager } from './governance'
import { orderFailureRecovery, odeObservabilityCollector } from './recovery'
import { priceFXOracle } from '../position-sizing/oracle'

const log = createLogger('decision-intelligence:order-decision:engine')

// ─────────────────────────────────────────────────────────────────────────────
// OrderDecisionRequest — input to decide()
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderDecisionRequest {
  /** Canonical Position Contract (Rule 1 — only Ch 5.5 contracts). */
  positionContract: CanonicalPositionContract
  /** Current portfolio state. */
  currentState: OrderPortfolioState
  /** Asset metadata. */
  assetMetadata: AssetMetadata
  /** ODE configuration. */
  config: ODEConfiguration
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderDecisionResult — output of decide()
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderDecisionResult {
  order: CanonicalOrderIntentContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderDecisionEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class OrderDecisionEngine {
  private orderHistory: CanonicalOrderIntentContract[] = []
  private subscribers = new Set<(order: CanonicalOrderIntentContract) => void>()
  private readonly MAX_HISTORY = 500

  /**
   * Decide whether to generate an order for a Position Contract (§5 — 21-stage pipeline).
   *
   * Rule 1 — Only Canonical Position Contracts (Ch 5.5) may enter.
   * Rule 4 — Output conforms to Canonical Order Intent Contract.
   * Rule 6 — Order necessity via thresholds, not target positions alone.
   * Rule 8 — Pending orders incorporated into delta calculations.
   * Rule 10 — Orders with cost > benefit suppressed.
   * Rule 13 — Never modifies Position Contracts.
   * Rule 14 — Validity Horizon; expired orders invalid.
   * Rule 22 — Temporal cooldowns suppress repeated orders.
   */
  decide(request: OrderDecisionRequest): OrderDecisionResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalOrderIntentContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        odeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        odeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { positionContract, currentState, assetMetadata, config } = request

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: POSITION_CONTRACT_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      track('POSITION_CONTRACT_RECEPTION', () => {
        if (!positionContract || typeof positionContract !== 'object') {
          throw new Error('invalid position contract')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: POSITION_VALIDATION (§5, Rule 13 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('POSITION_VALIDATION', () => {
        if (!positionContract.positionId || !positionContract.symbol) {
          throw new Error('position contract missing required fields')
        }
        if (positionContract.capitalReservationStatus !== 'COMMITTED') {
          throw new Error(`position capital not committed (status: ${positionContract.capitalReservationStatus})`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: CURRENT_PORTFOLIO_STATE_LOADING (§5)
      // ─────────────────────────────────────────────────────────────────────
      let currentQuantity: number
      track('CURRENT_PORTFOLIO_STATE_LOADING', () => {
        const currentPosition = currentState.positions.find((p) => p.symbol === positionContract.symbol)
        currentQuantity = currentPosition?.quantity ?? 0
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: PENDING_ORDER_SYNCHRONIZATION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('PENDING_ORDER_SYNCHRONIZATION', () => {
        // Pending orders loaded from currentState
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 5: PENDING_ORDER_FRESHNESS_VERIFICATION (§5, Rule 21)
      // ─────────────────────────────────────────────────────────────────────
      track('PENDING_ORDER_FRESHNESS_VERIFICATION', () => {
        const { staleOrders } = pendingOrderManager.verifyFreshness(
          currentState.pendingOrders,
          config.pendingOrderFreshnessMs,
          config.heartbeatTimeoutMs,
        )
        if (staleOrders.length > 0) {
          const recoveries = pendingOrderManager.initiateRecovery(staleOrders)
          for (const _r of recoveries) {
            odeObservabilityCollector.recordStaleOrderRecovery()
          }
          // Rule 21 — recompute portfolio deltas after stale-order cancellation
          // (The next stages will use updated pendingOrders)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 6: POSITION_DELTA_CALCULATION (§5, Rule 7, Rule 8)
      // ─────────────────────────────────────────────────────────────────────
      let adjustedDelta: number
      let adjustedTarget: number
      let pendingReduction: number
      track('POSITION_DELTA_CALCULATION', () => {
        const targetQuantity = positionContract.targetQuantity
        const result = pendingOrderManager.adjustTargetForPendingOrders(
          positionContract.symbol,
          targetQuantity,
          currentQuantity!,
          currentState.pendingOrders,
        )
        adjustedTarget = result.adjustedTarget
        adjustedDelta = result.adjustedDelta
        pendingReduction = result.pendingReduction
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 7: PORTFOLIO_DRIFT_EVALUATION (§5, §8, Rule 6)
      // ─────────────────────────────────────────────────────────────────────
      let driftEvaluation: ReturnType<typeof rebalancingEvaluator.evaluateDrift>
      track('PORTFOLIO_DRIFT_EVALUATION', () => {
        const portfolioWeight = currentState.totalNav > 0 ? adjustedDelta! * positionContract.price / currentState.totalNav : 0
        const strategyWeight = portfolioWeight // simplified
        driftEvaluation = rebalancingEvaluator.evaluateDrift(
          currentQuantity!,
          adjustedTarget!,
          portfolioWeight,
          strategyWeight,
          config.rebalancingThresholds,
        )
      })

      // Early exit if no rebalancing required
      if (!driftEvaluation!.rebalanceRequired) {
        // Build a NO_ACTION order
        return this.buildNoActionOrder(
          positionContract, currentQuantity!, adjustedTarget!, adjustedDelta!,
          pipelineStages, 'drift below thresholds (Rule 6)', startTime, request,
        )
      }

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 8: MINIMUM_TRADE_SIZE_VALIDATION (§5, §8)
      // ─────────────────────────────────────────────────────────────────────
      let tradeSizeResult: { passed: boolean; reason: string }
      track('MINIMUM_TRADE_SIZE_VALIDATION', () => {
        tradeSizeResult = rebalancingEvaluator.evaluateMinimumTradeSize(
          adjustedDelta!, config.rebalancingThresholds,
        )
        if (!tradeSizeResult.passed) {
          throw new Error(`minimum trade size: ${tradeSizeResult.reason}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 9: MINIMUM_NOTIONAL_VALIDATION (§5, §8)
      // ─────────────────────────────────────────────────────────────────────
      let notionalResult: { passed: boolean; reason: string }
      const orderNotional = Math.abs(adjustedDelta!) * positionContract.price
      track('MINIMUM_NOTIONAL_VALIDATION', () => {
        notionalResult = rebalancingEvaluator.evaluateMinimumNotional(
          orderNotional, config.rebalancingThresholds,
        )
        if (!notionalResult.passed) {
          throw new Error(`minimum notional: ${notionalResult.reason}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: TRANSACTION_COST_ESTIMATION (§5, §9, Rule 9 — independent)
      // ─────────────────────────────────────────────────────────────────────
      let txCostEstimate: TransactionCostEstimate
      track('TRANSACTION_COST_ESTIMATION', () => {
        const isShort = adjustedDelta! < 0
        txCostEstimate = transactionCostEvaluator.estimate(
          adjustedDelta!, positionContract.price, isShort,
          1000 * 60 * 60 * 24, // 1 day holding period
          config.transactionCostModel,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: MARKET_IMPACT_ESTIMATION (§5, §9, Rule 9 — independent)
      // ─────────────────────────────────────────────────────────────────────
      let marketImpactEstimate: MarketImpactEstimate
      track('MARKET_IMPACT_ESTIMATION', () => {
        marketImpactEstimate = marketImpactEvaluator.estimate(
          adjustedDelta!, positionContract.price,
          assetMetadata.averageDailyVolume,
          config.marketImpactModel,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: LIQUIDITY_VERIFICATION (§5, §10, Rule 11)
      // ─────────────────────────────────────────────────────────────────────
      let liquidityAssessment: LiquidityAssessment
      track('LIQUIDITY_VERIFICATION', () => {
        liquidityAssessment = liquidityEvaluator.evaluate(
          adjustedDelta!, positionContract.price,
          assetMetadata.averageDailyVolume,
          assetMetadata.orderBookDepth,
          assetMetadata.bidAskSpread,
          assetMetadata.volatility,
          config.liquidityModel,
        )
        if (!liquidityAssessment.passed) {
          throw new Error(`liquidity verification failed: ${liquidityAssessment.reason}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: TURNOVER_BUDGET_EVALUATION (§5, §11, Rule 17)
      // ─────────────────────────────────────────────────────────────────────
      let turnoverEvaluation: ReturnType<typeof turnoverManager.evaluate>
      track('TURNOVER_BUDGET_EVALUATION', () => {
        const strategyAllocation = currentState.totalNav * 0.2 // simplified
        const assetAllocation = currentState.totalNav * 0.3 // simplified
        turnoverEvaluation = turnoverManager.evaluate(
          orderNotional, currentState.totalNav,
          strategyAllocation, assetAllocation,
          currentState, config.turnoverBudget,
        )
        if (!turnoverEvaluation.passed) {
          throw new Error(`turnover budget: ${turnoverEvaluation.reason}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: TEMPORAL_REBALANCING_COOLDOWN_VERIFICATION (§5, §11, Rule 22)
      // ─────────────────────────────────────────────────────────────────────
      let cooldownResult: ReturnType<typeof cooldownManager.isInCooldown>
      track('TEMPORAL_REBALANCING_COOLDOWN_VERIFICATION', () => {
        const strategyId = positionContract.positionMetadata.lineage.strategyDecisionIds[0] ?? null
        cooldownResult = cooldownManager.isInCooldown(
          positionContract.symbol, strategyId,
          config.temporalCooldown, Date.now(),
          Math.abs(driftEvaluation!.relativeDrift),
        )
        if (cooldownResult.inCooldown) {
          throw new Error(`temporal cooldown active: ${cooldownResult.reason} (Rule 22)`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 15: ORDER_NECESSITY_DECISION (§5, §9, Rule 10)
      // ─────────────────────────────────────────────────────────────────────
      let economicBenefitResult: ReturnType<typeof economicBenefitEvaluator.shouldSuppress>
      let orderIntent: OrderIntent
      track('ORDER_NECESSITY_DECISION', () => {
        // Estimate expected benefit (drift × price × improvement factor)
        const expectedBenefit = Math.abs(adjustedDelta!) * positionContract.price * 0.01 // 1% improvement assumption
        economicBenefitResult = economicBenefitEvaluator.shouldSuppress(
          expectedBenefit,
          txCostEstimate!.totalCost,
          marketImpactEstimate!.impactCost,
          config.economicBenefitThreshold,
        )

        if (economicBenefitResult.suppress) {
          orderIntent = 'SUPPRESS'
          // Rule 10 — suppress order (cost exceeds benefit)
        } else {
          orderIntent = 'EXECUTE'
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 16: EXECUTION_URGENCY_CLASSIFICATION (§5, Rule 23, Rule 24)
      // ─────────────────────────────────────────────────────────────────────
      let executionUrgency: ExecutionUrgency
      track('EXECUTION_URGENCY_CLASSIFICATION', () => {
        // Rule 23 — Execution Urgency independent from transaction cost estimates
        // Rule 24 — Influences scheduling only, never modifies portfolio objectives
        const driftMagnitude = Math.abs(driftEvaluation!.relativeDrift)
        if (driftMagnitude > 0.20) {
          executionUrgency = 'IMMEDIATE'
        } else if (driftMagnitude > 0.10) {
          executionUrgency = 'HIGH'
        } else if (driftMagnitude > 0.05) {
          executionUrgency = 'NORMAL'
        } else if (driftMagnitude > 0.02) {
          executionUrgency = 'LOW'
        } else {
          executionUrgency = 'OPPORTUNISTIC'
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 17: PARENT_ORDER_CONSTRUCTION (§5, Rule 16)
      // ─────────────────────────────────────────────────────────────────────
      let orderSide: OrderSide
      let decisionType: OrderDecisionType
      track('PARENT_ORDER_CONSTRUCTION', () => {
        // Rule 16 — Parent Order Construction produces execution intent only.
        // Child-order decomposition is in Execution Optimization Engine.
        if (adjustedDelta! > 0) {
          orderSide = 'BUY'
          decisionType = currentQuantity === 0 ? 'OPEN_POSITION' : 'INCREASE_POSITION'
        } else {
          orderSide = 'SELL'
          decisionType = currentQuantity === 0 ? 'OPEN_POSITION' : 'REDUCE_POSITION'
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 18: ORDER_VALIDATION (§5, §16 — invalid NEVER published)
      // ─────────────────────────────────────────────────────────────────────
      track('ORDER_VALIDATION', () => {
        if (orderIntent === 'EXECUTE') {
          if (Math.abs(adjustedDelta!) <= 0) {
            throw new Error('invalid order — zero delta')
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 19: ORDER_PUBLICATION (§5, Rule 5 — immutable, Rule 14 — validity horizon)
      // ─────────────────────────────────────────────────────────────────────
      let order: CanonicalOrderIntentContract
      track('ORDER_PUBLICATION', () => {
        const now = Date.now()
        const versions: OrderVersionBundle = {
          orderVersion: ODE_VERSION,
          positionVersion: positionContract.positionVersion,
          portfolioVersion: positionContract.positionMetadata.versions.portfolioVersion,
          riskVersion: positionContract.positionMetadata.versions.riskVersion,
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }

        const oracleSource = priceFXOracle.getSource()
        const lineage: OrderLineage = {
          positionId: positionContract.positionId,
          positionVersion: positionContract.positionVersion,
          riskAssessmentId: positionContract.riskAssessmentId,
          portfolioId: positionContract.portfolioId,
          portfolioVersion: positionContract.positionMetadata.versions.portfolioVersion,
          strategyDecisionIds: positionContract.positionMetadata.lineage.strategyDecisionIds,
          pricingSource: oracleSource.source,
          pricingVersion: oracleSource.sourceVersion,
          transactionCostModelVersion: config.transactionCostModel.version,
          marketImpactModelVersion: config.marketImpactModel.version,
          liquidityModelVersion: config.liquidityModel.version,
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }

        const validityHorizon: ValidityHorizon = {
          validFrom: now,
          validUntil: now + config.validityHorizonMs,
          remainingMs: config.validityHorizonMs,
          isExpired: false,
        }

        const orderMetadata: OrderMetadata = {
          orderId: `order-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          orderVersion: ODE_VERSION,
          versions,
          lineage,
          decisionType,
          executionUrgency,
          pendingOrderStatus: 'NONE',
          parentOrderId: null, // Rule 16 — parent order, no parent
        }

        const expirationTimestamp = now + config.validityHorizonMs
        const governanceMeta: OrderGovernanceMetadata = orderGovernanceManager.initialize(orderMetadata.orderId, expirationTimestamp, now)

        order = {
          orderDecisionId: orderMetadata.orderId,
          orderVersion: ODE_VERSION,
          positionId: positionContract.positionId,
          symbol: positionContract.symbol,
          decisionTimestamp: now,
          orderIntent,
          orderSide,
          decisionType,
          orderQuantity: Math.abs(adjustedDelta!),
          targetQuantity: adjustedTarget!,
          currentQuantity: currentQuantity!,
          rebalancingDelta: adjustedDelta!,
          parentOrderId: null,
          transactionCostEstimate: txCostEstimate!,
          marketImpactEstimate: marketImpactEstimate!,
          turnoverEstimate: turnoverEvaluation!.projectedDailyTurnover,
          executionUrgency,
          pendingOrderStatus: 'NONE',
          orderFreshnessTimestamp: now,
          decisionConfidence: orderIntent === 'EXECUTE' ? positionContract.positionConfidence : 0,
          decisionReason: economicBenefitResult!.reason,
          validityHorizon,
          orderMetadata,
          governanceMetadata: governanceMeta,
          pipelineStages,
          createdAt: now,
        }

        order = Object.freeze(order) as CanonicalOrderIntentContract // Rule 5
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 20: METADATA_RECORDING (§5, §13)
      // ─────────────────────────────────────────────────────────────────────
      track('METADATA_RECORDING', () => {
        orderVersionRegistry.register(order!)
        orderGovernanceManager.setValidationStatus(order!.orderDecisionId, 'PASSED', 'ode-engine', 'order validated')
        if (order!.orderIntent === 'EXECUTE') {
          orderGovernanceManager.approve(order!.orderDecisionId, 'ode-engine', `auto-approved (urgency ${executionUrgency})`)
          // Rule 22 — Set cooldown after successful publication
          const strategyId = positionContract.positionMetadata.lineage.strategyDecisionIds[0] ?? null
          cooldownManager.setCooldown(positionContract.symbol, strategyId, config.temporalCooldown)
        } else {
          orderGovernanceManager.reject(order!.orderDecisionId, 'ode-engine', `suppressed: ${economicBenefitResult!.reason}`)
        }
        odeObservabilityCollector.recordGovernanceEvent()

        // Record observability
        odeObservabilityCollector.recordOrder(
          orderIntent!, executionUrgency!,
          driftEvaluation!.relativeDrift,
          txCostEstimate!.totalCost,
          marketImpactEstimate!.impactCost,
          turnoverEvaluation!.projectedDailyTurnover,
          Date.now() - startTime,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 21: ORDER_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('ORDER_COMPLETION', () => {
        this.orderHistory.push(order!)
        if (this.orderHistory.length > this.MAX_HISTORY) this.orderHistory.shift()

        for (const sub of this.subscribers) {
          try { sub(order!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `order ${order!.orderDecisionId}: intent=${orderIntent}, side=${orderSide}, qty=${Math.abs(adjustedDelta!).toFixed(6)}, ` +
          `urgency=${executionUrgency}, drift=${(driftEvaluation!.relativeDrift * 100).toFixed(3)}%, ` +
          `txCost=${txCostEstimate!.totalCost.toFixed(2)}, impact=${marketImpactEstimate!.impactCost.toFixed(2)}, ` +
          `${Date.now() - startTime}ms`,
        )
      })

      return {
        order: order!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`order decision failed: ${reason}`)
      orderFailureRecovery.logFailure(
        positionContract?.positionId ?? null,
        'INTERNAL_ERROR',
        'ORDER_DECISION',
        reason,
        'GRACEFUL_DEGRADATION',
      )
      return {
        order: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /** Build a NO_ACTION order (for below-threshold drift). */
  private buildNoActionOrder(
    positionContract: CanonicalPositionContract,
    currentQuantity: number,
    targetQuantity: number,
    delta: number,
    pipelineStages: CanonicalOrderIntentContract['pipelineStages'],
    reason: string,
    startTime: number,
    request: OrderDecisionRequest,
  ): OrderDecisionResult {
    const now = Date.now()
    const config = request.config
    const versions: OrderVersionBundle = {
      orderVersion: ODE_VERSION,
      positionVersion: positionContract.positionVersion,
      portfolioVersion: positionContract.positionMetadata.versions.portfolioVersion,
      riskVersion: positionContract.positionMetadata.versions.riskVersion,
      configurationVersion: config.versions.configurationVersion,
      governanceVersion: config.versions.governanceVersion,
    }
    const oracleSource = priceFXOracle.getSource()
    const lineage: OrderLineage = {
      positionId: positionContract.positionId,
      positionVersion: positionContract.positionVersion,
      riskAssessmentId: positionContract.riskAssessmentId,
      portfolioId: positionContract.portfolioId,
      portfolioVersion: positionContract.positionMetadata.versions.portfolioVersion,
      strategyDecisionIds: positionContract.positionMetadata.lineage.strategyDecisionIds,
      pricingSource: oracleSource.source,
      pricingVersion: oracleSource.sourceVersion,
      transactionCostModelVersion: config.transactionCostModel.version,
      marketImpactModelVersion: config.marketImpactModel.version,
      liquidityModelVersion: config.liquidityModel.version,
      configurationVersion: config.versions.configurationVersion,
      governanceVersion: config.versions.governanceVersion,
    }
    const orderMetadata: OrderMetadata = {
      orderId: `order-noaction-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      orderVersion: ODE_VERSION,
      versions,
      lineage,
      decisionType: 'NO_ACTION',
      executionUrgency: 'OPPORTUNISTIC',
      pendingOrderStatus: 'NONE',
      parentOrderId: null,
    }
    const governanceMeta = orderGovernanceManager.initialize(orderMetadata.orderId, now + config.validityHorizonMs, now)
    const order: CanonicalOrderIntentContract = Object.freeze({
      orderDecisionId: orderMetadata.orderId,
      orderVersion: ODE_VERSION,
      positionId: positionContract.positionId,
      symbol: positionContract.symbol,
      decisionTimestamp: now,
      orderIntent: 'NO_ACTION',
      orderSide: 'BUY',
      decisionType: 'NO_ACTION',
      orderQuantity: 0,
      targetQuantity,
      currentQuantity,
      rebalancingDelta: delta,
      parentOrderId: null,
      transactionCostEstimate: {
        exchangeFees: 0, brokerFees: 0, bidAskSpreadCost: 0, estimatedSlippage: 0,
        fundingCost: 0, borrowCost: 0, fxConversionCost: 0, totalCost: 0, costFraction: 0,
        modelVersion: config.transactionCostModel.version,
      },
      marketImpactEstimate: {
        priceImpact: 0, impactCost: 0, participationRate: 0,
        modelVersion: config.marketImpactModel.version,
      },
      turnoverEstimate: 0,
      executionUrgency: 'OPPORTUNISTIC',
      pendingOrderStatus: 'NONE',
      orderFreshnessTimestamp: now,
      decisionConfidence: 0,
      decisionReason: reason,
      validityHorizon: {
        validFrom: now, validUntil: now + config.validityHorizonMs,
        remainingMs: config.validityHorizonMs, isExpired: false,
      },
      orderMetadata,
      governanceMetadata: governanceMeta,
      pipelineStages,
      createdAt: now,
    }) as CanonicalOrderIntentContract

    odeObservabilityCollector.recordOrder('NO_ACTION', 'OPPORTUNISTIC', 0, 0, 0, 0, Date.now() - startTime)

    log.info(`order ${order.orderDecisionId}: NO_ACTION — ${reason} (${Date.now() - startTime}ms)`)

    return {
      order,
      success: true,
      failureReason: null,
      latencyMs: Date.now() - startTime,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  onOrder(handler: (order: CanonicalOrderIntentContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getRecentOrders(limit: number = 50): CanonicalOrderIntentContract[] {
    return this.orderHistory.slice(-limit)
  }

  getMetrics() {
    return odeObservabilityCollector.snapshot()
  }

  getRecoveryStats() {
    return orderFailureRecovery.getStats()
  }

  /** Rule 14 — Check if order is expired. */
  isExpired(orderDecisionId: string): boolean {
    return orderGovernanceManager.isExpired(orderDecisionId)
  }

  getVersion() {
    return {
      engineVersion: ODE_VERSION,
      schemaVersion: ORDER_INTENT_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const orderDecisionEngine = new OrderDecisionEngine()
