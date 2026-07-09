'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { SIGNAL_META, STATE_META, fmtPrice } from './format'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

export function SignalBox() {
  const { selectedSymbol, snapshots } = useAlphaSpot()
  const snap = snapshots[selectedSymbol]
  const label = snap?.confluence.label ?? 'HOLD'
  const score = snap?.confluence.score ?? 0
  const state = snap?.position.state ?? 'FLAT'
  const meta = SIGNAL_META[label] ?? SIGNAL_META.HOLD
  const stateMeta = STATE_META[state] ?? STATE_META.FLAT

  // Score meter: -100..+100 mapped to 0..100% position
  const meterPct = ((score + 100) / 200) * 100

  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-zinc-900/60 p-5 ring-1 transition-all', meta.ring, meta.bg)}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            <Sparkles className="h-3 w-3" />
            <span>AI Signal — {selectedSymbol}</span>
          </div>
          <motion.div
            key={label}
            initial={{ scale: 0.96, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={cn('mt-2 flex items-center gap-2 text-3xl font-extrabold tracking-tight', meta.color)}
          >
            <span className="text-2xl">{meta.emoji}</span>
            <span>{meta.label}</span>
          </motion.div>
        </div>
        <div className={cn('rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider', stateMeta.bg, stateMeta.color)}>
          {stateMeta.label}
        </div>
      </div>

      {/* Score meter */}
      <div className="mt-5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
          <span>Confluence Score</span>
          <span className={cn('font-mono text-lg font-bold tabular-nums', meta.color)}>
            {score > 0 ? '+' : ''}
            {score}
            <span className="text-xs font-normal text-zinc-600">/100</span>
          </span>
        </div>
        <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-rose-500/30 via-zinc-700/40 to-emerald-500/30">
          <motion.div
            className="absolute top-0 h-full w-1 rounded-full bg-zinc-100 shadow-lg"
            style={{ left: `${meterPct}%`, transform: 'translateX(-50%)' }}
            animate={{ left: `${meterPct}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-medium text-zinc-600">
          <span>Strong Sell</span>
          <span>Hold</span>
          <span>Strong Buy</span>
        </div>
      </div>

      {/* Price ref */}
      <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs">
        <span className="text-zinc-500">Last Price</span>
        <span className="font-mono font-semibold tabular-nums text-zinc-200">
          ${fmtPrice(snap?.price, snap && snap.price < 10 ? 4 : 2)}
        </span>
      </div>
    </div>
  )
}
