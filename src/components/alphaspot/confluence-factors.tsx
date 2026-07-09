'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { Brain, ListChecks } from 'lucide-react'

export function ConfluenceFactors() {
  const { selectedSymbol, snapshots } = useAlphaSpot()
  const snap = snapshots[selectedSymbol]
  const factors = snap?.confluence.factors ?? []

  const sorted = [...factors].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        <ListChecks className="h-3 w-3" />
        <span>Confluence Factors</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
          {factors.length}
        </span>
      </div>

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-thin" style={{ maxHeight: 320 }}>
        {sorted.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-zinc-600">No active factors</div>
        ) : (
          sorted.map((f) => {
            const pos = f.score >= 0
            const mag = Math.min(Math.abs(f.score) / 30, 1) // scale: 30 = full bar
            return (
              <div key={f.key} className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-zinc-200">{f.label}</span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-xs font-bold tabular-nums',
                      pos ? 'text-emerald-400' : 'text-rose-400',
                    )}
                  >
                    {pos ? '+' : ''}
                    {f.score}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-700" />
                    <div
                      className={cn('absolute top-0 h-full rounded-full', pos ? 'bg-emerald-500' : 'bg-rose-500')}
                      style={
                        pos
                          ? { left: '50%', width: `${mag * 50}%` }
                          : { right: '50%', width: `${mag * 50}%` }
                      }
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{f.detail}</p>
              </div>
            )
          })
        )}
      </div>

      {snap?.sentiment.newsHeadlines && snap.sentiment.newsHeadlines.length > 0 && (
        <div className="mt-3 rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Brain className="h-3 w-3" />
            LLM Market Commentary
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            {snap.sentiment.newsHeadlines[0].title}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] text-zinc-600">Sentiment</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={cn(
                  'h-full rounded-full',
                  (snap.sentiment.newsScore ?? 0) >= 0 ? 'bg-emerald-500' : 'bg-rose-500',
                )}
                style={{
                  marginLeft: snap.sentiment.newsScore != null && snap.sentiment.newsScore < 0 ? `${50 + snap.sentiment.newsScore * 50}%` : '50%',
                  width: `${Math.abs((snap.sentiment.newsScore ?? 0)) * 50}%`,
                }}
              />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-zinc-400">
              {(snap.sentiment.newsScore ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
