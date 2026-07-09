// CHAPTER 2.4 §24 — Constitution initialization
//
// Single entry point that registers all canonical governance: ownership,
// dependencies, permissions, models, features. Call `initializeGovernance()`
// once at platform boot to enforce Chapter 2.4 standards.

import { createLogger } from '../domains/01-core-infrastructure'
import { registerCanonicalOwnership, ownership } from './source-of-truth'
import { declareCanonicalDependencies, dependencyGovernance } from './dependency-governance'
import { grantCanonicalPermissions, permissions } from './security'
import { registerCanonicalModelsAndFeatures, modelGovernance, featureGovernance } from './model-feature-governance'

const log = createLogger('governance-init')

let initialized = false

/**
 * Initialize the full governance layer (Chapter 2.4).
 * Call once at platform boot. Idempotent.
 */
export function initializeGovernance(): {
  ownershipCount: number
  dependencyCount: number
  permissionGrants: number
  modelCount: number
  featureCount: number
} {
  if (initialized) {
    log.warn('governance already initialized — skipping')
    return {
      ownershipCount: ownership.list().length,
      dependencyCount: dependencyGovernance.list().length,
      permissionGrants: permissions.listAll().length,
      modelCount: modelGovernance.listModels().length,
      featureCount: featureGovernance.list().length,
    }
  }

  log.info('initializing governance layer (Chapter 2.4)...')

  // §3 — Source of Truth: one authoritative owner per business concept
  registerCanonicalOwnership()

  // §4 — Dependency Governance: hierarchical, no cycles/bidirectional
  declareCanonicalDependencies()

  // §7 — Security Boundaries: least privilege per domain
  grantCanonicalPermissions()

  // §10, §11 — Model & Feature Governance: versioned artifacts
  registerCanonicalModelsAndFeatures()

  // Validate the full graph (§4)
  const validation = dependencyGovernance.validate()
  if (!validation.valid) {
    throw new Error(
      `[governance-init] dependency validation FAILED: ${validation.cycles.length} cycles, ${validation.bidirectional.length} bidirectional`,
    )
  }

  initialized = true
  log.info(
    `governance initialized: ${ownership.list().length} ownership records, ${dependencyGovernance.list().length} dependencies, ${permissions.listAll().length} permission grants, ${modelGovernance.listModels().length} models, ${featureGovernance.list().length} features`,
  )

  return {
    ownershipCount: ownership.list().length,
    dependencyCount: dependencyGovernance.list().length,
    permissionGrants: permissions.listAll().length,
    modelCount: modelGovernance.listModels().length,
    featureCount: featureGovernance.list().length,
  }
}

export function isGovernanceInitialized(): boolean {
  return initialized
}
