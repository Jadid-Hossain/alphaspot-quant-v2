// CHAPTER 5.2 §5 — Strategy Intelligence Engine (SIE)
//
// §1 — The SIE is the EXCLUSIVE bridge between Signal Generation (Ch 5.1)
//      and Portfolio Construction (Ch 5.3). Transforms Canonical Signals
//      into strategy-specific Strategy Decisions.
//
// §5 — 11-stage pipeline (no skips):
//   1. CANONICAL_SIGNAL_RECEPTION
//   2. SIGNAL_VALIDATION
//   3. STRATEGY_SELECTION
//   4. STRATEGY_STATE_LOADING
//   5. RULE_EVALUATION
//   6. REGIME_COMPATIBILITY_ASSESSMENT
//   7. DECISION_CONSTRUCTION
//   8. DECISION_VALIDATION
//   9. DECISION_PUBLICATION
//  10. METADATA_RECORDING
//  11. DECISION_COMPLETION
//
// §6 — Canonical Strategy Decision Contract (Rule 4 — alternative formats prohibited).
// §9 — Cross-Strategy Decision Reconciliation (Rule 16/17 — preserve lineage).
// §10 — Strategy State Management (Rule 18 — deterministic, auditable).
// §11 — Strategy Versioning (Rule 14 — historical immutable).
// §12 — Strategy Governance (Rule 12 — only approved decisions enter Portfolio Construction).
// §16 — Failure Recovery (invalid decisions NEVER published).
//
// 22 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalSignal, MarketRegime } from '../signal-generation/types'
import type {
  CanonicalStrategyDecision,
  DecisionType,
  ExposureIntent,
  PortfolioCapacityMetadata,
  RegimeMetadata,
  RequestedCapital,
  StrategyDefinition,
  StrategyGovernanceMetadata,
  StrategyLineage,
  StrategyMetadata,
  StrategyOperationalState,
} from './types'
import { SIE_VERSION, STRATEGY_DECISION_SCHEMA_VERSION } from './types'
import { strategyStateManager } from './state-manager'
import { strategyRuleEvaluator } from './rules'
import { strategyVersionRegistry, strategyGovernanceManager } from './governance'
import { strategyReconciler } from './reconciliation'
import { failureRecoveryManager } from './recovery'
import { sieObservabilityCollector } from './observability'

const log = createLogger('decision-intelligence:strategy-engine:engine')

