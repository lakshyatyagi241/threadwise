import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { EventLoopSampler, classifySnapshot, type EventLoopSnapshot } from './event-loop-sampler';
import { Registry, type Counter, type Gauge, type Histogram } from './prometheus-text';

/** The process kinds that report. `api` and `worker` are the names Sentry uses, so a worker is the same worker in both. */
export type RuntimeService = 'api' | 'worker' | 'web';

/** Identifies one process. The hostname is the container id in Docker, which is what the container healthcheck knows. */
export const instanceId = (host: string, pid: number): string => `${host}:${pid}`;

/** Seconds, Prometheus convention. Fine below 10 ms (a healthy API) and up to 30 s (a webhook ack that missed its window). */
const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const JOB_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300, 1800];

const GC_KIND: Record<number, string> = {
  [perfConstants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [perfConstants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [perfConstants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb',
};

export interface RuntimeMonitorOptions {
  service: RuntimeService;
  /** Reporting window. The standard is 10 s; tests use less. */
  intervalMs?: number;
  /** Stable per-process id. Defaults to `<hostname>:<pid>`: low cardinality, restarts get a new one. */
  instance?: string;
  /** The release this process runs (see `releaseFromEnv`): stamped on every series as `release`. Omitted: no such label. */
  release?: string;
  /** A window whose worst delay exceeds this is logged with the slowest requests of that window. */
  blockedLogThresholdMs?: number;
  log?: (line: Record<string, unknown>) => void;
  /** Where the cgroup v2 CPU stat lives. Injectable for tests. */
  cgroupCpuStatPath?: string;
}

interface SlowRequest {
  route: string;
  method: string;
  status: number;
  durationMs: number;
}

/**
 * Per-process runtime health: event-loop delay and utilization, CPU, memory, GC, HTTP and job latency, as Prometheus text.
 *
 * It is started before Nest builds the application so a slow boot is measured too, owns one unref'd timer, and a failed
 * window is swallowed: observability must never take a process down. Payloads, tokens and tenant data never reach it; the only
 * request fields it sees are method, route template and status.
 */
export class RuntimeMonitor {
  private readonly registry: Registry;
  private readonly sampler: EventLoopSampler;
  private readonly intervalMs: number;
  private readonly blockedLogThresholdMs: number;
  private readonly log: (line: Record<string, unknown>) => void;
  private readonly cgroupPath: string;
  private timer: NodeJS.Timeout | undefined;
  private gcObserver: PerformanceObserver | undefined;
  private lastCpu = process.cpuUsage();
  private lastTick = Date.now();
  private slowest: SlowRequest[] = [];
  private gcWindow = { count: 0, totalMs: 0, maxMs: 0 };
  private lastLevel: ReturnType<typeof classifySnapshot> = 'ok';
  private latest: EventLoopSnapshot | null = null;

  private readonly delayP50: Gauge;
  private readonly delayP95: Gauge;
  private readonly delayP99: Gauge;
  private readonly delayMax: Gauge;
  private readonly delayMean: Gauge;
  private readonly elu: Gauge;
  private readonly cpu: Gauge;
  private readonly heapUsed: Gauge;
  private readonly heapTotal: Gauge;
  private readonly heapLimit: Gauge;
  private readonly rss: Gauge;
  private readonly external: Gauge;
  private readonly resources: Gauge;
  private readonly gcMax: Gauge;
  private readonly gcWindowTotal: Gauge;
  private readonly lastReport: Gauge;
  private readonly startTime: Gauge;
  private readonly windowSeconds: Gauge;
  private readonly gcDuration: Counter;
  private readonly gcCount: Counter;
  private readonly blocked: Counter;
  private readonly throttledPeriods: Gauge;
  private readonly throttledSeconds: Gauge;
  private readonly cgroupMemory: Gauge;
  private readonly cgroupMemoryLimit: Gauge;
  private readonly cgroupOomKills: Gauge;
  private readonly cgroupPids: Gauge;
  private readonly cgroupPidsLimit: Gauge;
  private readonly jobs: Counter;
  private readonly jobRetries: Counter;
  private readonly dlqCaptured: Counter;
  private readonly dlqCaptureFailures: Counter;
  private readonly storageMeterFailures: Counter;
  private readonly dlqOpen: Gauge;
  private readonly dlqOldest: Gauge;
  private readonly httpDuration: Histogram;
  private readonly jobDuration: Histogram;
  private readonly jobWait: Histogram;

  constructor(opts: RuntimeMonitorOptions) {
    // Same identity the worker heartbeat publishes to Redis, so /ready, Sentry and these series name a process alike.
    const instance = opts.instance ?? instanceId(hostname(), process.pid);
    this.registry = new Registry({
      service: opts.service,
      instance,
      ...(opts.release ? { release: opts.release } : {}),
    });
    this.intervalMs = opts.intervalMs ?? 10_000;
    this.sampler = new EventLoopSampler({ windowHintMs: this.intervalMs });
    this.blockedLogThresholdMs = opts.blockedLogThresholdMs ?? 250;
    this.log = opts.log ?? ((line) => process.stdout.write(`${JSON.stringify(line)}\n`));
    this.cgroupPath = opts.cgroupCpuStatPath ?? '/sys/fs/cgroup/cpu.stat';
    this.delayP50 = this.registry.gauge(
      'crm_event_loop_delay_p50_seconds',
      'Event-loop delay p50 over the last window',
    );
    this.delayP95 = this.registry.gauge(
      'crm_event_loop_delay_p95_seconds',
      'Event-loop delay p95 over the last window',
    );
    this.delayP99 = this.registry.gauge(
      'crm_event_loop_delay_p99_seconds',
      'Event-loop delay p99 over the last window',
    );
    this.delayMax = this.registry.gauge(
      'crm_event_loop_delay_max_seconds',
      'Worst event-loop delay in the last window',
    );
    this.delayMean = this.registry.gauge(
      'crm_event_loop_delay_mean_seconds',
      'Mean event-loop delay over the last window',
    );
    this.elu = this.registry.gauge(
      'crm_event_loop_utilization_ratio',
      'Event-loop utilization over the last window (interval delta, 0..1)',
    );
    this.cpu = this.registry.gauge(
      'crm_process_cpu_ratio',
      'Process CPU over the last window, in cores (1 = one full core)',
    );
    this.heapUsed = this.registry.gauge('crm_process_heap_used_bytes', 'V8 heap used');
    this.heapTotal = this.registry.gauge('crm_process_heap_total_bytes', 'V8 heap total');
    this.heapLimit = this.registry.gauge(
      'crm_process_heap_limit_bytes',
      'V8 heap size limit (--max-old-space-size)',
    );
    this.rss = this.registry.gauge('crm_process_rss_bytes', 'Resident set size');
    this.external = this.registry.gauge(
      'crm_process_external_bytes',
      'Memory held by C++ objects bound to JS (Buffers)',
    );
    this.resources = this.registry.gauge(
      'crm_process_active_resources',
      'Active handles and requests (sockets, timers, ...)',
    );
    this.gcMax = this.registry.gauge(
      'crm_gc_pause_max_seconds',
      'Longest GC pause in the last window',
    );
    this.gcWindowTotal = this.registry.gauge(
      'crm_gc_pause_window_seconds',
      'Total GC pause time in the last window',
    );
    this.lastReport = this.registry.gauge(
      'crm_runtime_last_report_timestamp_seconds',
      'Unix time of the last completed window; stale means the monitor or the process stopped',
    );
    this.startTime = this.registry.gauge(
      'crm_process_start_time_seconds',
      'Unix time the process started',
    );
    this.windowSeconds = this.registry.gauge(
      'crm_runtime_window_seconds',
      'Length of the last reporting window',
    );
    this.gcDuration = this.registry.counter(
      'crm_gc_pause_seconds_total',
      'Cumulative GC pause time by kind',
    );
    this.gcCount = this.registry.counter('crm_gc_events_total', 'Cumulative GC events by kind');
    this.jobRetries = this.registry.counter(
      'crm_queue_job_retries_total',
      'Extra starts of jobs that finished: retries after a failure, plus restarts after a stall. BullMQ reports no event for an attempt that will be retried, so this is the only trace of them',
    );
    this.blocked = this.registry.counter(
      'crm_event_loop_blocked_windows_total',
      'Windows whose loop DELAY crossed the warn or critical target (utilization alone never counts)',
    );
    this.throttledPeriods = this.registry.gauge(
      'crm_container_cpu_throttled_periods_total',
      'cgroup nr_throttled (counter exposed as gauge: read from the kernel)',
    );
    this.throttledSeconds = this.registry.gauge(
      'crm_container_cpu_throttled_seconds_total',
      'cgroup throttled_usec in seconds',
    );
    this.cgroupMemory = this.registry.gauge(
      'crm_container_memory_bytes',
      'cgroup memory.current: everything the container is charged for (heap, buffers, code, page cache), not the V8 heap',
    );
    this.cgroupMemoryLimit = this.registry.gauge(
      'crm_container_memory_limit_bytes',
      'cgroup memory.max; absent when the container has no memory limit',
    );
    this.cgroupOomKills = this.registry.gauge(
      'crm_container_oom_kills_total',
      'cgroup memory.events oom_kill (counter exposed as gauge: read from the kernel). Any increase is a process the kernel killed for memory',
    );
    this.cgroupPids = this.registry.gauge(
      'crm_container_pids',
      'cgroup pids.current: processes and threads',
    );
    this.cgroupPidsLimit = this.registry.gauge(
      'crm_container_pids_limit',
      'cgroup pids.max; absent when the container has no PID limit',
    );
    this.dlqCaptured = this.registry.counter(
      'crm_dead_letter_captured_total',
      'Background operations recorded as failed for good (retries exhausted or unrecoverable), by queue and failure category',
    );
    this.dlqCaptureFailures = this.registry.counter(
      'crm_dead_letter_capture_failures_total',
      'Failed-operation records that could not be written. The job is still in the queue failed set and the reconcile sweep retries it; any non-zero value needs a person',
    );
    this.storageMeterFailures = this.registry.counter(
      'crm_storage_meter_failures_total',
      'Storage quota metering steps that threw and were skipped (fail-open: the file write itself succeeded), by step. Observe mode: any non-zero value means the registry is drifting and the nightly counter check will correct it',
    );
    this.dlqOpen = this.registry.gauge(
      'crm_dead_letter_open',
      'Failed operations not yet resolved or closed, by queue',
    );
    this.dlqOldest = this.registry.gauge(
      'crm_dead_letter_oldest_open_seconds',
      'Age of the oldest unresolved failed operation, by queue (0 when none)',
    );
    this.jobs = this.registry.counter(
      'crm_queue_jobs_total',
      'Finished queue jobs by queue and outcome',
    );
    this.httpDuration = this.registry.histogram(
      'crm_http_request_duration_seconds',
      'HTTP request duration by method, route template and status class',
      HTTP_BUCKETS,
      { method: 'OTHER', route: 'overflow', status: 'other' },
    );
    this.jobDuration = this.registry.histogram(
      'crm_queue_job_duration_seconds',
      'Time a queue job spent running',
      JOB_BUCKETS,
      { queue: 'overflow' },
    );
    this.jobWait = this.registry.histogram(
      'crm_queue_job_wait_seconds',
      'Time a queue job waited before it started',
      JOB_BUCKETS,
      { queue: 'overflow' },
    );
  }

  start(): void {
    if (this.timer) return;
    this.startTime.set(Math.floor((Date.now() - process.uptime() * 1000) / 1000));
    this.sampler.start();
    this.lastCpu = process.cpuUsage();
    this.lastTick = Date.now();
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const kind =
            GC_KIND[(e as unknown as { detail?: { kind?: number } }).detail?.kind ?? -1] ?? 'other';
          this.gcDuration.inc(e.duration / 1000, { kind });
          this.gcCount.inc(1, { kind });
          this.gcWindow.count += 1;
          this.gcWindow.totalMs += e.duration;
          this.gcWindow.maxMs = Math.max(this.gcWindow.maxMs, e.duration);
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch {
      this.gcObserver = undefined; // GC timing is optional; the loop metrics still work.
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.gcObserver?.disconnect();
    this.gcObserver = undefined;
    this.sampler.stop();
  }

  /**
   * The registry behind `render()`, for a module that has series of its own (the realtime gateway's socket counts). Register a family
   * once per monitor and keep the handle: a registry does not de-duplicate names.
   */
  get metrics(): Registry {
    return this.registry;
  }

  /** Called by the HTTP middleware when a response finishes. `route` must be the route template, never the raw URL. */
  observeHttp(method: string, route: string, status: number, durationMs: number): void {
    const statusClass = `${Math.floor(status / 100)}xx`;
    this.httpDuration.observe(durationMs / 1000, { method, route, status: statusClass });
    this.slowest.push({ route, method, status, durationMs });
    if (this.slowest.length > 64) {
      this.slowest.sort((a, b) => b.durationMs - a.durationMs);
      this.slowest.length = 8;
    }
  }

  /** For queue processors: how long the job waited, how long it ran, and how it ended. `queue` is a QUEUES value. */
  observeJob(
    queue: string,
    waitMs: number | null,
    durationMs: number,
    outcome: 'completed' | 'failed',
    retries = 0,
  ): void {
    // null: not a queue wait (a retry), so the wait histogram is left alone rather than polluted.
    if (waitMs !== null) this.jobWait.observe(waitMs / 1000, { queue });
    this.jobDuration.observe(durationMs / 1000, { queue });
    this.jobs.inc(1, { queue, outcome });
    if (retries > 0) this.jobRetries.inc(retries, { queue });
  }

  /** A failed operation was recorded. Labels are the fixed queue name and the failure category: never an id, tenant or error text. */
  observeDeadLetter(queue: string, category: string): void {
    this.dlqCaptured.inc(1, { queue, category });
  }

  observeDeadLetterCaptureFailure(queue: string): void {
    this.dlqCaptureFailures.inc(1, { queue });
  }

  /** A storage metering step (reserve, commit, release, remove) failed and the file write went on without it. */
  observeStorageMeterFailure(step: string): void {
    this.storageMeterFailures.inc(1, { step });
  }

  /** The unresolved backlog of one queue, sampled by the reconcile sweep. */
  setDeadLetterBacklog(queue: string, open: number, oldestSeconds: number): void {
    this.dlqOpen.set(open, { queue });
    this.dlqOldest.set(oldestSeconds, { queue });
  }

  render(): string {
    return this.registry.render();
  }

  /** The last completed window, for tests and for health output. */
  snapshot(): EventLoopSnapshot | null {
    return this.latest;
  }

  /** Reads one window now. Public so tests do not wait for the timer. */
  tick(): void {
    try {
      this.collect();
    } catch (err) {
      this.log({
        level: 40,
        msg: 'runtime monitor window failed',
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private collect(): void {
    const now = Date.now();
    const snap = this.sampler.sample();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedMs = Math.max(1, now - this.lastTick);
    this.lastCpu = process.cpuUsage();
    this.lastTick = now;

    const mem = process.memoryUsage();
    const heap = getHeapStatistics();
    this.cpu.set((cpu.user + cpu.system) / 1000 / elapsedMs);
    this.heapUsed.set(mem.heapUsed);
    this.heapTotal.set(mem.heapTotal);
    this.heapLimit.set(heap.heap_size_limit);
    this.rss.set(mem.rss);
    this.external.set(mem.external);
    this.resources.set(process.getActiveResourcesInfo().length);
    this.gcMax.set(this.gcWindow.maxMs / 1000);
    this.gcWindowTotal.set(this.gcWindow.totalMs / 1000);
    void this.readCgroup(); // async: reading a kernel file must not sit on the loop being measured

    if (snap) {
      this.latest = snap;
      this.delayP50.set(snap.delayP50Ms / 1000);
      this.delayP95.set(snap.delayP95Ms / 1000);
      this.delayP99.set(snap.delayP99Ms / 1000);
      this.delayMax.set(snap.delayMaxMs / 1000);
      this.delayMean.set(snap.delayMeanMs / 1000);
      this.elu.set(snap.utilization);
      this.windowSeconds.set(snap.windowMs / 1000);
      this.reportBlocking(snap);
    }
    // No valid window leaves the loop series at their previous values on purpose: a stale value is caught by the
    // last-report timestamp, while publishing zeros would claim a healthy loop that was too starved to be measured.
    this.lastReport.set(Math.floor(now / 1000));
    this.slowest = [];
    this.gcWindow = { count: 0, totalMs: 0, maxMs: 0 };
  }

  private reportBlocking(snap: EventLoopSnapshot): void {
    const level = classifySnapshot(snap);
    // Counted on delay alone: a busy but responsive loop (high utilization, low delay) is capacity headroom, not blocking.
    const delayLevel = classifySnapshot({ ...snap, utilization: 0 });
    if (delayLevel !== 'ok') this.blocked.inc(1, { level: delayLevel });
    const crossed = snap.delayMaxMs >= this.blockedLogThresholdMs;
    if (!crossed && !(level === 'critical' && this.lastLevel !== 'critical')) {
      this.lastLevel = level;
      return;
    }
    this.lastLevel = level;
    // Evidence for the incident, with route templates only: which requests were slowest while the loop stalled.
    const top = [...this.slowest].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
    this.log({
      level: 40,
      msg: 'event loop blocked',
      loopLevel: level,
      delayMaxMs: Math.round(snap.delayMaxMs),
      delayP99Ms: Math.round(snap.delayP99Ms),
      utilization: Number(snap.utilization.toFixed(3)),
      gcMaxMs: Math.round(this.gcWindow.maxMs),
      slowestRequests: top,
    });
  }

  private async readCgroup(): Promise<void> {
    try {
      const text = await readFile(this.cgroupPath, 'utf8');
      const num = (key: string) => {
        const m = new RegExp(`^${key} (\\d+)$`, 'm').exec(text);
        return m ? Number(m[1]) : undefined;
      };
      const periods = num('nr_throttled');
      const usec = num('throttled_usec');
      if (periods !== undefined) this.throttledPeriods.set(periods);
      if (usec !== undefined) this.throttledSeconds.set(usec / 1_000_000);
    } catch {
      // Not Linux, or not cgroup v2: the throttling series is simply absent.
    }
    const dir = dirname(this.cgroupPath);
    const one = async (name: string): Promise<string | undefined> => {
      try {
        return (await readFile(join(dir, name), 'utf8')).trim();
      } catch {
        return undefined;
      }
    };
    const [current, max, events, pids, pidsMax] = await Promise.all([
      one('memory.current'),
      one('memory.max'),
      one('memory.events'),
      one('pids.current'),
      one('pids.max'),
    ]);
    // "max" means no limit: the limit series stays absent so a ratio alert cannot divide by it.
    const count = (v: string | undefined): number | undefined =>
      v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
    const set = (g: Gauge, v: number | undefined): void => {
      if (v !== undefined) g.set(v);
    };
    set(this.cgroupMemory, count(current));
    set(this.cgroupMemoryLimit, count(max));
    set(this.cgroupOomKills, count(/^oom_kill (\d+)$/m.exec(events ?? '')?.[1]));
    set(this.cgroupPids, count(pids));
    set(this.cgroupPidsLimit, count(pidsMax));
  }
}
