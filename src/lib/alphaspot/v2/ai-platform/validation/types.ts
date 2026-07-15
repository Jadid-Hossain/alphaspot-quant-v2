// CHAPTER 4.8 — Model Validation Framework Types
//
// The MVF evaluates, stress tests, and approves models before production (§1).
// Independent of training (Rule 2). Test datasets immutable (Rule 3 — MVF is the
// ONLY subsystem authorized to evaluate OOS Test). Unique Validation ID (Rule 4).
// Only approved metrics from Ch 4.2 (Rule 5). Historical immutable (Rule 8).
// Champion-Challenger mandatory (Rule 16). Statistical significance required (Rule 17).

// ─────────────────────────────────────────────────────────────────────────────
// Candidate Status  (Chapter 4.8 §4, §11)
// ─────────────────────────────────────────────────────────────────────────────

export type CandidateStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'

// ─────────────────────────────────────────────────────────────────────────────
// Validation Metrics  (Chapter 4.8 §5)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationMetrics {
  // §5 — Performance metrics (from Ch 4.2 approved evaluation metric)
  primaryMetric: string
  primaryScore: number
  // Additional metrics
  additionalMetrics: Record<string, number>
  // Cross-validation breakdown
  cvScores: number[]
  cvMean: number
  cvStd: number
  // OOS performance
  oosScore: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Generalization Assessment  (Chapter 4.8 §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneralizationReport {
  crossValidationPerformance: number
  outOfSamplePerformance: number | null
  temporalHoldoutPerformance: number | null
  crossRegimePerformance: Record<string, number> | null // regime → score
  crossAssetPerformance: Record<string, number> | null // asset → score
  overallGeneralizationScore: number // 0..1
  documented: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Stability Analysis  (Chapter 4.8 §7)
// ─────────────────────────────────────────────────────────────────────────────

export interface StabilityReport {
  foldConsistency: number // 0..1 (1 = perfectly consistent)
  temporalStability: number // 0..1
  regimeStability: number // 0..1
  predictionStability: number // 0..1
  featureSensitivity: number // 0..1 (lower = less sensitive = more stable)
  parameterStability: number // 0..1
  overallStability: number // 0..1
  rejected: boolean // §7 — highly unstable → reject
  rejectionReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Calibration Analysis  (Chapter 4.8 §8, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export interface CalibrationReport {
  method: string
  expectedCalibrationError: number | null // ECE
  maximumCalibrationError: number | null // MCE
  brierScore: number | null
  reliabilityDiagram: Array<{ bin: string; predicted: number; actual: number }> | null
  probabilityDistributionAnalysis: string | null
  calibrationPassed: boolean // Rule 12
  threshold: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Stress Testing  (Chapter 4.8 §9, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export type StressScenario =
  | 'HIGH_VOLATILITY' | 'LOW_LIQUIDITY' | 'EXCHANGE_OUTAGE' | 'FLASH_CRASH'
  | 'EXTREME_TREND' | 'SIDEWAYS_MARKET' | 'DATA_GAP'

export interface StressTestResult {
  scenario: StressScenario
  performanceDegradation: number // % degradation from baseline
  threshold: number // max allowed degradation
  passed: boolean
  details: string
}

export interface StressTestReport {
  results: StressTestResult[]
  allPassed: boolean
  failedScenarios: StressScenario[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Robustness Testing  (Chapter 4.8 §10, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export type RobustnessPerturbation =
  | 'MISSING_FEATURES' | 'FEATURE_NOISE' | 'DELAYED_DATA'
  | 'DISTRIBUTION_SHIFT' | 'PARTIAL_DATA_LOSS' | 'INPUT_CORRUPTION'

export interface RobustnessTestResult {
  perturbation: RobustnessPerturbation
  performanceImpact: number // % impact
  threshold: number
  passed: boolean
  details: string
}

export interface RobustnessReport {
  results: RobustnessTestResult[]
  allPassed: boolean
  failedPerturbations: RobustnessPerturbation[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical Test Results  (Chapter 4.8 §5, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export type StatisticalTestMethod = 'DIEBOLD_MARIANO' | 'SPA' | 'PAIRED_T_TEST' | 'WILCOXON'

export interface StatisticalTestResult {
  method: StatisticalTestMethod
  statistic: number
  pValue: number
  significanceLevel: number // e.g. 0.05
  significant: boolean
  nullHypothesis: string
  alternativeHypothesis: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Champion-Challenger  (Chapter 4.8 §11, Rule 16, Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChampionChallengerComparison {
  championModelId: string
  challengerModelId: string
  championScore: number
  challengerScore: number
  scoreDifference: number
  // Rule 17 — statistical significance
  statisticalTest: StatisticalTestResult
  // Rule 17 — promotion criteria
  statisticallySignificantImprovement: boolean
  equivalentPerformanceWithLowerCost: boolean
  challengerComputationalCost: number
  championComputationalCost: number
  // Decision
  promoteChallenger: boolean
  reason: string
  // Identical OOS dataset used (Rule 16)
  oosDatasetVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance Criteria  (Chapter 4.8 §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface AcceptanceCriteria {
  statisticalValidationPassed: boolean
  performanceThresholdPassed: boolean
  stabilityRequirementsPassed: boolean
  calibrationRequirementsPassed: boolean
  stressTestingPassed: boolean
  championChallengerPassed: boolean
  governanceApprovalPassed: boolean
  // §11 — ANY failure → rejection
  allPassed: boolean
  failedStages: string[]
  rejectionReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Report  (Chapter 4.8 §4 — Output Contract)
// Immutable (Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationReport {
  validationId: string
  validationVersion: string
  candidateModelId: string
  candidateStatus: CandidateStatus
  validationMetrics: ValidationMetrics
  statisticalTestResults: StatisticalTestResult[]
  generalizationReport: GeneralizationReport
  stabilityReport: StabilityReport
  calibrationReport: CalibrationReport | null // null for non-probability models
  robustnessReport: RobustnessReport
  stressTestReport: StressTestReport
  championChallengerComparison: ChampionChallengerComparison | null
  acceptanceCriteria: AcceptanceCriteria
  approvalDecision: 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationMetadata: ValidationMetadata
  createdAt: number
  // Rule 3 — test dataset protection
  testDatasetVersion: string
  testDatasetConsumed: boolean // once consumed, never reused (Rule 3)
}

export interface ValidationMetadata {
  validator: string
  validationTimestamp: number
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  auditHistory: Array<{ action: string; at: number; actor: string; note: string }>
  reviewNotes: string[]
  promotionDecision: 'PROMOTE' | 'REJECT' | 'HOLD' | null
  // Versioning (§12)
  versions: ValidationVersionInfo
}

export interface ValidationVersionInfo {
  validationVersion: string
  datasetVersion: string
  featureVersion: string
  modelVersion: string
  hyperparameterVersion: string
  configurationVersion: string
  evaluationVersion: string
}

export const MVF_VERSION = '1.0.0'
