'use client'

import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import type {
  Symbol,
  SymbolSnapshot,
  EngineState,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/lib/alphaspot/types'

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

interface AlphaSpotState {
  connected: boolean
  engine: EngineState | null
  snapshots: Record<Symbol, SymbolSnapshot | null>
  logs: LogEntry[]
  trades: TradeEntry[]
  selectedSymbol: Symbol
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null
  lastPriceFlash: Record<Symbol, 'up' | 'down' | null>

  connect: () => void
  setSelectedSymbol: (s: Symbol) => void
  startEngine: () => void
  stopEngine: () => void
  resetPosition: (s: Symbol) => void
  clearLogs: () => void
  loadHistory: () => Promise<void>
}

const MAX_LOGS = 200
const MAX_TRADES = 100

export const useAlphaSpot = create<AlphaSpotState>((set, get) => ({
  connected: false,
  engine: null,
  snapshots: {
    'BTC/USDT': null,
    'ETH/USDT': null,
    'SOL/USDT': null,
  },
  logs: [],
  trades: [],
  selectedSymbol: 'BTC/USDT',
  socket: null,
  lastPriceFlash: {
    'BTC/USDT': null,
    'ETH/USDT': null,
    'SOL/USDT': null,
  },

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

    socket.on('engine', (state) => set({ engine: state }))

    socket.on('snapshot', (snap) => {
      const prev = get().snapshots[snap.symbol]
      let flash: 'up' | 'down' | null = null
      if (prev && prev.price !== snap.price) {
        flash = snap.price > prev.price ? 'up' : 'down'
      }
      set((s) => ({
        snapshots: { ...s.snapshots, [snap.symbol]: snap },
        lastPriceFlash: { ...s.lastPriceFlash, [snap.symbol]: flash },
      }))
      // clear flash after 600ms
      if (flash) {
        setTimeout(() => {
          set((s) => ({ lastPriceFlash: { ...s.lastPriceFlash, [snap.symbol]: null } }))
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
        // prepend DB history (oldest first) then keep recent in-memory logs on top
        logs: [...(s.logs ?? []), ...(logsRes.logs ?? []).reverse()].slice(0, MAX_LOGS),
        trades: [...(tradesRes.trades ?? []).map((t: TradeEntry) => ({ ...t, createdAt: t.createdAt })), ...s.trades].slice(0, MAX_TRADES),
      }))
    } catch (e) {
      console.error('loadHistory failed', e)
    }
  },
}))

export const SYMBOLS: Symbol[] = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']
