// DOMAIN 11 — EXECUTION ENGINE  (Chapter 2.1 §4, Domain 11)
//
// Purpose: Manage trade execution.
//
// Responsibilities:
//   • paper execution        • execution monitoring
//   • order simulation       • trade lifecycle
//   • execution reports
//
// FORBIDDEN (Chapter 2.1 §7): Signal Generation. ZERO prediction logic.
//
// Consumes: approved Recommendations from Risk Engine
// Produces: ExecutionResult (paper-traded fills)

import type { Recommendation } from '../../types'

export interface ExecutionResult {
  recommendationId: string
  asset: string
  side: 'BUY' | 'SELL'
  kind: 'INITIAL' | 'RECOVERY' | 'TAKE_PROFIT' | 'EMERGENCY_EXIT'
  price: number
  quantity: number
  quoteValue: number
  realizedPnl: number | null
  executedAt: number
  status: 'FILLED' | 'PARTIAL' | 'REJECTED' | 'SKIPPED'
  reason: string
}

export interface ExecutionEngineContract {
  /** Execute (paper) a recommendation. */
  execute(recommendation: Recommendation): Promise<ExecutionResult>
  /** Current open positions. */
  getOpenPositions(): Array<{ asset: string; quantity: number; avgEntryPrice: number; openedAt: number }>
  /** Execution history. */
  getHistory(limit?: number): ExecutionResult[]
  /** Monitor open positions for take-profit / stop triggers (from Risk Engine). */
  tick(currentPrices: Map<string, number>): ExecutionResult[]
}

export const EXECUTION_ENGINE_TOKEN = 'domain.execution-engine'

/**
 * FORBIDDEN RESPONSIBILITIES (Chapter 2.1 §7):
 *   Execution Engine × Signal Generation
 *   Execution Engine × Prediction
 *
 * This domain may NOT: generate signals, predict prices, score assets, or
 * decide what to trade. It ONLY executes what the upstream pipeline approved.
 */
