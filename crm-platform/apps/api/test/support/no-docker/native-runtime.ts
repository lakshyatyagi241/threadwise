/**
 * The Docker-free runtime for macOS and Linux: throwaway Postgres clusters and Redis servers started straight from the Postgres 16 and
 * Redis binaries on this machine (Homebrew, or `PG_BIN` / `/usr/lib/postgresql/16/bin`). Same contract as `wsl-runtime.ts` (which
 * does it inside WSL on Windows); `runtime.ts` picks one by platform. Only imports node built-ins, so the vitest aliases for
 * `testcontainers` / `@testcontainers/postgresql` can never loop back into it.
 *
 * Everything it creates is `/tmp/tc_nodocker_<pg|redis>_<run>_<pid>_<rand>` (/tmp, not os.tmpdir(): a unix socket path must stay under
 * about 100 characters on macOS). It never touches any other cluster.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, connect } from 'node:net';
import { join } from 'node:path';

const ROOT = '/tmp';
const PREFIX = 'tc_nodocker_';
const PORT_MIN = 21000;
const PORT_MAX = 31999;
// macOS needs a real UTF-8 locale in the environment or the postmaster refuses to start ("became multithreaded").
const ENV = { ...process.env, LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8' };

export interface Handle {
  kind: 'pg' | 'redis';
  id: string;
  host: string;
  port: number;
}

const live = new Map<string, Handle>();
let hooked = false;

/** The Postgres 16 `bin` directory: PG_BIN, else Homebrew, else the Debian layout, else whatever `pg_config` says. */
function pgBin(): string {
  const candidates = [
    process.env.PG_BIN,
    '/opt/homebrew/opt/postgresql@16/bin',
    '/usr/local/opt/postgresql@16/bin',
    '/usr/lib/postgresql/16/bin',
  ];
  for (const c of candidates) if (c && existsSync(join(c, 'initdb'))) return c;
  const r = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
  const dir = r.status === 0 ? r.stdout.trim() : '';
  if (dir && existsSync(join(dir, 'initdb'))) return dir;
  throw new Error(
    'no-docker: Postgres 16 binaries not found. Install postgresql@16 (and pgvector), or set PG_BIN to its bin directory.',
  );
}

const dirOf = (kind: 'pg' | 'redis', id: string): string => join(ROOT, `${PREFIX}${kind}_${id}`);

