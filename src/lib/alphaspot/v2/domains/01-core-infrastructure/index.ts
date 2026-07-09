// DOMAIN 01 — CORE INFRASTRUCTURE  (Chapter 2.1 §4, Domain 01)
//
// Provides shared platform capabilities. Contains NO business logic.
// Every other domain depends on this.
//
// Responsibilities (Chapter 2.1 §4):
//   • configuration          • health checks
//   • dependency injection   • scheduling
//   • logging                • time synchronization
//   • metrics                • secrets management
//   • monitoring             • environment configuration
//
// FORBIDDEN: any business logic, any trading logic, any analysis.

import type { Asset } from '../../types'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformConfig {
  environment: 'development' | 'staging' | 'production'
  pipelineVersion: string
  allocatedCapital: number
  snapshotIntervalMs: number
  recommendationTtlMs: number
  constraints: {
    minHistoryBars: number
    minQuoteVolume24h: number
    maxSpreadPct: number
  }
  limits: {
    maxConcurrentBuyCandidates: number
    maxTotalPositionPct: number
    maxSingleTradeRiskPct: number
    minRewardToRisk: number
  }
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  environment: 'development',
  pipelineVersion: '2.0.0-ch2.1',
  allocatedCapital: 10_000,
  snapshotIntervalMs: 30_000,
  recommendationTtlMs: 15 * 60 * 1000,
  constraints: {
    minHistoryBars: 200,
    minQuoteVolume24h: 1_000_000,
    maxSpreadPct: 0.5,
  },
  limits: {
    maxConcurrentBuyCandidates: 8,
    maxTotalPositionPct: 0.6,
    maxSingleTradeRiskPct: 5,
    minRewardToRisk: 1.0,
  },
}

let activeConfig: PlatformConfig = { ...DEFAULT_PLATFORM_CONFIG }

export function getConfig(): PlatformConfig {
  return activeConfig
}

export function setConfig(patch: Partial<PlatformConfig>): PlatformConfig {
  activeConfig = { ...activeConfig, ...patch }
  return activeConfig
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  timestamp: number
  level: LogLevel
  domain: string
  message: string
  meta?: Record<string, unknown>
}

type LogSink = (entry: LogEntry) => void

const logSinks: LogSink[] = [
  (entry) => {
    const ts = new Date(entry.timestamp).toISOString()
    const prefix = `[${ts}] [${entry.domain}]`
    const fn = entry.level === 'ERROR' ? console.error : entry.level === 'WARN' ? console.warn : console.log
    fn(`${prefix} ${entry.level} ${entry.message}`)
  },
]

export function log(level: LogLevel, domain: string, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { timestamp: Date.now(), level, domain, message, meta }
  for (const sink of logSinks) sink(entry)
}

export function addLogSink(sink: LogSink): void {
  logSinks.push(sink)
}

