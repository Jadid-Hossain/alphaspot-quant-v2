// CHAPTER 2.2 §15 — Event Catalog
// CHAPTER 2.2 §7, §9 — Event Contracts & Versioning
//
// The standard platform event catalog. Each event has a typed payload
// contract and a version. Consumers explicitly declare supported versions
// (Chapter 2.2 §9). Breaking changes require a new event version.
//
// This catalog may expand over time (Chapter 2.2 §15).

import type { EventPriority } from './transport'

// ─────────────────────────────────────────────────────────────────────────────
// Event type constants  (Chapter 2.2 §15)
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = {
  // Real-time market (CRITICAL/HIGH)
  MARKET_UPDATED: 'MarketUpdated',
  CANDLES_UPDATED: 'CandlesUpdated',

  // Analytical (MEDIUM)
  FEATURE_GENERATED: 'FeatureGenerated',
  MARKET_REGIME_UPDATED: 'MarketRegimeUpdated',
  PREDICTION_COMPLETED: 'PredictionCompleted',

  // Candidate lifecycle (MEDIUM)
  TRADE_CANDIDATE_CREATED: 'TradeCandidateCreated',
  CANDIDATE_REJECTED: 'CandidateRejected',
  PORTFOLIO_EVALUATED: 'PortfolioEvaluated',
  RISK_ASSESSMENT_COMPLETED: 'RiskAssessmentCompleted',

  // Snapshot + recommendations (HIGH)
  SNAPSHOT_COMPLETED: 'SnapshotCompleted',
  RECOMMENDATION_PUBLISHED: 'RecommendationPublished',
  RECOMMENDATION_EXPIRED: 'RecommendationExpired',

  // Execution (HIGH)
  PAPER_TRADE_OPENED: 'PaperTradeOpened',
  PAPER_TRADE_CLOSED: 'PaperTradeClosed',

  // Feedback (LOW/MEDIUM)
  MODEL_METRICS_UPDATED: 'ModelMetricsUpdated',
} as const

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES]

