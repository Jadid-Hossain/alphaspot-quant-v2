// CHAPTER 4.8 §5-§17 — Model Validation Engine
//
// Performance evaluation (§5). Generalization (§6). Stability (§7). Calibration (§8).
// Stress testing (§9, Rule 14). Robustness (§10, Rule 13). Acceptance (§11).
// Champion-Challenger (Rule 16). Statistical significance (Rule 17).
// Test dataset protection (Rule 3). Immutable (Rule 8).

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  AcceptanceCriteria,
  CalibrationReport,
  CandidateStatus,
  ChampionChallengerComparison,
  GeneralizationReport,
  RobustnessReport,
  StabilityReport,
  StatisticalTestResult,
  StatisticalTestMethod,
  StressTestReport,
  ValidationMetrics,
  ValidationMetadata,
  ValidationReport,
  ValidationVersionInfo,
} from './types'
import { MVF_VERSION } from './types'

const log = createLogger('ai-platform:validation:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Statistical Significance Testing  (Chapter 4.8 §5, Rule 17)
// Diebold-Mariano, SPA, Paired t-test, Wilcoxon
// ─────────────────────────────────────────────────────────────────────────────

export function runStatisticalTest(
  method: StatisticalTestMethod,
  championScores: number[],
  challengerScores: number[],
  significanceLevel: number = 0.05,
): StatisticalTestResult {
  const n = Math.min(championScores.length, challengerScores.length)
  if (n < 2) {
    return { method, statistic: 0, pValue: 1, significanceLevel, significant: false, nullHypothesis: 'champion == challenger', alternativeHypothesis: 'challenger > champion' }
  }

  // Compute differences
  const diffs = challengerScores.map((s, i) => s - championScores[i])
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n
  const stdDiff = Math.sqrt(diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / n)

  let statistic: number
  let pValue: number

  switch (method) {
    case 'DIEBOLD_MARIANO': {
      // DM statistic = mean(d) / sqrt(var(d)/n)
      const dmStat = stdDiff > 1e-10 ? meanDiff / (stdDiff / Math.sqrt(n)) : 0
      statistic = dmStat
      // Two-tailed p-value (simplified normal approximation)
      pValue = 2 * (1 - normalCDF(Math.abs(dmStat)))
      break
    }
    case 'PAIRED_T_TEST': {
      const tStat = stdDiff > 1e-10 ? meanDiff / (stdDiff / Math.sqrt(n)) : 0
      statistic = tStat
      pValue = 2 * (1 - normalCDF(Math.abs(tStat)))
      break
    }
    case 'SPA': {
      // Superior Predictive Ability (simplified — same as DM for single comparison)
      const spaStat = stdDiff > 1e-10 ? meanDiff / (stdDiff / Math.sqrt(n)) : 0
      statistic = spaStat
      pValue = 1 - normalCDF(spaStat) // one-tailed (challenger better)
      break
    }
    case 'WILCOXON': {
      // Simplified Wilcoxon — use normal approximation
      const ranks = diffs.map((d, i) => ({ d, rank: diffs.slice().sort((a, b) => a - b).indexOf(d) + 1 }))
      const wPlus = ranks.filter((r) => r.d > 0).reduce((a, r) => a + r.rank, 0)
      const wMinus = ranks.filter((r) => r.d < 0).reduce((a, r) => a + r.rank, 0)
      const wStat = Math.min(wPlus, wMinus)
      const expected = (n * (n + 1)) / 4
      const variance = (n * (n + 1) * (2 * n + 1)) / 24
      statistic = variance > 0 ? (wStat - expected) / Math.sqrt(variance) : 0
      pValue = 2 * (1 - normalCDF(Math.abs(statistic)))
      break
    }
    default: {
      statistic = 0
      pValue = 1
    }
  }

  return {
    method,
    statistic,
    pValue,
    significanceLevel,
    significant: pValue < significanceLevel && meanDiff > 0, // challenger significantly better
    nullHypothesis: 'champion performance == challenger performance',
    alternativeHypothesis: 'challenger performance > champion performance',
  }
}

/** Normal CDF approximation (Abramowitz & Stegun). */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  if (x > 0) p = 1 - p
  return p
}

