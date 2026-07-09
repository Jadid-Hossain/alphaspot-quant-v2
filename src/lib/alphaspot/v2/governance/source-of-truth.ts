// CHAPTER 2.4 §3 — Source of Truth
//
// Every business concept has ONE authoritative owner (Chapter 2.4 §3).
// No duplicated ownership is permitted.
//
// This registry enforces single-ownership at runtime: when a domain tries to
// register ownership for a concept that already has an owner, it throws.
// Consumers can resolve the owner of any concept to know where to fetch its
// authoritative value.

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('source-of-truth')

// ─────────────────────────────────────────────────────────────────────────────
// Business concepts  (Chapter 2.4 §3 examples)
// ─────────────────────────────────────────────────────────────────────────────

export type BusinessConcept =
  | 'market-price'
  | 'candle-history'
  | 'order-book'
  | 'funding-rate'
  | 'feature-vector'
  | 'market-context'
  | 'market-regime'
  | 'prediction'
  | 'trade-candidate'
  | 'expected-value'
  | 'risk-assessment'
  | 'portfolio-assessment'
  | 'recommendation'
  | 'execution-result'
  | 'market-snapshot'
  | 'performance-metrics'
  | (string & {}) // allow future concepts without editing this union

export interface OwnershipRecord {
  concept: BusinessConcept
  owner: string // domain name (e.g. 'market-data', 'decision-engine')
  registeredAt: number
  contractToken: string // DI token for resolving the owner's published interface
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership registry  (Chapter 2.4 §3 — no duplicated ownership)
// ─────────────────────────────────────────────────────────────────────────────

class OwnershipRegistry {
  private owners = new Map<BusinessConcept, OwnershipRecord>()
  private subscribers = new Set<(rec: OwnershipRecord) => void>()

  /**
   * Register a domain as the authoritative owner of a business concept.
   * Throws if another domain already owns it (§3 — no duplicated ownership).
   */
  register(concept: BusinessConcept, owner: string, contractToken: string): OwnershipRecord {
    const existing = this.owners.get(concept)
    if (existing) {
      if (existing.owner === owner) {
        log.warn(`domain "${owner}" re-registered ownership of "${concept}" (idempotent)`)
        return existing
      }
      throw new Error(
        `[source-of-truth] CONFLICT: concept "${concept}" is already owned by "${existing.owner}" — "${owner}" cannot claim it (Chapter 2.4 §3: no duplicated ownership)`,
      )
    }
    const rec: OwnershipRecord = { concept, owner, registeredAt: Date.now(), contractToken }
    this.owners.set(concept, rec)
    log.info(`ownership registered: "${concept}" → "${owner}"`)
    for (const sub of this.subscribers) sub(rec)
    return rec
  }

  /** Resolve the authoritative owner of a concept. */
  getOwner(concept: BusinessConcept): OwnershipRecord | undefined {
    return this.owners.get(concept)
  }

  /** Resolve the owner's published contract token (for DI lookup). */
  getContractToken(concept: BusinessConcept): string | undefined {
    return this.owners.get(concept)?.contractToken
  }

  /** Assert that a domain is the legitimate owner of a concept (defensive check). */
  assertOwner(concept: BusinessConcept, claimedOwner: string): void {
    const rec = this.owners.get(concept)
    if (!rec) {
      throw new Error(`[source-of-truth] concept "${concept}" has no registered owner`)
    }
    if (rec.owner !== claimedOwner) {
      throw new Error(
        `[source-of-truth] FORBIDDEN: "${claimedOwner}" attempted to act on "${concept}" but the authoritative owner is "${rec.owner}" (§3)`,
      )
    }
  }

  /** List all ownership records (for audit / documentation §14). */
  list(): OwnershipRecord[] {
    return Array.from(this.owners.values())
  }

  subscribe(handler: (rec: OwnershipRecord) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const ownership = new OwnershipRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// Canonical ownership declarations  (Chapter 2.4 §3)
// Register the mandated concept→owner mappings. These match the examples in §3
// and the domain responsibilities defined in Chapter 2.1.
// ─────────────────────────────────────────────────────────────────────────────

export function registerCanonicalOwnership(): void {
  // Each concept has exactly ONE owner. The DI tokens match DI_TOKENS in
  // 01-core-infrastructure.
  ownership.register('market-price', 'market-data', 'domain.market-data')
  ownership.register('candle-history', 'market-data', 'domain.market-data')
  ownership.register('order-book', 'market-data', 'domain.market-data')
  ownership.register('funding-rate', 'market-data', 'domain.market-data')
  ownership.register('feature-vector', 'feature-engineering', 'domain.feature-engineering')
  ownership.register('market-context', 'market-intelligence', 'domain.market-intelligence')
  ownership.register('market-regime', 'market-intelligence', 'domain.market-intelligence')
  ownership.register('prediction', 'machine-learning', 'domain.machine-learning')
  ownership.register('trade-candidate', 'decision-engine', 'domain.decision-engine')
  ownership.register('expected-value', 'decision-engine', 'domain.decision-engine')
  ownership.register('risk-assessment', 'risk-engine', 'domain.risk-engine')
  ownership.register('portfolio-assessment', 'portfolio-intelligence', 'domain.portfolio-intelligence')
  ownership.register('recommendation', 'workflow-orchestrator', 'domain.workflow-orchestrator')
  ownership.register('execution-result', 'execution-engine', 'domain.execution-engine')
  ownership.register('market-snapshot', 'workflow-orchestrator', 'domain.workflow-orchestrator')
  ownership.register('performance-metrics', 'research-platform', 'domain.research-platform')
  log.info(`canonical ownership registered: ${ownership.list().length} concepts`)
}
