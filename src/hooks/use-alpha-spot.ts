'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { io, type Socket } from 'socket.io-client'
import type {
  Symbol,
  SymbolSnapshot,
  EngineState,
  PriceTick,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/lib/alphaspot/types'
import type { ComplianceCategory } from '@/lib/alphaspot/compliance-registry'

export interface LogEntry {
  id: string
  symbol: string
  source: string
  level: string
  message: string
  createdAt: string
}

export interface TradeEntry {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  kind: string
  price: number
  quantity: number
  quoteValue: number
  state: string
  realizedPnl: number | null
  score: number
  reason: string
  createdAt: string
}

export interface ComplianceInfo {
  symbol: string
  base: string
  isShariahCompliant: boolean
  complianceReason: string
  complianceCategory: ComplianceCategory
}

interface AlphaSpotState {
  connected: boolean
  engine: EngineState | null
  /** The full list of symbols the engine is tracking (dynamic, from Binance exchangeInfo). */
  symbols: Symbol[]
  snapshots: Record<string, SymbolSnapshot | null>
  /** Lightweight price-only state for instant updates. When a full snapshot
   *  arrives it replaces this; between snapshots, priceTicks update it. */
  livePrices: Record<string, { price: number; change24hPct: number | null; volume24h: number | null; updatedAt: number }>
  logs: LogEntry[]
  trades: TradeEntry[]
  selectedSymbol: Symbol
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null
  lastPriceFlash: Record<string, 'up' | 'down' | null>

  // ── Shariah Compliance Mode (persisted to localStorage) ──
  /** Global toggle for Strict Shariah Compliance Mode.
   *  When true, non-compliant assets are filtered from the pipeline and
   *  execution is locked to unleveraged Spot trading. */
  shariahMode: boolean
  /** Compliance data per symbol, fetched from /api/compliance. */
  complianceMap: Record<string, ComplianceInfo>
  /** Whether the compliance data has been loaded. */
  complianceLoaded: boolean

  connect: () => void
  setSelectedSymbol: (s: Symbol) => void
  startEngine: () => void
  stopEngine: () => void
  resetPosition: (s: Symbol) => void
  clearLogs: () => void
  loadHistory: () => Promise<void>
  setShariahMode: (on: boolean) => void
  loadCompliance: () => Promise<void>
  getCompliance: (symbol: string) => ComplianceInfo | null
}

const MAX_LOGS = 300
const MAX_TRADES = 100

export const useAlphaSpot = create<AlphaSpotState>()(
  persist(
    (set, get) => ({
      connected: false,
      engine: null,
      symbols: [],
      snapshots: {},
      livePrices: {},
      logs: [],
      trades: [],
      selectedSymbol: 'BTC/USDT',
      socket: null,
      lastPriceFlash: {},

      // Shariah Compliance Mode — persisted to localStorage
      shariahMode: false,
      complianceMap: {},
      complianceLoaded: false,

  connect: () => {
    if (get().socket) return
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    }) as Socket<ServerToClientEvents, ClientToServerEvents>

    socket.on('connect', () => set({ connected: true }))
    socket.on('disconnect', () => set({ connected: false }))

    socket.on('engine', (state) => {
      set((s) => {
        // If the selected symbol is no longer in the list (e.g. engine restart
        // with a different set), fall back to the first available symbol.
        const sel = state.symbols.includes(s.selectedSymbol)
          ? s.selectedSymbol
          : state.symbols[0] ?? 'BTC/USDT'
        return { engine: state, symbols: state.symbols, selectedSymbol: sel }
      })
    })

    socket.on('snapshot', (snap) => {
      const prev = get().snapshots[snap.symbol]
      let flash: 'up' | 'down' | null = null
      if (prev && prev.price !== snap.price) {
        flash = snap.price > prev.price ? 'up' : 'down'
      }
      set((s) => ({
        snapshots: { ...s.snapshots, [snap.symbol]: snap },
        livePrices: {
          ...s.livePrices,
          [snap.symbol]: { price: snap.price, change24hPct: snap.change24hPct, volume24h: snap.volume24h, updatedAt: snap.updatedAt },
        },
        lastPriceFlash: { ...s.lastPriceFlash, [snap.symbol]: flash },
      }))
      if (flash) {
        setTimeout(() => {
          set((s) => ({ lastPriceFlash: { ...s.lastPriceFlash, [snap.symbol]: null } }))
        }, 600)
      }
    })

    socket.on('priceTick', (tick: PriceTick) => {
      // INSTANT update — no indicator computation, just the price.
      // This is what makes the displayed price match Binance in real-time.
      const prev = get().livePrices[tick.symbol]
      let flash: 'up' | 'down' | null = null
      if (prev && prev.price !== tick.price) {
        flash = tick.price > prev.price ? 'up' : 'down'
      }
      set((s) => ({
        livePrices: {
          ...s.livePrices,
          [tick.symbol]: { price: tick.price, change24hPct: tick.change24hPct, volume24h: tick.volume24h, updatedAt: nowMs() },
        },
        // Also patch the snapshot's price so the chart + signal box stay current
        snapshots: s.snapshots[tick.symbol]
          ? { ...s.snapshots, [tick.symbol]: { ...s.snapshots[tick.symbol]!, price: tick.price, change24hPct: tick.change24hPct ?? s.snapshots[tick.symbol]!.change24hPct, volume24h: tick.volume24h ?? s.snapshots[tick.symbol]!.volume24h } }
          : s.snapshots,
        lastPriceFlash: flash ? { ...s.lastPriceFlash, [tick.symbol]: flash } : s.lastPriceFlash,
      }))
      if (flash) {
        setTimeout(() => {
          set((s) => ({ lastPriceFlash: { ...s.lastPriceFlash, [tick.symbol]: null } }))
        }, 600)
      }
    })

    socket.on('log', (entry) => {
      set((s) => ({ logs: [entry, ...s.logs].slice(0, MAX_LOGS) }))
    })

    socket.on('trade', (trade) => {
      set((s) => ({ trades: [trade, ...s.trades].slice(0, MAX_TRADES) }))
    })

    set({ socket })
  },

  setSelectedSymbol: (sym) => set({ selectedSymbol: sym }),

  startEngine: () => {
    get().socket?.emit('control', { action: 'start' })
  },
  stopEngine: () => {
    get().socket?.emit('control', { action: 'stop' })
  },
  resetPosition: (sym) => {
    get().socket?.emit('control', { action: 'reset', symbol: sym })
  },
  clearLogs: () => set({ logs: [] }),

  loadHistory: async () => {
    try {
      const [logsRes, tradesRes] = await Promise.all([
        fetch('/api/logs?limit=100').then((r) => r.json()),
        fetch('/api/trades?limit=50').then((r) => r.json()),
      ])
      set((s) => ({
        logs: [...(s.logs ?? []), ...(logsRes.logs ?? []).reverse()].slice(0, MAX_LOGS),
        trades: [...(tradesRes.trades ?? []).map((t: TradeEntry) => ({ ...t, createdAt: t.createdAt })), ...s.trades].slice(0, MAX_TRADES),
      }))
    } catch (e) {
      console.error('loadHistory failed', e)
    }
  },

  // ── Shariah Compliance Mode actions ──
  setShariahMode: (on) => {
    set({ shariahMode: on })
    console.log(`[store] Shariah Compliance Mode ${on ? 'ENABLED' : 'DISABLED'}`)
    // Notify the backend engine to apply the pipeline gate
    get().socket?.emit('control', { action: on ? 'shariah-on' : 'shariah-off' })
  },

  loadCompliance: async () => {
    try {
      const res = await fetch('/api/compliance')
      if (!res.ok) return
      const data = await res.json()
      const map: Record<string, ComplianceInfo> = {}
      for (const r of data.records ?? []) {
        map[r.symbol] = {
          symbol: r.symbol,
          base: r.base,
          isShariahCompliant: r.isShariahCompliant,
          complianceReason: r.complianceReason,
          complianceCategory: r.complianceCategory as ComplianceCategory,
        }
      }
      set({ complianceMap: map, complianceLoaded: true })
    } catch (e) {
      console.error('loadCompliance failed', e)
    }
  },

  getCompliance: (symbol) => {
    return get().complianceMap[symbol] ?? null
  },
    }),
    {
      name: 'alphaspot-store',
      // Only persist the shariahMode flag (not socket/live data)
      partialize: (state) => ({ shariahMode: state.shariahMode }),
      // SSR-safe storage: returns undefined on the server, localStorage on client
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : undefined)),
      // Skip hydration during SSR — rehydrate happens on client only
      skipHydration: true,
    },
  ),
)

function nowMs() {
  return Date.now()
}

// Backward-compat export (components that imported SYMBOLS)
export const SYMBOLS: Symbol[] = []
