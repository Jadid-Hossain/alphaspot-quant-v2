// CHAPTER 3.8 §1, §13 — Trade Flow Intelligence Facade
//
// Manages per-asset TFI engines (§13, Rule 8 — independent per asset).

import { createLogger } from '../domains/01-core-infrastructure'
import type { CanonicalMarketEvent, MicrostructureSnapshot } from '../microstructure/types'
import type { TradeFlowSnapshot } from './types'
import { TradeFlowEngine } from './engine'

const log = createLogger('trade-flow:facade')

class TradeFlowIntelligenceFacade {
  private engines = new Map<string, TradeFlowEngine>()
  private subscribers = new Set<(symbol: string, snapshot: TradeFlowSnapshot) => void>()
  private stats = { totalProcessed: 0, assetCount: 0 }

  getEngine(symbol: string): TradeFlowEngine {
    let engine = this.engines.get(symbol)
    if (!engine) {
      engine = new TradeFlowEngine(symbol)
      this.engines.set(symbol, engine)
      this.stats.assetCount = this.engines.size
      log.debug(`TFI engine created for ${symbol}`)
    }
    return engine
  }

  processTradeEvent(event: CanonicalMarketEvent, microSnapshot?: MicrostructureSnapshot): TradeFlowSnapshot | null {
    this.stats.totalProcessed++
    const engine = this.getEngine(event.symbol)
    const snap = engine.processTradeEvent(event, microSnapshot)
    if (snap) {
      for (const sub of this.subscribers) {
        try { sub(event.symbol, snap) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
      }
    }
    return snap
  }

  getSnapshot(symbol: string): TradeFlowSnapshot | null {
    return this.engines.get(symbol)?.getSnapshot() ?? null
  }

  onSnapshot(handler: (symbol: string, snapshot: TradeFlowSnapshot) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getStats() {
    const engineStats = Array.from(this.engines.values()).map((e) => e.getStats())
    return {
      ...this.stats,
      totalEvents: engineStats.reduce((a, e) => a + e.eventsProcessed, 0),
      totalDuplicates: engineStats.reduce((a, e) => a + e.duplicatesIgnored, 0),
      totalBlocks: engineStats.reduce((a, e) => a + e.blocksDetected, 0),
    }
  }
}

export const tradeFlowIntelligence = new TradeFlowIntelligenceFacade()
