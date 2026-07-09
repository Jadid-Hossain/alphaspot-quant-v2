// AlphaSpot LLM Reasoning Helper
// Uses z-ai-web-dev-sdk to generate natural-language explanations of the
// engine's decisions and periodic market commentary. Runs entirely in the
// backend (mini-service) — never on the client.

import ZAI from 'z-ai-web-dev-sdk'
import type { SymbolSnapshot, Position, ConfluenceResult } from '../../src/lib/alphaspot/types'

let zaiPromise: Promise<ZAI> | null = null
function getZAI(): Promise<ZAI> {
  if (!zaiPromise) zaiPromise = ZAI.create()
  return zaiPromise
}

interface DecisionContext {
  symbol: string
  action: string
  kind: string
  price: number
  score: number
  position: Position
  confluence: ConfluenceResult
  reasoning: string
}

/**
 * Generate a concise (1-2 sentence) explanation of a trade decision.
 * Falls back to the engine's deterministic reason if the LLM fails.
 */
export async function explainDecision(ctx: DecisionContext): Promise<string> {
  const topFactors = ctx.confluence.factors
    .slice()
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 4)
    .map((f) => `- ${f.label} (${f.score >= 0 ? '+' : ''}${f.score}): ${f.detail}`)
    .join('\n')

  const posLine =
    ctx.position.state === 'FLAT'
      ? 'No active position.'
      : `In ${ctx.position.state} — avg entry $${ctx.position.avgEntryPrice?.toFixed(2)}, size ${ctx.position.quantity.toFixed(6)} (${ctx.position.capitalUsedPct.toFixed(1)}% capital deployed).`

  const prompt = `You are AlphaSpot's trading analyst. Explain in ONE or TWO crisp sentences why the engine just did this:

ACTION: ${ctx.action} (${ctx.kind}) on ${ctx.symbol} @ $${ctx.price.toFixed(2)}
CONFLUENCE SCORE: ${ctx.score}/100
POSITION: ${posLine}

Top confluence factors:
${topFactors}

Engine note: ${ctx.reasoning}

Reply with only the 1-2 sentence analyst-style explanation. Be specific, mention the key signals. No preamble.`

  try {
    const zai = await getZAI()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You are AlphaSpot, an institutional crypto trading analyst. You write concise, specific, professional market commentary.' },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content?.trim()
    return text || ctx.reasoning
  } catch (e) {
    console.error('[llm] explainDecision failed:', e)
    return ctx.reasoning
  }
}

/**
 * Generate a periodic (every few minutes) market commentary + sentiment score.
 * Returns a paragraph of reasoning and a sentiment score from -1 to 1.
 */
export async function marketCommentary(snapshot: SymbolSnapshot): Promise<{ commentary: string; sentiment: number }> {
  const ind15 = snapshot.indicators['15m']
  const ind1h = snapshot.indicators['1h']
  const ind4h = snapshot.indicators['4h']

  const dataLine = JSON.stringify({
    symbol: snapshot.symbol,
    price: snapshot.price,
    change24h: snapshot.change24hPct,
    rsi_15m: ind15.rsi,
    macdHist_1h: ind1h.macdHist,
    ema50_4h: ind4h.ema50,
    ema200_4h: ind4h.ema200,
    bbPercentB_1h: ind1h.bbPercentB,
    patterns: [...snapshot.patterns.bullish, ...snapshot.patterns.bearish].map((p) => p.name),
    fearGreed: snapshot.sentiment.fearGreed,
    fundingRate: snapshot.funding?.fundingRate,
    orderBookImbalance: snapshot.orderBook?.imbalance,
    confluenceScore: snapshot.confluence.score,
  })

  const prompt = `You are AlphaSpot's market analyst. Based on this real-time data snapshot, write a 2-3 sentence market commentary for ${snapshot.symbol}. Be specific about the key signals (RSI, MACD, patterns, funding, order flow). Do NOT include any placeholder text or brackets.

After the commentary, on a new line, write SENTIMENT: followed by a single number between -1.0 and 1.0 representing your bullish/bearish sentiment.

DATA: ${dataLine}

Example response:
RSI on 15m is oversold at 28 while the 1h MACD histogram flips positive, hinting at a short-term bounce. However, the 4h macro trend remains down with EMA50 below EMA200, so any rally likely caps at the 4h EMA50. Order book shows mild bid support but funding is neutral.
SENTIMENT: -0.15

Now write the commentary for the current data:`

  try {
    const zai = await getZAI()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You are AlphaSpot, a sharp crypto market analyst. You write concise, data-driven commentary without any placeholder text.' },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content?.trim() || ''
    const m = text.match(/SENTIMENT:\s*(-?\d+\.?\d*)/i)
    const sentiment = m ? Math.max(-1, Math.min(1, Number(m[1]))) : 0
    const commentary = text.replace(/SENTIMENT:.*$/is, '').replace(/^\[[^\]]*\]\s*/, '').trim()
    return { commentary, sentiment }
  } catch (e) {
    console.error('[llm] marketCommentary failed:', e)
    return { commentary: '', sentiment: 0 }
  }
}
