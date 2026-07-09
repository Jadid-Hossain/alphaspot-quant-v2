import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/signals?symbol=BTC/USDT&limit=50
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)

  const where = symbol ? { symbol } : {}
  const signals = await db.signal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    signals: signals.map((s) => ({
      ...s,
      indicators: JSON.parse(s.indicatorsJson),
      patterns: JSON.parse(s.patternsJson),
      indicatorsJson: undefined,
      patternsJson: undefined,
    })),
  })
}
