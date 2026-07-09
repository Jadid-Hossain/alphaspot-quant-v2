// CHAPTER 2.2 §5, §6, §17, §18, §19 — Workflow Orchestrator
//
// Coordinates execution. Owns:
//   • pipeline scheduling       • duplicate prevention
//   • execution ordering        • snapshot coordination
//   • dependency coordination   • workload prioritization
//   • timeout handling          • observability
//   • retry scheduling
//
// The Workflow Orchestrator performs NO business logic (Chapter 2.2 §5):
//   NO market analysis, NO feature engineering, NO prediction, NO ranking,
//   NO portfolio management, NO risk analysis. It COORDINATES ONLY.
//
// Pipeline execution model (Chapter 2.2 §6) — canonical sequence, no skips:
//   Market Gateway → Market Data → Feature Engineering → Market Intelligence
//   → Machine Learning → Decision Engine → Portfolio Intelligence → Risk Engine
//   → Snapshot Builder → Recommendation Publisher → Presentation

import { createLogger, schedule, now } from '../domains/01-core-infrastructure'
import { publish, EVENT_TYPES } from './catalog'
import { snapshotRegistry, type SnapshotRecord } from './snapshot-lifecycle'
import { beginCorrelation, bindSnapshot, endCorrelation, getCorrelation } from './idempotency'
import type { EventPriority } from './transport'

const log = createLogger('workflow-orchestrator')

// ─────────────────────────────────────────────────────────────────────────────
// Stage definitions  (Chapter 2.2 §6 — canonical sequence)
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineStageDef {
  name: string
  domain: string
  priority: EventPriority
  timeoutMs: number
  maxRetries: number
  /** The stage executor. Returns its output (to pass to the next stage). */
  execute: (ctx: OrchestratorContext) => Promise<unknown>
}

