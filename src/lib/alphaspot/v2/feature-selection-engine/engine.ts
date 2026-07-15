// CHAPTER 6.4 §6 — AI Feature Selection & Feature Intelligence Engine (AFSFIE)
//
// §1 — The exclusive feature optimization layer between the AI Label Engineering
//      Engine (Chapter 6.3) and every downstream AI Training Engine. No AI model
//      may independently select or discard features.
//
// Dual feature ecosystems (§3):
//   • Pipeline A — Swing Trading Feature Intelligence (stability/robustness)
//   • Pipeline B — Instant Scalping Feature Intelligence (responsiveness/latency)
//
// Dual evaluation environments (§7):
//   • Local Runtime — lightweight methods (variance, correlation, MI, stability)
//   • Offline Research — Python/Colab heavy methods (SHAP, Boruta, RFE, mRMR)
//
// 16-stage feature selection pipeline (§6).
// 22 architectural rules enforced (see §17), including the critical:
//   Rule 21 — Feature selection ONLY on TRAIN partition (no val/test leakage)
//   Rule 22 — Runtime consumes only immutable Feature Manifests (no heavy compute)

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  AFSFIEConfiguration,
  CanonicalFeatureSelectionContract,
  CorrelationReport,
  EvaluationEnvironment,
  FeatureGovernanceMetadata,
  FeatureImportanceSnapshot,
  FeatureLineage,
  FeatureManifest,
  FeatureQualityScore,
  FeatureRegistryEntry,
  FeatureSelectionConfiguration,
  FeatureSelectionInput,
  FeatureStabilityScore,
  FeatureValidationReport,
  FeatureVersionBundle,
  LocalEvaluationMethod,
  OfflineResearchMethod,
  PublicationStatus,
  RedundancyReport,
  ResearchPipeline,
} from './types'
import { AFSFIE_VERSION, FEATURE_SELECTION_SCHEMA_VERSION, FEATURE_SELECTION_STAGES } from './types'
import {
  afsfieObservabilityCollector,
  configurationValidator,
  correlationAnalyzer,
  featureContractGenerator,
  featureFailureRecovery,
  featureGovernanceManager,
  featureLineageTracker,
  featureQualityEvaluator,
  featureRegistry,
  featureSelector,
  featureValidator,
  governedDataRetriever,
  importanceRanker,
  manifestGenerator,
  redundancyEliminator,
  stabilityEvaluator,
  versionManager,
} from './subsystems'

const log = createLogger('ai-platform:feature-selection:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureSelectionResult {
  contract: CanonicalFeatureSelectionContract | null
  registryEntry: FeatureRegistryEntry | null
  success: boolean
  failureReason: string | null
  latencyMs: number
  pipeline: ResearchPipeline
  evaluationEnvironment: EvaluationEnvironment
}

