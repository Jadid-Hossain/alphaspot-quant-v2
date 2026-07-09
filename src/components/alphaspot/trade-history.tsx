'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { fmtPrice, fmtUsd, fmtQty, fmtTime } from './format'
import { cn } from '@/lib/utils'
import { History } from 'lucide-react'

const KIND_META: Record<string, { color: string; label: string }> = {
  INITIAL: { color: 'text-emerald-400', label: 'Initial' },
  RECOVERY: { color: 'text-amber-400', label: 'Recovery' },
  TAKE_PROFIT: { color: 'text-emerald-400', label: 'Take Profit' },
  EMERGENCY_EXIT: { color: 'text-rose-400', label: 'Emergency' },
}

export function TradeHistory() {
  const { trades, selectedSymbol } = useAlphaSpot()
  const filtered = trades.filter((t) => t.symbol === selectedSymbol)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        <History className="h-3 w-3" />
        <span>Live Trade Feed</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
          {selectedSymbol}
        </span>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-zinc-600">
            No trades executed yet. Waiting for STRONG BUY signal…
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="pb-2 pr-3 font-medium">Time</th>
                <th className="pb-2 pr-3 font-medium">Side</th>
                <th className="pb-2 pr-3 font-medium">Kind</th>
                <th className="pb-2 pr-3 text-right font-medium">Price</th>
                <th className="pb-2 pr-3 text-right font-medium">Qty</th>
                <th className="pb-2 pr-3 text-right font-medium">Notional</th>
                <th className="pb-2 pr-3 text-right font-medium">Score</th>
                <th className="pb-2 text-right font-medium">PnL</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {filtered.map((t) => {
                const kind = KIND_META[t.kind] ?? { color: 'text-zinc-400', label: t.kind }
                const isBuy = t.side === 'BUY'
                return (
                  <tr key={t.id} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-2 pr-3 text-zinc-500">{fmtTime(t.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold',
                          isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400',
                        )}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className={cn('py-2 pr-3 text-[11px] font-semibold', kind.color)}>{kind.label}</td>
                    <td className="py-2 pr-3 text-right text-zinc-200">${fmtPrice(t.price, t.price < 10 ? 4 : 2)}</td>
                    <td className="py-2 pr-3 text-right text-zinc-400">{fmtQty(t.quantity, 5)}</td>
                    <td className="py-2 pr-3 text-right text-zinc-400">{fmtUsd(t.quoteValue, 0)}</td>
                    <td className="py-2 pr-3 text-right text-zinc-400">{t.score}</td>
                    <td
                      className={cn(
                        'py-2 text-right font-semibold',
                        t.realizedPnl == null
                          ? 'text-zinc-600'
                          : t.realizedPnl >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400',
                      )}
                    >
                      {t.realizedPnl != null ? fmtUsd(t.realizedPnl) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