export interface OrchestratorContext {
  correlationId: string
  snapshotId: string
  snapshotVersion: number
  /** Outputs from previous stages, keyed by stage name. */
  stageOutputs: Record<string, unknown>
  /** Mutable metadata for observability (§21). */
  startedAt: number
  retries: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure events  (Chapter 2.2 §17 — failures are isolated)
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowFailure {
  snapshotId: string
  correlationId: string
  stage: string
  reason: string
  failedAt: number
  willRetry: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Orchestrator  (Chapter 2.2 §5)
// ─────────────────────────────────────────────────────────────────────────────

class WorkflowOrchestratorImpl {
  private stages: PipelineStageDef[] = []
  private running = false
  private cancelSchedule: (() => void) | null = null
  private currentContext: OrchestratorContext | null = null
  private failureSubscribers = new Set<(f: WorkflowFailure) => void>()
  private completionSubscribers = new Set<(rec: SnapshotRecord) => void>()
  private stats = {
    cyclesRun: 0,
    cyclesSucceeded: 0,
    cyclesFailed: 0,
    stageRetries: 0,
    stageTimeouts: 0,
  }

  /** Register the pipeline stages in canonical order (Chapter 2.2 §6). */
  registerStages(stages: PipelineStageDef[]): void {
    this.stages = [...stages]
    log.info(`registered ${stages.length} pipeline stages: ${stages.map((s) => s.name).join(' → ')}`)
  }

  /** Start the orchestration cycle on a fixed interval (§5 scheduling). */
  start(intervalMs: number): void {
    if (this.running) {
      log.warn('orchestrator already running')
      return
    }
    this.running = true
    log.info(`orchestrator started — cycle every ${intervalMs}ms`)
    this.cancelSchedule = schedule('workflow-orchestrator', intervalMs, async () => {
      await this.runCycle().catch((e) => {
        log.error(`orchestrator cycle failed: ${e instanceof Error ? e.message : String(e)}`)
        this.stats.cyclesFailed++
      })
    })
    // Run one cycle immediately so the dashboard has data without waiting
    void this.runCycle().catch(() => {})
  }

  stop(): void {
    this.running = false
    if (this.cancelSchedule) {
      this.cancelSchedule()
      this.cancelSchedule = null
    }
    log.info('orchestrator stopped')
  }

  /** Run a single complete pipeline cycle (Chapter 2.2 §6, Rule 4). */
  async runCycle(): Promise<SnapshotRecord> {
    if (this.stages.length === 0) {
      throw new Error('[orchestrator] no stages registered')
    }

    // Begin a fresh correlation for this analytical cycle (§20)
    const correlationId = beginCorrelation()
    this.stats.cyclesRun++

    // Create the snapshot in CREATED state (§13)
    const snapshot = snapshotRegistry.create(correlationId)
    bindSnapshot(snapshot.snapshotId)

    const ctx: OrchestratorContext = {
      correlationId,
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.version,
      stageOutputs: {},
      startedAt: now(),
      retries: {},
    }
    this.currentContext = ctx

    try {
      // CREATED → COLLECTING (§13)
      snapshotRegistry.transition(snapshot.snapshotId, 'COLLECTING')

      // Execute every stage in canonical order (§6 — no skips, Rule 7)
      for (const stage of this.stages) {
        await this.executeStage(stage, ctx)
        // Transition snapshot state at key milestones (§13)
        if (stage.name === 'market-data') {
          snapshotRegistry.transition(snapshot.snapshotId, 'PROCESSING')
        } else if (stage.name === 'risk-engine') {
          snapshotRegistry.transition(snapshot.snapshotId, 'VALIDATING')
        }
      }

      // VALIDATING → COMPLETE (§13)
      snapshotRegistry.transition(snapshot.snapshotId, 'COMPLETE', {
        timestamp: now(),
        stageTimings: this.extractTimings(ctx),
      })

      // COMPLETE → PUBLISHED (§13)
      const published = snapshotRegistry.transition(snapshot.snapshotId, 'PUBLISHED')
      this.stats.cyclesSucceeded++
      for (const sub of this.completionSubscribers) sub(published)
      log.info(`snapshot v${snapshot.version} PUBLISHED (${now() - ctx.startedAt}ms)`)
      return published
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      snapshotRegistry.transition(snapshot.snapshotId, 'FAILED', { failureReason: reason })
      this.stats.cyclesFailed++
      this.emitFailure({
        snapshotId: snapshot.snapshotId,
        correlationId,
        stage: this.currentStageName ?? 'unknown',
        reason,
        failedAt: now(),
        willRetry: false,
      })
      log.error(`snapshot v${snapshot.version} FAILED at ${this.currentStageName}: ${reason}`)
      throw e
    } finally {
      endCorrelation()
      this.currentContext = null
      this.currentStageName = null
    }
  }

  private currentStageName: string | null = null

  /** Execute a single stage with timeout + retry (§18, §19). */
  private async executeStage(stage: PipelineStageDef, ctx: OrchestratorContext): Promise<void> {
    this.currentStageName = stage.name
    const attempts = (ctx.retries[stage.name] ?? 0)

    for (let attempt = 0; attempt <= stage.maxRetries; attempt++) {
      try {
        const output = await this.withTimeout(
          () => stage.execute(ctx),
          stage.timeoutMs,
          stage.name,
        )
        ctx.stageOutputs[stage.name] = output
        if (attempt > 0) {
          log.info(`stage "${stage.name}" succeeded on retry ${attempt}`)
        }
        return
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        if (attempt < stage.maxRetries) {
          // Retry decision belongs exclusively to the orchestrator (§19)
          ctx.retries[stage.name] = attempt + 1
          this.stats.stageRetries++
          log.warn(`stage "${stage.name}" failed (attempt ${attempt + 1}/${stage.maxRetries + 1}): ${reason} — retrying`)
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1))) // exponential-ish backoff
          continue
        }
        // Exhausted retries — rethrow (orchestrator will fail the snapshot)
        if (reason.includes('TIMEOUT')) this.stats.stageTimeouts++
        throw e
      }
    }
  }

  /** Wrap a stage in a timeout (§18 — no pipeline may wait indefinitely). */
  private async withTimeout<T>(fn: () => Promise<T>, ms: number, stageName: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`TIMEOUT: stage "${stageName}" exceeded ${ms}ms`))
      }, ms)
      fn()
        .then((v) => {
          clearTimeout(timer)
          resolve(v)
        })
        .catch((e) => {
          clearTimeout(timer)
          reject(e)
        })
    })
  }

  private extractTimings(ctx: OrchestratorContext): Record<string, number> {
    // Stages record their own timings into ctx.stageOutputs under '__timing__'
    const timings: Record<string, number> = {}
    for (const [name, out] of Object.entries(ctx.stageOutputs)) {
      if (out && typeof out === 'object' && '__timingMs' in out) {
        timings[name] = (out as { __timingMs: number }).__timingMs
      }
    }
    return timings
  }

  // ── Observability (§21) ──
  private emitFailure(f: WorkflowFailure): void {
    for (const sub of this.failureSubscribers) sub(f)
  }

  onFailure(handler: (f: WorkflowFailure) => void): () => void {
    this.failureSubscribers.add(handler)
    return () => this.failureSubscribers.delete(handler)
  }

  onComplete(handler: (rec: SnapshotRecord) => void): () => void {
    this.completionSubscribers.add(handler)
    return () => this.completionSubscribers.delete(handler)
  }

  getStats() {
    return { ...this.stats, stages: this.stages.length, running: this.running }
  }

  getCurrentContext(): OrchestratorContext | null {
    return this.currentContext
  }

  /** Get the active correlation ID (Chapter 2.2 §20). */
  getActiveCorrelationId(): string | null {
    return getCorrelation()?.correlationId ?? null
  }
}

export const workflowOrchestrator = new WorkflowOrchestratorImpl()

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: a stage wrapper that records timing for observability (§21)
// ─────────────────────────────────────────────────────────────────────────────
export function timedStage<TOut>(
  name: string,
  domain: string,
  priority: EventPriority,
  timeoutMs: number,
  maxRetries: number,
  fn: (ctx: OrchestratorContext) => Promise<TOut>,
): PipelineStageDef {
  return {
    name,
    domain,
    priority,
    timeoutMs,
    maxRetries,
    async execute(ctx: OrchestratorContext) {
      const start = now()
      const out = await fn(ctx)
      const timingMs = now() - start
      // Attach timing to the output for the orchestrator to collect (§21)
      return { value: out, __timingMs: timingMs }
    },
  }
}

// Re-export for the orchestrator's publish helper
export { publish, EVENT_TYPES }
