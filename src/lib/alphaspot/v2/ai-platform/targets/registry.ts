// CHAPTER 4.2 — Prediction Target Framework
//
// Defines the canonical objectives AI models are trained to predict (§1).
// Targets are immutable (Rule 2), model-independent (Rule 1, Rule 11),
// independent from dataset/labels (Rule 9, Rule 10, Rule 15), fully versioned
// (Rule 6), deterministic (Rule 7). Each target defines exactly one measurable
// future objective (Rule 3) with exactly one canonical evaluation metric
// (Rule 12, Rule 16). Multiple horizons remain logically independent (Rule 4).
// Confidence is an independent target (Rule 8). Temporal Realization Threshold
// governs label eligibility (§8.1, Rule 17).

// ─────────────────────────────────────────────────────────────────────────────
// Target Types  (Chapter 4.2 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type TargetType =
  | 'REGRESSION'
  | 'CLASSIFICATION'
  | 'RANKING'
  | 'PROBABILITY'
  | 'ORDINAL'
  | 'MULTI_OUTPUT'

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Metrics  (Chapter 4.2 §7.1, Rule 12, Rule 16)
// Each target type has compatible metrics. One canonical metric per target.
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationMetric =
  // Regression (§7.1)
  | 'MAE'
  | 'RMSE'
  | 'MAPE'
  // Classification (§7.1)
  | 'LOG_LOSS'
  | 'CROSS_ENTROPY'
  | 'BRIER_SCORE'
  // Ranking (§7.1)
  | 'NDCG'
  | 'SPEARMAN_RANK'
  | 'KENDALL_TAU'
  // Probability (§7.1)
  | 'CALIBRATION_ERROR'

/** Validate metric compatibility with target type (Rule 16). */
const METRIC_COMPATIBILITY: Record<TargetType, EvaluationMetric[]> = {
  REGRESSION: ['MAE', 'RMSE', 'MAPE'],
  CLASSIFICATION: ['LOG_LOSS', 'CROSS_ENTROPY', 'BRIER_SCORE'],
  RANKING: ['NDCG', 'SPEARMAN_RANK', 'KENDALL_TAU'],
  PROBABILITY: ['BRIER_SCORE', 'CALIBRATION_ERROR'],
  ORDINAL: ['MAE', 'SPEARMAN_RANK'],
  MULTI_OUTPUT: ['RMSE', 'LOG_LOSS'],
}

