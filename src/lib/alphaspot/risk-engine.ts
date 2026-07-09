// AlphaSpot Dynamic Risk & "No-Net-Loss" Recovery Engine
// State machine: FLAT -> IN_TRADE -> RECOVERY_MODE
// Implements Smart DCA (Dynamic AI Position Sizing) and a macro hard stop.
// This is a PAPER TRADING simulation engine — no real orders are placed.

import type {
  Position,
  TradeState,
  ConfluenceResult,
  MultiTimeframeIndicators,
  SignalLabel,
  TradeKind,
  TradeSide,
  Symbol,
} from './types'
import { isMacroUp, macroBreakdown, type Indicators } from './indicators'

export interface RiskConfig {
  allocatedCapital: number
  initialPct: number       // 0.20
  recoveryPct: number      // 0.30
  dropThresholdPct: number // 2.0
  takeProfitPct: number    // 1.0
  strongBuyScore: number   // 75
  strongSellScore: number  // -75
  maxRecoveries: number    // 2
}

export interface RiskContext {
  symbol: Symbol
  price: number
  score: number
  confluence: ConfluenceResult
  indicators: MultiTimeframeIndicators
  prev4hIndicators: Indicators | null
}

export interface RiskDecision {
  action: 'BUY' | 'SELL' | 'HOLD'
  kind: TradeKind | null
  side: TradeSide | null
  quantity: number       // base asset qty to trade
  quoteValue: number     // USDT notional
  reason: string
  newState: TradeState
  label: SignalLabel     // label to surface in UI
  realizedPnl: number | null
  realizedPnlPct: number | null
}

export function emptyPosition(symbol: Symbol): Position {
  return {
    state: 'FLAT',
    symbol,
    avgEntryPrice: null,
    quantity: 0,
    quoteValue: 0,
    capitalUsedPct: 0,
    initialEntryPrice: null,
    recoveryEntryPrice: null,
    trades: 0,
    openedAt: null,
    lastPrice: null,
    unrealizedPnl: null,
    unrealizedPnlPct: null,
  }
}

/**
 * Core decision function. Given the current position + market context,
 * returns the action the engine wants to take (or HOLD).
 */
export function evaluateRisk(
  pos: Position,
  ctx: RiskContext,
  cfg: RiskConfig,
): RiskDecision {
  const { price, score, indicators, prev4hIndicators } = ctx
  const macroUp = isMacroUp(indicators['4h'])

  // ---------- EMERGENCY EXIT (Macro Break — always highest priority) ----------
  if (pos.state !== 'FLAT' && macroBreakdown(prev4hIndicators, indicators['4h'])) {
    const { realizedPnl, realizedPnlPct } = simulateSell(pos, price)
    return {
      action: 'SELL',
      kind: 'EMERGENCY_EXIT',
      side: 'SELL',
      quantity: pos.quantity,
      quoteValue: pos.quantity * price,
      reason: `EMERGENCY EXIT: 4h EMA50 crossed BELOW EMA200 (macro trend broken). Liquidating entire position to prevent catastrophic drawdown. Realized PnL ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)} USDT (${realizedPnlPct.toFixed(2)}%).`,
      newState: 'FLAT',
      label: 'EMERGENCY_EXIT',
      realizedPnl,
      realizedPnlPct,
    }
  }

  // ---------- TAKE PROFIT ----------
  if (pos.state !== 'FLAT' && pos.avgEntryPrice != null) {
    const tpPrice = pos.avgEntryPrice * (1 + cfg.takeProfitPct / 100)
    if (price >= tpPrice) {
      const { realizedPnl, realizedPnlPct } = simulateSell(pos, price)
      return {
        action: 'SELL',
        kind: 'TAKE_PROFIT',
        side: 'SELL',
        quantity: pos.quantity,
        quoteValue: pos.quantity * price,
        reason: `TAKE PROFIT: price ${price} reached avg-entry ${(cfg.takeProfitPct).toFixed(2)}% profit target (${tpPrice.toFixed(2)}). Smart-DCA lowered average entry enough that a small bounce locks a net profit. Realized PnL +${realizedPnl.toFixed(2)} USDT (+${realizedPnlPct.toFixed(2)}%).`,
        newState: 'FLAT',
        label: 'TAKE_PROFIT',
        realizedPnl,
        realizedPnlPct,
      }
    }
  }

  // ---------- RECOVERY BUY (Smart DCA) ----------
  if (pos.state === 'IN_TRADE' && pos.avgEntryPrice != null) {
    const dropPct = ((pos.avgEntryPrice - price) / pos.avgEntryPrice) * 100
    const canRecover =
      dropPct >= cfg.dropThresholdPct &&
      (macroUp === true || score >= 85) && // don't DCA into a crashing market
      score >= 50 &&
      pos.trades < cfg.maxRecoveries + 1 && // initial + N recoveries
      pos.capitalUsedPct < 90
    if (canRecover) {
      const recoveryCapital = Math.min(
        cfg.recoveryPct * cfg.allocatedCapital,
        cfg.allocatedCapital - pos.quoteValue, // don't exceed allocated
      )
      if (recoveryCapital > 1) {
        const qty = recoveryCapital / price
        return {
          action: 'BUY',
          kind: 'RECOVERY',
          side: 'BUY',
          quantity: qty,
          quoteValue: recoveryCapital,
          reason: `RECOVERY BUY: price dropped ${dropPct.toFixed(2)}% below avg entry. 4h macro trend still ${macroUp ? 'UP' : 'mixed'} and confluence still ${score}/100. Deploying ${(cfg.recoveryPct * 100).toFixed(0)}% more capital to lower average entry — a tiny bounce will flip the position to net profit.`,
          newState: 'RECOVERY_MODE',
          label: 'RECOVERY_BUY',
          realizedPnl: null,
          realizedPnlPct: null,
        }
      }
    }
  }

  // ---------- INITIAL ENTRY ----------
  if (pos.state === 'FLAT') {
    const qualifies = score >= cfg.strongBuyScore && (macroUp === true || score >= 85)
    if (qualifies) {
      const initialCapital = cfg.initialPct * cfg.allocatedCapital
      const qty = initialCapital / price
      return {
        action: 'BUY',
        kind: 'INITIAL',
        side: 'BUY',
        quantity: qty,
        quoteValue: initialCapital,
        reason: `STRONG BUY: confluence score ${score}/100 (>= ${cfg.strongBuyScore}). 4h macro ${macroUp === true ? 'UPTREND' : macroUp === false ? 'DOWNTREND (overridden by extreme score)' : 'neutral'}. Opening initial position with ${(cfg.initialPct * 100).toFixed(0)}% of allocated capital. Recovery grid armed.`,
        newState: 'IN_TRADE',
        label: 'STRONG_BUY',
        realizedPnl: null,
        realizedPnlPct: null,
      }
    }
  }

  // ---------- HOLD ----------
  let holdReason = 'No actionable signal — holding flat.'
  let holdLabel: SignalLabel = ctx.confluence.label
  if (pos.state !== 'FLAT' && pos.avgEntryPrice != null) {
    const dropPct = ((pos.avgEntryPrice - price) / pos.avgEntryPrice) * 100
    const upnlPct = ((price - pos.avgEntryPrice) / pos.avgEntryPrice) * 100
    if (dropPct > 0) {
      holdReason = `Holding through drawdown (-${dropPct.toFixed(2)}%). Awaiting either a ${cfg.dropThresholdPct}% drop (recovery trigger) or +${cfg.takeProfitPct}% bounce (take profit). Macro trend ${macroUp === true ? 'intact UP' : macroUp === false ? 'DOWN — watch for emergency exit' : 'neutral'}.`
    } else {
      holdReason = `In position (+${upnlPct.toFixed(2)}% unrealized). Awaiting +${cfg.takeProfitPct}% take-profit target.`
    }
    holdLabel = pos.state === 'RECOVERY_MODE' ? 'RECOVERY_BUY' : 'BUY'
  } else {
    holdReason =
      score >= 40
        ? `Bullish bias (${score}/100) but below STRONG BUY threshold (${cfg.strongBuyScore}). Waiting for stronger confluence.`
        : score <= -40
        ? `Bearish bias (${score}/100). Standing aside — never short against a Strong-Buy-only strategy.`
        : `Neutral zone (${score}/100). No high-conviction setup detected.`
  }

  return {
    action: 'HOLD',
    kind: null,
    side: null,
    quantity: 0,
    quoteValue: 0,
    reason: holdReason,
    newState: pos.state,
    label: holdLabel,
    realizedPnl: null,
    realizedPnlPct: null,
  }
}

