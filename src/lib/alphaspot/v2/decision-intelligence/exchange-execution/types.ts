// CHAPTER 5.10 — Exchange Execution Engine Types
//
// The EEE is the exclusive bridge between Broker Gateway (Ch 5.9) and Post-Trade
// Processing. Manages the complete lifecycle of live exchange orders after
// transmission (§1).
//
// Core principles (§2):
//   • Broker communication requests execution.
//   • The exchange determines execution.
//   • The EEE shall never predict exchange behavior. It records and governs actual events.
//   • Deterministic, event-driven, reproducible, configurable, version controlled, auditable.
//   • Exchange-specific implementations isolated from downstream accounting.
//
// The EEE performs NO: ML, portfolio construction, risk management, position
// sizing, order decision, smart order routing, broker connectivity, portfolio
// accounting, performance analytics (§1).
//
// 23 architectural rules enforced (see §17).
// 14-stage pipeline (§5 — no skips).

import type { CanonicalBrokerCommunicationContract } from '../broker-gateway/types'

// ─────────────────────────────────────────────────────────────────────────────
// Execution States  (Chapter 5.10 §7 — 15 states)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionState =
  | 'SUBMITTED' // §7
  | 'ACCEPTED' // §7
  | 'WORKING' // §7
  | 'PARTIALLY_FILLED' // §7
  | 'FILLED' // §7
  | 'CANCEL_PENDING' // §7
  | 'CANCELLED' // §7
  | 'MODIFY_PENDING' // §7
  | 'MODIFIED' // §7
  | 'REJECTED' // §7
  | 'EXPIRED' // §7
  | 'SUSPENDED' // §7
  | 'BUST_PENDING' // §7
  | 'TRADE_BUSTED' // §7
  | 'TRADE_CORRECTED' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Event Types  (Chapter 5.10 §9 — 16 events)
// ─────────────────────────────────────────────────────────────────────────────

export type ExchangeEventType =
  | 'NEW_ORDER_ACK' // §9
  | 'EXECUTION_REPORT' // §9
  | 'PARTIAL_FILL' // §9
  | 'COMPLETE_FILL' // §9
  | 'ORDER_REJECT' // §9
  | 'ORDER_CANCEL' // §9
  | 'CANCEL_REJECT' // §9
  | 'ORDER_REPLACE' // §9
  | 'REPLACE_REJECT' // §9
  | 'TRADING_HALT' // §9
  | 'SESSION_DISCONNECT' // §9
  | 'SESSION_RECOVERY' // §9
  | 'TRADE_BUST' // §9
  | 'TRADE_CORRECTION' // §9
  | 'EXECUTION_REPLAY_RESPONSE' // §9
  | 'HISTORICAL_SEQUENCE_RECOVERY' // §9

// ─────────────────────────────────────────────────────────────────────────────
// Execution Status  (Chapter 5.10 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'BUSTED'
  | 'CORRECTED'
  | 'SUSPENDED'

// ─────────────────────────────────────────────────────────────────────────────
// Gap-Recovery State  (Chapter 5.10 §10, Rule 23)
// ─────────────────────────────────────────────────────────────────────────────

export type GapRecoveryState =
  | 'NORMAL' // Normal operation
  | 'GAP_DETECTED' // §10 — gap detected, entering recovery
  | 'REPLAY_REQUESTED' // §10 — missing events requested
  | 'REPLAY_IN_PROGRESS' // §10 — replay underway
  | 'SYNCHRONIZED' // §10 — fully synchronized, can resume
  | 'SUSPENDED' // Rule 23 — processing suspended

// ─────────────────────────────────────────────────────────────────────────────
// Session Status  (Chapter 5.10 §10)
// ─────────────────────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTED' // §9 — Session Disconnect
  | 'RECOVERING' // §9 — Session Recovery
  | 'HALTED' // §9 — Trading Halt
  | 'SUSPENDED'

