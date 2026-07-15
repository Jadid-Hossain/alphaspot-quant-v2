// CHAPTER 4.10 — Explainable AI Framework Types
//
// The XAI Framework generates governed explanations for AI predictions (§1).
// Independent of training/features/deployment (Rule 2). Unique Explanation ID (Rule 3).
// Historical immutable (Rule 5). Local ≠ Global (Rule 7). Counterfactuals never
// modify history (Rule 9). Explanation confidence ≠ prediction confidence (Rule 12).
// Async decoupled from predictions (Rule 16). Attribution drift independent (Rule 18).

// ─────────────────────────────────────────────────────────────────────────────
// Explanation Types  (Chapter 4.10 §5)
// ─────────────────────────────────────────────────────────────────────────────

export type ExplanationScope = 'LOCAL' | 'GLOBAL' | 'ENSEMBLE'

export type ExplanationMethod =
  // Local (§7)
  | 'SHAP' | 'TREE_SHAP' | 'DEEP_SHAP' | 'INTEGRATED_GRADIENTS'
  | 'LIME' | 'LRP' | 'GRAD_CAM' | 'SCORE_CAM' | 'ATTENTION' | 'FEATURE_CONTRIBUTION'
  // Global (§6)
  | 'GLOBAL_SHAP' | 'PERMUTATION_IMPORTANCE' | 'PARTIAL_DEPENDENCE' | 'ALE'
  | 'FEATURE_INTERACTION' | 'FEATURE_RANKING' | 'CONTRIBUTION_DISTRIBUTION'
  // Counterfactual (§10)
  | 'COUNTERFACTUAL'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Attribution  (Chapter 4.10 §8, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureAttribution {
  featureName: string
  attributionScore: number // signed: positive = contributed positively, negative = negatively
  magnitude: number // absolute value
  normalizedContribution: number // 0..1 (sums to 1 across all features)
  rank: number // 1 = most important
  direction: 'positive' | 'negative' | 'neutral'
  interactionEffects: Array<{ withFeature: string; interactionScore: number }> | null
  attributionConfidence: number // 0..1 — confidence in this attribution
}

// ─────────────────────────────────────────────────────────────────────────────
// Counterfactual Result  (Chapter 4.10 §10, Rule 9)
// Rule 9 — never modifies historical predictions. Hypothetical only.
// ─────────────────────────────────────────────────────────────────────────────

export interface CounterfactualResult {
  originalPrediction: number
  counterfactualPrediction: number
  featureChanges: Array<{ feature: string; originalValue: number; counterfactualValue: number; change: number }>
  decisionBoundaryDistance: number | null
  predictionSensitivity: number // 0..1
  actionable: boolean
  constraintsSatisfied: boolean
  // Rule 9 — explicitly hypothetical
  isHypothetical: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Explanation Stability  (Chapter 4.10 §11, Rule 13, Rule 18)
// ─────────────────────────────────────────────────────────────────────────────

export type DriftMethod = 'WASSERSTEIN' | 'JENSEN_SHANNON' | 'PSI' | 'KOLMOGOROV_SMIRNOV' | 'DISTRIBUTION_SHIFT'

export interface ExplanationStability {
  temporalStability: number // 0..1
  regimeStability: number // 0..1
  featureAttributionStability: number // 0..1
  methodConsistency: number // 0..1
  explanationVariance: number // 0..1
  attributionDrift: number // 0..1 (higher = more drift)
  crossVersionStability: number // 0..1
  attributionDistributionStability: number // 0..1
  overallStability: number // 0..1
  driftAlertTriggered: boolean // Rule 18 — independent from feature drift
}

export interface AttributionDriftReport {
  method: DriftMethod
  driftScore: number
  threshold: number
  isDrifting: boolean
  isSignificant: boolean
  // Rule 18 — independent from feature drift
  featureDriftUnchanged: boolean
  // Rule 18 — never auto-modify
  autoActionTaken: false
  governanceAlertPublished: boolean
  detectedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Explanation  (Chapter 4.10 §9, Rule 11, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstituentModelExplanation {
  modelId: string
  modelAttributions: FeatureAttribution[]
  modelContribution: number // normalized weight from Ch 4.9
}

export interface EnsembleExplanation {
  unifiedAttributions: FeatureAttribution[] // aggregated using normalized weights (Rule 17)
  constituentExplanations: ConstituentModelExplanation[]
  crossModelAgreement: number // 0..1
  crossModelDisagreement: number // 0..1
  hierarchicalLayers: number
  // Rule 11 — complete attribution lineage
  attributionLineage: Array<{ layer: number; modelId: string; contribution: number }>
  // Rule 17 — aggregation method
  aggregationMethod: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Explanation Result  (Chapter 4.10 §4 — Output Contract, Rule 5 immutable)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExplanationResult {
  explanationId: string
  explanationVersion: string
  predictionId: string
  modelVersion: string
  ensembleVersion: string | null
  explanationMethod: ExplanationMethod
  explanationScope: ExplanationScope
  featureAttributions: FeatureAttribution[]
  predictionDrivers: string[] // top factors
  counterfactualResults: CounterfactualResult[] | null
  // Rule 12 — explanation confidence ≠ prediction confidence
  explanationConfidence: number // 0..1 — quantifies explanation reliability
  explanationStability: ExplanationStability | null
  ensembleExplanation: EnsembleExplanation | null
  explanationMetadata: ExplanationMetadata
  governanceMetadata: ExplanationGovernance
  createdAt: number
  // Rule 16 — async decoupled
  asyncGenerated: boolean
}

export interface ExplanationMetadata {
  explanationVersion: string
  explanationMethodVersion: string
  modelVersion: string
  ensembleVersion: string | null
  featureVersion: string
  datasetVersion: string
  configurationVersion: string
  // Rule 6 — complete lineage
  lineage: {
    predictionId: string
    modelVersion: string
    ensembleVersion: string | null
    featureVersion: string
    datasetVersion: string
    explanationMethod: ExplanationMethod
    configurationVersion: string
  }
}

export interface ExplanationGovernance {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED'
  reviewer: string | null
  reviewTimestamp: number | null
  governanceNotes: string[]
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  retirementStatus: 'ACTIVE' | 'RETIRED' | null
}

export const XAI_VERSION = '1.0.0'
export const EXPLANATION_METHOD_VERSION = '1.0.0'
