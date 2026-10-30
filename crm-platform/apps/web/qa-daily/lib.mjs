// Small helpers shared by daily.mjs, fix.mjs and maintain.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB = resolve(HERE, '..'); // crm-platform/apps/web
export const REPO = resolve(WEB, '../..'); // crm-platform
export const OUT = join(HERE, 'out');
/** Worktrees live outside the repo: inside it, tsc and the bundlers also compile the nested copy. */
export const STATE = process.env.QA_STATE_DIR ?? `${process.env.HOME}/.local/state/wadesk-qa`;
export const WORKTREES = join(STATE, 'worktrees');
mkdirSync(WORKTREES, { recursive: true });
export const DATE = new Date().toISOString().slice(0, 10);
mkdirSync(OUT, { recursive: true });

/** The git root can be above crm-platform (a workspace repo): worktrees then hold crm-platform/ as a sub-folder. */
export const PREFIX = execFileSync('git', ['rev-parse', '--show-prefix'], {
  cwd: REPO,
  encoding: 'utf8',
}).trim();
/** A changed path relative to the app folder; anything outside it is returned as ../x and is always protected. */
export const appRelative = (f) => (f.startsWith(PREFIX) ? f.slice(PREFIX.length) : `../${f}`);

/** A fresh worktree has no untracked .env: link the checkout's own, else start from .env.example like CI does. */
export function ensureEnv(appDir) {
  const target = join(appDir, '.env');
  if (existsSync(target)) return;
  if (existsSync(join(REPO, '.env'))) symlinkSync(join(REPO, '.env'), target);
  else copyFileSync(join(appDir, '.env.example'), target);
}

/** Failing unit tests in vitest output, as "file > test name". Used to tell a failure the fix caused from one that was already there. */
export function failingTests(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const found = new Set();
  for (const m of clean.matchAll(/FAIL\s+(\S+\.test\.[a-z]+)\s*>\s*(.+)$/gm))
    found.add(`${m[1]} > ${m[2].trim()}`);
  return found;
}

export const log = (...a) => console.log(`[qa ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** Run a command, return trimmed stdout; throws with the tail of stderr on failure. */
export function sh(cmd, args, opts = {}) {
  try {
    return String(
      execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts }) ?? '',
    ).trim();
  } catch (e) {
    const err = String(e.stderr || e.stdout || e.message)
      .split('\n')
      .slice(-12)
      .join('\n');
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${err}`);
  }
}
/** Like sh but never throws: { ok, out }. For steps whose failure is information, not an error. */
export function tryRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const git = (cwd, ...a) => sh('git', a, { cwd });

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}
export const writeJson = (path, v) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2));
};

/** Settings per target. Secrets only ever come from the environment (a .env.qa file next to this one is sourced by run scripts). */
export function targetConfig(env) {
  if (env === 'prod')
    return {
      env,
      base: process.env.QA_BASE_URL ?? 'https://desk.wabo.ai',
      need: ['QA_EMAIL', 'QA_PASSWORD', 'QA_OP_EMAIL', 'QA_OP_PASSWORD'],
    };
  return { env: 'local', base: process.env.QA_BASE_URL ?? 'http://localhost:3001', need: [] };
}

/** Is the site itself up? A down site is an environment problem, not a hundred bug rows. */
export async function probe(base) {
  for (const path of ['/login', '/api/health']) {
    try {
      const r = await fetch(base + path, {
        signal: AbortSignal.timeout(20_000),
        redirect: 'manual',
      });
      if (r.status >= 500) return { up: false, why: `${path} answered ${r.status}` };
    } catch (e) {
      return { up: false, why: `${path}: ${e.cause?.code ?? e.message}` };
    }
  }
  return { up: true };
}

export const have = (p) => existsSync(p);

/** Paths a fix may change but that must never merge without a person: auth, tenancy/RLS, migrations, deploy, CI, secrets. */
export const PROTECTED = [
  /^\.\.\//, // outside the app folder
  /^apps\/api\/src\/modules\/(auth|tenancy|platform-auth)\//,
  /^packages\/db\//,
  /migrations?\//,
  /^deploy\//,
  /^\.github\//,
  /^\.claude\//,
  /^tools\/(tenancy-audit|authz-audit)\//,
  /(^|\/)(\.env|secrets?)/,
  /^apps\/web\/qa-daily\//, // the automation itself (it runs with the prod QA credentials): a person reviews every change to it
];
export const isProtected = (file) => PROTECTED.some((re) => re.test(file));