// ─────────────────────────────────────────────────────────────────────────────
// Fill Record  (Chapter 5.10 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface FillRecord {
  fillId: string
  /** Exchange-assigned execution ID (for dedup, §8). */
  exchangeExecutionId: string
  /** Fill quantity. */
  fillQuantity: number
  /** Fill price. */
  fillPrice: number
  /** Fill timestamp (exchange-side, Rule 17). */
  fillTimestamp: number
  /** Venue where fill occurred. */
  venue: string
  /** Commission/fee for this fill. */
  fee: number
  /** Whether this fill was later busted. */
  busted: boolean
  /** Whether this fill was corrected. */
  corrected: boolean
  /** Correction event ID (if corrected). */
  correctionEventId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Fill Aggregation  (Chapter 5.10 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface FillAggregation {
  /** Total filled quantity (sum of all confirmed fills, §8). */
  totalFilledQuantity: number
  /** Total remaining quantity. */
  remainingQuantity: number
  /** Average execution price (computed solely from confirmed fills, Rule 10). */
  averageExecutionPrice: number
  /** Total fees aggregated. */
  totalFees: number
  /** Total execution cost. */
  totalExecutionCost: number
  /** Number of fills. */
  fillCount: number
  /** All fill records (preserves lineage, §8). */
  fills: FillRecord[]
  /** Per-venue fill breakdown (multi-venue, §8). */
  perVenueBreakdown: Record<string, { quantity: number; averagePrice: number; fillCount: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Event  (Chapter 5.10 §3, §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeEvent {
  eventId: string
  eventType: ExchangeEventType
  /** Exchange-assigned sequence number (for ordering, §7). */
  exchangeSequence: number
  /** Exchange order ID. */
  exchangeOrderId: string
  /** Broker order ID (links to Ch 5.9). */
  brokerOrderId: string
  /** Event timestamp (exchange-side). */
  eventTimestamp: number
  /** Event data (type-specific). */
  eventData: ExchangeEventData
  /** Venue where event originated. */
  venue: string
  /** Whether event arrived in order. */
  inOrder: boolean
}

export interface ExchangeEventData {
  // Fill data (for PARTIAL_FILL, COMPLETE_FILL)
  fillQuantity?: number
  fillPrice?: number
  exchangeExecutionId?: string
  fee?: number
  // Reject data
  rejectReason?: string
  rejectCode?: string
  // Cancel data
  cancelReason?: string
  // Modify data
  modifiedQuantity?: number
  modifiedPrice?: number
  // Bust data (§9, Rule 22)
  bustedExecutionId?: string
  bustReason?: string
  // Correction data (§9, Rule 22)
  correctedExecutionId?: string
  correctedQuantity?: number
  correctedPrice?: number
  correctedFee?: number
  // Replay data
  replaySequenceRange?: { start: number; end: number }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Lineage  (Chapter 5.10 Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionLineage {
  brokerRequestId: string
  routingDecisionId: string
  executionPlanId: string
  orderDecisionId: string
  positionId: string
  riskAssessmentId: string
  portfolioId: string
  strategyDecisionIds: string[]
  exchangeOrderId: string
  brokerOrderId: string
  childOrderId: string
  brokerApiVersion: string
  protocolVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Version Bundle  (Chapter 5.10 §11, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionVersionBundle {
  executionVersion: string
  brokerVersion: string
  routingVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Governance Metadata  (Chapter 5.10 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<ExecutionReviewEvent>
  auditHistory: Array<ExecutionAuditEvent>
  creationTimestamp: number
  completionTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface ExecutionReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface ExecutionAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Metadata  (Chapter 5.10 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionMetadata {
  executionEventId: string
  executionVersion: string
  versions: ExecutionVersionBundle
  lineage: ExecutionLineage
  executionState: ExecutionState
  sessionStatus: SessionStatus
  gapRecoveryState: GapRecoveryState
  sequenceBufferDepth: number
  lastExchangeSequence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Execution Event Contract  (Chapter 5.10 §4, §6, Rule 4)
// Every execution conforms to this contract. Alternative formats PROHIBITED.
// Records are immutable (Rule 5). Never modifies upstream contracts (Rule 16).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalExecutionEventContract {
  // §4 — Required identifiers
  executionEventId: string // Rule 3 — unique
  executionVersion: string
  exchangeOrderId: string
  brokerOrderId: string
  parentOrderId: string
  childOrderId: string
  executionTimestamp: number

  // §6 — Canonical Execution Event Contract fields
  executionStatus: ExecutionStatus
  executionState: ExecutionState
  executedQuantity: number
  remainingQuantity: number
  averageExecutionPrice: number
  executionVenue: string

  // §8 — Fill aggregation
  fillAggregation: FillAggregation

  // §4 — Metadata + Governance
  executionMetadata: ExecutionMetadata
  governanceMetadata: ExecutionGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Order State  (Chapter 5.10 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveOrderState {
  exchangeOrderId: string
  brokerOrderId: string
  currentState: ExecutionState
  /** §10 — Pending quantity. */
  pendingQuantity: number
  /** §10 — Filled quantity. */
  filledQuantity: number
  /** §10 — Remaining quantity. */
  remainingQuantity: number
  /** §10 — Cancel status. */
  cancelStatus: 'NONE' | 'PENDING' | 'CONFIRMED' | 'REJECTED'
  /** §10 — Replace status. */
  replaceStatus: 'NONE' | 'PENDING' | 'CONFIRMED' | 'REJECTED'
  /** §10 — Session status. */
  sessionStatus: SessionStatus
  /** §10 — Last exchange sequence received. */
  lastExchangeSequence: number
  /** §10 — Gap-recovery state. */
  gapRecoveryState: GapRecoveryState
  /** §10 — Replay sync state. */
  replaySyncState: 'SYNCHRONIZED' | 'PENDING' | 'IN_PROGRESS'
  /** All fills for this order. */
  fills: FillRecord[]
  /** State transition history. */
  stateHistory: Array<{ from: ExecutionState; to: ExecutionState; at: number; reason: string }>
  /** Created at. */
  createdAt: number
  /** Last update. */
  lastUpdate: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Configuration  (Chapter 5.10 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionConfiguration {
  /** Gap-recovery timeout (ms). */
  gapRecoveryTimeoutMs: number
  /** Sequence buffer max size. */
  sequenceBufferMaxSize: number
  /** Whether trade bust/correction processing is enabled. */
  bustCorrectionEnabled: boolean
  /** Replay request batch size. */
  replayBatchSize: number
  /** Max replay attempts. */
  maxReplayAttempts: number
  versions: ExecutionVersionBundle
}

export const DEFAULT_EXECUTION_CONFIG: Omit<ExecutionConfiguration, 'versions'> = {
  gapRecoveryTimeoutMs: 30000,
  sequenceBufferMaxSize: 10000,
  bustCorrectionEnabled: true,
  replayBatchSize: 100,
  maxReplayAttempts: 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Pipeline Stages  (Chapter 5.10 §5 — 14 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const EXECUTION_PIPELINE_STAGES = [
  'BROKER_COMMUNICATION_RECEPTION',
  'COMMUNICATION_VALIDATION',
  'EXCHANGE_SESSION_VERIFICATION',
  'EXCHANGE_ACKNOWLEDGMENT_PROCESSING',
  'ASYNCHRONOUS_SEQUENCE_BUFFER',
  'EVENT_ORDERING_GAP_DETECTION',
  'EXECUTION_EVENT_RECEPTION',
  'EXECUTION_STATE_UPDATE',
  'FILL_AGGREGATION',
  'TRADE_BUST_CORRECTION_PROCESSING',
  'EXECUTION_VALIDATION',
  'EXECUTION_PUBLICATION',
  'METADATA_RECORDING',
  'EXECUTION_COMPLETION',
] as const

export type ExecutionPipelineStage = (typeof EXECUTION_PIPELINE_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const EEE_VERSION = '1.0.0'
export const EXECUTION_EVENT_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalBrokerCommunicationContract } from '../broker-gateway/types'
