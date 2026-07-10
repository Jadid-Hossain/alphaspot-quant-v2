// CHAPTER 5.2 §8 — Strategy Rule Evaluation
//
// Strategy rules evaluate (§8): Direction, Strength, Confidence, Quality,
// Regime, Horizon, Freshness, Strategy State, Time Constraints.
//
// Rules remain deterministic (Rule 6 — configurable + version controlled).
// Rule 13 — Decision confidence is MATHEMATICALLY INDEPENDENT from signal
// confidence. The rule evaluation score is one input, but the decision
// confidence formula in the engine uses the strategy's own weights.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalSignal } from '../signal-generation/types'
import type {
  RegimeMetadata,
  RuleEvaluationResult,
  StrategyDefinition,
  StrategyOperationalState,
  StrategyRule,
  StrategyRuleField,
  StrategyRuleOperator,
} from './types'

const log = createLogger('decision-intelligence:strategy-engine:rules')

// ─────────────────────────────────────────────────────────────────────────────
// StrategyRuleEvaluator
// Deterministic rule evaluation (§8, Rule 6, Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export class StrategyRuleEvaluator {
  /**
   * Evaluate the full ruleset for a strategy against a signal (§8).
   * - qualifyingRules: ALL must pass (AND semantics). If any fail → no decision.
   * - scoringRules: contribute to a weighted score (0..1) → decision strength.
   *
   * Returns the evaluation result with pass/fail, score, and per-rule details.
   */
  evaluate(
    signal: CanonicalSignal,
    definition: StrategyDefinition,
    state: StrategyOperationalState,
    regime: RegimeMetadata,
    currentTime: number = Date.now(),
  ): RuleEvaluationResult {
    const ctx = this.buildEvaluationContext(signal, state, regime, currentTime)

    // Evaluate qualifying rules — ALL must pass (AND semantics)
    const evaluatedQualifying = definition.ruleSet.qualifyingRules.map((rule) =>
      this.evaluateRule(rule, ctx),
    )

    const qualifyingFailures = evaluatedQualifying.filter((r) => !r.passed)
    const passed = qualifyingFailures.length === 0

    // Evaluate scoring rules — contribute to weighted score
    const evaluatedScoring = definition.ruleSet.scoringRules.map((rule) =>
      this.evaluateRule(rule, ctx),
    )

    // Combine qualifying (gating) + scoring (weighted) into overall score
    const totalWeight = [...definition.ruleSet.qualifyingRules, ...definition.ruleSet.scoringRules]
      .reduce((sum, r) => sum + Math.max(0, r.weight), 0)

    let score = 0
    if (totalWeight > 0) {
      const allRules = [...evaluatedQualifying, ...evaluatedScoring]
      score = allRules.reduce((sum, r) => sum + (r.passed ? r.contribution : 0), 0) / totalWeight
    }

    const reason = passed
      ? `all ${evaluatedQualifying.length} qualifying rules passed (score ${score.toFixed(3)})`
      : `${qualifyingFailures.length} qualifying rule(s) failed: ${qualifyingFailures.map((f) => f.ruleId).join(', ')}`

    log.debug(
      `strategy ${definition.strategyId} signal ${signal.signalId} — ${passed ? 'PASS' : 'FAIL'} (${reason})`,
    )

    return {
      passed,
      score: Math.max(0, Math.min(1, score)),
      evaluatedRules: [...evaluatedQualifying, ...evaluatedScoring],
      reason,
    }
  }

  /** Check directional + signal-type compatibility (§7). */
  isDirectionallyCompatible(signal: CanonicalSignal, definition: StrategyDefinition): boolean {
    if (!definition.acceptedDirections.includes(signal.signalDirection)) {
      return false
    }
    if (!definition.acceptedSignalTypes.includes(signal.signalType)) {
      return false
    }
    return true
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────────────────────

  private buildEvaluationContext(
    signal: CanonicalSignal,
    state: StrategyOperationalState,
    regime: RegimeMetadata,
    currentTime: number,
  ): RuleEvaluationContext {
    const signalAgeMs = currentTime - signal.createdAt
    const freshnessMs = signal.validityHorizon.remainingMs
    const signalFreshness = signal.validityHorizon.validUntil > currentTime
      ? Math.max(0, Math.min(1, freshnessMs / Math.max(1, signal.validityHorizon.validUntil - signal.validityHorizon.validFrom)))
      : 0

    return {
      signalDirection: signal.signalDirection,
      signalStrength: signal.signalStrength,
      signalConfidence: signal.signalConfidence,
      signalQualityScore: signal.signalQualityScore,
      regimeCompatibilityScore: signal.regimeCompatibilityScore,
      predictionHorizon: signal.predictionHorizon,
      signalFreshness,
      strategyState: state.currentState,
      timestamp: currentTime,
      marketRegime: regime.currentRegime,
      signalType: signal.signalType,
      signalAgeMs,
    }
  }

  private evaluateRule(
    rule: StrategyRule,
    ctx: RuleEvaluationContext,
  ): {
    ruleId: string
    field: StrategyRuleField
    passed: boolean
    contribution: number
    actualValue: unknown
  } {
    const actual = ctx[rule.field]
    const passed = this.applyOperator(actual, rule.operator, rule.value)
    const contribution = passed ? Math.max(0, rule.weight) : 0

    return {
      ruleId: rule.ruleId,
      field: rule.field,
      passed,
      contribution,
      actualValue: actual,
    }
  }

  /**
   * Apply a rule operator (§8 — deterministic).
   * Strict type checking ensures rules are evaluated consistently.
   */
  private applyOperator(
    actual: unknown,
    operator: StrategyRuleOperator,
    expected: number | string | number[] | string[],
  ): boolean {
    switch (operator) {
      case 'EQ':
        return actual === expected
      case 'NEQ':
        return actual !== expected
      case 'GT':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected
      case 'GTE':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
      case 'LT':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected
      case 'LTE':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
      case 'BETWEEN': {
        if (typeof actual !== 'number' || !Array.isArray(expected) || expected.length !== 2) return false
        const [min, max] = expected as number[]
        return actual >= min && actual <= max
      }
      case 'IN':
        return Array.isArray(expected) && expected.includes(actual as never)
      case 'NOT_IN':
        return Array.isArray(expected) && !expected.includes(actual as never)
      case 'CONTAINS':
        return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
      default:
        return false
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal evaluation context (typed access to rule fields)
// ─────────────────────────────────────────────────────────────────────────────

interface RuleEvaluationContext {
  signalDirection: string
  signalStrength: number
  signalConfidence: number
  signalQualityScore: number
  regimeCompatibilityScore: number
  predictionHorizon: string
  signalFreshness: number
  strategyState: string
  timestamp: number
  marketRegime: string
  signalType: string
  signalAgeMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule builder helpers — used by strategy definitions to construct rulesets
// without manually specifying every field.
// ─────────────────────────────────────────────────────────────────────────────

export function rule(
  ruleId: string,
  ruleVersion: string,
  field: StrategyRuleField,
  operator: StrategyRuleOperator,
  value: number | string | number[] | string[],
  description: string,
  weight: number = 1.0,
): StrategyRule {
  return { ruleId, ruleVersion, field, operator, value, description, weight }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton evaluator
// ─────────────────────────────────────────────────────────────────────────────

export const strategyRuleEvaluator = new StrategyRuleEvaluator()
