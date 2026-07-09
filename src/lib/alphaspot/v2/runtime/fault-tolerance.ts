// CHAPTER 2.3 §17, §18, §23 — Fault Tolerance & Recovery
//
// Failures are categorized (§17):
//   TRANSIENT  — temporary network interruption, timeout, exchange outage
//   RECOVERABLE — worker restart, cache rebuild, API recovery
//   PERMANENT  — invalid configuration, corrupted data, unsupported schema
//
// Recovery stages (§18): Detect → Isolate → Recover → Validate → Resume
// Partial recovery is preferred over full restart.
//
// Graceful degradation (§23): capability reduction in stages, never full shutdown.
//   sentiment unavailable → continue without sentiment
//   model unavailable → use latest validated prediction
//   exchange disconnected → freeze recommendation publication
//   dashboard unavailable → continue backend processing

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('fault-tolerance')

// ─────────────────────────────────────────────────────────────────────────────
// Failure classification  (Chapter 2.3 §17)
// ─────────────────────────────────────────────────────────────────────────────

export type FailureCategory = 'TRANSIENT' | 'RECOVERABLE' | 'PERMANENT'

export interface Failure {
  id: string
  component: string
  category: FailureCategory
  message: string
  detectedAt: number
  recoveredAt: number | null
  recoveryAttempts: number
  status: 'DETECTED' | 'ISOLATED' | 'RECOVERING' | 'VALIDATING' | 'RESUMED' | 'PERMANENT_FAILURE'
}

// Recovery stages (Chapter 2.3 §18)
export type RecoveryStage = 'DETECT' | 'ISOLATE' | 'RECOVER' | 'VALIDATE' | 'RESUME'

const RECOVERY_ORDER: RecoveryStage[] = ['DETECT', 'ISOLATE', 'RECOVER', 'VALIDATE', 'RESUME']

// ─────────────────────────────────────────────────────────────────────────────
// Recovery policy per failure category  (Chapter 2.3 §17)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecoveryPolicy {
  maxAttempts: number
  backoffMs: number
  backoffMultiplier: number
  // On permanent failure, what capability to degrade
  degradeTo?: string
}

