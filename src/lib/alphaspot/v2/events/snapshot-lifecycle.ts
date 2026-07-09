// CHAPTER 2.2 §11, §12, §13 — Snapshot Lifecycle
//
// Snapshots are immutable analytical results. Every analytical cycle produces
// exactly one snapshot (Chapter 2.2 Rule 4). Every downstream calculation
// references exactly one Snapshot ID (Chapter 2.2 §12, Rule 8).
//
// Snapshot states (Chapter 2.2 §13):
//   CREATED → COLLECTING → PROCESSING → VALIDATING → COMPLETE → PUBLISHED
//                                                            └→ FAILED
//
// State transitions are MONOTONIC — snapshots never move backward (§13).

import { createLogger } from '../domains/01-core-infrastructure'
import { publish, EVENT_TYPES } from './catalog'

const log = createLogger('snapshot-lifecycle')

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot states  (Chapter 2.2 §13)
// ─────────────────────────────────────────────────────────────────────────────

export type SnapshotState =
  | 'CREATED'
  | 'COLLECTING'
  | 'PROCESSING'
  | 'VALIDATING'
  | 'COMPLETE'
  | 'PUBLISHED'
  | 'FAILED'

/** Allowed forward transitions (monotonic — §13). */
const ALLOWED_TRANSITIONS: Record<SnapshotState, SnapshotState[]> = {
  CREATED: ['COLLECTING', 'FAILED'],
  COLLECTING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['COMPLETE', 'FAILED'],
  COMPLETE: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [], // terminal
  FAILED: [], // terminal
}