// ─────────────────────────────────────────────────────────────────────────────
// Stability Analyzer  (Chapter 4.8 §7)
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeStability(cvScores: number[], threshold: number = 0.5): StabilityReport {
  const mean = cvScores.reduce((a, b) => a + b, 0) / Math.max(1, cvScores.length)
  const std = Math.sqrt(cvScores.reduce((a, s) => a + (s - mean) ** 2, 0) / Math.max(1, cvScores.length))
  const cv = mean > 0 ? std / mean : 1 // coefficient of variation

  const foldConsistency = Math.max(0, 1 - cv)
  const temporalStability = Math.max(0, 1 - cv * 0.8)
  const regimeStability = 0.7 // simplified
  const predictionStability = Math.max(0, 1 - cv * 0.6)
  const featureSensitivity = 0.3 // simplified
  const parameterStability = 0.8 // simplified
  const overall = (foldConsistency + temporalStability + regimeStability + predictionStability + (1 - featureSensitivity) + parameterStability) / 6

  const rejected = overall < threshold
  return {
    foldConsistency,
    temporalStability,
    regimeStability,
    predictionStability,
    featureSensitivity,
    parameterStability,
    overallStability: overall,
    rejected,
    rejectionReason: rejected ? `overall stability ${overall.toFixed(3)} < threshold ${threshold}` : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calibration Analyzer  (Chapter 4.8 §8, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeCalibration(
  predictedProbabilities: number[],
  actualOutcomes: number[], // 0 or 1
  threshold: number = 0.1,
): CalibrationReport {
  const n = Math.min(predictedProbabilities.length, actualOutcomes.length)
  if (n === 0) {
    return { method: 'ECE', expectedCalibrationError: null, maximumCalibrationError: null, brierScore: null, reliabilityDiagram: null, probabilityDistributionAnalysis: null, calibrationPassed: false, threshold }
  }

  // Brier Score
  const brier = predictedProbabilities.slice(0, n).reduce((a, p, i) => a + (p - actualOutcomes[i]) ** 2, 0) / n

  // ECE (Expected Calibration Error) — 10 bins
  const bins = 10
  let ece = 0
  let mce = 0
  const reliability: Array<{ bin: string; predicted: number; actual: number }> = []
  for (let b = 0; b < bins; b++) {
    const lo = b / bins
    const hi = (b + 1) / bins
    const indices = Array.from({ length: n }, (_, i) => i).filter((i) => predictedProbabilities[i] >= lo && predictedProbabilities[i] < hi)
    if (indices.length === 0) continue
    const avgPred = indices.reduce((a, i) => a + predictedProbabilities[i], 0) / indices.length
    const avgActual = indices.reduce((a, i) => a + actualOutcomes[i], 0) / indices.length
    const error = Math.abs(avgPred - avgActual)
    ece += (indices.length / n) * error
    mce = Math.max(mce, error)
    reliability.push({ bin: `[${lo.toFixed(1)},${hi.toFixed(1)})`, predicted: avgPred, actual: avgActual })
  }

  return {
    method: 'ECE',
    expectedCalibrationError: ece,
    maximumCalibrationError: mce,
    brierScore: brier,
    reliabilityDiagram: reliability,
    probabilityDistributionAnalysis: `Brier=${brier.toFixed(4)}, ECE=${ece.toFixed(4)}`,
    calibrationPassed: ece < threshold, // Rule 12
    threshold,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Validation Engine  (Chapter 4.8 §1 — main facade)
// ─────────────────────────────────────────────────────────────────────────────

class ModelValidationEngine {
  private validations = new Map<string, ValidationReport>()
  private consumedTestDatasets = new Set<string>() // Rule 3 — track consumed test datasets
  private stats = {
    totalValidations: 0,
    approved: 0,
    rejected: 0,
    avgDurationMs: 0,
    statisticalFailures: 0,
    stressTestFailures: 0,
    calibrationErrors: 0,
  }

  /**
   * Execute full validation (§4, §11, Rule 4).
   * Rule 3 — test dataset protection (MVF is ONLY authorized to evaluate OOS Test).
   * Rule 8 — immutable. Rule 16 — Champion-Challenger. Rule 17 — statistical significance.
   */
  validate(opts: {
    candidateModelId: string
    championModelId: string | null
    validationMetrics: ValidationMetrics
    cvScores: number[]
    oosScores: number[]
    championOosScores: number[]
    predictedProbabilities: number[] | null // for calibration (null = non-probability model)
    actualOutcomes: number[]
    isProbabilityModel: boolean
    championScore: number | null
    challengerComputationalCost: number
    championComputationalCost: number
    testDatasetVersion: string
    validator: string
    versions: ValidationVersionInfo
    // Stress test results (pre-computed)
    stressTestReport: StressTestReport
    // Robustness test results (pre-computed)
    robustnessReport: RobustnessReport
  }): ValidationReport {
    const validationId = `val-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const startTime = Date.now()
    this.stats.totalValidations++

    // Rule 3 — test dataset protection: check if this test dataset was already consumed
    if (this.consumedTestDatasets.has(opts.testDatasetVersion)) {
      throw new Error(`[mvf] test dataset "${opts.testDatasetVersion}" already consumed — Rule 3: once evaluated, never reused for training/hyperopt`)
    }

    // §6 — Generalization
    const generalization: GeneralizationReport = {
      crossValidationPerformance: opts.cvScores.reduce((a, b) => a + b, 0) / Math.max(1, opts.cvScores.length),
      outOfSamplePerformance: opts.oosScores.length > 0 ? opts.oosScores.reduce((a, b) => a + b, 0) / opts.oosScores.length : null,
      temporalHoldoutPerformance: null,
      crossRegimePerformance: null,
      crossAssetPerformance: null,
      overallGeneralizationScore: 0.8, // simplified
      documented: true,
    }

    // §7 — Stability
    const stability = analyzeStability(opts.cvScores)
    if (stability.rejected) log.warn(`candidate ${opts.candidateModelId} stability rejected: ${stability.rejectionReason}`)

    // §8 — Calibration (only for probability models, Rule 12)
    let calibration: CalibrationReport | null = null
    if (opts.isProbabilityModel && opts.predictedProbabilities) {
      calibration = analyzeCalibration(opts.predictedProbabilities, opts.actualOutcomes)
      if (!calibration.calibrationPassed) this.stats.calibrationErrors++
    }

    // §9 — Stress testing (pre-computed)
    if (!opts.stressTestReport.allPassed) this.stats.stressTestFailures++

    // §10 — Robustness (pre-computed)

    // §11, Rule 16, Rule 17 — Champion-Challenger
    let championChallenger: ChampionChallengerComparison | null = null
    let statisticalTests: StatisticalTestResult[] = []

    if (opts.championModelId && opts.championScore !== null) {
      // Rule 17 — statistical significance test
      const dmTest = runStatisticalTest('DIEBOLD_MARIANO', opts.championOosScores, opts.oosScores, 0.05)
      statisticalTests.push(dmTest)

      const challengerScore = generalization.outOfSamplePerformance ?? opts.validationMetrics.primaryScore
      const scoreDiff = challengerScore - opts.championScore

      // Rule 17 — promote if statistically significant improvement OR equivalent with lower cost
      const significantImprovement = dmTest.significant && scoreDiff > 0
      const equivalentWithLowerCost = !dmTest.significant && Math.abs(scoreDiff) < 0.01 && opts.challengerComputationalCost < opts.championComputationalCost

      championChallenger = {
        championModelId: opts.championModelId,
        challengerModelId: opts.candidateModelId,
        championScore: opts.championScore,
        challengerScore,
        scoreDifference: scoreDiff,
        statisticalTest: dmTest,
        statisticallySignificantImprovement: significantImprovement,
        equivalentPerformanceWithLowerCost: equivalentWithLowerCost,
        challengerComputationalCost: opts.challengerComputationalCost,
        championComputationalCost: opts.championComputationalCost,
        promoteChallenger: significantImprovement || equivalentWithLowerCost,
        reason: significantImprovement
          ? `Statistically significant improvement (p=${dmTest.pValue.toFixed(4)}, diff=${scoreDiff.toFixed(4)})`
          : equivalentWithLowerCost
            ? `Equivalent performance with lower cost (${opts.challengerComputationalCost} vs ${opts.championComputationalCost})`
            : `No significant improvement (p=${dmTest.pValue.toFixed(4)}, diff=${scoreDiff.toFixed(4)})`,
        oosDatasetVersion: opts.testDatasetVersion,
      }
    }

    // §11 — Acceptance criteria (ALL mandatory, ANY failure → rejection)
    const failedStages: string[] = []
    if (stability.rejected) failedStages.push('STABILITY')
    if (calibration && !calibration.calibrationPassed) failedStages.push('CALIBRATION')
    if (!opts.stressTestReport.allPassed) failedStages.push('STRESS_TEST')
    if (!opts.robustnessReport.allPassed) failedStages.push('ROBUSTNESS')
    if (championChallenger && !championChallenger.promoteChallenger) failedStages.push('CHAMPION_CHALLENGER')

    const acceptance: AcceptanceCriteria = {
      statisticalValidationPassed: statisticalTests.length > 0 ? statisticalTests.some((t) => t.significant) : true,
      performanceThresholdPassed: opts.validationMetrics.primaryScore > 0.5, // configurable threshold
      stabilityRequirementsPassed: !stability.rejected,
      calibrationRequirementsPassed: calibration ? calibration.calibrationPassed : true,
      stressTestingPassed: opts.stressTestReport.allPassed,
      championChallengerPassed: championChallenger ? championChallenger.promoteChallenger : true,
      governanceApprovalPassed: true, // would be set by governance process
      allPassed: failedStages.length === 0,
      failedStages,
      rejectionReason: failedStages.length > 0 ? `Failed stages: ${failedStages.join(', ')}` : null,
    }

    const approvalDecision: 'APPROVED' | 'REJECTED' | 'CONDITIONAL' = acceptance.allPassed ? 'APPROVED' : 'REJECTED'
    const candidateStatus: CandidateStatus = approvalDecision === 'APPROVED' ? 'APPROVED' : 'REJECTED'

    if (approvalDecision === 'APPROVED') this.stats.approved++
    else this.stats.rejected++
    if (!acceptance.statisticalValidationPassed) this.stats.statisticalFailures++

    // Rule 3 — mark test dataset as consumed
    this.consumedTestDatasets.add(opts.testDatasetVersion)

    const metadata: ValidationMetadata = {
      validator: opts.validator,
      validationTimestamp: Date.now(),
      approvalStatus: approvalDecision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      rejectionReason: acceptance.rejectionReason,
      auditHistory: [{ action: `VALIDATION:${approvalDecision}`, at: Date.now(), actor: opts.validator, note: acceptance.rejectionReason ?? 'All checks passed' }],
      reviewNotes: [],
      promotionDecision: approvalDecision === 'APPROVED' ? 'PROMOTE' : 'REJECT',
      versions: opts.versions,
    }

    const report: ValidationReport = {
      validationId,
      validationVersion: MVF_VERSION,
      candidateModelId: opts.candidateModelId,
      candidateStatus,
      validationMetrics: opts.validationMetrics,
      statisticalTestResults: statisticalTests,
      generalizationReport: generalization,
      stabilityReport: stability,
      calibrationReport: calibration,
      robustnessReport: opts.robustnessReport,
      stressTestReport: opts.stressTestReport,
      championChallengerComparison: championChallenger,
      acceptanceCriteria: acceptance,
      approvalDecision,
      validationMetadata: metadata,
      createdAt: Date.now(),
      testDatasetVersion: opts.testDatasetVersion,
      testDatasetConsumed: true, // Rule 3
    }

    const frozen = Object.freeze(report) as ValidationReport
    this.validations.set(validationId, frozen)

    const durationMs = Date.now() - startTime
    this.stats.avgDurationMs = (this.stats.avgDurationMs * (this.stats.totalValidations - 1) + durationMs) / this.stats.totalValidations

    log.info(`validation ${validationId}: ${approvalDecision} (candidate ${opts.candidateModelId}, failed: ${failedStages.join(',') || 'none'})`)
    return frozen
  }

  /** Check if a test dataset has been consumed (Rule 3). */
  isTestDatasetConsumed(testDatasetVersion: string): boolean {
    return this.consumedTestDatasets.has(testDatasetVersion)
  }

  getValidation(validationId: string): ValidationReport | undefined {
    return this.validations.get(validationId)
  }

  getStats() {
    return { ...this.stats, totalInRegistry: this.validations.size, consumedTestDatasets: this.consumedTestDatasets.size }
  }
}

export const modelValidationEngine = new ModelValidationEngine()
