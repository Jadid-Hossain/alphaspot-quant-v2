// CHAPTER 5.20 §7-§16 — Config Validation, Versioning, Hashing, Streaming, Governance

import { createLogger } from '../domains/01-core-infrastructure'
import { createHash } from 'crypto'
import type {
  CanonicalConfigurationContract,
  ConfigurationDependency,
  ConfigurationSnapshot,
  ConfigurationSubmission,
  CVCEConfiguration,
  DependencyGraph,
  ReleaseChannel,
} from './types'

const log = createLogger('decision-intelligence:configuration-engine:subsystems')

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ConfigValidator (Rule 1/11/17/18B)
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigValidator {
  /** Rule 1/11 — Validate configuration (schema + dependency + integrity). */
  validate(submission: ConfigurationSubmission, config: CVCEConfiguration): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Rule 18B — Never ingest/store plaintext secrets
    if (submission.containsSecrets && config.rejectPlaintextSecrets) {
      errors.push('Rule 18B violation: plaintext secrets rejected — only encrypted vault references allowed')
    }

    // Rule 11 — Schema validation
    if (!submission.data || Object.keys(submission.data).length === 0) {
      errors.push('configuration data is empty')
    }

    // Rule 10 — Dependency validation
    for (const dep of submission.dependencies) {
      if (!dep.dependencyId || !dep.dependencyVersion) {
        errors.push(`dependency missing ID or version: ${dep.dependencyId}`)
      }
      // Rule 18B — Check secret dependencies use vault references
      if (dep.isSecretReference && !dep.vaultPointer) {
        errors.push(`secret dependency ${dep.dependencyId} missing vault pointer (Rule 18B)`)
      }
    }

    // Rule 17 — Incomplete configurations never published
    return { valid: errors.length === 0, errors }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — DependencyResolver (Rule 10/14)
// ─────────────────────────────────────────────────────────────────────────────

export class DependencyResolver {
  /** Rule 10/14 — Resolve dependencies and build dependency graph. */
  resolve(dependencies: ConfigurationDependency[]): DependencyGraph {
    const allTransitive: string[] = []
    for (const dep of dependencies) {
      allTransitive.push(`${dep.dependencyId}@${dep.dependencyVersion}`)
    }
    // Rule 18 — Composite dependency hash
    const compositeDependencyHash = this.hash(allTransitive.join('|'))
    return { dependencies, compositeDependencyHash, allTransitiveDependencies: allTransitive }
  }

  private hash(data: string): string {
    return createHash('sha256').update(data).digest('hex').substring(0, 32)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5/Rule 18 — ConfigHasher (Composite cryptographic hash)
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigHasher {
  /** Rule 18 — Compute deterministic composite cryptographic hash. */
  compute(data: Record<string, unknown>, dependencyGraph: DependencyGraph): ConfigurationSnapshot {
    // Hash configuration data
    const dataStr = JSON.stringify(data, Object.keys(data).sort())
    const configurationHash = this.hash(dataStr)

    // Rule 18 — Composite hash = hash(snapshot + complete dependency graph)
    const compositeStr = configurationHash + '|' + dependencyGraph.compositeDependencyHash
    const compositeHash = this.hash(compositeStr)

    return {
      data, configurationHash, compositeHash,
      schemaVersion: '1.0.0',
    }
  }

  /** Rule 18 — Verify integrity (tamper detection). */
  verify(snapshot: ConfigurationSnapshot, dependencyGraph: DependencyGraph): boolean {
    const recomputed = this.compute(snapshot.data, dependencyGraph)
    return recomputed.compositeHash === snapshot.compositeHash
  }

  private hash(data: string): string {
    return createHash('sha256').update(data).digest('hex').substring(0, 32)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — VersionManager (Rule 5/7/8 — immutable, never modify, rollback = new version)
// ─────────────────────────────────────────────────────────────────────────────

export class VersionManager {
  private versions = new Map<string, CanonicalConfigurationContract[]>()
  private activeByEnv = new Map<string, Map<string, CanonicalConfigurationContract>>()

  /** Rule 5/7 — Register immutable configuration version. */
  register(config: CanonicalConfigurationContract): void {
    const key = config.configurationIdentifier
    const list = this.versions.get(key) ?? []
    list.push(config)
    this.versions.set(key, list)

    // Track active per environment
    const envKey = `${config.environmentIdentifier}`
    if (!this.activeByEnv.has(envKey)) this.activeByEnv.set(envKey, new Map())
    this.activeByEnv.get(envKey)!.set(key, config)

    log.info(`configuration ${key} v${config.configurationVersion} registered for ${envKey}`)
  }

  /** Get active configuration for an environment. */
  getActive(identifier: string, environment: string): CanonicalConfigurationContract | null {
    return this.activeByEnv.get(environment)?.get(identifier) ?? null
  }

  /** Rule 12 — Get all versions for deterministic replay. */
  getAllVersions(identifier: string): CanonicalConfigurationContract[] {
    return this.versions.get(identifier) ?? []
  }

  /** Rule 8 — Rollback creates new immutable version (never modifies historical). */
  rollback(identifier: string, targetVersion: string, actor: string, reason: string, currentTime: number = Date.now()): CanonicalConfigurationContract | null {
    const versions = this.versions.get(identifier)
    if (!versions) return null
    const target = versions.find((v) => v.configurationVersion === targetVersion)
    if (!target) return null

    // Rule 8 — Create new immutable version (not modify historical)
    const rolledBack: CanonicalConfigurationContract = Object.freeze({
      ...target,
      configurationEventId: `cfg-rollback-${currentTime.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      configurationVersion: `${targetVersion}-rollback-${currentTime.toString(36)}`,
      publicationStatus: 'ROLLED_BACK',
      rollbackIdentifier: target.configurationEventId,
      governanceMetadata: {
        ...target.governanceMetadata,
        reviewHistory: [...target.governanceMetadata.reviewHistory, {
          action: 'ROLLBACK', at: currentTime, actor, note: reason, outcome: 'APPROVED',
        }],
      },
      pipelineStages: [],
      createdAt: currentTime,
    }) as CanonicalConfigurationContract

    log.info(`configuration ${identifier} rolled back to v${targetVersion} → new v${rolledBack.configurationVersion} (Rule 8: new immutable version)`)
    return rolledBack
  }

  /** Rule 15 — Detect configuration drift. */
  detectDrift(identifier: string, currentData: Record<string, unknown>, environment: string): { driftDetected: boolean; driftScore: number } {
    const active = this.getActive(identifier, environment)
    if (!active) return { driftDetected: false, driftScore: 0 }
    const currentHash = createHash('sha256').update(JSON.stringify(currentData, Object.keys(currentData).sort())).digest('hex').substring(0, 32)
    const driftDetected = currentHash !== active.configurationHash
    return { driftDetected, driftScore: driftDetected ? 1 : 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 — ApprovalWorkflow (Four-eyes, digital sign-off, emergency)
// ─────────────────────────────────────────────────────────────────────────────

export class ApprovalWorkflow {
  /** §10 — Process approval workflow. */
  process(config: CanonicalConfigurationContract, config_settings: CVCEConfiguration, actor: string, approver: string | null, isEmergency: boolean): { approved: boolean; reason: string } {
    // §10 — Emergency changes
    if (isEmergency && config_settings.emergencyChangesAllowed) {
      log.warn(`emergency approval for ${config.configurationEventId} by ${actor}`)
      return { approved: true, reason: 'emergency approval' }
    }

    // §10 — Four-eyes principle
    if (config_settings.fourEyesRequired && (!approver || approver === actor)) {
      return { approved: false, reason: 'four-eyes principle requires different approver' }
    }

    return { approved: true, reason: `approved by ${actor}, sign-off by ${approver ?? 'N/A'}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 18A — ConfigStreamer (Hot-reload via pub-sub streaming)
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigStreamer {
  private subscribers = new Map<string, Set<(config: CanonicalConfigurationContract) => void>>()

  /** Rule 18A — Subscribe to configuration updates for hot-reload. */
  subscribe(identifier: string, handler: (config: CanonicalConfigurationContract) => void): () => void {
    if (!this.subscribers.has(identifier)) this.subscribers.set(identifier, new Set())
    this.subscribers.get(identifier)!.add(handler)
    log.debug(`subscriber registered for ${identifier} (Rule 18A hot-reload)`)
    return () => { this.subscribers.get(identifier)?.delete(handler) }
  }

  /** Rule 18A — Stream configuration update to subscribers (zero-downtime hot-reload). */
  stream(config: CanonicalConfigurationContract): void {
    const subs = this.subscribers.get(config.configurationIdentifier)
    if (subs) {
      for (const handler of subs) {
        try { handler(config) } catch (e) { log.error(`hot-reload subscriber failed: ${e}`) }
      }
      log.info(`configuration ${config.configurationIdentifier} v${config.configurationVersion} streamed to ${subs.size} subscribers (Rule 18A)`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance + Recovery + Observability
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigGovernanceManager {
  private g = new Map<string, import('./types').ConfigurationGovernanceMetadata>()
  init(id: string, now: number = Date.now()) {
    if (this.g.has(id)) return this.g.get(id)!
    const m = { approvalStatus: 'PENDING' as const, validationStatus: 'PENDING' as const, reviewHistory: [], auditHistory: [], creationTimestamp: now, publicationTimestamp: null as number | null, retirementStatus: 'ACTIVE' as const, governanceNotes: [], fourEyesApproved: false, digitalSignOff: null as string | null }
    this.g.set(id, m); return m
  }
  get(id: string) { return this.g.get(id) ?? null }
  approve(id: string, actor: string, note: string, fourEyes: boolean, signOff: string | null, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.reviewHistory.push({ action: 'APPROVE', at: now, actor, note, outcome: 'APPROVED' })
    m.approvalStatus = 'APPROVED'; m.publicationTimestamp = now
    m.fourEyesApproved = fourEyes; m.digitalSignOff = signOff
  }
  setValidation(id: string, status: 'PASSED' | 'FAILED' | 'WARNING', actor: string, note: string, now: number = Date.now()) {
    const m = this.g.get(id) ?? this.init(id, now)
    m.validationStatus = status; m.auditHistory.push({ action: `VALIDATION:${status}`, at: now, actor, note })
  }
}

export const configGovernanceManager = new ConfigGovernanceManager()

export class ConfigFailureRecovery {
  private failures: Array<{ id: string; type: string; stage: string; reason: string; at: number }> = []
  logFailure(type: string, stage: string, reason: string) {
    const id = `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`
    this.failures.push({ id, type, stage, reason, at: Date.now() })
    if (this.failures.length > 500) this.failures.shift()
    log.error(`config failure ${id} [${type}] at ${stage}: ${reason}`); return id
  }
  getStats() {
    const byType: Record<string, number> = {}
    for (const f of this.failures) byType[f.type] = (byType[f.type] ?? 0) + 1
    return { totalFailures: this.failures.length, failuresByType: byType }
  }
}

export const configFailureRecovery = new ConfigFailureRecovery()

export interface CVCEObservabilityMetrics {
  totalPublications: number; totalRollbacks: number; validationFailures: number
  dependencyErrors: number; approvalEvents: number; driftEvents: number
  environmentSyncs: number; governanceEvents: number
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>
  windowStart: number; windowEnd: number
}

export class CVCEObservabilityCollector {
  private total = 0; private rollbacks = 0; private valFailures = 0
  private depErrors = 0; private approvals = 0; private drifts = 0
  private envSyncs = 0; private govEvents = 0
  private stageTimings: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
  private windowStart = Date.now()

  recordPublication() { this.total++ }
  recordRollback() { this.rollbacks++ }
  recordValidationFailure() { this.valFailures++ }
  recordDependencyError() { this.depErrors++ }
  recordApproval() { this.approvals++ }
  recordDrift() { this.drifts++ }
  recordEnvSync() { this.envSyncs++ }
  recordGovernance() { this.govEvents++ }
  recordStageTiming(stage: string, ms: number) {
    if (!this.stageTimings[stage]) this.stageTimings[stage] = { count: 0, totalMs: 0, maxMs: 0 }
    this.stageTimings[stage].count++; this.stageTimings[stage].totalMs += ms
    if (ms > this.stageTimings[stage].maxMs) this.stageTimings[stage].maxMs = ms
  }

  snapshot(): CVCEObservabilityMetrics {
    const st: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {}
    for (const [k, v] of Object.entries(this.stageTimings)) st[k] = { count: v.count, totalMs: v.totalMs, avgMs: v.count > 0 ? v.totalMs / v.count : 0, maxMs: v.maxMs }
    return {
      totalPublications: this.total, totalRollbacks: this.rollbacks, validationFailures: this.valFailures,
      dependencyErrors: this.depErrors, approvalEvents: this.approvals, driftEvents: this.drifts,
      environmentSyncs: this.envSyncs, governanceEvents: this.govEvents,
      stageTimings: st, windowStart: this.windowStart, windowEnd: Date.now(),
    }
  }
  reset() { this.total = 0; this.rollbacks = 0; this.valFailures = 0; this.depErrors = 0; this.approvals = 0; this.drifts = 0; this.envSyncs = 0; this.govEvents = 0; this.stageTimings = {}; this.windowStart = Date.now() }
}

export const cvceObservabilityCollector = new CVCEObservabilityCollector()

// Singletons
export const configValidator = new ConfigValidator()
export const dependencyResolver = new DependencyResolver()
export const configHasher = new ConfigHasher()
export const versionManager = new VersionManager()
export const approvalWorkflow = new ApprovalWorkflow()
export const configStreamer = new ConfigStreamer()