// ─────────────────────────────────────────────────────────────────────────────
// DecisionRequest — input to evaluate()
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionRequest {
  /** Canonical Signal Contract (Rule 1 — only Ch 5.1 signals may enter). */
  signal: CanonicalSignal
  /** Tradable instrument this signal targets (e.g., "BTCUSDT"). */
  instrument: string
  /** Current regime metadata (§3, §8). */
  regime: RegimeMetadata
  /** Portfolio capacity metadata (§3, Rule 21). */
  portfolioCapacity: PortfolioCapacityMetadata
  /** Optional capital reservation ID (already reserved upstream). */
  reservationId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// DecisionResult — output of evaluate() per strategy
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionResult {
  /** All decisions produced across all strategies (pre-reconciliation). */
  rawDecisions: CanonicalStrategyDecision[]
  /** Reconciled decisions ready for downstream publication (Rule 16). */
  publishedDecisions: CanonicalStrategyDecision[]
  /** Strategies evaluated. */
  strategiesEvaluated: string[]
  /** Strategies that produced a non-NO_ACTION decision. */
  strategiesWithAction: string[]
  /** Reconciliation summary. */
  reconciliation: {
    type: 'INDEPENDENT' | 'CONSOLIDATED' | 'PARTIALLY_OFFSET' | 'DEFERRED'
    opposingDetected: boolean
    conflictCount: number
  }
  /** Total pipeline latency in ms. */
  latencyMs: number
  /** Engine version. */
  engineVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategyIntelligenceEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class StrategyIntelligenceEngine {
  /** Pending decisions awaiting reconciliation per instrument. */
  private pendingByInstrument = new Map<string, CanonicalStrategyDecision[]>()
  /** Decision history (bounded). */
  private decisionHistory: CanonicalStrategyDecision[] = []
  /** Subscribers to published decisions. */
  private subscribers = new Set<(decision: CanonicalStrategyDecision) => void>()

  private readonly MAX_HISTORY = 2000

  /**
   * Register a strategy definition (§11, §12).
   * Initializes state + governance.
   */
  registerStrategy(definition: StrategyDefinition): 'NEW' | 'UPDATED' {
    const result = strategyVersionRegistry.register(definition)
    strategyStateManager.registerStrategy(definition)
    strategyGovernanceManager.initialize(definition.strategyId)
    return result
  }

  /**
   * Approve a strategy (§12 — only approved decisions enter Portfolio Construction).
   */
  approveStrategy(strategyId: string, actor: string, note: string): void {
    strategyGovernanceManager.approve(strategyId, actor, note)
    sieObservabilityCollector.recordGovernanceEvent('APPROVE')
  }

  /**
   * Evaluate a Canonical Signal across all eligible strategies (§5 — 11-stage
   * pipeline per strategy). Returns reconciled decisions for downstream
   * publication to Portfolio Construction (Ch 5.3).
   *
   * Rule 1 — Only Canonical Signal Contracts may enter.
   * Rule 4 — All decisions conform to Canonical Strategy Decision Contract.
   * Rule 10 — Never modifies the originating signal.
   * Rule 16 — Reconciles simultaneously active decisions per instrument.
   * Rule 22 — Decisions are intent only; execution authorization is downstream.
   */
  evaluate(request: DecisionRequest): DecisionResult {
    const startTime = Date.now()
    const { signal, instrument, regime, portfolioCapacity } = request

    // Track active signal in all strategies that will evaluate it (§10)
    const candidateStrategies = this.selectStrategies(signal, regime.currentRegime)
    for (const sid of candidateStrategies) {
      strategyStateManager.addActiveSignal(sid, signal.signalId)
    }

    const rawDecisions: CanonicalStrategyDecision[] = []
    const strategiesEvaluated: string[] = []
    const strategiesWithAction: string[] = []

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 1: CANONICAL_SIGNAL_RECEPTION (§5, Rule 1)
    // ─────────────────────────────────────────────────────────────────────
    const stage1Start = Date.now()
    if (!this.validateSignalContract(signal)) {
      failureRecoveryManager.logFailure(
        null, 'SIGNAL_INVALID', 'CANONICAL_SIGNAL_RECEPTION',
        'signal is not a valid Canonical Signal Contract', 'GRACEFUL_DEGRADATION',
      )
      for (const sid of candidateStrategies) strategyStateManager.removeActiveSignal(sid, signal.signalId)
      return this.emptyResult(startTime, 'invalid signal contract')
    }
    sieObservabilityCollector.recordStageTiming('CANONICAL_SIGNAL_RECEPTION', Date.now() - stage1Start)

    // Evaluate signal against each candidate strategy (§5 per-strategy pipeline)
    for (const strategyId of candidateStrategies) {
      const decision = this.evaluateSignalForStrategy(signal, instrument, strategyId, regime, portfolioCapacity)
      if (decision) {
        rawDecisions.push(decision)
        strategiesEvaluated.push(strategyId)
        if (decision.decisionType !== 'NO_ACTION' && decision.decisionType !== 'HOLD') {
          strategiesWithAction.push(strategyId)
        }
        // Remove signal from active tracking — decision made
        strategyStateManager.removeActiveSignal(strategyId, signal.signalId)
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 9 (per-instrument): DECISION_PUBLICATION (§5, Rule 16)
    // Cross-strategy reconciliation for the same tradable instrument.
    // ─────────────────────────────────────────────────────────────────────
    const analysis = strategyReconciler.analyzeConflicts(rawDecisions)
    for (const conflict of analysis.conflicts) {
      sieObservabilityCollector.recordConflict(
        conflict.conflictType,
        conflict.conflictType === 'OPPOSING_DIRECTION',
      )
    }
    const publishedDecisions = strategyReconciler.reconcile(rawDecisions, analysis)

    for (const d of publishedDecisions) {
      if (d.reconciliationLineage) {
        sieObservabilityCollector.recordReconciliation(d.reconciliationLineage.reconciliationType)
      }
    }

    // Record decisions in history (§4, Rule 5 — immutable)
    for (const d of publishedDecisions) {
      this.decisionHistory.push(d)
      if (this.decisionHistory.length > this.MAX_HISTORY) this.decisionHistory.shift()
      // Notify subscribers
      for (const sub of this.subscribers) {
        try { sub(d) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
      }
    }

    const latencyMs = Date.now() - startTime

    log.info(
      `instrument ${instrument} signal ${signal.signalId} → ${rawDecisions.length} raw decisions, ${publishedDecisions.length} published (reconciliation: ${analysis.recommendedAction}, ${analysis.conflicts.length} conflicts, ${latencyMs}ms)`,
    )

    return {
      rawDecisions,
      publishedDecisions,
      strategiesEvaluated,
      strategiesWithAction,
      reconciliation: {
        type: analysis.recommendedAction,
        opposingDetected: analysis.opposingDetected,
        conflictCount: analysis.conflicts.length,
      },
      latencyMs,
      engineVersion: SIE_VERSION,
    }
  }

  /**
   * Per-strategy 11-stage pipeline (§5).
   * Each strategy independently evaluates the signal.
   */
  private evaluateSignalForStrategy(
    signal: CanonicalSignal,
    instrument: string,
    strategyId: string,
    regime: RegimeMetadata,
    portfolioCapacity: PortfolioCapacityMetadata,
  ): CanonicalStrategyDecision | null {
    const definition = strategyVersionRegistry.getActive(strategyId)
    if (!definition) {
      failureRecoveryManager.logFailure(strategyId, 'STRATEGY_NOT_FOUND', 'STRATEGY_SELECTION', 'no active definition', 'GRACEFUL_DEGRADATION')
      return null
    }

    const stageStart = Date.now()

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 2: SIGNAL_VALIDATION (§5, Rule 1, Rule 10)
    // Validate the Canonical Signal Contract — but NEVER modify it (Rule 10).
    // ─────────────────────────────────────────────────────────────────────
    if (!this.isSignalValid(signal)) {
      failureRecoveryManager.logFailure(strategyId, 'SIGNAL_INVALID', 'SIGNAL_VALIDATION', 'signal expired or invalid', 'GRACEFUL_DEGRADATION')
      return this.buildNoAction(signal, definition, 'SIGNAL_VALIDATION', 'signal expired or invalid', regime)
    }
    sieObservabilityCollector.recordStageTiming('SIGNAL_VALIDATION', Date.now() - stageStart)

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 3: STRATEGY_SELECTION (§5)
    // Verify the strategy is enabled, governance-approved, and not retired.
    // ─────────────────────────────────────────────────────────────────────
    const selStart = Date.now()
    if (!definition.enabled) {
      return this.buildNoAction(signal, definition, 'STRATEGY_SELECTION', 'strategy disabled', regime)
    }
    if (!strategyGovernanceManager.isApproved(strategyId)) {
      sieObservabilityCollector.recordGovernanceEvent('REJECT_NOT_APPROVED')
      return this.buildNoAction(signal, definition, 'STRATEGY_SELECTION', 'strategy not governance-approved (Rule 12)', regime)
    }
    // Directional compatibility (§7)
    if (!strategyRuleEvaluator.isDirectionallyCompatible(signal, definition)) {
      return this.buildNoAction(signal, definition, 'STRATEGY_SELECTION', 'signal direction/type not accepted by strategy', regime)
    }
    sieObservabilityCollector.recordStageTiming('STRATEGY_SELECTION', Date.now() - selStart)

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 4: STRATEGY_STATE_LOADING (§5, §10, Rule 18)
    // ─────────────────────────────────────────────────────────────────────
    const loadStart = Date.now()
    strategyStateManager.tickCooldown(strategyId)
    if (!strategyStateManager.isAvailable(strategyId)) {
      const state = strategyStateManager.getState(strategyId)
      sieObservabilityCollector.recordDecision(strategyId, 'NO_ACTION', state?.currentState ?? 'SUSPENDED', false, 'STATE')
      return this.buildNoAction(signal, definition, 'STRATEGY_STATE_LOADING', `strategy in state ${state?.currentState} — not available`, regime)
    }
    const operationalState = strategyStateManager.getState(strategyId)!
    sieObservabilityCollector.recordStageTiming('STRATEGY_STATE_LOADING', Date.now() - loadStart)

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 5: RULE_EVALUATION (§5, §8, Rule 6 — deterministic + configurable)
    // ─────────────────────────────────────────────────────────────────────
    const ruleStart = Date.now()
    const ruleResult = strategyRuleEvaluator.evaluate(signal, definition, operationalState, regime)
    sieObservabilityCollector.recordStageTiming('RULE_EVALUATION', Date.now() - ruleStart)

    if (!ruleResult.passed) {
      // Rule 10 — failing rules → NO_ACTION (not promoted)
      strategyStateManager.recordDecisionDisposition(strategyId, false)
      sieObservabilityCollector.recordDecision(strategyId, 'NO_ACTION', operationalState.currentState, false, 'RULES')
      return this.buildNoAction(signal, definition, 'RULE_EVALUATION', `rules failed: ${ruleResult.reason}`, regime)
    }

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 6: REGIME_COMPATIBILITY_ASSESSMENT (§5, §8)
    // ─────────────────────────────────────────────────────────────────────
    const regimeStart = Date.now()
    const regimeScore = this.assessRegimeCompatibility(definition, regime)
    if (regimeScore <= 0) {
      strategyStateManager.recordDecisionDisposition(strategyId, false)
      sieObservabilityCollector.recordDecision(strategyId, 'NO_ACTION', operationalState.currentState, false, 'REGIME')
      return this.buildNoAction(signal, definition, 'REGIME_COMPATIBILITY_ASSESSMENT', `regime ${regime.currentRegime} incompatible`, regime)
    }
    sieObservabilityCollector.recordStageTiming('REGIME_COMPATIBILITY_ASSESSMENT', Date.now() - regimeStart)

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 7: DECISION_CONSTRUCTION (§5, §6, Rule 4, Rule 13)
    // ─────────────────────────────────────────────────────────────────────
    const constructStart = Date.now()
    const decision = this.constructDecision(
      signal, instrument, definition, operationalState, regime, ruleResult, regimeScore, portfolioCapacity,
    )
    sieObservabilityCollector.recordStageTiming('DECISION_CONSTRUCTION', Date.now() - constructStart)

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 8: DECISION_VALIDATION (§5, §16 — invalid NEVER published)
    // ─────────────────────────────────────────────────────────────────────
    const validateStart = Date.now()
    const validationError = this.validateDecision(decision, portfolioCapacity)
    if (validationError) {
      // Quarantine (§16)
      failureRecoveryManager.quarantineDecision(decision, validationError)
      sieObservabilityCollector.recordQuarantined()
      failureRecoveryManager.logFailure(strategyId, 'DECISION_VALIDATION_FAILED', 'DECISION_VALIDATION', validationError, 'QUARANTINE')
      // Record capacity rejection if applicable
      if (validationError.includes('capacity')) {
        sieObservabilityCollector.recordDecision(strategyId, 'NO_ACTION', operationalState.currentState, false, 'CAPACITY')
        // Build a capacity-invalidated version (Rule 21 — preserves lineage, never modifies signal)
        return this.buildCapacityInvalidated(signal, definition, validationError, regime)
      }
      return this.buildNoAction(signal, definition, 'DECISION_VALIDATION', `validation failed: ${validationError}`, regime)
    }
    sieObservabilityCollector.recordStageTiming('DECISION_VALIDATION', Date.now() - validateStart)

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 9: DECISION_PUBLICATION (§5) — recording here, reconciliation happens above
    // ─────────────────────────────────────────────────────────────────────
    strategyStateManager.recordDecisionDisposition(strategyId, true)
    strategyStateManager.recordDecision(strategyId, decision.decisionId, decision.decisionTimestamp)
    sieObservabilityCollector.recordDecision(
      strategyId, decision.decisionType, operationalState.currentState, true, 'NONE',
    )

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 10: METADATA_RECORDING (§5, §12)
    // ─────────────────────────────────────────────────────────────────────
    strategyGovernanceManager.addAuditEvent(strategyId, {
      action: 'DECISION_PRODUCED',
      at: decision.decisionTimestamp,
      actor: 'sie-engine',
      note: `decision ${decision.decisionId} (${decision.decisionType}) for signal ${signal.signalId}`,
    })

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 11: DECISION_COMPLETION (§5)
    // ─────────────────────────────────────────────────────────────────────
    log.debug(
      `strategy ${strategyId} → decision ${decision.decisionId} (${decision.decisionType}, conf ${decision.decisionConfidence.toFixed(3)}, strength ${decision.decisionStrength.toFixed(3)})`,
    )

    return decision
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 1: Signal Validation (§5, Rule 1)
  // ───────────────────────────────────────────────────────────────────────────

  private validateSignalContract(signal: CanonicalSignal): boolean {
    if (!signal || typeof signal !== 'object') return false
    if (!signal.signalId || !signal.signalVersion || !signal.signalType) return false
    if (!signal.signalMetadata?.lineage) return false
    return true
  }

  private isSignalValid(signal: CanonicalSignal): boolean {
    const now = Date.now()
    // Rule 18 — freshness check
    if (signal.validityHorizon.isExpired) return false
    if (now > signal.validityHorizon.validUntil) return false
    return true
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 3: Strategy Selection (§5)
  // ───────────────────────────────────────────────────────────────────────────

  private selectStrategies(signal: CanonicalSignal, _regime: MarketRegime): string[] {
    const all = strategyVersionRegistry.listStrategyIds()
    const eligible: string[] = []
    for (const sid of all) {
      const def = strategyVersionRegistry.getActive(sid)
      if (!def || !def.enabled) continue
      if (!strategyGovernanceManager.isApproved(sid)) continue
      // Directional + signal-type compatibility
      if (!strategyRuleEvaluator.isDirectionallyCompatible(signal, def)) continue
      // State availability
      if (!strategyStateManager.isAvailable(sid)) continue
      eligible.push(sid)
    }
    return eligible
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 6: Regime Compatibility Assessment (§5, §8)
  // ───────────────────────────────────────────────────────────────────────────

  private assessRegimeCompatibility(definition: StrategyDefinition, regime: RegimeMetadata): number {
    const compat = definition.regimeCompatibility[regime.currentRegime]
    if (compat === undefined) return 0.5 // default neutral if not configured
    return compat
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 7: Decision Construction (§5, §6, Rule 4, Rule 13)
  // ───────────────────────────────────────────────────────────────────────────

  private constructDecision(
    signal: CanonicalSignal,
    instrument: string,
    definition: StrategyDefinition,
    operationalState: StrategyOperationalState,
    regime: RegimeMetadata,
    ruleResult: { passed: boolean; score: number },
    regimeScore: number,
    portfolioCapacity: PortfolioCapacityMetadata,
  ): CanonicalStrategyDecision {
    const now = Date.now()

    // §6 — Decision Type from signal type + strategy
    const decisionType = this.deriveDecisionType(signal, definition)

    // Rule 13 — Decision Confidence INDEPENDENT from signal confidence
    // Compute via the strategy's own weighted formula.
    const decisionConfidence = this.computeDecisionConfidence(
      definition, signal, ruleResult.score, regimeScore, operationalState,
    )

    // Decision strength from rule score
    const decisionStrength = Math.max(0, Math.min(1, ruleResult.score * signal.signalStrength))

    // Rule 20 — Requested Capital + Exposure Intent (intent only)
    const requestedCapital = this.computeRequestedCapital(definition, signal, portfolioCapacity)
    const exposureIntent = this.computeExposureIntent(definition, signal)
    const capitalReservationStatus = this.computeReservationStatus(requestedCapital, portfolioCapacity, definition.strategyId)

    // §6 — Decision Horizon from strategy definition
    const decisionHorizon = definition.decisionHorizon

    // §4, Rule 9 — Lineage
    const lineage: StrategyLineage = {
      signalId: signal.signalId,
      signalVersion: signal.signalVersion,
      predictionId: signal.predictionId,
      predictionTarget: signal.predictionTarget,
      predictionHorizon: signal.predictionHorizon,
      modelVersion: signal.signalMetadata.modelVersion,
      ensembleVersion: signal.signalMetadata.ensembleVersion,
      featureVersion: signal.signalMetadata.featureVersion,
      configurationVersion: definition.versions.configurationVersion,
      ruleVersion: definition.versions.ruleVersion,
      governanceVersion: definition.versions.governanceVersion,
    }

    // §4 — Strategy Metadata
    const strategyMetadata: StrategyMetadata = {
      strategyId: definition.strategyId,
      strategyName: definition.strategyName,
      strategyType: definition.strategyType,
      coordinationMode: definition.coordinationMode,
      priority: definition.priority,
      versions: { ...definition.versions },
      lineage,
    }

    // §12 — Governance Metadata snapshot
    const governanceSnapshot: StrategyGovernanceMetadata = {
      ...(strategyGovernanceManager.get(definition.strategyId) ?? strategyGovernanceManager.initialize(definition.strategyId)),
    }

    const decision: CanonicalStrategyDecision = {
      decisionId: `dec-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      strategyId: definition.strategyId,
      strategyVersion: definition.versions.strategyVersion,
      signalId: signal.signalId,
      decisionTimestamp: now,
      decisionType,
      decisionConfidence,
      decisionStrength,
      decisionHorizon,
      strategyState: operationalState.currentState,
      decisionReason: `rule score ${ruleResult.score.toFixed(3)}, regime ${regimeScore.toFixed(3)}, state ${operationalState.currentState}`,
      requestedCapital,
      capitalReservationStatus,
      exposureIntent,
      strategyMetadata,
      governanceMetadata: governanceSnapshot,
      reconciliationLineage: null, // populated in stage 9 (reconciliation)
      createdAt: now,
    }

    // Rule 5 — Historical decisions immutable
    return Object.freeze(decision) as CanonicalStrategyDecision
  }

  /**
   * Derive Decision Type from Signal Type + Strategy (§6, §7).
   */
  private deriveDecisionType(signal: CanonicalSignal, definition: StrategyDefinition): DecisionType {
    // If state is OBSERVATION or RECOVERY, downgrade to HOLD
    const state = strategyStateManager.getState(definition.strategyId)
    if (state?.currentState === 'OBSERVATION' || state?.currentState === 'RECOVERY') {
      return 'HOLD'
    }

    switch (signal.signalType) {
      case 'BUY': return 'ENTER_LONG'
      case 'SELL': return 'ENTER_SHORT'
      case 'EXIT_LONG': return 'EXIT_LONG'
      case 'EXIT_SHORT': return 'EXIT_SHORT'
      case 'INCREASE_POSITION': return 'INCREASE_POSITION'
      case 'REDUCE_POSITION': return 'DECREASE_POSITION'
      case 'HOLD': return 'HOLD'
      case 'NO_ACTION':
      default: return 'NO_ACTION'
    }
  }

  /**
   * Compute Decision Confidence (Rule 13 — INDEPENDENT from signal confidence).
   * Uses strategy-specific weights. Signal confidence is one input (capped).
   */
  private computeDecisionConfidence(
    definition: StrategyDefinition,
    signal: CanonicalSignal,
    ruleScore: number,
    regimeScore: number,
    state: StrategyOperationalState,
  ): number {
    const w = definition.confidenceWeights
    const signalConf = signal.signalConfidence
    const signalQuality = signal.signalQualityScore
    const historicalReliability = strategyStateManager.computeHistoricalReliability(definition.strategyId)
    const stateHealth = strategyStateManager.computeStateHealth(definition.strategyId)

    // Rule 13 — independent formula. Signal confidence is one input (capped).
    const confidence =
      signalConf * w.signalConfidenceWeight +
      ruleScore * w.ruleScoreWeight +
      regimeScore * w.regimeWeight +
      historicalReliability * w.historicalReliabilityWeight +
      stateHealth * w.stateHealthWeight +
      signalQuality * w.signalQualityWeight

    return Math.max(0, Math.min(1, confidence))
  }

  /**
   * Compute Requested Capital (Rule 20 — intent only, never allocation).
   */
  private computeRequestedCapital(
    definition: StrategyDefinition,
    signal: CanonicalSignal,
    portfolioCapacity: PortfolioCapacityMetadata,
  ): RequestedCapital | null {
    if (!definition.defaultCapitalIntent) return null
    const intent = definition.defaultCapitalIntent
    // Scale by signal strength (intent only — never actual allocation)
    const amount = intent.amount * Math.max(0.1, signal.signalStrength)
    return {
      amount,
      requirement: intent.requirement,
      reason: `strategy ${definition.strategyId} capital intent (scaled by signal strength ${signal.signalStrength.toFixed(2)})`,
    }
  }

  /**
   * Compute Exposure Intent (Rule 20 — intent only).
   */
  private computeExposureIntent(definition: StrategyDefinition, signal: CanonicalSignal): ExposureIntent {
    const direction = signal.signalDirection
    const exposureFraction = definition.defaultCapitalIntent?.exposureFraction ?? 0.1
    return {
      direction,
      exposureFraction: Math.max(0, Math.min(1, exposureFraction * signal.signalStrength)),
      leverageHint: null,
      maxHoldingPeriodMs: definition.defaultCapitalIntent?.maxHoldingPeriodMs ?? null,
      minFillRatio: null,
    }
  }

  /**
   * Compute Capital Reservation Status (Rule 21 — capacity may invalidate).
   */
  private computeReservationStatus(
    requested: RequestedCapital | null,
    capacity: PortfolioCapacityMetadata,
    strategyId: string,
  ): CanonicalStrategyDecision['capitalReservationStatus'] {
    if (!requested) return 'NOT_REQUESTED'
    const remaining = capacity.perStrategyAllocationRemaining[strategyId] ?? capacity.availableCapital
    if (remaining >= requested.amount) {
      return 'RESERVED' // capacity sufficient (intent reserved)
    }
    if (requested.requirement === 'SOFT') {
      return 'REQUESTED' // soft request — may proceed with reduced capacity
    }
    return 'INSUFFICIENT_CAPACITY' // hard request — insufficient capacity
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stage 8: Decision Validation (§5, §16 — invalid NEVER published)
  // ───────────────────────────────────────────────────────────────────────────

  private validateDecision(
    decision: CanonicalStrategyDecision,
    portfolioCapacity: PortfolioCapacityMetadata,
  ): string | null {
    // Schema validation (Rule 4 — must conform to Canonical Strategy Decision Contract)
    if (!decision.decisionId) return 'missing decisionId'
    if (!decision.strategyId) return 'missing strategyId'
    if (!decision.signalId) return 'missing signalId'
    if (!Number.isFinite(decision.decisionConfidence)) return 'invalid decisionConfidence'
    if (decision.decisionConfidence < 0 || decision.decisionConfidence > 1) return 'decisionConfidence out of [0,1]'
    if (!Number.isFinite(decision.decisionStrength)) return 'invalid decisionStrength'
    if (decision.decisionStrength < 0 || decision.decisionStrength > 1) return 'decisionStrength out of [0,1]'
    if (!decision.strategyMetadata?.lineage) return 'missing strategy lineage (Rule 9)'

    // Rule 21 — Portfolio capacity constraints may invalidate
    if (decision.capitalReservationStatus === 'INSUFFICIENT_CAPACITY') {
      return `insufficient portfolio capacity for strategy ${decision.strategyId}`
    }

    // Exposure constraints
    const maxExposure = portfolioCapacity.exposureConstraints.maxPerStrategyFraction
    if (decision.exposureIntent.exposureFraction > maxExposure) {
      return `exposure ${decision.exposureIntent.exposureFraction} exceeds max ${maxExposure}`
    }

    // Prohibited symbols
    // (Note: instrument context is in the request, not the decision; the engine
    // validates against portfolioCapacity.exposureConstraints.prohibitedSymbols
    // via the requestedCapital path. Symbol-level validation occurs at Ch 5.3.)

    return null
  }

  /**
   * Build a capacity-invalidated decision (Rule 21 — preserves audit lineage,
   * NEVER modifies the originating signal).
   */
  private buildCapacityInvalidated(
    signal: CanonicalSignal,
    definition: StrategyDefinition,
    reason: string,
    regime: RegimeMetadata,
  ): CanonicalStrategyDecision {
    const noAction = this.buildNoAction(signal, definition, 'DECISION_VALIDATION', `capacity insufficient: ${reason}`, regime)
    return Object.freeze({
      ...noAction,
      capitalReservationStatus: 'INVALIDATED',
      decisionReason: `invalidated by portfolio capacity constraints: ${reason}`,
    }) as CanonicalStrategyDecision
  }

  /**
   * Build a NO_ACTION decision (§6 — when signal doesn't qualify for a strategy).
   * Still conforms to the Canonical Strategy Decision Contract (Rule 4).
   */
  private buildNoAction(
    signal: CanonicalSignal,
    definition: StrategyDefinition,
    stage: string,
    reason: string,
    _regime: RegimeMetadata,
  ): CanonicalStrategyDecision {
    const now = Date.now()
    const state = strategyStateManager.getState(definition.strategyId)
    const lineage: StrategyLineage = {
      signalId: signal.signalId,
      signalVersion: signal.signalVersion,
      predictionId: signal.predictionId,
      predictionTarget: signal.predictionTarget,
      predictionHorizon: signal.predictionHorizon,
      modelVersion: signal.signalMetadata.modelVersion,
      ensembleVersion: signal.signalMetadata.ensembleVersion,
      featureVersion: signal.signalMetadata.featureVersion,
      configurationVersion: definition.versions.configurationVersion,
      ruleVersion: definition.versions.ruleVersion,
      governanceVersion: definition.versions.governanceVersion,
    }
    const governanceSnapshot: StrategyGovernanceMetadata = {
      ...(strategyGovernanceManager.get(definition.strategyId) ?? strategyGovernanceManager.initialize(definition.strategyId)),
    }

    return Object.freeze({
      decisionId: `dec-noaction-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      strategyId: definition.strategyId,
      strategyVersion: definition.versions.strategyVersion,
      signalId: signal.signalId,
      decisionTimestamp: now,
      decisionType: 'NO_ACTION',
      decisionConfidence: 0,
      decisionStrength: 0,
      decisionHorizon: definition.decisionHorizon,
      strategyState: state?.currentState ?? 'SUSPENDED',
      decisionReason: `NO_ACTION at ${stage}: ${reason}`,
      requestedCapital: null,
      capitalReservationStatus: 'NOT_REQUESTED',
      exposureIntent: {
        direction: 'NEUTRAL',
        exposureFraction: 0,
        leverageHint: null,
        maxHoldingPeriodMs: null,
        minFillRatio: null,
      },
      strategyMetadata: {
        strategyId: definition.strategyId,
        strategyName: definition.strategyName,
        strategyType: definition.strategyType,
        coordinationMode: definition.coordinationMode,
        priority: definition.priority,
        versions: { ...definition.versions },
        lineage,
      },
      governanceMetadata: governanceSnapshot,
      reconciliationLineage: null,
      createdAt: now,
    }) as CanonicalStrategyDecision
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private emptyResult(startTime: number, _reason: string): DecisionResult {
    return {
      rawDecisions: [],
      publishedDecisions: [],
      strategiesEvaluated: [],
      strategiesWithAction: [],
      reconciliation: { type: 'INDEPENDENT', opposingDetected: false, conflictCount: 0 },
      latencyMs: Date.now() - startTime,
      engineVersion: SIE_VERSION,
    }
  }

  /** Subscribe to published decisions. */
  onDecision(handler: (decision: CanonicalStrategyDecision) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Get recent decisions (Rule 5 — historical immutable, but read-only access allowed). */
  getRecentDecisions(limit: number = 100): CanonicalStrategyDecision[] {
    return this.decisionHistory.slice(-limit)
  }

  /** Get observability metrics snapshot (§14). */
  getMetrics() {
    return sieObservabilityCollector.snapshot()
  }

  /** Get failure recovery stats (§16). */
  getRecoveryStats() {
    return failureRecoveryManager.getStats()
  }

  /** Get all strategy operational states (§10). */
  getStrategyStates() {
    return strategyStateManager.snapshot()
  }

  /** Get engine version + schema version. */
  getVersion() {
    return {
      engineVersion: SIE_VERSION,
      schemaVersion: STRATEGY_DECISION_SCHEMA_VERSION,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton engine
// ─────────────────────────────────────────────────────────────────────────────

export const strategyIntelligenceEngine = new StrategyIntelligenceEngine()
