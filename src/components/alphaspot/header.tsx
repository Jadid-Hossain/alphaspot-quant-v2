'use client'

import { useAlphaSpot, SYMBOLS } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { Activity, Pause, Play, RotateCcw, Wifi, WifiOff } from 'lucide-react'
import type { Symbol } from '@/lib/alphaspot/types'

export function Header() {
  const { connected, engine, selectedSymbol, setSelectedSymbol, startEngine, stopEngine, resetPosition } = useAlphaSpot()
  const enabled = engine?.enabled ?? true

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/70">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
            <Activity className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-zinc-50">AlphaSpot</span>
              <span className="hidden rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/30 sm:inline">
                Paper
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">Real-Time Crypto Trading AI</span>
          </div>
        </div>

        {/* Symbol tabs */}
        <nav className="order-3 flex w-full items-center gap-1 rounded-lg bg-zinc-900/80 p-1 ring-1 ring-zinc-800 sm:order-2 sm:ml-2 sm:w-auto">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedSymbol(s as Symbol)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none',
                selectedSymbol === s
                  ? 'bg-zinc-100 text-zinc-900 shadow'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              )}
            >
              {s}
            </button>
          ))}
        </nav>

        {/* Controls */}
        <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ring-1',
              connected
                ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 ring-rose-500/30',
            )}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
          </div>

          {enabled ? (
            <button
              onClick={stopEngine}
              className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/40 transition-colors hover:bg-amber-500/25"
            >
              <Pause className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Pause</span>
            </button>
          ) : (
            <button
              onClick={startEngine}
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/40 transition-colors hover:bg-emerald-500/25"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Start</span>
            </button>
          )}

          <button
            onClick={() => resetPosition(selectedSymbol)}
            title={`Reset ${selectedSymbol} position (paper)`}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
