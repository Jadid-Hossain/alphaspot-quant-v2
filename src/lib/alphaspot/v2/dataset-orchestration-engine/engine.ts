// CHAPTER 6.1 §5 — AI Dataset Orchestration & Research Data Platform (ADORP)
//
// §1 — The exclusive gateway between the governed data platform (Chapter 3)
//      and every AI model in Chapter 6. No AI model may directly consume
//      market data — only governed datasets produced by this engine.
//
// Dual research pipelines:
//   • Swing / Position Trading (Pipeline A) — §4
//   • Instant Scalping (Pipeline B) — §4
//
// 16-stage dataset generation pipeline (§5).
// 20 architectural rules enforced (see §17).

import { createLogger } from '../domains/01-core-infrastructure'
import { randomUUID } from 'crypto'
import type {
  ADORPConfiguration,
  CanonicalDatasetContract,
  DatasetConfiguration,
  DatasetGovernanceMetadata,
  DatasetInput,
  DatasetLineage,
  DatasetStatistics,
  DatasetVersionBundle,
  FeatureDescriptor,
  FeatureManifest,
  LabelDescriptor,
  LabelManifest,
  PublicationStatus,
  ResearchPipeline,
  SplitMetadata,
} from './types'
import { ADORP_VERSION, DATASET_ORCHESTRATION_SCHEMA_VERSION, DATASET_GENERATION_STAGES } from './types'
import {
  adorpoObservabilityCollector,
  datasetContractGenerator,
  datasetFailureRecovery,
  datasetGovernanceManager,
  datasetLineageTracker,
  datasetPublisher,
  datasetSplitter,
  featureResolver,
  featureValidator,
  governedDataCollector,
  labelConstructor,
  leakageDetector,
  missingValueProcessor,
  outlierValidator,
  pipelineIsolationEnforcer,
  qualityValidator,
  statisticalProfiler,
  temporalAligner,
  versionManager,
} from './subsystems'

const log = createLogger('ai-platform:dataset-orchestration:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetPublicationResult {
  contract: CanonicalDatasetContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
  pipeline: ResearchPipeline
}

// ─────────────────────────────────────────────────────────────────────────────
// AIDatasetOrchestrationPlatform
// ─────────────────────────────────────────────────────────────────────────────

export class AIDatasetOrchestrationPlatform {
  private readonly history: CanonicalDatasetContract[] = []
  private readonly MAX_HISTORY = 500
  private featureCatalog: Map<string, FeatureDescriptor> = new Map()
  private labelCatalog: Map<string, LabelDescriptor> = new Map()

  /**
   * Register a feature descriptor in the catalog (Rule 17 — version controlled).
   */
  registerFeature(descriptor: FeatureDescriptor): void {
    this.featureCatalog.set(descriptor.featureId, descriptor)
  }

  /**
   * Register a label descriptor in the catalog (Rule 18 — version controlled).
   */
  registerLabel(descriptor: LabelDescriptor): void {
    this.labelCatalog.set(descriptor.labelId, descriptor)
  }

