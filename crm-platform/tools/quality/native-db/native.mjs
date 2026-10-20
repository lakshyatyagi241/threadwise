// Native stand-ins for Testcontainers: a Postgres cluster copied from a pre-migrated template, and a redis-server, per start().
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const PGBIN = '/usr/lib/postgresql/16/bin';
export const TEMPLATE = process.env.PG_TEMPLATE_DIR || '/tmp/native-db/template';
const ROOT = '/tmp/native-db/run';
mkdirSync(ROOT, { recursive: true });

const live = new Set();
export const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
const asPg = (args) =>
  spawnSync('runuser', ['-u', 'postgres', '--', ...args], { encoding: 'utf8' });

export async function startPg() {
  const id = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = `${ROOT}/${id}`;
  const cp = spawnSync('cp', ['-a', TEMPLATE, dir]);
  if (cp.status !== 0) throw new Error('template copy failed: ' + cp.stderr);
  const port = await freePort();
  const r = asPg([
    `${PGBIN}/pg_ctl`,
    '-D',
    dir,
    '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir}`,
    '-l',
    `${dir}/log.txt`,
    '-w',
    '-t',
    '60',
    'start',
  ]);
  if (r.status !== 0) throw new Error('pg start failed: ' + r.stdout + r.stderr);
  const h = {
    dir,
    port,
    stop: () => {
      try {
        asPg([`${PGBIN}/pg_ctl`, '-D', dir, '-m', 'immediate', '-w', 'stop']);
      } catch {}
      rmSync(dir, { recursive: true, force: true });
      live.delete(h);
    },
  };
  live.add(h);
  return h;
}

export async function startRedis() {
  const port = await freePort();
  const child = spawn(
    'redis-server',
    ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 50; i++) {
    try {
      if (
        execFileSync('redis-cli', ['-p', String(port), 'ping'], { encoding: 'utf8' }).trim() ===
        'PONG'
      )
        break;
    } catch {}
    await sleep(100);
  }
  const h = {
    port,
    stop: () => {
      child.kill('SIGKILL');
      live.delete(h);
    },
  };
  live.add(h);
  return h;
}

const cleanup = () => {
  for (const h of [...live]) h.stop();
};
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM'])
  process.on(s, () => {
    cleanup();
    process.exit(1);
  });
