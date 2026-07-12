// CHAPTER 5.15 — Compliance & Regulatory Control Engine Types
//
// The CRCE serves as BOTH:
//   • Pre-Trade Compliance Gatekeeper (between Order Intent Ch 5.6 and Execution Planning Ch 5.7)
//   • Post-Trade Compliance Authority (after Risk Analytics Ch 5.14)
//
// 20 architectural rules enforced (see §18).
// Dual pipeline: Pre-Trade (12 stages) + Post-Trade (11 stages).

// ─────────────────────────────────────────────────────────────────────────────
// Compliance Decision  (§6A)
// ─────────────────────────────────────────────────────────────────────────────

export type PreTradeDecision = 'APPROVED' | 'WARNING' | 'HARD_VETO'
export type PostTradeDecision = 'PASSIVE_BREACH_ALERT' | 'MANDATORY_REVIEW' | 'ESCALATION_REQUIRED' | 'EMERGENCY_HALT'
export type ComplianceDecision = PreTradeDecision | PostTradeDecision

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Context  (§4, §5)
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationContext = 'PRE_TRADE' | 'POST_TRADE'

// ─────────────────────────────────────────────────────────────────────────────
// Regulatory Frameworks  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type RegulatoryFramework =
  | 'SEC' | 'FINRA' | 'MIFID_II' | 'EMIR' | 'DODD_FRANK'
  | 'BASEL' | 'IOSCO' | 'FCA' | 'MAS' | 'LOCAL_JURISDICTION'

// ─────────────────────────────────────────────────────────────────────────────
// Surveillance Types  (§10, Rule 18 — independent from mandate validation)
// ─────────────────────────────────────────────────────────────────────────────

export type SurveillanceType =
  | 'WASH_TRADE' | 'SPOOFING' | 'LAYERING' | 'MARKET_MANIPULATION'
  | 'ABNORMAL_PATTERN' | 'CROSS_MARKET' | 'ORDER_CONCENTRATION' | 'INSIDER_TRADING'

// ─────────────────────────────────────────────────────────────────────────────
// Compliance DSL  (§7A, Rule 8/9)
// Rule 8 — All regulatory requirements execute through deterministic compiled DSL.
// Rule 9 — Natural-language documents never evaluated directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceRule {
  ruleId: string
  ruleName: string
  framework: RegulatoryFramework
  /** §7A — Compiled deterministic rule expression (DSL). */
  dslExpression: string
  /** §7A — Rule pack (jurisdiction/client/investment policy). */
  rulePack: 'JURISDICTION' | 'CLIENT' | 'INVESTMENT_POLICY'
  version: string
  /** Rule 9 — Natural language source (never evaluated directly). */
  naturalLanguageSource: string | null
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

