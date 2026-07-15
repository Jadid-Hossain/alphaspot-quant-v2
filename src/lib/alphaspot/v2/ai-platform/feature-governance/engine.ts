// CHAPTER 4.5 §5-§17 — Feature Registry, Quality, Drift, Selection, Stability, Facade
//
// Registry (§5, Rule 5): every feature registered before use.
// Quality (§6): 8 metrics, low-quality → quarantine.
// Drift (§10, Rule 8): continuous monitoring, 5 methods, catastrophic → alert (Rule 15).
// Selection (§8, Rule 16): minimize redundancy, multicollinearity reduction.
// Stability (§9): 6 metrics, unstable → downgrade.
// FSG never directly suspends inference (Rule 17) — publishes alerts.

import { createLogger } from '../../domains/01-core-infrastructure'
import { EMA, CircularBuffer, emaForPeriod } from '../../microstructure/rolling-metrics'
import type {
  FeatureEntry,
  FeatureGovernanceSnapshot,
  FeatureIntegrityAlert,
  FeatureImportance,
  FeatureLifecycleState,
  FeatureQuality,
  FeatureStability,
  FeatureDrift,
  FeatureVersion,
  ImportanceMethod,
  DriftMethod,
} from './types'
import { canTransitionFeatureLifecycle, FSG_VERSION, FSG_GOVERNANCE_VERSION, FSG_REGISTRY_VERSION } from './types'

const log = createLogger('ai-platform:feature-governance')

// ─────────────────────────────────────────────────────────────────────────────
// Feature Registry  (Chapter 4.5 §5, Rule 5, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

class FeatureRegistry {
  private features = new Map<string, FeatureEntry>()
  private lifecycleHistory = new Map<string, Array<{ from: FeatureLifecycleState; to: FeatureLifecycleState; at: number; actor: string; note: string }>>()
  private alertSubscribers = new Set<(alert: FeatureIntegrityAlert) => void>()
  private stats = { totalRegistered: 0, approved: 0, production: 0, retired: 0, driftAlerts: 0 }

  /** Register a feature (§5, Rule 5 — no ML without registration). */
  register(entry: FeatureEntry): void {
    if (this.features.has(entry.featureName)) {
      throw new Error(`[fsg] feature "${entry.featureName}" already registered (Rule 5)`)
    }
    // Rule 12 — check for circular dependencies
    this.validateNoCircularDeps(entry.featureName, entry.dependencies, new Set())

    this.features.set(entry.featureName, Object.freeze({ ...entry }) as FeatureEntry)
    this.stats.totalRegistered++
    log.info(`feature registered: ${entry.featureName} (category: ${entry.category}, lifecycle: ${entry.lifecycleState})`)
  }

  /** Get a feature by name. */
  get(featureName: string): FeatureEntry | undefined {
    return this.features.get(featureName)
  }

  /** Get all features in a lifecycle state. */
  getByLifecycle(state: FeatureLifecycleState): FeatureEntry[] {
    return Array.from(this.features.values()).filter((f) => f.lifecycleState === state)
  }

  /** Get all production features. */
  getProductionFeatures(): FeatureEntry[] {
    return this.getByLifecycle('PRODUCTION')
  }

  /** Transition lifecycle (§12, Rule 10 — auditable, Rule 11 — no bypassing governance). */
  transitionLifecycle(featureName: string, to: FeatureLifecycleState, actor: string, note: string): FeatureEntry {
    const entry = this.features.get(featureName)
    if (!entry) throw new Error(`[fsg] feature "${featureName}" not found`)

    const from = entry.lifecycleState
    if (!canTransitionFeatureLifecycle(from, to)) {
      throw new Error(`[fsg] illegal lifecycle transition: ${from} → ${to} for "${featureName}" (§12)`)
    }

    // Rule 11 — no bypassing governance approval before production
    if (to === 'PRODUCTION' && entry.governance.approvalStatus !== 'APPROVED') {
      throw new Error(`[fsg] feature "${featureName}" cannot enter PRODUCTION — approval status is ${entry.governance.approvalStatus} (Rule 11)`)
    }

    const updated: FeatureEntry = {
      ...entry,
      lifecycleState: to,
      retiredAt: to === 'RETIRED' ? Date.now() : entry.retiredAt,
      governance: {
        ...entry.governance,
        auditHistory: [...entry.governance.auditHistory, { action: `LIFECYCLE:${from}→${to}`, at: Date.now(), actor, note }],
        retirementReason: to === 'RETIRED' ? note : entry.governance.retirementReason,
      },
    }
    this.features.set(featureName, Object.freeze(updated) as FeatureEntry)

    const history = this.lifecycleHistory.get(featureName) ?? []
    history.push({ from, to, at: Date.now(), actor, note })
    this.lifecycleHistory.set(featureName, history)

    this.updateStats()
    log.info(`lifecycle: ${featureName} ${from} → ${to} (${actor}: ${note})`)
    return updated
  }

