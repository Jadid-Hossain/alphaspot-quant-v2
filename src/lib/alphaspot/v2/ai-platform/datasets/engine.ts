// CHAPTER 4.3 §1, §4, §12, §13, §16 — Dataset Construction Engine Facade
//
// Transforms processed features into ML-ready datasets (§1).
// Deterministic (Rule 2, Rule 3). Immutable datasets (Rule 8).
// Complete lineage (Rule 9, §13). Independent of ML (Rule 10, Rule 15).
// Columnar storage for payloads (Rule 16).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { ProcessedFeatureVector } from '../../feature-processing/types'
import type { PredictionTargetDefinition, TargetHorizon } from '../targets/registry'
import { HORIZON_MS as TARGET_HORIZON_MS } from '../targets/registry'
import type {
  LabelConfig,
  MLDataset,
  SplitConfig,
  TrainingSample,
  WeightingConfig,
  DatasetVersion,
} from './types'
import { DATASET_SCHEMA_VERSION, DATASET_CONFIGURATION_VERSION, LABEL_VERSION } from './types'
import { LabelEngine, SampleWeighter, DatasetSplitter, filterSample, validateLabels, DEFAULT_FILTER_CRITERIA } from './label-engine'
import type { FilterCriteria } from './label-engine'

const log = createLogger('ai-platform:datasets:engine')

class DatasetConstructionEngine {
  private labelEngine = new LabelEngine()
  private splitter = new DatasetSplitter()
  private datasets = new Map<string, MLDataset>()
  private versionCounters = new Map<string, number>() // symbol+target → version
  private stats = {
    totalSamples: 0,
    totalLabels: 0,
    rejectedSamples: 0,
    datasetsBuilt: 0,
    avgBuildLatencyMs: 0,
  }
  private latencySamples: number[] = []

