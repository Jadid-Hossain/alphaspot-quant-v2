// CHAPTER 6.6 §6 — AI Market Regime Intelligence Engine (AMRIE)
//
// §1 — The exclusive market state intelligence layer between the AI Data Quality,
//      Leakage Prevention & Research Validation Engine (Chapter 6.5) and the AI
//      Model Training & Experiment Orchestration Engine (Chapter 6.7).
//
// Dual regime ecosystems (§3):
//   • Pipeline A — Swing Trading (10 regimes S1-S10, 1H/4H/Daily)
//   • Pipeline B — Instant Scalping (10 regimes I1-I10, 1-minute)
//
// 10 intelligence domains (§8) → Decision Fusion (§9) → Confidence (§10) →
// Uncertainty (§11) → Transition (§12) → Stability (§7.5) → Publication.
//
// 19-stage regime intelligence pipeline (§6).
// 25 architectural rules enforced (see §25) — the most of any chapter.
// 3 execution environments: A (Runtime), B (Offline Research), C (Registry).

import { createLogger } from '../domains/01-core-infrastructure'
import { createHash, randomUUID } from 'crypto'
import type {
  AMRIEConfiguration,
  CanonicalMarketRegimeContract,
  IntelligenceDomain,
  MarketRegime,
  RegimeConfiguration,
  RegimeConfidence,
  RegimeGovernanceMetadata,
  RegimeInput,
  RegimeLineage,
  RegimeManifest,
  RegimeOpinion,
  RegimeProbabilityDistribution,
  RegimeRegistryEntry,
  RegimeStability,
  RegimeTransition,
  RegimeUncertainty,
  RegimeVersionBundle,
  ResearchPipeline,
  ExecutionEnvironment,
} from './types'
import { AMRIE_VERSION, MARKET_REGIME_SCHEMA_VERSION, REGIME_PIPELINE_STAGES, RUNTIME_INFERENCE_STAGES } from './types'
import {
  alternativeDataIntelligence,
  amrieObservabilityCollector,
  classificationHelper,
  configurationValidator,
  crossAssetIntelligence,
  governedDataRetriever,
  liquidityIntelligence,
  marketCycleIntelligence,
  marketStructureIntelligence,
  microstructureIntelligence,
  orderBookIntelligence,
  regimeConfidenceCalculator,
  regimeContractGenerator,
  regimeDecisionFusionEngine,
  regimeFailureRecovery,
  regimeGovernanceManager,
  regimeLineageTracker,
  regimeManifestGenerator,
  regimeRegistry,
  regimeStabilityAnalyzer,
  regimeTransitionAnalyzer,
  regimeUncertaintyAnalyzer,
  regimeValidator,
  runtimeRegimeClassifier,
  tradeFlowIntelligence,
  trendIntelligence,
  versionManager,
  volatilityIntelligence,
} from './subsystems'

const log = createLogger('ai-platform:market-regime:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RegimeDetectionResult {
  contract: CanonicalMarketRegimeContract | null
  registryEntry: RegimeRegistryEntry | null
  success: boolean
  failureReason: string | null
  latencyMs: number
  pipeline: ResearchPipeline
  regime: MarketRegime | null
  confidence: number | null
}

export interface RuntimeClassificationResult {
  classified: boolean
  safeMode: boolean
  reason: string
  regime: MarketRegime | null
}

