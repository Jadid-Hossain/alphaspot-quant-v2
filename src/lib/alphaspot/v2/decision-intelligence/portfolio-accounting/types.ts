// CHAPTER 5.12 — Portfolio Accounting Engine Types
//
// The PAE is the exclusive bridge between Post-Trade Reconciliation (Ch 5.11)
// and downstream financial/risk/performance/compliance/reporting systems.
// Transforms reconciled execution records into the authoritative institutional
// portfolio ledger through double-entry, immutable, bi-temporal accounting (§1).
//
// 23 architectural rules enforced (see §19).
// 13-stage pipeline (§5 — no skips).

import type { CanonicalReconciliationContract } from '../post-trade-reconciliation/types'

// ─────────────────────────────────────────────────────────────────────────────
// Cost Basis Methodologies  (Chapter 5.12 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type CostBasisMethod =
  | 'AVERAGE_COST' // §8
  | 'FIFO' // §8
  | 'LIFO' // §8
  | 'SPECIFIC_IDENTIFICATION' // §8
  | 'WEIGHTED_AVERAGE' // §8
  | 'REGULATORY_COST_BASIS' // §8

// ─────────────────────────────────────────────────────────────────────────────
// Ledger Types  (Chapter 5.12 §7 — 8 ledgers)
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerType =
  | 'PORTFOLIO_LEDGER' // §7
  | 'POSITION_LEDGER' // §7
  | 'CASH_LEDGER' // §7
  | 'CURRENCY_LEDGER' // §7
  | 'CORPORATE_ACTION_LEDGER' // §7
  | 'ADJUSTMENT_LEDGER' // §7
  | 'HISTORICAL_LEDGER' // §7
  | 'AUDIT_LEDGER' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Compensating Journal Types  (Chapter 5.12 §7A, Rule 21)
// ─────────────────────────────────────────────────────────────────────────────

export type CompensatingJournalType =
  | 'TRADE_BUST_REVERSAL' // §7A
  | 'TRADE_CORRECTION_ADJUSTMENT' // §7A
  | 'CORPORATE_ACTION_REVERSAL' // §7A
  | 'FEE_REVERSAL' // §7A
  | 'FUNDING_REVERSAL' // §7A
  | 'SETTLEMENT_ADJUSTMENT' // §7A

// ─────────────────────────────────────────────────────────────────────────────
// Corporate Action Types  (Chapter 5.12 §12)
// ─────────────────────────────────────────────────────────────────────────────

export type CorporateActionType =
  | 'STOCK_SPLIT' | 'REVERSE_SPLIT' | 'DIVIDEND' | 'SPECIAL_DIVIDEND'
  | 'RIGHTS_ISSUE' | 'SPIN_OFF' | 'MERGER' | 'ACQUISITION'
  | 'DELISTING' | 'SYMBOL_CHANGE'

// ─────────────────────────────────────────────────────────────────────────────
// Position State Types  (Chapter 5.12 §10A, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export type PositionStateType = 'TRADED' | 'SETTLED'

// ─────────────────────────────────────────────────────────────────────────────
// Double-Entry Entry Side  (Chapter 5.12 §7, Rule 9/17)
// ─────────────────────────────────────────────────────────────────────────────

export type EntrySide = 'DEBIT' | 'CREDIT'

// ─────────────────────────────────────────────────────────────────────────────
// Bi-Temporal Timestamps  (Chapter 5.12 §4A, Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface BiTemporalTimestamps {
  /** §4A — When the event was recorded by AlphaSpot. */
  recordTime: number
  /** §4A — When the economic event became effective in the market. */
  effectiveTime: number
  /** §4A — When a correction or adjustment was applied. */
  correctionTime: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Double-Entry Journal Entry  (Chapter 5.12 §7, Rule 9/17)
// ─────────────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  entryId: string
  ledgerType: LedgerType
  account: string
  side: EntrySide
  quantity: number
  amount: number
  currency: string
  /** For multi-currency (Rule 13 — preserve native + translated). */
  nativeAmount: number
  translatedAmount: number
  fxRate: number
  biTemporal: BiTemporalTimestamps
  /** Rule 21 — References original event for compensating journals. */
  originalAccountingEventId: string | null
  description: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax Lot  (Chapter 5.12 §9)
// ─────────────────────────────────────────────────────────────────────────────