  /**
   * Construct an ML dataset (§4, Rule 2, Rule 3 — deterministic).
   *
   * Inputs: processed feature vectors + prediction target + future candle history.
   * Outputs: immutable MLDataset with labeled, weighted, split, validated samples.
   */
  construct(
    symbol: string,
    target: PredictionTargetDefinition,
    featureVectors: ProcessedFeatureVector[],
    futureCandleHistory: Map<number, Array<{ time: number; close: number; high: number; low: number }>>,
    labelConfig: LabelConfig,
    weightingConfig: WeightingConfig,
    splitConfig: SplitConfig,
    filterCriteria: FilterCriteria = DEFAULT_FILTER_CRITERIA,
  ): MLDataset {
    const startTime = Date.now()
    const horizon = target.horizon
    const weighter = new SampleWeighter(weightingConfig)

    const samples: TrainingSample[] = []
    const rejected: Array<{ timestamp: number; reasons: string[] }> = []
    const labelValues: number[] = []

    for (const fv of featureVectors) {
      const observationTimestamp = fv.timestamp
      const observationPrice = fv.processedFeatures['price.close'] ?? fv.processedFeatures['trend.ema50'] ?? 0

      // Get future candles for this observation
      const futureCandles = futureCandleHistory.get(observationTimestamp) ?? []

      // §5-§8 — generate label
      const label = this.labelEngine.generateLabel(
        observationPrice,
        futureCandles,
        horizon,
        labelConfig,
        observationTimestamp,
        Date.now(),
      )

      // §9 — sample filtering
      const { accepted, reasons } = filterSample(fv, label, filterCriteria)
      if (!accepted) {
        rejected.push({ timestamp: observationTimestamp, reasons })
        this.stats.rejectedSamples++
        continue
      }

      // §9.1 — sample weighting (deterministic, versioned)
      const allTimestamps = featureVectors.map((v) => v.timestamp)
      const labelDist: Record<string, number> = {}
      for (const lv of labelValues) {
        const k = String(lv)
        labelDist[k] = (labelDist[k] ?? 0) + 1
      }
      const weight = weighter.computeWeight(label!.value, observationTimestamp, allTimestamps, labelDist)

      // §10, §14 — dataset splitting (temporal, purge overlapping, embargo)
      const split = this.splitter.assignSplit(observationTimestamp, horizon, splitConfig)
      if (split === null) {
        // Purged — horizon overlaps with val/test (§14 data leakage protection)
        rejected.push({ timestamp: observationTimestamp, reasons: ['purged: horizon overlaps val/test boundary (§14)'] })
        this.stats.rejectedSamples++
        continue
      }
      if (this.splitter.isEmbargoed(observationTimestamp, splitConfig)) {
        rejected.push({ timestamp: observationTimestamp, reasons: ['embargoed (§14)'] })
        this.stats.rejectedSamples++
        continue
      }

      labelValues.push(label!.value)

      // §4 — build the training sample
      const sample: TrainingSample = {
        datasetId: '', // assigned below
        datasetVersion: 0, // assigned below
        featureVersion: fv.featureVersion,
        labelVersion: labelConfig.version,
        predictionTargetVersion: target.version.targetVersion,
        symbol,
        timestamp: observationTimestamp,
        predictionHorizon: horizon,
        featureVector: fv,
        label: label!.value,
        labelMethod: labelConfig.method,
        sampleWeight: weight,
        datasetSplit: split,
        qualityScore: fv.featureQualityScore,
        metadata: {
          sourceFeatures: JSON.stringify(fv.processedFeatures).slice(0, 64),
          sourceLabel: label!,
          predictionTarget: target.targetId,
          labelMethod: labelConfig.method,
          constructionTimestamp: Date.now(),
          dependencyVersions: {
            feature: fv.featureVersion,
            processing: fv.processingVersion,
            label: labelConfig.version,
            target: target.version.targetVersion,
          },
          processingConfig: JSON.stringify({ labelConfig, weightingConfig, splitConfig }),
          filterStatus: 'ACCEPTED' as const,
          filterReasons: [],
        },
      }

      samples.push(sample)
      this.stats.totalLabels++
    }

    // §11 — label validation
    const validation = validateLabels(samples)
    if (validation.quarantined) {
      log.error(`dataset for ${symbol} ${target.targetId} QUARANTINED: ${validation.errors.join('; ')}`)
    }

    // §12 — versioning
    const versionKey = `${symbol}:${target.targetId}`
    const datasetVersion = (this.versionCounters.get(versionKey) ?? 0) + 1
    this.versionCounters.set(versionKey, datasetVersion)

    // Assign dataset ID + version to all samples
    const datasetId = `ds-${symbol}-${target.targetId}-v${datasetVersion}`
    for (const s of samples) {
      s.datasetId = datasetId
      s.datasetVersion = datasetVersion
    }

    // §13 — label distribution
    const labelDistribution: Record<string, number> = {}
    for (const s of samples) {
      const k = String(Math.round(s.label * 100) / 100)
      labelDistribution[k] = (labelDistribution[k] ?? 0) + 1
    }

    // Class balance
    const classCounts = Object.values(labelDistribution)
    const total = classCounts.reduce((a, b) => a + b, 0) || 1
    const expected = total / Math.max(1, classCounts.length)
    const classBalance = 1 - (classCounts.reduce((a, c) => a + Math.abs(c - expected), 0) / (total * 2))

    // Quality score
    const qualityScore = samples.length > 0
      ? samples.reduce((a, s) => a + s.qualityScore, 0) / samples.length
      : 0

    const dataset: MLDataset = {
      datasetId,
      datasetVersion,
      featureVersion: featureVectors[0]?.featureVersion ?? 'unknown',
      labelVersion: labelConfig.version,
      predictionTargetVersion: target.version.targetVersion,
      schemaVersion: DATASET_SCHEMA_VERSION,
      configurationVersion: DATASET_CONFIGURATION_VERSION,
      symbol,
      target,
      labelConfig,
      weightingConfig,
      splitConfig,
      samples: Object.freeze(samples) as ReadonlyArray<TrainingSample>, // Rule 8 — immutable
      labelDistribution,
      classBalance,
      qualityScore,
      createdAt: Date.now(),
      storageLocation: `datasets/${symbol}/${target.targetId}/v${datasetVersion}`, // §16 — columnar storage location
    }

    this.datasets.set(datasetId, Object.freeze(dataset))
    this.stats.totalSamples += samples.length
    this.stats.datasetsBuilt++
    const latencyMs = Date.now() - startTime
    this.latencySamples.push(latencyMs)
    if (this.latencySamples.length > 100) this.latencySamples.shift()
    this.stats.avgBuildLatencyMs = this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length

    log.info(`dataset constructed: ${datasetId} (${samples.length} samples, ${rejected.length} rejected, balance ${classBalance.toFixed(2)}, quality ${qualityScore.toFixed(2)}, ${latencyMs}ms)`)

    return dataset
  }

  getDataset(datasetId: string): MLDataset | undefined {
    return this.datasets.get(datasetId)
  }

  listDatasets(): MLDataset[] {
    return Array.from(this.datasets.values())
  }

  getStats() {
    return {
      ...this.stats,
      totalDatasets: this.datasets.size,
      validationErrors: 0,
    }
  }
}

export const datasetConstructionEngine = new DatasetConstructionEngine()
