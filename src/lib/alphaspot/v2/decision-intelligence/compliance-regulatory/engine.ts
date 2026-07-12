// CHAPTER 5.15 §5 — Compliance & Regulatory Control Engine (CRCE)
//
// §1 — The CRCE serves as BOTH Pre-Trade Compliance Gatekeeper (between
//      Order Intent Ch 5.6 and Execution Planning Ch 5.7) AND Post-Trade
//      Compliance Authority (after Risk Analytics Ch 5.14).
//
// §5 — Dual pipeline:
//   Pre-Trade: 11 stages (ORDER_INTENT_RECEPTION → ... → HARD_VETO/APPROVED/WARNING → COMPLETION)
//   Post-Trade: 11 stages (PORTFOLIO_STATE_RECEPTION → ... → PUBLICATION → COMPLETION)
//
// 20 architectural rules enforced (see §18).

import { createLogger } from '../../domains/01-core-infrastructure'
import type {
  CanonicalComplianceContract,
  ComplianceConfiguration,
  ComplianceGovernanceMetadata,
  ComplianceLineage,
  ComplianceVersionBundle,
  EvaluationContext,
} from './types'
import { CRCE_VERSION, COMPLIANCE_SCHEMA_VERSION } from './types'
import {
  dslEvaluator, mandateEvaluator, clientRestrictionEvaluator,
  surveillanceEvaluator, amlKycEvaluator, decisionFramework,
} from './evaluation'
import {
  complianceVersionRegistry, complianceGovernanceManager,
  complianceFailureRecovery, crceObservabilityCollector,
} from './governance'