const RECOVERY_POLICIES: Record<FailureCategory, RecoveryPolicy> = {
  TRANSIENT: { maxAttempts: 5, backoffMs: 500, backoffMultiplier: 2, degradeTo: undefined },
  RECOVERABLE: { maxAttempts: 3, backoffMs: 2000, backoffMultiplier: 2, degradeTo: undefined },
  PERMANENT: { maxAttempts: 0, backoffMs: 0, backoffMultiplier: 1, degradeTo: 'degraded-mode' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful degradation registry  (Chapter 2.3 §23)
// ─────────────────────────────────────────────────────────────────────────────

export type Capability =
  | 'market-ingestion'
  | 'feature-engineering'
  | 'market-intelligence'
  | 'ml-inference'
  | 'sentiment'
  | 'portfolio-analysis'
  | 'risk-engine'
  | 'execution'
  | 'persistence'
  | 'presentation'
  | 'recommendation-publication'

export type CapabilityState = 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE'

interface CapabilityStatus {
  capability: Capability
  state: CapabilityState
  degradedReason: string | null
  degradedAt: number | null
  fallback: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Fault Tolerance Manager  (Chapter 2.3 §17, §18, §23)
// ─────────────────────────────────────────────────────────────────────────────

class FaultToleranceManager {
  private failures = new Map<string, Failure>()
  private recoveryHandlers = new Map<string, (failure: Failure) => Promise<boolean>>()
  private validationHandlers = new Map<string, (failure: Failure) => Promise<boolean>>()
  private capabilities = new Map<Capability, CapabilityStatus>()
  private failureSubscribers = new Set<(f: Failure) => void>()
  private recoverySubscribers = new Set<(f: Failure) => void>()
  private stats = {
    totalFailures: 0,
    recovered: 0,
    permanentFailures: 0,
    activeRecoveries: 0,
  }

  constructor() {
    // Initialize all capabilities as operational
    const allCaps: Capability[] = [
      'market-ingestion', 'feature-engineering', 'market-intelligence', 'ml-inference',
      'sentiment', 'portfolio-analysis', 'risk-engine', 'execution', 'persistence',
      'presentation', 'recommendation-publication',
    ]
    for (const cap of allCaps) {
      this.capabilities.set(cap, { capability: cap, state: 'OPERATIONAL', degradedReason: null, degradedAt: null, fallback: null })
    }
  }

  /** Report a failure (§17 — detect stage). */
  reportFailure(component: string, category: FailureCategory, message: string): Failure {
    const id = `fail-${component}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const failure: Failure = {
      id,
      component,
      category,
      message,
      detectedAt: Date.now(),
      recoveredAt: null,
      recoveryAttempts: 0,
      status: 'DETECTED',
    }
    this.failures.set(id, failure)
    this.stats.totalFailures++
    log.warn(`failure detected: [${category}] ${component}: ${message}`)
    for (const sub of this.failureSubscribers) sub(failure)

    // Kick off recovery asynchronously (§18)
    void this.recover(id).catch((e) => log.error(`recovery failed for ${id}: ${e instanceof Error ? e.message : String(e)}`))
    return failure
  }

  /** Register a recovery handler for a component (§18 — recover stage). */
  registerRecoveryHandler(component: string, handler: (f: Failure) => Promise<boolean>): void {
    this.recoveryHandlers.set(component, handler)
  }

  /** Register a validation handler for a component (§18 — validate stage). */
  registerValidationHandler(component: string, handler: (f: Failure) => Promise<boolean>): void {
    this.validationHandlers.set(component, handler)
  }

  /** Execute the 5-stage recovery model (§18): Detect → Isolate → Recover → Validate → Resume. */
  private async recover(failureId: string): Promise<void> {
    const failure = this.failures.get(failureId)
    if (!failure) return
    const policy = RECOVERY_POLICIES[failure.category]
    this.stats.activeRecoveries++

    try {
      // Stage 1: DETECT (already done at reportFailure)
      failure.status = 'DETECTED'

      // Stage 2: ISOLATE — mark the component's capability as degraded (§23)
      failure.status = 'ISOLATED'
      this.degradeCapability(this.componentToCapability(failure.component), `Isolated: ${failure.message}`)

      if (failure.category === 'PERMANENT' || policy.maxAttempts === 0) {
        // Permanent failure — stay degraded (§23 graceful degradation)
        failure.status = 'PERMANENT_FAILURE'
        this.stats.permanentFailures++
        log.error(`permanent failure: ${failure.component} — staying degraded. Reason: ${failure.message}`)
        return
      }

      // Stage 3: RECOVER — attempt with backoff retry (§17, §18)
      const handler = this.recoveryHandlers.get(failure.component)
      if (!handler) {
        log.warn(`no recovery handler for ${failure.component} — staying degraded`)
        return
      }

      let delay = policy.backoffMs
      for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
        failure.status = 'RECOVERING'
        failure.recoveryAttempts = attempt
        log.info(`recovery attempt ${attempt}/${policy.maxAttempts} for ${failure.component}`)
        try {
          const recovered = await handler(failure)
          if (recovered) {
            // Stage 4: VALIDATE (§18)
            failure.status = 'VALIDATING'
            const validator = this.validationHandlers.get(failure.component)
            const valid = validator ? await validator(failure) : true
            if (valid) {
              // Stage 5: RESUME (§18)
              failure.status = 'RESUMED'
              failure.recoveredAt = Date.now()
              this.restoreCapability(this.componentToCapability(failure.component))
              this.stats.recovered++
              log.info(`recovery SUCCESS for ${failure.component} after ${attempt} attempt(s)`)
              for (const sub of this.recoverySubscribers) sub(failure)
              return
            }
            log.warn(`recovery validated FALSE for ${failure.component} — retrying`)
          }
        } catch (e) {
          log.warn(`recovery attempt ${attempt} threw: ${e instanceof Error ? e.message : String(e)}`)
        }
        await new Promise((r) => setTimeout(r, delay))
        delay *= policy.backoffMultiplier
      }

      // Exhausted retries — stay degraded (§23)
      log.error(`recovery EXHAUSTED for ${failure.component} after ${policy.maxAttempts} attempts — staying degraded`)
    } finally {
      this.stats.activeRecoveries--
    }
  }

  /** Degrade a capability (§23 graceful degradation). */
  degradeCapability(cap: Capability, reason: string, fallback?: string): void {
    const status = this.capabilities.get(cap)
    if (!status) return
    status.state = 'DEGRADED'
    status.degradedReason = reason
    status.degradedAt = Date.now()
    status.fallback = fallback ?? null
    log.warn(`capability DEGRADED: ${cap} — ${reason}${fallback ? ` (fallback: ${fallback})` : ''}`)
  }

  /** Restore a capability to operational. */
  restoreCapability(cap: Capability): void {
    const status = this.capabilities.get(cap)
    if (!status) return
    status.state = 'OPERATIONAL'
    status.degradedReason = null
    status.degradedAt = null
    status.fallback = null
    log.info(`capability RESTORED: ${cap}`)
  }

  /** Mark a capability as fully unavailable (§23). */
  markUnavailable(cap: Capability, reason: string): void {
    const status = this.capabilities.get(cap)
    if (!status) return
    status.state = 'UNAVAILABLE'
    status.degradedReason = reason
    status.degradedAt = Date.now()
    log.error(`capability UNAVAILABLE: ${cap} — ${reason}`)
  }

  /** Check if a capability is operational (for graceful degradation checks). */
  isOperational(cap: Capability): boolean {
    return this.capabilities.get(cap)?.state === 'OPERATIONAL'
  }

  getCapabilityStatus(cap: Capability): CapabilityStatus | undefined {
    return this.capabilities.get(cap)
  }

  getAllCapabilities(): CapabilityStatus[] {
    return Array.from(this.capabilities.values())
  }

  onFailure(handler: (f: Failure) => void): () => void {
    this.failureSubscribers.add(handler)
    return () => this.failureSubscribers.delete(handler)
  }

  onRecovery(handler: (f: Failure) => void): () => void {
    this.recoverySubscribers.add(handler)
    return () => this.recoverySubscribers.delete(handler)
  }

  getActiveFailures(): Failure[] {
    return Array.from(this.failures.values()).filter((f) => f.status !== 'RESUMED' && f.status !== 'PERMANENT_FAILURE')
  }

  getStats() {
    return { ...this.stats, capabilities: this.getAllCapabilities() }
  }

  private componentToCapability(component: string): Capability {
    const map: Record<string, Capability> = {
      'market-gateway': 'market-ingestion',
      'market-data': 'market-ingestion',
      'feature-engineering': 'feature-engineering',
      'market-intelligence': 'market-intelligence',
      'machine-learning': 'ml-inference',
      'sentiment': 'sentiment',
      'portfolio-intelligence': 'portfolio-analysis',
      'risk-engine': 'risk-engine',
      'execution-engine': 'execution',
      'persistence': 'persistence',
      'presentation': 'presentation',
      'workflow-orchestrator': 'recommendation-publication',
    }
    return map[component] ?? 'persistence'
  }
}

export const faultTolerance = new FaultToleranceManager()
