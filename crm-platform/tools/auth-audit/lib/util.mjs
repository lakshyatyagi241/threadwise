// Small helpers shared by the checks. Zero dependencies on purpose: the audit must run on a fresh clone, on Windows,
// before (or without) `pnpm install`.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** crm-platform/ */
export const ROOT = resolve(TOOL_DIR, '..', '..');
/** The git root (one level above crm-platform in the threadwise-port layout; the same as ROOT in a standalone clone). */
export const REPO_ROOT = existsSync(join(ROOT, '.git')) ? ROOT : resolve(ROOT, '..');

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const sevRank = (s) => {
  const i = SEVERITIES.indexOf(s);
  return i === -1 ? 99 : i;
};

export const toPosix = (p) => p.split(sep).join('/');
export const rel = (abs) => toPosix(relative(ROOT, abs));
export const abs = (relPath) => join(ROOT, relPath);

const fileCache = new Map();

/** File text relative to crm-platform/, or null when it does not exist. */
export function read(relPath) {
  if (fileCache.has(relPath)) return fileCache.get(relPath);
  const p = abs(relPath);
  let text = null;
  try {
    if (existsSync(p) && statSync(p).isFile()) text = readFileSync(p, 'utf8');
  } catch {
    text = null;
  }
  fileCache.set(relPath, text);
  return text;
}

export const exists = (relPath) => existsSync(abs(relPath));

/**
 * Value of `key: 15 * 60,` / `key: 3600,` style constants (products of integers). Plain `(\d+)` regexes read
 * `60 * 60` as 60, which is how a one-hour token looked like a one-minute token.
 */
export function numExpr(relPath, key) {
  const m = new RegExp(`\\b${key}\\s*[:=]\\s*([\\d_*\\s]+?)\\s*[,;\\n]`).exec(read(relPath) ?? '');
  if (!m) return null;
  const parts = m[1].split('*').map((x) => Number(x.replace(/_/g, '').trim()));
  return parts.every((x) => Number.isFinite(x)) ? parts.reduce((a, b) => a * b, 1) : null;
}

/** [{ file, line, text }] for every line of `relPath` matching `re` (max `max`). */
export function grepFile(relPath, re, max = 5) {
  const text = read(relPath);
  if (text == null) return [];
  const out = [];
  const rx = new RegExp(re.source, re.flags.replace('g', ''));
  const ls = text.split(/\r?\n/);
  for (let i = 0; i < ls.length && out.length < max; i++) {
    if (rx.test(ls[i])) out.push({ file: relPath, line: i + 1, text: ls[i].trim().slice(0, 200) });
  }
  return out;
}

/** Same as grepFile over several files; keeps the first `max` hits overall. */
export function grepFiles(relPaths, re, max = 8) {
  const out = [];
  for (const f of relPaths) {
    for (const hit of grepFile(f, re, max - out.length)) out.push(hit);
    if (out.length >= max) break;
  }
  return out;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-cli',
  '.next',
  '.turbo',
  'coverage',
  '.git',
  'build',
  'out',
]);

/** Recursive file listing (relative to crm-platform/), skipping build and dependency folders. */
export function walk(relDir, accept = () => true) {
  const out = [];
  const start = abs(relDir);
  if (!existsSync(start)) return out;
  const stack = [start];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name));
      } else {
        const r = rel(join(dir, e.name));
        if (accept(r)) out.push(r);
      }
    }
  }
  return out.sort();
}

/** The text of the function/method whose declaration line matches `startRe`, up to its closing brace at the same indent. */
export function bodyOf(relPath, startRe) {
  const text = read(relPath);
  if (text == null) return null;
  const ls = text.split(/\r?\n/);
  const rx = new RegExp(startRe.source, startRe.flags.replace('g', ''));
  const i = ls.findIndex((l) => rx.test(l));
  if (i === -1) return null;
  const indent = /^\s*/.exec(ls[i])[0].length;
  let end = i + 1;
  while (end < ls.length) {
    const l = ls[end];
    if (l.trim() !== '' && /^\s*/.exec(l)[0].length <= indent && /^\s*[}\]]/.test(l)) break;
    end++;
  }
  return { text: ls.slice(i, end + 1).join('\n'), line: i + 1, file: relPath };
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function which(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);

/**
 * Runs a command and captures its output. Windows needs a shell for pnpm/npx shims, so the command line is built
 * (and quoted) here once instead of at every call site.
 */
export function run(cmd, args = [], opts = {}) {
  const started = Date.now();
  const useShell = process.platform === 'win32';
  return new Promise((resolveRun) => {
    const child = useShell
      ? spawn([cmd, ...args].map(quote).join(' '), {
          shell: true,
          cwd: opts.cwd ?? ROOT,
          env: { ...process.env, ...opts.env },
        })
      : spawn(cmd, args, { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env } });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : null;
    child.stdout?.on('data', (d) => {
      stdout += d;
      if (opts.tee) process.stdout.write(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
      if (opts.tee) process.stderr.write(d);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolveRun({
        code: -1,
        stdout,
        stderr: stderr + String(err),
        ms: Date.now() - started,
        timedOut,
      });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolveRun({ code: code ?? -1, stdout, stderr, ms: Date.now() - started, timedOut });
    });
  });
}

export const log = {
  step: (m) => console.log(`\n\x1b[1m▶ ${m}\x1b[0m`),
  ok: (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`),
  warn: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`),
  bad: (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`),
  info: (m) => console.log(`    ${m}`),
};

/** Result constructor so every check reports the same shape. */
export function result(partial) {
  return {
    status: 'info',
    severity: undefined,
    controls: [],
    evidence: [],
    confidence: 'static',
    ...partial,
  };
}

export function fmtMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
