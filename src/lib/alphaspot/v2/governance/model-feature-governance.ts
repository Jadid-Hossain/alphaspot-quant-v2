// CHAPTER 2.4 §10, §11 — Model & Feature Governance
//
// ML models are versioned artifacts (§10). Every prediction records:
//   • model version          • inference timestamp
//   • feature version        • confidence
//   • calibration version
//
// Every analytical feature requires (§11):
//   • unique identifier      • validation rules
//   • definition             • version
//   • calculation method
// Feature definitions must remain reproducible across time (§11).

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('governance:model-feature')

// ─────────────────────────────────────────────────────────────────────────────
// Model governance  (Chapter 2.4 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelArtifact {
  modelId: string
  version: string
  type: string // e.g. 'baseline-probabilistic', 'gradient-boosted', 'neural-net'
  featureVersion: string // the feature schema this model was trained on
  calibrationVersion: string
  trainedAt: number | null
  metadata: Record<string, unknown>
}

export interface PredictionRecord {
  modelId: string
  modelVersion: string
  featureVersion: string
  calibrationVersion: string
  inferenceTimestamp: number
  confidence: number
  asset: string
  probabilityOfSuccess: number
  expectedReturnPct: number
}

class ModelGovernance {
  private models = new Map<string, ModelArtifact>()
  private activeModelId: string | null = null
  private predictions: PredictionRecord[] = []
  private readonly predictionHistoryLimit = 5000

  /** Register a model artifact (§10 — versioned artifacts). */
  register(model: ModelArtifact): void {
    this.models.set(model.modelId, model)
    log.info(`model registered: ${model.modelId} v${model.version} (type ${model.type}, features v${model.featureVersion})`)
  }

  /** Set the active model (used for live inference). */
  setActive(modelId: string): void {
    if (!this.models.has(modelId)) {
      throw new Error(`[model-governance] cannot set active — model "${modelId}" not registered`)
    }
    this.activeModelId = modelId
    log.info(`active model set: ${modelId}`)
  }

  /** Get the active model artifact. */
  getActive(): ModelArtifact {
    if (!this.activeModelId) throw new Error('[model-governance] no active model set')
    const m = this.models.get(this.activeModelId)
    if (!m) throw new Error(`[model-governance] active model "${this.activeModelId}" not found`)
    return m
  }

  /** Record a prediction with full provenance (§10 — every prediction records model/feature/calibration/timestamp/confidence). */
  recordPrediction(pred: Omit<PredictionRecord, 'modelId' | 'modelVersion' | 'featureVersion' | 'calibrationVersion'>): PredictionRecord {
    const model = this.getActive()
    const record: PredictionRecord = {
      ...pred,
      modelId: model.modelId,
      modelVersion: model.version,
      featureVersion: model.featureVersion,
      calibrationVersion: model.calibrationVersion,
    }
    this.predictions.push(record)
    if (this.predictions.length > this.predictionHistoryLimit) this.predictions.shift()
    return record
  }

  /** Get prediction history (for reproducibility — §10, Rule 8 of constitution). */
  getPredictions(limit = 100): PredictionRecord[] {
    return this.predictions.slice(-limit)
  }

  /** List all registered models (for audit / documentation §14). */
  listModels(): ModelArtifact[] {
    return Array.from(this.models.values())
  }
}

export const modelGovernance = new ModelGovernance()

// ─────────────────────────────────────────────────────────────────────────────
// Feature governance  (Chapter 2.4 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureDefinition {
  featureId: string
  version: string
  description: string
  calculationMethod: string
  validationRules: string[]
  unit: string
  createdAt: number
}

class FeatureGovernance {
  private features = new Map<string, FeatureDefinition>()

  /** Register a feature definition (§11 — unique id, definition, calculation, validation, version). */
  register(feature: FeatureDefinition): void {
    this.features.set(feature.featureId, feature)
    log.info(`feature registered: ${feature.featureId} v${feature.version} — ${feature.description}`)
  }

  /** Get a feature definition (for reproducibility — §11). */
  get(featureId: string): FeatureDefinition | undefined {
    return this.features.get(featureId)
  }

  /** Assert a feature is registered (defensive — §11). */
  assertRegistered(featureId: string): void {
    if (!this.features.has(featureId)) {
      throw new Error(`[feature-governance] feature "${featureId}" is not registered (§11 requires all features to be defined)`)
    }
  }

