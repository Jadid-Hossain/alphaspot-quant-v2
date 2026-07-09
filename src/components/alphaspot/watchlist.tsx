'use client'

import { memo, useState, useMemo } from 'react'
import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { fmtPrice, fmtPct, SIGNAL_META } from './format'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ListFilter, Search } from 'lucide-react'
import type { SymbolSnapshot } from '@/lib/alphaspot/types'

/** A colored dot indicating the AI signal for a symbol. */
function SignalDot({ label }: { label: string }) {
  const dotColor =
    label === 'STRONG_BUY' || label === 'TAKE_PROFIT'
      ? 'bg-emerald-400'
      : label === 'STRONG_SELL' || label === 'EMERGENCY_EXIT'
        ? 'bg-rose-400'
        : label === 'RECOVERY_BUY'
          ? 'bg-amber-400'
          : label === 'BUY'
            ? 'bg-emerald-500/60'
            : label === 'SELL'
              ? 'bg-rose-500/60'
              : 'bg-zinc-600'
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', dotColor, (label === 'STRONG_BUY' || label === 'STRONG_SELL') && 'animate-pulse-ring')}
    />
  )
}

interface RowProps {
  sym: string
  selected: boolean
  onSelect: () => void
}

/**
 * Each row subscribes to ONLY its own snapshot + live price via Zustand
 * selectors. This means when BTC's price updates, only the BTC row re-renders
 * — not all 350+ rows. This is the key optimization for a large watchlist.
 */
const WatchlistRow = memo(function WatchlistRow({ sym, selected, onSelect }: RowProps) {
  const base = sym.split('/')[0]
  // Per-row subscriptions: only this row re-renders when THIS symbol's data changes
  const snap = useAlphaSpot((s) => s.snapshots[sym])
  const live = useAlphaSpot((s) => s.livePrices[sym])
  const flash = useAlphaSpot((s) => s.lastPriceFlash[sym])

  // Prefer live price (instant) over snapshot price (periodic)
  const price = live?.price ?? snap?.price ?? null
  const change = live?.change24hPct ?? snap?.change24hPct ?? null
  const label = snap?.confluence.label ?? 'HOLD'
  const state = snap?.position.state ?? 'FLAT'
  const inPos = state !== 'FLAT'

  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors',
        selected ? 'border-emerald-500 bg-zinc-800/70' : 'border-transparent hover:bg-zinc-900/60',
        flash === 'up' && 'flash-green',
        flash === 'down' && 'flash-red',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-200">{base}</span>
          <SignalDot label={label} />
          {inPos && (
            <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold uppercase text-emerald-400">
              {state === 'RECOVERY_MODE' ? 'R' : 'IN'}
            </span>
          )}
        </div>
        <div
          className={cn(
            'font-mono text-[10px] tabular-nums',
            flash === 'up' ? 'text-emerald-400' : flash === 'down' ? 'text-rose-400' : 'text-zinc-500',
          )}
        >
          {price != null ? `$${fmtPrice(price, price < 10 ? 4 : 2)}` : '—'}
        </div>
      </div>
      <div
        className={cn(
          'text-right font-mono text-[11px] font-semibold tabular-nums',
          change == null ? 'text-zinc-600' : change >= 0 ? 'text-emerald-400' : 'text-rose-400',
        )}
      >
        {fmtPct(change, 1)}
      </div>
    </button>
  )
})

interface WatchlistProps {
  inSheet?: boolean
  onPick?: () => void
}

export function Watchlist({ inSheet, onPick }: WatchlistProps) {
  const symbols = useAlphaSpot((s) => s.symbols)
  const selectedSymbol = useAlphaSpot((s) => s.selectedSymbol)
  const setSelectedSymbol = useAlphaSpot((s) => s.setSelectedSymbol)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return symbols
    const q = query.toLowerCase()
    return symbols.filter((s) => s.toLowerCase().includes(q) || s.split('/')[0].toLowerCase().includes(q))
  }, [symbols, query])

  const list = (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-zinc-600">
          {symbols.length === 0 ? 'Loading coins…' : `No coins match “${query}”`}
        </div>
      ) : (
        filtered.map((sym) => (
          <WatchlistRow
            key={sym}
            sym={sym}
            selected={sym === selectedSymbol}
            onSelect={() => {
              setSelectedSymbol(sym)
              onPick?.()
            }}
          />
        ))
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <ListFilter className="h-3 w-3" />
            Watchlist
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
            {symbols.length}
          </span>
        </div>
      </div>
      <div className="border-b border-zinc-800 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md bg-zinc-950/60 px-2 py-1 ring-1 ring-zinc-800">
          <Search className="h-3 w-3 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coins…"
            className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
      </div>
      {inSheet ? list : <ScrollArea className="flex-1">{list}</ScrollArea>}
    </div>
  )
}
