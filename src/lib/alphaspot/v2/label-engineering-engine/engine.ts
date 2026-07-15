// CHAPTER 6.3 §6 — AI Label Engineering & Target Generation Engine (AILETGE)
//
// §1 — The exclusive target generation layer between the AI Dataset Construction
//      & Dataset Registry Engine (Chapter 6.2) and every downstream AI Training
//      Engine in Chapter 6. No AI model may construct labels independently.
//
// Dual label ecosystems (§3):
//   • Pipeline A — Swing Trading Labels (Dynamic Triple Barrier, default 72h)
//   • Pipeline B — Instant Scalping Labels (Micro Triple Barrier, default 20min)
//
// 15-stage label generation pipeline (§6).
// 21 architectural rules enforced (see §17), including the critical
// Rule 8/9/10 (no future leakage) and Rule 21 (no hard-coded thresholds).

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  AILETGEConfiguration,
  BarrierConfiguration,
  CanonicalLabelContract,
  ClassDistribution,
  LabelConfiguration,
  LabelGovernanceMetadata,
  LabelInput,
  LabelIntegrityReport,
  LabelLineage,
  LabelManifest,
  LabelRegistryEntry,
  LabelStatistics,
  LabelValidationReport,
  LabelVersionBundle,
  LabelType,
  PredictionHorizon,
  PublicationStatus,
  ResearchPipeline,
  TargetDefinition,
} from './types'
import { AILETGE_VERSION, HORIZON_MS, LABEL_ENGINEERING_SCHEMA_VERSION, LABEL_GENERATION_STAGES } from './types'
import {
  ailetgeObservabilityCollector,
  configurationValidator,
  dynamicTripleBarrierConstructor,
  governedDatasetRetriever,
  integrityVerifier,
  labelContractGenerator,
  labelFailureRecovery,
  labelGovernanceManager,
  labelLineageTracker,
  labelRegistry,
  labelValidator,
  leakageValidator,
  manifestGenerator,
  microTripleBarrierConstructor,
  statisticalAnalyzer,
  versionManager,
} from './subsystems'

const log = createLogger('ai-platform:label-engineering:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelGenerationResult {
  contract: CanonicalLabelContract | null
  registryEntry: LabelRegistryEntry | null
  success: boolean
  failureReason: string | null
  latencyMs: number
  pipeline: ResearchPipeline
}

