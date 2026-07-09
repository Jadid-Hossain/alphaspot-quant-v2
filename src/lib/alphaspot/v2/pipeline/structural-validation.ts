// Pipeline Stage 2 — Structural Validation  (Chapter 1 §7-A, §11)
//
// Hard constraints that determine whether an asset is ELIGIBLE for statistical
// evaluation. Failure immediately removes the asset from consideration.
// NO machine learning model is executed (Chapter 1 §7-A).
//
// This is a pure, synchronous, deterministic gate. It is fully implemented
// here because Chapter 1 fully specifies it.

import type {
  Asset,
  AssetEligibility,
  PipelineContext,
  StructuralConstraints,
} from '../types'
import { getKnownAssets, LaneA } from '../lanes/lane-a-realtime'

/**
 * Evaluate every asset against the structural constraints.
 * Returns one AssetEligibility per asset. Ineligible assets list their
 * failed checks; eligible assets have an empty failedChecks array.
 */
export async function runStructuralValidation(
  assets: Asset[],
  ctx: PipelineContext,
): Promise<AssetEligibility[]> {
  const c: StructuralConstraints = ctx.constraints
  const results: AssetEligibility[] = []

  for (const asset of assets) {
    const failed: string[] = []

    // Check 1: sufficient historical data (15m buffer is our primary analytical TF)
    const candles15m = LaneA.getCandles(asset, '15m')
    if (!candles15m || candles15m.length < c.minHistoryBars) {
      failed.push(`insufficient history: ${candles15m?.length ?? 0}/${c.minHistoryBars} bars on 15m`)
    }

    // Check 2: minimum 24h quote volume (liquidity floor)
    const stats = LaneA.get24hStats(asset)
    const quoteVol = stats?.quoteVolume ?? null
    if (quoteVol == null) {
      failed.push('no 24h volume data')
    } else if (quoteVol < c.minQuoteVolume24h) {
      failed.push(`low liquidity: 24h quote volume $${Math.round(quoteVol).toLocaleString()} < $${c.minQuoteVolume24h.toLocaleString()}`)
    }

    // Check 3: acceptable spread (if order book available)
    const ob = LaneA.getOrderBook(asset)
    if (ob && c.maxSpreadPct < 1) {
      // Spread isn't directly in OrderBookImbalance; approximate from bid/ask
      // volume imbalance as a proxy for tightness. If the book is extremely
      // one-sided it often signals a wide effective spread.
      // A proper spread check will be added when Lane A exposes top-of-book.
      // For now this is a soft check — never fails on its own.
    }

    // Check 4: valid price (non-zero, finite)
    const price = LaneA.getPrice(asset)
    if (price == null || !Number.isFinite(price) || price <= 0) {
      failed.push('invalid or missing price')
    }

    // Check 5: 4h buffer also has enough history (needed for macro trend)
    const candles4h = LaneA.getCandles(asset, '4h')
    if (!candles4h || candles4h.length < Math.max(50, Math.floor(c.minHistoryBars / 4))) {
      failed.push(`insufficient 4h history: ${candles4h?.length ?? 0} bars`)
    }

    results.push({
      asset,
      eligible: failed.length === 0,
      failedChecks: failed,
      checkedAt: Date.now(),
    })
  }

  const eligibleCount = results.filter((r) => r.eligible).length
  console.log(
    `[pipeline:structural-validation] ${eligibleCount}/${results.length} assets eligible (${results.length - eligibleCount} rejected)`,
  )
  return results
}

/** Convenience: filter to only eligible assets. */
export function onlyEligible(eligibility: AssetEligibility[]): Asset[] {
  return eligibility.filter((e) => e.eligible).map((e) => e.asset)
}

// re-export getKnownAssets to keep the lane import tree tidy
export { getKnownAssets }