export interface RuleEvaluationResult {
  ruleId: string
  ruleName: string
  passed: boolean
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  actualValue: number | string
  limitValue: number | string
  description: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Investment Mandate  (§8, Rule 11 — independent from statutory requirements)
// ─────────────────────────────────────────────────────────────────────────────

export interface InvestmentMandate {
  mandateId: string
  maxPositionSize: number
  minDiversification: number
  sectorLimits: Record<string, number>
  countryLimits: Record<string, number>
  issuerLimits: Record<string, number>
  esgConstraints: string[]
  leverageLimit: number
  liquidityConstraints: Record<string, number>
  benchmarkConstraints: Record<string, number>
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Restrictions  (§9, Rule 10 — independent from jurisdiction regulations)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientRestrictions {
  clientId: string
  restrictedSecurities: string[]
  restrictedCountries: string[]
  restrictedIndustries: string[]
  ethicalRestrictions: string[]
  esgRestrictions: string[]
  taxRestrictions: string[]
  investmentEligibility: string[]
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// AML/KYC Status  (§11, Rule 12 — independently version controlled)
// ─────────────────────────────────────────────────────────────────────────────

export interface AMLKYCStatus {
  customerId: string
  amlStatus: 'CLEAR' | 'FLAGGED' | 'UNDER_REVIEW' | 'BLOCKED'
  kycStatus: 'VERIFIED' | 'PENDING' | 'EXPIRED' | 'FAILED'
  sanctionsScreening: 'CLEAR' | 'HIT'
  pepScreening: 'CLEAR' | 'HIT'
  beneficialOwnership: 'VERIFIED' | 'PENDING'
  identityVerification: 'VERIFIED' | 'PENDING' | 'FAILED'
  complianceHold: boolean
  version: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance Lineage  (Rule 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceLineage {
  orderIntentId: string | null
  accountingEventId: string | null
  performanceEventId: string | null
  riskEventId: string | null
  portfolioId: string
  ruleLibraryVersion: string
  dslVersion: string
  jurisdictionVersion: string
  mandateVersion: string
  clientRestrictionVersion: string
  amlKycVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface ComplianceVersionBundle {
  complianceVersion: string
  accountingVersion: string
  performanceVersion: string
  riskVersion: string
  configurationVersion: string
  governanceVersion: string
}

export interface ComplianceGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  evaluationTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Compliance Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalComplianceContract {
  complianceEventId: string // Rule 5
  complianceVersion: string
  portfolioId: string
  positionId: string
  evaluationContext: EvaluationContext
  evaluationTimestamp: number

  // §6 — Canonical Compliance Contract fields
  complianceDecision: ComplianceDecision
  approvalStatus: 'APPROVED' | 'WARNING' | 'REJECTED' | 'CONDITIONAL'
  ruleEvaluationResults: RuleEvaluationResult[]
  violationClassification: string[]
  restrictionStatus: 'CLEAR' | 'RESTRICTED' | 'PROHIBITED'
  escalationStatus: 'NONE' | 'PENDING' | 'ESCALATED' | 'RESOLVED'
  enforcementAction: string
  requiredActions: string[]

  // §4 — Metadata + Governance
  complianceMetadata: {
    complianceEventId: string
    complianceVersion: string
    versions: ComplianceVersionBundle
    lineage: ComplianceLineage
    evaluationContext: EvaluationContext
    dslVersion: string
    ruleLibraryVersion: string
  }
  governanceMetadata: ComplianceGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 6 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceConfiguration {
  /** Registered compliance rules (§7A — compiled DSL). */
  rules: ComplianceRule[]
  /** Investment mandate (§8). */
  mandate: InvestmentMandate | null
  /** Client restrictions (§9). */
  clientRestrictions: ClientRestrictions | null
  /** AML/KYC status (§11). */
  amlKyc: AMLKYCStatus | null
  /** §17 — Fail-closed mode: if evaluation can't complete, reject. */
  failClosed: boolean
  /** Active jurisdictions. */
  jurisdictions: RegulatoryFramework[]
  versions: ComplianceVersionBundle
}

export const DEFAULT_COMPLIANCE_CONFIG: Omit<ComplianceConfiguration, 'versions'> = {
  rules: [],
  mandate: null,
  clientRestrictions: null,
  amlKyc: null,
  failClosed: true,
  jurisdictions: ['SEC', 'FINRA'],
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages  (§5 — dual workflow)
// ─────────────────────────────────────────────────────────────────────────────

export const PRE_TRADE_STAGES = [
  'ORDER_INTENT_RECEPTION', 'VALIDATION', 'REGULATORY_RULE_LOADING',
  'JURISDICTION_RULE_LOADING', 'CLIENT_RESTRICTION_LOADING',
  'INVESTMENT_MANDATE_LOADING', 'AML_KYC_VALIDATION',
  'COMPLIANCE_RULE_EVALUATION', 'DECISION_FRAMEWORK',
  'METADATA_RECORDING', 'COMPLETION',
] as const

export const POST_TRADE_STAGES = [
  'PORTFOLIO_STATE_RECEPTION', 'VALIDATION', 'RISK_CONTRACT_LOADING',
  'PERFORMANCE_CONTRACT_LOADING', 'MANDATE_EVALUATION',
  'SURVEILLANCE_EVALUATION', 'PASSIVE_BREACH_DETECTION',
  'ESCALATION_FRAMEWORK', 'PUBLICATION',
  'METADATA_RECORDING', 'COMPLETION',
] as const

export const CRCE_VERSION = '1.0.0'
export const COMPLIANCE_SCHEMA_VERSION = '1.0.0'