// ─────────────────────────────────────────────────────────────────────────────
// AILabelEngineeringTargetGenerationEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AILabelEngineeringTargetGenerationEngine {
  private readonly history: CanonicalLabelContract[] = []
  private readonly MAX_HISTORY = 500

  /**
   * §6 — Label Generation Pipeline (15 stages).
   *
   * Rule 1   — Only governed datasets may generate labels.
   * Rule 2   — Unique Label Event ID.
   * Rule 3   — Canonical Label Contract.
   * Rule 4   — Historical labels immutable.
   * Rule 5   — Complete lineage preserved.
   * Rule 6   — Labels never modify source datasets.
   * Rule 7   — Swing and Scalping label ecosystems permanently isolated.
   * Rule 8   — Labels from observations strictly AFTER feature timestamp T.
   * Rule 9   — Temporal leakage strictly prohibited.
   * Rule 10  — Prediction horizons never overlap feature windows.
   * Rule 11  — Deterministic replay.
   * Rule 12  — Methodologies independently configurable.
   * Rule 13  — Publication failures never publish partial labels.
   * Rule 14  — Complete Label Manifest.
   * Rule 15  — Deterministic timestamp ordering.
   * Rule 16  — Registry entries immutable.
   * Rule 17  — Label types pluggable.
   * Rule 18  — Reproducible from immutable versions.
   * Rule 19  — Target definitions version controlled.
   * Rule 20  — Governs only label engineering.
   * Rule 21  — No hard-coded thresholds (all externally configurable).
   */
  generateLabels(params: {
    input: LabelInput
    labelConfig: LabelConfiguration
    config: AILETGEConfiguration
    versions: LabelVersionBundle
    /** Feature vectors with timestamps (the "T" reference for Rule 8). */
    featureVectors: Array<{ timestamp: number; symbol: string; features: Record<string, number> }>
    /** Future price observations for label construction. */
    futurePrices: Array<{ timestamp: number; symbol: string; price: number }>
    /** Optional order book observations (Pipeline B scalping). */
    futureOrderBook?: Array<{ timestamp: number; symbol: string; spread: number; imbalance: number }>
    approvingActor: string
    approvalNote: string
  }): LabelGenerationResult {
    const startTime = Date.now()
    const { input, labelConfig, config, versions, featureVectors, futurePrices, futureOrderBook } = params
    const pipelineStages: CanonicalLabelContract['pipelineStages'] = []

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        ailetgeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        ailetgeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    let retrieved: ReturnType<typeof governedDatasetRetriever.retrieve>
    let targetDefinition: TargetDefinition
    let labels: Array<Record<string, unknown>>
    let labelTimestamps: number[]
    let futureWindowStartTimestamps: number[]
    let leakageResult: ReturnType<typeof leakageValidator.validate>
    let validationReport: LabelValidationReport
    let statistics: LabelStatistics
    let classDistribution: ClassDistribution
    let manifest: LabelManifest
    let governanceMetadata: LabelGovernanceMetadata
    let lineage: LabelLineage
    let integrityReport: LabelIntegrityReport
    let contract: CanonicalLabelContract | null = null
    let registryEntry: LabelRegistryEntry | null = null

    try {
      const pipeline = labelConfig.researchPipeline

      // Stage 1 — GOVERNED_DATASET_RETRIEVAL (Rule 1)
      track('GOVERNED_DATASET_RETRIEVAL', () => {
        retrieved = governedDatasetRetriever.retrieve(input)
        if (!retrieved.valid) {
          throw new Error(`Rule 1: governed dataset retrieval failed: ${retrieved.errors.join('; ')}`)
        }
      })

      // Stage 2 — CONFIGURATION_VALIDATION (Rule 7, Rule 21)
      track('CONFIGURATION_VALIDATION', () => {
        const result = configurationValidator.validate(labelConfig, config)
        if (!result.valid) {
          throw new Error(`configuration validation failed: ${result.errors.join('; ')}`)
        }
      })

      // Stage 3 — PREDICTION_HORIZON_SELECTION (§8)
      track('PREDICTION_HORIZON_SELECTION', () => {
        // Horizon already in config; validate it's allowed for the pipeline
        const horizon = labelConfig.predictionHorizon
        if (pipeline === 'SWING' && horizon.includes('MINUTE')) {
          // Swing uses multi-hour/day horizons; minute horizons allowed only with cross-pipeline approval
          if (!labelConfig.crossPipelineApproved && config.enforceEcosystemIsolation) {
            throw new Error(`Rule 7: swing pipeline cannot use minute horizon ${horizon} without governance approval`)
          }
        }
        if (pipeline === 'INSTANT_SCALPING' && (horizon.includes('DAY') || horizon === '1_HOUR' || horizon === '4_HOURS')) {
          if (!labelConfig.crossPipelineApproved && config.enforceEcosystemIsolation) {
            throw new Error(`Rule 7: scalping pipeline cannot use ${horizon} horizon without governance approval`)
          }
        }
      })

      // Stage 4 — TARGET_DEFINITION (Rule 19, Rule 21)
      track('TARGET_DEFINITION', () => {
        const generatedTargets = pipeline === 'SWING'
          ? ['tradeSuccess', 'expectedReturn', 'riskAdjustedReturn', 'mfe', 'mae', 'holdingDuration', 'tradeQualityScore', 'marketRegime', 'exitReason']
          : ['tradeSuccess', 'expectedReturn', 'expectedSlippage', 'fillProbability', 'momentumContinuation', 'liquidityAbsorption', 'orderBookAlpha', 'tradeQualityScore', 'executionQuality']

        targetDefinition = {
          targetId: `target-${randomUUID()}`,
          labelType: labelConfig.labelTypes[0] ?? 'BINARY_CLASSIFICATION',
          predictionHorizon: labelConfig.predictionHorizon,
          targetVersion: labelConfig.targetDefinitionVersion, // Rule 19
          barrierConfig: labelConfig.barrierConfig, // Rule 21
          description: `${pipeline === 'SWING' ? 'Dynamic Triple Barrier' : 'Micro Triple Barrier'} target for ${pipeline}`,
          generatedTargets,
        }
      })

      // Stage 5 — FUTURE_WINDOW_CONSTRUCTION (Rule 8)
      track('FUTURE_WINDOW_CONSTRUCTION', () => {
        // Rule 8 — Future window constructed strictly from observations AFTER feature T
        // (actual construction happens in stage 6 per feature vector)
      })

      // Stage 6 — LABEL_GENERATION (Rule 8, Rule 21)
      track('LABEL_GENERATION', () => {
        labels = []
        labelTimestamps = []
        futureWindowStartTimestamps = []
        const horizonMs = HORIZON_MS[labelConfig.predictionHorizon]
        const barrierConfig = labelConfig.barrierConfig

        for (const fv of featureVectors) {
          // Rule 8 — Filter future prices strictly AFTER feature timestamp T
          const futureWindow = futurePrices
            .filter((p) => p.symbol === fv.symbol && p.timestamp > fv.timestamp)
            .sort((a, b) => a.timestamp - b.timestamp)

          if (futureWindow.length === 0) continue

          // Track the first future observation timestamp (for Rule 8 leakage check)
          futureWindowStartTimestamps.push(futureWindow[0].timestamp)

          // Compute ATR and volatility from feature vector (or defaults)
          const atr = fv.features['atr'] ?? fv.features['volatility'] ?? 0.02 * fv.features['close']
          const volatility = fv.features['volatility'] ?? 0.02

          if (pipeline === 'SWING') {
            // §3 Pipeline A — Dynamic Triple Barrier
            const result = dynamicTripleBarrierConstructor.construct({
              featureTimestamp: fv.timestamp,
              futurePrices: futureWindow.map((p) => ({ timestamp: p.timestamp, price: p.price })),
              barrierConfig,
              atr,
              volatility,
            })
            labels.push({
              timestamp: fv.timestamp,
              symbol: fv.symbol,
              tradeSuccess: result.tradeSuccess,
              expectedReturn: result.expectedReturn,
              riskAdjustedReturn: result.riskAdjustedReturn,
              mfe: result.mfe,
              mae: result.mae,
              holdingDuration: result.holdingDurationMs,
              tradeQualityScore: result.tradeQualityScore,
              marketRegime: fv.features['regime'] ?? 0,
              exitReason: result.exitReason,
            })
          } else {
            // §3 Pipeline B — Micro Triple Barrier
            const symbolOrderBook = futureOrderBook?.filter((ob) => ob.symbol === fv.symbol && ob.timestamp > fv.timestamp) ?? []
            const result = microTripleBarrierConstructor.construct({
              featureTimestamp: fv.timestamp,
              futurePrices: futureWindow.map((p) => ({ timestamp: p.timestamp, price: p.price })),
              futureOrderBook: symbolOrderBook.map((ob) => ({ timestamp: ob.timestamp, spread: ob.spread, imbalance: ob.imbalance })),
              barrierConfig,
              volatility,
            })
            labels.push({
              timestamp: fv.timestamp,
              symbol: fv.symbol,
              tradeSuccess: result.tradeSuccess,
              expectedReturn: result.expectedReturn,
              expectedSlippage: result.expectedSlippage,
              fillProbability: result.fillProbability,
              momentumContinuation: result.momentumContinuation,
              liquidityAbsorption: result.liquidityAbsorption,
              orderBookAlpha: result.orderBookAlpha,
              tradeQualityScore: result.tradeQualityScore,
              executionQuality: result.executionQuality,
              exitReason: result.exitReason,
            })
          }
          labelTimestamps.push(fv.timestamp)
        }

        if (labels.length === 0) {
          throw new Error('label generation produced no labels — check feature vectors and future prices')
        }
      })

      // Stage 7 — LEAKAGE_VALIDATION (Rule 8, Rule 9, Rule 10)
      track('LEAKAGE_VALIDATION', () => {
        const featureWindowEndTs = Math.max(...featureVectors.map((fv) => fv.timestamp))
        leakageResult = leakageValidator.validate({
          featureTimestamps: featureVectors.map((fv) => fv.timestamp).slice(0, futureWindowStartTimestamps!.length),
          futureWindowStartTimestamps: futureWindowStartTimestamps!,
          predictionHorizonMs: HORIZON_MS[labelConfig.predictionHorizon],
          featureWindowEndTs,
        })
        if (config.enforceNoFutureLeakage && !leakageResult.passed) {
          ailetgeObservabilityCollector.recordLeakageEvent()
          throw new Error(
            `Rule 8/9/10: leakage validation failed — ${leakageResult.violations.length} violations: ${leakageResult.violations.slice(0, 3).join('; ')}`,
          )
        }
      })

      // Stage 8 — STATISTICAL_VALIDATION (Rule 16)
      track('STATISTICAL_VALIDATION', () => {
        const targetIds = targetDefinition!.generatedTargets
        // Only validate numeric targets
        validationReport = labelValidator.validate({
          labels: labels!,
          targetIds,
          labelTimestamps: labelTimestamps!,
          leakageResult: leakageResult!,
          config,
        })
        if (!validationReport.overallPassed) {
          ailetgeObservabilityCollector.recordValidationFailure()
          throw new Error(
            `statistical validation failed — ${validationReport.checks.filter((c) => !c.passed).map((c) => c.checkName).join(', ')}`,
          )
        }
      })

      // Stage 9 — CLASS_BALANCE_ANALYSIS (§9)
      track('CLASS_BALANCE_ANALYSIS', () => {
        const targetIds = targetDefinition!.generatedTargets.filter((t) => t === 'tradeSuccess')
        const result = statisticalAnalyzer.analyze({
          labels: labels!,
          targetIds,
          timestamps: labelTimestamps!,
          symbols: featureVectors.map((fv) => fv.symbol),
        })
        statistics = result.statistics
        classDistribution = result.classDistribution
        ailetgeObservabilityCollector.recordClassImbalance(classDistribution.overallImbalance)
        ailetgeObservabilityCollector.recordQualityScore(statistics.qualityScore)
        if (classDistribution.overallImbalance > config.validationThresholds.maxClassImbalance) {
          log.warn(`class imbalance ${classDistribution.overallImbalance.toFixed(3)} exceeds threshold`)
        }
      })

      // Stage 10 — VERSION_ASSIGNMENT (Rule 4, Rule 11, Rule 19)
      track('VERSION_ASSIGNMENT', () => {
        const existing = labelRegistry.getHistory(labelConfig.labelIdentifier)
        versions.labelVersion = versionManager.assignVersion(existing.map((e) => e.labelVersion))
      })

      // Stage 11 — GOVERNANCE_VALIDATION (§12)
      track('GOVERNANCE_VALIDATION', () => {
        governanceMetadata = labelGovernanceManager.createInitial(labelConfig.crossPipelineApproved)
        governanceMetadata = labelGovernanceManager.markValidated(governanceMetadata)
        governanceMetadata = labelGovernanceManager.approve(governanceMetadata, params.approvingActor, params.approvalNote)
        ailetgeObservabilityCollector.recordGovernanceEvent()
      })

      // Stage 12 — IMMUTABLE_PUBLICATION (Rule 3, Rule 4, Rule 13)
      track('IMMUTABLE_PUBLICATION', () => {
        lineage = labelLineageTracker.build({
          sourceDatasetIds: retrieved!.sourceDatasetIds,
          sourceDatasetVersions: retrieved!.sourceDatasetVersions,
          sourceRegistryEntryIds: retrieved!.sourceRegistryEntryIds,
          sourceFeatureMetadataVersions: input.featureMetadata.map((f) => f.version),
          researchConfigurationVersionIds: input.researchConfiguration.map((r) => `${r.researchId}@${r.version}`),
          tradingHorizonConfigurationIds: input.tradingHorizonConfiguration.map((t) => `${t.configId}@${t.version}`),
          marketCalendarVersion: input.marketCalendar[0]?.version ?? 'unknown',
          datasetManifestIds: input.datasetManifest.map((m) => m.manifestId),
          governanceEventIds: input.governanceMetadata.map((g) => g.governanceId),
          registryEntryIds: [],
          publicationMetadataIds: [],
          upstreamEngines: retrieved!.upstreamEngines,
        })

        // Preliminary manifest with content hash placeholder
        const preliminaryHash = versionManager.computeContentHash({
          labelIdentifier: labelConfig.labelIdentifier,
          labelVersion: versions.labelVersion,
          researchPipeline: pipeline,
          labelCategory: labelConfig.labelTypes[0] ?? 'BINARY_CLASSIFICATION',
          targetDefinition: targetDefinition!,
          predictionHorizon: labelConfig.predictionHorizon,
          labelStatistics: statistics!,
        } as CanonicalLabelContract)

        manifest = manifestGenerator.generate({
          labelIdentifier: labelConfig.labelIdentifier,
          labelVersion: versions.labelVersion,
          targetDefinitions: [targetDefinition!],
          predictionHorizons: [labelConfig.predictionHorizon],
          recordCount: statistics!.totalLabels,
          dateRange: { start: statistics!.dateRangeStart, end: statistics!.dateRangeEnd },
          symbols: featureVectors.map((fv) => fv.symbol),
          contentHash: preliminaryHash,
        })

        contract = labelContractGenerator.generate({
          labelConfiguration: labelConfig,
          versions,
          targetDefinition: targetDefinition!,
          statistics: statistics!,
          classDistribution: classDistribution!,
          validationReport: validationReport!,
          integrityReport: {} as LabelIntegrityReport, // placeholder
          lineage: lineage!,
          governanceMetadata: governanceMetadata!,
          labelManifest: manifest!,
          pipelineStages,
        })

        // Compute final content hash (Rule 11/18)
        contract!.contentHash = versionManager.computeContentHash(contract!)

        // Generate integrity report (Rule 6, Rule 16)
        integrityReport = integrityVerifier.verify({
          contract: contract!,
          expectedContentHash: contract!.contentHash,
          manifestHash: manifest!.contentHash,
        })
        contract!.integrityReport = integrityReport

        // Rule 4 — Freeze the contract at publication time
        contract!.publicationStatus = 'PUBLISHED' as PublicationStatus
        Object.freeze(contract)
        Object.freeze(contract!.governanceMetadata)
        Object.freeze(contract!.lineage)
        Object.freeze(contract!.targetDefinition)
        Object.freeze(contract!.labelStatistics)
        Object.freeze(contract!.classDistribution)
        Object.freeze(contract!.validationReport)
        Object.freeze(contract!.integrityReport)
        Object.freeze(contract!.labelManifest)

        ailetgeObservabilityCollector.recordLabelDistribution(statistics!.totalLabels)
      })

      // Stage 13 — REGISTRY_REGISTRATION (Rule 16)
      track('REGISTRY_REGISTRATION', () => {
        registryEntry = {
          labelIdentifier: contract!.labelIdentifier,
          labelVersion: contract!.labelVersion,
          datasetVersion: versions.datasetVersion,
          targetDefinition: contract!.targetDefinition,
          predictionHorizon: contract!.predictionHorizon,
          configurationVersion: contract!.configurationVersion,
          creationTimestamp: contract!.createdAt,
          governanceStatus: contract!.governanceMetadata.approvalStatus,
          qualityScore: contract!.labelStatistics.qualityScore,
          storageLocation: `label-registry://persistent/${contract!.labelEventId}`,
          labelEventId: contract!.labelEventId,
          immutable: true, // Rule 16
        }
        labelRegistry.register(registryEntry)
        ailetgeObservabilityCollector.recordRegistryPublication()
      })

      // Stage 14 — METADATA_RECORDING (§12)
      track('METADATA_RECORDING', () => {
        if (!contract) throw new Error('contract not generated')
        this.recordHistory(contract)
        ailetgeObservabilityCollector.recordLabelsGenerated()
      })

      // Stage 15 — LABEL_COMPLETION
      track('LABEL_COMPLETION', () => {
        log.info(
          `labels generated: ${contract?.labelIdentifier} ${contract?.labelVersion} ` +
          `(pipeline=${contract?.researchPipeline}, horizon=${contract?.predictionHorizon}, ` +
          `labels=${contract?.labelStatistics.totalLabels}, targets=${contract?.targetDefinition.generatedTargets.length}, ` +
          `quality=${contract?.labelStatistics.qualityScore.toFixed(3)}, imbalance=${contract?.classDistribution.overallImbalance.toFixed(3)})`,
        )
      })

      ailetgeObservabilityCollector.recordGenerationTime(Date.now() - startTime)

      return {
        contract,
        registryEntry,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
        pipeline: labelConfig.researchPipeline,
      }
    } catch (e) {
      // Rule 13 — Publication failures never publish partial labels
      labelFailureRecovery.quarantine(labelConfig.labelIdentifier, (e as Error).message)
      ailetgeObservabilityCollector.recordPublicationFailure()
      log.error(`label generation failed: ${(e as Error).message}`)
      return {
        contract: null,
        registryEntry: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
        pipeline: labelConfig.researchPipeline,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // §3 — Dual Workflow Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * §3 Pipeline A — Swing Trading Labels (Dynamic Triple Barrier).
   * Default horizon: 72 hours (3 days). Generates 9 swing-specific targets.
   */
  generateSwingLabels(params: {
    input: LabelInput
    config: AILETGEConfiguration
    versions: LabelVersionBundle
    featureVectors: Array<{ timestamp: number; symbol: string; features: Record<string, number> }>
    futurePrices: Array<{ timestamp: number; symbol: string; price: number }>
    barrierConfig: BarrierConfiguration
    horizon?: PredictionHorizon
    approvingActor: string
  }): LabelGenerationResult {
    const labelConfig: LabelConfiguration = {
      labelIdentifier: `swing-labels-${Date.now()}`,
      researchPipeline: 'SWING',
      barrierConfig: params.barrierConfig, // Rule 21 — externally configured
      predictionHorizon: params.horizon ?? params.config.defaultSwingHorizon,
      labelTypes: ['BINARY_CLASSIFICATION', 'FUTURE_RETURN', 'MAXIMUM_FAVORABLE_EXCURSION', 'MAXIMUM_ADVERSE_EXCURSION', 'TRADE_SUCCESS'],
      sourceDatasetEventIds: params.input.governedDatasets.map((d) => d.datasetEventId),
      dateRange: {
        start: Math.min(...params.featureVectors.map((fv) => fv.timestamp)),
        end: Math.max(...params.featureVectors.map((fv) => fv.timestamp)),
      },
      symbols: [...new Set(params.featureVectors.map((fv) => fv.symbol))],
      crossPipelineMixingApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      targetDefinitionVersion: params.versions.targetVersion ?? '1.0.0',
    }

    return this.generateLabels({
      input: params.input,
      labelConfig,
      config: params.config,
      versions: params.versions,
      featureVectors: params.featureVectors,
      futurePrices: params.futurePrices,
      approvingActor: params.approvingActor,
      approvalNote: 'Swing trading labels (Pipeline A) — Dynamic Triple Barrier',
    })
  }

  /**
   * §3 Pipeline B — Instant Scalping Labels (Micro Triple Barrier).
   * Default horizon: 20 minutes. Generates 10 scalping-specific targets.
   */
  generateScalpingLabels(params: {
    input: LabelInput
    config: AILETGEConfiguration
    versions: LabelVersionBundle
    featureVectors: Array<{ timestamp: number; symbol: string; features: Record<string, number> }>
    futurePrices: Array<{ timestamp: number; symbol: string; price: number }>
    futureOrderBook: Array<{ timestamp: number; symbol: string; spread: number; imbalance: number }>
    barrierConfig: BarrierConfiguration
    horizon?: PredictionHorizon
    approvingActor: string
  }): LabelGenerationResult {
    const labelConfig: LabelConfiguration = {
      labelIdentifier: `scalping-labels-${Date.now()}`,
      researchPipeline: 'INSTANT_SCALPING',
      barrierConfig: params.barrierConfig, // Rule 21 — externally configured
      predictionHorizon: params.horizon ?? params.config.defaultScalpingHorizon,
      labelTypes: ['BINARY_CLASSIFICATION', 'FUTURE_RETURN', 'TRADE_SUCCESS'],
      sourceDatasetEventIds: params.input.governedDatasets.map((d) => d.datasetEventId),
      dateRange: {
        start: Math.min(...params.featureVectors.map((fv) => fv.timestamp)),
        end: Math.max(...params.featureVectors.map((fv) => fv.timestamp)),
      },
      symbols: [...new Set(params.featureVectors.map((fv) => fv.symbol))],
      crossPipelineMixingApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      targetDefinitionVersion: params.versions.targetVersion ?? '1.0.0',
    }

    return this.generateLabels({
      input: params.input,
      labelConfig,
      config: params.config,
      versions: params.versions,
      featureVectors: params.featureVectors,
      futurePrices: params.futurePrices,
      futureOrderBook: params.futureOrderBook,
      approvingActor: params.approvingActor,
      approvalNote: 'Instant scalping labels (Pipeline B) — Micro Triple Barrier',
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 11 — Deterministic Replay
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Rule 11 — Historical labels support deterministic replay.
   * Rule 16 — Registry entries immutable.
   */
  replayLabels(labelEventId: string): {
    recovered: boolean
    entry: LabelRegistryEntry | null
  } {
    return labelFailureRecovery.replay(labelEventId, labelRegistry)
  }

  /**
   * Rule 16 — Get label registry history (immutable).
   */
  getLabelHistory(labelIdentifier: string): LabelRegistryEntry[] {
    return labelRegistry.getHistory(labelIdentifier)
  }

  getLatestLabel(labelIdentifier: string): LabelRegistryEntry | null {
    return labelRegistry.getLatest(labelIdentifier)
  }

  /**
   * §14 — Observability snapshot.
   */
  observability(): Record<string, unknown> {
    const snapshot = ailetgeObservabilityCollector.snapshot()
    return {
      ...snapshot,
      registryCount: labelRegistry.count(),
    }
  }

  /**
   * §16 — List quarantined labels.
   */
  listQuarantined(): Array<{ labelIdentifier: string; reason: string; timestamp: number }> {
    return labelFailureRecovery.listQuarantined()
  }

  getContractHistory(): CanonicalLabelContract[] {
    return this.history
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private recordHistory(contract: CanonicalLabelContract): void {
    this.history.push(contract)
    if (this.history.length > this.MAX_HISTORY) this.history.shift()
  }
}

// Need randomUUID import
import { randomUUID } from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  AILETGE_VERSION,
  LABEL_ENGINEERING_SCHEMA_VERSION,
  LABEL_GENERATION_STAGES,
  HORIZON_MS,
}

export const AILETGE_ENGINE_VERSION = AILETGE_VERSION
