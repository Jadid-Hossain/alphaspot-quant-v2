'use client'

import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { fmtPrice, rsiColor } from './format'
import { cn } from '@/lib/utils'
import type { Indicators, Timeframe } from '@/lib/alphaspot/types'
import { Gauge, Activity, BarChart3, Waves } from 'lucide-react'

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h']

const TF_LABEL: Record<Timeframe, string> = {
  '15m': '15m · Momentum',
  '1h': '1h · Trend',
  '4h': '4h · Macro',
}

export function IndicatorPanels() {
  const { selectedSymbol, snapshots } = useAlphaSpot()
  const snap = snapshots[selectedSymbol]

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        <Gauge className="h-3 w-3" />
        <span>Multi-Timeframe Indicators</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {TIMEFRAMES.map((tf) => (
          <TfColumn key={tf} tf={tf} ind={snap?.indicators[tf]} price={snap?.price ?? null} />
        ))}
      </div>
    </div>
  )
}

function TfColumn({ tf, ind, price }: { tf: Timeframe; ind: Indicators | undefined; price: number | null }) {
  const macroUp = ind?.ema50 != null && ind?.ema200 != null ? ind.ema50 > ind.ema200 : null

  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">{TF_LABEL[tf]}</span>
        {macroUp != null && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
              macroUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400',
            )}
          >
            {macroUp ? 'Uptrend' : 'Downtrend'}
          </span>
        )}
      </div>

      <div className="space-y-2 text-xs">
        <Row label="RSI (14)" icon={<Activity className="h-3 w-3" />}>
          <span className={cn('font-mono font-semibold tabular-nums', rsiColor(ind?.rsi))}>
            {ind?.rsi != null ? ind.rsi.toFixed(1) : '—'}
          </span>
        </Row>

        <Row label="StochRSI K/D" icon={<Waves className="h-3 w-3" />}>
          <span className="font-mono font-semibold tabular-nums text-zinc-200">
            {ind?.stochRsiK != null ? `${ind.stochRsiK.toFixed(1)}/${ind.stochRsiD?.toFixed(1)}` : '—'}
          </span>
        </Row>

        <Row label="MACD Hist" icon={<BarChart3 className="h-3 w-3" />}>
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              ind?.macdHist == null ? 'text-zinc-500' : ind.macdHist >= 0 ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {ind?.macdHist != null ? ind.macdHist.toFixed(3) : '—'}
          </span>
        </Row>

        <Row label="EMA 50/200">
          <span className="font-mono font-medium tabular-nums text-zinc-300">
            {ind?.ema50 != null ? fmtPrice(ind.ema50, ind.ema50 < 10 ? 4 : 0) : '—'}
            <span className="text-zinc-600"> / </span>
            {ind?.ema200 != null ? fmtPrice(ind.ema200, ind.ema200 < 10 ? 4 : 0) : '—'}
          </span>
        </Row>

        <Row label="BB %B">
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              ind?.bbPercentB == null ? 'text-zinc-500' : ind.bbPercentB < 10 ? 'text-emerald-400' : ind.bbPercentB > 90 ? 'text-rose-400' : 'text-zinc-200',
            )}
          >
            {ind?.bbPercentB != null ? `${ind.bbPercentB.toFixed(1)}%` : '—'}
          </span>
        </Row>

        <Row label="OBV">
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              ind?.obvRising == null ? 'text-zinc-500' : ind.obvRising ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {ind?.obvRising == null ? '—' : ind.obvRising ? '↑ Rising' : '↓ Falling'}
          </span>
        </Row>
      </div>
    </div>
  )
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-zinc-500">
        {icon}
        {label}
      </span>
      {children}
    </div>
  )
}
