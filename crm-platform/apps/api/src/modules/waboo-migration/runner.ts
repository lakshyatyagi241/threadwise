import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  parseLine,
  scrub,
  tail,
  type PipelineEvent,
  type ReportEvent,
  type RunMode,
} from './waboo-migration.rules';

export interface RunArgs {
  /** The run's uuid. The local runner ignores it; the remote runner addresses its job by it. */
  runUuid?: string;
  sourceClient: string;
  sourceDb: string;
  mode: RunMode;
  /** testing switch: the pipeline gets --no-whatsapp */
  skipWhatsapp?: boolean;
}

export interface RunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  /** Last 2 KB of stderr, scrubbed. */
  stderrTail: string;
  report: ReportEvent | null;
}

/** Runs the migration pipeline for one client. Events are delivered in order; the promise ends when the pipeline has. */
export interface Runner {
  run(args: RunArgs, onEvent: (ev: PipelineEvent) => Promise<void>): Promise<RunOutcome>;
}

/** The pipeline path is not configured: nothing was started. */
export class PipelineNotConfiguredError extends Error {
  constructor() {
    super('WABOO_MIGRATE_PIPELINE is not set on the worker; nothing was started.');
  }
}

/**
 * The only environment names the child process receives: a fixed base set plus the names an operator lists in
 * WABOO_MIGRATE_CHILD_ENV (comma separated, e.g. the pipeline's own database settings). The panel never stores, logs or
 * returns their values.
 */
export const CHILD_ENV_BASE = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'LANG',
  'NODE_ENV',
] as const;

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extra = (env.WABOO_MIGRATE_CHILD_ENV ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  const out: NodeJS.ProcessEnv = {};
  for (const k of [...CHILD_ENV_BASE, ...extra]) if (env[k] !== undefined) out[k] = env[k];
  return out;
}

/** Hard timeout in ms from WABOO_MIGRATE_TIMEOUT_MIN (minutes, default 90). */
export function timeoutMs(env: NodeJS.ProcessEnv): number {
  const n = Number(env.WABOO_MIGRATE_TIMEOUT_MIN);
  return (Number.isFinite(n) && n > 0 ? n : 90) * 60_000;
}

/** `node <pipeline> --client <c> --db <d> --mode <m>`: an args array, never a shell string. */
export function buildArgs(pipeline: string, a: RunArgs): string[] {
  return [
    pipeline,
    '--client',
    a.sourceClient,
    '--db',
    a.sourceDb,
    '--mode',
    a.mode,
    ...(a.skipWhatsapp ? ['--no-whatsapp'] : []),
  ];
}

export class ProcessRunner implements Runner {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  run(args: RunArgs, onEvent: (ev: PipelineEvent) => Promise<void>): Promise<RunOutcome> {
    const pipeline = this.env.WABOO_MIGRATE_PIPELINE;
    if (!pipeline) return Promise.reject(new PipelineNotConfiguredError());

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, buildArgs(pipeline, args), {
        env: childEnv(this.env),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      let report: ReportEvent | null = null;
      let timedOut = false;
      // Events are handled one at a time, in the order they were printed.
      let chain: Promise<void> = Promise.resolve();
      let failure: unknown = null;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs(this.env));

      createInterface({ input: child.stdout }).on('line', (line) => {
        const ev = parseLine(line);
        if (!ev) return;
        if (ev.event === 'report') report = ev;
        chain = chain.then(() => onEvent(ev)).catch((e) => void (failure ??= e));
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr = tail(stderr + d.toString('utf8'), 4096);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        void chain.then(() => {
          if (failure) return reject(failure);
          resolve({ exitCode, timedOut, stderrTail: scrub(tail(stderr, 2048)), report });
        });
      });
    });
  }
}

/**
 * Where the pipeline runs. 'remote' = on a runner agent over the Geta VPN (the staging setup: Waboo's database is only reachable from
 * there); 'local' (default) = the worker starts the script named by WABOO_MIGRATE_PIPELINE itself.
 */
export function runnerMode(env: NodeJS.ProcessEnv): 'remote' | 'local' {
  return env.WABOO_MIGRATE_RUNNER === 'remote' ? 'remote' : 'local';
}