export function canTransition(from: SnapshotState, to: SnapshotState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot record  (Chapter 2.2 §11 — what a snapshot includes)
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotRecord {
  snapshotId: string
  version: number
  correlationId: string
  state: SnapshotState
  createdAt: number
  updatedAt: number
  publishedAt: number | null
  failedAt: number | null
  failureReason: string | null

  // The 9 content fields from Chapter 2.2 §11
  timestamp: number | null
  evaluatedAssets: string[] | null
  featureVersions: Record<string, string> | null
  marketContext: unknown | null
  predictions: unknown | null
  rankings: unknown[] | null
  tradeCandidates: unknown[] | null
  portfolioAssessment: unknown | null
  recommendationSet: unknown[] | null

  // Observability (Chapter 2.2 §21)
  stageTimings: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot registry — tracks every snapshot's lifecycle in-memory.
// (Persistence is delegated to Domain 12 — this is the live registry.)
// ─────────────────────────────────────────────────────────────────────────────

class SnapshotRegistry {
  private snapshots = new Map<string, SnapshotRecord>()
  private byVersion = new Map<number, string>() // version → snapshotId
  private counter = 0
  private subscribers = new Set<(rec: SnapshotRecord) => void>()

  /** Create a new snapshot in the CREATED state (Chapter 2.2 §13). */
  create(correlationId: string): SnapshotRecord {
    this.counter++
    const snapshotId = `snap-v${this.counter}-${Date.now().toString(36)}`
    const now = Date.now()
    const rec: SnapshotRecord = {
      snapshotId,
      version: this.counter,
      correlationId,
      state: 'CREATED',
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      failedAt: null,
      failureReason: null,
      timestamp: null,
      evaluatedAssets: null,
      featureVersions: null,
      marketContext: null,
      predictions: null,
      rankings: null,
      tradeCandidates: null,
      portfolioAssessment: null,
      recommendationSet: null,
      stageTimings: {},
    }
    this.snapshots.set(snapshotId, rec)
    this.byVersion.set(this.counter, snapshotId)
    log.info(`snapshot v${rec.version} (${snapshotId}) CREATED`, { correlationId })
    this.notify(rec)
    return rec
  }

  /** Transition a snapshot to a new state (monotonic — §13). */
  transition(snapshotId: string, to: SnapshotState, patch: Partial<SnapshotRecord> = {}): SnapshotRecord {
    const rec = this.snapshots.get(snapshotId)
    if (!rec) throw new Error(`[snapshot-lifecycle] unknown snapshot ${snapshotId}`)
    if (rec.state === 'PUBLISHED' || rec.state === 'FAILED') {
      throw new Error(`[snapshot-lifecycle] ${snapshotId} is terminal (${rec.state}) — cannot transition to ${to}`)
    }
    if (!canTransition(rec.state, to)) {
      throw new Error(`[snapshot-lifecycle] illegal transition ${rec.state} → ${to} for ${snapshotId}`)
    }
    const updated: SnapshotRecord = {
      ...rec,
      ...patch,
      state: to,
      updatedAt: Date.now(),
    }
    if (to === 'PUBLISHED') updated.publishedAt = Date.now()
    if (to === 'FAILED') {
      updated.failedAt = Date.now()
      log.warn(`snapshot v${updated.version} FAILED: ${patch.failureReason ?? 'unknown'}`, { snapshotId })
    }
    this.snapshots.set(snapshotId, updated)
    log.debug(`snapshot v${updated.version} ${rec.state} → ${to}`, { snapshotId })

    // Publish SnapshotCompleted when entering COMPLETE state (Chapter 2.2 §15)
    if (to === 'COMPLETE') {
      publish(
        EVENT_TYPES.SNAPSHOT_COMPLETED,
        'snapshot-registry',
        {
          snapshotId: updated.snapshotId,
          version: updated.version,
          eligibleAssets: (updated.evaluatedAssets ?? []).length,
          recommendations: (updated.recommendationSet ?? []).length,
          regime: 'UNKNOWN', // filled by orchestrator
          generatedAt: updated.createdAt,
          durationMs: updated.updatedAt - updated.createdAt,
        },
        updated.correlationId,
        updated.snapshotId,
      )
    }
    this.notify(updated)
    return updated
  }

  get(snapshotId: string): SnapshotRecord | undefined {
    return this.snapshots.get(snapshotId)
  }

  getByVersion(version: number): SnapshotRecord | undefined {
    const id = this.byVersion.get(version)
    return id ? this.snapshots.get(id) : undefined
  }

  getLatest(): SnapshotRecord | undefined {
    return this.getByVersion(this.counter)
  }

  getPublished(): SnapshotRecord[] {
    const out: SnapshotRecord[] = []
    for (const rec of this.snapshots.values()) if (rec.state === 'PUBLISHED') out.push(rec)
    return out.sort((a, b) => b.version - a.version)
  }

  list(limit = 100): SnapshotRecord[] {
    return Array.from(this.snapshots.values()).sort((a, b) => b.version - a.version).slice(0, limit)
  }

  /** Subscribe to snapshot state changes (Chapter 2.2 §21 observability). */
  subscribe(handler: (rec: SnapshotRecord) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  private notify(rec: SnapshotRecord): void {
    for (const sub of this.subscribers) sub(rec)
  }

  /** Observability stats (Chapter 2.2 §21). */
  getStats(): {
    total: number
    byState: Record<SnapshotState, number>
    latestVersion: number
    averageDurationMs: number | null
  } {
    const byState: Record<SnapshotState, number> = {
      CREATED: 0, COLLECTING: 0, PROCESSING: 0, VALIDATING: 0, COMPLETE: 0, PUBLISHED: 0, FAILED: 0,
    }
    let totalDur = 0
    let durCount = 0
    for (const rec of this.snapshots.values()) {
      byState[rec.state]++
      if (rec.publishedAt) {
        totalDur += rec.publishedAt - rec.createdAt
        durCount++
      }
    }
    return {
      total: this.snapshots.size,
      byState,
      latestVersion: this.counter,
      averageDurationMs: durCount > 0 ? totalDur / durCount : null,
    }
  }
}

export const snapshotRegistry = new SnapshotRegistry()
