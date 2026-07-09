import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/logs?symbol=BTC/USDT&limit=100
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')
  const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 500)

  const where = symbol ? { symbol } : {}
  const logs = await db.reasoningLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({ logs })
}
