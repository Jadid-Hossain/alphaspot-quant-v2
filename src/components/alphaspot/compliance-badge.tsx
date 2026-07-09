'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { cn } from '@/lib/utils'
import { ShieldCheck, ShieldAlert, ShieldX, Lock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ComplianceInfo } from '@/hooks/use-alpha-spot'

/**
 * Structural Profile badge — shows Shariah compliance status for an asset.
 *
 * - ShariahMode ON + compliant  → green badge "🟢 Shariah Compliant"
 * - ShariahMode ON + non-compliant → red badge "🔴 Haram / Non-Compliant"
 * - ShariahMode OFF → no badge (or subtle indicator)
 *
 * When non-compliant in Shariah mode, the `locked` prop is true so the
 * parent can render AI Trade Planner sections as LOCKED.
 */
export function ComplianceBadge({ symbol }: { symbol: string }) {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)
  const compliance = useAlphaSpot((s) => s.complianceMap[symbol])

  // Don't render if Shariah mode is off
  if (!shariahMode) return null

  return (
    <AnimatePresence mode="wait">
      {compliance ? (
        <ComplianceBadgeContent key={symbol} compliance={compliance} />
      ) : (
        <motion.div
          key="pending"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800/60 px-2 py-1 text-[10px] font-medium text-zinc-500 ring-1 ring-zinc-700/50"
        >
          <ShieldAlert className="h-3 w-3" />
          Pending Review
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ComplianceBadgeContent({ compliance }: { compliance: ComplianceInfo }) {
  const isCompliant = compliance.isShariahCompliant

  if (isCompliant) {
    return (
      <motion.div
        key="compliant"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold ring-1',
          'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
        )}
        title={compliance.complianceReason}
      >
        <ShieldCheck className="h-3 w-3" />
        🟢 Shariah Compliant
      </motion.div>
    )
  }

  return (
    <motion.div
      key="haram"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold ring-1',
        'bg-rose-500/15 text-rose-400 ring-rose-500/30',
      )}
      title={compliance.complianceReason}
    >
      <ShieldX className="h-3 w-3" />
      🔴 Haram / Non-Compliant
    </motion.div>
  )
}

/**
 * Returns the compliance reason text for display.
 */
export function ComplianceReason({ symbol }: { symbol: string }) {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)
  const compliance = useAlphaSpot((s) => s.complianceMap[symbol])

  if (!shariahMode || !compliance) return null

  return (
    <p
      className={cn(
        'text-[11px] leading-relaxed',
        compliance.isShariahCompliant ? 'text-emerald-400/70' : 'text-rose-400/70',
      )}
    >
      {compliance.complianceReason}
    </p>
  )
}

/**
 * LOCKED overlay — shown over AI Trade Planner sections when the asset
 * is non-compliant in Shariah mode. Renders the section as LOCKED / --.
 */
export function ComplianceLockOverlay({ symbol, children }: { symbol: string; children: React.ReactNode }) {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)
  const compliance = useAlphaSpot((s) => s.complianceMap[symbol])

  const isLocked = shariahMode && compliance && !compliance.isShariahCompliant

  if (!isLocked) return <>{children}</>

  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-30 blur-[1px]">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-zinc-950/80">
        <Lock className="h-5 w-5 text-rose-400" />
        <span className="text-xs font-bold text-rose-400">LOCKED</span>
        <span className="text-[10px] text-zinc-500">Non-compliant asset</span>
      </div>
    </div>
  )
}

/**
 * Hook: check if an asset is locked (non-compliant in Shariah mode).
 */
export function useIsLocked(symbol: string): boolean {
  const shariahMode = useAlphaSpot((s) => s.shariahMode)
  const compliance = useAlphaSpot((s) => s.complianceMap[symbol])
  return shariahMode && compliance !== null && !compliance.isShariahCompliant
}
