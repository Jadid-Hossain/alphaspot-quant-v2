import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/trades?symbol=BTC/USDT&limit=50
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)

  const where = symbol ? { symbol } : {}
  const trades = await db.trade.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const stats = await db.trade.aggregate({
    _count: true,
    _sum: { realizedPnl: true, quoteValue: true },
  })

  const closed = await db.trade.findMany({
    where: { side: 'SELL' },
    select: { realizedPnl: true },
  })
  const wins = closed.filter((t) => (t.realizedPnl ?? 0) > 0).length
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0

  return NextResponse.json({
    trades,
    stats: {
      total: stats._count,
      totalRealizedPnl: stats._sum.realizedPnl ?? 0,
      totalVolume: stats._sum.quoteValue ?? 0,
      closedCount: closed.length,
      winRate,
    },
  })
}
