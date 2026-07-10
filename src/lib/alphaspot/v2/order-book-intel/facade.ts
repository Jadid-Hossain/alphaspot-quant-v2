// CHAPTER 3.7 §1, §13 — Order Book Intelligence Engine Facade
//
// Manages per-asset OBI engines (§13, Rule 9 — independent per asset).
// Routes Microstructure Snapshots to the appropriate engine.

import { createLogger } from '../domains/01-core-infrastructure'
import type { MicrostructureSnapshot } from '../microstructure/types'
import type { OrderBookIntelligenceSnapshot, DistanceWeightingConfig } from './types'
import { OrderBookIntelligenceEngine } from './engine'

const log = createLogger('order-book-intel:facade')

class OrderBookIntelligenceFacade {
  private engines = new Map<string, OrderBookIntelligenceEngine>()
  private subscribers = new Set<(symbol: string, snapshot: OrderBookIntelligenceSnapshot) => void>()
  private stats = {
    totalProcessed: 0,
    assetCount: 0,
  }

  getEngine(symbol: string): OrderBookIntelligenceEngine {
    let engine = this.engines.get(symbol)
    if (!engine) {
      engine = new OrderBookIntelligenceEngine(symbol)
      this.engines.set(symbol, engine)
      this.stats.assetCount = this.engines.size
      log.debug(`OBI engine created for ${symbol}`)
    }
    return engine
  }

  processSnapshot(snap: MicrostructureSnapshot): OrderBookIntelligenceSnapshot | null {
    this.stats.totalProcessed++
    const engine = this.getEngine(snap.symbol)
    const obiSnap = engine.processSnapshot(snap)
    for (const sub of this.subscribers) {
      try {
        sub(snap.symbol, obiSnap)
      } catch (e) {
        log.error(`subscriber failed for ${snap.symbol}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return obiSnap
  }

  getSnapshot(symbol: string): OrderBookIntelligenceSnapshot | null {
    return this.engines.get(symbol)?.getSnapshot() ?? null
  }

  getAllSnapshots(): Array<{ symbol: string; snapshot: OrderBookIntelligenceSnapshot }> {
    const out: Array<{ symbol: string; snapshot: OrderBookIntelligenceSnapshot }> = []
    for (const [symbol, engine] of this.engines) {
      const snap = engine.getSnapshot()
      if (snap) out.push({ symbol, snapshot: snap })
    }
    return out
  }

  setDistanceWeighting(config: DistanceWeightingConfig): void {
    for (const engine of this.engines.values()) engine.setDistanceWeighting(config)
  }

  onSnapshot(handler: (symbol: string, snapshot: OrderBookIntelligenceSnapshot) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getStats() {
    const engineStats = Array.from(this.engines.values()).map((e) => e.getStats())
    return {
      ...this.stats,
      wallsDetected: engineStats.reduce((a, e) => a + e.wallsDetected, 0),
      vacuumsDetected: engineStats.reduce((a, e) => a + e.vacuumsDetected, 0),
      spoofingDetected: engineStats.reduce((a, e) => a + e.spoofingDetected, 0),
      icebergsDetected: engineStats.reduce((a, e) => a + e.icebergsDetected, 0),
      absorptionEvents: engineStats.reduce((a, e) => a + e.absorptionEvents, 0),
    }
  }
}

export const orderBookIntelligence = new OrderBookIntelligenceFacade()
