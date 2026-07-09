'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { Lock, Zap, TrendingUp, TrendingDown } from 'lucide-react'

/**
 * Trade Planner Execution Restrictions — shown when Shariah Mode is ON.
 *
 * Displays locked execution parameters:
 *   • Leverage: locked to 1x (no margin)
 *   • Direction: locked to Long / Spot (no shorting)
 *   • Market: Spot Only (no futures/perpetuals)
 */
export function TradePlannerRestrictions() {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)

  if (!shariahMode) return null

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Lock className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
          Execution Restrictions Active
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <RestrictedField icon={<Zap className="h-3 w-3" />} label="Leverage" value="1x" />
        <RestrictedField icon={<TrendingUp className="h-3 w-3" />} label="Direction" value="Long" />
        <RestrictedField icon={<Lock className="h-3 w-3" />} label="Market" value="Spot" />
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">
        Shariah Compliance Mode locks all execution to unleveraged spot trading. Margin, leverage, and
        short-selling are programmatically disabled.
      </p>
    </div>
  )
}

function RestrictedField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md bg-zinc-900/60 p-2 ring-1 ring-zinc-800">
      <span className="text-zinc-500">{icon}</span>
      <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      <span className="text-xs font-bold text-emerald-400">{value}</span>
    </div>
  )
}

/**
 * Leverage input wrapper — disables + locks to 1x when Shariah mode is on.
 * Wrap any leverage input control with this.
 */
export function LeverageLockWrapper({ children }: { children: React.ReactNode }) {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)

  if (!shariahMode) return <>{children}</>

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-md bg-zinc-950/60">
        <Lock className="h-3 w-3 text-emerald-400" />
        <span className="text-[10px] font-bold text-emerald-400">1x (Locked)</span>
      </div>
    </div>
  )
}

/**
 * Direction toggle wrapper — disables shorting when Shariah mode is on.
 * Only Long/Spot is allowed.
 */
export function DirectionLockWrapper({ children }: { children: React.ReactNode }) {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)

  if (!shariahMode) return <>{children}</>

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-md bg-zinc-950/60">
        <TrendingUp className="h-3 w-3 text-emerald-400" />
        <span className="text-[10px] font-bold text-emerald-400">Long / Spot Only</span>
      </div>
    </div>
  )
}
