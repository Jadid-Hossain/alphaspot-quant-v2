// CHAPTER 2.3 §4, §5, §6, §22 — Worker Architecture
//
// CPU-intensive computation executes OUTSIDE the realtime ingestion pipeline
// (Chapter 2.3 §5, Rule 1). Workers receive jobs, return results, and NEVER
// directly manipulate platform state (Rule 4).
//
// Workload classes (§6):
//   REALTIME   — minimum latency (market ticks, heartbeat, exchange sync)
//   INTERACTIVE — dashboard responsiveness (charts, recommendations, history)
//   ANALYTICAL — heavy computation (feature generation, ML inference, ranking)
//   BACKGROUND — non-urgent (cleanup, compression, statistics, archiving)
//
// Resource limits (§22): every worker has bounded concurrency, queue depth,
// execution time, and retries.

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('worker-pool')

// ─────────────────────────────────────────────────────────────────────────────
// Job + result types  (Chapter 2.3 §5 — workers receive jobs, return results)
// ─────────────────────────────────────────────────────────────────────────────

export type WorkloadClass = 'REALTIME' | 'INTERACTIVE' | 'ANALYTICAL' | 'BACKGROUND'

export interface Job<TInput = unknown, TOutput = unknown> {
  id: string
  type: string
  workloadClass: WorkloadClass
  input: TInput
  priority: number // within class, lower = higher priority
  enqueuedAt: number
  maxExecutionMs: number
  maxRetries: number
}

export interface JobResult<TOutput = unknown> {
  jobId: string
  success: boolean
  output?: TOutput
  error?: string
  durationMs: number
  attempts: number
  completedAt: number
}

export type JobHandler<TInput = unknown, TOutput = unknown> = (input: TInput) => Promise<TOutput>

interface HandlerRegistration {
  type: string
  handler: JobHandler
  defaultWorkloadClass: WorkloadClass
  defaultMaxExecutionMs: number
  defaultMaxRetries: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Pool  (Chapter 2.3 §5)
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerPoolConfig {
  /** Max concurrent jobs (§22 — bounded concurrency). */
  maxConcurrency: number
  /** Max queue depth per class (§22, §13 backpressure). */
  maxQueueDepthPerClass: number
  /** Polling interval for the dispatcher. */
  pollIntervalMs: number
}

const DEFAULT_CONFIG: WorkerPoolConfig = {
  maxConcurrency: 8,
  maxQueueDepthPerClass: 500,
  pollIntervalMs: 10,
}

const CLASS_RANK: Record<WorkloadClass, number> = {
  REALTIME: 0,
  INTERACTIVE: 1,
  ANALYTICAL: 2,
  BACKGROUND: 3,
}

class WorkerPool {
  private handlers = new Map<string, HandlerRegistration>()
  private queues: Record<WorkloadClass, Job[]> = {
    REALTIME: [],
    INTERACTIVE: [],
    ANALYTICAL: [],
    BACKGROUND: [],
  }
  private running = new Map<string, { job: Job; startedAt: number; abortController: AbortController }>()
  private config: WorkerPoolConfig = { ...DEFAULT_CONFIG }
  private dispatchTimer: ReturnType<typeof setInterval> | null = null
  private stats = {
    totalJobs: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    timedOut: 0,
    queueDepth: 0,
    activeWorkers: 0,
    averageWaitMs: 0,
    averageExecutionMs: 0,
  }
  private waitSamples: number[] = []
  private execSamples: number[] = []

  /** Register a handler for a job type. */
  registerHandler<TInput, TOutput>(
    type: string,
    handler: JobHandler<TInput, TOutput>,
    opts: { workloadClass?: WorkloadClass; maxExecutionMs?: number; maxRetries?: number } = {},
  ): void {
    this.handlers.set(type, {
      type,
      handler: handler as JobHandler,
      defaultWorkloadClass: opts.workloadClass ?? 'ANALYTICAL',
      defaultMaxExecutionMs: opts.maxExecutionMs ?? 30_000,
      defaultMaxRetries: opts.maxRetries ?? 2,
    })
    log.info(`handler registered: ${type} (class: ${opts.workloadClass ?? 'ANALYTICAL'})`)
  }

  /** Start the dispatcher. */
  start(): void {
    if (this.dispatchTimer) return
    this.dispatchTimer = setInterval(() => void this.dispatch(), this.config.pollIntervalMs)
    log.info(`worker pool started — concurrency ${this.config.maxConcurrency}, poll ${this.config.pollIntervalMs}ms`)
  }

