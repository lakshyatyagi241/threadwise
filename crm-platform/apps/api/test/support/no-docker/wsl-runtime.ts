/**
 * Drives throwaway Postgres clusters and Redis servers inside the WSL distro (no Docker). Used by the vitest alias shims
 * (`postgresql-shim.ts`, `testcontainers-shim.ts`) when TEST_NO_DOCKER=1. All the real work is in `wsl-ctl.sh`, which is piped to
 * `bash -s` over stdin (no quoting problems, no file path translation). Only imports node built-ins, so the vitest aliases for
 * `testcontainers` / `@testcontainers/postgresql` can never loop back into it.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { resolve } from 'node:path';

const DISTRO = process.env.TEST_NO_DOCKER_DISTRO ?? 'Ubuntu-24.04';
const ENV = { ...process.env, WSL_UTF8: '1' };
// \r stripped in case a checkout converted the line endings.
const SCRIPT = readFileSync(resolve(__dirname, 'wsl-ctl.sh'), 'utf8').replace(/\r/g, '');
const WSL_ARGS = ['-d', DISTRO, '-u', 'root', '--exec', 'bash', '-s', '--'];
// Below the Linux (32768+) and Windows (49152+) ephemeral ranges: an outgoing connection that happens to use the port would make bind fail.
const PORT_MIN = 21000;
const PORT_MAX = 31999;

export interface Handle {
  kind: 'pg' | 'redis';
  id: string;
  /** Host the Windows side must use (127.0.0.1 unless the WSL port forward proved unreliable). */
  host: string;
  port: number;
}

const live = new Map<string, Handle>();
let keepAlive: ChildProcess | undefined;
let hooked = false;
let wslIp: string | undefined;

function runCtl(args: string[], timeoutMs = 90_000): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn('wsl.exe', [...WSL_ARGS, ...args], {
      env: ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      rej(new Error(`no-docker: wsl-ctl ${args[0]} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      rej(
        new Error(
          `no-docker: cannot run wsl.exe (${e.message}). Needs WSL with the ${DISTRO} distro; see test/support/no-docker/README.md`,
        ),
      );
    });
    child.on('close', () => {
      clearTimeout(timer);
      res((out + err).replace(/\0/g, '').trim());
    });
    child.stdin.end(SCRIPT);
  });
}

function runCtlSync(args: string[]): void {
  try {
    spawnSync('wsl.exe', [...WSL_ARGS, ...args], {
      env: ENV,
      input: SCRIPT,
      timeout: 20_000,
      windowsHide: true,
    });
  } catch {
    /* best effort */
  }
}

function cleanupAllSync(): void {
  for (const h of live.values()) runCtlSync([h.kind === 'pg' ? 'pg-stop' : 'redis-stop', h.id]);
  live.clear();
  try {
    keepAlive?.kill();
  } catch {
    /* ignore */
  }
}

function installHooks(): void {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupAllSync);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    const onSig = (): void => {
      cleanupAllSync();
      process.removeListener(sig, onSig);
      process.kill(process.pid, sig);
    };
    process.on(sig, onSig);
  }
  // Keep the WSL distro awake for the life of this process (background daemons alone do not keep it running).
  keepAlive = spawn('wsl.exe', ['-d', DISTRO, '--exec', 'sleep', '21600'], {
    env: ENV,
    stdio: 'ignore',
    windowsHide: true,
  });
  keepAlive.unref();
  keepAlive.on('error', () => undefined);
}

function windowsPortFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });
}

async function pickPort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1));
    if (await windowsPortFree(p)) return p;
  }
  throw new Error('no-docker: no free port found');
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((res) => {
    const s = connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      res(false);
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(t);
      s.destroy();
      res(true);
    });
    s.once('error', () => {
      clearTimeout(t);
      res(false);
    });
  });
}

/** 127.0.0.1 when the WSL localhost forward answers; otherwise the WSL VM address (WSL2 NAT mode without a working relay). */
async function reachableHost(port: number): Promise<string> {
  const forced = process.env.TEST_NO_DOCKER_HOST;
  if (forced) return forced;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await canConnect('127.0.0.1', port, 500)) return '127.0.0.1';
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!wslIp) {
    const r = spawnSync('wsl.exe', ['-d', DISTRO, '--exec', 'hostname', '-I'], {
      env: ENV,
      encoding: 'utf8',
      windowsHide: true,
    });
    wslIp = r.stdout.replace(/\0/g, '').trim().split(/\s+/)[0];
  }
  if (wslIp && (await canConnect(wslIp, port, 3_000))) return wslIp;
  throw new Error(
    `no-docker: port ${port} is not reachable from Windows on 127.0.0.1 or ${wslIp ?? 'the WSL VM address'}`,
  );
}

async function startWith(
  kind: 'pg' | 'redis',
  extra: (id: string, port: number) => string[],
): Promise<Handle> {
  installHooks();
  const run = process.env.TEST_NO_DOCKER_RUN ?? 'x';
  const id = `${run}_${process.pid}_${randomBytes(3).toString('hex')}`;
  let last = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await pickPort();
    last = await runCtl([kind === 'pg' ? 'pg-start' : 'redis-start', ...extra(id, port)]);
    if (last.includes(`READY ${port}`)) {
      const handle: Handle = { kind, id, host: '127.0.0.1', port };
      live.set(id, handle);
      try {
        handle.host = await reachableHost(port);
      } catch (e) {
        await stop(handle);
        throw e;
      }
      return handle;
    }
    if (!last.includes('PORT_BUSY')) break;
  }
  throw new Error(`no-docker: could not start ${kind} in WSL: ${last}`);
}

export function startPostgres(o: {
  database: string;
  username: string;
  password: string;
  settings: string[];
}): Promise<Handle> {
  return startWith('pg', (id, port) => [
    id,
    String(port),
    o.database,
    o.username,
    o.password,
    ...o.settings,
  ]);
}

export function startRedis(): Promise<Handle> {
  return startWith('redis', (id, port) => [id, String(port)]);
}

export async function stop(h: Handle): Promise<void> {
  if (!live.has(h.id)) return;
  live.delete(h.id);
  await runCtl([h.kind === 'pg' ? 'pg-stop' : 'redis-stop', h.id], 30_000).catch(() => undefined);
}

/** Removes every cluster / redis a run (tag) started. Called by the global-setup teardown. */
export async function cleanRun(tag: string): Promise<void> {
  await runCtl(['clean-run', tag], 60_000).catch(() => undefined);
}
