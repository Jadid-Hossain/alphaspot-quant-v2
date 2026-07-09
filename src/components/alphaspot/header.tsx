'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { Activity, Coins, Pause, Play, RotateCcw, Wifi, WifiOff } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Watchlist } from './watchlist'
import { ShariahSettings } from './shariah-settings'
import { useState } from 'react'

export function Header() {
  const connected = useAlphaSpot((s) => s.connected)
  const engine = useAlphaSpot((s) => s.engine)
  const selectedSymbol = useAlphaSpot((s) => s.selectedSymbol)
  const startEngine = useAlphaSpot((s) => s.startEngine)
  const stopEngine = useAlphaSpot((s) => s.stopEngine)
  const resetPosition = useAlphaSpot((s) => s.resetPosition)
  const shariahMode = useAlphaSpot((s) => s.shariahMode)
  const live = useAlphaSpot((s) => s.livePrices[s.selectedSymbol])
  const snap = useAlphaSpot((s) => s.snapshots[s.selectedSymbol])
  const enabled = engine?.enabled ?? true
  const [sheetOpen, setSheetOpen] = useState(false)
  const base = selectedSymbol.split('/')[0]
  const price = live?.price ?? snap?.price ?? null
  const change = live?.change24hPct ?? snap?.change24hPct ?? null

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/70">
      <div className="flex items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
            <Activity className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-zinc-50">AlphaSpot</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/30">
                Paper
              </span>
            </div>
            <span className="text-[10px] text-zinc-500">Real-Time Crypto Trading AI</span>
          </div>
        </div>

        {/* Mobile: coin picker (Sheet trigger) */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 ring-1 ring-zinc-800 transition-colors hover:bg-zinc-800 lg:hidden">
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
              <span>{base}</span>
              {change != null && (
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    change >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                </span>
              )}
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] border-zinc-800 bg-zinc-950 p-0">
            <SheetHeader className="border-b border-zinc-800 px-3 py-2.5">
              <SheetTitle className="text-sm text-zinc-200">Select Coin</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100vh-3.5rem)]">
              <Watchlist inSheet onPick={() => setSheetOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        {/* Selected symbol price (compact, always visible) */}
        <div className="hidden min-w-0 flex-1 items-baseline gap-2 md:flex">
          <span className="text-sm font-bold text-zinc-100">{selectedSymbol}</span>
          {price != null && (
            <span className="font-mono text-sm tabular-nums text-zinc-400">
              ${price.toLocaleString('en-US', { minimumFractionDigits: price < 10 ? 4 : 2, maximumFractionDigits: price < 10 ? 4 : 2 })}
            </span>
          )}
          {change != null && (
            <span
              className={cn(
                'font-mono text-xs font-semibold tabular-nums',
                change >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="ml-auto flex items-center gap-2">
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ring-1',
              connected
                ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 ring-rose-500/30',
            )}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
          </div>

          {/* Shariah Compliance Settings */}
          <ShariahSettings />

          {enabled ? (
            <button
              onClick={stopEngine}
              className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/40 transition-colors hover:bg-amber-500/25"
            >
              <Pause className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Pause</span>
            </button>
          ) : (
            <button
              onClick={startEngine}
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/40 transition-colors hover:bg-emerald-500/25"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Start</span>
            </button>
          )}

          <button
            onClick={() => resetPosition(selectedSymbol)}
            title={`Reset ${selectedSymbol} position (paper)`}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