export function isMetricCompatible(targetType: TargetType, metric: EvaluationMetric): boolean {
  return METRIC_COMPATIBILITY[targetType]?.includes(metric) ?? false
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Horizons  (Chapter 4.2 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type TargetHorizon = '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

export const HORIZON_MS: Record<TargetHorizon, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporal Realization Threshold  (Chapter 4.2 §8.1, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export interface TemporalRealizationThreshold {
  /** The prediction horizon duration. */
  horizonMs: number
  /** Late arrival tolerance — additional wait after horizon elapses. */
  lateArrivalToleranceMs: number
  /** Whether historical data integrity must be validated before realization. */
  requireDataIntegrity: boolean
}

/**
 * Check if a target is eligible for Label Engineering (§8.1, Rule 17).
 * A target becomes eligible only after: Observation Timestamp + Horizon +
 * Late Arrival Tolerance has elapsed AND data integrity is validated.
 */
export function isEligibleForLabeling(
  observationTimestamp: number,
  threshold: TemporalRealizationThreshold,
  currentTime: number,
  dataIntegrityValid: boolean,
): { eligible: boolean; realizationTime: number; remainingMs: number } {
  const realizationTime = observationTimestamp + threshold.horizonMs + threshold.lateArrivalToleranceMs
  const timeElapsed = currentTime >= realizationTime
  const integrityOk = !threshold.requireDataIntegrity || dataIntegrityValid
  const eligible = timeElapsed && integrityOk
  return {
    eligible,
    realizationTime,
    remainingMs: Math.max(0, realizationTime - currentTime),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction Target Definition  (Chapter 4.2 §4 — Output Contract)
// Immutable (Rule 2). Exactly one measurable future objective (Rule 3).
// One canonical evaluation metric (Rule 12). Model-independent (Rule 11).
// ─────────────────────────────────────────────────────────────────────────────

export type AssetScope = 'SINGLE_ASSET' | 'CROSS_SECTIONAL' | 'ALL_ASSETS'

export type PredictionObjective =
  // Primary (§5)
  | 'FUTURE_RETURN'
  | 'RELATIVE_RANKING'
  | 'TREND_CONTINUATION'
  | 'TREND_REVERSAL'
  | 'EXPECTED_VOLATILITY'
  | 'RISK_ADJUSTED_OPPORTUNITY'
  // Secondary (§6)
  | 'BREAKOUT_PROBABILITY'
  | 'MEAN_REVERSION'
  | 'MOMENTUM_PERSISTENCE'
  | 'LIQUIDITY_STABILITY'
  | 'MARKET_REGIME'
  | 'EXECUTION_DIFFICULTY'
  | 'OPPORTUNITY_CONFIDENCE'
  // Confidence (§11)
  | 'PREDICTION_CONFIDENCE'
  | 'MODEL_AGREEMENT'
  | 'HISTORICAL_RELIABILITY'
  | 'DATA_SUFFICIENCY'
  | 'FEATURE_STABILITY'

export interface PredictionTargetDefinition {
  /** Unique target identifier. */
  targetId: string
  /** Human-readable name. */
  targetName: string
  /** Primary or secondary objective (§5, §6, §11). */
  objective: PredictionObjective
  /** Target type — regression, classification, ranking, etc. (§7). */
  targetType: TargetType
  /** Prediction horizon (§8). */
  horizon: TargetHorizon
  /** Asset scope — single, cross-sectional, or all (§10). */
  assetScope: AssetScope
  /** The timeframe used for feature generation. */
  timeframe: string
  /** Success definition — what constitutes a correct prediction (§4). */
  successDefinition: string
  /** Canonical evaluation metric — exactly one (Rule 12, Rule 16). */
  evaluationMetric: EvaluationMetric
  /** Confidence requirement for this target (§11). */
  confidenceRequirement: number // 0..1 — minimum confidence for the target to be useful
  /** Temporal realization threshold (§8.1, Rule 17). */
  realizationThreshold: TemporalRealizationThreshold
  /** Versioning (§13, Rule 6). */
  version: TargetVersion
  /** Additional metadata. */
  metadata: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Target Versioning  (Chapter 4.2 §13, Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

export interface TargetVersion {
  targetVersion: string // the target's own version
  definitionVersion: string // definition schema version
  schemaVersion: string // output schema version
  evaluationVersion: string // evaluation metric version
  businessVersion: string // business objective version
}

export const TARGET_DEFINITION_VERSION = '1.0.0'
export const TARGET_SCHEMA_VERSION = '1.0.0'
export const TARGET_EVALUATION_VERSION = '1.0.0'
export const TARGET_BUSINESS_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Target Registry  (Chapter 4.2 §4, §5, §6, §13)
// Immutable targets, versioned, model-independent (Rule 1, Rule 2, Rule 11).
// ─────────────────────────────────────────────────────────────────────────────

import { createLogger } from '../../domains/01-core-infrastructure'

const log = createLogger('ai-platform:targets')

class PredictionTargetRegistry {
  private targets = new Map<string, PredictionTargetDefinition>()
  private versionCounters = new Map<string, number>() // targetName → latest version
  private stats = {
    totalDefined: 0,
    validationErrors: 0,
    versionChanges: 0,
  }

  /** Register a prediction target (§4, Rule 2 — immutable after registration). */
  register(target: PredictionTargetDefinition): void {
    // Rule 3 — exactly one measurable objective
    if (!target.successDefinition || target.successDefinition.trim().length < 10) {
      throw new Error(`[targets] target "${target.targetId}" must have a meaningful success definition (Rule 3)`)
    }
    // Rule 12, Rule 16 — metric must be compatible with target type
    if (!isMetricCompatible(target.targetType, target.evaluationMetric)) {
      throw new Error(`[targets] target "${target.targetId}": metric ${target.evaluationMetric} incompatible with type ${target.targetType} (Rule 16)`)
    }
    // Rule 2 — immutability: if already registered, reject
    if (this.targets.has(target.targetId)) {
      throw new Error(`[targets] target "${target.targetId}" already registered — targets are immutable (Rule 2). Create a new version instead.`)
    }

    this.targets.set(target.targetId, Object.freeze({ ...target }) as PredictionTargetDefinition)
    this.versionCounters.set(target.targetName, (this.versionCounters.get(target.targetName) ?? 0) + 1)
    this.stats.totalDefined++
    log.info(`target registered: ${target.targetId} (${target.objective}, ${target.targetType}, ${target.horizon}, metric: ${target.evaluationMetric})`)
  }

  /** Get a target by ID. */
  get(targetId: string): PredictionTargetDefinition | undefined {
    return this.targets.get(targetId)
  }

  /** Get all targets for an objective. */
  getByObjective(objective: PredictionObjective): PredictionTargetDefinition[] {
    return Array.from(this.targets.values()).filter((t) => t.objective === objective)
  }

  /** Get all targets for a horizon. */
  getByHorizon(horizon: TargetHorizon): PredictionTargetDefinition[] {
    return Array.from(this.targets.values()).filter((t) => t.horizon === horizon)
  }

  /** Get all targets. */
  list(): PredictionTargetDefinition[] {
    return Array.from(this.targets.values())
  }

  /** Get primary objectives (§5). */
  getPrimaryTargets(): PredictionTargetDefinition[] {
    const primaryObjectives: PredictionObjective[] = [
      'FUTURE_RETURN', 'RELATIVE_RANKING', 'TREND_CONTINUATION', 'TREND_REVERSAL',
      'EXPECTED_VOLATILITY', 'RISK_ADJUSTED_OPPORTUNITY',
    ]
    return this.list().filter((t) => primaryObjectives.includes(t.objective))
  }

  /** Get secondary objectives (§6). */
  getSecondaryTargets(): PredictionTargetDefinition[] {
    const secondaryObjectives: PredictionObjective[] = [
      'BREAKOUT_PROBABILITY', 'MEAN_REVERSION', 'MOMENTUM_PERSISTENCE',
      'LIQUIDITY_STABILITY', 'MARKET_REGIME', 'EXECUTION_DIFFICULTY', 'OPPORTUNITY_CONFIDENCE',
    ]
    return this.list().filter((t) => secondaryObjectives.includes(t.objective))
  }

  /** Get confidence targets (§11, Rule 8). */
  getConfidenceTargets(): PredictionTargetDefinition[] {
    const confidenceObjectives: PredictionObjective[] = [
      'PREDICTION_CONFIDENCE', 'MODEL_AGREEMENT', 'HISTORICAL_RELIABILITY',
      'DATA_SUFFICIENCY', 'FEATURE_STABILITY',
    ]
    return this.list().filter((t) => confidenceObjectives.includes(t.objective))
  }

  /** Get ranking targets (§10). */
  getRankingTargets(): PredictionTargetDefinition[] {
    return this.list().filter((t) => t.targetType === 'RANKING')
  }

  /** Check temporal realization eligibility (§8.1, Rule 17). */
  checkRealization(
    targetId: string,
    observationTimestamp: number,
    currentTime: number,
    dataIntegrityValid: boolean,
  ): { eligible: boolean; realizationTime: number; remainingMs: number } | null {
    const target = this.targets.get(targetId)
    if (!target) return null
    return isEligibleForLabeling(
      observationTimestamp,
      target.realizationThreshold,
      currentTime,
      dataIntegrityValid,
    )
  }

  getStats() {
    return {
      ...this.stats,
      byType: this.countByType(),
      byHorizon: this.countByHorizon(),
      byObjective: this.countByObjective(),
    }
  }

  private countByType(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const t of this.targets.values()) counts[t.targetType] = (counts[t.targetType] ?? 0) + 1
    return counts
  }

  private countByHorizon(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const t of this.targets.values()) counts[t.horizon] = (counts[t.horizon] ?? 0) + 1
    return counts
  }

  private countByObjective(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const t of this.targets.values()) counts[t.objective] = (counts[t.objective] ?? 0) + 1
    return counts
  }
}

export const predictionTargetRegistry = new PredictionTargetRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Target Definitions  (Chapter 4.2 §5, §6, §11)
// Register the standard prediction targets.
// ─────────────────────────────────────────────────────────────────────────────

export function registerCanonicalTargets(): void {
  const defaultThreshold = (horizon: TargetHorizon): TemporalRealizationThreshold => ({
    horizonMs: HORIZON_MS[horizon],
    lateArrivalToleranceMs: 30_000, // 30 seconds
    requireDataIntegrity: true,
  })

  const defaultVersion = (): TargetVersion => ({
    targetVersion: '1.0.0',
    definitionVersion: TARGET_DEFINITION_VERSION,
    schemaVersion: TARGET_SCHEMA_VERSION,
    evaluationVersion: TARGET_EVALUATION_VERSION,
    businessVersion: TARGET_BUSINESS_VERSION,
  })

  // §5 — Primary Objectives
  // Future Return (Regression) — multiple horizons
  for (const horizon of ['15m', '1h', '4h', '1d'] as TargetHorizon[]) {
    predictionTargetRegistry.register({
      targetId: `future_return_${horizon}`,
      targetName: `Future Return (${horizon})`,
      objective: 'FUTURE_RETURN',
      targetType: 'REGRESSION',
      horizon,
      assetScope: 'SINGLE_ASSET',
      timeframe: '15m',
      successDefinition: `The percentage return of the asset over the next ${horizon} period, measured as (close_at_${horizon}_end - close_at_observation) / close_at_observation.`,
      evaluationMetric: 'RMSE',
      confidenceRequirement: 0.6,
      realizationThreshold: defaultThreshold(horizon),
      version: defaultVersion(),
      metadata: { direction: 'forward', unit: 'percent' },
    })
  }

  // Relative Ranking (Ranking) — cross-sectional
  predictionTargetRegistry.register({
    targetId: 'relative_rank_1h',
    targetName: 'Relative Asset Ranking (1h)',
    objective: 'RELATIVE_RANKING',
    targetType: 'RANKING',
    horizon: '1h',
    assetScope: 'CROSS_SECTIONAL',
    timeframe: '15m',
    successDefinition: 'The rank of the asset\'s 1h forward return relative to all other eligible assets in the universe.',
    evaluationMetric: 'NDCG',
    confidenceRequirement: 0.5,
    realizationThreshold: defaultThreshold('1h'),
    version: defaultVersion(),
    metadata: { comparison: 'cross_sectional' },
  })

  // Trend Continuation (Probability)
  predictionTargetRegistry.register({
    targetId: 'trend_continuation_1h',
    targetName: 'Trend Continuation Probability (1h)',
    objective: 'TREND_CONTINUATION',
    targetType: 'PROBABILITY',
    horizon: '1h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '15m',
    successDefinition: 'Probability that the current trend (as defined by EMA50 > EMA200 for uptrend, EMA50 < EMA200 for downtrend) continues over the next 1h period.',
    evaluationMetric: 'BRIER_SCORE',
    confidenceRequirement: 0.65,
    realizationThreshold: defaultThreshold('1h'),
    version: defaultVersion(),
    metadata: { trendDefinition: 'EMA50_vs_EMA200' },
  })

  // Trend Reversal (Probability)
  predictionTargetRegistry.register({
    targetId: 'trend_reversal_4h',
    targetName: 'Trend Reversal Probability (4h)',
    objective: 'TREND_REVERSAL',
    targetType: 'PROBABILITY',
    horizon: '4h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '1h',
    successDefinition: 'Probability that the current trend reverses (EMA50 crosses EMA200 in the opposite direction) within the next 4h period.',
    evaluationMetric: 'BRIER_SCORE',
    confidenceRequirement: 0.65,
    realizationThreshold: defaultThreshold('4h'),
    version: defaultVersion(),
    metadata: { reversalType: 'EMA_cross' },
  })

  // Expected Volatility (Regression)
  predictionTargetRegistry.register({
    targetId: 'expected_volatility_1h',
    targetName: 'Expected Volatility (1h)',
    objective: 'EXPECTED_VOLATILITY',
    targetType: 'REGRESSION',
    horizon: '1h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '15m',
    successDefinition: 'The realized volatility (standard deviation of log returns) of the asset over the next 1h period, annualized.',
    evaluationMetric: 'MAE',
    confidenceRequirement: 0.55,
    realizationThreshold: defaultThreshold('1h'),
    version: defaultVersion(),
    metadata: { volType: 'realized', annualized: true },
  })

  // Risk-Adjusted Opportunity Score (Regression)
  predictionTargetRegistry.register({
    targetId: 'risk_adjusted_opportunity_1h',
    targetName: 'Risk-Adjusted Opportunity Score (1h)',
    objective: 'RISK_ADJUSTED_OPPORTUNITY',
    targetType: 'REGRESSION',
    horizon: '1h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '15m',
    successDefinition: 'The expected return divided by expected volatility (Sharpe-like ratio) over the next 1h period. Higher = better risk-adjusted opportunity.',
    evaluationMetric: 'RMSE',
    confidenceRequirement: 0.6,
    realizationThreshold: defaultThreshold('1h'),
    version: defaultVersion(),
    metadata: { riskFreeRate: 0, annualized: false },
  })

  // §6 — Secondary Objectives
  predictionTargetRegistry.register({
    targetId: 'breakout_probability_4h',
    targetName: 'Breakout Probability (4h)',
    objective: 'BREAKOUT_PROBABILITY',
    targetType: 'PROBABILITY',
    horizon: '4h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '1h',
    successDefinition: 'Probability that the asset breaks above its 20-period Bollinger Band upper boundary within the next 4h period.',
    evaluationMetric: 'BRIER_SCORE',
    confidenceRequirement: 0.5,
    realizationThreshold: defaultThreshold('4h'),
    version: defaultVersion(),
    metadata: {},
  })

  predictionTargetRegistry.register({
    targetId: 'mean_reversion_15m',
    targetName: 'Mean Reversion Probability (15m)',
    objective: 'MEAN_REVERSION',
    targetType: 'PROBABILITY',
    horizon: '15m',
    assetScope: 'SINGLE_ASSET',
    timeframe: '15m',
    successDefinition: 'Probability that the asset reverts to its 15m VWAP within the next 15 minutes after a deviation > 1 standard deviation.',
    evaluationMetric: 'BRIER_SCORE',
    confidenceRequirement: 0.55,
    realizationThreshold: defaultThreshold('15m'),
    version: defaultVersion(),
    metadata: {},
  })

  predictionTargetRegistry.register({
    targetId: 'momentum_persistence_1h',
    targetName: 'Momentum Persistence (1h)',
    objective: 'MOMENTUM_PERSISTENCE',
    targetType: 'PROBABILITY',
    horizon: '1h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '15m',
    successDefinition: 'Probability that the current 15m momentum direction persists into the next 1h period.',
    evaluationMetric: 'BRIER_SCORE',
    confidenceRequirement: 0.55,
    realizationThreshold: defaultThreshold('1h'),
    version: defaultVersion(),
    metadata: {},
  })

  predictionTargetRegistry.register({
    targetId: 'market_regime_4h',
    targetName: 'Market Regime Classification (4h)',
    objective: 'MARKET_REGIME',
    targetType: 'CLASSIFICATION',
    horizon: '4h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '1h',
    successDefinition: 'Classification of the market regime over the next 4h: TRENDING_UP, TRENDING_DOWN, RANGING, HIGH_VOLATILITY, or LOW_VOLATILITY.',
    evaluationMetric: 'LOG_LOSS',
    confidenceRequirement: 0.5,
    realizationThreshold: defaultThreshold('4h'),
    version: defaultVersion(),
    metadata: { classes: ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'HIGH_VOLATILITY', 'LOW_VOLATILITY'] },
  })

  // §11 — Confidence Targets
  predictionTargetRegistry.register({
    targetId: 'prediction_confidence_1h',
    targetName: 'Prediction Confidence (1h)',
    objective: 'PREDICTION_CONFIDENCE',
    targetType: 'REGRESSION',
    horizon: '1h',
    assetScope: 'SINGLE_ASSET',
    timeframe: '15m',
    successDefinition: 'The epistemic confidence (0..1) of the primary 1h prediction, representing model certainty based on data density and historical familiarity.',
    evaluationMetric: 'MAE',
    confidenceRequirement: 0.0, // confidence targets don't require their own confidence
    realizationThreshold: defaultThreshold('1h'),
    version: defaultVersion(),
    metadata: { uncertaintyType: 'epistemic' },
  })

  log.info(`canonical targets registered: ${predictionTargetRegistry.list().length} targets`)
}