function run(
  cmd: string,
  args: string[],
  timeoutMs = 90_000,
): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ code: 127, out: `${cmd}: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code: code ?? 1, out: out.trim() });
    });
  });
}

function stopDirSync(dir: string): void {
  try {
    if (existsSync(join(dir, 'data', 'postmaster.pid'))) {
      spawnSync(
        join(pgBin(), 'pg_ctl'),
        ['-D', join(dir, 'data'), '-m', 'immediate', '-w', 'stop'],
        { env: ENV, timeout: 20_000 },
      );
    }
    const redisPid = join(dir, 'redis.pid');
    if (existsSync(redisPid)) {
      const pid = Number(readFileSync(redisPid, 'utf8').trim());
      if (pid > 1) process.kill(pid, 'SIGKILL');
    }
  } catch {
    /* best effort: the directory is removed below either way */
  }
  rmSync(dir, { recursive: true, force: true });
}

function cleanupAllSync(): void {
  for (const h of live.values()) stopDirSync(dirOf(h.kind, h.id));
  live.clear();
}

function installHooks(): void {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupAllSync);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    const onSig = (): void => {
      cleanupAllSync();
      process.removeListener(sig, onSig);
      process.kill(process.pid, sig);
    };
    process.on(sig, onSig);
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });
}

async function pickPort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1));
    if (await portFree(p)) return p;
  }
  throw new Error('no-docker: no free port found');
}

function canConnect(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((res) => {
    const s = connect({ host: '127.0.0.1', port });
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

/** Removes clusters that a killed run left behind (older than 3 hours); called on every start. */
function reapOld(): void {
  const cutoff = Date.now() - 3 * 3600_000;
  for (const name of readdirSync(ROOT)) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = join(ROOT, name);
    try {
      if (statSync(dir).mtimeMs < cutoff) stopDirSync(dir);
    } catch {
      /* gone already */
    }
  }
}

function newId(): string {
  const tag = process.env.TEST_NO_DOCKER_RUN ?? 'x';
  return `${tag}_${process.pid}_${randomBytes(3).toString('hex')}`;
}

export async function startPostgres(o: {
  database: string;
  username: string;
  password: string;
  settings: string[];
}): Promise<Handle> {
  installHooks();
  reapOld();
  const bin = pgBin();
  const id = newId();
  const dir = dirOf('pg', id);
  mkdirSync(join(dir, 'sock'), { recursive: true });
  const pwfile = join(dir, 'pw');
  writeFileSync(pwfile, o.password, { mode: 0o600 });
  const init = await run(join(bin, 'initdb'), [
    '-D',
    join(dir, 'data'),
    '-U',
    o.username,
    `--pwfile=${pwfile}`,
    '--auth-host=scram-sha-256',
    '--auth-local=trust',
    '-E',
    'UTF8',
    '--locale=C',
    '--no-sync',
  ]);
  rmSync(pwfile, { force: true });
  if (init.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`no-docker: initdb failed: ${init.out.slice(-400)}`);
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await pickPort();
    const opts = [
      `-p ${port}`,
      '-c listen_addresses=127.0.0.1',
      `-c unix_socket_directories=${join(dir, 'sock')}`,
      '-c fsync=off',
      '-c synchronous_commit=off',
      '-c full_page_writes=off',
      '-c shared_buffers=16MB',
      '-c max_connections=100',
      '-c jit=off',
      '-c max_wal_size=256MB',
      '-c log_min_messages=fatal',
      ...o.settings.map((kv) => `-c ${kv}`),
    ].join(' ');
    const start = await run(join(bin, 'pg_ctl'), [
      '-D',
      join(dir, 'data'),
      '-l',
      join(dir, 'server.log'),
      '-w',
      '-t',
      '60',
      '-o',
      opts,
      'start',
    ]);
    if (start.code !== 0) {
      const log = existsSync(join(dir, 'server.log'))
        ? readFileSync(join(dir, 'server.log'), 'utf8')
        : '';
      if (/Address already in use|could not create any TCP\/IP sockets/.test(log)) continue; // lost the race for the port: pick another
      stopDirSync(dir);
      throw new Error(`no-docker: pg_ctl start failed: ${(start.out + log).slice(-400)}`);
    }
    if (o.database !== 'postgres') {
      const db = await run(join(bin, 'psql'), [
        '-h',
        join(dir, 'sock'),
        '-p',
        String(port),
        '-U',
        o.username,
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-qc',
        `CREATE DATABASE "${o.database}"`,
      ]);
      if (db.code !== 0) {
        stopDirSync(dir);
        throw new Error(`no-docker: CREATE DATABASE failed: ${db.out}`);
      }
    }
    const handle: Handle = { kind: 'pg', id, host: '127.0.0.1', port };
    live.set(id, handle);
    return handle;
  }
  stopDirSync(dir);
  throw new Error('no-docker: could not find a free port for Postgres');
}

export async function startRedis(): Promise<Handle> {
  installHooks();
  reapOld();
  const id = newId();
  const dir = dirOf('redis', id);
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await pickPort();
    const r = await run('redis-server', [
      '--port',
      String(port),
      '--save',
      '',
      '--appendonly',
      'no',
      '--bind',
      '127.0.0.1',
      '--daemonize',
      'yes',
      '--dir',
      dir,
      '--pidfile',
      join(dir, 'redis.pid'),
      '--logfile',
      join(dir, 'redis.log'),
      '--protected-mode',
      'no',
      '--maxmemory',
      '64mb',
    ]);
    if (r.code === 127) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error('no-docker: redis-server not found. Install redis (brew install redis).');
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !(await canConnect(port, 200)))
      await new Promise((x) => setTimeout(x, 50));
    if (await canConnect(port, 200)) {
      const handle: Handle = { kind: 'redis', id, host: '127.0.0.1', port };
      live.set(id, handle);
      return handle;
    }
    const log = existsSync(join(dir, 'redis.log'))
      ? readFileSync(join(dir, 'redis.log'), 'utf8')
      : '';
    if (!/Address already in use/.test(log)) break;
  }
  stopDirSync(dir);
  throw new Error('no-docker: could not start redis-server');
}

export async function stop(h: Handle): Promise<void> {
  if (!live.has(h.id)) return;
  live.delete(h.id);
  stopDirSync(dirOf(h.kind, h.id));
}

/** Removes every cluster / redis a run (tag) started. Called by the global-setup teardown. */
export async function cleanRun(tag: string): Promise<void> {
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith(PREFIX) && name.includes(`_${tag}_`)) stopDirSync(join(ROOT, name));
  }
}
