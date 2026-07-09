'use client'

import { useEffect } from 'react'
import { useAlphaSpot } from '@/hooks/use-alpha-spot'
import { Header } from '@/components/alphaspot/header'
import { TickerStrip } from '@/components/alphaspot/ticker-strip'
import { PortfolioStats } from '@/components/alphaspot/portfolio-stats'
import { SignalBox } from '@/components/alphaspot/signal-box'
import { PositionCard } from '@/components/alphaspot/position-card'
import { ConfluenceFactors } from '@/components/alphaspot/confluence-factors'
import { TradingChart } from '@/components/alphaspot/trading-chart'
import { IndicatorPanels } from '@/components/alphaspot/indicator-panels'
import { ReasoningLog } from '@/components/alphaspot/reasoning-log'
import { TradeHistory } from '@/components/alphaspot/trade-history'
import { Footer } from '@/components/alphaspot/footer'
import { BootSplash } from '@/components/alphaspot/boot-splash'
import { Watchlist } from '@/components/alphaspot/watchlist'

export default function Home() {
  const { connect, connected, snapshots, engine, loadHistory } = useAlphaSpot()

  useEffect(() => {
    connect()
    loadHistory()
  }, [connect, loadHistory])

  const anySnapshot = Object.values(snapshots).some((s) => s !== null)

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <Header />
      <div className="flex flex-1">
        {/* Persistent watchlist sidebar on desktop */}
        <aside className="hidden w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 lg:block">
          <div className="sticky top-[53px] flex h-[calc(100vh-53px)] flex-col">
            <Watchlist />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-5 sm:px-6">
            {/* Top: live tickers */}
            <TickerStrip />

            {/* Historical portfolio summary */}
            <PortfolioStats />

            {/* Loading splash while first snapshot arrives */}
            {!anySnapshot && connected && <BootSplash />}

            {/* Main grid: chart+indicators (left, 2/3) | signal+position+factors (right, 1/3) */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <div className="h-[420px]">
                  <TradingChart />
                </div>
                <IndicatorPanels />
              </div>
              <div className="space-y-4">
                <SignalBox />
                <PositionCard />
                <ConfluenceFactors />
              </div>
            </div>

            {/* Bottom: reasoning log + trade feed */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReasoningLog />
              <TradeHistory />
            </div>
          </div>
        </main>
      </div>
      <Footer />
    </div>
  )
}