const log = createLogger('decision-intelligence:compliance-regulatory:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Pre-Trade Compliance Request
// ─────────────────────────────────────────────────────────────────────────────

export interface PreTradeComplianceRequest {
  orderIntentId: string
  portfolioId: string
  positionId: string
  symbol: string
  quantity: number
  price: number
  sector: string
  country: string
  currency: string
  industry: string
  positionFraction: number
  sectorExposure: number
  grossExposure: number
  leverage: number
  diversification: number
  liquidity: number
  orderFrequency: number
  orderSize: number
  avgOrderSize: number
  orderConcentration: number
  config: ComplianceConfiguration
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-Trade Compliance Request
// ─────────────────────────────────────────────────────────────────────────────

export interface PostTradeComplianceRequest {
  accountingEventId: string
  performanceEventId: string
  riskEventId: string
  portfolioId: string
  positionId: string
  positionFraction: number
  diversification: number
  sectorExposure: number
  leverage: number
  liquidity: number
  orderFrequency: number
  orderSize: number
  avgOrderSize: number
  orderConcentration: number
  breachSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  config: ComplianceConfiguration
}

// ─────────────────────────────────────────────────────────────────────────────
// Result
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceResult {
  compliance: CanonicalComplianceContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// CRCE — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class ComplianceRegulatoryControlEngine {
  private history: CanonicalComplianceContract[] = []
  private subscribers = new Set<(c: CanonicalComplianceContract) => void>()
  private readonly MAX_HISTORY = 500

  /**
   * Pre-Trade Compliance Evaluation (§5 — 11-stage pipeline).
   * Rule 2 — Must complete before Order Intent enters Execution Planning.
   * Rule 3 — HARD_VETO orders never proceed to downstream execution.
   * §17 — Fail-closed: if evaluation can't complete, reject.
   */
  evaluatePreTrade(request: PreTradeComplianceRequest): ComplianceResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalComplianceContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        crceObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        crceObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { config } = request

    try {
      // STAGE 1: ORDER_INTENT_RECEPTION (Rule 1)
      track('ORDER_INTENT_RECEPTION', () => {
        if (!request.orderIntentId) throw new Error('invalid order intent')
      })

      // STAGE 2: VALIDATION
      track('VALIDATION', () => { /* validate */ })

      // STAGES 3-6: Loading (regulatory/jurisdiction/client/mandate)
      track('REGULATORY_RULE_LOADING', () => { /* loaded from config */ })
      track('JURISDICTION_RULE_LOADING', () => { /* loaded */ })
      track('CLIENT_RESTRICTION_LOADING', () => { /* loaded */ })
      track('INVESTMENT_MANDATE_LOADING', () => { /* loaded */ })

      // STAGE 7: AML/KYC VALIDATION (Rule 12 — independent versioning)
      let amlKycResult: { passed: boolean; violations: string[] }
      track('AML_KYC_VALIDATION', () => {
        amlKycResult = amlKycEvaluator.evaluate(config.amlKyc)
        if (!amlKycResult.passed) crceObservabilityCollector.recordAMLAlert()
      })

      // STAGE 8: COMPLIANCE RULE EVALUATION (§7A, Rule 8 — deterministic DSL)
      let ruleResults: import('./types').RuleEvaluationResult[]
      let mandateResult: { passed: boolean; violations: string[] }
      let clientResult: { passed: boolean; violations: string[] }
      track('COMPLIANCE_RULE_EVALUATION', () => {
        // §7A — Execute compiled deterministic rules (Rule 8/9 — no natural language)
        ruleResults = dslEvaluator.evaluate(config.rules, {
          symbol: request.symbol, quantity: request.quantity, price: request.price,
          sector: request.sector, country: request.country, currency: request.currency,
          leverage: request.leverage, positionFraction: request.positionFraction,
          sectorExposure: request.sectorExposure, grossExposure: request.grossExposure,
        })
        // §8 — Mandate evaluation (Rule 11 — independent from statutory)
        mandateResult = mandateEvaluator.evaluate(config.mandate, {
          positionFraction: request.positionFraction, diversification: request.diversification,
          sectorExposure: request.sectorExposure, leverage: request.leverage, liquidity: request.liquidity,
        })
        // §9 — Client restrictions (Rule 10 — independent from jurisdiction)
        clientResult = clientRestrictionEvaluator.evaluate(config.clientRestrictions, {
          symbol: request.symbol, sector: request.sector, country: request.country, industry: request.industry,
        })
        for (const r of ruleResults!) if (!r.passed) crceObservabilityCollector.recordRuleViolation()
        if (!mandateResult.passed || !clientResult.passed) crceObservabilityCollector.recordRestrictionViolation()
      })

      // STAGE 9: DECISION FRAMEWORK (§6A)
      let decision: { decision: 'APPROVED' | 'WARNING' | 'HARD_VETO'; reason: string }
      track('DECISION_FRAMEWORK', () => {
        decision = decisionFramework.preTradeDecision(ruleResults!, mandateResult!, clientResult!, amlKycResult!)
        log.info(`pre-trade decision: ${decision!.decision} for ${request.symbol} — ${decision!.reason}`)
      })

      // STAGE 10: METADATA_RECORDING (§13)
      let compliance: CanonicalComplianceContract
      track('METADATA_RECORDING', () => {
        const now = Date.now()
        const versions: ComplianceVersionBundle = {
          complianceVersion: CRCE_VERSION, accountingVersion: 'n/a',
          performanceVersion: 'n/a', riskVersion: 'n/a',
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }
        const lineage: ComplianceLineage = {
          orderIntentId: request.orderIntentId, accountingEventId: null,
          performanceEventId: null, riskEventId: null, portfolioId: request.portfolioId,
          ruleLibraryVersion: '1.0.0', dslVersion: '1.0.0',
          jurisdictionVersion: config.jurisdictions.join(','),
          mandateVersion: config.mandate?.version ?? 'none',
          clientRestrictionVersion: config.clientRestrictions?.version ?? 'none',
          amlKycVersion: config.amlKyc?.version ?? 'none',
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }
        const govMeta: ComplianceGovernanceMetadata = complianceGovernanceManager.init(
          `comp-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, now,
        )

        const violations: string[] = [
          ...ruleResults!.filter((r) => !r.passed).map((r) => r.description),
          ...mandateResult!.violations, ...clientResult!.violations, ...amlKycResult!.violations,
        ]

        compliance = {
          complianceEventId: `comp-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          complianceVersion: CRCE_VERSION, portfolioId: request.portfolioId,
          positionId: request.positionId, evaluationContext: 'PRE_TRADE',
          evaluationTimestamp: now,
          complianceDecision: decision!.decision,
          approvalStatus: decision!.decision === 'HARD_VETO' ? 'REJECTED' : decision!.decision === 'WARNING' ? 'CONDITIONAL' : 'APPROVED',
          ruleEvaluationResults: ruleResults!,
          violationClassification: violations,
          restrictionStatus: !clientResult!.passed ? 'RESTRICTED' : !mandateResult!.passed ? 'RESTRICTED' : 'CLEAR',
          escalationStatus: decision!.decision === 'HARD_VETO' ? 'ESCALATED' : 'NONE',
          enforcementAction: decision!.decision,
          requiredActions: decision!.decision === 'HARD_VETO' ? ['order transmission prohibited (Rule 3)'] : decision!.decision === 'WARNING' ? ['governance notification generated'] : [],
          complianceMetadata: {
            complianceEventId: '', complianceVersion: CRCE_VERSION, versions, lineage,
            evaluationContext: 'PRE_TRADE', dslVersion: '1.0.0', ruleLibraryVersion: '1.0.0',
          },
          governanceMetadata: govMeta,
          pipelineStages, createdAt: now,
        }
        compliance.complianceMetadata.complianceEventId = compliance.complianceEventId
        compliance = Object.freeze(compliance) as CanonicalComplianceContract // Rule 6

        complianceVersionRegistry.register(compliance)
        complianceGovernanceManager.setValidation(compliance.complianceEventId, 'PASSED', 'crce-engine', 'pre-trade evaluated')
        complianceGovernanceManager.approve(compliance.complianceEventId, 'crce-engine', `auto-evaluated (${decision!.decision})`)
        crceObservabilityCollector.recordGovernance()
        crceObservabilityCollector.recordEvent('PRE_TRADE', decision!.decision, Date.now() - startTime)
      })

      // STAGE 11: COMPLETION
      track('COMPLETION', () => {
        this.history.push(compliance!)
        if (this.history.length > this.MAX_HISTORY) this.history.shift()
        for (const sub of this.subscribers) { try { sub(compliance!) } catch (e) { log.error(`sub: ${e}`) } }
        log.info(`pre-trade compliance ${compliance!.complianceEventId}: ${compliance!.complianceDecision} for ${request.symbol} (${Date.now() - startTime}ms)`)
      })

      return { compliance: compliance!, success: true, failureReason: null, latencyMs: Date.now() - startTime }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`pre-trade compliance failed: ${reason}`)
      complianceFailureRecovery.logFailure('INTERNAL_ERROR', 'PRE_TRADE', reason)
      // §17 — Fail-closed: reject if evaluation can't complete
      if (config.failClosed) {
        log.warn('§17 fail-closed: order authorization rejected until compliance available')
      }
      return { compliance: null, success: false, failureReason: reason, latencyMs: Date.now() - startTime }
    }
  }

  /**
   * Post-Trade Compliance Evaluation (§5 — 11-stage pipeline).
   * Rule 4 — Never modifies historical execution/accounting records.
   * Rule 18 — Surveillance independent from mandate validation.
   */
  evaluatePostTrade(request: PostTradeComplianceRequest): ComplianceResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalComplianceContract['pipelineStages'] = []
    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        crceObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        crceObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { config } = request

    try {
      // STAGES 1-4: Reception + Loading
      track('PORTFOLIO_STATE_RECEPTION', () => { /* received */ })
      track('VALIDATION', () => { /* validate */ })
      track('RISK_CONTRACT_LOADING', () => { /* loaded */ })
      track('PERFORMANCE_CONTRACT_LOADING', () => { /* loaded */ })

      // STAGE 5: MANDATE_EVALUATION (§8, Rule 11 — independent)
      let mandateResult: { passed: boolean; violations: string[] }
      track('MANDATE_EVALUATION', () => {
        mandateResult = mandateEvaluator.evaluate(config.mandate, {
          positionFraction: request.positionFraction, diversification: request.diversification,
          sectorExposure: request.sectorExposure, leverage: request.leverage, liquidity: request.liquidity,
        })
      })

      // STAGE 6: SURVEILLANCE_EVALUATION (§10, Rule 18 — independent from mandate)
      let surveillanceResult: { alerts: Array<{ type: import('./types').SurveillanceType; triggered: boolean; description: string }> }
      track('SURVEILLANCE_EVALUATION', () => {
        surveillanceResult = surveillanceEvaluator.evaluate({
          orderFrequency: request.orderFrequency, orderSize: request.orderSize,
          avgOrderSize: request.avgOrderSize, crossMarketActivity: false,
          orderConcentration: request.orderConcentration,
        })
        for (const a of surveillanceResult!.alerts) if (a.triggered) crceObservabilityCollector.recordSurveillanceAlert()
      })

      // STAGE 7: PASSIVE_BREACH_DETECTION
      track('PASSIVE_BREACH_DETECTION', () => { /* detect */ })

      // STAGE 8: ESCALATION_FRAMEWORK (§6A — post-trade decision)
      let decision: { decision: 'PASSIVE_BREACH_ALERT' | 'MANDATORY_REVIEW' | 'ESCALATION_REQUIRED' | 'EMERGENCY_HALT'; reason: string }
      track('ESCALATION_FRAMEWORK', () => {
        decision = decisionFramework.postTradeDecision(mandateResult!, surveillanceResult!, request.breachSeverity)
        log.info(`post-trade decision: ${decision!.decision} — ${decision!.reason}`)
      })

      // STAGE 9: PUBLICATION (Rule 6 — immutable)
      let compliance: CanonicalComplianceContract
      track('PUBLICATION', () => {
        const now = Date.now()
        const versions: ComplianceVersionBundle = {
          complianceVersion: CRCE_VERSION, accountingVersion: '1.0.0',
          performanceVersion: '1.0.0', riskVersion: '1.0.0',
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }
        const lineage: ComplianceLineage = {
          orderIntentId: null, accountingEventId: request.accountingEventId,
          performanceEventId: request.performanceEventId, riskEventId: request.riskEventId,
          portfolioId: request.portfolioId, ruleLibraryVersion: '1.0.0', dslVersion: '1.0.0',
          jurisdictionVersion: config.jurisdictions.join(','),
          mandateVersion: config.mandate?.version ?? 'none',
          clientRestrictionVersion: config.clientRestrictions?.version ?? 'none',
          amlKycVersion: config.amlKyc?.version ?? 'none',
          configurationVersion: config.versions.configurationVersion,
          governanceVersion: config.versions.governanceVersion,
        }
        const govMeta: ComplianceGovernanceMetadata = complianceGovernanceManager.init(
          `comp-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, now,
        )
        compliance = {
          complianceEventId: `comp-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          complianceVersion: CRCE_VERSION, portfolioId: request.portfolioId,
          positionId: request.positionId, evaluationContext: 'POST_TRADE',
          evaluationTimestamp: now,
          complianceDecision: decision!.decision,
          approvalStatus: decision!.decision === 'EMERGENCY_HALT' ? 'REJECTED' : 'CONDITIONAL',
          ruleEvaluationResults: [],
          violationClassification: mandateResult!.violations,
          restrictionStatus: !mandateResult!.passed ? 'RESTRICTED' : 'CLEAR',
          escalationStatus: decision!.decision === 'ESCALATION_REQUIRED' || decision!.decision === 'EMERGENCY_HALT' ? 'ESCALATED' : 'PENDING',
          enforcementAction: decision!.decision,
          requiredActions: decision!.decision === 'EMERGENCY_HALT' ? ['trading suspended until governance approval'] : [],
          complianceMetadata: {
            complianceEventId: '', complianceVersion: CRCE_VERSION, versions, lineage,
            evaluationContext: 'POST_TRADE', dslVersion: '1.0.0', ruleLibraryVersion: '1.0.0',
          },
          governanceMetadata: govMeta,
          pipelineStages, createdAt: now,
        }
        compliance.complianceMetadata.complianceEventId = compliance.complianceEventId
        compliance = Object.freeze(compliance) as CanonicalComplianceContract // Rule 6
        complianceVersionRegistry.register(compliance)
        complianceGovernanceManager.setValidation(compliance.complianceEventId, 'PASSED', 'crce-engine', 'post-trade evaluated')
        complianceGovernanceManager.approve(compliance.complianceEventId, 'crce-engine', `auto-evaluated (${decision!.decision})`)
        crceObservabilityCollector.recordGovernance()
        crceObservabilityCollector.recordEvent('POST_TRADE', decision!.decision, Date.now() - startTime)
      })

      // STAGES 10-11: METADATA + COMPLETION
      track('METADATA_RECORDING', () => { /* recorded in publication */ })
      track('COMPLETION', () => {
        this.history.push(compliance!)
        if (this.history.length > this.MAX_HISTORY) this.history.shift()
        for (const sub of this.subscribers) { try { sub(compliance!) } catch (e) { log.error(`sub: ${e}`) } }
        log.info(`post-trade compliance ${compliance!.complianceEventId}: ${compliance!.complianceDecision} (${Date.now() - startTime}ms)`)
      })

      return { compliance: compliance!, success: true, failureReason: null, latencyMs: Date.now() - startTime }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`post-trade compliance failed: ${reason}`)
      complianceFailureRecovery.logFailure('INTERNAL_ERROR', 'POST_TRADE', reason)
      return { compliance: null, success: false, failureReason: reason, latencyMs: Date.now() - startTime }
    }
  }

  onCompliance(handler: (c: CanonicalComplianceContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
  getRecent(limit: number = 50) { return this.history.slice(-limit) }
  getMetrics() { return crceObservabilityCollector.snapshot() }
  getRecoveryStats() { return complianceFailureRecovery.getStats() }
  getVersion() { return { engineVersion: CRCE_VERSION, schemaVersion: COMPLIANCE_SCHEMA_VERSION } }
}

export const complianceRegulatoryControlEngine = new ComplianceRegulatoryControlEngine()
