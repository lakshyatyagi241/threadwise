import { statSync } from 'node:fs';
import { hostname } from 'node:os';
import { Registry, type Gauge, type Histogram } from '@crm/observability';

/**
 * A prober that runs in its OWN process and measures how long a caller waits, from outside the API's event loop.
 *
 * Why it exists: the API's request-latency histogram times a request from when its handler runs, so time spent queued behind a blocked
 * loop is invisible to it (measured: callers 0.59 s, histogram 0.005 s). Only a clock outside the process sees that wait. Run this
 * next to the API, not inside it: in the same loop its own timers would be delayed by the same stall.
 */

/** Seconds. 5 ms to 10 s: a healthy in-network call is a few ms; a stalled loop shows as hundreds of ms to seconds. */
export const PROBE_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface ProbeTarget {
  /** Label value: lowercase letters, digits, `_` and `-`. A fixed, configured set, never user input. */
  name: string;
  url: string;
}

export type ProbeResult = 'ok' | 'bad_status' | 'error' | 'timeout';

/** `health=http://api:3000/health,ready=http://api:3000/ready` */
export function parseProbeTargets(spec: string): ProbeTarget[] {
  const targets = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      const name = eq < 0 ? '' : part.slice(0, eq).trim();
      const url = eq < 0 ? '' : part.slice(eq + 1).trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(name))
        throw new Error(`probe target name "${name}" is not [a-z0-9_-]{1,32}`);
      if (!/^https?:\/\/\S+$/.test(url))
        throw new Error(`probe target "${name}" needs an http(s) URL`);
      return { name, url };
    });
  if (targets.length === 0) throw new Error('no probe targets');
  if (new Set(targets.map((t) => t.name)).size !== targets.length)
    throw new Error('duplicate probe target name');
  return targets;
}

export interface ProbeOutcome {
  result: ProbeResult;
  seconds: number;
}

/** One timed GET. The body is read to the end, so a response that starts and then stalls counts as slow. */
export async function probeOnce(
  url: string,
  timeoutMs: number,
  doFetch: typeof fetch = fetch,
  now: () => number = () => performance.now(),
): Promise<ProbeOutcome> {
  const started = now();
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    await res.arrayBuffer();
    return {
      result: res.status >= 200 && res.status < 400 ? 'ok' : 'bad_status',
      seconds: (now() - started) / 1000,
    };
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { result: timedOut ? 'timeout' : 'error', seconds: (now() - started) / 1000 };
  }
}

export interface ProberOptions {
  intervalSeconds?: number;
  timeoutSeconds?: number;
  instance?: string;
  doFetch?: typeof fetch;
  /** Marker files whose age is exported: `backup=/backups/.last-ok`. Age is only emitted while the file exists. */
  files?: { name: string; path: string }[];
  /** Target names for which ANY HTTP answer counts as up (an object store answers 403 to an anonymous GET: reachable, not healthy). */
  reachableNames?: string[];
}

/** `backup=/backups/.last-ok,offsite=/offsite/offsite-ok` */
export function parseProbeFiles(spec: string): { name: string; path: string }[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      const name = eq < 0 ? '' : part.slice(0, eq).trim();
      const path = eq < 0 ? '' : part.slice(eq + 1).trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(name) || !path.startsWith('/'))
        throw new Error(`probe file "${part}" must be name=/absolute/path`);
      return { name, path };
    });
}

/**
 * Probes every target each interval (one round at a time, so a slow target cannot pile up requests) and keeps three series:
 * `crm_probe_http_duration_seconds{target,result}`, `crm_probe_up{target}` and `crm_probe_last_success_timestamp_seconds{target}`.
 */
export class Prober {
  readonly registry: Registry;
  private readonly duration: Histogram;
  private readonly up: Gauge;
  private readonly lastSuccess: Gauge;
  private readonly fileAge: Gauge;
  private readonly filePresent: Gauge;
  private readonly files: { name: string; path: string }[];
  private readonly reachable: Set<string>;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    readonly targets: ProbeTarget[],
    opts: ProberOptions = {},
  ) {
    this.registry = new Registry({
      service: 'probe',
      instance: opts.instance ?? `${hostname()}:${process.pid}`,
    });
    this.intervalMs = (opts.intervalSeconds ?? 10) * 1000;
    this.timeoutMs = (opts.timeoutSeconds ?? 10) * 1000;
    this.doFetch = opts.doFetch ?? fetch;
    this.files = opts.files ?? [];
    this.reachable = new Set(opts.reachableNames ?? []);
    this.duration = this.registry.histogram(
      'crm_probe_http_duration_seconds',
      'Caller-side time of a GET to a target, measured from another process; includes time queued behind a blocked event loop',
      PROBE_BUCKETS,
      { target: 'overflow', result: 'error' },
    );
    this.up = this.registry.gauge(
      'crm_probe_up',
      '1 when the last probe of the target got a 2xx/3xx answer, else 0',
    );
    this.lastSuccess = this.registry.gauge(
      'crm_probe_last_success_timestamp_seconds',
      'Unix time of the last successful probe of the target',
    );
    this.fileAge = this.registry.gauge(
      'crm_probe_file_age_seconds',
      'Seconds since a marker file (last good backup, last offsite pass) was written; absent while the file does not exist',
    );
    this.filePresent = this.registry.gauge(
      'crm_probe_file_present',
      '1 when the marker file exists, else 0',
    );
  }

  /** One round over all targets. Safe to call directly (tests); `start()` calls it on a timer. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all(
        this.targets.map(async (t) => {
          const o = await probeOnce(t.url, this.timeoutMs, this.doFetch);
          this.duration.observe(o.seconds, { target: t.name, result: o.result });
          const ok = o.result === 'ok' || (o.result === 'bad_status' && this.reachable.has(t.name));
          this.up.set(ok ? 1 : 0, { target: t.name });
          if (ok)
            this.lastSuccess.set(Math.floor(Date.now() / 1000), { target: t.name });
        }),
      );
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Marker files are read at scrape time, so the age is always current. */
  private readFiles(): void {
    for (const f of this.files) {
      try {
        this.fileAge.set(Math.max(0, (Date.now() - statSync(f.path).mtimeMs) / 1000), { file: f.name });
        this.filePresent.set(1, { file: f.name });
      } catch {
        this.filePresent.set(0, { file: f.name });
      }
    }
  }

  render(): string {
    this.readFiles();
    return this.registry.render();
  }
}
