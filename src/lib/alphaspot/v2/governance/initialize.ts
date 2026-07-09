// CHAPTER 2.4 §24 + CHAPTER 2.5 — Constitution + AI Governance initialization
//
// Single entry point that registers all canonical governance: ownership,
// dependencies, permissions, models, features (Ch 2.4) + AI model lifecycle,
// prediction traceability, drift detection, decay policy (Ch 2.5).
// Call `initializeGovernance()` once at platform boot.

import { createLogger } from '../domains/01-core-infrastructure'
import { registerCanonicalOwnership, ownership } from './source-of-truth'
import { declareCanonicalDependencies, dependencyGovernance } from './dependency-governance'
import { grantCanonicalPermissions, permissions } from './security'
import { registerCanonicalModelsAndFeatures, modelGovernance, featureGovernance } from './model-feature-governance'
import { registerCanonicalAIModels, aiModelRegistry } from './ai-governance/model-lifecycle'
import { initializeAIGovernance } from './ai-governance/continuous-improvement'

const log = createLogger('governance-init')

let initialized = false

/**
 * Initialize the full governance layer (Chapter 2.4 + Chapter 2.5).
 * Call once at platform boot. Idempotent.
 */
export function initializeGovernance(): {
  ownershipCount: number
  dependencyCount: number
  permissionGrants: number
  modelCount: number
  featureCount: number
  aiModelCount: number
  aiRulesCount: number
} {
  if (initialized) {
    log.warn('governance already initialized — skipping')
    return {
      ownershipCount: ownership.list().length,
      dependencyCount: dependencyGovernance.list().length,
      permissionGrants: permissions.listAll().length,
      modelCount: modelGovernance.listModels().length,
      featureCount: featureGovernance.list().length,
      aiModelCount: aiModelRegistry.list().length,
      aiRulesCount: 10,
    }
  }

  log.info('initializing governance layer (Chapter 2.4 + 2.5)...')

  // Ch 2.4 §3 — Source of Truth: one authoritative owner per business concept
  registerCanonicalOwnership()

  // Ch 2.4 §4 — Dependency Governance: hierarchical, no cycles/bidirectional
  declareCanonicalDependencies()

  // Ch 2.4 §7 — Security Boundaries: least privilege per domain
  grantCanonicalPermissions()

  // Ch 2.4 §10, §11 — Model & Feature Governance: versioned artifacts
  registerCanonicalModelsAndFeatures()

  // Ch 2.5 §3, §4 — AI Model Lifecycle + extended registry
  registerCanonicalAIModels()

  // Ch 2.5 §20 — AI Governance rules + drift/decay/alert systems
  const aiInit = initializeAIGovernance()

  // Validate the full dependency graph (Ch 2.4 §4)
  const validation = dependencyGovernance.validate()
  if (!validation.valid) {
    throw new Error(
      `[governance-init] dependency validation FAILED: ${validation.cycles.length} cycles, ${validation.bidirectional.length} bidirectional`,
    )
  }

  initialized = true
  log.info(
    `governance initialized: ${ownership.list().length} ownership, ${dependencyGovernance.list().length} deps, ${permissions.listAll().length} perms, ${modelGovernance.listModels().length} models, ${featureGovernance.list().length} features, ${aiModelRegistry.list().length} AI models, ${aiInit.rulesCount} AI rules`,
  )

  return {
    ownershipCount: ownership.list().length,
    dependencyCount: dependencyGovernance.list().length,
    permissionGrants: permissions.listAll().length,
    modelCount: modelGovernance.listModels().length,
    featureCount: featureGovernance.list().length,
    aiModelCount: aiModelRegistry.list().length,
    aiRulesCount: aiInit.rulesCount,
  }
}

export function isGovernanceInitialized(): boolean {
  return initialized
}
