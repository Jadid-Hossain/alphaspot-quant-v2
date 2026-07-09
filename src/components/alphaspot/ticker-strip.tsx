'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { fmtPrice, fmtPct, fmtCompact, fearGreedColor } from './format'
import { cn } from '@/lib/utils'
import { TrendingDown, TrendingUp, Gauge, BarChart3 } from 'lucide-react'

export function TickerStrip() {
  const selectedSymbol = useAlphaSpot((s) => s.selectedSymbol)
  const snap = useAlphaSpot((s) => s.snapshots[s.selectedSymbol])
  const live = useAlphaSpot((s) => s.livePrices[s.selectedSymbol])
  const flash = useAlphaSpot((s) => s.lastPriceFlash[s.selectedSymbol])

  // Prefer live price (instant priceTick updates) over snapshot price
  const price = live?.price ?? snap?.price ?? null
  const change = live?.change24hPct ?? snap?.change24hPct ?? null
  const volume = live?.volume24h ?? snap?.volume24h ?? null
  const fg = snap?.sentiment.fearGreed ?? null
  const fgLabel = snap?.sentiment.fearGreedLabel ?? null

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Price */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <span>{selectedSymbol} Price</span>
        </div>
        <div
          className={cn(
            'mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-50 transition-colors',
            flash === 'up' && 'text-emerald-400',
            flash === 'down' && 'text-rose-400',
          )}
        >
          ${fmtPrice(price, price && price < 10 ? 4 : 2)}
        </div>
      </div>

      {/* 24h change */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          {change != null && change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>24h Change</span>
        </div>
        <div
          className={cn(
            'mt-1 font-mono text-2xl font-bold tabular-nums',
            change == null ? 'text-zinc-500' : change >= 0 ? 'text-emerald-400' : 'text-rose-400',
          )}
        >
          {fmtPct(change)}
        </div>
      </div>

      {/* 24h volume */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <BarChart3 className="h-3 w-3" />
          <span>24h Volume</span>
        </div>
        <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-200">
          {fmtCompact(volume)}
          <span className="ml-1 text-xs font-normal text-zinc-500">{selectedSymbol.split('/')[0]}</span>
        </div>
      </div>

      {/* Fear & Greed */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <Gauge className="h-3 w-3" />
          <span>Fear &amp; Greed</span>
        </div>
        <div className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', fearGreedColor(fg))}>
          {fg ?? '—'}
          {fgLabel && <span className="ml-2 text-xs font-normal text-zinc-500">{fgLabel}</span>}
        </div>
      </div>
    </div>
  )
}
