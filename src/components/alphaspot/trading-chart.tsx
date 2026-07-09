'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { emaSeries } from '@/lib/alphaspot/indicators'
import type { Candle, Timeframe } from '@/lib/alphaspot/types'
import { cn } from '@/lib/utils'
import { CandlestickChart } from 'lucide-react'

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h']

export function TradingChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const lastCandleTimeRef = useRef<number>(0)
  const [chartTf, setChartTf] = useState<Timeframe>('15m')

  const { selectedSymbol, snapshots } = useAlphaSpot()

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
        fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#52525b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#27272a' },
        horzLine: { color: '#52525b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#27272a' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      autoSize: true,
    })
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceLineColor: '#52525b',
      priceLineStyle: LineStyle.Dotted,
    })
    candleSeriesRef.current = candleSeries

    const ema50 = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ema50SeriesRef.current = ema50

    const ema200 = chart.addSeries(LineSeries, {
      color: '#a78bfa',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ema200SeriesRef.current = ema200

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      ema50SeriesRef.current = null
      ema200SeriesRef.current = null
    }
  }, [])

  // Update data on snapshot / symbol / timeframe change
  useEffect(() => {
    const snap = snapshots[selectedSymbol]
    if (!snap || !candleSeriesRef.current || !ema50SeriesRef.current || !ema200SeriesRef.current) return

    const candles: Candle[] = snap.candles[chartTf]
    if (!candles || candles.length === 0) return

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const closes = candles.map((c) => c.close)
    const ema50Arr = emaSeries(closes, 50)
    const ema200Arr = emaSeries(closes, 200)
    const ema50Data = candles
      .map((c, i) => ({ time: c.time as UTCTimestamp, value: ema50Arr[i] }))
      .filter((d) => d.value != null && Number.isFinite(d.value))
    const ema200Data = candles
      .map((c, i) => ({ time: c.time as UTCTimestamp, value: ema200Arr[i] }))
      .filter((d) => d.value != null && Number.isFinite(d.value))

    const lastTime = candles[candles.length - 1].time
    // Use update() for same last candle (smooth real-time), full setData otherwise
    if (lastTime === lastCandleTimeRef.current && candleData.length > 1) {
      candleSeriesRef.current.update(candleData[candleData.length - 1])
      if (ema50Data.length) ema50SeriesRef.current.update(ema50Data[ema50Data.length - 1])
      if (ema200Data.length) ema200SeriesRef.current.update(ema200Data[ema200Data.length - 1])
    } else {
      candleSeriesRef.current.setData(candleData)
      ema50SeriesRef.current.setData(ema50Data)
      ema200SeriesRef.current.setData(ema200Data)
      lastCandleTimeRef.current = lastTime
    }
  }, [snapshots, selectedSymbol, chartTf])

  // reset last-candle tracker when timeframe changes so the next update does a full setData
  const handleTfChange = (tf: Timeframe) => {
    lastCandleTimeRef.current = 0
    setChartTf(tf)
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <CandlestickChart className="h-3 w-3" />
          <span>{selectedSymbol} Chart</span>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-zinc-950/60 p-0.5 ring-1 ring-zinc-800">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => handleTfChange(tf)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-bold uppercase transition-colors',
                chartTf === tf ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1">
        <div ref={containerRef} className="h-full min-h-[320px] w-full" />
        <div className="pointer-events-none absolute left-3 top-2 flex gap-3 text-[10px] font-medium">
          <span className="flex items-center gap-1 text-amber-400">
            <span className="inline-block h-0.5 w-3 bg-amber-400" /> EMA 50
          </span>
          <span className="flex items-center gap-1 text-violet-400">
            <span className="inline-block h-0.5 w-3 bg-violet-400" /> EMA 200
          </span>
        </div>
      </div>
    </div>
  )
}