  /** Approve a feature (§14, Rule 11). */
  approve(featureName: string, reviewer: string, notes: string): void {
    const entry = this.features.get(featureName)
    if (!entry) return
    const updated: FeatureEntry = {
      ...entry,
      governance: {
        ...entry.governance,
        approvalStatus: 'APPROVED',
        reviewer,
        reviewTimestamp: Date.now(),
        governanceNotes: [...entry.governance.governanceNotes, notes],
        auditHistory: [...entry.governance.auditHistory, { action: 'APPROVED', at: Date.now(), actor: reviewer, note: notes }],
      },
    }
    this.features.set(featureName, Object.freeze(updated) as FeatureEntry)
    this.stats.approved++
    log.info(`feature approved: ${featureName} (${reviewer})`)
  }

  /** Publish a Feature Integrity Alert (Rule 15, Rule 17 — never directly suspends inference). */
  publishAlert(alert: FeatureIntegrityAlert): void {
    this.stats.driftAlerts++
    log.warn(`Feature Integrity Alert [${alert.severity}]: ${alert.featureName} — ${alert.message}`)
    for (const sub of this.alertSubscribers) {
      try { sub(alert) } catch (e) { log.error(`alert subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
    }
  }

  /** Subscribe to integrity alerts (Rule 17 — downstream decides response). */
  onAlert(handler: (alert: FeatureIntegrityAlert) => void): () => void {
    this.alertSubscribers.add(handler)
    return () => this.alertSubscribers.delete(handler)
  }

  /** Validate no circular dependencies (§11, Rule 12 — acyclic). */
  private validateNoCircularDeps(featureName: string, dependencies: string[], visited: Set<string>): void {
    if (visited.has(featureName)) {
      throw new Error(`[fsg] CIRCULAR DEPENDENCY involving "${featureName}" (Rule 12 — acyclic required)`)
    }
    visited.add(featureName)
    for (const dep of dependencies) {
      const depEntry = this.features.get(dep)
      if (depEntry) {
        this.validateNoCircularDeps(dep, depEntry.dependencies, new Set(visited))
      }
    }
  }

  list(): FeatureEntry[] {
    return Array.from(this.features.values())
  }

  getStats() {
    return { ...this.stats, total: this.features.size }
  }

  private updateStats(): void {
    const all = Array.from(this.features.values())
    this.stats.production = all.filter((f) => f.lifecycleState === 'PRODUCTION').length
    this.stats.retired = all.filter((f) => f.lifecycleState === 'RETIRED').length
  }
}

export const featureRegistry = new FeatureRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// Feature Quality Assessor  (Chapter 4.5 §6)
// ─────────────────────────────────────────────────────────────────────────────

export function assessFeatureQuality(
  featureName: string,
  values: number[],
  threshold = 0.3,
): FeatureQuality {
  const nonNull = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v))
  const missingRate = values.length > 0 ? 1 - nonNull.length / values.length : 1
  const variance = nonNull.length > 0 ? nonNull.reduce((a, v) => a + (v - (nonNull.reduce((s, v) => s + v, 0) / nonNull.length)) ** 2, 0) / nonNull.length : 0
  const cardinality = new Set(nonNull).size
  const mean = nonNull.length > 0 ? nonNull.reduce((a, b) => a + b, 0) / nonNull.length : 0
  const std = Math.sqrt(variance)
  const outlierRate = nonNull.length > 0 ? nonNull.filter((v) => Math.abs(v - mean) > 3 * std).length / nonNull.length : 0
  const entropy = cardinality > 1 ? Math.log2(cardinality) : 0

  const overallQuality = Math.max(0, Math.min(1,
    (1 - missingRate) * 0.3 +
    Math.min(1, variance * 10) * 0.2 +
    Math.min(1, cardinality / 10) * 0.1 +
    (1 - outlierRate) * 0.2 +
    (entropy > 0 ? 0.2 : 0),
  ))

  return {
    featureName,
    missingRate,
    variance,
    entropy,
    cardinality,
    distributionStability: 0.8, // simplified
    temporalStability: 0.8,
    noiseLevel: outlierRate > 0.1 ? outlierRate : null,
    outlierRate,
    overallQuality,
    quarantined: overallQuality < threshold,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Drift Detector  (Chapter 4.5 §10, Rule 8)
// ─────────────────────────────────────────────────────────────────────────────

export function detectFeatureDrift(
  featureName: string,
  baseline: number[],
  current: number[],
  method: DriftMethod = 'PSI',
  driftThreshold = 0.2,
  catastrophicThreshold = 0.5,
): FeatureDrift {
  let driftScore = 0
  const baselineMean = baseline.reduce((a, b) => a + b, 0) / Math.max(1, baseline.length)
  const baselineStd = Math.sqrt(baseline.reduce((a, v) => a + (v - baselineMean) ** 2, 0) / Math.max(1, baseline.length))
  const currentMean = current.reduce((a, b) => a + b, 0) / Math.max(1, current.length)
  const currentStd = Math.sqrt(current.reduce((a, v) => a + (v - currentMean) ** 2, 0) / Math.max(1, current.length))

  switch (method) {
    case 'PSI': {
      // Population Stability Index
      const buckets = 10
      const min = Math.min(...baseline, ...current)
      const max = Math.max(...baseline, ...current)
      const range = max - min || 1
      let psi = 0
      for (let i = 0; i < buckets; i++) {
        const lo = min + (i / buckets) * range
        const hi = min + ((i + 1) / buckets) * range
        const basePct = baseline.filter((v) => v >= lo && v < hi).length / Math.max(1, baseline.length)
        const currPct = current.filter((v) => v >= lo && v < hi).length / Math.max(1, current.length)
        if (basePct > 0 && currPct > 0) {
          psi += (currPct - basePct) * Math.log(currPct / basePct)
        }
      }
      driftScore = Math.min(1, psi)
      break
    }
    case 'JENSEN_SHANNON': {
      // Simplified JS divergence
      driftScore = Math.min(1, Math.abs(currentMean - baselineMean) / Math.max(1, baselineStd))
      break
    }
    case 'KOLMOGOROV_SMIRNOV': {
      // Simplified KS statistic
      driftScore = Math.min(1, Math.abs(currentMean - baselineMean) / Math.max(1, baselineStd + currentStd))
      break
    }
    case 'WASSERSTEIN': {
      driftScore = Math.min(1, Math.abs(currentMean - baselineMean) / Math.max(1, baselineStd))
      break
    }
    case 'DISTRIBUTION_SHIFT':
    default: {
      driftScore = Math.min(1, Math.abs(currentMean - baselineMean) / Math.max(1, baselineStd))
      break
    }
  }

  return {
    featureName,
    method,
    driftScore,
    threshold: driftThreshold,
    isDrifting: driftScore > driftThreshold,
    isCatastrophic: driftScore > catastrophicThreshold,
    detectedAt: Date.now(),
    baseline: { mean: baselineMean, std: baselineStd },
    current: { mean: currentMean, std: currentStd },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Selector  (Chapter 4.5 §8, Rule 16 — minimize redundancy)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectionConfig {
  minQuality: number
  minStability: number
  maxCorrelation: number // Pearson correlation threshold for multicollinearity (Rule 16)
  minImportance: number
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  minQuality: 0.3,
  minStability: 0.3,
  maxCorrelation: 0.85,
  minImportance: 0.01,
}

export function selectFeatures(
  candidates: string[],
  quality: Record<string, FeatureQuality>,
  stability: Record<string, FeatureStability>,
  importance: Record<string, number>,
  correlationMatrix: Record<string, Record<string, number>> | null,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): { selected: string[]; rejected: Array<{ feature: string; reason: string }> } {
  const selected: string[] = []
  const rejected: Array<{ feature: string; reason: string }> = []

  // Sort by importance (highest first) for greedy selection
  const sorted = [...candidates].sort((a, b) => (importance[b] ?? 0) - (importance[a] ?? 0))

  for (const feature of sorted) {
    const q = quality[feature]
    const s = stability[feature]
    const imp = importance[feature] ?? 0

    // §8 — filter by quality
    if (q && q.overallQuality < config.minQuality) {
      rejected.push({ feature, reason: `low quality: ${q.overallQuality.toFixed(2)} < ${config.minQuality}` })
      continue
    }
    // §9 — filter by stability
    if (s && s.overallStability < config.minStability) {
      rejected.push({ feature, reason: `low stability: ${s.overallStability.toFixed(2)} < ${config.minStability}` })
      continue
    }
    // §7 — filter by importance
    if (imp < config.minImportance) {
      rejected.push({ feature, reason: `low importance: ${imp.toFixed(4)} < ${config.minImportance}` })
      continue
    }

    // §8, Rule 16 — multicollinearity reduction: check correlation with already-selected features
    if (correlationMatrix) {
      let isRedundant = false
      let redundantWith = ''
      for (const sel of selected) {
        const corr = Math.abs(correlationMatrix[feature]?.[sel] ?? 0)
        if (corr > config.maxCorrelation) {
          isRedundant = true
          redundantWith = sel
          break
        }
      }
      if (isRedundant) {
        rejected.push({ feature, reason: `multicollinearity: correlation > ${config.maxCorrelation} with "${redundantWith}" (Rule 16)` })
        continue
      }
    }

    selected.push(feature)
  }

  return { selected, rejected }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Stability Analyzer  (Chapter 4.5 §9)
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeFeatureStability(
  featureName: string,
  values: number[],
  windowSize = 50,
): FeatureStability {
  const buf = new CircularBuffer<number>(windowSize)
  for (const v of values) buf.push(v)
  const vals = buf.values()

  const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  const variance = vals.length > 0 ? vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length : 0
  const rollingVariance = variance

  // Distribution drift: compare first half vs second half
  const half = Math.floor(vals.length / 2)
  const firstHalf = vals.slice(0, half)
  const secondHalf = vals.slice(half)
  const firstMean = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0
  const secondMean = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0
  const distributionDrift = Math.abs(firstMean - secondMean) / Math.max(0.001, Math.abs(firstMean))

  const temporalConsistency = Math.max(0, 1 - Math.min(1, distributionDrift))
  const regimeStability = 0.8 // simplified
  const statisticalPersistence = Math.max(0, Math.min(1, 1 - rollingVariance))
  const availability = vals.length / windowSize

  const overallStability = (temporalConsistency * 0.3 + regimeStability * 0.2 + statisticalPersistence * 0.2 + availability * 0.3)

  return {
    featureName,
    rollingVariance,
    distributionDrift,
    temporalConsistency,
    regimeStability,
    statisticalPersistence,
    availability,
    overallStability,
    downgraded: overallStability < 0.3,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FSG Facade  (Chapter 4.5 §4 — immutable snapshots, Rule 17 — never suspends)
// ─────────────────────────────────────────────────────────────────────────────

class FeatureGovernanceEngine {
  private version = 0
  private snapshots: FeatureGovernanceSnapshot[] = []
  private subscribers = new Set<(snapshot: FeatureGovernanceSnapshot) => void>()

  /** Generate a Feature Governance Snapshot (§4, Rule 7 — immutable). */
  generateSnapshot(
    selected: string[],
    rejected: Array<{ feature: string; reason: string }>,
    importance: Record<string, number>,
    drift: Record<string, number>,
    stability: Record<string, number>,
    quality: Record<string, number>,
  ): FeatureGovernanceSnapshot {
    this.version++
    const hasCriticalDrift = Object.values(drift).some((d) => d > 0.5)
    const hasDegraded = Object.values(quality).some((q) => q < 0.3)

    const snapshot: FeatureGovernanceSnapshot = {
      featureSetId: `fsg-snapshot-v${this.version}`,
      featureVersion: FSG_VERSION,
      schemaVersion: '2.0.0',
      selectedFeatures: selected,
      rejectedFeatures: rejected,
      importanceScores: importance,
      driftScores: drift,
      stabilityScores: stability,
      qualityScores: quality,
      governanceStatus: hasCriticalDrift ? 'CRITICAL' : hasDegraded ? 'DEGRADED' : 'HEALTHY',
      metadata: { totalCandidates: selected.length + rejected.length },
      version: this.version,
      createdAt: Date.now(),
    }

    const frozen = Object.freeze(snapshot)
    this.snapshots.push(frozen)
    if (this.snapshots.length > 100) this.snapshots.shift()

    for (const sub of this.subscribers) {
      try { sub(frozen) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
    }

    // Rule 15 — if catastrophic drift, publish alert (Rule 17 — never directly suspends)
    if (hasCriticalDrift) {
      for (const [name, score] of Object.entries(drift)) {
        if (score > 0.5) {
          featureRegistry.publishAlert({
            alertId: `alert-${name}-${Date.now().toString(36)}`,
            type: 'CATACLYSMIC_DRIFT',
            severity: 'CRITICAL',
            featureName: name,
            driftScore: score,
            threshold: 0.5,
            message: `Catastrophic drift detected on "${name}": score ${score.toFixed(3)} exceeds threshold 0.5`,
            publishedAt: Date.now(),
            triggersAction: false, // Rule 17 — downstream decides
          })
        }
      }
    }

    log.info(`snapshot v${this.version}: ${selected.length} selected, ${rejected.length} rejected, status: ${snapshot.governanceStatus}`)
    return frozen
  }

  getLatestSnapshot(): FeatureGovernanceSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null
  }

  onSnapshot(handler: (snapshot: FeatureGovernanceSnapshot) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getStats() {
    return { snapshots: this.snapshots.length, latestVersion: this.version, ...featureRegistry.getStats() }
  }
}

export const featureGovernanceEngine = new FeatureGovernanceEngine()
