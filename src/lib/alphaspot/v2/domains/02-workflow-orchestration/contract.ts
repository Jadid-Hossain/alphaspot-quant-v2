// DOMAIN 02 — WORKFLOW ORCHESTRATION  (Chapter 2.1 §4, Domain 02)
//
// Purpose: Coordinate the execution lifecycle.
//
// Responsibilities:
//   • when processing starts        • retry policy
//   • execution order               • timeout policy
//   • snapshot lifecycle            • pipeline completion
//
// FORBIDDEN (Chapter 2.1 §7): calculations, predictions, feature engineering.
// It ONLY coordinates.

import type { MarketSnapshot, PipelineContext } from '../../types'

export interface WorkflowOrchestratorContract {
  /** Start the orchestration cycle (scheduled snapshot generation). */
  start(): void
  /** Stop the orchestration cycle. */
  stop(): void
  /** Trigger an immediate pipeline run (manual). */
  runNow(): Promise<MarketSnapshot>
  /** Is the orchestrator currently running the pipeline? */
  isRunning(): boolean
  /** The latest published snapshot (immutable). */
  getLatestSnapshot(): MarketSnapshot | null
  /** Snapshot history (most recent first). */
  getHistory(limit?: number): MarketSnapshot[]
  /** Subscribe to new snapshots. */
  subscribe(handler: (snapshot: MarketSnapshot) => void): () => void
}

export const WORKFLOW_TOKEN = 'domain.workflow-orchestrator'

// Build the PipelineContext that downstream domains consume.
export function buildPipelineContext(snapshotVersion: number): PipelineContext {
  return {
    snapshotVersion,
    pipelineVersion: '2.0.0-ch2.1',
    constraints: {
      minHistoryBars: 200,
      minQuoteVolume24h: 1_000_000,
      maxSpreadPct: 0.5,
      requireExchangeTrading: true,
      requireSpotTradable: true,
      minAtr: null,
    },
    generatedAt: Date.now(),
  }
}
