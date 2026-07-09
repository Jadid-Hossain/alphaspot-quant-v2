// AlphaSpot Confluence Scorer
// Combines multi-timeframe indicators, candlestick patterns, order flow,
// funding rates, and sentiment into a single -100..+100 conviction score.

import type {
  MultiTimeframeIndicators,
  Patterns,
  SentimentData,
  OrderBookImbalance,
  FundingData,
  ConfluenceFactor,
  ConfluenceResult,
  SignalLabel,
} from './types'
import { isMacroUp } from './indicators'

const clamp = (v: number, min = -100, max = 100) => Math.max(min, Math.min(max, v))

export interface ConfluenceInput {
  indicators: MultiTimeframeIndicators
  patterns: Patterns
  sentiment: SentimentData
  orderBook: OrderBookImbalance | null
  funding: FundingData | null
  price: number
}

/**
 * Calculate the confluence score. Each factor contributes a weighted delta.
 * The blueprint example: Bullish Engulfing (+25) + 15m RSI Oversold (+20) +
 * Daily Uptrend (+20) + Whales withdrawing (+15) = 80 (STRONG BUY).
 */
export function calculateConfluenceScore(input: ConfluenceInput): ConfluenceResult {
  const { indicators, patterns, sentiment, orderBook, funding, price } = input
  const factors: ConfluenceFactor[] = []
  let score = 0

  const add = (key: string, label: string, s: number, detail: string) => {
    factors.push({ key, label, score: s, detail })
    score += s
  }

  const ind15 = indicators['15m']
  const ind1h = indicators['1h']
  const ind4h = indicators['4h']

  // ---------- Candlestick patterns (15m) ----------
  if (patterns.bullish.length > 0) {
    const p = patterns.bullish[0]
    const s = Math.round((p.strength / 100) * 30) // up to +30
    add('pattern_bull', `Bullish Pattern: ${p.name}`, s, `${p.name} detected on 15m (strength ${p.strength}/100). Reversal probability elevated.`)
  }
  if (patterns.bearish.length > 0) {
    const p = patterns.bearish[0]
    const s = -Math.round((p.strength / 100) * 30)
    add('pattern_bear', `Bearish Pattern: ${p.name}`, s, `${p.name} detected on 15m (strength ${p.strength}/100). Downside risk elevated.`)
  }
  if (patterns.neutral.length > 0 && patterns.bullish.length === 0 && patterns.bearish.length === 0) {
    add('pattern_neutral', 'Doji / Indecision', 0, `Indecision candle — market awaiting direction.`)
  }

  // ---------- 15m RSI / StochRSI (short-term momentum) ----------
  if (ind15.rsi != null) {
    if (ind15.rsi < 30) {
      add('rsi_oversold', '15m RSI Oversold', 20, `RSI ${ind15.rsi.toFixed(1)} < 30 — short-term oversold bounce setup.`)
    } else if (ind15.rsi > 70) {
      add('rsi_overbought', '15m RSI Overbought', -20, `RSI ${ind15.rsi.toFixed(1)} > 70 — short-term overbought, pullback risk.`)
    }
  }
  if (ind15.stochRsiK != null && ind15.stochRsiD != null) {
    if (ind15.stochRsiK < 20 && ind15.stochRsiK > ind15.stochRsiD) {
      add('stochrsi_cross', 'StochRSI Bull Cross', 10, `StochRSI K(${ind15.stochRsiK.toFixed(1)}) crossing above D from oversold.`)
    } else if (ind15.stochRsiK > 80 && ind15.stochRsiK < ind15.stochRsiD) {
      add('stochrsi_bear', 'StochRSI Bear Cross', -10, `StochRSI K(${ind15.stochRsiK.toFixed(1)}) crossing below D from overbought.`)
    }
  }

  // ---------- 1h MACD (medium-term momentum) ----------
  if (ind1h.macdHist != null) {
    if (ind1h.macdHist > 0) {
      add('macd_bull', '1h MACD Bullish', 20, `MACD histogram positive (${ind1h.macdHist.toFixed(2)}) — medium-term momentum up.`)
    } else {
      add('macd_bear', '1h MACD Bearish', -20, `MACD histogram negative (${ind1h.macdHist.toFixed(2)}) — medium-term momentum down.`)
    }
  }

  // ---------- 1h Bollinger Bands (volatility / mean reversion) ----------
  if (ind1h.bbPercentB != null) {
    if (ind1h.bbPercentB < 10) {
      add('bb_oversold', '1h BB Lower Band', 10, `Price tagging lower Bollinger Band (%B ${ind1h.bbPercentB.toFixed(1)}) — mean-reversion bounce likely.`)
    } else if (ind1h.bbPercentB > 90) {
      add('bb_overbought', '1h BB Upper Band', -10, `Price tagging upper Bollinger Band (%B ${ind1h.bbPercentB.toFixed(1)}) — extension risk.`)
    }
  }

  // ---------- 4h Macro trend filter (NEVER fight the daily trend) ----------
  const macroUp = isMacroUp(ind4h)
  if (macroUp === true) {
    add('macro_up', '4h Macro Uptrend', 20, `4h EMA50 > EMA200 — macro trend is UP. Long bias favored.`)
  } else if (macroUp === false) {
    add('macro_down', '4h Macro Downtrend', -20, `4h EMA50 < EMA200 — macro trend is DOWN. Short bias favored.`)
  }

  // ---------- 4h EMA50 support proximity ----------
  if (ind4h.ema50 != null && ind4h.atr != null) {
    const dist = (price - ind4h.ema50) / ind4h.ema50
    if (dist > -0.01 && dist < 0.02) {
      add('ema50_support', '4h EMA50 Support', 10, `Price testing 4h EMA50 support (${ind4h.ema50.toFixed(2)}) — classic bounce zone.`)
    }
  }

  // ---------- OBV volume confirmation ----------
  if (ind15.obvRising === true) {
    add('obv_rising', 'OBV Rising', 10, `On-Balance Volume rising — accumulation confirmed by volume.`)
  } else if (ind15.obvRising === false) {
    add('obv_falling', 'OBV Falling', -10, `On-Balance Volume falling — distribution pressure.`)
  }

  // ---------- Order book imbalance (liquidity) ----------
  if (orderBook && (orderBook.bidVolume + orderBook.askVolume) > 0) {
    if (orderBook.imbalance > 0.15) {
      add('book_bull', 'Bid Wall Dominance', 10, `Order book bid-heavy (imbalance ${orderBook.imbalance.toFixed(2)}) — buyers stacked.`)
    } else if (orderBook.imbalance < -0.15) {
      add('book_bear', 'Ask Wall Dominance', -10, `Order book ask-heavy (imbalance ${orderBook.imbalance.toFixed(2)}) — sellers stacked.`)
    }
  }

  // ---------- Funding rate (leverage trap / contrarian) ----------
  if (funding && funding.fundingRate != null) {
    // Negative funding = shorts paying longs = contrarian bullish
    if (funding.fundingRate < -0.0001) {
      add('funding_bull', 'Negative Funding', 10, `Funding ${funding.fundingRate.toFixed(5)} — shorts paying longs. Contrarian bullish.`)
    } else if (funding.fundingRate > 0.0001) {
      add('funding_bear', 'Positive Funding', -10, `Funding ${funding.fundingRate.toFixed(5)} — longs paying shorts. Contrarian bearish / squeeze risk.`)
    }
  }

  // ---------- Sentiment (Fear & Greed + news) ----------
  if (sentiment.fearGreed != null) {
    if (sentiment.fearGreed < 25) {
      add('fg_fear', 'Extreme Fear', 10, `Fear & Greed ${sentiment.fearGreed} (Extreme Fear) — contrarian buy zone.`)
    } else if (sentiment.fearGreed > 75) {
      add('fg_greed', 'Extreme Greed', -10, `Fear & Greed ${sentiment.fearGreed} (Extreme Greed) — contrarian sell zone.`)
    }
  }
  if (sentiment.newsScore != null) {
    if (sentiment.newsScore > 0.2) {
      add('news_bull', 'Positive News Flow', 10, `News sentiment +${sentiment.newsScore.toFixed(2)} — bullish headlines.`)
    } else if (sentiment.newsScore < -0.2) {
      add('news_bear', 'Negative News Flow', -10, `News sentiment ${sentiment.newsScore.toFixed(2)} — bearish headlines.`)
    }
  }

  score = clamp(Math.round(score))

  return {
    score,
    label: scoreToLabel(score),
    factors,
  }
}

export function scoreToLabel(score: number): SignalLabel {
  if (score >= 75) return 'STRONG_BUY'
  if (score >= 40) return 'BUY'
  if (score <= -75) return 'STRONG_SELL'
  if (score <= -40) return 'SELL'
  return 'HOLD'
}
