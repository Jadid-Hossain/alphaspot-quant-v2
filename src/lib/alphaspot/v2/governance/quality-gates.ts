// CHAPTER 2.4 §22, §24 — Quality Gates & Engineering Constitution
//
// No component enters production unless it satisfies (§22):
//   Architecture Review → Static Analysis → Automated Tests →
//   Integration Validation → Performance Validation → Documentation Review →
//   Approval
//
// The Engineering Constitution (§24) — 10 overriding principles that every
// future implementation must respect. These override implementation convenience.

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('quality-gates')

// ─────────────────────────────────────────────────────────────────────────────
// Quality gates  (Chapter 2.4 §22)
// ─────────────────────────────────────────────────────────────────────────────

export type QualityGate =
  | 'ARCHITECTURE_REVIEW'
  | 'STATIC_ANALYSIS'
  | 'AUTOMATED_TESTS'
  | 'INTEGRATION_VALIDATION'
  | 'PERFORMANCE_VALIDATION'
  | 'DOCUMENTATION_REVIEW'
  | 'APPROVAL'

export const QUALITY_GATES: QualityGate[] = [
  'ARCHITECTURE_REVIEW',
  'STATIC_ANALYSIS',
  'AUTOMATED_TESTS',
  'INTEGRATION_VALIDATION',
  'PERFORMANCE_VALIDATION',
  'DOCUMENTATION_REVIEW',
  'APPROVAL',
]

export interface GateResult {
  gate: QualityGate
  passed: boolean
  evaluatedAt: number
  notes: string
  evaluator: string
}

export interface ComponentReadiness {
  componentName: string
  domain: string
  results: GateResult[]
  ready: boolean
  evaluatedAt: number
}

class QualityGateSystem {
  private components = new Map<string, ComponentReadiness>()
  private subscribers = new Set<(readiness: ComponentReadiness) => void>()

  /** Register a component for quality-gate evaluation (§22). */
  evaluate(domain: string, componentName: string, results: Omit<GateResult, 'evaluatedAt'>[]): ComponentReadiness {
    const fullResults: GateResult[] = results.map((r) => ({ ...r, evaluatedAt: Date.now() }))
    const ready = QUALITY_GATES.every((gate) => fullResults.find((r) => r.gate === gate && r.passed))
    const readiness: ComponentReadiness = { componentName, domain, results: fullResults, ready, evaluatedAt: Date.now() }
    this.components.set(`${domain}:${componentName}`, readiness)
    log.info(`quality gates evaluated: ${domain}/${componentName} — ${ready ? 'READY' : 'NOT READY'} (${fullResults.filter((r) => r.passed).length}/${QUALITY_GATES.length} passed)`)
    for (const sub of this.subscribers) sub(readiness)
    return readiness
  }

  /** Check if a component passed all gates (§22 — no production without it). */
  isReady(domain: string, componentName: string): boolean {
    return this.components.get(`${domain}:${componentName}`)?.ready ?? false
  }

  /** Assert a component is ready (defensive — blocks production deployment). */
  assertReady(domain: string, componentName: string): void {
    if (!this.isReady(domain, componentName)) {
      throw new Error(
        `[quality-gates] BLOCKED: component "${domain}/${componentName}" has not passed all quality gates (§22) — cannot enter production`,
      )
    }
  }

  getReadiness(domain: string, componentName: string): ComponentReadiness | undefined {
    return this.components.get(`${domain}:${componentName}`)
  }

  listAll(): ComponentReadiness[] {
    return Array.from(this.components.values())
  }

  subscribe(handler: (readiness: ComponentReadiness) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const qualityGates = new QualityGateSystem()

// ─────────────────────────────────────────────────────────────────────────────
// Documentation requirements  (Chapter 2.4 §14)
// Every public module documents: Purpose, Inputs, Outputs, Dependencies,
// Events Produced, Events Consumed, Failure Conditions, Performance Characteristics.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleDocumentation {
  moduleName: string
  domain: string
  purpose: string
  inputs: string[]
  outputs: string[]
  dependencies: string[]
  eventsProduced: string[]
  eventsConsumed: string[]
  failureConditions: string[]
  performanceCharacteristics: string
  documentedAt: number
}

class DocumentationRegistry {
  private docs = new Map<string, ModuleDocumentation>()

  /** Register module documentation (§14 — documentation is part of the implementation). */
  register(doc: Omit<ModuleDocumentation, 'documentedAt'>): void {
    const full: ModuleDocumentation = { ...doc, documentedAt: Date.now() }
    this.docs.set(`${doc.domain}:${doc.moduleName}`, full)
    log.debug(`documentation registered: ${doc.domain}/${doc.moduleName}`)
  }

  /** Get documentation for a module (§14). */
  get(domain: string, moduleName: string): ModuleDocumentation | undefined {
    return this.docs.get(`${domain}:${moduleName}`)
  }

  /** Assert a module is documented (defensive — §14). */
  assertDocumented(domain: string, moduleName: string): void {
    if (!this.docs.has(`${domain}:${moduleName}`)) {
      throw new Error(`[documentation] module "${domain}/${moduleName}" is not documented (§14 requires all public modules to be documented)`)
    }
  }

  list(): ModuleDocumentation[] {
    return Array.from(this.docs.values())
  }
}

export const documentation = new DocumentationRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// Engineering Constitution  (Chapter 2.4 §24)
// 10 overriding principles. These override implementation convenience.
// ─────────────────────────────────────────────────────────────────────────────

export const ENGINEERING_CONSTITUTION = [
  'Architectural boundaries.',
  'Single responsibility.',
  'Public contracts.',
  'Event-driven communication.',
  'Coordinated persistence.',
  'Immutable snapshots.',
  'Explainable recommendations.',
  'Reproducible predictions.',
  'Risk-first decision making.',
  'Continuous validation.',
] as const

export type ConstitutionPrinciple = (typeof ENGINEERING_CONSTITUTION)[number]

/** Assert a component complies with the constitution (§24). */
export function assertConstitutionCompliance(componentName: string, checks: Partial<Record<ConstitutionPrinciple, boolean>>): void {
  const violations = ENGINEERING_CONSTITUTION.filter((p) => checks[p] === false)
  if (violations.length > 0) {
    throw new Error(
      `[constitution] component "${componentName}" VIOLATES the following principles (§24):\n  - ${violations.join('\n  - ')}`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prohibited practices  (Chapter 2.4 §20)
// ─────────────────────────────────────────────────────────────────────────────

export const PROHIBITED_PRACTICES = [
  'hidden global state',
  'magic numbers',
  'duplicated business logic',
  'direct cross-domain access',
  'silent exception handling',
  'undocumented APIs',
  'hardcoded credentials',
  'bypassing validation',
  'bypassing risk controls',
  'bypassing architectural layers',
] as const

export type ProhibitedPractice = (typeof PROHIBITED_PRACTICES)[number]

/** Report a prohibited practice violation (§20). */
export function reportViolation(practice: ProhibitedPractice, component: string, details: string): void {
  log.error(`PROHIBITED PRACTICE (${practice}) in ${component}: ${details}`)
}
