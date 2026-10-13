#!/usr/bin/env node
/**
 * Persistent scratch Postgres for REAL dry runs of the migration tool. Local only (127.0.0.1), throwaway passwords.
 *
 *   node scratch-db.cjs up      start (or restart) the container, apply every repo migration, write .scratch.env
 *   node scratch-db.cjs status  container, volume, port, disk, docker system df
 *   node scratch-db.cjs down    remove the container AND the volume (the data), delete .scratch.env
 *
 * Same approach as test/global-setup.ts (pgvector/pgvector:pg16, docker/postgres/init/01-app-roles.sql, then the repo migrations), but
 * the container is named, keeps a NAMED volume, and survives between commands. Refuses to start below 4 GB free on C:.
 */
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NAME = 'waboo-pilot-scratch';
const VOLUME = 'waboo-pilot-scratch-data';
const IMAGE = 'pgvector/pgvector:pg16';
const DB = 'crm_pilot';
const MIN_GB_UP = 4;
const MIN_GB_ANY = 3;
const REPO = path.resolve(__dirname, '../../..');
const ENV_FILE = path.join(__dirname, '.scratch.env');

const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
const dockerTry = (...a) => {
  try {
    return execFileSync('docker', a, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

function freeGb() {
  const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
  return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
}
function diskReport() {
  console.log(
    `free space on ${process.platform === 'win32' ? 'C:' : '/'}: ${freeGb().toFixed(2)} GB`,
  );
  spawnSync('docker', ['system', 'df'], { stdio: 'inherit' });
}
const exists = () => dockerTry('inspect', '-f', '{{.State.Status}}', NAME);

function superPassword() {
  const env = docker('inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', NAME);
  return env
    .split(/\r?\n/)
    .find((l) => l.startsWith('POSTGRES_PASSWORD='))
    .slice('POSTGRES_PASSWORD='.length);
}
const hostPort = () => docker('port', NAME, '5432/tcp').split(/\r?\n/)[0].split(':').pop();

async function waitReady(pw) {
  const t0 = Date.now();
  for (;;) {
    // over TCP: the init-time temporary server listens on the unix socket only, so this is true only for the final server
    const r = spawnSync(
      'docker',
      [
        'exec',
        '-e',
        `PGPASSWORD=${pw}`,
        NAME,
        'psql',
        '-h',
        '127.0.0.1',
        '-U',
        'crm',
        '-d',
        'postgres',
        '-tAc',
        'select 1',
      ],
      { encoding: 'utf8' },
    );
    if (r.status === 0 && r.stdout.trim() === '1') return;
    if (Date.now() - t0 > 120000) throw new Error('postgres did not become ready in 120 s');
    await new Promise((r2) => setTimeout(r2, 1000));
  }
}

async function up() {
  const gb = freeGb();
  diskReport();
  if (gb < MIN_GB_UP)
    throw new Error(
      `refusing to start: ${gb.toFixed(2)} GB free on C:, need at least ${MIN_GB_UP} GB (hard floor ${MIN_GB_ANY} GB)`,
    );
  docker('version', '--format', '{{.Server.Version}}');
  const state = exists();
  let pw;
  if (state === null) {
    pw = crypto.randomBytes(12).toString('hex');
    docker(
      'run',
      '-d',
      '--name',
      NAME,
      '-v',
      `${VOLUME}:/var/lib/postgresql/data`,
      '-e',
      'POSTGRES_USER=crm',
      '-e',
      `POSTGRES_PASSWORD=${pw}`,
      '-e',
      'POSTGRES_DB=postgres',
      '-p',
      '127.0.0.1::5432',
      IMAGE,
    );
  } else {
    pw = superPassword();
    if (state !== 'running') docker('start', NAME);
  }
  await waitReady(pw);
  const sup = (sql, db = 'postgres') =>
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${pw}`,
        NAME,
        'psql',
        '-h',
        '127.0.0.1',
        '-U',
        'crm',
        '-d',
        db,
        '-v',
        'ON_ERROR_STOP=1',
        '-tA',
      ],
      { input: sql, encoding: 'utf8' },
    ).trim();
  // the two login roles docker/postgres/init creates (idempotent); migration 0007 then grants them the group roles
  sup(fs.readFileSync(path.join(REPO, 'docker/postgres/init/01-app-roles.sql'), 'utf8'));
  if (sup(`select 1 from pg_database where datname = '${DB}'`) !== '1')
    sup(`create database ${DB}`);
  const port = hostPort();
  const owner = `postgres://crm:${pw}@127.0.0.1:${port}/${DB}`;
  const tsx = path.join(REPO, 'packages/db/node_modules/tsx/dist/cli.mjs');
  if (!fs.existsSync(tsx))
    throw new Error('packages/db/node_modules/tsx is missing: run pnpm install in crm-platform');
  const out = execFileSync(process.execPath, [tsx, 'src/cli/migrate.ts', 'up'], {
    cwd: path.join(REPO, 'packages/db'),
    env: { ...process.env, MIGRATION_DATABASE_URL: owner, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  console.log(`${out.trim().split(String.fromCharCode(10)).pop().slice(0, 80)} ...`);
  const worker = `postgres://crm_worker_user:crm_worker_dev@127.0.0.1:${port}/${DB}`;
  const check = sup(
    `select count(*) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`,
    DB,
  );
  fs.writeFileSync(
    ENV_FILE,
    `# throwaway local credentials of ${NAME}; git-excluded by pilot/.gitignore; deleted by "down"\nTARGET_DATABASE_URL=${worker}\nMIGRATION_DATABASE_URL=${owner}\n`,
  );
  console.log(`\n${NAME} is up: ${check} tables in ${DB}, 127.0.0.1:${port}`);
  console.log(
    `TARGET_DATABASE_URL=${worker}\nMIGRATION_DATABASE_URL=${owner}\n(written to ${ENV_FILE})`,
  );
}

function status() {
  const st = exists();
  console.log(`container ${NAME}: ${st === null ? 'absent' : st}`);
  if (st === 'running') console.log(`port: 127.0.0.1:${hostPort()}`);
  console.log(
    `volume ${VOLUME}: ${dockerTry('volume', 'inspect', '-f', '{{.Name}}', VOLUME) ? 'present' : 'absent'}`,
  );
  console.log(`env file: ${fs.existsSync(ENV_FILE) ? ENV_FILE : 'absent'}`);
  diskReport();
}

function down() {
  dockerTry('rm', '-f', '-v', NAME);
  dockerTry('volume', 'rm', '-f', VOLUME);
  fs.rmSync(ENV_FILE, { force: true });
  console.log(
    `${NAME}: container ${exists() === null ? 'removed' : 'STILL PRESENT'}, volume ${dockerTry('volume', 'inspect', '-f', '{{.Name}}', VOLUME) ? 'STILL PRESENT' : 'removed'}, env file removed`,
  );
}

const cmd = process.argv[2];
const table = { up, status, down };
if (!table[cmd]) {
  console.error('usage: node scratch-db.cjs up|status|down');
  process.exit(2);
}
Promise.resolve(table[cmd]()).catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
