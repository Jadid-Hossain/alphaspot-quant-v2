// CHAPTER 4.4 §10, §11, §12, §13 — Model Registry, Lifecycle, Compatibility
//
// Model Registry (§10): Active, Historical, Experimental, Candidate, Deprecated, Archived.
// Model Lifecycle (§11, Rule 9, Rule 10): 6 states, no bypassing validation, auditable.
// Compatibility Manager (§12, Rule 8, Rule 18): strict schema validation before inference.
// Model Governance (§13): creator, approval, validation, audit, change history.

import { createLogger } from '../../domains/01-core-infrastructure'
import type { ProcessedFeatureVector } from '../../feature-processing/types'
import type {
  CompatibilityMetadata,
  FeatureSchema,
  ModelGovernance,
  ModelInstance,
  ModelLifecycleState,
  RegistryStatus,
  SchemaValidationResult,
} from './types'
import { canTransitionLifecycle } from './types'

const log = createLogger('ai-platform:models:registry')

// ─────────────────────────────────────────────────────────────────────────────
// Schema Validator  (Chapter 4.4 §12, Rule 18)
// Strict validation before inference. No auto-correction.
// ─────────────────────────────────────────────────────────────────────────────

export function validateFeatureSchema(
  features: ProcessedFeatureVector,
  schema: FeatureSchema,
): SchemaValidationResult {
  const errors: string[] = []
  const featureNames = Object.keys(features.processedFeatures)

  // §12, Rule 18 — Schema Version Verification
  const versionMatch = features.featureVersion === schema.schemaVersion
  if (!versionMatch) {
    errors.push(`schema version mismatch: feature=${features.featureVersion} vs model=${schema.schemaVersion}`)
  }

  // §12, Rule 18 — Feature Count Verification
  const countMatch = featureNames.length === schema.inputDimension
  if (!countMatch) {
    errors.push(`feature count mismatch: got ${featureNames.length} vs expected ${schema.inputDimension}`)
  }

  // §12, Rule 18 — Feature Name Verification
  const expectedNames = schema.featureNames
  const nameMatch = expectedNames.every((name) => featureNames.includes(name))
  if (!nameMatch) {
    const missing = expectedNames.filter((n) => !featureNames.includes(n))
    errors.push(`feature name mismatch: missing ${missing.join(', ')}`)
  }

  // §12, Rule 18 — Feature Order Verification
  const orderMatch = expectedNames.every((name, i) => featureNames[i] === name)
  if (!orderMatch) {
    errors.push(`feature order mismatch: expected [${expectedNames.slice(0, 5).join(',')}...] got [${featureNames.slice(0, 5).join(',')}...]`)
  }

  // §12, Rule 18 — Feature Hash Verification
  const computedHash = computeSchemaHash(featureNames)
  const hashMatch = computedHash === schema.schemaHash
  if (!hashMatch) {
    errors.push(`feature hash mismatch: computed=${computedHash} vs expected=${schema.schemaHash}`)
  }

  const valid = errors.length === 0
  return {
    valid,
    errors,
    versionMatch,
    countMatch,
    orderMatch,
    nameMatch,
    hashMatch,
    quarantined: !valid, // Rule 18 — quarantine on mismatch
  }
}

