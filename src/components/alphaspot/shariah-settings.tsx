'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useRef, useEffect } from 'react'

export function ShariahSettings() {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)
  const setShariahMode = useAlphaSpot((s) => s.setShariahMode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors',
          shariahMode
            ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/40'
            : 'bg-zinc-800 text-zinc-300 ring-zinc-700 hover:bg-zinc-700',
        )}
      >
        {shariahMode ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{shariahMode ? 'Shariah ON' : 'Settings'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-100">Settings</h3>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                ✕
              </button>
            </div>

            {/* Shariah Compliance Toggle */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className={cn('h-4 w-4', shariahMode ? 'text-emerald-400' : 'text-zinc-500')} />
                    <span className="text-sm font-semibold text-zinc-100">Strict Shariah Compliance Mode</span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                    Filters out non-compliant assets (e.g., gambling, lending protocols) and restricts all execution
                    planning to unleveraged Spot Trading.
                  </p>
                </div>
                <Switch checked={shariahMode} onCheckedChange={setShariahMode} />
              </div>

              {shariahMode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-3 border-t border-zinc-800 pt-3"
                >
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                      ✓ Spot Only
                    </span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                      ✓ No Leverage
                    </span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                      ✓ No Shorting
                    </span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                      ✓ Compliant Assets Only
                    </span>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="mt-3 text-[10px] text-zinc-600">
              Setting is saved to your browser and persists across sessions.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