// Domain-scoped logger factory (each domain gets its own tagged logger)
export function createLogger(domain: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => log('DEBUG', domain, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => log('INFO', domain, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('WARN', domain, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('ERROR', domain, msg, meta),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface Metric {
  name: string
  value: number
  unit: string
  timestamp: number
  tags?: Record<string, string>
}

type Gauge = (value: number, tags?: Record<string, string>) => void
type Counter = (tags?: Record<string, string>) => void
type Histogram = (value: number, tags?: Record<string, string>) => void

const gauges = new Map<string, Metric[]>()
const counters = new Map<string, number>()
const histograms = new Map<string, number[]>()

export function gauge(name: string, unit: string): Gauge {
  return (value, tags) => {
    const m: Metric = { name, value, unit, timestamp: Date.now(), tags }
    const arr = gauges.get(name) ?? []
    arr.push(m)
    if (arr.length > 1000) arr.shift()
    gauges.set(name, arr)
  }
}

export function counter(name: string): Counter {
  return (tags) => {
    const key = tags ? `${name}:${JSON.stringify(tags)}` : name
    counters.set(key, (counters.get(key) ?? 0) + 1)
  }
}

export function histogram(name: string): Histogram {
  return (value) => {
    const arr = histograms.get(name) ?? []
    arr.push(value)
    if (arr.length > 1000) arr.shift()
    histograms.set(name, arr)
  }
}

export function getMetricsSnapshot(): {
  gauges: Record<string, Metric | undefined>
  counters: Record<string, number>
  histograms: Record<string, { count: number; mean: number; p50: number; p95: number; p99: number }>
} {
  const gaugeSnapshot: Record<string, Metric | undefined> = {}
  for (const [name, arr] of gauges) gaugeSnapshot[name] = arr[arr.length - 1]

  const histSnapshot: Record<string, { count: number; mean: number; p50: number; p95: number; p99: number }> = {}
  for (const [name, arr] of histograms) {
    if (arr.length === 0) continue
    const sorted = [...arr].sort((a, b) => a - b)
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    histSnapshot[name] = {
      count: arr.length,
      mean,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    }
  }

  return { gauges: gaugeSnapshot, counters: Object.fromEntries(counters), histograms: histSnapshot }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Checks
// ─────────────────────────────────────────────────────────────────────────────

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'

export interface HealthCheckResult {
  domain: string
  status: HealthStatus
  message: string
  checkedAt: number
}

type HealthCheck = () => Promise<HealthCheckResult>

const healthChecks = new Map<string, HealthCheck>()

export function registerHealthCheck(domain: string, check: HealthCheck): void {
  healthChecks.set(domain, check)
}

export async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  for (const [domain, check] of healthChecks) {
    try {
      results.push(await check())
    } catch (e) {
      results.push({
        domain,
        status: 'UNHEALTHY',
        message: `Health check threw: ${e instanceof Error ? e.message : String(e)}`,
        checkedAt: Date.now(),
      })
    }
  }
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string
  name: string
  intervalMs: number
  lastRun: number | null
  nextRun: number
  running: boolean
}

const tasks = new Map<string, ScheduledTask>()
const taskFns = new Map<string, () => Promise<void>>()

/**
 * Schedule a recurring task. Returns a cancellation function.
 * The Workflow Orchestration domain uses this to drive the pipeline cycle.
 */
export function schedule(name: string, intervalMs: number, fn: () => Promise<void>): () => void {
  const id = `task-${name}-${Math.random().toString(36).slice(2, 8)}`
  const task: ScheduledTask = {
    id,
    name,
    intervalMs,
    lastRun: null,
    nextRun: Date.now(),
    running: false,
  }
  tasks.set(id, task)
  taskFns.set(id, fn)

  const timer = setInterval(async () => {
    const t = tasks.get(id)
    if (!t || t.running) return
    t.running = true
    t.lastRun = Date.now()
    try {
      await fn()
    } catch (e) {
      log('ERROR', 'core-infrastructure', `Scheduled task "${name}" failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      t.running = false
      t.nextRun = Date.now() + intervalMs
    }
  }, intervalMs)

  return () => {
    clearInterval(timer)
    tasks.delete(id)
    taskFns.delete(id)
  }
}

export function getScheduledTasks(): ScheduledTask[] {
  return Array.from(tasks.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// Time Synchronization
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current platform time in ms. Indirection allows for time mocking in tests. */
let timeProvider: () => number = () => Date.now()

export function now(): number {
  return timeProvider()
}

export function setTimeProvider(fn: () => number): void {
  timeProvider = fn
}

export function resetTimeProvider(): void {
  timeProvider = () => Date.now()
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets Management (stub — reads from env)
// ─────────────────────────────────────────────────────────────────────────────

export function getSecret(key: string): string | null {
  return process.env[key] ?? null
}

export function requireSecret(key: string): string {
  const v = getSecret(key)
  if (!v) throw new Error(`[core-infrastructure] Required secret "${key}" is not set`)
  return v
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment Configuration
// ─────────────────────────────────────────────────────────────────────────────

export function getEnvironment(): 'development' | 'staging' | 'production' {
  return (process.env.NODE_ENV as 'development' | 'staging' | 'production') ?? 'development'
}

export function isProduction(): boolean {
  return getEnvironment() === 'production'
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Injection registry
// Domains register their published interfaces here; consumers resolve them.
// This enforces loose coupling (Principle 4) — domains depend on contracts,
// not on concrete implementations.
// ─────────────────────────────────────────────────────────────────────────────

const registry = new Map<string, unknown>()

export function register<T>(token: string, instance: T): void {
  registry.set(token, instance)
}

export function resolve<T>(token: string): T {
  const instance = registry.get(token)
  if (!instance) throw new Error(`[core-infrastructure] No service registered for token "${token}"`)
  return instance as T
}

export function tryResolve<T>(token: string): T | null {
  return (registry.get(token) as T) ?? null
}

// DI tokens for every domain (typed contracts)
export const DI_TOKENS = {
  CONFIG: 'core.config',
  LOGGER: 'core.logger',
  MARKET_GATEWAY: 'domain.market-gateway',
  MARKET_DATA: 'domain.market-data',
  FEATURE_ENGINEERING: 'domain.feature-engineering',
  MARKET_INTELLIGENCE: 'domain.market-intelligence',
  MACHINE_LEARNING: 'domain.machine-learning',
  DECISION_ENGINE: 'domain.decision-engine',
  PORTFOLIO_INTELLIGENCE: 'domain.portfolio-intelligence',
  RISK_ENGINE: 'domain.risk-engine',
  EXECUTION_ENGINE: 'domain.execution-engine',
  PERSISTENCE: 'domain.persistence',
  RESEARCH_PLATFORM: 'domain.research-platform',
  PRESENTATION: 'domain.presentation',
  WORKFLOW_ORCHESTRATOR: 'domain.workflow-orchestrator',
} as const

// Re-export Asset type so consumers don't need to know the internal path
export type { Asset }
