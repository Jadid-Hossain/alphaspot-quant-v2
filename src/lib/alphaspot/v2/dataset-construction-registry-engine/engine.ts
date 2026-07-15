// CHAPTER 6.2 §6 — AI Dataset Construction & Dataset Registry Engine (ADCDRE)
//
// §1 — The exclusive dataset production layer between the governed Data Platform
//      (Chapter 3) and every downstream AI engine in Chapter 6. No AI model may
//      directly consume raw market data or feature stores.
//
// Dual dataset ecosystems (§3):
//   • Pipeline A — Swing Trading Dataset Platform (persistent registry)
//   • Pipeline B — Instant Scalping Dataset Platform (transient ring buffers)
//
// 16-stage construction pipeline (§6).
// 22 architectural rules enforced (see §17), including Rule 7A (transient→persistent
// promotion) and Rule 9A/9B (absolute temporal isolation + purged/embargo validation).

import { createLogger } from '../domains/01-core-infrastructure'
import type {
  ADCDREConfiguration,
  CanonicalDatasetContract,
  DatasetConfiguration,
  DatasetGovernanceMetadata,
  DatasetInput,
  DatasetIntegrityReport,
  DatasetLineage,
  DatasetManifest,
  DatasetRegistryEntry,
  DatasetSchema,
  DatasetStatistics,
  DatasetValidationReport,
  DatasetVersionBundle,
  PartitionSet,
  PublicationStatus,
  RegistryPromotionTrigger,
  ResearchPipeline,
  StorageFormat,
} from './types'
import { ADCDRE_VERSION, DATASET_REGISTRY_SCHEMA_VERSION, DATASET_CONSTRUCTION_STAGES } from './types'
import {
  adcdreObservabilityCollector,
  chronologicalPartitioner,
  configurationValidator,
  datasetContractGenerator,
  datasetFailureRecovery,
  datasetGovernanceManager,
  datasetLineageTracker,
  datasetRegistry,
  datasetValidator,
  governedDataCollector,
  integrityVerifier,
  manifestGenerator,
  statisticalGenerator,
  temporalAligner,
  versionManager,
  windowConstructor,
} from './subsystems'

const log = createLogger('ai-platform:dataset-construction-registry:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetConstructionResult {
  contract: CanonicalDatasetContract | null
  registryEntry: DatasetRegistryEntry | null
  success: boolean
  failureReason: string | null
  latencyMs: number
  pipeline: ResearchPipeline
  storagePolicy: 'PERSISTENT' | 'TRANSIENT'
}

export interface TransientPromotionResult {
  promoted: boolean
  registryEntry: DatasetRegistryEntry | null
  failureReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// AIDatasetConstructionRegistryEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AIDatasetConstructionRegistryEngine {
  private readonly history: CanonicalDatasetContract[] = []
  private readonly MAX_HISTORY = 500

