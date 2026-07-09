// CHAPTER 2.3 §19, §20 — Health Monitoring & Watchdogs
//
// Every execution unit continuously reports: state, latency, queue depth,
// memory, CPU, failures, restart count (§19). System health is continuously
// observable.
//
// Watchdogs (§20) supervise critical runtime components:
//   • exchange connectivity       • persistence responsiveness
//   • worker responsiveness       • pipeline progress
//   • snapshot completion
// Inactive components trigger recovery workflows.

import { createLogger, now } from '../domains/01-core-infrastructure'
import { faultTolerance } from './fault-tolerance'

const log = createLogger('watchdogs')

// ─────────────────────────────────────────────────────────────────────────────
// Health report  (Chapter 2.3 §19)
// ─────────────────────────────────────────────────────────────────────────────

export type ComponentState = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN'

export interface HealthReport {
  component: string
  state: ComponentState
  latencyMs: number | null
  queueDepth: number | null
  memoryBytes: number | null
  failureCount: number
  restartCount: number
  lastHeartbeat: number
  lastStateChange: number
  message: string
}

type HeartbeatFn = () => Promise<HealthReport>

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog  (Chapter 2.3 §20)
// ─────────────────────────────────────────────────────────────────────────────

interface WatchdogConfig {
  /** Max time since last heartbeat before marking unhealthy (§20). */
  heartbeatTimeoutMs: number
  /** Check interval. */
  checkIntervalMs: number
  /** Failures before triggering recovery. */
  failureThreshold: number
}

interface WatchdogEntry {
  name: string
  config: WatchdogConfig
  heartbeatFn: HeartbeatFn
  lastReport: HealthReport | null
  consecutiveFailures: number
  timer: ReturnType<typeof setInterval> | null
  recovering: boolean
}

class WatchdogSystem {
  private watchdogs = new Map<string, WatchdogEntry>()
  private subscribers = new Set<(report: HealthReport) => void>()

  /** Register a watchdog for a critical component (§20). */
  register(name: string, config: WatchdogConfig, heartbeatFn: HeartbeatFn): void {
    const entry: WatchdogEntry = {
      name,
      config,
      heartbeatFn,
      lastReport: null,
      consecutiveFailures: 0,
      timer: null,
      recovering: false,
    }
    this.watchdogs.set(name, entry)
    log.info(`watchdog registered: ${name} (timeout ${config.heartbeatTimeoutMs}ms, check every ${config.checkIntervalMs}ms)`)
  }

  /** Start all registered watchdogs. */
  start(): void {
    for (const [name, entry] of this.watchdogs) {
      if (entry.timer) continue
      entry.timer = setInterval(() => void this.check(name), entry.config.checkIntervalMs)
      // Immediate first check
      void this.check(name)
    }
    log.info(`watchdog system started — ${this.watchdogs.size} components supervised`)
  }

  stop(): void {
    for (const entry of this.watchdogs.values()) {
      if (entry.timer) {
        clearInterval(entry.timer)
        entry.timer = null
      }
    }
    log.info('watchdog system stopped')
  }

  /** Run a single heartbeat check (§20). */
  private async check(name: string): Promise<void> {
    const entry = this.watchdogs.get(name)
    if (!entry || entry.recovering) return

    try {
      const report = await entry.heartbeatFn()
      entry.lastReport = report
      entry.consecutiveFailures = 0

      // Heartbeat staleness check (§20 — inactive components)
      const staleness = now() - report.lastHeartbeat
      if (staleness > entry.config.heartbeatTimeoutMs) {
        report.state = 'UNHEALTHY'
        report.message = `Heartbeat stale by ${staleness}ms (timeout ${entry.config.heartbeatTimeoutMs}ms)`
      }

      if (report.state !== 'HEALTHY') {
        entry.consecutiveFailures++
        if (entry.consecutiveFailures >= entry.config.failureThreshold) {
          this.triggerRecovery(name, entry, report.message)
        }
      }

      for (const sub of this.subscribers) sub(report)
    } catch (e) {
      entry.consecutiveFailures++
      const msg = e instanceof Error ? e.message : String(e)
      log.warn(`watchdog "${name}" heartbeat failed (${entry.consecutiveFailures}/${entry.config.failureThreshold}): ${msg}`)
      if (entry.consecutiveFailures >= entry.config.failureThreshold) {
        this.triggerRecovery(name, entry, `Heartbeat check threw: ${msg}`)
      }
    }
  }

  /** Trigger recovery workflow for an inactive component (§20). */
  private triggerRecovery(name: string, entry: WatchdogEntry, reason: string): void {
    entry.recovering = true
    log.error(`watchdog "${name}" triggering RECOVERY: ${reason}`)
    faultTolerance.reportFailure(name, 'RECOVERABLE', reason)
    // The fault-tolerance manager handles the 5-stage recovery (§18).
    // Reset the recovery flag after a cooldown so the watchdog can re-detect.
    setTimeout(() => {
      entry.recovering = false
      entry.consecutiveFailures = 0
    }, 30_000)
  }

  /** Subscribe to all health reports (§19 observability). */
  onHealthReport(handler: (report: HealthReport) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Get the latest health report for a component. */
  getHealth(name: string): HealthReport | null {
    return this.watchdogs.get(name)?.lastReport ?? null
  }

  /** Get all latest health reports (§19 — system health continuously observable). */
  getAllHealth(): HealthReport[] {
    const out: HealthReport[] = []
    for (const entry of this.watchdogs.values()) {
      if (entry.lastReport) out.push(entry.lastReport)
    }
    return out
  }

  /** Overall system health summary (§19). */
  getSystemHealth(): {
    totalComponents: number
    healthy: number
    degraded: number
    unhealthy: number
    unknown: number
    overallState: ComponentState
  } {
    let healthy = 0, degraded = 0, unhealthy = 0, unknown = 0
    for (const entry of this.watchdogs.values()) {
      const state = entry.lastReport?.state ?? 'UNKNOWN'
      if (state === 'HEALTHY') healthy++
      else if (state === 'DEGRADED') degraded++
      else if (state === 'UNHEALTHY') unhealthy++
      else unknown++
    }
    const total = this.watchdogs.size
    const overallState: ComponentState =
      unhealthy > 0 ? 'UNHEALTHY' : degraded > 0 ? 'DEGRADED' : healthy === total ? 'HEALTHY' : 'UNKNOWN'
    return { totalComponents: total, healthy, degraded, unhealthy, unknown, overallState }
  }
}

export const watchdogs = new WatchdogSystem()
