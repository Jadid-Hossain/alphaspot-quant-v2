// Backend Shariah Compliance Gate
//
// Implements the Pipeline Gate (§2 of the feature requirement):
// If shariahMode === true, any asset where isShariahCompliant === false is
// instantly dropped from the evaluation queue BEFORE feature engineering,
// ML inference, ranking, or risk calculations. This saves CPU cycles.
//
// Also implements the Risk Engine Guardrails (§2):
// When shariahMode === true, execution is strictly locked to Spot Market
// Buying/Selling. Margin, Leverage, and Short-Selling are forced to 0/false.

import { db } from '../../src/lib/db'
import { classifySymbol } from '../../src/lib/alphaspot/compliance-registry'
import type { Symbol } from '../../src/lib/alphaspot/types'

// ─────────────────────────────────────────────────────────────────────────────
// Compliance cache — loaded from DB on first access, refreshed periodically
// ─────────────────────────────────────────────────────────────────────────────

interface ComplianceRecord {
  symbol: string
  isShariahCompliant: boolean
  complianceReason: string
  complianceCategory: string
}

const complianceCache = new Map<string, ComplianceRecord>()
let cacheLoaded = false
let cacheLoading = false

/** The global shariahMode flag (set via socket.io control events from the UI). */
let shariahModeEnabled = false

export function setShariahMode(enabled: boolean): void {
  if (shariahModeEnabled !== enabled) {
    shariahModeEnabled = enabled
    console.log(`[compliance] Shariah Mode ${enabled ? 'ENABLED' : 'DISABLED'}`)
  }
}

export function isShariahModeEnabled(): boolean {
  return shariahModeEnabled
}

/** Load compliance classifications from the DB into the cache. */
export async function loadComplianceCache(): Promise<void> {
  if (cacheLoading) return
  cacheLoading = true
  try {
    // Seed if empty
    const count = await db.assetCompliance.count()
    if (count === 0) {
      const { getAllClassifications } = await import('../../src/lib/alphaspot/compliance-registry')
      const all = getAllClassifications()
      await db.assetCompliance.createMany({
        data: all.map((c) => ({
          symbol: `${c.base}/USDT`,
          base: c.base,
          isShariahCompliant: c.category === 'COMPLIANT',
          complianceReason: c.reason,
          complianceCategory: c.category,
        })),
      })
      console.log(`[compliance] seeded ${all.length} compliance records`)
    }

    const records = await db.assetCompliance.findMany()
    complianceCache.clear()
    for (const r of records) {
      complianceCache.set(r.symbol, {
        symbol: r.symbol,
        isShariahCompliant: r.isShariahCompliant,
        complianceReason: r.complianceReason,
        complianceCategory: r.complianceCategory,
      })
    }
    cacheLoaded = true
    console.log(`[compliance] cache loaded: ${complianceCache.size} records (${[...complianceCache.values()].filter((r) => r.isShariahCompliant).length} compliant)`)
  } catch (e) {
    console.error('[compliance] failed to load cache:', e)
  } finally {
    cacheLoading = false
  }
}

/** Get compliance for a symbol (from cache or static fallback). */
export function getCompliance(symbol: Symbol): ComplianceRecord {
  const cached = complianceCache.get(symbol)
  if (cached) return cached

  // Static fallback
  const cls = classifySymbol(symbol)
  return {
    symbol,
    isShariahCompliant: cls.category === 'COMPLIANT',
    complianceReason: cls.reason,
    complianceCategory: cls.category,
  }
}

/**
 * THE PIPELINE GATE (§2):
 * If shariahMode is ON and the asset is NOT compliant, return true (drop it).
 * Non-compliant assets are instantly dropped from the evaluation queue
 * BEFORE any feature engineering, ML inference, or ranking.
 */
export function shouldDropForCompliance(symbol: Symbol): boolean {
  if (!shariahModeEnabled) return false
  const compliance = getCompliance(symbol)
  if (!compliance.isShariahCompliant) {
    return true // Drop — non-compliant in Shariah mode
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Engine Guardrails (§2):
// When shariahMode === true, force execution to Spot-only.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionGuardrails {
  allowedMarkets: ('spot' | 'margin' | 'futures' | 'options')[]
  maxLeverage: number
  allowShortSelling: boolean
  allowMargin: boolean
  restricted: boolean
  reason: string | null
}

/** Get the execution guardrails for the current shariahMode state. */
export function getExecutionGuardrails(): ExecutionGuardrails {
  if (!shariahModeEnabled) {
    return {
      allowedMarkets: ['spot', 'margin', 'futures'],
      maxLeverage: 20,
      allowShortSelling: true,
      allowMargin: true,
      restricted: false,
      reason: null,
    }
  }

  // Shariah mode: strictly Spot, 1x, no shorting, no margin
  return {
    allowedMarkets: ['spot'],
    maxLeverage: 1,
    allowShortSelling: false,
    allowMargin: false,
    restricted: true,
    reason: 'Shariah Compliance Mode: execution locked to unleveraged Spot trading. Margin, leverage, and short-selling are programmatically disabled.',
  }
}

/** Validate a trade against the guardrails. Returns true if the trade is allowed. */
export function validateTradeAgainstGuardrails(opts: {
  market: 'spot' | 'margin' | 'futures'
  leverage: number
  side: 'BUY' | 'SELL'
  isShort: boolean
}): { allowed: boolean; reason: string | null } {
  const guardrails = getExecutionGuardrails()

  if (!guardrails.allowedMarkets.includes(opts.market)) {
    return { allowed: false, reason: `Market "${opts.market}" not allowed in Shariah mode (Spot only)` }
  }
  if (opts.leverage > guardrails.maxLeverage) {
    return { allowed: false, reason: `Leverage ${opts.leverage}x exceeds max ${guardrails.maxLeverage}x in Shariah mode (1x only)` }
  }
  if (opts.isShort && !guardrails.allowShortSelling) {
    return { allowed: false, reason: 'Short selling is prohibited in Shariah mode (Long/Spot only)' }
  }
  if (opts.market === 'margin' && !guardrails.allowMargin) {
    return { allowed: false, reason: 'Margin trading is prohibited in Shariah mode' }
  }
  return { allowed: true, reason: null }
}

/** Export compliance data for the socket.io engine state broadcast. */
export function getComplianceSummary(): {
  shariahMode: boolean
  totalClassified: number
  compliantCount: number
  haramCount: number
  pendingCount: number
} {
  const records = [...complianceCache.values()]
  return {
    shariahMode: shariahModeEnabled,
    totalClassified: records.length,
    compliantCount: records.filter((r) => r.isShariahCompliant).length,
    haramCount: records.filter((r) => !r.isShariahCompliant && r.complianceCategory === 'HARAM').length,
    pendingCount: records.filter((r) => r.complianceCategory === 'PENDING').length,
  }
}