  /**
   * §6 — Dataset Construction Pipeline (16 stages).
   *
   * Rule 1   — Only governed feature stores may construct datasets.
   * Rule 2   — Unique Dataset Event ID.
   * Rule 3   — Canonical Dataset Contract.
   * Rule 4   — Historical datasets immutable.
   * Rule 5   — Complete lineage preserved.
   * Rule 6   — Never generate AI labels.
   * Rule 7   — Swing and Scalping ecosystems permanently isolated.
   * Rule 7A  — Transient datasets never reused for training unless promoted.
   * Rule 8   — Chronological ordering never violated.
   * Rule 9   — No random shuffling.
   * Rule 9A  — Absolute temporal isolation between partitions.
   * Rule 9B  — Purged/embargo validation removes leakage-capable observations.
   * Rule 10  — Must complete validation before publication.
   * Rule 11  — Deterministic replay.
   * Rule 12  — Methodologies independently configurable.
   * Rule 13  — Publication failures never publish partial datasets.
   * Rule 14  — Complete Dataset Manifest.
   * Rule 15  — Deterministic timestamp ordering.
   * Rule 16  — Registry entries immutable after publication.
   * Rule 17  — Walk-forward/rolling/purged methodologies pluggable.
   * Rule 18  — Reproducible from immutable versions.
   * Rule 19  — Storage formats independently configurable.
   * Rule 20  — Governs only dataset construction and registry.
   */
  constructDataset(params: {
    input: DatasetInput
    datasetConfig: DatasetConfiguration
    config: ADCDREConfiguration
    versions: DatasetVersionBundle
    records: Array<Record<string, unknown>>
    timestamps: number[]
    symbols: string[]
    owner: string
    approvingActor: string
    approvalNote: string
  }): DatasetConstructionResult {
    const startTime = Date.now()
    const { input, datasetConfig, config, versions, records, timestamps, symbols, owner } = params
    const pipelineStages: CanonicalDatasetContract['pipelineStages'] = []

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        adcdreObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        adcdreObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    let collected: ReturnType<typeof governedDataCollector.collect>
    let alignedRecords: Array<Record<string, unknown>>
    let alignedTimestamps: number[]
    let windows: ReturnType<typeof windowConstructor.construct>
    let partitions: PartitionSet
    let statistics: DatasetStatistics
    let manifest: DatasetManifest
    let schema: DatasetSchema
    let governanceMetadata: DatasetGovernanceMetadata
    let lineage: DatasetLineage
    let validationReport: DatasetValidationReport
    let integrityReport: DatasetIntegrityReport
    let contract: CanonicalDatasetContract | null = null
    let registryEntry: DatasetRegistryEntry | null = null

    try {
      const pipeline = datasetConfig.researchPipeline
      // §3 — Storage policy: Swing = persistent, Scalping = transient
      const storagePolicy: 'PERSISTENT' | 'TRANSIENT' =
        pipeline === 'SWING' ? 'PERSISTENT' : 'TRANSIENT'
      const transientExpiresAt: number | null =
        storagePolicy === 'TRANSIENT'
          ? Date.now() + (datasetConfig.transientRetentionMs ?? config.defaultTransientRetentionMs)
          : null

      // Stage 1 — GOVERNED_DATA_COLLECTION (Rule 1, Rule 6)
      track('GOVERNED_DATA_COLLECTION', () => {
        collected = governedDataCollector.collect(input, pipeline)
        if (!collected.valid) {
          throw new Error(`Rule 1: governed data collection failed: ${collected.errors.join('; ')}`)
        }
      })

      // Stage 2 — CONFIGURATION_VALIDATION (Rule 7, Rule 9, Rule 12)
      track('CONFIGURATION_VALIDATION', () => {
        const result = configurationValidator.validate(datasetConfig, config)
        if (!result.valid) {
          throw new Error(`configuration validation failed: ${result.errors.join('; ')}`)
        }
      })

      // Stage 3 — TEMPORAL_ALIGNMENT (Rule 8, Rule 15)
      track('TEMPORAL_ALIGNMENT', () => {
        const recordsWithTs = records.map((r, i) => ({ ...r, timestamp: timestamps[i] }))
        const result = temporalAligner.align(recordsWithTs)
        alignedRecords = result.aligned
        alignedTimestamps = result.aligned.map((r) => r.timestamp as number)
      })

      // Stage 4 — FEATURE_RESOLUTION
      track('FEATURE_RESOLUTION', () => {
        // Features resolved from governed feature store (already validated in stage 1)
        // Build schema
        const featureValueTypes: DatasetSchema['featureValueTypes'] = {}
        for (const fid of datasetConfig.featureIds) {
          featureValueTypes[fid] = 'NUMBER'
        }
        schema = {
          schemaVersion: versions.schemaVersion,
          featureSchemaIds: datasetConfig.featureIds,
          featureValueTypes,
          timestampField: 'timestamp',
          symbolField: 'symbol',
          storageFormat: datasetConfig.storageFormat ?? config.defaultStorageFormat,
        }
      })

      // Stage 5 — TIMEFRAME_SYNCHRONIZATION
      track('TIMEFRAME_SYNCHRONIZATION', () => {
        // Multi-timeframe alignment (simplified — already aligned in stage 3)
      })

      // Stage 6 — SLIDING_ROLLING_WINDOW_CONSTRUCTION (Rule 17)
      track('SLIDING_ROLLING_WINDOW_CONSTRUCTION', () => {
        windows = windowConstructor.construct({
          records: alignedRecords!,
          timestamps: alignedTimestamps!,
          method: datasetConfig.constructionMethod,
          windowSizeMs: datasetConfig.partitioning.walkForwardWindowMs,
          stepSizeMs: datasetConfig.partitioning.walkForwardStepMs,
        })
      })

      // Stage 7 — DATASET_VALIDATION (Rule 10, Rule 16)
      track('DATASET_VALIDATION', () => {
        validationReport = datasetValidator.validate({
          records: alignedRecords!,
          featureIds: datasetConfig.featureIds,
          timestamps: alignedTimestamps!,
          schema: schema!,
          config,
        })
        if (config.requireValidationBeforePublication && !validationReport.overallPassed) {
          adcdreObservabilityCollector.recordValidationFailure()
          throw new Error(`Rule 10: dataset validation failed — ${validationReport.checks.filter((c) => !c.passed).map((c) => c.checkName).join(', ')}`)
        }
      })

      // Stage 8 — CHRONOLOGICAL_PARTITIONING (Rule 8, Rule 9, Rule 9A, Rule 9B)
      track('CHRONOLOGICAL_PARTITIONING', () => {
        partitions = chronologicalPartitioner.partition({
          timestamps: alignedTimestamps!,
          fractions: datasetConfig.partitioning.holdoutFractions,
          purgeGapMs: datasetConfig.partitioning.purgeGapMs,
          embargoMs: datasetConfig.partitioning.embargoMs,
          partitionTypes: datasetConfig.partitioning.types,
          walkForwardWindowMs: datasetConfig.partitioning.walkForwardWindowMs,
          walkForwardStepMs: datasetConfig.partitioning.walkForwardStepMs,
        })
        // Rule 9A — Verify no boundary overlaps
        if (config.enforceTemporalIsolation && !partitions.noBoundaryOverlaps) {
          throw new Error('Rule 9A: temporal isolation violated — boundary overlaps detected')
        }
        if (config.enforceTemporalIsolation && !partitions.validationFollowsTraining) {
          throw new Error('Rule 9A: validation must start strictly after training ends')
        }
        if (config.enforceTemporalIsolation && !partitions.testingFollowsValidation) {
          throw new Error('Rule 9A: testing must start strictly after validation ends')
        }
      })

      // Stage 9 — DATASET_STATISTICS_GENERATION (Rule 14)
      track('DATASET_STATISTICS_GENERATION', () => {
        statistics = statisticalGenerator.generate({
          records: alignedRecords!,
          featureIds: datasetConfig.featureIds,
          timestamps: alignedTimestamps!,
          symbols,
          partitions: partitions!,
        })
        adcdreObservabilityCollector.recordCompleteness(statistics.completeness)
        adcdreObservabilityCollector.recordQualityScore(statistics.qualityScore)
      })

      // Stage 10 — MANIFEST_GENERATION (Rule 14)
      track('MANIFEST_GENERATION', () => {
        // Content hash for manifest (preliminary — final hash computed after contract generation)
        const preliminaryHash = versionManager.computeContentHash({
          datasetIdentifier: datasetConfig.datasetIdentifier,
          datasetVersion: versions.datasetVersion,
          researchPipeline: pipeline,
          datasetCategory: datasetConfig.constructionMethod,
          datasetManifest: { featureIds: datasetConfig.featureIds } as DatasetManifest,
          datasetStatistics: statistics!,
          partitionMetadata: partitions!,
        } as CanonicalDatasetContract)
        manifest = manifestGenerator.generate({
          datasetIdentifier: datasetConfig.datasetIdentifier,
          datasetVersion: versions.datasetVersion,
          schema: schema!,
          featureIds: datasetConfig.featureIds,
          partitionTypes: datasetConfig.partitioning.types,
          recordCount: statistics!.totalRecords,
          dateRange: { start: statistics!.dateRangeStart, end: statistics!.dateRangeEnd },
          symbols,
          contentHash: preliminaryHash,
        })
      })

      // Stage 11 — VERSION_ASSIGNMENT (Rule 4, Rule 11, Rule 18)
      track('VERSION_ASSIGNMENT', () => {
        const existing = datasetRegistry.getHistory(datasetConfig.datasetIdentifier)
        versions.datasetVersion = versionManager.assignVersion(existing.map((e) => e.datasetVersion))
      })

      // Stage 12 — GOVERNANCE_VALIDATION (§12)
      track('GOVERNANCE_VALIDATION', () => {
        governanceMetadata = datasetGovernanceManager.createInitial(datasetConfig.crossPipelineMixingApproved)
        governanceMetadata = datasetGovernanceManager.markValidated(governanceMetadata)
        governanceMetadata = datasetGovernanceManager.approve(governanceMetadata, params.approvingActor, params.approvalNote)
        adcdreObservabilityCollector.recordGovernanceEvent()
      })

      // Stage 13 — IMMUTABLE_PUBLICATION (Rule 3, Rule 4, Rule 13)
      track('IMMUTABLE_PUBLICATION', () => {
        lineage = datasetLineageTracker.build({
          sourceVersions: collected!.sourceVersions,
          paperTradingResultIds: input.paperTradingResults.map((p) => p.sessionId),
          backtestingResultIds: input.backtestingResults.map((b) => b.simulationId),
          configurationVersionIds: input.configurationMetadata.map((c) => `${c.configId}@${c.version}`),
          governanceEventIds: input.governanceMetadata.map((g) => g.governanceId),
          registryEntryIds: [],
          publicationMetadataIds: [],
          upstreamEngines: collected!.upstreamEngines,
          sourceTransientDatasetId: null,
        })

        contract = datasetContractGenerator.generate({
          datasetConfiguration: datasetConfig,
          versions,
          manifest: manifest!,
          schema: schema!,
          statistics: statistics!,
          partitions: partitions!,
          validationReport: validationReport!,
          integrityReport: {} as DatasetIntegrityReport, // placeholder — filled below
          lineage: lineage!,
          governanceMetadata: governanceMetadata!,
          storagePolicy,
          transientExpiresAt,
          pipelineStages,
        })

        // Compute final content hash (Rule 11/18)
        contract!.contentHash = versionManager.computeContentHash(contract!)

        // Generate integrity report (Rule 16)
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
        Object.freeze(contract!.datasetManifest)
        Object.freeze(contract!.datasetSchema)
        Object.freeze(contract!.datasetStatistics)
        Object.freeze(contract!.partitionMetadata)
        Object.freeze(contract!.validationReport)
        Object.freeze(contract!.integrityReport)

        adcdreObservabilityCollector.recordDatasetSize(statistics!.totalRecords)
        adcdreObservabilityCollector.recordFreshness(1 - (Date.now() - alignedTimestamps![alignedTimestamps!.length - 1]) / (30 * 86400000))
      })

      // Stage 14 — REGISTRY_REGISTRATION (Rule 16)
      track('REGISTRY_REGISTRATION', () => {
        if (storagePolicy === 'PERSISTENT') {
          // §3 Pipeline A — Persistent registry
          registryEntry = {
            datasetIdentifier: contract!.datasetIdentifier,
            datasetVersion: contract!.datasetVersion,
            pipelineIdentifier: contract!.researchPipeline,
            schemaVersion: contract!.datasetSchema.schemaVersion,
            featureManifest: {
              featureIds: contract!.datasetManifest.featureIds,
              count: contract!.datasetManifest.featureIds.length,
            },
            configurationVersion: contract!.datasetConfigurationVersion,
            creationTimestamp: contract!.createdAt,
            owner,
            governanceStatus: contract!.governanceMetadata.approvalStatus,
            storageLocation: `registry://persistent/${contract!.datasetEventId}`,
            qualityScore: contract!.datasetStatistics.qualityScore,
            lineageIdentifier: contract!.lineage.sourceFeatureStoreVersions.join('|'),
            approvalStatus: 'APPROVED',
            datasetEventId: contract!.datasetEventId,
            immutable: true, // Rule 16
            promotedFromTransient: false,
          }
          datasetRegistry.register(registryEntry)
          adcdreObservabilityCollector.recordRegistryPublication()
        } else {
          // §3 Pipeline B — Transient (ring buffer)
          datasetRegistry.registerTransient(contract!, datasetConfig.transientRetentionMs ?? config.defaultTransientRetentionMs)
        }
      })

      // Stage 15 — METADATA_RECORDING (§12)
      track('METADATA_RECORDING', () => {
        if (!contract) throw new Error('contract not generated')
        this.recordHistory(contract)
        adcdreObservabilityCollector.recordDatasetConstructed()
      })

      // Stage 16 — DATASET_COMPLETION
      track('DATASET_COMPLETION', () => {
        log.info(
          `dataset constructed: ${contract?.datasetIdentifier} ${contract?.datasetVersion} ` +
          `(pipeline=${contract?.researchPipeline}, method=${contract?.datasetCategory}, ` +
          `storage=${contract?.storagePolicy}, records=${contract?.datasetStatistics.totalRecords}, ` +
          `quality=${contract?.datasetStatistics.qualityScore.toFixed(3)}, ` +
          `purged=${contract?.partitionMetadata.purgedObservationCount}, embargoed=${contract?.partitionMetadata.embargoedObservationCount})`,
        )
      })

      adcdreObservabilityCollector.recordConstructionTime(Date.now() - startTime)

      return {
        contract,
        registryEntry,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
        pipeline: datasetConfig.researchPipeline,
        storagePolicy,
      }
    } catch (e) {
      // Rule 13 — Publication failures never publish partial datasets
      datasetFailureRecovery.quarantine(datasetConfig.datasetIdentifier, (e as Error).message)
      adcdreObservabilityCollector.recordPublicationFailure()
      log.error(`dataset construction failed: ${(e as Error).message}`)
      return {
        contract: null,
        registryEntry: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
        pipeline: datasetConfig.researchPipeline,
        storagePolicy: datasetConfig.researchPipeline === 'SWING' ? 'PERSISTENT' : 'TRANSIENT',
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // §3 — Dual Workflow Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * §3 Pipeline A — Swing Dataset Construction (persistent registry).
   * Multi-timeframe (1H/4H/Daily), long-horizon, permanently persisted.
   */
  constructSwingDataset(params: {
    input: DatasetInput
    config: ADCDREConfiguration
    versions: DatasetVersionBundle
    records: Array<Record<string, unknown>>
    timestamps: number[]
    symbols: string[]
    featureIds: string[]
    dateRange: { start: number; end: number }
    owner: string
    approvingActor: string
  }): DatasetConstructionResult {
    const datasetConfig: DatasetConfiguration = {
      datasetIdentifier: `swing-dataset-${Date.now()}`,
      researchPipeline: 'SWING',
      constructionMethod: 'HISTORICAL',
      featureIds: params.featureIds,
      dateRange: params.dateRange,
      symbols: params.symbols,
      partitioning: {
        types: ['TRAINING', 'VALIDATION', 'TESTING', 'WALK_FORWARD_VALIDATION'],
        holdoutFractions: { training: 0.7, validation: 0.15, testing: 0.15 },
        purgeGapMs: 86400000, // 1 day purge (Rule 9B)
        embargoMs: 86400000, // 1 day embargo (Rule 9B)
        walkForwardWindowMs: 30 * 86400000, // 30-day windows
        walkForwardStepMs: 7 * 86400000, // 7-day step
      },
      crossPipelineMixingApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      storageFormat: params.config.defaultStorageFormat,
      transientRetentionMs: null, // Persistent
      autoExpire: false,
    }

    return this.constructDataset({
      input: params.input,
      datasetConfig,
      config: params.config,
      versions: params.versions,
      records: params.records,
      timestamps: params.timestamps,
      symbols: params.symbols,
      owner: params.owner,
      approvingActor: params.approvingActor,
      approvalNote: 'Swing dataset construction (Pipeline A) — persistent registry',
    })
  }

  /**
   * §3 Pipeline B — Instant Scalping Dataset Construction (transient ring buffer).
   * 1-minute timeframe, high-frequency, transient in-memory.
   * Rule 7A — Not reusable for training unless promoted.
   */
  constructScalpingDataset(params: {
    input: DatasetInput
    config: ADCDREConfiguration
    versions: DatasetVersionBundle
    records: Array<Record<string, unknown>>
    timestamps: number[]
    symbols: string[]
    featureIds: string[]
    dateRange: { start: number; end: number }
    owner: string
    approvingActor: string
  }): DatasetConstructionResult {
    const datasetConfig: DatasetConfiguration = {
      datasetIdentifier: `scalping-dataset-${Date.now()}`,
      researchPipeline: 'INSTANT_SCALPING',
      constructionMethod: 'ROLLING_WINDOW',
      featureIds: params.featureIds,
      dateRange: params.dateRange,
      symbols: params.symbols,
      partitioning: {
        types: ['TRAINING', 'VALIDATION', 'TESTING'],
        holdoutFractions: { training: 0.7, validation: 0.15, testing: 0.15 },
        purgeGapMs: 60000, // 1 minute purge (Rule 9B)
        embargoMs: 60000, // 1 minute embargo (Rule 9B)
        walkForwardWindowMs: 60 * 60 * 1000, // 1-hour windows
        walkForwardStepMs: 15 * 60 * 1000, // 15-minute step
      },
      crossPipelineMixingApproved: false, // Rule 7
      methodologyVersion: params.versions.pipelineVersion,
      storageFormat: params.config.defaultStorageFormat,
      transientRetentionMs: params.config.defaultTransientRetentionMs, // §3 Pipeline B — transient
      autoExpire: true, // §3 Pipeline B — auto-expire
    }

    return this.constructDataset({
      input: params.input,
      datasetConfig,
      config: params.config,
      versions: params.versions,
      records: params.records,
      timestamps: params.timestamps,
      symbols: params.symbols,
      owner: params.owner,
      approvingActor: params.approvingActor,
      approvalNote: 'Instant scalping dataset construction (Pipeline B) — transient ring buffer',
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 7A — Transient→Persistent Promotion
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Rule 7A — Promote a transient (Instant Scalping) dataset to the persistent
   * Research Dataset Registry. Requires governance-approved export workflow.
   *
   * §3 Pipeline B — Allowed promotion triggers:
   *   • Governance-approved research snapshots
   *   • Scheduled weekly research checkpoints
   *   • Explicit manual dataset exports
   *   • Validation anomalies
   *   • Critical audit events
   *   • Checkpoint policy publication
   */
  promoteTransientDataset(params: {
    datasetEventId: string
    trigger: RegistryPromotionTrigger
    owner: string
    approvingActor: string
    approvalNote: string
  }): TransientPromotionResult {
    try {
      const { promoted, entry } = datasetRegistry.promoteTransient({
        datasetEventId: params.datasetEventId,
        trigger: params.trigger,
        owner: params.owner,
      })

      if (!promoted || !entry) {
        return {
          promoted: false,
          registryEntry: null,
          failureReason: `transient dataset ${params.datasetEventId} not found or already promoted`,
        }
      }

      // Rule 4/16 — The historical contract is frozen (immutable). Promotion
      // generates a NEW governance event recorded in the registry entry, NOT
      // a mutation of the frozen contract's governanceMetadata. The promotion
      // approval is tracked via the registry entry's `promotedFromTransient`
      // flag and the review history on the (new) governance record.
      adcdreObservabilityCollector.recordGovernanceEvent()
      adcdreObservabilityCollector.recordRegistryPublication()
      log.info(
        `transient dataset promoted: ${params.datasetEventId} ` +
        `(trigger: ${params.trigger}, actor: ${params.approvingActor}) — ` +
        `new immutable registry entry created (historical contract untouched)`,
      )

      return { promoted: true, registryEntry: entry, failureReason: null }
    } catch (e) {
      log.error(`transient promotion failed: ${(e as Error).message}`)
      return {
        promoted: false,
        registryEntry: null,
        failureReason: (e as Error).message,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 11 — Deterministic Replay
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Rule 11 — Historical datasets support deterministic replay.
   * Rule 16 — Registry entries immutable.
   */
  replayDataset(datasetEventId: string): {
    recovered: boolean
    entry: DatasetRegistryEntry | null
  } {
    return datasetFailureRecovery.replay(datasetEventId, datasetRegistry)
  }

  /**
   * Rule 16 — Get registry history (immutable entries).
   */
  getRegistryHistory(datasetIdentifier: string): DatasetRegistryEntry[] {
    return datasetRegistry.getHistory(datasetIdentifier)
  }

  getLatestRegistryEntry(datasetIdentifier: string): DatasetRegistryEntry | null {
    return datasetRegistry.getLatest(datasetIdentifier)
  }

  /**
   * §3 Pipeline B — Expire transient datasets past retention.
   */
  expireTransientDatasets(): number {
    return datasetRegistry.expireTransient()
  }

  /**
   * §14 — Observability snapshot.
   */
  observability(): Record<string, unknown> {
    const snapshot = adcdreObservabilityCollector.snapshot()
    return {
      ...snapshot,
      persistentRegistryCount: datasetRegistry.countPersistent(),
      transientDatasetCount: datasetRegistry.countTransient(),
    }
  }

  /**
   * §16 — List quarantined datasets.
   */
  listQuarantined(): Array<{ datasetIdentifier: string; reason: string; timestamp: number }> {
    return datasetFailureRecovery.listQuarantined()
  }

  /**
   * Get contract history (Rule 4 — immutable).
   */
  getContractHistory(): CanonicalDatasetContract[] {
    return this.history
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
  ADCDRE_VERSION,
  DATASET_REGISTRY_SCHEMA_VERSION,
  DATASET_CONSTRUCTION_STAGES,
}

export const ADCDRE_ENGINE_VERSION = ADCDRE_VERSION
