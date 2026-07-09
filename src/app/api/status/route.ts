import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/status — aggregated portfolio stats from the trade ledger.
// Live snapshots come via socket.io; this endpoint gives historical summary.
export async function GET() {
  const allTrades = await db.trade.findMany({ orderBy: { createdAt: 'desc' } })

  const sells = allTrades.filter((t) => t.side === 'SELL')
  const buys = allTrades.filter((t) => t.side === 'BUY')
  const wins = sells.filter((t) => (t.realizedPnl ?? 0) > 0)
  const losses = sells.filter((t) => (t.realizedPnl ?? 0) <= 0)
  const totalRealized = sells.reduce((a, b) => a + (b.realizedPnl ?? 0), 0)

  const bySymbol = await Promise.all(
    ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'].map(async (symbol) => {
      const t = await db.trade.findMany({ where: { symbol }, orderBy: { createdAt: 'desc' } })
      const s = t.filter((x) => x.side === 'SELL')
      const realized = s.reduce((a, b) => a + (b.realizedPnl ?? 0), 0)
      const w = s.filter((x) => (x.realizedPnl ?? 0) > 0).length
      return {
        symbol,
        trades: t.length,
        realizedPnl: realized,
        closed: s.length,
        wins: w,
        lastTrade: t[0]?.createdAt ?? null,
      }
    }),
  )

  return NextResponse.json({
    totalTrades: allTrades.length,
    totalBuys: buys.length,
    totalSells: sells.length,
    totalRealizedPnl: totalRealized,
    winRate: sells.length > 0 ? (wins.length / sells.length) * 100 : 0,
    wins: wins.length,
    losses: losses.length,
    bestTrade: sells.length ? Math.max(...sells.map((t) => t.realizedPnl ?? 0)) : 0,
    worstTrade: sells.length ? Math.min(...sells.map((t) => t.realizedPnl ?? 0)) : 0,
    bySymbol,
    lastTradeAt: allTrades[0]?.createdAt ?? null,
    paperTrading: true,
  })
}