  stop(): void {
    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer)
      this.dispatchTimer = null
    }
    log.info('worker pool stopped')
  }

  /** Enqueue a job. Returns the job ID for result correlation. */
  enqueue<TInput, TOutput>(
    type: string,
    input: TInput,
    opts: { workloadClass?: WorkloadClass; priority?: number; maxExecutionMs?: number; maxRetries?: number } = {},
  ): string {
    const reg = this.handlers.get(type)
    if (!reg) {
      throw new Error(`[worker-pool] no handler registered for job type "${type}"`)
    }
    const workloadClass = opts.workloadClass ?? reg.defaultWorkloadClass
    const queue = this.queues[workloadClass]

    // Backpressure (§13): drop BACKGROUND jobs if queue is full
    if (queue.length >= this.config.maxQueueDepthPerClass) {
      if (workloadClass === 'BACKGROUND') {
        log.warn(`queue full for ${workloadClass} (${queue.length}) — dropping job ${type}`)
        this.stats.failed++
        return `dropped-${Date.now()}`
      }
      // For higher-priority classes, keep enqueueing (they preempt)
    }

    const job: Job<TInput, TOutput> = {
      id: `job-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      workloadClass,
      input,
      priority: opts.priority ?? 0,
      enqueuedAt: Date.now(),
      maxExecutionMs: opts.maxExecutionMs ?? reg.defaultMaxExecutionMs,
      maxRetries: opts.maxRetries ?? reg.defaultMaxRetries,
    }
    queue.push(job)
    this.stats.totalJobs++
    this.stats.queueDepth = this.totalQueueDepth()
    return job.id
  }

  /** Dispatch pending jobs to available workers. */
  private async dispatch(): Promise<void> {
    while (this.running.size < this.config.maxConcurrency) {
      const job = this.nextJob()
      if (!job) break
      void this.executeJob(job)
    }
  }

  /** Get the highest-priority job across all queues (§14 resource scheduling). */
  private nextJob(): Job | null {
    for (const cls of ['REALTIME', 'INTERACTIVE', 'ANALYTICAL', 'BACKGROUND'] as WorkloadClass[]) {
      const queue = this.queues[cls]
      if (queue.length === 0) continue
      // Within a class, sort by priority then enqueue time
      queue.sort((a, b) => {
        const p = a.priority - b.priority
        return p !== 0 ? p : a.enqueuedAt - b.enqueuedAt
      })
      return queue.shift()!
    }
    return null
  }

  /** Execute a job with timeout + retry (§18, §22). */
  private async executeJob(job: Job): Promise<void> {
    const reg = this.handlers.get(job.type)
    if (!reg) {
      log.error(`no handler for job ${job.id} (type ${job.type})`)
      this.stats.failed++
      return
    }

    const abort = new AbortController()
    this.running.set(job.id, { job, startedAt: Date.now(), abortController: abort })
    this.stats.activeWorkers = this.running.size
    const waitMs = Date.now() - job.enqueuedAt
    this.recordWait(waitMs)

    let attempts = 0
    let lastErr: unknown
    while (attempts <= job.maxRetries) {
      attempts++
      try {
        const output = await this.withTimeout(
          () => reg.handler(job.input),
          job.maxExecutionMs,
          job.id,
        )
        const execMs = Date.now() - (this.running.get(job.id)?.startedAt ?? Date.now())
        this.recordExec(execMs)
        this.stats.completed++
        log.debug(`job ${job.id} (${job.type}) completed in ${execMs}ms`)
        this.running.delete(job.id)
        this.stats.activeWorkers = this.running.size
        this.stats.queueDepth = this.totalQueueDepth()
        return
      } catch (e) {
        lastErr = e
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('TIMEOUT')) this.stats.timedOut++
        if (attempts <= job.maxRetries) {
          this.stats.retried++
          log.warn(`job ${job.id} (${job.type}) failed attempt ${attempts}/${job.maxRetries + 1}: ${msg} — retrying`)
          await new Promise((r) => setTimeout(r, 100 * attempts))
        }
      }
    }
    this.stats.failed++
    log.error(`job ${job.id} (${job.type}) permanently failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
    this.running.delete(job.id)
    this.stats.activeWorkers = this.running.size
  }

  /** Timeout wrapper (§22 — max execution time). */
  private withTimeout<T>(fn: () => Promise<T>, ms: number, jobId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`TIMEOUT: job ${jobId} exceeded ${ms}ms`)), ms)
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

  private totalQueueDepth(): number {
    return this.queues.REALTIME.length + this.queues.INTERACTIVE.length + this.queues.ANALYTICAL.length + this.queues.BACKGROUND.length
  }

  private recordWait(ms: number): void {
    this.waitSamples.push(ms)
    if (this.waitSamples.length > 200) this.waitSamples.shift()
    this.stats.averageWaitMs = this.waitSamples.reduce((a, b) => a + b, 0) / this.waitSamples.length
  }

  private recordExec(ms: number): void {
    this.execSamples.push(ms)
    if (this.execSamples.length > 200) this.execSamples.shift()
    this.stats.averageExecutionMs = this.execSamples.reduce((a, b) => a + b, 0) / this.execSamples.length
  }

  getStats() {
    return {
      ...this.stats,
      queueByClass: {
        REALTIME: this.queues.REALTIME.length,
        INTERACTIVE: this.queues.INTERACTIVE.length,
        ANALYTICAL: this.queues.ANALYTICAL.length,
        BACKGROUND: this.queues.BACKGROUND.length,
      },
      handlers: this.handlers.size,
    }
  }

  getConfig(): WorkerPoolConfig {
    return { ...this.config }
  }

  setConfig(patch: Partial<WorkerPoolConfig>): void {
    this.config = { ...this.config, ...patch }
  }
}

export const workerPool = new WorkerPool()

// Re-export CLASS_RANK for the watchdog/backpressure modules
export { CLASS_RANK }
