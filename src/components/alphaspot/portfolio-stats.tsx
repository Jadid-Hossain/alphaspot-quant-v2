'use client'

import { useEffect, useState } from 'react'
import { fmtUsd, fmtPct } from './format'
import { cn } from '@/lib/utils'
import { Trophy, Target, Layers3, TrendingUp } from 'lucide-react'

interface StatusData {
  totalTrades: number
  totalRealizedPnl: number
  winRate: number
  wins: number
  losses: number
  bestTrade: number
  worstTrade: number
  paperTrading: boolean
}

export function PortfolioStats() {
  const [data, setData] = useState<StatusData | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await fetch('/api/status')
        if (!res.ok) return
        const j = (await res.json()) as StatusData
        if (mounted) setData(j)
      } catch {
        /* ignore */
      }
    }
    load()
    const id = setInterval(load, 15000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  const pnl = data?.totalRealizedPnl ?? 0
  const winRate = data?.winRate ?? 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Realized PnL"
        value={fmtUsd(pnl)}
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        accent={pnl > 0 ? 'emerald' : pnl < 0 ? 'rose' : 'zinc'}
        sub="all closed trades"
      />
      <Stat
        label="Win Rate"
        value={data ? `${winRate.toFixed(0)}%` : '—'}
        icon={<Target className="h-3.5 w-3.5" />}
        accent={winRate >= 50 ? 'emerald' : 'amber'}
        sub={data ? `${data.wins}W / ${data.losses}L` : ''}
      />
      <Stat
        label="Total Trades"
        value={data ? `${data.totalTrades}` : '—'}
        icon={<Layers3 className="h-3.5 w-3.5" />}
        accent="zinc"
        sub="paper executions"
      />
      <Stat
        label="Best / Worst"
        value={data ? `${fmtUsd(data.bestTrade, 0)}` : '—'}
        icon={<Trophy className="h-3.5 w-3.5" />}
        accent="emerald"
        sub={data ? `worst ${fmtUsd(data.worstTrade, 0)}` : ''}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  icon,
  accent,
  sub,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent: 'emerald' | 'rose' | 'amber' | 'zinc'
  sub?: string
}) {
  const colorMap = {
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    zinc: 'text-zinc-200',
  }
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn('mt-1 font-mono text-xl font-bold tabular-nums', colorMap[accent])}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  )
}
