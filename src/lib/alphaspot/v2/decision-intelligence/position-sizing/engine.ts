// CHAPTER 5.5 §5 — Position Sizing Engine (PSE)
//
// §1 — The PSE is the EXCLUSIVE bridge between Risk Management (Ch 5.4) and
//      the Order Decision Engine. Transforms risk-approved portfolio allocations
//      into executable position sizes.
//
// §5 — 17-stage pipeline (no skips):
//   1.  RISK_CONTRACT_RECEPTION
//   2.  RISK_VALIDATION
//   3.  ATOMIC_CAPITAL_LOCK_ACQUISITION
//   4.  CAPITAL_AVAILABILITY_VERIFICATION
//   5.  CAPITAL_RESERVATION_VERIFICATION
//   6.  PRICE_FX_TRANSLATION
//   7.  POSITION_SIZING_METHOD_SELECTION
//   8.  POSITION_SIZE_CALCULATION
//   9.  VOLATILITY_ADJUSTMENT
//  10.  MATHEMATICAL_HARD_CAP_ENFORCEMENT
//  11.  EXCHANGE_CONSTRAINT_NORMALIZATION
//  12.  QUANTITY_CONSTRUCTION
//  13.  POSITION_VALIDATION
//  14.  CAPITAL_RESERVATION_COMMIT
//  15.  POSITION_PUBLICATION
//  16.  METADATA_RECORDING
//  17.  POSITION_COMPLETION
//
// §6 — Canonical Position Contract (Rule 4 — alternative formats prohibited).
// §7 — 12 Position Sizing Methods (Rule 23 — hard caps may reduce, never increase).
// §8 — Capital Management (Rule 13 — reserve before publish, Rule 17 — no double allocation,
//      Rule 21 — atomic lock, Rule 24 — transactional rollback).
// §9 — Exchange Normalization (Rule 10 — never enlarge, Rule 16 — nearest valid, Rule 19 — versioned).
// §11 — Position Versioning (Rule 5 immutable).
// §12 — Position Governance (Rule 11 — only approved enter Order Decision Engine).
// §16 — Failure Recovery (invalid NEVER published).
//
// 25 architectural rules enforced (see §17).

import { createLogger } from '../../domains/01-core-infrastructure'
import type { CanonicalRiskContract } from '../risk-management/types'
import type { AssetMetadata } from '../portfolio-construction/types'
import type {
  ApprovedAllocationInput,
  CanonicalPositionContract,
  CapitalReservation,
  ExchangeTradingRules,
  PositionGovernanceMetadata,
  PositionLineage,
  PositionMetadata,
  PositionSizingConfiguration,
  PositionSizingMethod,
  PositionVersionBundle,
} from './types'
import { PSE_VERSION, POSITION_CONTRACT_SCHEMA_VERSION } from './types'
import { sizingMethodRegistry, type SizingInput } from './methods'
import { exchangeNormalizer } from './exchange'
import { getCapitalManager, initializeCapitalManager } from './capital'
import { priceFXOracle } from './oracle'
import { positionStateManager, positionVersionRegistry, positionGovernanceManager } from './governance'
import { positionFailureRecovery, pseObservabilityCollector } from './recovery'

const log = createLogger('decision-intelligence:position-sizing:engine')

// ─────────────────────────────────────────────────────────────────────────────
// SizingRequest — input to size()
// ─────────────────────────────────────────────────────────────────────────────

export interface SizingRequest {
  /** Canonical Risk Contract (Rule 1 — only Ch 5.4 contracts). */
  riskContract: CanonicalRiskContract
  /** Approved allocation to size. */
  allocation: ApprovedAllocationInput
  /** Asset metadata. */
  assetMetadata: AssetMetadata
  /** Exchange trading rules. */
  exchangeRules: ExchangeTradingRules
  /** Position sizing configuration. */
  sizingConfig: PositionSizingConfiguration
  /** Total portfolio NAV. */
  totalNav: number
  /** Notional currency (e.g., 'USDT'). */
  notionalCurrency: string
}

// ─────────────────────────────────────────────────────────────────────────────
// SizingResult — output of size()
// ─────────────────────────────────────────────────────────────────────────────

export interface SizingResult {
  position: CanonicalPositionContract | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// PositionSizingEngine — main facade (§1)
// ─────────────────────────────────────────────────────────────────────────────

export class PositionSizingEngine {
  private positionHistory: CanonicalPositionContract[] = []
  private subscribers = new Set<(position: CanonicalPositionContract) => void>()
  private readonly MAX_HISTORY = 500