  /**
   * §5 — Dataset Generation Pipeline (16 stages).
   *
   * Rule 1  — Only governed feature stores may generate AI datasets.
   * Rule 2  — Unique Dataset Event ID.
   * Rule 3  — Canonical Dataset Contract.
   * Rule 4  — Historical datasets immutable.
   * Rule 5  — Complete lineage preserved.
   * Rule 6  — Raw market data never consumed directly.
   * Rule 7  — Swing and Instant Scalping pipelines completely isolated.
   * Rule 8  — Must pass leakage detection before publication.
   * Rule 9  — Chronological split ordering.
   * Rule 10 — No random shuffling across future timestamps.
   * Rule 11 — Deterministic replay.
   * Rule 12 — Methodologies independently configurable.
   * Rule 13 — Publication failures never publish partial datasets.
   * Rule 14 — Complete statistical metadata.
   * Rule 15 — Deterministic timestamp ordering.
   * Rule 16 — Quality reports immutable.
   * Rule 17 — Feature schemas version controlled.
   * Rule 18 — Label methodologies independently version controlled.
   * Rule 19 — Weekly retraining consumes only immutable published datasets.
   * Rule 20 — Governs only dataset orchestration and AI research datasets.
   */
  generateDataset(params: {
    input: DatasetInput
    datasetConfig: DatasetConfiguration
    config: ADORPConfiguration
    versions: DatasetVersionBundle
    /** Synthetic records for the dataset (in production, assembled from governed stores). */
    records: Array<Record<string, unknown>>
    timestamps: number[]
    symbols: string[]
    approvingActor: string
    approvalNote: string
  }): DatasetPublicationResult {
    const startTime = Date.now()
    const { input, datasetConfig, config, versions, records, timestamps, symbols } = params
    const pipelineStages: CanonicalDatasetContract['pipelineStages'] = []

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        adorpoObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        adorpoObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    let collected: ReturnType<typeof governedDataCollector.collect>
    let featureManifest: FeatureManifest
    let labelManifest: LabelManifest
    let alignedRecords: Array<Record<string, unknown>>
    let alignedTimestamps: number[]
    let missingResult: ReturnType<typeof missingValueProcessor.process>
    let outlierResult: ReturnType<typeof outlierValidator.validate>
    let splits: { training: SplitMetadata; validation: SplitMetadata; testing: SplitMetadata }
    let leakageReport: ReturnType<typeof leakageDetector.detect>
    let qualityReport: ReturnType<typeof qualityValidator.validate>
    let statistics: DatasetStatistics
    let governanceMetadata: DatasetGovernanceMetadata
    let lineage: DatasetLineage
    let isolationCheck: ReturnType<typeof pipelineIsolationEnforcer.enforce>
    let contract: CanonicalDatasetContract | null = null

    try {
      const pipeline = datasetConfig.researchPipeline

      // Stage 1 — GOVERNED_DATA_COLLECTION (Rule 1, Rule 6)
      track('GOVERNED_DATA_COLLECTION', () => {
        collected = governedDataCollector.collect(input, pipeline)
        if (!collected.valid) {
          throw new Error(`Rule 1: governed data collection failed: ${collected.errors.join('; ')}`)
        }
      })

      // Stage 2 — FEATURE_RESOLUTION (Rule 17)
      track('FEATURE_RESOLUTION', () => {
        const result = featureResolver.resolve(datasetConfig.featureIds, pipeline, config, this.featureCatalog)
        if (result.missing.length > 0) {
          throw new Error(`feature resolution: missing features: ${result.missing.join(', ')}`)
        }
        featureManifest = result.manifest
      })

      // Rule 7 — Pipeline isolation enforcement (before feature validation)
      isolationCheck = pipelineIsolationEnforcer.enforce(
        featureManifest!.features,
        pipeline,
        config,
        datasetConfig.crossPipelineFeaturesApproved,
      )
      if (!isolationCheck.isolated && config.enforcePipelineIsolation) {
        throw new Error(
          `Rule 7: pipeline isolation violated: ${isolationCheck.violations.map((v) => v.reason).join('; ')}`,
        )
      }

      // Stage 3 — FEATURE_VALIDATION
      track('FEATURE_VALIDATION', () => {
        const result = featureValidator.validate(featureManifest!)
        if (!result.valid) {
          throw new Error(`feature validation failed: ${result.errors.join('; ')}`)
        }
      })

      // Stage 4 — TEMPORAL_ALIGNMENT (Rule 15)
      track('TEMPORAL_ALIGNMENT', () => {
        const recordsWithTs = records.map((r, i) => ({ ...r, timestamp: timestamps[i] }))
        const result = temporalAligner.align(recordsWithTs)
        alignedRecords = result.aligned
        alignedTimestamps = result.aligned.map((r) => r.timestamp as number)
        // Rule 15 — Verify deterministic ordering
        for (let i = 1; i < alignedTimestamps.length; i++) {
          if (alignedTimestamps[i] < alignedTimestamps[i - 1]) {
            throw new Error('Rule 15: temporal alignment failed — timestamps not monotonically increasing')
          }
        }
      })

      // Stage 5 — MISSING_VALUE_PROCESSING
      track('MISSING_VALUE_PROCESSING', () => {
        missingResult = missingValueProcessor.process(
          alignedRecords!,
          datasetConfig.featureIds,
          config.qualityThresholds.maxMissingValuePct,
        )
        if (!missingResult.passed) {
          log.warn('missing value thresholds exceeded — dataset may fail quality validation')
        }
      })

      // Stage 6 — OUTLIER_VALIDATION
      track('OUTLIER_VALIDATION', () => {
        outlierResult = outlierValidator.validate(
          missingResult!.processed,
          datasetConfig.featureIds,
          config.qualityThresholds.maxOutlierPct,
        )
      })

      // Stage 7 — LABEL_CONSTRUCTION (Rule 18)
      track('LABEL_CONSTRUCTION', () => {
        const result = labelConstructor.construct(datasetConfig.labelIds, pipeline, config, this.labelCatalog)
        if (result.missing.length > 0) {
          throw new Error(`label construction: missing labels: ${result.missing.join(', ')}`)
        }
        labelManifest = result.manifest
      })

      // Stage 8 — LEAKAGE_DETECTION (Rule 7, Rule 8, Rule 10)
      track('LEAKAGE_DETECTION', () => {
        // Pre-split leakage detection requires splits — create preliminary splits first
        const preliminarySplits = datasetSplitter.split({
          timestamps: alignedTimestamps!,
          fractions: datasetConfig.splitFractions,
        })
        leakageReport = leakageDetector.detect({
          featureManifest: featureManifest!,
          labelManifest: labelManifest!,
          trainingSplit: preliminarySplits.training,
          testingSplit: preliminarySplits.testing,
          pipelineIsolation: isolationCheck!,
          config,
        })
        if (config.requireLeakageDetection && !leakageReport.passed) {
          adorpoObservabilityCollector.recordLeakageEvent()
          throw new Error(
            `Rule 8: leakage detection failed — ${leakageReport.findings.length} findings (crossPipeline: ${leakageReport.crossPipelineLeakageDetected}, lookahead: ${leakageReport.lookaheadBiasDetected})`,
          )
        }
      })

      // Stage 9 — QUALITY_VALIDATION (Rule 16)
      track('QUALITY_VALIDATION', () => {
        qualityReport = qualityValidator.validate({
          records: missingResult!.processed,
          featureIds: datasetConfig.featureIds,
          labelIds: datasetConfig.labelIds,
          missingStats: missingResult!.missingStats,
          outlierStats: outlierResult!.outlierStats,
          timestamps: alignedTimestamps!,
          config,
        })
        if (!qualityReport.passed) {
          adorpoObservabilityCollector.recordValidationFailure()
          throw new Error(
            `quality validation failed — overall score ${qualityReport.overallScore.toFixed(3)} (threshold: ${config.qualityThresholds.minOverallQualityScore})`,
          )
        }
      })

      // Stage 10 — DATASET_SPLITTING (Rule 9, Rule 10)
      track('DATASET_SPLITTING', () => {
        splits = datasetSplitter.split({
          timestamps: alignedTimestamps!,
          fractions: datasetConfig.splitFractions,
        })
        // Rule 9 — Verify chronological ordering
        if (!splits.training.chronological || !splits.validation.chronological || !splits.testing.chronological) {
          throw new Error('Rule 9: chronological ordering not preserved')
        }
        // Rule 10 — Verify no random shuffling
        if (splits.training.randomShuffled || splits.validation.randomShuffled || splits.testing.randomShuffled) {
          throw new Error('Rule 10: random shuffling detected')
        }
      })

      // Stage 11 — STATISTICAL_PROFILING (Rule 14)
      track('STATISTICAL_PROFILING', () => {
        statistics = statisticalProfiler.profile({
          records: missingResult!.processed,
          featureIds: datasetConfig.featureIds,
          labelIds: datasetConfig.labelIds,
          timestamps: alignedTimestamps!,
          symbols,
        })
      })

      // Stage 12 — DATASET_VERSION_ASSIGNMENT (Rule 4, Rule 11)
      track('DATASET_VERSION_ASSIGNMENT', () => {
        const existing = datasetPublisher.getHistory(datasetConfig.datasetIdentifier)
        versions.datasetVersion = versionManager.assignVersion(existing.map((c) => c.datasetVersion))
      })

      // Stage 13 — GOVERNANCE_VALIDATION (§12)
      track('GOVERNANCE_VALIDATION', () => {
        governanceMetadata = datasetGovernanceManager.createInitial(datasetConfig.crossPipelineFeaturesApproved)
        governanceMetadata = datasetGovernanceManager.markValidated(governanceMetadata)
        governanceMetadata = datasetGovernanceManager.approve(governanceMetadata, params.approvingActor, params.approvalNote)
        datasetGovernanceManager.recordAudit(
          governanceMetadata,
          'VALIDATE',
          'adorp-engine',
          'Dataset validated and approved for publication',
          undefined,
          { validationStatus: 'PASSED', approvalStatus: 'APPROVED' },
        )
        adorpoObservabilityCollector.recordGovernanceEvent()
      })

      // Stage 14 — IMMUTABLE_DATASET_PUBLICATION (Rule 3, Rule 4, Rule 13)
      track('IMMUTABLE_DATASET_PUBLICATION', () => {
        lineage = datasetLineageTracker.build({
          sourceVersions: collected!.sourceVersions,
          paperTradingResultIds: input.paperTradingResults.map((p) => p.sessionId),
          backtestingResultIds: input.backtestingResults.map((b) => b.simulationId),
          configurationVersionIds: input.configurationMetadata.map((c) => `${c.configId}@${c.version}`),
          governanceEventIds: input.governanceMetadata.map((g) => g.governanceId),
          upstreamEngines: collected!.upstreamEngines,
        })

        contract = datasetContractGenerator.generate({
          datasetConfiguration: datasetConfig,
          versions,
          featureManifest: featureManifest!,
          labelManifest: labelManifest!,
          datasetStatistics: statistics!,
          trainingSplit: splits!.training,
          validationSplit: splits!.validation,
          testingSplit: splits!.testing,
          leakageReport: leakageReport!,
          qualityReport: qualityReport!,
          governanceMetadata: governanceMetadata!,
          lineage: lineage!,
          pipelineStages,
        })

        // Compute content hash for deterministic replay (Rule 11)
        contract!.contentHash = versionManager.computeContentHash(contract!)

        // Rule 4 — Freeze the contract at publication time
        contract!.publicationStatus = 'PUBLISHED' as PublicationStatus
        Object.freeze(contract)
        Object.freeze(contract!.governanceMetadata)
        Object.freeze(contract!.lineage)
        Object.freeze(contract!.featureManifest)
        Object.freeze(contract!.labelManifest)
        Object.freeze(contract!.datasetStatistics)
        Object.freeze(contract!.trainingSplit)
        Object.freeze(contract!.validationSplit)
        Object.freeze(contract!.testingSplit)
        Object.freeze(contract!.leakageValidationReport)
        Object.freeze(contract!.qualityValidationReport)

        datasetPublisher.publish(contract!) // Rule 4/13
        adorpoObservabilityCollector.recordVersionPublished()
        adorpoObservabilityCollector.recordDatasetSize(statistics!.totalRecords)
        adorpoObservabilityCollector.recordQualityScore(qualityReport!.overallScore)
        adorpoObservabilityCollector.recordFreshness(1 - (Date.now() - alignedTimestamps![alignedTimestamps!.length - 1]) / (30 * 86400000))
      })

      // Stage 15 — METADATA_RECORDING (§12)
      track('METADATA_RECORDING', () => {
        if (!contract) throw new Error('contract not generated')
        this.recordHistory(contract)
        adorpoObservabilityCollector.recordDatasetGenerated()
      })

      // Stage 16 — DATASET_COMPLETION
      track('DATASET_COMPLETION', () => {
        log.info(
          `dataset published: ${contract?.datasetIdentifier} ${contract?.datasetVersion} ` +
          `(pipeline=${contract?.researchPipeline}, type=${contract?.datasetType}, ` +
          `records=${contract?.datasetStatistics.totalRecords}, features=${contract?.featureManifest.count}, ` +
          `quality=${contract?.qualityValidationReport.overallScore.toFixed(3)})`,
        )
      })

      adorpoObservabilityCollector.recordGenerationTime(Date.now() - startTime)

      return {
        contract,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
        pipeline: datasetConfig.researchPipeline,
      }
    } catch (e) {
      // Rule 13 — Publication failures never publish partial datasets
      datasetFailureRecovery.quarantine(datasetConfig.datasetIdentifier, (e as Error).message)
      adorpoObservabilityCollector.recordPublicationFailure()
      log.error(`dataset generation failed: ${(e as Error).message}`)
      return {
        contract: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
        pipeline: datasetConfig.researchPipeline,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // §6 — Dual Workflow Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * §6 Workflow A — Swing Dataset Pipeline.
   * Aligns multi-timeframe features (1H/4H/Daily), merges alternative data,
   * generates swing labels (multi-day returns), validates leakage, publishes.
   *
   * Rule 7 — Completely isolated from Instant Scalping pipeline.
   */
  generateSwingDataset(params: {
    input: DatasetInput
    config: ADORPConfiguration
    versions: DatasetVersionBundle
    records: Array<Record<string, unknown>>
    timestamps: number[]
    symbols: string[]
    featureIds: string[]
    labelIds: string[]
    dateRange: { start: number; end: number }
    approvingActor: string
  }): DatasetPublicationResult {
    const datasetConfig: DatasetConfiguration = {
      datasetIdentifier: `swing-dataset-${Date.now()}`,
      datasetType: 'TRAINING',
      researchPipeline: 'SWING',
      featureIds: params.featureIds,
      labelIds: params.labelIds,
      dateRange: params.dateRange,
      symbols: params.symbols,
      splitFractions: { training: 0.7, validation: 0.15, testing: 0.15 },
      chronologicalSplit: true, // Rule 9
      randomShuffle: false, // Rule 10
      crossPipelineFeaturesApproved: false, // Rule 7 — no cross-pipeline
      methodologyVersion: params.versions.pipelineVersion,
      featureSchemaVersion: params.versions.featureVersion,
      labelMethodologyVersion: params.versions.labelVersion,
    }

    return this.generateDataset({
      input: params.input,
      datasetConfig,
      config: params.config,
      versions: params.versions,
      records: params.records,
      timestamps: params.timestamps,
      symbols: params.symbols,
      approvingActor: params.approvingActor,
      approvalNote: 'Swing dataset pipeline (Workflow A) — auto-approved',
    })
  }

  /**
   * §6 Workflow B — Instant Scalping Dataset Pipeline.
   * Aligns order book + microstructure + trade flow features (1-minute),
   * generates minute labels, validates leakage, publishes.
   *
   * Rule 7 — Completely isolated from Swing pipeline.
   */
  generateScalpingDataset(params: {
    input: DatasetInput
    config: ADORPConfiguration
    versions: DatasetVersionBundle
    records: Array<Record<string, unknown>>
    timestamps: number[]
    symbols: string[]
    featureIds: string[]
    labelIds: string[]
    dateRange: { start: number; end: number }
    approvingActor: string
  }): DatasetPublicationResult {
    const datasetConfig: DatasetConfiguration = {
      datasetIdentifier: `scalping-dataset-${Date.now()}`,
      datasetType: 'TRAINING',
      researchPipeline: 'INSTANT_SCALPING',
      featureIds: params.featureIds,
      labelIds: params.labelIds,
      dateRange: params.dateRange,
      symbols: params.symbols,
      splitFractions: { training: 0.7, validation: 0.15, testing: 0.15 },
      chronologicalSplit: true, // Rule 9
      randomShuffle: false, // Rule 10
      crossPipelineFeaturesApproved: false, // Rule 7 — no cross-pipeline
      methodologyVersion: params.versions.pipelineVersion,
      featureSchemaVersion: params.versions.featureVersion,
      labelMethodologyVersion: params.versions.labelVersion,
    }

    return this.generateDataset({
      input: params.input,
      datasetConfig,
      config: params.config,
      versions: params.versions,
      records: params.records,
      timestamps: params.timestamps,
      symbols: params.symbols,
      approvingActor: params.approvingActor,
      approvalNote: 'Instant scalping dataset pipeline (Workflow B) — auto-approved',
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 11 — Deterministic Replay
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Rule 11 — Historical datasets shall support deterministic replay.
   * Rule 19 — Weekly research retraining consumes only immutable published datasets.
   */
  replayDataset(datasetEventId: string): {
    recovered: boolean
    contract: CanonicalDatasetContract | null
    verified: boolean
  } {
    const result = datasetFailureRecovery.replay(datasetEventId, datasetPublisher)
    if (!result.contract) return { recovered: false, contract: null, verified: false }
    // Rule 11 — Verify content hash for deterministic replay
    const expectedHash = versionManager.computeContentHash(result.contract)
    return {
      recovered: true,
      contract: result.contract,
      verified: result.contract.contentHash === expectedHash,
    }
  }

  /**
   * Rule 4 — Get dataset history (immutable).
   * Rule 19 — Weekly retraining consumes only immutable published datasets.
   */
  getDatasetHistory(datasetIdentifier: string): CanonicalDatasetContract[] {
    return datasetPublisher.getHistory(datasetIdentifier)
  }

  getLatestDataset(datasetIdentifier: string): CanonicalDatasetContract | null {
    return datasetPublisher.getLatest(datasetIdentifier)
  }

  /**
   * §13 — Observability snapshot.
   */
  observability(): Record<string, unknown> {
    return adorpoObservabilityCollector.snapshot()
  }

  /**
   * §16 — List quarantined datasets.
   */
  listQuarantined(): Array<{ datasetIdentifier: string; reason: string; timestamp: number }> {
    return datasetFailureRecovery.listQuarantined()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private recordHistory(contract: CanonicalDatasetContract): void {
    this.history.push(contract)
    if (this.history.length > this.MAX_HISTORY) this.history.shift()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  ADORP_VERSION,
  DATASET_ORCHESTRATION_SCHEMA_VERSION,
  DATASET_GENERATION_STAGES,
}

export const ADORP_ENGINE_VERSION = ADORP_VERSION
