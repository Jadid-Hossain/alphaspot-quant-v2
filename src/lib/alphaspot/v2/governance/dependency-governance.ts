// CHAPTER 2.4 §4 — Dependency Governance
//
// Software dependencies are strictly hierarchical. Higher-level domains may
// depend on lower-level services ONLY through public contracts (Chapter 2.4 §4).
//
// Forbidden (§4):
//   • circular dependencies
//   • bidirectional dependencies
//   • hidden dependencies
//   • runtime imports across architectural boundaries
//
// All dependencies must be EXPLICIT (§4).
//
// This module provides a dependency-graph registry that domains declare their
// dependencies against at startup. The registry can detect cycles and
// violations at runtime (and, in a future build step, at compile time).

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('dependency-governance')

// ─────────────────────────────────────────────────────────────────────────────
// Dependency declaration  (Chapter 2.4 §4 — explicit dependencies)
// ─────────────────────────────────────────────────────────────────────────────

export interface DependencyDeclaration {
  /** The domain that depends on something. */
  dependent: string
  /** The domain or service being depended upon. */
  dependency: string
  /** The public contract token used to access the dependency (§5). */
  contractToken: string
  /** Whether this is a hard (required) or soft (optional) dependency. */
  kind: 'required' | 'optional'
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency graph  (Chapter 2.4 §4 — hierarchical, no cycles)
// ─────────────────────────────────────────────────────────────────────────────

class DependencyGovernance {
  private declarations = new Set<DependencyDeclaration>()
  private adjacency = new Map<string, Set<string>>() // dependent → set of dependencies

  /** Declare an explicit dependency (§4 — all dependencies must be explicit). */
  declare(dep: DependencyDeclaration): void {
    const key = `${dep.dependent}->${dep.dependency}:${dep.contractToken}`
    if (this.declarations.has(key)) return
    this.declarations.add(dep)

    if (!this.adjacency.has(dep.dependent)) this.adjacency.set(dep.dependent, new Set())
    this.adjacency.get(dep.dependent)!.add(dep.dependency)
    log.debug(`dependency declared: ${dep.dependent} → ${dep.dependency} (${dep.kind}, via ${dep.contractToken})`)
  }

  /** Detect circular dependencies (§4 — forbidden). Returns cycles if found. */
  detectCycles(): string[][] {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const stack = new Set<string>()
    const path: string[] = []

    const dfs = (node: string): void => {
      if (stack.has(node)) {
        // Found a cycle — extract it from the path
        const cycleStart = path.indexOf(node)
        cycles.push([...path.slice(cycleStart), node])
        return
      }
      if (visited.has(node)) return
      visited.add(node)
      stack.add(node)
      path.push(node)
      for (const dep of this.adjacency.get(node) ?? []) dfs(dep)
      path.pop()
      stack.delete(node)
    }

    for (const node of this.adjacency.keys()) dfs(node)
    return cycles
  }

  /** Assert no cycles exist (call after all declarations at boot). */
  assertNoCycles(): void {
    const cycles = this.detectCycles()
    if (cycles.length > 0) {
      throw new Error(
        `[dependency-governance] CIRCULAR DEPENDENCY DETECTED (Chapter 2.4 §4 — forbidden):\n` +
          cycles.map((c) => `  ${c.join(' → ')}`).join('\n'),
      )
    }
    log.info(`dependency graph validated: ${this.declarations.size} declarations, no cycles`)
  }

  /** Check if a dependency path exists between two domains (forbidden check). */
  dependsOn(dependent: string, dependency: string): boolean {
    const visited = new Set<string>()
    const queue = [dependent]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (visited.has(node)) continue
      visited.add(node)
      const deps = this.adjacency.get(node)
      if (!deps) continue
      if (deps.has(dependency)) return true
      for (const d of deps) queue.push(d)
    }
    return false
  }

  /** Detect bidirectional dependencies (§4 — forbidden). */
  detectBidirectional(): Array<[string, string]> {
    const bidir: Array<[string, string]> = []
    for (const [dependent, deps] of this.adjacency) {
      for (const dep of deps) {
        const reverse = this.adjacency.get(dep)
        if (reverse?.has(dependent)) {
          bidir.push([dependent, dep])
        }
      }
    }
    return bidir
  }

  /** Assert no bidirectional dependencies. */
  assertNoBidirectional(): void {
    const bidir = this.detectBidirectional()
    if (bidir.length > 0) {
      throw new Error(
        `[dependency-governance] BIDIRECTIONAL DEPENDENCY DETECTED (§4 — forbidden):\n` +
          bidir.map(([a, b]) => `  ${a} ↔ ${b}`).join('\n'),
      )
    }
  }

  /** List all declarations (for audit / documentation §14). */
  list(): DependencyDeclaration[] {
    return Array.from(this.declarations)
  }

  /** Get the dependency tree for a domain (for documentation). */
  getDependencies(domain: string): DependencyDeclaration[] {
    return this.list().filter((d) => d.dependent === domain)
  }

  /** Validate the full graph — call after all declarations at boot. */
  validate(): { cycles: string[][]; bidirectional: Array<[string, string]>; valid: boolean } {
    const cycles = this.detectCycles()
    const bidirectional = this.detectBidirectional()
    return { cycles, bidirectional, valid: cycles.length === 0 && bidirectional.length === 0 }
  }
}

export const dependencyGovernance = new DependencyGovernance()

// ─────────────────────────────────────────────────────────────────────────────
// Canonical dependency declarations  (Chapter 2.4 §4 + Chapter 2.1 domain map)
// The hierarchical flow: higher domains depend on lower ones via contracts.
// ─────────────────────────────────────────────────────────────────────────────

export function declareCanonicalDependencies(): void {
  // Core infrastructure is depended on by all (but we don't declare those —
  // they're implicit platform capabilities, not business contracts).
  // Business-domain dependencies follow the Chapter 2.1 §6 flow:
  //   Gateway → Data → Features → Intelligence → ML → Decision → Portfolio → Risk → Execution → Presentation

  dependencyGovernance.declare({ dependent: 'market-data', dependency: 'market-gateway', contractToken: 'domain.market-gateway', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'feature-engineering', dependency: 'market-data', contractToken: 'domain.market-data', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'market-intelligence', dependency: 'feature-engineering', contractToken: 'domain.feature-engineering', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'machine-learning', dependency: 'feature-engineering', contractToken: 'domain.feature-engineering', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'machine-learning', dependency: 'market-intelligence', contractToken: 'domain.market-intelligence', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'decision-engine', dependency: 'machine-learning', contractToken: 'domain.machine-learning', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'decision-engine', dependency: 'market-intelligence', contractToken: 'domain.market-intelligence', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'portfolio-intelligence', dependency: 'decision-engine', contractToken: 'domain.decision-engine', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'risk-engine', dependency: 'portfolio-intelligence', contractToken: 'domain.portfolio-intelligence', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'execution-engine', dependency: 'risk-engine', contractToken: 'domain.risk-engine', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'presentation-layer', dependency: 'workflow-orchestrator', contractToken: 'domain.workflow-orchestrator', kind: 'required' })
  dependencyGovernance.declare({ dependent: 'workflow-orchestrator', dependency: 'execution-engine', contractToken: 'domain.execution-engine', kind: 'optional' })
  dependencyGovernance.declare({ dependent: 'research-platform', dependency: 'persistence', contractToken: 'domain.persistence', kind: 'required' })

  dependencyGovernance.assertNoCycles()
  dependencyGovernance.assertNoBidirectional()
  log.info(`canonical dependencies declared: ${dependencyGovernance.list().length} edges`)
}