  /**
   * Initialize the capital manager (§8).
   */
  initializeCapital(totalCapital: number, reservationTimeoutMs: number = 30000): void {
    initializeCapitalManager(totalCapital, reservationTimeoutMs)
    log.info(`capital manager initialized: ${totalCapital} (timeout ${reservationTimeoutMs}ms)`)
  }

  /**
   * Size an approved allocation (§5 — 17-stage pipeline).
   *
   * Rule 1 — Only Canonical Risk Contracts (Ch 5.4) may enter.
   * Rule 4 — Output conforms to Canonical Position Contract.
   * Rule 8 — Never modifies the Risk Contract; only transforms to quantities.
   * Rule 11 — Only approved positions enter Order Decision Engine.
   * Rule 13 — Capital reservation before publication.
   * Rule 21 — Atomic capital lock before sizing.
   * Rule 23 — Hard caps may reduce, never increase.
   * Rule 24 — Transactional rollback on failure.
   */
  size(request: SizingRequest): SizingResult {
    const startTime = Date.now()
    const pipelineStages: CanonicalPositionContract['pipelineStages'] = []
    let atomicLockId: string | null = null
    let reservation: CapitalReservation | null = null
    const ownerId = `${request.riskContract.portfolioId}:${request.allocation.symbol}`

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        pseObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        pseObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    const { riskContract, allocation, assetMetadata, exchangeRules, sizingConfig, totalNav, notionalCurrency } = request

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STAGE 1: RISK_CONTRACT_RECEPTION (§5, Rule 1)
      // ─────────────────────────────────────────────────────────────────────
      track('RISK_CONTRACT_RECEPTION', () => {
        if (!riskContract || typeof riskContract !== 'object') {
          throw new Error('invalid risk contract')
        }
        if (riskContract.riskDecision !== 'APPROVED' && riskContract.riskDecision !== 'PARTIALLY_APPROVED') {
          throw new Error(`risk contract not approved (decision: ${riskContract.riskDecision})`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 2: RISK_VALIDATION (§5, Rule 8 — never modify)
      // ─────────────────────────────────────────────────────────────────────
      track('RISK_VALIDATION', () => {
        if (!riskContract.riskAssessmentId || !riskContract.portfolioId) {
          throw new Error('risk contract missing required fields')
        }
        // Verify allocation is in the approved list
        const approved = riskContract.approvedAllocations.find((a) => a.symbol === allocation.symbol)
        if (!approved) {
          throw new Error(`allocation ${allocation.symbol} not in approved allocations`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 3: ATOMIC_CAPITAL_LOCK_ACQUISITION (§5, Rule 21)
      // ─────────────────────────────────────────────────────────────────────
      track('ATOMIC_CAPITAL_LOCK_ACQUISITION', () => {
        if (sizingConfig.atomicLockingEnabled) {
          const capitalManager = getCapitalManager()
          atomicLockId = capitalManager.acquireAtomicLock(ownerId)
          if (atomicLockId === null) {
            throw new Error('failed to acquire atomic capital lock — concurrent sizing prevented (Rule 21)')
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 4: CAPITAL_AVAILABILITY_VERIFICATION (§5, §8)
      // ─────────────────────────────────────────────────────────────────────
      track('CAPITAL_AVAILABILITY_VERIFICATION', () => {
        const capitalManager = getCapitalManager()
        const state = capitalManager.getState()
        const required = totalNav * allocation.approvedWeight
        if (required > state.availableCapital - state.cashBuffer) {
          throw new Error(`insufficient capital: required ${required}, available ${state.availableCapital - state.cashBuffer}`)
        }
        // Check strategy budget
        if (!capitalManager.hasStrategyBudget(allocation.contributingStrategies[0] ?? ownerId, required)) {
          throw new Error(`strategy budget exceeded for ${allocation.contributingStrategies[0] ?? ownerId}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 5: CAPITAL_RESERVATION_VERIFICATION (§5, §8, Rule 17)
      // ─────────────────────────────────────────────────────────────────────
      track('CAPITAL_RESERVATION_VERIFICATION', () => {
        const capitalManager = getCapitalManager()
        const required = totalNav * allocation.approvedWeight
        reservation = capitalManager.reserveCapital(
          ownerId, required,
          `position sizing for ${allocation.symbol} (risk ${riskContract.riskAssessmentId})`,
          atomicLockId,
        )
        if (reservation === null) {
          throw new Error('failed to reserve capital — Rule 17 (no double allocation)')
        }
        positionStateManager.updateReservedCapital(required)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 6: PRICE_FX_TRANSLATION (§5, Rule 22)
      // ─────────────────────────────────────────────────────────────────────
      let price: number
      let priceEntry: ReturnType<typeof priceFXOracle.getPrice>
      let fxEntry: ReturnType<typeof priceFXOracle.getFXRate>
      let baseCurrency: string
      let quoteCurrency: string
      track('PRICE_FX_TRANSLATION', () => {
        priceEntry = priceFXOracle.getPrice(allocation.symbol)
        if (!priceEntry) {
          throw new Error(`no price available for ${allocation.symbol} (Rule 22 — approved oracle required)`)
        }
        price = priceEntry.price
        quoteCurrency = priceEntry.quoteCurrency
        baseCurrency = notionalCurrency

        // FX translation if notional currency differs from quote currency
        if (notionalCurrency !== quoteCurrency) {
          fxEntry = priceFXOracle.getFXRate(notionalCurrency, quoteCurrency)
          if (!fxEntry) {
            throw new Error(`no FX rate for ${notionalCurrency}→${quoteCurrency} (Rule 22)`)
          }
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 7: POSITION_SIZING_METHOD_SELECTION (§5, §7)
      // ─────────────────────────────────────────────────────────────────────
      let method: PositionSizingMethod
      track('POSITION_SIZING_METHOD_SELECTION', () => {
        const strategyId = allocation.contributingStrategies[0]
        method = sizingConfig.perStrategyMethod[strategyId] ?? sizingConfig.defaultMethod
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 8: POSITION_SIZE_CALCULATION (§5, §7, Rule 6, Rule 14)
      // ─────────────────────────────────────────────────────────────────────
      let sizingResult: ReturnType<typeof sizingMethodRegistry.get> extends infer O ? O extends { compute: (i: SizingInput) => infer R } | null ? R : never : never
      track('POSITION_SIZE_CALCULATION', () => {
        const executor = sizingMethodRegistry.get(method!)
        if (!executor) {
          throw new Error(`sizing method ${method} not registered`)
        }
        const input: SizingInput = {
          approvedWeight: allocation.approvedWeight,
          totalNav,
          price: price!,
          assetVolatility: assetMetadata.volatility,
          allocationRiskScore: allocation.allocationRiskScore,
          parameters: sizingConfig.methodParameters[method!] ?? sizingConfig.methodParameters[sizingConfig.defaultMethod],
          hardCaps: sizingConfig.hardCaps,
          strategyId: allocation.contributingStrategies[0] ?? ownerId,
        }
        sizingResult = executor.compute(input)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 9: VOLATILITY_ADJUSTMENT (§5)
      // ─────────────────────────────────────────────────────────────────────
      let adjustedCapital: number
      track('VOLATILITY_ADJUSTMENT', () => {
        // Adjust for volatility (higher vol → reduce position)
        const volAdjustment = 1 / (1 + assetMetadata.volatility * 0.5)
        adjustedCapital = sizingResult!.cappedCapital * volAdjustment
        // Rule 23 — never increase
        if (adjustedCapital > sizingResult!.cappedCapital) {
          adjustedCapital = sizingResult!.cappedCapital
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 10: MATHEMATICAL_HARD_CAP_ENFORCEMENT (§5, Rule 23)
      // ─────────────────────────────────────────────────────────────────────
      let hardCappedCapital: number
      let hardCapReason: string
      track('MATHEMATICAL_HARD_CAP_ENFORCEMENT', () => {
        // Already applied in sizing method, but double-check
        hardCappedCapital = Math.min(adjustedCapital!, sizingResult!.cappedCapital)
        hardCapReason = sizingResult!.hardCapApplied ? sizingResult!.hardCapReason : 'no hard cap applied'
        // Rule 23 — may reduce, never increase
        if (hardCappedCapital > totalNav * sizingConfig.hardCaps.maxPositionFraction) {
          hardCappedCapital = totalNav * sizingConfig.hardCaps.maxPositionFraction
          hardCapReason = `maxPositionFraction ${sizingConfig.hardCaps.maxPositionFraction} enforced`
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 11: EXCHANGE_CONSTRAINT_NORMALIZATION (§5, §9, Rule 10, Rule 16, Rule 19)
      // ─────────────────────────────────────────────────────────────────────
      let normalizationResult: ReturnType<typeof exchangeNormalizer.normalize>
      track('EXCHANGE_CONSTRAINT_NORMALIZATION', () => {
        // Translate capital to quantity
        const rawQuantity = price! > 0 ? hardCappedCapital! / price! : 0
        normalizationResult = exchangeNormalizer.normalize(
          rawQuantity, hardCappedCapital!, price!, exchangeRules,
        )
        pseObservabilityCollector.recordNormalization(normalizationResult.status)
        if (normalizationResult.status === 'REJECTED') {
          throw new Error(`exchange normalization rejected: ${normalizationResult.description}`)
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 12: QUANTITY_CONSTRUCTION (§5, Rule 9)
      // ─────────────────────────────────────────────────────────────────────
      let targetQuantity: number
      let finalCapital: number
      track('QUANTITY_CONSTRUCTION', () => {
        targetQuantity = normalizationResult!.normalizedQuantity
        finalCapital = normalizationResult!.normalizedCapital
        // Rule 9 — Capital allocation independent from quantity normalization
        // (capital is derived from quantity × price, not vice versa)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 13: POSITION_VALIDATION (§5, §16 — invalid NEVER published)
      // ─────────────────────────────────────────────────────────────────────
      track('POSITION_VALIDATION', () => {
        if (targetQuantity! <= 0) {
          throw new Error('invalid quantity — must be positive')
        }
        if (finalCapital! <= 0) {
          throw new Error('invalid capital — must be positive')
        }
        if (finalCapital! > reservation!.amount) {
          // Rule 10 — normalization reduced, so this should never happen
          // But if it does, reject
          throw new Error('capital exceeds reservation — Rule 10 violated')
        }
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 14: CAPITAL_RESERVATION_COMMIT (§5, Rule 13)
      // ─────────────────────────────────────────────────────────────────────
      track('CAPITAL_RESERVATION_COMMIT', () => {
        const capitalManager = getCapitalManager()
        // If normalization reduced capital, release the difference
        if (finalCapital! < reservation!.amount) {
          const difference = reservation!.amount - finalCapital!
          // Create a new reservation for the actual amount and release the original
          capitalManager.releaseReservation(reservation!.reservationId)
          reservation = capitalManager.reserveCapital(
            ownerId, finalCapital!,
            `committed position for ${allocation.symbol}`,
            atomicLockId,
          )
          if (reservation === null) {
            throw new Error('failed to commit reduced capital reservation')
          }
        }
        // Commit the reservation (Rule 13 — at position publication)
        capitalManager.commitReservation(reservation!.reservationId)
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 15: POSITION_PUBLICATION (§5, Rule 5 — immutable)
      // ─────────────────────────────────────────────────────────────────────
      let position: CanonicalPositionContract
      track('POSITION_PUBLICATION', () => {
        const now = Date.now()
        const versions: PositionVersionBundle = {
          positionVersion: PSE_VERSION,
          riskVersion: riskContract.riskVersion,
          portfolioVersion: riskContract.portfolioVersion,
          configurationVersion: sizingConfig.versions.configurationVersion,
          governanceVersion: sizingConfig.versions.governanceVersion,
        }

        const oracleSource = priceFXOracle.getSource()
        const lineage: PositionLineage = {
          riskAssessmentId: riskContract.riskAssessmentId,
          riskVersion: riskContract.riskVersion,
          portfolioId: riskContract.portfolioId,
          portfolioVersion: riskContract.portfolioVersion,
          allocationId: riskContract.portfolioId, // allocation ID from portfolio
          strategyDecisionIds: riskContract.riskMetadata.lineage.strategyDecisionIds,
          sizingMethodVersion: sizingResult!.methodVersion,
          exchangeRulesVersion: exchangeRules.version,
          priceOracleSource: oracleSource.source,
          priceOracleVersion: oracleSource.sourceVersion,
          fxOracleSource: fxEntry ? oracleSource.source : 'none',
          fxOracleVersion: fxEntry ? oracleSource.sourceVersion : 'none',
          configurationVersion: sizingConfig.versions.configurationVersion,
          governanceVersion: sizingConfig.versions.governanceVersion,
        }

        const positionMetadata: PositionMetadata = {
          positionId: `pos-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          positionVersion: PSE_VERSION,
          versions,
          lineage,
          sizingMethod: method!,
          sizingMethodVersion: sizingResult!.methodVersion,
          exchangeNormalizationStatus: normalizationResult!.status,
          capitalReservationStatus: 'COMMITTED',
        }

        const governanceMeta: PositionGovernanceMetadata = positionGovernanceManager.initialize(positionMetadata.positionId)

        position = {
          positionId: positionMetadata.positionId,
          positionVersion: PSE_VERSION,
          riskAssessmentId: riskContract.riskAssessmentId,
          portfolioId: riskContract.portfolioId,
          symbol: allocation.symbol,
          positionTimestamp: now,
          targetPositionSize: finalCapital!,
          targetQuantity: targetQuantity!,
          capitalAllocation: finalCapital!,
          estimatedNotionalValue: targetQuantity! * price!,
          lotSize: exchangeRules.minLotSize,
          tickSize: exchangeRules.tickSize,
          positionSizingMethod: method!,
          positionConfidence: sizingResult!.positionConfidence,
          exchangeNormalizationStatus: normalizationResult!.status,
          price: price!,
          quoteCurrency: quoteCurrency!,
          fxRate: fxEntry?.rate ?? 1.0,
          baseCurrency: baseCurrency!,
          capitalReservationId: reservation!.reservationId,
          capitalReservationStatus: 'COMMITTED',
          capitalAllocationPreNormalization: hardCappedCapital!,
          capitalAllocationPostNormalization: finalCapital!,
          normalizationDelta: finalCapital! - hardCappedCapital!,
          positionMetadata,
          governanceMetadata: governanceMeta,
          pipelineStages,
          createdAt: now,
        }

        position = Object.freeze(position) as CanonicalPositionContract // Rule 5
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 16: METADATA_RECORDING (§5, §12)
      // ─────────────────────────────────────────────────────────────────────
      track('METADATA_RECORDING', () => {
        positionVersionRegistry.register(position!)
        positionGovernanceManager.setValidationStatus(position!.positionId, 'PASSED', 'pse-engine', 'position validated')
        positionGovernanceManager.approve(position!.positionId, 'pse-engine', `auto-approved (method ${method})`)
        positionStateManager.transitionState('PUBLISHED', `position published: ${position!.positionId}`)
        pseObservabilityCollector.recordGovernanceEvent()

        // Record observability
        const capitalManager = getCapitalManager()
        pseObservabilityCollector.recordPosition(
          method!, finalCapital!, capitalManager.getUtilization(), Date.now() - startTime,
        )
      })

      // ─────────────────────────────────────────────────────────────────────
      // STAGE 17: POSITION_COMPLETION (§5)
      // ─────────────────────────────────────────────────────────────────────
      track('POSITION_COMPLETION', () => {
        this.positionHistory.push(position!)
        if (this.positionHistory.length > this.MAX_HISTORY) this.positionHistory.shift()

        // Release atomic lock (Rule 21 — released after publication)
        if (atomicLockId !== null) {
          getCapitalManager().releaseAtomicLock(ownerId)
        }

        for (const sub of this.subscribers) {
          try { sub(position!) } catch (e) { log.error(`subscriber failed: ${e instanceof Error ? e.message : String(e)}`) }
        }

        log.info(
          `position ${position!.positionId}: ${method} ${allocation.symbol} qty=${targetQuantity!.toFixed(6)} ` +
          `capital=${finalCapital!.toFixed(0)} price=${price!.toFixed(2)} norm=${normalizationResult!.status} ` +
          `(${Date.now() - startTime}ms)`,
        )
      })

      return {
        position: position!,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      log.error(`position sizing failed: ${reason}`)

      // Rule 24 — Transactional rollback on failure
      if (reservation !== null) {
        getCapitalManager().rollbackReservation(reservation.reservationId, reason)
      }
      if (atomicLockId !== null) {
        getCapitalManager().releaseAtomicLock(ownerId)
      }

      positionFailureRecovery.logFailure(
        null, 'INTERNAL_ERROR', 'POSITION_SIZING', reason, 'CAPITAL_ROLLBACK',
      )
      pseObservabilityCollector.recordRejection()

      return {
        position: null,
        success: false,
        failureReason: reason,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /** Subscribe to published positions. */
  onPosition(handler: (position: CanonicalPositionContract) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Get recent positions (Rule 5 — immutable). */
  getRecentPositions(limit: number = 50): CanonicalPositionContract[] {
    return this.positionHistory.slice(-limit)
  }

  /** Get observability metrics (§14). */
  getMetrics() {
    return pseObservabilityCollector.snapshot()
  }

  /** Get failure recovery stats (§16). */
  getRecoveryStats() {
    return positionFailureRecovery.getStats()
  }

  /** Check if a position is approved (Rule 11). */
  isApproved(positionId: string): boolean {
    return positionGovernanceManager.isApproved(positionId)
  }

  /** List available sizing methods (§7). */
  listSizingMethods(): PositionSizingMethod[] {
    return sizingMethodRegistry.listMethods()
  }

  /** Get engine version. */
  getVersion() {
    return {
      engineVersion: PSE_VERSION,
      schemaVersion: POSITION_CONTRACT_SCHEMA_VERSION,
    }
  }
}

// Singleton engine
export const positionSizingEngine = new PositionSizingEngine()
