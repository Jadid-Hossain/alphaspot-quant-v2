// DOMAIN 13 — RESEARCH PLATFORM  (Chapter 2.1 §4, Domain 13)
//
// Purpose: Continuously improve the platform.
//
// Responsibilities:
//   • backtesting              • experiment tracking
//   • walk-forward validation  • historical evaluation
//   • optimization
//
// FORBIDDEN (Chapter 2.1 §7): Production Trading.
// Research NEVER publishes production recommendations.

import type { MarketSnapshot, Recommendation, ExecutionResult } from '../../types'

export interface BacktestResult {
  id: string
  strategy: string
  from: number
  to: number
  totalTrades: number
  winRate: number
  totalReturnPct: number
  maxDrawdownPct: number
  sharpeRatio: number | null
  snapshots: number
}

export interface ResearchPlatformContract {
  /** Backtest a strategy over a historical window. */
  backtest(strategy: string, from: number, to: number): Promise<BacktestResult>
  /** Validate a past recommendation against what actually happened. */
  validatePrediction(recommendationId: string): Promise<{ hit: boolean; actualReturnPct: number; note: string }>
  /** Walk-forward optimization. */
  walkForward(strategy: string, windows: number): Promise<BacktestResult[]>
  /** Experiment tracking (model versions, params, outcomes). */
  trackExperiment(name: string, params: Record<string, unknown>): Promise<string>
  /** Performance metrics for all past predictions. */
  getPerformanceMetrics(): Promise<{
    totalPredictions: number
    hitRate: number
    averageReturnPct: number
    calibrationError: number
  }>
}

export const RESEARCH_PLATFORM_TOKEN = 'domain.research-platform'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Research Platform × Production Trading
 *
 * This domain may NOT: publish production recommendations, execute real
 * trades, or feed its outputs into the live pipeline. Research runs on its
 * own schedule against historical data only. It informs future model
 * improvements but never touches the live recommendation stream.
 */
