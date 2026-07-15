// CHAPTER 4.7 — Hyperparameter Optimization Types
//
// The HPOE discovers optimal ML hyperparameters (§1).
// Independent of algorithms (Rule 2). Search spaces versioned (Rule 3).
// Every trial through Training Pipeline (Rule 5). Historical immutable (Rule 8).
// Selection bias controlled (Rule 16). CV stability penalized (Rule 17).
// Test dataset strictly isolated (Rule 18).

// ─────────────────────────────────────────────────────────────────────────────
// Search Space  (Chapter 4.7 §5, Rule 3)
// ─────────────────────────────────────────────────────────────────────────────

export type ParameterType = 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'CATEGORICAL' | 'ORDINAL' | 'CONDITIONAL'

export type SearchDistribution = 'UNIFORM' | 'LOG_UNIFORM' | 'NORMAL' | 'CATEGORICAL' | 'CONSTANT'

export interface HyperparameterSpec {
  name: string
  type: ParameterType
  distribution: SearchDistribution
  minValue: number | null
  maxValue: number | null
  defaultValue: unknown
  categories: string[] | null // for CATEGORICAL/ORDINAL
  conditionalOn: string | null // parent parameter name (for CONDITIONAL)
  conditionalValues: unknown[] | null // parent values that activate this parameter
  constraints: string[] // human-readable constraints
}

export interface SearchSpace {
  spaceId: string
  version: string
  parameters: HyperparameterSpec[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Strategies  (Chapter 4.7 §6, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export type OptimizationStrategy =
  | 'GRID_SEARCH'
  | 'RANDOM_SEARCH'
  | 'BAYESIAN'
  | 'TPE'
  | 'EVOLUTIONARY'
  | 'POPULATION_BASED'
  | 'MULTI_OBJECTIVE'

// ─────────────────────────────────────────────────────────────────────────────
// Trial  (Chapter 4.7 §7, Rule 5, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export type TrialStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PRUNED' | 'FAILED'

export interface OptimizationTrial {
  trialId: string
  hyperparameters: Record<string, unknown>
  datasetVersion: string
  featureVersion: string
  modelVersion: string
  randomSeed: number
  performanceMetrics: Record<string, number>
  cvScores: number[] // individual fold scores for stability assessment (Rule 17)
  cvVariance: number | null // variance across folds (penalized if high, Rule 17)
  runtime: number // ms
  resourceConsumption: ResourceConsumption
  status: TrialStatus
  prunedReason: string | null
  prunedAtEpoch: number | null
  experimentId: string | null // link to Ch 4.6 training experiment
  createdAt: number
}

export interface ResourceConsumption {
  cpuSeconds: number
  gpuSeconds: number
  memoryMb: number
  storageMb: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Early Pruning  (Chapter 4.7 §8, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export type PruningStrategy = 'MEDIAN' | 'SUCCESSIVE_HALVING' | 'HYPERBAND' | 'ASHA' | 'PERFORMANCE_THRESHOLD'

export interface PruningConfig {
  strategy: PruningStrategy
  // For MEDIAN: prune if below median of completed trials at same epoch
  medianThreshold: number | null
  // For PERFORMANCE_THRESHOLD: prune if below this absolute threshold
  performanceThreshold: number | null
  // For HYPERBAND/ASHA: max resources
  maxResources: number | null
  minResources: number | null
  reductionFactor: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Budget  (Chapter 4.7 §9, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceBudget {
  maxCpuSeconds: number | null
  maxGpuSeconds: number | null
  maxMemoryMb: number | null
  maxStorageMb: number | null
  maxTimeMs: number | null
  maxTrials: number
  parallelWorkers: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Objective  (Chapter 4.7 §10, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export type OptimizationObjective =
  | 'PREDICTION_ACCURACY'
  | 'GENERALIZATION'
  | 'CV_STABILITY'
  | 'MODEL_COMPLEXITY'
  | 'INFERENCE_LATENCY'
  | 'MEMORY_CONSUMPTION'
  | 'MODEL_SIZE'
  | 'CALIBRATION_QUALITY'
  | 'RESOURCE_EFFICIENCY'

export interface MultiObjectiveConfig {
  objectives: Array<{ objective: OptimizationObjective; weight: number; maximize: boolean }>
  // Rule 17 — penalize high variance across CV folds
  cvStabilityPenalty: number // weight of variance penalty (0 = no penalty, 1 = full penalty)
  cvVarianceThreshold: number // configs with variance above this are penalized
  // Pareto-based or weighted
  mode: 'WEIGHTED' | 'PARETO'
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection Bias Control  (Chapter 4.7 §10.1, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export type BiasCorrectionMethod =
  | 'DEFLATED_SHARPE_RATIO'
  | 'BONFERRONI'
  | 'FALSE_DISCOVERY_RATE'
  | 'MULTIPLE_TESTING_ADJUSTMENT'
  | 'STATISTICAL_SIGNIFICANCE_THRESHOLD'

export interface SelectionBiasConfig {
  method: BiasCorrectionMethod
  significanceLevel: number // e.g. 0.05
  numTrials: number // number of trials for multiple testing correction
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Result  (Chapter 4.7 §4 — Output Contract)
// Immutable (Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export interface OptimizationResult {
  optimizationId: string
  bestHyperparameters: Record<string, unknown>
  bestTrialId: string
  searchSpaceVersion: string
  optimizationStrategy: OptimizationStrategy
  trialHistory: OptimizationTrial[]
  bestTrial: OptimizationTrial
  performanceSummary: OptimizationPerformanceSummary
  optimizationMetadata: OptimizationMetadata
  resourceUsage: ResourceConsumption
  version: number
  createdAt: number
  // Rule 16 — selection bias adjusted score
  biasAdjustedScore: number | null
  biasCorrectionMethod: BiasCorrectionMethod | null
  // Rule 18 — test isolation confirmed
  testDatasetAccessed: false
}

export interface OptimizationPerformanceSummary {
  bestScore: number
  bestCvVariance: number | null
  meanScore: number
  stdScore: number
  totalTrials: number
  completedTrials: number
  prunedTrials: number
  failedTrials: number
  searchEfficiency: number // completed / total
}

export interface OptimizationMetadata {
  optimizationVersion: string
  searchSpaceVersion: string
  strategyVersion: string
  datasetVersion: string
  modelVersion: string
  featureVersion: string
  configVersion: string
  parentExperimentId: string | null
  trainingPipelineVersion: string
}

export const HPOE_VERSION = '1.0.0'
export const SEARCH_SPACE_VERSION = '1.0.0'
export const STRATEGY_VERSION = '1.0.0'
