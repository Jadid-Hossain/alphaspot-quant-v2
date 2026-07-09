'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { fmtTime } from './format'
import { cn } from '@/lib/utils'
import { useEffect, useRef } from 'react'
import { Brain, Terminal, Trash2 } from 'lucide-react'

// (AutoScrollBottom removed — handled via useEffect in main component)

const LEVEL_META: Record<string, { color: string; bg: string; label: string }> = {
  INFO: { color: 'text-zinc-400', bg: 'bg-zinc-500/15', label: 'INFO' },
  WARN: { color: 'text-amber-400', bg: 'bg-amber-500/15', label: 'WARN' },
  SIGNAL: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'SIGNAL' },
  TRADE: { color: 'text-sky-300', bg: 'bg-sky-500/15', label: 'TRADE' },
  ERROR: { color: 'text-rose-400', bg: 'bg-rose-500/15', label: 'ERROR' },
}

const SOURCE_META: Record<string, { color: string; icon: React.ReactNode }> = {
  ENGINE: { color: 'text-zinc-400', icon: <Terminal className="h-3 w-3" /> },
  LLM: { color: 'text-violet-400', icon: <Brain className="h-3 w-3" /> },
  SYSTEM: { color: 'text-zinc-500', icon: <Terminal className="h-3 w-3" /> },
}

export function ReasoningLog() {
  const { logs, clearLogs, selectedSymbol } = useAlphaSpot()
  const scrollRef = useRef<HTMLDivElement>(null)
  const filtered = logs.filter((l) => l.symbol === selectedSymbol)

  // auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [filtered.length])

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <Brain className="h-3 w-3" />
          <span>AI Reasoning Log</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
            {selectedSymbol}
          </span>
        </div>
        <button
          onClick={clearLogs}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin"
        style={{ maxHeight: 380 }}
      >
        {filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-zinc-600">
            Waiting for AI reasoning…
          </div>
        ) : (
          filtered.map((log) => {
            const lvl = LEVEL_META[log.level] ?? LEVEL_META.INFO
            const src = SOURCE_META[log.source] ?? SOURCE_META.SYSTEM
            return (
              <div
                key={log.id}
                className="rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className={cn('flex items-center gap-0.5 text-[10px] font-semibold uppercase', src.color)}>
                    {src.icon}
                    {log.source}
                  </span>
                  <span className={cn('rounded px-1 py-0.5 text-[9px] font-bold uppercase', lvl.bg, lvl.color)}>
                    {lvl.label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{fmtTime(log.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-300">{log.message}</p>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
