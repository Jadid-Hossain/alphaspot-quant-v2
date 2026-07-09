// DOMAIN 14 — PRESENTATION LAYER  (Chapter 2.1 §4, Domain 14)
//
// Purpose: Deliver information to the user.
//
// Responsibilities:
//   • dashboard             • explanations
//   • charts                • recommendation display
//   • watchlists            • historical performance
//
// FORBIDDEN (Chapter 2.1 §7): Business Logic. Presentation never performs calculations.
//
// In this Next.js architecture, the Presentation Layer = React components +
// the Zustand store that subscribes to the engine's socket.io stream. It only
// DISPLAYS snapshots produced by Workflow Orchestration — it never computes.

import type { MarketSnapshot, Recommendation, TradeCandidate } from '../../types'

export interface PresentationView {
  type: 'DASHBOARD' | 'WATCHLIST' | 'RECOMMENDATION_DETAIL' | 'PERFORMANCE' | 'CANDIDATE_EXPLORER'
  snapshot: MarketSnapshot | null
  selectedAsset: string | null
}

export interface PresentationContract {
  /** The latest snapshot to display (immutable). */
  getActiveSnapshot(): MarketSnapshot | null
  /** Subscribe to snapshot updates (socket.io-driven). */
  subscribeToSnapshots(handler: (snapshot: MarketSnapshot) => void): () => void
  /** Get the recommendation list for display. */
  getRecommendations(): Recommendation[]
  /** Get the candidate explorer view (all candidates, ranked). */
  getCandidates(): TradeCandidate[]
  /** Build an explanation view for a single recommendation (Principle 6). */
  explainRecommendation(id: string): { rationale: string; evidence: import('../../types').ExpectedValueComponent[] } | null
}

export const PRESENTATION_TOKEN = 'domain.presentation'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Presentation × Business Logic
 *   Presentation × Calculations
 *
 * This domain may NOT: compute indicators, score assets, estimate EV, or make
 * any trading decision. It renders the immutable Market Snapshot produced by
 * the upstream pipeline. Any "calculation" shown in the UI was computed
 * upstream — the Presentation Layer only formats and displays it.
 */