export interface TaxLot {
  lotId: string
  symbol: string
  quantity: number
  costBasisPerUnit: number
  totalCostBasis: number
  acquisitionDate: number
  /** §9 — Holding period tracking. */
  holdingPeriodDays: number
  /** §9 — Wash sale tracking. */
  washSaleFlag: boolean
  /** Whether lot is open or closed. */
  status: 'OPEN' | 'CLOSED'
  closedDate: number | null
  realizedGainLoss: number
  version: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Position State  (Chapter 5.12 §10A, Rule 22)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionState {
  symbol: string
  stateType: PositionStateType
  quantity: number
  averageCost: number
  totalCostBasis: number
  currency: string
  /** §11A — Short position financing fields (Rule 23). */
  isShort: boolean
  borrowLiability: number
  marginLiability: number
  borrowFeeAccrued: number
  fundingPaymentAccrued: number
  rebateAccrued: number
  /** Open tax lots for this position. */
  taxLots: TaxLot[]
  lastUpdate: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash Balance  (Chapter 5.12 §10)
// ─────────────────────────────────────────────────────────────────────────────

export interface CashBalance {
  currency: string
  available: number
  pending: number // §10 — Pending Cash
  escrow: number // §10 — Escrow Cash
  margin: number // §10 — Margin Cash
  borrow: number // §10 — Borrow Cash
  accruedIncome: number
  lastUpdate: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio State  (Chapter 5.12 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioState {
  portfolioId: string
  totalNav: number
  baseCurrency: string
  /** §10A — Traded position state (Rule 22). */
  tradedPositions: Map<string, PositionState>
  /** §10A — Settled position state (Rule 22). */
  settledPositions: Map<string, PositionState>
  /** §10 — Cash balances per currency. */
  cashBalances: Map<string, CashBalance>
  /** §9 — All tax lots. */
  taxLots: TaxLot[]
  lastUpdate: number
}

// ─────────────────────────────────────────────────────────────────────────────
// FX Translation Rate  (Chapter 5.12 §3, §11)
// ─────────────────────────────────────────────────────────────────────────────

export interface FXTranslationRate {
  fromCurrency: string
  toCurrency: string
  rate: number
  timestamp: number
  source: string
  sourceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Corporate Action Event  (Chapter 5.12 §3, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface CorporateActionEvent {
  actionId: string
  actionType: CorporateActionType
  symbol: string
  exDate: number
  recordDate: number
  paymentDate: number
  ratio: number
  cashAmount: number
  newSymbol: string | null
  description: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Lineage  (Chapter 5.12 Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountingLineage {
  reconciliationId: string
  reconciliationVersion: string
  executionEventId: string
  exchangeOrderId: string
  brokerOrderId: string
  parentOrderId: string
  routingDecisionId: string
  executionPlanId: string
  orderDecisionId: string
  positionId: string
  riskAssessmentId: string
  portfolioId: string
  strategyDecisionIds: string[]
  corporateActionId: string | null
  fxTranslationSource: string
  fxTranslationVersion: string
  costBasisVersion: string
  taxLotVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Version Bundle  (Chapter 5.12 §13, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountingVersionBundle {
  accountingVersion: string
  reconciliationVersion: string
  portfolioVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Governance Metadata  (Chapter 5.12 §14)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountingGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  postingTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Metadata  (Chapter 5.12 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountingMetadata {
  accountingEventId: string
  accountingVersion: string
  versions: AccountingVersionBundle
  lineage: AccountingLineage
  biTemporal: BiTemporalTimestamps
  costBasisMethod: CostBasisMethod
  isCompensating: boolean
  compensatingType: CompensatingJournalType | null
  originalAccountingEventId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Portfolio Accounting Contract  (Chapter 5.12 §4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPortfolioAccountingContract {
  // §4 — Required identifiers
  accountingEventId: string // Rule 3 — unique
  accountingVersion: string
  portfolioId: string
  positionId: string
  ledgerEntryId: string
  assetIdentifier: string
  accountingTimestamp: number

  // §6 — Canonical Portfolio Accounting Contract fields
  currency: string
  quantity: number
  costBasis: number
  averageCost: number
  cashBalance: number
  accruedIncome: number

  // §4 — Journal entries (double-entry, Rule 9/17)
  journalEntries: JournalEntry[]

  // §4 — Portfolio state
  portfolioState: PortfolioState

  // §4 — Metadata + Governance
  accountingMetadata: AccountingMetadata
  governanceMetadata: AccountingGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Configuration  (Chapter 5.12 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountingConfiguration {
  defaultCostBasisMethod: CostBasisMethod
  perAssetCostBasis: Record<string, CostBasisMethod>
  baseCurrency: string
  /** §10A — Escrow accounting enabled (Rule 16). */
  escrowAccountingEnabled: boolean
  /** Rule 15 — Deterministic replay enabled. */
  deterministicReplay: boolean
  /** Rule 14 — Tax lot method. */
  taxLotMethod: CostBasisMethod
  /** §11A — Short position financing enabled (Rule 23). */
  shortFinancingEnabled: boolean
  borrowFeeRate: number
  fundingRate: number
  rebateRate: number
  versions: AccountingVersionBundle
}

export const DEFAULT_ACCOUNTING_CONFIG: Omit<AccountingConfiguration, 'versions'> = {
  defaultCostBasisMethod: 'AVERAGE_COST',
  perAssetCostBasis: {},
  baseCurrency: 'USDT',
  escrowAccountingEnabled: true,
  deterministicReplay: true,
  taxLotMethod: 'FIFO',
  shortFinancingEnabled: true,
  borrowFeeRate: 0.01,
  fundingRate: 0.0001,
  rebateRate: 0.005,
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Pipeline Stages  (Chapter 5.12 §5 — 13 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const ACCOUNTING_STAGES = [
  'RECONCILIATION_RECEPTION',
  'VALIDATION',
  'SETTLEMENT_ESCROW_EVALUATION',
  'CORPORATE_ACTION_LOADING',
  'FX_TRANSLATION',
  'TAX_LOT_IDENTIFICATION',
  'COST_BASIS_CALCULATION',
  'DOUBLE_ENTRY_POSTING',
  'LEDGER_VALIDATION',
  'PORTFOLIO_STATE_UPDATE',
  'ACCOUNTING_PUBLICATION',
  'METADATA_RECORDING',
  'ACCOUNTING_COMPLETION',
] as const

export type AccountingStage = (typeof ACCOUNTING_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const PAE_VERSION = '1.0.0'
export const ACCOUNTING_SCHEMA_VERSION = '1.0.0'

// Re-export
export type { CanonicalReconciliationContract } from '../post-trade-reconciliation/types'
