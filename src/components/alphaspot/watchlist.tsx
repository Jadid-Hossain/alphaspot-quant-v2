'use client'

import { memo } from 'react'
import { useAlphaSpot, SYMBOLS } from '@/hooks/use-alpha-spot'
import { fmtPrice, fmtPct, SIGNAL_META } from './format'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ListFilter, Search } from 'lucide-react'
import { useState, useMemo } from 'react'

/** A colored dot indicating the AI signal for a symbol. */
function SignalDot({ label, score }: { label: string; score: number }) {
  const meta = SIGNAL_META[label] ?? SIGNAL_META.HOLD
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
      title={`${meta.label} (${score > 0 ? '+' : ''}${score})`}
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', dotColor, (label === 'STRONG_BUY' || label === 'STRONG_SELL') && 'animate-pulse-ring')}
    />
  )
}

interface RowProps {
  sym: string
  base: string
  price: number | null
  change: number | null
  label: string
  score: number
  state: string
  selected: boolean
  onClick: () => void
}

const WatchlistRow = memo(function WatchlistRow({ sym, base, price, change, label, score, state, selected, onClick }: RowProps) {
  const inPos = state !== 'FLAT'
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-colors',
        selected ? 'border-emerald-500 bg-zinc-800/70' : 'border-transparent hover:bg-zinc-900/60',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-200">{base}</span>
          <SignalDot label={label} score={score} />
          {inPos && (
            <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold uppercase text-emerald-400">
              {state === 'RECOVERY_MODE' ? 'R' : 'IN'}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-zinc-500">
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
  /** When inside a Sheet (mobile), render without the ScrollArea wrapper. */
  inSheet?: boolean
  onPick?: () => void
}

export function Watchlist({ inSheet, onPick }: WatchlistProps) {
  const { snapshots, selectedSymbol, setSelectedSymbol } = useAlphaSpot()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return SYMBOLS
    const q = query.toLowerCase()
    return SYMBOLS.filter((s) => s.toLowerCase().includes(q) || s.split('/')[0].toLowerCase().includes(q))
  }, [query])

  const list = (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-zinc-600">No coins match &ldquo;{query}&rdquo;</div>
      ) : (
        filtered.map((sym) => {
          const snap = snapshots[sym]
          return (
            <WatchlistRow
              key={sym}
              sym={sym}
              base={sym.split('/')[0]}
              price={snap?.price ?? null}
              change={snap?.change24hPct ?? null}
              label={snap?.confluence.label ?? 'HOLD'}
              score={snap?.confluence.score ?? 0}
              state={snap?.position.state ?? 'FLAT'}
              selected={sym === selectedSymbol}
              onClick={() => {
                setSelectedSymbol(sym)
                onPick?.()
              }}
            />
          )
        })
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
            {SYMBOLS.length}
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
