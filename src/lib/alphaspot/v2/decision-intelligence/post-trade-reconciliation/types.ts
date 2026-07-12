// CHAPTER 5.11 — Post-Trade Reconciliation Engine Types
//
// The PTRE is the exclusive bridge between Exchange Execution (Ch 5.10) and
// Portfolio Accounting. Transforms Exchange Execution Events into reconciled,
// verified, institutionally consistent execution records (§1).
//
// Core principles (§2):
//   • Execution events represent what exchanges CLAIM occurred.
//   • Reconciliation determines what ACTUALLY becomes the institutional source of truth.
//   • Only reconciled executions may update portfolio accounting.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Independent of ML, strategies, portfolio construction, risk policies, broker APIs, accounting logic.
//
// The PTRE performs NO: ML, strategy selection, portfolio construction, risk
// management, position sizing, execution planning, broker communication, portfolio
// accounting, PnL calculation, performance analytics, settlement processing (§1).
//
// 22 architectural rules enforced (see §17).
// 20-stage pipeline (§5 — no skips).

import type { CanonicalExecutionEventContract } from '../exchange-execution/types'

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Types  (Chapter 5.11 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type ReconciliationType =
  | 'FULL_MATCH' // §7
  | 'PARTIAL_MATCH' // §7
  | 'PRICE_DIFFERENCE' // §7
  | 'QUANTITY_DIFFERENCE' // §7
  | 'FEE_DIFFERENCE' // §7
  | 'FUNDING_DIFFERENCE' // §7
  | 'MISSING_TRADE' // §7
  | 'DUPLICATE_TRADE' // §7
  | 'TRADE_CORRECTION' // §7
  | 'TRADE_BUST' // §7
  | 'SETTLEMENT_PENDING' // §7
  | 'SETTLEMENT_COMPLETE' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Status  (Chapter 5.11 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type ReconciliationStatus =
  | 'PENDING'
  | 'FULLY_RECONCILED'
  | 'PARTIALLY_RECONCILED'
  | 'EXCEPTION'
  | 'ESCROW_APPROVED' // §10A — reconciled but settlement pending
  | 'REJECTED'
  | 'CONTRA_RECONCILED' // Rule 21 — bust/correction after publication

// ─────────────────────────────────────────────────────────────────────────────
// Settlement Status  (Chapter 5.11 §4, §6, Rule 12)
// Rule 12 — Settlement status logically independent from reconciliation/escrow status.
// ─────────────────────────────────────────────────────────────────────────────

export type SettlementStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DELAYED'

// ─────────────────────────────────────────────────────────────────────────────
// Escrow Status  (Chapter 5.11 §10A, Rule 12)
// Rule 12 — Escrow status logically independent from reconciliation/settlement.
// ─────────────────────────────────────────────────────────────────────────────

export type EscrowStatus =
  | 'NOT_REQUIRED' // Settlement already confirmed
  | 'PENDING' // §10A — awaiting settlement confirmation
  | 'APPROVED' // §10A — escrow-approved, can proceed to provisional accounting
  | 'AGED_OUT' // §10A — settlement aged beyond threshold
  | 'ROLLED_BACK' // §10A — escrow rollback
  | 'RELEASED' // §10A — settlement confirmed, escrow released

// ─────────────────────────────────────────────────────────────────────────────
// Exception Status  (Chapter 5.11 §4, §6, §10)
// ─────────────────────────────────────────────────────────────────────────────

export type ExceptionStatus =
  | 'NONE'
  | 'MISSING_EXECUTION' // §10
  | 'DUPLICATE_TRADE' // §10
  | 'TRADE_BREAK' // §10
  | 'TRADE_CORRECTION' // §10
  | 'SETTLEMENT_DELAY' // §10
  | 'FEE_MISMATCH' // §10
  | 'QUANTITY_DISCREPANCY' // §10
  | 'PRICE_DISCREPANCY' // §10
  | 'MANUAL_REVIEW' // §10
  | 'CONTRA_RECONCILIATION' // Rule 21

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation Sources  (Chapter 5.11 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeConfirmation {
  confirmationId: string
  exchangeOrderId: string
  tradeId: string
  quantity: number
  price: number
  fees: number
  funding: number
  feeReportVersion: string
  timestamp: number
  sourceVersion: string // Rule 18 — independently versioned
}

export interface BrokerConfirmation {
  confirmationId: string
  brokerOrderId: string
  tradeId: string
  quantity: number
  price: number
  commission: number
  fees: number
  timestamp: number
  sourceVersion: string
}

export interface CustodianConfirmation {
  confirmationId: string
  tradeId: string
  quantity: number
  settlementDate: number
  custodyAccount: string
  cashAccount: string
  timestamp: number
  sourceVersion: string
}

export interface InternalLedgerEntry {
  ledgerId: string
  tradeId: string
  quantity: number
  price: number
  fees: number
  timestamp: number
  sourceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// SSI (Standard Settlement Instructions)  (Chapter 5.11 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface SSIConfiguration {
  ssiId: string
  symbol: string
  clearingAccount: string
  custodyAccount: string
  cashAccount: string
  settlementCurrency: string
  settlementCycle: string // e.g., 'T+1', 'T+2'
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching Result  (Chapter 5.11 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchingResult {
  matched: boolean
  matchType: ReconciliationType
  matchedQuantity: number
  matchedPrice: number
  matchedFees: number
  matchedFunding: number
  discrepancies: MatchingDiscrepancy[]
  toleranceApplied: boolean
  reason: string
}

export interface MatchingDiscrepancy {
  field: 'quantity' | 'price' | 'fees' | 'funding' | 'commission'
  expected: number
  actual: number
  difference: number
  withinTolerance: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Tolerance Configuration  (Chapter 5.11 §8, Rule 15)
// ─────────────────────────────────────────────────────────────────────────────

export interface ToleranceConfiguration {
  quantityTolerance: number // absolute quantity tolerance
  quantityToleranceFraction: number // relative tolerance (fraction)
  priceTolerance: number // absolute price tolerance
  priceToleranceFraction: number // relative tolerance
  feeTolerance: number // absolute fee tolerance
  feeToleranceFraction: number // relative tolerance
  fundingTolerance: number
  version: string
}

export const DEFAULT_TOLERANCE: ToleranceConfiguration = {
  quantityTolerance: 0.0001,
  quantityToleranceFraction: 0.001,
  priceTolerance: 0.01,
  priceToleranceFraction: 0.0001,
  feeTolerance: 0.01,
  feeToleranceFraction: 0.01,
  fundingTolerance: 0.01,
  version: '1.0.0',
}

// ─────────────────────────────────────────────────────────────────────────────
// Contra-Reconciliation Event  (Chapter 5.11 §10, Rule 21)
// Rule 21 — Busts/Corrections after publication generate immutable Contra-Reconciliation Events.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContraReconciliationEvent {
  contraEventId: string
  originalReconciliationId: string
  eventType: 'TRADE_BUST' | 'TRADE_CORRECTION'
  reason: string
  correctedQuantity?: number
  correctedPrice?: number
  correctedFees?: number
  /** Rule 22 — Rollback notification (not direct accounting modification). */
  rollbackNotification: boolean
  timestamp: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrow State  (Chapter 5.11 §10A)
// ─────────────────────────────────────────────────────────────────────────────

export interface EscrowState {
  tradeId: string
  status: EscrowStatus
  /** §10A — Provisional portfolio recognition. */
  provisionalRecognition: boolean
  /** §10A — Pending cash settlement. */
  pendingCashSettlement: number
  /** §10A — Pending asset delivery. */
  pendingAssetDelivery: number
  /** §10A — Custodian confirmation waiting. */
  custodianConfirmationWaiting: boolean
  /** §10A — Settlement aging (ms since escrow created). */
  settlementAgingMs: number
  /** §10A — Escrow created at. */
  createdAt: number
  /** §10A — Escrow released at. */
  releasedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Lineage  (Chapter 5.11 Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationLineage {
  executionEventId: string
  executionVersion: string
  exchangeOrderId: string
  brokerOrderId: string
  parentOrderId: string
  childOrderId: string
  routingDecisionId: string
  executionPlanId: string
  orderDecisionId: string
  positionId: string
  riskAssessmentId: string
  portfolioId: string
  strategyDecisionIds: string[]
  exchangeConfirmationVersion: string
  brokerConfirmationVersion: string
  custodianConfirmationVersion: string
  internalLedgerVersion: string
  ssiVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Version Bundle  (Chapter 5.11 §11, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationVersionBundle {
  reconciliationVersion: string
  executionVersion: string
  brokerVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Governance Metadata  (Chapter 5.11 §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<ReconciliationReviewEvent>
  auditHistory: Array<ReconciliationAuditEvent>
  creationTimestamp: number
  resolutionTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface ReconciliationReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface ReconciliationAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Metadata  (Chapter 5.11 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationMetadata {
  reconciliationId: string
  reconciliationVersion: string
  versions: ReconciliationVersionBundle
  lineage: ReconciliationLineage
  reconciliationType: ReconciliationType
  escrowStatus: EscrowStatus
  contraReconciliationEvents: ContraReconciliationEvent[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Reconciliation Contract  (Chapter 5.11 §4, §6, Rule 4)
// Every reconciliation conforms to this contract. Alternative formats PROHIBITED.
// Records are immutable (Rule 5). Never modifies Execution Event Contracts (Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalReconciliationContract {
  // §4 — Required identifiers
  reconciliationId: string // Rule 3 — unique
  reconciliationVersion: string
  executionEventId: string
  brokerOrderId: string
  exchangeOrderId: string
  tradeId: string
  reconciliationTimestamp: number

  // §6 — Canonical Reconciliation Contract fields
  reconciliationStatus: ReconciliationStatus
  reconciliationType: ReconciliationType
  matchedQuantity: number
  matchedPrice: number
  matchedFees: number
  matchedFunding: number
  settlementStatus: SettlementStatus
  exceptionStatus: ExceptionStatus

  // §10A — Escrow state
  escrowState: EscrowState | null

  // §4 — Metadata + Governance
  reconciliationMetadata: ReconciliationMetadata
  governanceMetadata: ReconciliationGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Configuration  (Chapter 5.11 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationConfiguration {
  tolerance: ToleranceConfiguration
  /** §10A — Settlement escrow enabled. */
  escrowEnabled: boolean
  /** §10A — Settlement aging threshold (ms). */
  settlementAgingThresholdMs: number
  /** Rule 9/19 — Allow escrow-approved trades to enter accounting. */
  allowEscrowApprovedAccounting: boolean
  /** Rule 15 — Tolerance matching enabled. */
  toleranceMatchingEnabled: boolean
  /** §8 — Three-way matching required. */
  threeWayMatchingRequired: boolean
  /** SSI configurations per symbol. */
  ssiConfigurations: Map<string, SSIConfiguration>
  versions: ReconciliationVersionBundle
}

export const DEFAULT_RECONCILIATION_CONFIG: Omit<ReconciliationConfiguration, 'versions' | 'ssiConfigurations'> = {
  tolerance: { ...DEFAULT_TOLERANCE },
  escrowEnabled: true,
  settlementAgingThresholdMs: 1000 * 60 * 60 * 24, // 24 hours
  allowEscrowApprovedAccounting: true,
  toleranceMatchingEnabled: true,
  threeWayMatchingRequired: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation Pipeline Stages  (Chapter 5.11 §5 — 20 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const RECONCILIATION_STAGES = [
  'EXECUTION_EVENT_RECEPTION',
  'EXECUTION_VALIDATION',
  'EXCHANGE_CONFIRMATION_LOADING',
  'BROKER_CONFIRMATION_LOADING',
  'CUSTODIAN_CONFIRMATION_LOADING',
  'INTERNAL_LEDGER_LOADING',
  'SSI_VALIDATION',
  'THREE_WAY_TRADE_MATCHING',
  'TRADE_MATCHING',
  'QUANTITY_RECONCILIATION',
  'PRICE_RECONCILIATION',
  'FEE_RECONCILIATION',
  'FUNDING_VERIFICATION',
  'SETTLEMENT_VERIFICATION',
  'EXCEPTION_RESOLUTION',
  'RECONCILIATION_VALIDATION',
  'RECONCILIATION_PUBLICATION',
  'METADATA_RECORDING',
  'RECONCILIATION_COMPLETION',
] as const

export type ReconciliationStage = (typeof RECONCILIATION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const PTRE_VERSION = '1.0.0'
export const RECONCILIATION_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalExecutionEventContract } from '../exchange-execution/types'