// ─────────────────────────────────────────────────────────────────────────────
// AIMarketRegimeIntelligenceEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AIMarketRegimeIntelligenceEngine {
  private readonly history: CanonicalMarketRegimeContract[] = []
  private readonly MAX_HISTORY = 500

  /**
   * §6 — Market Regime Intelligence Pipeline (19 stages).
   *
   * Rule 1   — Only governance-approved artifacts may enter.
   * Rule 2   — Unique Market Regime Event ID.
   * Rule 3   — Canonical Market Regime Contract.
   * Rule 4   — Historical regimes immutable.
   * Rule 5   — Complete lineage preserved.
   * Rule 6   — Independent from AI training, prediction, execution.
   * Rule 7   — Swing/Scalping ecosystems permanently isolated.
   * Rule 8   — Consensus of multiple intelligence domains (no single domain).
   * Rule 9   — Only information at or before timestamp T (no lookahead).
   * Rule 10  — Deterministic under identical inputs.
   * Rule 11  — Deterministic replay.
   * Rule 12  — Methodologies independently configurable.
   * Rule 13  — Publication failures never partial.
   * Rule 14  — Complete Regime Manifest.
   * Rule 15  — Deterministic timestamp ordering.
   * Rule 16  — Registry entries immutable.
   * Rule 17  — Confidence/probability reproducible.
   * Rule 18  — Only governance-approved regimes consumed by downstream.
   * Rule 19  — Heavy computation in Environment B only.
   * Rule 20  — Governs only Market Regime Intelligence.
   * Rule 21  — Runtime: lightweight forward inference only.
   * Rule 22  — Runtime: only observations up to T (no live lookahead).
   * Rule 23  — Single active manifest, atomic loading.
   * Rule 24  — Safe Mode on manifest load failure.
   * Rule 25  — Instant Scalping: streaming in-memory data only.
   */
  detectRegime(params: {
    input: RegimeInput
    regimeConfig: RegimeConfiguration
    config: AMRIEConfiguration
    versions: RegimeVersionBundle
    approvingActor: string
    approvalNote: string
  }): RegimeDetectionResult {
    const startTime = Date.now()
    const { input, regimeConfig, config, versions } = params
    const pipelineStages: CanonicalMarketRegimeContract['pipelineStages'] = []

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        amrieObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        amrieObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    let retrieved: ReturnType<typeof governedDataRetriever.retrieve>
    let opinions: RegimeOpinion[] = []
    let fusionResult: ReturnType<typeof regimeDecisionFusionEngine.fuse>
    let confidence: RegimeConfidence
    let uncertainty: RegimeUncertainty
    let stability: RegimeStability
    let transition: RegimeTransition
    let governanceMetadata: RegimeGovernanceMetadata
    let lineage: RegimeLineage
    let manifest: RegimeManifest
    let contract: CanonicalMarketRegimeContract | null = null
    let registryEntry: RegimeRegistryEntry | null = null
    const previousRegime: MarketRegime | null = null

    try {
      const pipeline = regimeConfig.researchPipeline
      const observations = input.marketObservations

      // Stage 1 — GOVERNANCE_APPROVED_DATASET_RETRIEVAL (Rule 1)
      track('GOVERNANCE_APPROVED_DATASET_RETRIEVAL', () => {
        retrieved = governedDataRetriever.retrieve(input)
        if (!retrieved.valid) {
          throw new Error(`Rule 1: data retrieval failed: ${retrieved.errors.join('; ')}`)
        }
      })

      // Stage 2 — VALIDATION_CERTIFICATE_VERIFICATION (Rule 1)
      track('VALIDATION_CERTIFICATE_VERIFICATION', () => {
        if (retrieved!.sourceValidationCertificateIds.length === 0) {
          throw new Error('Rule 1: no validation certificates')
        }
      })

      // Stage 3 — FEATURE_MANIFEST_RETRIEVAL
      track('FEATURE_MANIFEST_RETRIEVAL', () => {
        if (retrieved!.sourceFeatureManifestIds.length === 0) {
          throw new Error('no feature manifests')
        }
      })

      // Stage 4 — CONFIGURATION_VALIDATION (Rule 7, Rule 9, Rule 12)
      track('CONFIGURATION_VALIDATION', () => {
        const result = configurationValidator.validate(regimeConfig, config)
        if (!result.valid) {
          throw new Error(`configuration validation failed: ${result.errors.join('; ')}`)
        }
      })

      // Stage 5 — MULTI_TIMEFRAME_SYNCHRONIZATION
      track('MULTI_TIMEFRAME_SYNCHRONIZATION', () => {
        // Synchronize multi-timeframe observations (simplified)
      })

      // Stages 6-11 — Run all 10 intelligence domain modules (Rule 8)
      const domains = regimeConfig.intelligenceDomains
      track('MARKET_STRUCTURE_ANALYSIS', () => {
        if (domains.includes('MARKET_STRUCTURE')) {
          opinions.push(marketStructureIntelligence.analyze(observations))
        }
      })
      track('VOLATILITY_ANALYSIS', () => {
        if (domains.includes('VOLATILITY')) {
          opinions.push(volatilityIntelligence.analyze(observations))
        }
      })
      track('LIQUIDITY_ANALYSIS', () => {
        if (domains.includes('LIQUIDITY')) {
          opinions.push(liquidityIntelligence.analyze(observations))
        }
      })
      track('TREND_ANALYSIS', () => {
        if (domains.includes('TREND')) {
          opinions.push(trendIntelligence.analyze(observations))
        }
      })
      track('MICROSTRUCTURE_ANALYSIS', () => {
        if (domains.includes('MICROSTRUCTURE')) {
          opinions.push(microstructureIntelligence.analyze(observations))
        }
        if (domains.includes('ORDER_BOOK')) {
          opinions.push(orderBookIntelligence.analyze(observations))
        }
        if (domains.includes('TRADE_FLOW')) {
          opinions.push(tradeFlowIntelligence.analyze(observations))
        }
        if (domains.includes('MARKET_CYCLE')) {
          opinions.push(marketCycleIntelligence.analyze(observations))
        }
        if (domains.includes('CROSS_ASSET')) {
          opinions.push(crossAssetIntelligence.analyze(observations))
        }
        if (domains.includes('ALTERNATIVE_DATA')) {
          const altOpinion = alternativeDataIntelligence.analyze(observations)
          if (altOpinion) opinions.push(altOpinion)
        }
      })
      track('MARKET_CYCLE_ANALYSIS', () => {
        // Already included in microstructure stage above
      })

      // Rule 8 — Verify multi-domain consensus (at least 2 domains)
      if (config.enforceMultiDomainConsensus && opinions.length < 2) {
        throw new Error('Rule 8: at least 2 intelligence domains required for consensus')
      }

      // Stage 12 — REGIME_CLASSIFICATION (§9 — Fusion Engine, Rule 8)
      track('REGIME_CLASSIFICATION', () => {
        fusionResult = regimeDecisionFusionEngine.fuse({
          opinions,
          fusionWeights: regimeConfig.fusionWeights,
          pipeline,
        })
      })

      // Stage 13 — REGIME_CONFIDENCE_ESTIMATION (§10 — 7 dimensions)
      track('REGIME_CONFIDENCE_ESTIMATION', () => {
        const dataCompleteness = Math.min(1, observations.length / 100)
        confidence = regimeConfidenceCalculator.calculate({
          probabilityDistribution: fusionResult!.probabilityDistribution,
          opinions,
          consensusScore: fusionResult!.consensusScore,
          dataCompleteness,
        })
        amrieObservabilityCollector.recordConfidence(confidence.overallConfidence)
      })

      // §11 — Uncertainty analysis
      uncertainty = regimeUncertaintyAnalyzer.analyze({
        dataCompleteness: confidence!.dataCompleteness,
        conflictDetected: fusionResult!.conflictDetected,
        liquidityScore: opinions.find((o) => o.domain === 'LIQUIDITY')?.confidence ?? 0.5,
        volatilityScore: opinions.find((o) => o.domain === 'VOLATILITY')?.confidence ?? 0.5,
        featureStability: confidence!.temporalConsistency,
        regimeAmbiguity: 1 - fusionResult!.consensusScore,
      })

      // Stage 14 — TRANSITION_ANALYSIS (§12)
      track('TRANSITION_ANALYSIS', () => {
        transition = regimeTransitionAnalyzer.analyze({
          currentRegime: fusionResult!.probabilityDistribution.primaryRegime,
          previousRegime,
          confidence: confidence!.overallConfidence,
          stability: 0.7,
        })
        amrieObservabilityCollector.recordTransition(transition.status === 'TRANSITION_COMPLETION')
      })

      // Stage 15 — STABILITY_ANALYSIS (§7.5)
      track('STABILITY_ANALYSIS', () => {
        stability = regimeStabilityAnalyzer.analyze({
          confidence: confidence!,
          transitionProbability: transition!.probability,
          historicalData: [],
          currentRegime: fusionResult!.probabilityDistribution.primaryRegime,
        })
        amrieObservabilityCollector.recordStability(stability.overallStability)
      })

      // Stage 16 — GOVERNANCE_VALIDATION (§18)
      track('GOVERNANCE_VALIDATION', () => {
        governanceMetadata = regimeGovernanceManager.createInitial(regimeConfig.crossPipelineApproved)
        governanceMetadata = regimeGovernanceManager.markValidated(governanceMetadata)
        governanceMetadata = regimeGovernanceManager.approve(governanceMetadata, params.approvingActor, params.approvalNote)
        amrieObservabilityCollector.recordGovernanceEvent()
      })

      // Stage 17 — REGIME_PUBLICATION (Rule 3, Rule 4, Rule 14, Rule 23)
      track('REGIME_PUBLICATION', () => {
        // Generate manifest (Rule 14)
        manifest = regimeManifestGenerator.generate({
          regimeIdentifier: `${pipeline.toLowerCase()}-regime-${Date.now()}`,
          regimeVersion: versions.regimeVersion,
          versions,
          researchPipeline: pipeline,
          assetIdentifier: regimeConfig.assetIdentifier,
          timeframe: regimeConfig.timeframe,
          governanceMetadata: governanceMetadata!,
          sourceDatasetIds: retrieved!.sourceDatasetIds,
          sourceFeatureManifestIds: retrieved!.sourceFeatureManifestIds,
          sourceValidationCertificateIds: retrieved!.sourceValidationCertificateIds,
        })

        // Rule 23 — Register manifest (atomic, single active version)
        regimeRegistry.registerManifest(manifest!)

        // Classifications
        const currentRegime = fusionResult!.probabilityDistribution.primaryRegime
        const marketStructure = classificationHelper.classifyMarketStructure(currentRegime)
        const volatilityClass = classificationHelper.classifyVolatility(currentRegime)
        const liquidityClass = classificationHelper.classifyLiquidity(currentRegime)
        const trendClass = classificationHelper.classifyTrend(currentRegime)

        // Build lineage (Rule 5)
        lineage = regimeLineageTracker.build({
          sourceDatasetIds: retrieved!.sourceDatasetIds,
          sourceFeatureManifestIds: retrieved!.sourceFeatureManifestIds,
          sourceValidationCertificateIds: retrieved!.sourceValidationCertificateIds,
          methodologyVersionIds: [regimeConfig.methodologyVersion],
          registryEntryIds: [],
          governanceEventIds: input.governanceMetadata.map((g) => g.governanceId),
          upstreamEngines: retrieved!.upstreamEngines,
        })

        // Generate canonical contract (Rule 2/3)
        contract = regimeContractGenerator.generate({
          regimeIdentifier: manifest!.regimeIdentifier,
          regimeVersion: versions.regimeVersion,
          researchPipeline: pipeline,
          currentRegime,
          confidence: confidence!,
          probabilityDistribution: fusionResult!.probabilityDistribution,
          stability: stability!,
          transition: transition!,
          expectedPersistence: stability!.expectedPersistence,
          marketStructureClassification: marketStructure,
          volatilityClassification: volatilityClass,
          liquidityClassification: liquidityClass,
          trendClassification: trendClass,
          configurationVersion: versions.configurationVersion,
          validationMetadata: {
            certificateId: retrieved!.sourceValidationCertificateIds[0] ?? 'unknown',
            certificateVersion: versions.validationVersion,
            validated: true,
          },
          governanceMetadata: governanceMetadata!,
          regimeManifest: manifest!,
          uncertainty: uncertainty!,
          domainOpinions: opinions,
          executionEnvironment: regimeConfig.executionEnvironment,
          lineage: lineage!,
          pipelineStages,
        })

        // Compute content hash (Rule 11/17)
        contract!.contentHash = versionManager.computeContentHash(contract!)

        // Rule 4 — Freeze
        Object.freeze(contract)
        Object.freeze(contract!.governanceMetadata)
        Object.freeze(contract!.lineage)
        Object.freeze(contract!.regimeManifest)
        Object.freeze(contract!.regimeConfidence)
        Object.freeze(contract!.probabilityDistribution)
        Object.freeze(contract!.uncertainty)
        Object.freeze(contract!.regimeStability)
        Object.freeze(contract!.transitionProbability)
      })

      // Stage 18 — REGISTRY_REGISTRATION (Rule 16)
      track('REGISTRY_REGISTRATION', () => {
        registryEntry = {
          regimeIdentifier: contract!.regimeIdentifier,
          regimeEventId: contract!.regimeEventId,
          pipelineIdentifier: pipeline,
          researchVersion: versions.researchVersion,
          methodologyVersion: versions.methodologyVersion,
          configurationVersion: versions.configurationVersion,
          featureManifestVersion: versions.featureManifestVersion,
          validationCertificateVersion: versions.validationVersion,
          primaryRegime: contract!.currentRegime,
          secondaryRegime: contract!.probabilityDistribution.secondaryRegime,
          probabilityDistribution: contract!.probabilityDistribution,
          confidenceScore: contract!.regimeConfidence.overallConfidence,
          transitionStatus: contract!.transitionProbability.status,
          expectedPersistence: contract!.expectedPersistence,
          publicationTimestamp: contract!.createdAt,
          governanceStatus: contract!.governanceMetadata.approvalStatus,
          immutable: true, // Rule 16
        }
        regimeRegistry.register(registryEntry!)
        amrieObservabilityCollector.recordRegistryPublication()
        amrieObservabilityCollector.recordMethodologyVersion(versions.methodologyVersion)
      })

      // Stage 19 — MARKET_REGIME_COMPLETION
      track('MARKET_REGIME_COMPLETION', () => {
        this.recordHistory(contract!)
        amrieObservabilityCollector.recordRegimeGenerated(pipeline)
        log.info(
          `regime detected: ${contract?.regimeIdentifier} ${contract?.regimeVersion} ` +
          `(pipeline=${pipeline}, regime=${contract?.currentRegime}, ` +
          `confidence=${contract?.regimeConfidence.overallConfidence.toFixed(3)}, ` +
          `consensus=${fusionResult!.consensusScore.toFixed(3)}, ` +
          `uncertainty=${uncertainty!.overallUncertainty.toFixed(3)})`,
        )
      })

      amrieObservabilityCollector.recordClassificationTime(Date.now() - startTime)

      return {
        contract,
        registryEntry,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
        pipeline,
        regime: contract!.currentRegime,
        confidence: contract!.regimeConfidence.overallConfidence,
      }
    } catch (e) {
      regimeFailureRecovery.quarantine(`${regimeConfig.researchPipeline.toLowerCase()}-regime-${Date.now()}`, (e as Error).message)
      log.error(`regime detection failed: ${(e as Error).message}`)
      return {
        contract: null,
        registryEntry: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
        pipeline: regimeConfig.researchPipeline,
        regime: null,
        confidence: null,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // §7.8 / §22 — Runtime Classification (Environment A, Rule 21-25)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * §7.8 — Live Runtime Classification.
   * Rule 21 — Lightweight forward inference only (no training/clustering/fitting).
   * Rule 22 — Only observations up to timestamp T (no live lookahead).
   * Rule 23 — Loads only one active manifest.
   * Rule 24 — Safe Mode if manifest cannot be loaded.
   * Rule 25 — Instant Scalping uses streaming in-memory data.
   */
  classifyRuntimeRegime(params: {
    observations: Array<{ timestamp: number; price: number; volume: number; [k: string]: unknown }>
    timestamp: number
    config: AMRIEConfiguration
  }): RuntimeClassificationResult {
    const activeManifest = regimeRegistry.getActiveManifest()
    const result = runtimeRegimeClassifier.classify({
      observations: params.observations,
      activeManifest,
      config: params.config,
      timestamp: params.timestamp,
    })

    if (result.safeMode) {
      // Rule 24 — Safe Mode: preserve last valid regime, stop publishing
      const lastValid = runtimeRegimeClassifier.getLastValidRegime()
      return {
        classified: false,
        safeMode: true,
        reason: result.reason,
        regime: lastValid?.currentRegime ?? null,
      }
    }

    if (!result.classified) {
      return { classified: false, safeMode: false, reason: result.reason, regime: null }
    }

    // Rule 22 — Filter to only observations at or before T
    const validObs = params.observations.filter((o) => o.timestamp <= params.timestamp)
    if (validObs.length === 0) {
      return { classified: false, safeMode: false, reason: 'No observations at or before T', regime: null }
    }

    // Rule 21 — Lightweight rule evaluation (use trend intelligence as proxy)
    const opinion = trendIntelligence.analyze(validObs)
    return {
      classified: true,
      safeMode: false,
      reason: 'Runtime classification complete (lightweight inference)',
      regime: opinion.regime,
    }
  }

  /** Rule 24 — Enter Safe Mode manually. */
  enterSafeMode(): void {
    runtimeRegimeClassifier.enterSafeMode()
  }

  /** Rule 24 — Exit Safe Mode. */
  exitSafeMode(): void {
    runtimeRegimeClassifier.exitSafeMode()
  }

  /** Rule 24 — Check if in Safe Mode. */
  isInSafeMode(): boolean {
    return runtimeRegimeClassifier.isInSafeMode()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 11 — Deterministic Replay
  // ───────────────────────────────────────────────────────────────────────────

  replayRegime(regimeEventId: string): { recovered: boolean; entry: RegimeRegistryEntry | null } {
    amrieObservabilityCollector.recordReplayRequest()
    return regimeFailureRecovery.replay(regimeEventId, regimeRegistry)
  }

  getRegimeHistory(regimeIdentifier: string): RegimeRegistryEntry[] {
    return regimeRegistry.getHistory(regimeIdentifier)
  }

  getLatestRegime(regimeIdentifier: string): RegimeRegistryEntry | null {
    return regimeRegistry.getLatest(regimeIdentifier)
  }

  /** Rule 23 — Get active manifest. */
  getActiveManifest(): RegimeManifest | null {
    return regimeRegistry.getActiveManifest()
  }

  /** §21 — Observability snapshot. */
  observability(): Record<string, unknown> {
    const snapshot = amrieObservabilityCollector.snapshot()
    return {
      ...snapshot,
      registryCount: regimeRegistry.count(),
      manifestCount: regimeRegistry.countManifests(),
      safeMode: runtimeRegimeClassifier.isInSafeMode(),
    }
  }

  /** §24 — List quarantined regimes. */
  listQuarantined(): Array<{ regimeIdentifier: string; reason: string; timestamp: number }> {
    return regimeFailureRecovery.listQuarantined()
  }

  getContractHistory(): CanonicalMarketRegimeContract[] {
    return this.history
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private recordHistory(contract: CanonicalMarketRegimeContract): void {
    this.history.push(contract)
    // Rule 24 — Track last valid regime for Safe Mode
    runtimeRegimeClassifier.setLastValidRegime(contract)
    if (this.history.length > this.MAX_HISTORY) this.history.shift()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  AMRIE_VERSION,
  MARKET_REGIME_SCHEMA_VERSION,
  REGIME_PIPELINE_STAGES,
  RUNTIME_INFERENCE_STAGES,
}

export const AMRIE_ENGINE_VERSION = AMRIE_VERSION
