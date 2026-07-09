'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { AlertTriangle, Github, Zap } from 'lucide-react'

export function Footer() {
  const { connected, engine, selectedSymbol, snapshots } = useAlphaSpot()
  const snap = snapshots[selectedSymbol]
  const enabled = engine?.enabled ?? true

  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px] sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                connected ? 'bg-emerald-500 animate-pulse-ring' : 'bg-rose-500',
              )}
            />
            <span className="font-medium text-zinc-400">{connected ? 'Engine Connected' : 'Disconnected'}</span>
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            Engine: <span className={enabled ? 'text-emerald-400' : 'text-amber-400'}>{enabled ? 'ACTIVE' : 'PAUSED'}</span>
          </span>
          {snap && (
            <span>
              {selectedSymbol} last tick: <span className="font-mono text-zinc-400">{new Date(snap.updatedAt).toLocaleTimeString('en-US', { hour12: false })}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-zinc-600">
          <span className="flex items-center gap-1 text-amber-500/80">
            <AlertTriangle className="h-3 w-3" />
            Paper trading simulation — not financial advice
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Github className="h-3 w-3" />
            AlphaSpot v1.0
          </span>
        </div>
      </div>
    </footer>
  )
}
