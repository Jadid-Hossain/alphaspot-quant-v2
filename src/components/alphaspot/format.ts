// Formatting helpers for the AlphaSpot dashboard

export function fmtPrice(p: number | null | undefined, digits = 2): string {
  if (p == null || Number.isNaN(p)) return '—'
  return p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function fmtQty(v: number | null | undefined, digits = 6): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)
}

export function fmtTime(iso: string | number | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso)
  return d.toLocaleTimeString('en-US', { hour12: false })
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso)
  return d.toLocaleString('en-US', { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const SIGNAL_META: Record<string, { label: string; emoji: string; color: string; bg: string; ring: string; glow: string }> = {
  STRONG_BUY: { label: 'STRONG BUY', emoji: '🟢', color: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/40', glow: 'glow-emerald' },
  BUY: { label: 'BUY', emoji: '🟢', color: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', glow: '' },
  HOLD: { label: 'HOLD', emoji: '⚪', color: 'text-zinc-400', bg: 'bg-zinc-500/10', ring: 'ring-zinc-500/30', glow: '' },
  SELL: { label: 'SELL', emoji: '🔴', color: 'text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/30', glow: '' },
  STRONG_SELL: { label: 'STRONG SELL', emoji: '🔴', color: 'text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/40', glow: 'glow-rose' },
  RECOVERY_BUY: { label: 'RECOVERY BUY', emoji: '🟡', color: 'text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/40', glow: 'glow-amber' },
  TAKE_PROFIT: { label: 'TAKE PROFIT', emoji: '🟢', color: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/40', glow: 'glow-emerald' },
  EMERGENCY_EXIT: { label: 'EMERGENCY EXIT', emoji: '🔴', color: 'text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/50', glow: 'glow-rose' },
}

export const STATE_META: Record<string, { label: string; color: string; bg: string }> = {
  FLAT: { label: 'FLAT', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
  IN_TRADE: { label: 'IN TRADE', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  RECOVERY_MODE: { label: 'RECOVERY MODE', color: 'text-amber-400', bg: 'bg-amber-500/10' },
}

export function fearGreedColor(v: number | null | undefined): string {
  if (v == null) return 'text-zinc-400'
  if (v < 25) return 'text-rose-400'
  if (v < 45) return 'text-orange-400'
  if (v < 55) return 'text-zinc-400'
  if (v < 75) return 'text-lime-400'
  return 'text-emerald-400'
}

export function rsiColor(v: number | null | undefined): string {
  if (v == null) return 'text-zinc-400'
  if (v < 30) return 'text-emerald-400'
  if (v > 70) return 'text-rose-400'
  return 'text-zinc-200'
}