/** Compute a deterministic hash of feature names + order (§12). */
export function computeSchemaHash(featureNames: string[]): string {
  const str = featureNames.join('|')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return `hash-${hash.toString(36)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Registry  (Chapter 4.4 §10, §11, §13)
// ─────────────────────────────────────────────────────────────────────────────

class ModelRegistry {
  private models = new Map<string, ModelInstance>()
  private lifecycleHistory = new Map<string, Array<{ from: ModelLifecycleState; to: ModelLifecycleState; at: number; actor: string; note: string }>>()
  private stats = {
    totalRegistered: 0,
    activeCount: 0,
    candidateCount: 0,
    productionCount: 0,
    retiredCount: 0,
    compatibilityErrors: 0,
    lifecycleEvents: 0,
  }

  /** Register a new model (§10, Rule 4 — immutable after registration). */
  register(model: ModelInstance): void {
    if (this.models.has(model.modelId)) {
      throw new Error(`[models] model "${model.modelId}" already registered — historical models are immutable (Rule 4)`)
    }

    // Rule 9 — no model bypasses validation: new models start in DEVELOPMENT
    if (model.lifecycleState !== 'DEVELOPMENT') {
      throw new Error(`[models] new model "${model.modelId}" must start in DEVELOPMENT (Rule 9 — no bypassing validation)`)
    }

    // Rule 16 — check for circular dependencies in cascading models
    if (model.dependencies.length > 0) {
      // Check for self-reference first
      if (model.dependencies.includes(model.modelId)) {
        throw new Error(`[models] CIRCULAR DEPENDENCY: model "${model.modelId}" depends on itself (Rule 16 — acyclic required)`)
      }
      this.validateNoCircularDeps(model.modelId, model.dependencies)
    }

    this.models.set(model.modelId, Object.freeze({ ...model }) as ModelInstance)
    this.stats.totalRegistered++
    this.updateStats()
    log.info(`model registered: ${model.modelId} (family: ${model.family}, target: ${model.predictionTarget}, horizon: ${model.predictionHorizon}, lifecycle: ${model.lifecycleState})`)
  }

  /** Get a model by ID. */
  get(modelId: string): ModelInstance | undefined {
    return this.models.get(modelId)
  }

  /** Get all models by status (§10). */
  getByStatus(status: RegistryStatus): ModelInstance[] {
    return Array.from(this.models.values()).filter((m) => m.deploymentStatus === status)
  }

  /** Get all production models. */
  getProductionModels(): ModelInstance[] {
    return this.getByStatus('ACTIVE').filter((m) => m.lifecycleState === 'PRODUCTION')
  }

  /** Get models for a target + horizon. */
  getByTarget(targetId: string, horizon?: string): ModelInstance[] {
    return Array.from(this.models.values()).filter((m) => {
      if (m.predictionTarget !== targetId) return false
      if (horizon && m.predictionHorizon !== horizon) return false
      return true
    })
  }

  /**
   * Transition a model's lifecycle state (§11, Rule 9, Rule 10).
   * No model bypasses validation. Transitions fully auditable.
   */
  transitionLifecycle(modelId: string, to: ModelLifecycleState, actor: string, note: string): ModelInstance {
    const model = this.models.get(modelId)
    if (!model) throw new Error(`[models] model "${modelId}" not found`)

    const from = model.lifecycleState
    if (!canTransitionLifecycle(from, to)) {
      throw new Error(`[models] illegal lifecycle transition: ${from} → ${to} for "${modelId}" (§11)`)
    }

    // Rule 9 — only validated models may enter production
    if (to === 'PRODUCTION' && model.governance.validationStatus !== 'PASSED') {
      throw new Error(`[models] model "${modelId}" cannot enter PRODUCTION — validation status is ${model.governance.validationStatus} (Rule 9)`)
    }

    // Update model (create new frozen copy — Rule 4 immutable)
    const updated: ModelInstance = {
      ...model,
      lifecycleState: to,
      deploymentStatus: this.lifecycleToStatus(to),
      governance: {
        ...model.governance,
        auditHistory: [...model.governance.auditHistory, { action: `LIFECYCLE:${from}→${to}`, at: Date.now(), actor, note }],
      },
    }
    this.models.set(modelId, Object.freeze(updated) as ModelInstance)

    // Record lifecycle history (Rule 10 — auditable)
    const history = this.lifecycleHistory.get(modelId) ?? []
    history.push({ from, to, at: Date.now(), actor, note })
    this.lifecycleHistory.set(modelId, history)

    this.stats.lifecycleEvents++
    this.updateStats()
    log.info(`lifecycle: ${modelId} ${from} → ${to} (${actor}: ${note})`)

    return updated
  }

  /** Update governance approval (§13). */
  approve(modelId: string, actor: string): void {
    const model = this.models.get(modelId)
    if (!model) return
    const updated: ModelInstance = {
      ...model,
      governance: {
        ...model.governance,
        approvalStatus: 'APPROVED',
        auditHistory: [...model.governance.auditHistory, { action: 'APPROVED', at: Date.now(), actor, note: 'Model approved for validation' }],
      },
    }
    this.models.set(modelId, Object.freeze(updated) as ModelInstance)
    log.info(`model approved: ${modelId} (${actor})`)
  }

  /** Update validation status (§13, Rule 9). */
  setValidationStatus(modelId: string, status: 'PASSED' | 'FAILED', score: number, actor: string): void {
    const model = this.models.get(modelId)
    if (!model) return
    const updated: ModelInstance = {
      ...model,
      governance: {
        ...model.governance,
        validationStatus: status,
        auditHistory: [...model.governance.auditHistory, { action: `VALIDATION:${status}`, at: Date.now(), actor, note: `Score: ${score.toFixed(4)}` }],
      },
      performanceMetadata: { ...model.performanceMetadata, validationScore: score, lastValidatedAt: Date.now() },
    }
    this.models.set(modelId, Object.freeze(updated) as ModelInstance)
    log.info(`validation ${status}: ${modelId} (score: ${score.toFixed(4)}, ${actor})`)
  }

  /** Retire a model (§11). */
  retire(modelId: string, reason: string, actor: string): void {
    this.transitionLifecycle(modelId, 'RETIRED', actor, reason)
    const model = this.models.get(modelId)
    if (model) {
      const updated: ModelInstance = {
        ...model,
        governance: { ...model.governance, retirementReason: reason },
      }
      this.models.set(modelId, Object.freeze(updated) as ModelInstance)
    }
  }

  /** Validate no circular dependencies (§5, Rule 16 — acyclic). */
  private validateNoCircularDeps(modelId: string, dependencies: string[], visited: Set<string> = new Set()): void {
    if (visited.has(modelId)) {
      throw new Error(`[models] CIRCULAR DEPENDENCY DETECTED involving "${modelId}" (Rule 16 — acyclic required)`)
    }
    visited.add(modelId)
    for (const depId of dependencies) {
      const dep = this.models.get(depId)
      if (dep) {
        this.validateNoCircularDeps(depId, dep.dependencies, new Set(visited))
      }
    }
  }

  /** Map lifecycle state to registry status. */
  private lifecycleToStatus(state: ModelLifecycleState): RegistryStatus {
    switch (state) {
      case 'DEVELOPMENT':
      case 'TRAINING':
        return 'EXPERIMENTAL'
      case 'VALIDATION':
        return 'EXPERIMENTAL'
      case 'CANDIDATE':
        return 'CANDIDATE'
      case 'PRODUCTION':
        return 'ACTIVE'
      case 'RETIRED':
        return 'ARCHIVED'
      default:
        return 'HISTORICAL'
    }
  }

  getLifecycleHistory(modelId: string): Array<{ from: ModelLifecycleState; to: ModelLifecycleState; at: number; actor: string; note: string }> {
    return this.lifecycleHistory.get(modelId) ?? []
  }

  list(): ModelInstance[] {
    return Array.from(this.models.values())
  }

  getStats() {
    return { ...this.stats, total: this.models.size }
  }

  private updateStats(): void {
    const all = Array.from(this.models.values())
    this.stats.activeCount = all.filter((m) => m.deploymentStatus === 'ACTIVE').length
    this.stats.candidateCount = all.filter((m) => m.deploymentStatus === 'CANDIDATE').length
    this.stats.productionCount = all.filter((m) => m.lifecycleState === 'PRODUCTION').length
    this.stats.retiredCount = all.filter((m) => m.lifecycleState === 'RETIRED').length
  }
}

export const modelRegistry = new ModelRegistry()