/** Apply a BUY decision to the position (returns an updated copy) */
export function applyBuy(
  pos: Position,
  price: number,
  qty: number,
  quoteValue: number,
  newState: TradeState,
  kind: TradeKind,
  allocatedCapital: number,
): Position {
  const newQty = pos.quantity + qty
  const newQuote = pos.quoteValue + quoteValue
  const newAvg = newQty > 0 ? newQuote / newQty : price
  const now = Date.now()
  return {
    ...pos,
    state: newState,
    quantity: newQty,
    quoteValue: newQuote,
    avgEntryPrice: newAvg,
    capitalUsedPct: allocatedCapital > 0 ? (newQuote / allocatedCapital) * 100 : 0,
    initialEntryPrice: kind === 'INITIAL' ? price : pos.initialEntryPrice,
    recoveryEntryPrice: kind === 'RECOVERY' ? price : pos.recoveryEntryPrice,
    trades: pos.trades + 1,
    openedAt: pos.openedAt ?? now,
    lastPrice: price,
  }
}

/** Compute realized PnL for selling the whole position at `price` */
export function simulateSell(pos: Position, price: number): { realizedPnl: number; realizedPnlPct: number } {
  const proceeds = pos.quantity * price
  const cost = pos.quoteValue
  const realizedPnl = proceeds - cost
  const realizedPnlPct = cost > 0 ? (realizedPnl / cost) * 100 : 0
  return { realizedPnl, realizedPnlPct }
}

/** Apply a SELL decision — returns a fresh FLAT position */
export function applySell(pos: Position, _price: number): Position {
  return {
    ...emptyPosition(pos.symbol),
    lastPrice: _price,
  }
}

/** Update unrealized PnL on the position given the latest price */
export function markToMarket(pos: Position, price: number, allocatedCapital: number): Position {
  if (pos.state === 'FLAT' || pos.avgEntryPrice == null || pos.quantity <= 0) {
    return { ...pos, lastPrice: price, unrealizedPnl: null, unrealizedPnlPct: null, capitalUsedPct: pos.quoteValue / allocatedCapital * 100 }
  }
  const unrealizedPnl = pos.quantity * (price - pos.avgEntryPrice)
  const unrealizedPnlPct = ((price - pos.avgEntryPrice) / pos.avgEntryPrice) * 100
  return {
    ...pos,
    lastPrice: price,
    unrealizedPnl,
    unrealizedPnlPct,
    capitalUsedPct: (pos.quoteValue / allocatedCapital) * 100,
  }
}