  /** List all feature definitions (for documentation §14). */
  list(): FeatureDefinition[] {
    return Array.from(this.features.values())
  }
}

export const featureGovernance = new FeatureGovernance()

// ─────────────────────────────────────────────────────────────────────────────
// Canonical registrations  (Chapter 2.4 §10, §11)
// ─────────────────────────────────────────────────────────────────────────────

export function registerCanonicalModelsAndFeatures(): void {
  // Baseline model (Chapter 1's statistical evaluation)
  modelGovernance.register({
    modelId: 'baseline-probabilistic',
    version: '1.0.0',
    type: 'multi-evidence-probabilistic',
    featureVersion: '2.0.0',
    calibrationVersion: '1.0.0',
    trainedAt: null, // baseline is rule-based, not trained
    metadata: { description: 'Multi-evidence probabilistic synthesizer (RSI, MACD, trend, regime, relative strength, patterns)' },
  })
  modelGovernance.setActive('baseline-probabilistic')

  // Canonical features (from Chapter 1 feature-engineering)
  const now = Date.now()
  const canonicalFeatures: FeatureDefinition[] = [
    { featureId: 'rsi-14', version: '1.0.0', description: 'Relative Strength Index (14-period, Wilder)', calculationMethod: 'Wilder smoothing of average gains/losses', validationRules: ['value in [0, 100]'], unit: 'index', createdAt: now },
    { featureId: 'stochrsi-k', version: '1.0.0', description: 'Stochastic RSI K line (14, 14, 3, 3)', calculationMethod: 'Stochastic of RSI series, smoothed by SMA(3)', validationRules: ['value in [0, 100]'], unit: 'index', createdAt: now },
    { featureId: 'macd-hist', version: '1.0.0', description: 'MACD histogram (12, 26, 9)', calculationMethod: 'EMA(12) - EMA(26), signal = EMA(9) of MACD, hist = MACD - signal', validationRules: ['finite number'], unit: 'price', createdAt: now },
    { featureId: 'ema-50', version: '1.0.0', description: 'Exponential Moving Average (50-period)', calculationMethod: 'EMA with k = 2/(50+1)', validationRules: ['finite number', '> 0'], unit: 'price', createdAt: now },
    { featureId: 'ema-200', version: '1.0.0', description: 'Exponential Moving Average (200-period)', calculationMethod: 'EMA with k = 2/(200+1)', validationRules: ['finite number', '> 0'], unit: 'price', createdAt: now },
    { featureId: 'bb-percent-b', version: '1.0.0', description: 'Bollinger Bands %B (20, 2)', calculationMethod: '(close - lower) / (upper - lower) * 100', validationRules: ['finite number'], unit: 'percent', createdAt: now },
    { featureId: 'obv', version: '1.0.0', description: 'On-Balance Volume', calculationMethod: 'Cumulative volume signed by close direction', validationRules: ['finite number'], unit: 'volume', createdAt: now },
    { featureId: 'atr-14', version: '1.0.0', description: 'Average True Range (14-period)', calculationMethod: 'Wilder smoothing of true range', validationRules: ['>= 0'], unit: 'price', createdAt: now },
    { featureId: 'momentum-score', version: '1.0.0', description: 'Composite momentum (-1..+1) from RSI + MACD + StochRSI', calculationMethod: 'Equal-weighted average of normalized RSI, MACD hist, StochRSI K', validationRules: ['value in [-1, 1]'], unit: 'score', createdAt: now },
    { featureId: 'volatility-score', version: '1.0.0', description: 'Volatility (0..1) from BB width', calculationMethod: 'BB width / BB middle, normalized to [0,1] at 15% width', validationRules: ['value in [0, 1]'], unit: 'score', createdAt: now },
    { featureId: 'trend-alignment', version: '1.0.0', description: 'Multi-timeframe trend alignment (-1..+1)', calculationMethod: 'Average of EMA50>EMA200 sign across 15m/1h/4h', validationRules: ['value in [-1, 1]'], unit: 'score', createdAt: now },
    { featureId: 'liquidity-score', version: '1.0.0', description: 'Liquidity (0..1) from 24h quote volume', calculationMethod: 'log10(quoteVolume) / 10, clamped to [0,1]', validationRules: ['value in [0, 1]'], unit: 'score', createdAt: now },
  ]
  for (const f of canonicalFeatures) featureGovernance.register(f)

  log.info(`canonical models + features registered (${modelGovernance.listModels().length} models, ${featureGovernance.list().length} features)`)
}