// ─────────────────────────────────────────────────────────────────────────────
// AIFeatureSelectionIntelligenceEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AIFeatureSelectionIntelligenceEngine {
  private readonly history: CanonicalFeatureSelectionContract[] = []
  private readonly MAX_HISTORY = 500

  /**
   * §6 — Feature Selection Pipeline (16 stages).
   *
   * Rule 1   — Only governed datasets and governed label sets may participate.
   * Rule 2   — Unique Feature Event ID.
   * Rule 3   — Canonical Feature Selection Contract.
   * Rule 4   — Historical feature sets immutable.
   * Rule 5   — Complete lineage preserved.
   * Rule 6   — Feature selection never modifies source datasets or labels.
   * Rule 7   — Swing and Scalping feature ecosystems permanently isolated.
   * Rule 8   — Feature evaluation uses only historical observation window data.
   * Rule 9   — Feature leakage strictly prohibited.
   * Rule 10  — Deterministic under identical inputs.
   * Rule 11  — Deterministic replay.
   * Rule 12  — Methodologies independently configurable.
   * Rule 13  — Publication failures never publish partial feature sets.
   * Rule 14  — Complete Feature Manifest.
   * Rule 15  — Deterministic timestamp ordering.
   * Rule 16  — Registry entries immutable.
   * Rule 17  — Methodologies pluggable.
   * Rule 18  — Reproducible from immutable versions.
   * Rule 19  — Importance rankings version controlled.
   * Rule 20  — Governs only feature selection.
   * Rule 21  — Feature selection ONLY on TRAIN partition (val/test prohibited).
   * Rule 22  — Runtime consumes only immutable Feature Manifests.
   */
  selectFeatures(params: {
    input: FeatureSelectionInput
    selectionConfig: FeatureSelectionConfiguration
    config: AFSFIEConfiguration
    versions: FeatureVersionBundle
    /** Offline research: pre-computed importance scores from Python/Colab. */
    offlineImportanceScores?: Map<string, number>
    approvingActor: string
    approvalNote: string
  }): FeatureSelectionResult {
    const startTime = Date.now()
    const { input, selectionConfig, config, versions, offlineImportanceScores } = params
    const pipelineStages: CanonicalFeatureSelectionContract['pipelineStages'] = []

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        afsfieObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        afsfieObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    let retrieved: ReturnType<typeof governedDataRetriever.retrieve>
    let qualityScores: FeatureQualityScore[]
    let correlationReport: CorrelationReport
    let redundancyReport: RedundancyReport
    let importanceSnapshot: FeatureImportanceSnapshot
    let stabilityScores: FeatureStabilityScore[]
    let selectedFeatures: string[]
    let validationReport: FeatureValidationReport
    let governanceMetadata: FeatureGovernanceMetadata
    let lineage: FeatureLineage
    let manifest: FeatureManifest
    let contract: CanonicalFeatureSelectionContract | null = null
    let registryEntry: FeatureRegistryEntry | null = null
    let trainOnlyVerified = false

    try {
      const pipeline = selectionConfig.researchPipeline
      const environment = selectionConfig.evaluationEnvironment

      // Stage 1 — GOVERNED_DATASET_RETRIEVAL (Rule 1, Rule 21)
      track('GOVERNED_DATASET_RETRIEVAL', () => {
        retrieved = governedDataRetriever.retrieve(input)
        if (!retrieved.valid) {
          throw new Error(`Rule 1: governed data retrieval failed: ${retrieved.errors.join('; ')}`)
        }
      })

      // Stage 2 — GOVERNED_LABEL_RETRIEVAL (Rule 1)
      track('GOVERNED_LABEL_RETRIEVAL', () => {
        // Labels already retrieved in stage 1 — verify they exist
        if (retrieved!.sourceLabelIds.length === 0) {
          throw new Error('Rule 1: no governed label sets provided')
        }
      })

      // Stage 3 — CONFIGURATION_VALIDATION (Rule 7, Rule 21, Rule 22)
      track('CONFIGURATION_VALIDATION', () => {
        const result = configurationValidator.validate(selectionConfig, config)
        if (!result.valid) {
          throw new Error(`configuration validation failed: ${result.errors.join('; ')}`)
        }
        // Rule 21 — Verify train-only
        if (config.enforceTrainOnlySelection && selectionConfig.trainPartitionOnly !== true) {
          throw new Error('Rule 21: trainPartitionOnly must be true')
        }
        trainOnlyVerified = input.validationPartitionIncluded === false && input.testPartitionIncluded === false
      })

      // Stage 4 — FEATURE_QUALITY_EVALUATION (Rule 8, Rule 21)
      track('FEATURE_QUALITY_EVALUATION', () => {
        // Rule 21 — Evaluate ONLY on train partition data
        qualityScores = featureQualityEvaluator.evaluate({
          trainData: input.trainPartitionData,
          featureIds: selectionConfig.candidateFeatureIds,
          timestamps: input.trainPartitionTimestamps,
          config,
        })
      })

      // Stage 5 — CORRELATION_ANALYSIS (Rule 8)
      track('CORRELATION_ANALYSIS', () => {
        correlationReport = correlationAnalyzer.analyze({
          trainData: input.trainPartitionData, // Rule 21 — train only
          featureIds: selectionConfig.candidateFeatureIds,
          threshold: selectionConfig.correlationThreshold,
        })
        if (correlationReport.highCorrelationFeatures.length > 0) {
          afsfieObservabilityCollector.recordCorrelationViolation()
        }
      })

      // Stage 6 — REDUNDANCY_ELIMINATION
      track('REDUNDANCY_ELIMINATION', () => {
        redundancyReport = redundancyEliminator.eliminate({
          correlationReport: correlationReport!,
          qualityScores: qualityScores!,
          threshold: selectionConfig.correlationThreshold,
        })
      })

      // Stage 7 — IMPORTANCE_RANKING (Rule 19, Rule 21)
      track('IMPORTANCE_RANKING', () => {
        const method = environment === 'LOCAL_RUNTIME'
          ? (selectionConfig.selectionMethods[0] as LocalEvaluationMethod)
          : (selectionConfig.selectionMethods[0] as OfflineResearchMethod)
        importanceSnapshot = importanceRanker.rank({
          trainData: input.trainPartitionData, // Rule 21 — train only
          featureIds: selectionConfig.candidateFeatureIds,
          qualityScores: qualityScores!,
          method,
          environment,
          rankingVersion: selectionConfig.importanceRankingVersion, // Rule 19
          offlineImportanceScores, // §7B — pre-computed from Python/Colab
        })
        const avgImp = importanceSnapshot.rankings.reduce((s, r) => s + r.importance, 0) / importanceSnapshot.rankings.length
        afsfieObservabilityCollector.recordAvgImportance(avgImp)
      })

      // Stage 8 — STABILITY_EVALUATION (Rule 8, Rule 21)
      track('STABILITY_EVALUATION', () => {
        stabilityScores = stabilityEvaluator.evaluate({
          trainData: input.trainPartitionData, // Rule 21 — train only
          featureIds: selectionConfig.candidateFeatureIds,
          timestamps: input.trainPartitionTimestamps,
        })
      })

      // Stage 9 — FEATURE_SELECTION (Rule 21)
      track('FEATURE_SELECTION', () => {
        selectedFeatures = featureSelector.select({
          candidateFeatureIds: selectionConfig.candidateFeatureIds,
          qualityScores: qualityScores!,
          stabilityScores: stabilityScores!,
          importanceSnapshot: importanceSnapshot!,
          redundancyReport: redundancyReport!,
          correlationReport: correlationReport!,
          maxFeatures: selectionConfig.maxFeatures,
          minQualityScore: selectionConfig.minQualityScore,
          minStabilityScore: selectionConfig.minStabilityScore,
        })
        if (selectedFeatures.length === 0) {
          throw new Error('feature selection produced empty set — check quality/stability thresholds')
        }
        const avgQuality = qualityScores!.filter((q) => selectedFeatures!.includes(q.featureId)).reduce((s, q) => s + q.overallScore, 0) / selectedFeatures!.length
        afsfieObservabilityCollector.recordQualityScore(avgQuality)
      })

      // Stage 10 — VALIDATION (Rule 16, Rule 21)
      track('VALIDATION', () => {
        validationReport = featureValidator.validate({
          selectedFeatures: selectedFeatures!,
          candidateFeatureIds: selectionConfig.candidateFeatureIds,
          qualityScores: qualityScores!,
          correlationReport: correlationReport!,
          config,
          trainOnlyVerified, // Rule 21
        })
        if (!validationReport.overallPassed) {
          afsfieObservabilityCollector.recordValidationFailure()
          throw new Error(
            `validation failed — ${validationReport.checks.filter((c) => !c.passed).map((c) => c.checkName).join(', ')}`,
          )
        }
        // Rule 21 — Verify train-only selection
        if (config.enforceTrainOnlySelection && !validationReport.trainOnlySelectionVerified) {
          throw new Error('Rule 21: train-only selection not verified')
        }
      })

      // Stage 11 — VERSION_ASSIGNMENT (Rule 4, Rule 11, Rule 19)
      track('VERSION_ASSIGNMENT', () => {
        const existing = featureRegistry.getHistory(selectionConfig.featureSetIdentifier)
        versions.featureVersion = versionManager.assignVersion(existing.map((e) => e.featureSetVersion))
      })

      // Stage 12 — GOVERNANCE_VALIDATION (§12)
      track('GOVERNANCE_VALIDATION', () => {
        governanceMetadata = featureGovernanceManager.createInitial({
          crossPipelineApproved: selectionConfig.crossPipelineApproved,
          approvalReviewer: params.approvingActor,
          researchExperimentId: selectionConfig.researchExperimentId,
          researchEnvironment: environment,
        })
        governanceMetadata = featureGovernanceManager.markValidated(governanceMetadata)
        governanceMetadata = featureGovernanceManager.approve(governanceMetadata, params.approvingActor, params.approvalNote)
        afsfieObservabilityCollector.recordGovernanceEvent()
      })

      // Stage 13 — IMMUTABLE_PUBLICATION (Rule 3, Rule 4, Rule 13, Rule 14, Rule 22)
      track('IMMUTABLE_PUBLICATION', () => {
        lineage = featureLineageTracker.build({
          sourceDatasetIds: retrieved!.sourceDatasetIds,
          sourceDatasetVersions: retrieved!.sourceDatasetVersions,
          sourceLabelIds: retrieved!.sourceLabelIds,
          sourceLabelVersions: retrieved!.sourceLabelVersions,
          sourceDatasetRegistryEntryIds: retrieved!.sourceDatasetRegistryEntryIds,
          sourceLabelRegistryEntryIds: retrieved!.sourceLabelRegistryEntryIds,
          sourceFeatureMetadataVersions: input.featureMetadata.map((f) => f.version),
          researchConfigurationVersionIds: input.researchConfiguration.map((r) => `${r.researchId}@${r.version}`),
          governanceEventIds: input.governanceMetadata.map((g) => g.governanceId),
          registryEntryIds: [],
          publicationMetadataIds: [],
          upstreamEngines: retrieved!.upstreamEngines,
        })

        // Preliminary content hash
        const preliminaryHash = versionManager.computeContentHash({
          featureSetIdentifier: selectionConfig.featureSetIdentifier,
          featureSetVersion: versions.featureVersion,
          researchPipeline: pipeline,
          selectedFeatures: selectedFeatures!,
          evaluationEnvironment: environment,
          importanceRankings: importanceSnapshot!,
        } as CanonicalFeatureSelectionContract)

        manifest = manifestGenerator.generate({
          featureSetIdentifier: selectionConfig.featureSetIdentifier,
          featureSetVersion: versions.featureVersion,
          selectedFeatures: selectedFeatures!,
          importanceSnapshot: importanceSnapshot!,
          qualityScores: qualityScores!,
          stabilityScores: stabilityScores!,
          correlationReport: correlationReport!,
          redundancyReport: redundancyReport!,
          contentHash: preliminaryHash,
        })

        contract = featureContractGenerator.generate({
          selectionConfiguration: selectionConfig,
          versions,
          selectedFeatures: selectedFeatures!,
          importanceRankings: importanceSnapshot!,
          qualityScores: qualityScores!,
          stabilityScores: stabilityScores!,
          correlationReport: correlationReport!,
          redundancyReport: redundancyReport!,
          validationReport: validationReport!,
          lineage: lineage!,
          governanceMetadata: governanceMetadata!,
          featureManifest: manifest!,
          pipelineStages,
        })

        // Compute final content hash (Rule 11/18)
        contract!.contentHash = versionManager.computeContentHash(contract!)

        // Rule 4 — Freeze the contract
        contract!.publicationStatus = 'PUBLISHED' as PublicationStatus
        Object.freeze(contract)
        Object.freeze(contract!.governanceMetadata)
        Object.freeze(contract!.lineage)
        Object.freeze(contract!.importanceRankings)
        Object.freeze(contract!.validationReport)
        Object.freeze(contract!.featureManifest)
      })

      // Stage 14 — REGISTRY_REGISTRATION (Rule 16)
      track('REGISTRY_REGISTRATION', () => {
        registryEntry = {
          featureSetIdentifier: contract!.featureSetIdentifier,
          featureSetVersion: contract!.featureSetVersion,
          datasetVersion: versions.datasetVersion,
          labelVersion: versions.labelVersion,
          selectionMethod: selectionConfig.selectionMethods.join(','),
          configurationVersion: contract!.configurationVersion,
          creationTimestamp: contract!.createdAt,
          governanceStatus: contract!.governanceMetadata.approvalStatus,
          qualityScore: contract!.qualityScores.reduce((s, q) => s + q.overallScore, 0) / Math.max(1, contract!.qualityScores.length),
          storageLocation: `feature-registry://persistent/${contract!.featureEventId}`,
          featureSelectionMethod: selectionConfig.selectionMethods.join(','),
          featureImportanceSnapshot: contract!.importanceRankings,
          researchExperimentId: selectionConfig.researchExperimentId,
          researchEnvironment: environment,
          approvalReviewer: params.approvingActor,
          featureManifestId: contract!.featureManifest.manifestId,
          featureEventId: contract!.featureEventId,
          immutable: true, // Rule 16
        }
        featureRegistry.register(registryEntry)
        afsfieObservabilityCollector.recordRegistryPublication()
      })

      // Stage 15 — METADATA_RECORDING (§12)
      track('METADATA_RECORDING', () => {
        if (!contract) throw new Error('contract not generated')
        this.recordHistory(contract)
        afsfieObservabilityCollector.recordFeatureSetGenerated()
      })

      // Stage 16 — FEATURE_SELECTION_COMPLETION
      track('FEATURE_SELECTION_COMPLETION', () => {
        log.info(
          `feature set published: ${contract?.featureSetIdentifier} ${contract?.featureSetVersion} ` +
          `(pipeline=${contract?.researchPipeline}, env=${contract?.evaluationEnvironment}, ` +
          `selected=${contract?.selectedFeatures.length}/${selectionConfig.candidateFeatureIds.length}, ` +
          `redundant=${redundancyReport!.removedFeatures.length})`,
        )
      })

      afsfieObservabilityCollector.recordSelectionTime(Date.now() - startTime)

      return {
        contract,
        registryEntry,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
        pipeline: selectionConfig.researchPipeline,
        evaluationEnvironment: environment,
      }
    } catch (e) {
      // Rule 13 — Publication failures never publish partial feature sets
      featureFailureRecovery.quarantine(selectionConfig.featureSetIdentifier, (e as Error).message)
      afsfieObservabilityCollector.recordPublicationFailure()
      log.error(`feature selection failed: ${(e as Error).message}`)
      return {
        contract: null,
        registryEntry: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
        pipeline: selectionConfig.researchPipeline,
        evaluationEnvironment: selectionConfig.evaluationEnvironment,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // §3 — Dual Workflow Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * §3 Pipeline A — Swing Trading Feature Intelligence.
   * §7A — Local runtime evaluation (lightweight methods).
   * Prioritizes stability, robustness, and predictive persistence.
   */
  selectSwingFeaturesLocal(params: {
    input: FeatureSelectionInput
    config: AFSFIEConfiguration
    versions: FeatureVersionBundle
    candidateFeatureIds: string[]
    maxFeatures: number
    approvingActor: string
  }): FeatureSelectionResult {
    const selectionConfig: FeatureSelectionConfiguration = {
      featureSetIdentifier: `swing-features-${Date.now()}`,
      researchPipeline: 'SWING',
      evaluationEnvironment: 'LOCAL_RUNTIME', // §7A
      selectionMethods: ['MUTUAL_INFORMATION', 'CORRELATION_FILTERING', 'TEMPORAL_STABILITY_ANALYSIS'],
      candidateFeatureIds: params.candidateFeatureIds,
      featureCategories: ['TREND', 'MOMENTUM', 'VOLATILITY', 'MACRO', 'CROSS_ASSET_CORRELATION', 'MARKET_REGIME', 'ALTERNATIVE_DATA', 'LIQUIDITY', 'LONG_TERM_STATISTICAL'],
      sourceDatasetEventIds: params.input.governedDatasets.map((d) => d.datasetEventId),
      sourceLabelEventIds: params.input.governedLabels.map((l) => l.labelEventId),
      trainPartitionOnly: true, // Rule 21
      maxFeatures: params.maxFeatures,
      correlationThreshold: params.config.defaultCorrelationThreshold,
      minQualityScore: params.config.qualityThresholds.minPredictivePower,
      minStabilityScore: params.config.qualityThresholds.minStability,
      crossPipelineApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      importanceRankingVersion: params.versions.featureVersion ?? '1.0.0',
      researchExperimentId: null,
    }

    return this.selectFeatures({
      input: params.input,
      selectionConfig,
      config: params.config,
      versions: params.versions,
      approvingActor: params.approvingActor,
      approvalNote: 'Swing feature selection (Pipeline A) — local runtime evaluation',
    })
  }

  /**
   * §3 Pipeline B — Instant Scalping Feature Intelligence.
   * §7A — Local runtime evaluation (lightweight methods).
   * Prioritizes responsiveness, execution quality, and ultra-low-latency predictive power.
   */
  selectScalpingFeaturesLocal(params: {
    input: FeatureSelectionInput
    config: AFSFIEConfiguration
    versions: FeatureVersionBundle
    candidateFeatureIds: string[]
    maxFeatures: number
    approvingActor: string
  }): FeatureSelectionResult {
    const selectionConfig: FeatureSelectionConfiguration = {
      featureSetIdentifier: `scalping-features-${Date.now()}`,
      researchPipeline: 'INSTANT_SCALPING',
      evaluationEnvironment: 'LOCAL_RUNTIME', // §7A
      selectionMethods: ['MUTUAL_INFORMATION', 'CORRELATION_FILTERING', 'STATISTICAL_STABILITY_ANALYSIS'],
      candidateFeatureIds: params.candidateFeatureIds,
      featureCategories: ['ORDER_BOOK', 'TRADE_FLOW', 'MICROSTRUCTURE', 'SPREAD_DYNAMICS', 'LIQUIDITY_IMBALANCE', 'QUEUE_POSITION', 'EXECUTION_COST', 'SHORT_TERM_MOMENTUM', 'LATENCY_AWARE'],
      sourceDatasetEventIds: params.input.governedDatasets.map((d) => d.datasetEventId),
      sourceLabelEventIds: params.input.governedLabels.map((l) => l.labelEventId),
      trainPartitionOnly: true, // Rule 21
      maxFeatures: params.maxFeatures,
      correlationThreshold: params.config.defaultCorrelationThreshold,
      minQualityScore: params.config.qualityThresholds.minPredictivePower,
      minStabilityScore: params.config.qualityThresholds.minStability,
      crossPipelineApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      importanceRankingVersion: params.versions.featureVersion ?? '1.0.0',
      researchExperimentId: null,
    }

    return this.selectFeatures({
      input: params.input,
      selectionConfig,
      config: params.config,
      versions: params.versions,
      approvingActor: params.approvingActor,
      approvalNote: 'Scalping feature selection (Pipeline B) — local runtime evaluation',
    })
  }

  /**
   * §7B — Offline Research Feature Evaluation.
   * Runs in Python/Colab. Pre-computed importance scores are passed in.
   * Rule 22 — Results published as immutable Feature Manifest for runtime consumption.
   */
  selectFeaturesOfflineResearch(params: {
    input: FeatureSelectionInput
    config: AFSFIEConfiguration
    versions: FeatureVersionBundle
    candidateFeatureIds: string[]
    maxFeatures: number
    pipeline: ResearchPipeline
    researchExperimentId: string
    offlineImportanceScores: Map<string, number>
    offlineMethod: OfflineResearchMethod
    approvingActor: string
  }): FeatureSelectionResult {
    const selectionConfig: FeatureSelectionConfiguration = {
      featureSetIdentifier: `${params.pipeline === 'SWING' ? 'swing' : 'scalping'}-features-offline-${Date.now()}`,
      researchPipeline: params.pipeline,
      evaluationEnvironment: 'OFFLINE_RESEARCH', // §7B
      selectionMethods: [params.offlineMethod],
      candidateFeatureIds: params.candidateFeatureIds,
      featureCategories: params.pipeline === 'SWING'
        ? ['TREND', 'MOMENTUM', 'VOLATILITY', 'MACRO', 'MARKET_REGIME']
        : ['ORDER_BOOK', 'TRADE_FLOW', 'MICROSTRUCTURE', 'SPREAD_DYNAMICS'],
      sourceDatasetEventIds: params.input.governedDatasets.map((d) => d.datasetEventId),
      sourceLabelEventIds: params.input.governedLabels.map((l) => l.labelEventId),
      trainPartitionOnly: true, // Rule 21 — even offline research uses train only
      maxFeatures: params.maxFeatures,
      correlationThreshold: params.config.defaultCorrelationThreshold,
      minQualityScore: params.config.qualityThresholds.minPredictivePower,
      minStabilityScore: params.config.qualityThresholds.minStability,
      crossPipelineApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      importanceRankingVersion: params.versions.featureVersion ?? '1.0.0',
      researchExperimentId: params.researchExperimentId,
    }

    return this.selectFeatures({
      input: params.input,
      selectionConfig,
      config: params.config,
      versions: params.versions,
      offlineImportanceScores: params.offlineImportanceScores,
      approvingActor: params.approvingActor,
      approvalNote: `Offline research feature selection — ${params.offlineMethod} (experiment: ${params.researchExperimentId})`,
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 11 — Deterministic Replay
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Rule 11 — Historical feature selections support deterministic replay.
   * Rule 16 — Registry entries immutable.
   */
  replayFeatureSelection(featureEventId: string): {
    recovered: boolean
    entry: FeatureRegistryEntry | null
  } {
    return featureFailureRecovery.replay(featureEventId, featureRegistry)
  }

  /**
   * Rule 16 — Get feature registry history (immutable).
   * Rule 22 — Runtime consumes manifests from these entries.
   */
  getFeatureSetHistory(featureSetIdentifier: string): FeatureRegistryEntry[] {
    return featureRegistry.getHistory(featureSetIdentifier)
  }

  getLatestFeatureSet(featureSetIdentifier: string): FeatureRegistryEntry | null {
    return featureRegistry.getLatest(featureSetIdentifier)
  }

  /**
   * §14 — Observability snapshot.
   */
  observability(): Record<string, unknown> {
    const snapshot = afsfieObservabilityCollector.snapshot()
    return {
      ...snapshot,
      registryCount: featureRegistry.count(),
    }
  }

  /**
   * §16 — List quarantined feature sets.
   */
  listQuarantined(): Array<{ featureSetIdentifier: string; reason: string; timestamp: number }> {
    return featureFailureRecovery.listQuarantined()
  }

  getContractHistory(): CanonicalFeatureSelectionContract[] {
    return this.history
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private recordHistory(contract: CanonicalFeatureSelectionContract): void {
    this.history.push(contract)
    if (this.history.length > this.MAX_HISTORY) this.history.shift()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  AFSFIE_VERSION,
  FEATURE_SELECTION_SCHEMA_VERSION,
  FEATURE_SELECTION_STAGES,
}

export const AFSFIE_ENGINE_VERSION = AFSFIE_VERSION
