// DOMAIN 12 — PERSISTENCE  (Chapter 2.1 §4, Domain 12)
//
// Purpose: Persist platform state.
//
// Responsibilities:
//   • database writes     • storage abstraction
//   • transactions        • data durability
//   • batching
//
// FORBIDDEN (Chapter 2.1 §7): Business logic, analysis.
// No business logic exists here. Persistence never performs analysis.

import type { MarketSnapshot, TradeCandidate, Recommendation, ExecutionResult } from '../../types'

export interface PersistenceContract {
  // ── Snapshots ──
  saveSnapshot(snapshot: MarketSnapshot): Promise<void>
  getSnapshot(version: number): Promise<MarketSnapshot | null>
  getLatestSnapshot(): Promise<MarketSnapshot | null>
  listSnapshots(limit: number): Promise<MarketSnapshot[]>

  // ── Candidates & Recommendations ──
  saveCandidate(candidate: TradeCandidate): Promise<void>
  saveRecommendation(rec: Recommendation): Promise<void>
  listRecommendations(filter?: { status?: string; limit?: number }): Promise<Recommendation[]>

  // ── Executions ──
  saveExecution(result: ExecutionResult): Promise<void>
  listExecutions(limit?: number): Promise<ExecutionResult[]>

  // ── Batched writes (for performance) ──
  batchWrite(table: string, rows: unknown[]): Promise<void>

  // ── Transaction support ──
  transaction<T>(fn: (tx: PersistenceTx) => Promise<T>): Promise<T>
}

export interface PersistenceTx {
  insert(table: string, row: unknown): Promise<void>
  update(table: string, id: string, patch: unknown): Promise<void>
  delete(table: string, id: string): Promise<void>
}

export const PERSISTENCE_TOKEN = 'domain.persistence'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Persistence × Business Logic
 *   Persistence × Analysis
 *
 * This domain may NOT: compute anything, validate business rules, or make
 * decisions. It is a pure storage abstraction. Replaceability (Principle 3):
 * SQLite can be swapped for PostgreSQL/distributed DBs without affecting
 * upstream domains.
 */
