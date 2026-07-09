// CHAPTER 2.4 §8 — Error Handling Policy
//
// Errors are classified into 5 categories, each with its own handling strategy
// (Chapter 2.4 §8). Errors must NEVER be silently ignored (§8, §20).
//
// Categories:
//   • Business Errors         — domain rule violations (e.g. ineligible asset)
//   • Infrastructure Errors   — runtime failures (e.g. worker crash, OOM)
//   • Configuration Errors    — invalid config (e.g. missing threshold)
//   • Validation Errors       — bad input data (e.g. malformed candle)
//   • External Dependency Errors — exchange/API failures (e.g. WS disconnect)
//
// Each category has a distinct recovery policy and severity.

import { createLogger } from '../domains/01-core-infrastructure'
import { faultTolerance } from '../runtime/fault-tolerance'
import type { FailureCategory } from '../runtime/fault-tolerance'

const log = createLogger('error-handling')

// ─────────────────────────────────────────────────────────────────────────────
// Error classification  (Chapter 2.4 §8)
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | 'BUSINESS'
  | 'INFRASTRUCTURE'
  | 'CONFIGURATION'
  | 'VALIDATION'
  | 'EXTERNAL_DEPENDENCY'

export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface ClassifiedError {
  id: string
  category: ErrorCategory
  severity: ErrorSeverity
  component: string
  message: string
  cause?: unknown
  timestamp: number
  recoverable: boolean
  recoveryAction: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Category-specific handling strategies  (Chapter 2.4 §8)
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorStrategy {
  severity: ErrorSeverity
  recoverable: boolean
  recoveryAction: string
  // Maps to fault-tolerance FailureCategory for the recovery pipeline (Ch 2.3 §17)
  ftCategory: FailureCategory
}

const STRATEGIES: Record<ErrorCategory, ErrorStrategy> = {
  BUSINESS: {
    severity: 'LOW',
    recoverable: false,
    recoveryAction: 'Log and skip — business rule violation is deterministic, no retry needed',
    ftCategory: 'PERMANENT',
  },
  INFRASTRUCTURE: {
    severity: 'HIGH',
    recoverable: true,
    recoveryAction: 'Report to fault-tolerance for 5-stage recovery (worker restart / cache rebuild)',
    ftCategory: 'RECOVERABLE',
  },
  CONFIGURATION: {
    severity: 'CRITICAL',
    recoverable: false,
    recoveryAction: 'Halt affected component — config errors require manual fix (§6)',
    ftCategory: 'PERMANENT',
  },
  VALIDATION: {
    severity: 'MEDIUM',
    recoverable: false,
    recoveryAction: 'Reject the input — log with context, do not retry (bad data stays bad)',
    ftCategory: 'PERMANENT',
  },
  EXTERNAL_DEPENDENCY: {
    severity: 'HIGH',
    recoverable: true,
    recoveryAction: 'Report as TRANSIENT — backoff retry, degrade capability if exhausted (§23)',
    ftCategory: 'TRANSIENT',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed error classes  (strongly typed — §17, §9)
// ─────────────────────────────────────────────────────────────────────────────

export class AlphaSpotError extends Error {
  readonly category: ErrorCategory
  readonly severity: ErrorSeverity
  readonly component: string
  readonly recoverable: boolean
  readonly recoveryAction: string
  readonly cause?: unknown

  constructor(category: ErrorCategory, component: string, message: string, cause?: unknown) {
    super(message)
    this.name = `AlphaSpot${category.charAt(0)}${category.slice(1).toLowerCase()}Error`
    this.category = category
    this.component = component
    this.cause = cause
    const strategy = STRATEGIES[category]
    this.severity = strategy.severity
    this.recoverable = strategy.recoverable
    this.recoveryAction = strategy.recoveryAction
  }

  toClassified(): ClassifiedError {
    return {
      id: `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      category: this.category,
      severity: this.severity,
      component: this.component,
      message: this.message,
      cause: this.cause,
      timestamp: Date.now(),
      recoverable: this.recoverable,
      recoveryAction: this.recoveryAction,
    }
  }
}

export class BusinessError extends AlphaSpotError {
  constructor(component: string, message: string, cause?: unknown) {
    super('BUSINESS', component, message, cause)
  }
}
export class InfrastructureError extends AlphaSpotError {
  constructor(component: string, message: string, cause?: unknown) {
    super('INFRASTRUCTURE', component, message, cause)
  }
}
export class ConfigurationError extends AlphaSpotError {
  constructor(component: string, message: string, cause?: unknown) {
    super('CONFIGURATION', component, message, cause)
  }
}
export class ValidationError extends AlphaSpotError {
  constructor(component: string, message: string, cause?: unknown) {
    super('VALIDATION', component, message, cause)
  }
}
export class ExternalDependencyError extends AlphaSpotError {
  constructor(component: string, message: string, cause?: unknown) {
    super('EXTERNAL_DEPENDENCY', component, message, cause)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error handler  (Chapter 2.4 §8 — never silently ignored)
// ─────────────────────────────────────────────────────────────────────────────

class ErrorHandler {
  private history: ClassifiedError[] = []
  private readonly historyLimit = 1000
  private subscribers = new Set<(err: ClassifiedError) => void>()
  private stats: Record<ErrorCategory, number> = {
    BUSINESS: 0, INFRASTRUCTURE: 0, CONFIGURATION: 0, VALIDATION: 0, EXTERNAL_DEPENDENCY: 0,
  }

  /** Handle a classified error per its category strategy (§8). */
  handle(error: AlphaSpotError): ClassifiedError {
    const classified = error.toClassified()
    this.stats[classified.category]++
    this.history.push(classified)
    if (this.history.length > this.historyLimit) this.history.shift()

    // Log by severity (§8 — never silent)
    const fn = classified.severity === 'CRITICAL' ? log.error : classified.severity === 'HIGH' ? log.error : classified.severity === 'MEDIUM' ? log.warn : log.info
    fn(`[${classified.category}] ${classified.component}: ${classified.message} — ${classified.recoveryAction}`)

    // Route to fault-tolerance for recoverable errors (Ch 2.3 §17)
    if (classified.recoverable) {
      const strategy = STRATEGIES[classified.category]
      faultTolerance.reportFailure(classified.component, strategy.ftCategory, classified.message)
    }

    for (const sub of this.subscribers) sub(classified)
    return classified
  }

  /** Convenience: classify + handle a raw error. */
  handleRaw(category: ErrorCategory, component: string, message: string, cause?: unknown): ClassifiedError {
    return this.handle(new AlphaSpotError(category, component, message, cause))
  }

  /** Assert no silent swallowing — wrap async functions so errors are always handled. */
  async safe<T>(category: ErrorCategory, component: string, fn: () => Promise<T>, context?: string): Promise<T | undefined> {
    try {
      return await fn()
    } catch (e) {
      this.handleRaw(category, component, `${context ?? 'operation'} failed: ${e instanceof Error ? e.message : String(e)}`, e)
      return undefined
    }
  }

  subscribe(handler: (err: ClassifiedError) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  getHistory(limit = 100): ClassifiedError[] {
    return this.history.slice(-limit)
  }

  getStats(): Record<ErrorCategory, number> & { total: number } {
    const total = Object.values(this.stats).reduce((a, b) => a + b, 0)
    return { ...this.stats, total }
  }
}

export const errorHandler = new ErrorHandler()

// Re-export the strategy map for documentation/audit
export { STRATEGIES as ERROR_STRATEGIES }
