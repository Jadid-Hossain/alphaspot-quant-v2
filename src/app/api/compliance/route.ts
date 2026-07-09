import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { classifySymbol, getAllClassifications, getClassificationStats } from '@/lib/alphaspot/compliance-registry'

// GET /api/compliance          — get all compliance records (or seed if empty)
// GET /api/compliance?symbol=X  — get compliance for a specific symbol
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')

  // Ensure the DB is seeded with classifications
  await seedComplianceIfNeeded()

  if (symbol) {
    const record = await db.assetCompliance.findUnique({ where: { symbol } })
    if (!record) {
      // Fall back to the static classification
      const cls = classifySymbol(symbol)
      return NextResponse.json({
        symbol,
        base: symbol.split('/')[0],
        isShariahCompliant: cls.category === 'COMPLIANT',
        complianceReason: cls.reason,
        complianceCategory: cls.category,
        source: 'static-fallback',
      })
    }
    return NextResponse.json(record)
  }

  // Return all records
  const records = await db.assetCompliance.findMany({
    orderBy: [{ isShariahCompliant: 'desc' }, { base: 'asc' }],
  })
  const stats = getClassificationStats()
  return NextResponse.json({
    records,
    stats: {
      ...stats,
      dbRecords: records.length,
      compliantInDb: records.filter((r) => r.isShariahCompliant).length,
      haramInDb: records.filter((r) => !r.isShariahCompliant && r.complianceCategory === 'HARAM').length,
      pendingInDb: records.filter((r) => r.complianceCategory === 'PENDING').length,
    },
  })
}

// POST /api/compliance — manually set/update a compliance record
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || !body.symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }
  const { symbol, isShariahCompliant, complianceReason, complianceCategory } = body
  const base = symbol.split('/')[0]
  const record = await db.assetCompliance.upsert({
    where: { symbol },
    create: {
      symbol,
      base,
      isShariahCompliant: isShariahCompliant ?? false,
      complianceReason: complianceReason ?? 'Manual classification',
      complianceCategory: complianceCategory ?? (isShariahCompliant ? 'COMPLIANT' : 'HARAM'),
    },
    update: {
      isShariahCompliant,
      complianceReason,
      complianceCategory,
    },
  })
  return NextResponse.json(record)
}

/** Seed the AssetCompliance table from the static registry if it's empty. */
async function seedComplianceIfNeeded(): Promise<void> {
  const count = await db.assetCompliance.count()
  if (count > 0) return

  const classifications = getAllClassifications()
  await db.assetCompliance.createMany({
    data: classifications.map((c) => ({
      symbol: `${c.base}/USDT`,
      base: c.base,
      isShariahCompliant: c.category === 'COMPLIANT',
      complianceReason: c.reason,
      complianceCategory: c.category,
    })),
  })
}
