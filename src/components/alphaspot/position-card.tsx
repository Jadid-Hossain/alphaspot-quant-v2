'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { STATE_META, fmtPrice, fmtUsd, fmtQty, fmtPct, fmtTime } from './format'
import { cn } from '@/lib/utils'
import { Wallet, TrendingUp, TrendingDown, Layers } from 'lucide-react'

export function PositionCard() {
  const { selectedSymbol, snapshots, engine } = useAlphaSpot()
  const snap = snapshots[selectedSymbol]
  const pos = snap?.position
  const allocated = engine?.allocatedCapital ?? 10000

  if (!pos) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="text-sm text-zinc-500">Loading position…</div>
      </div>
    )
  }

  const stateMeta = STATE_META[pos.state] ?? STATE_META.FLAT
  const upnl = pos.unrealizedPnl
  const upnlPct = pos.unrealizedPnlPct
  const inPos = pos.state !== 'FLAT' && pos.quantity > 0

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <Wallet className="h-3 w-3" />
          <span>Active Position</span>
        </div>
        <div className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', stateMeta.bg, stateMeta.color)}>
          {stateMeta.label}
        </div>
      </div>

      {/* PnL hero */}
      <div className="mt-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Unrealized PnL</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span
            className={cn(
              'font-mono text-3xl font-bold tabular-nums',
              !inPos ? 'text-zinc-600' : upnl != null && upnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {inPos ? fmtUsd(upnl) : '—'}
          </span>
          {inPos && upnlPct != null && (
            <span
              className={cn(
                'flex items-center gap-0.5 text-sm font-semibold',
                upnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {upnlPct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {fmtPct(upnlPct)}
            </span>
          )}
        </div>
      </div>

      {/* Grid of details */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Detail label="Avg Entry" value={inPos ? `$${fmtPrice(pos.avgEntryPrice)}` : '—'} mono />
        <Detail label="Quantity" value={inPos ? fmtQty(pos.quantity) : '—'} mono />
        <Detail label="Cost Basis" value={inPos ? fmtUsd(pos.quoteValue) : '—'} mono />
        <Detail
          label="Capital Used"
          value={inPos ? `${pos.capitalUsedPct.toFixed(1)}%` : '0.0%'}
          mono
          accent={pos.capitalUsedPct > 0 ? 'amber' : undefined}
        />
        <Detail label="Initial Entry" value={pos.initialEntryPrice ? `$${fmtPrice(pos.initialEntryPrice)}` : '—'} mono muted />
        <Detail label="Recovery Entry" value={pos.recoveryEntryPrice ? `$${fmtPrice(pos.recoveryEntryPrice)}` : '—'} mono muted />
        <Detail label="Fills" value={`${pos.trades}`} mono />
        <Detail label="Opened" value={pos.openedAt ? fmtTime(pos.openedAt) : '—'} mono muted />
      </div>

      {/* Capital deployed bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Capital Deployed
          </span>
          <span className="font-mono">
            {fmtUsd(pos.quoteValue)} / {fmtUsd(allocated)}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={cn('h-full rounded-full transition-all', pos.capitalUsedPct > 50 ? 'bg-amber-500' : 'bg-emerald-500')}
            style={{ width: `${Math.min(pos.capitalUsedPct, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
  muted,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  muted?: boolean
  accent?: 'amber' | 'emerald' | 'rose'
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className={cn(
          mono && 'font-mono tabular-nums',
          muted ? 'text-zinc-400' : 'text-zinc-100',
          accent === 'amber' && 'text-amber-400',
          accent === 'emerald' && 'text-emerald-400',
          accent === 'rose' && 'text-rose-400',
          'text-sm font-semibold',
        )}
      >
        {value}
      </div>
    </div>
  )
}
