// CHAPTER 3.6 §1, §13 — Market Microstructure Engine Facade
//
// Manages per-asset MicrostructureEngine instances (§13, Rule 7 — each asset
// owns an independent engine, no shared state). Routes canonical events to
// the appropriate engine and provides unified snapshot access.

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalMarketEvent } from '../market-data/canonical-event'
import type { DepthRestitutionLimit, MicrostructureSnapshot } from './types'
import { DEFAULT_DEPTH_LIMIT } from './types'
import { MicrostructureEngine } from './engine'

const log = createLogger('microstructure:facade')

class MarketMicrostructureEngineFacade {
  private engines = new Map<string, MicrostructureEngine>()
  private depthLimit: DepthRestitutionLimit = DEFAULT_DEPTH_LIMIT
  private snapshotSubscribers = new Set<(symbol: string, snapshot: MicrostructureSnapshot) => void>()
  private stats = {
    totalEventsRouted: 0,
    totalSnapshotsPublished: 0,
    assetCount: 0,
  }

  /** Get or create an engine for an asset (§13 — independent per asset). */
  getEngine(symbol: string, exchange = 'binance'): MicrostructureEngine {
    let engine = this.engines.get(symbol)
    if (!engine) {
      engine = new MicrostructureEngine(symbol, exchange, this.depthLimit)
      this.engines.set(symbol, engine)
      this.stats.assetCount = this.engines.size
      log.debug(`engine created for ${symbol}`)
    }
    return engine
  }

  /** Route a canonical event to the appropriate per-asset engine (§6). */
  processEvent(event: CanonicalMarketEvent): MicrostructureSnapshot | null {
    this.stats.totalEventsRouted++
    const engine = this.getEngine(event.symbol, event.sourceExchange)
    const snapshot = engine.processEvent(event)
    if (snapshot) {
      this.stats.totalSnapshotsPublished++
      for (const sub of this.snapshotSubscribers) {
        try {
          sub(event.symbol, snapshot)
        } catch (e) {
          log.error(`snapshot subscriber failed for ${event.symbol}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    return snapshot
  }

  /** Get the latest snapshot for an asset (§5). */
  getSnapshot(symbol: string): MicrostructureSnapshot | null {
    return this.engines.get(symbol)?.getSnapshot() ?? null
  }

  /** Get snapshots for all assets. */
  getAllSnapshots(): Array<{ symbol: string; snapshot: MicrostructureSnapshot }> {
    const out: Array<{ symbol: string; snapshot: MicrostructureSnapshot }> = []
    for (const [symbol, engine] of this.engines) {
      const snap = engine.getSnapshot()
      if (snap) out.push({ symbol, snapshot: snap })
    }
    return out
  }

  /** Set the depth restitution limit (§7.1, Rule 11). */
  setDepthLimit(limit: DepthRestitutionLimit): void {
    this.depthLimit = limit
    log.info(`depth restitution limit set: ${limit.mode} (${limit.topN ?? limit.percentageDistance})`)
  }

  /** Subscribe to snapshot publications. */
  onSnapshot(handler: (symbol: string, snapshot: MicrostructureSnapshot) => void): () => void {
    this.snapshotSubscribers.add(handler)
    return () => this.snapshotSubscribers.delete(handler)
  }

  /** Get tracked assets. */
  getTrackedAssets(): string[] {
    return Array.from(this.engines.keys())
  }

  /** Observability (§16). */
  getStats() {
    const engineStats = Array.from(this.engines.values()).map((e) => e.getStats())
    return {
      ...this.stats,
      totalEventsProcessed: engineStats.reduce((a, e) => a + e.eventsProcessed, 0),
      totalDuplicatesIgnored: engineStats.reduce((a, e) => a + e.duplicatesIgnored, 0),
      totalDepthLevelsDiscarded: engineStats.reduce((a, e) => a + e.depthLevelsDiscarded, 0),
      totalRecoveries: engineStats.reduce((a, e) => a + e.recoveryCount, 0),
    }
  }
}

export const microstructureEngine = new MarketMicrostructureEngineFacade()