// Default priority per event type  (Chapter 2.2 §16)
export const EVENT_DEFAULT_PRIORITY: Record<EventType, EventPriority> = {
  MarketUpdated: 'CRITICAL',
  CandlesUpdated: 'HIGH',
  FeatureGenerated: 'MEDIUM',
  MarketRegimeUpdated: 'MEDIUM',
  PredictionCompleted: 'MEDIUM',
  TradeCandidateCreated: 'MEDIUM',
  CandidateRejected: 'MEDIUM',
  PortfolioEvaluated: 'MEDIUM',
  RiskAssessmentCompleted: 'MEDIUM',
  SnapshotCompleted: 'HIGH',
  RecommendationPublished: 'HIGH',
  RecommendationExpired: 'MEDIUM',
  PaperTradeOpened: 'HIGH',
  PaperTradeClosed: 'HIGH',
  ModelMetricsUpdated: 'LOW',
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload contracts — each event type has a versioned, typed payload.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketUpdatedPayload {
  asset: string
  price: number
  change24hPct: number | null
  volume24h: number | null
  source: string
}
export const MARKET_UPDATED_V = '1.0.0'

export interface CandlesUpdatedPayload {
  asset: string
  timeframe: '15m' | '1h' | '4h'
  candleCount: number
  lastClose: number
  isFinal: boolean
}
export const CANDLES_UPDATED_V = '1.0.0'

export interface FeatureGeneratedPayload {
  asset: string
  featureVersion: string
  momentumScore: number | null
  volatilityScore: number | null
  trendAlignment: number | null
}
export const FEATURE_GENERATED_V = '1.0.0'

export interface MarketRegimeUpdatedPayload {
  regime: string
  confidence: number
  breadth: number | null
  dominantAssetCount: number
}
export const MARKET_REGIME_UPDATED_V = '1.0.0'

export interface PredictionCompletedPayload {
  asset: string
  modelVersion: string
  probabilityOfSuccess: number
  expectedReturnPct: number
  confidence: number
  inferenceTimeMs: number
}
export const PREDICTION_COMPLETED_V = '1.0.0'

export interface TradeCandidateCreatedPayload {
  candidateId: string
  asset: string
  action: 'BUY' | 'SELL' | 'WATCH' | 'HOLD'
  expectedValue: number | null
  expiresAt: number
}
export const TRADE_CANDIDATE_CREATED_V = '1.0.0'

export interface CandidateRejectedPayload {
  candidateId: string
  asset: string
  stage: string
  reasons: string[]
}
export const CANDIDATE_REJECTED_V = '1.0.0'

export interface PortfolioEvaluatedPayload {
  totalCandidates: number
  promoted: number
  downgraded: number
  projectedCapitalPct: number
  concentrationWarnings: string[]
}
export const PORTFOLIO_EVALUATED_V = '1.0.0'

export interface RiskAssessmentCompletedPayload {
  candidateId: string
  asset: string
  approved: boolean
  riskScore: number
  rejectionReasons: string[]
}
export const RISK_ASSESSMENT_COMPLETED_V = '1.0.0'

export interface SnapshotCompletedPayload {
  snapshotId: string
  version: number
  eligibleAssets: number
  recommendations: number
  regime: string
  generatedAt: number
  durationMs: number
}
export const SNAPSHOT_COMPLETED_V = '1.0.0'

export interface RecommendationPublishedPayload {
  recommendationId: string
  candidateId: string
  asset: string
  action: 'BUY' | 'SELL' | 'WATCH' | 'HOLD'
  rank: 'A' | 'B' | 'C' | 'D'
  entryPrice: number | null
  expiresAt: number
  snapshotId: string
}
export const RECOMMENDATION_PUBLISHED_V = '1.0.0'

export interface RecommendationExpiredPayload {
  recommendationId: string
  asset: string
  expiredAt: number
  reason: string
}
export const RECOMMENDATION_EXPIRED_V = '1.0.0'

export interface PaperTradeOpenedPayload {
  tradeId: string
  recommendationId: string
  asset: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  quoteValue: number
}
export const PAPER_TRADE_OPENED_V = '1.0.0'

export interface PaperTradeClosedPayload {
  tradeId: string
  asset: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  realizedPnl: number | null
  reason: string
}
export const PAPER_TRADE_CLOSED_V = '1.0.0'

export interface ModelMetricsUpdatedPayload {
  modelVersion: string
  totalPredictions: number
  hitRate: number
  averageReturnPct: number
  calibrationError: number
}
export const MODEL_METRICS_UPDATED_V = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Typed helper: publish + subscribe with the catalog's payload types.
// ─────────────────────────────────────────────────────────────────────────────

import { publishEvent, getEventTransport, type EventEnvelope, type EventHandler } from './transport'

/** Type-safe publisher for each catalog event. */
export function publish<T extends EventType>(
  eventType: T,
  producer: string,
  payload: EventPayloadMap[T],
  correlationId: string,
  snapshotId?: string | null,
): EventEnvelope<EventPayloadMap[T]> {
  return publishEvent({
    eventType,
    eventVersion: EVENT_VERSIONS[eventType],
    producer,
    payload,
    correlationId,
    snapshotId: snapshotId ?? null,
    priority: EVENT_DEFAULT_PRIORITY[eventType],
  })
}

/** Type-safe subscriber for a single catalog event type. */
export function on<T extends EventType>(
  eventType: T,
  consumerName: string,
  handler: (event: EventEnvelope<EventPayloadMap[T]>) => void | Promise<void>,
): () => void {
  return getEventTransport().subscribe(handler as EventHandler, {
    eventTypes: [eventType],
    consumerName,
  })
}

/** Wildcard subscriber (receives all events — for logging/audit/observability). */
export function onAll(consumerName: string, handler: EventHandler): () => void {
  return getEventTransport().subscribe(handler, { eventTypes: null, consumerName })
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapped types: which payload goes with which event type
// ─────────────────────────────────────────────────────────────────────────────

export interface EventPayloadMap {
  MarketUpdated: MarketUpdatedPayload
  CandlesUpdated: CandlesUpdatedPayload
  FeatureGenerated: FeatureGeneratedPayload
  MarketRegimeUpdated: MarketRegimeUpdatedPayload
  PredictionCompleted: PredictionCompletedPayload
  TradeCandidateCreated: TradeCandidateCreatedPayload
  CandidateRejected: CandidateRejectedPayload
  PortfolioEvaluated: PortfolioEvaluatedPayload
  RiskAssessmentCompleted: RiskAssessmentCompletedPayload
  SnapshotCompleted: SnapshotCompletedPayload
  RecommendationPublished: RecommendationPublishedPayload
  RecommendationExpired: RecommendationExpiredPayload
  PaperTradeOpened: PaperTradeOpenedPayload
  PaperTradeClosed: PaperTradeClosedPayload
  ModelMetricsUpdated: ModelMetricsUpdatedPayload
}

export const EVENT_VERSIONS: Record<EventType, string> = {
  MarketUpdated: MARKET_UPDATED_V,
  CandlesUpdated: CANDLES_UPDATED_V,
  FeatureGenerated: FEATURE_GENERATED_V,
  MarketRegimeUpdated: MARKET_REGIME_UPDATED_V,
  PredictionCompleted: PREDICTION_COMPLETED_V,
  TradeCandidateCreated: TRADE_CANDIDATE_CREATED_V,
  CandidateRejected: CANDIDATE_REJECTED_V,
  PortfolioEvaluated: PORTFOLIO_EVALUATED_V,
  RiskAssessmentCompleted: RISK_ASSESSMENT_COMPLETED_V,
  SnapshotCompleted: SNAPSHOT_COMPLETED_V,
  RecommendationPublished: RECOMMENDATION_PUBLISHED_V,
  RecommendationExpired: RECOMMENDATION_EXPIRED_V,
  PaperTradeOpened: PAPER_TRADE_OPENED_V,
  PaperTradeClosed: PAPER_TRADE_CLOSED_V,
  ModelMetricsUpdated: MODEL_METRICS_UPDATED_V,
}
