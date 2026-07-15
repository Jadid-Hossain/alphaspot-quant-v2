// CHAPTER 4.9 — Model Ensemble Engine Types
//
// The MEE combines validated models into unified predictions (§1).
// Deterministic (Rule 2). Constituent models independent (Rule 3).
// Historical immutable (Rule 7). Confidence ≠ Uncertainty (Rule 8).
// I/O = Canonical Prediction Tuple (Rule 16). OOF-only stacking (Rule 17).
// Graceful degradation (Rule 18).

import type { CanonicalPredictionTuple } from '../models/types'

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Strategies  (Chapter 4.9 §5, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export type EnsembleStrategy =
  | 'WEIGHTED_AVERAGING'
  | 'MAJORITY_VOTING'
  | 'PROBABILITY_AVERAGING'
  | 'RANK_AGGREGATION'
  | 'STACKING'
  | 'BLENDING'
  | 'META_ENSEMBLE'
  | 'HIERARCHICAL'

// ─────────────────────────────────────────────────────────────────────────────
// Model Contribution  (Chapter 4.9 §4, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelContribution {
  modelId: string
  /** The prediction tuple from this constituent model. */
  prediction: CanonicalPredictionTuple
  /** Normalized weight (0..1, all contributions sum to 1). */
  normalizedWeight: number
  /** Whether this model was active for this prediction. */
  active: boolean
  /** Reason if inactive (graceful degradation Rule 18). */
  inactiveReason: string | null
  /** Individual confidence. */
  confidence: number
  /** Individual uncertainty. */
  uncertainty: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Prediction  (Chapter 4.9 §4 — Output Contract, Rule 16)
// Output = Canonical Prediction Tuple + ensemble metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsemblePrediction extends CanonicalPredictionTuple {
  // Ensemble-specific metadata (in addition to the Canonical Prediction Tuple fields)
  ensembleId: string
  ensembleVersion: string
  ensembleStrategy: EnsembleStrategy
  constituentModels: ModelContribution[]
  modelContributions: Array<{ modelId: string; contribution: number }> // simplified
  activeModelCount: number
  missingModelCount: number
  weightDistribution: Record<string, number>
  ensembleHealthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  aggregationStrategy: string
  // Lineage
  lineage: EnsembleLineage
}

export interface EnsembleLineage {
  ensembleVersion: string
  strategyVersion: string
  modelVersions: string[]
  weightVersion: string
  configurationVersion: string
  validationVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Config  (Chapter 4.9 §5-§9)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsembleConfig {
  ensembleId: string
  strategy: EnsembleStrategy
  constituentModelIds: string[]
  weights: Record<string, number> // modelId → weight
  // §7 — Dynamic selection criteria
  dynamicSelection: DynamicSelectionConfig | null
  // §14, Rule 18 — Graceful degradation
  minQuorum: number // minimum fraction of models that must be available (0..1)
  // Versioning (§12, Rule 5, Rule 9)
  version: EnsembleVersion
}

export interface DynamicSelectionConfig {
  enabled: boolean
  regimeFilter: boolean
  volatilityFilter: boolean
  liquidityFilter: boolean
  healthFilter: boolean
}

export interface EnsembleVersion {
  ensembleVersion: string
  strategyVersion: string
  modelVersions: string[]
  weightVersion: string
  configurationVersion: string
  validationVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Diversity Report  (Chapter 4.9 §10, Rule 11)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiversityReport {
  predictionCorrelation: Record<string, Record<string, number>> // modelId → modelId → correlation
  errorCorrelation: Record<string, Record<string, number>> | null
  featureSimilarity: Record<string, Record<string, number>> | null
  algorithmDiversity: number // 0..1 (1 = diverse)
  trainingDiversity: number // 0..1
  overallDiversity: number // 0..1
  redundantModels: string[] // models recommended for reduced weighting
  recommendation: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Governance  (Chapter 4.9 §13)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsembleGovernance {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  creationTimestamp: number
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string }>
  governanceNotes: string[]
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  retirementReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful Degradation  (Chapter 4.9 §14, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface GracefulDegradationResult {
  availableModels: string[]
  unavailableModels: Array<{ modelId: string; reason: string }>
  quorumSatisfied: boolean
  renormalizedWeights: Record<string, number>
  uncertaintyIncrease: number // how much epistemic uncertainty was increased
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
}

export const ENSEMBLE_VERSION = '1.0.0'
export const STRATEGY_VERSION = '1.0.0'
