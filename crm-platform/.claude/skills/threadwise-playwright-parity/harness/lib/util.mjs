import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function appendLine(path, line) {
  ensureDir(dirname(path));
  appendFileSync(path, line + '\n');
}

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
export const sha = (s) => createHash('sha1').update(s).digest('hex');
export const shortId = () => randomBytes(3).toString('hex');

/** Normalise a URL to a comparable path template: ids/uuids/tokens collapse, query keys kept, values dropped. */
export function pathTemplate(url, origin = '') {
  let u;
  try {
    u = new URL(url, origin || 'http://x');
  } catch {
    return String(url).slice(0, 120);
  }
  const path = u.pathname
    .split('/')
    .map((seg) => {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg))
        return ':uuid';
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[A-Za-z0-9_-]{24,}$/.test(seg)) return ':token';
      return seg;
    })
    .join('/');
  const keys = [...new Set([...u.searchParams.keys()])].sort();
  return path + (keys.length ? '?' + keys.join('&') : '');
}

/** HTTP status -> behaviour class. Exact codes differ legitimately (302 vs 201, 422 vs 400), classes must not. */
export function statusClass(status) {
  if (status == null) return 'none';
  if (status >= 200 && status < 400) return 'ok';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 419) return 'session-expired';
  if (status === 429) return 'throttled';
  if (status === 400 || status === 422) return 'rejected';
  if (status >= 500) return 'crash';
  return 'client-error';
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const uniq = (xs) => [...new Set(xs)];

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

/** Run fn, return {value}|{error}; never throws. Used so one broken scenario cannot stop a run. */
export async function settle(fn) {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  }
}

export function oneLine(s, n = 160) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

export function parseArgs(argv, spec = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const kind = spec[k];
      if (inline !== undefined) out[k] = inline;
      else if (
        kind === 'bool' ||
        (kind === undefined && (i + 1 >= argv.length || argv[i + 1].startsWith('--')))
      )
        out[k] = true;
      else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

// Per-side values are written {threadwise: ..., ours: ...} (or {both: ...}). Anything else (a function, a string, a locator
// spec like {role:'button', name:/save/i}) is shared by both sides and returned as is.
const SIDE_KEYS = ['threadwise', 'ours', 'both'];
export const pick = (x, side) => {
  if (x == null) return undefined;
  const s = typeof side === 'object' ? side.side : side;
  if (
    typeof x !== 'object' ||
    x instanceof RegExp ||
    (typeof x.click === 'function' && typeof x.locator === 'function') ||
    !SIDE_KEYS.some((k) => Object.hasOwn(x, k))
  )
    return x;
  return x[s] ?? x.both;
};
