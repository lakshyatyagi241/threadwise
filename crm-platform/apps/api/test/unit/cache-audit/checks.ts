import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  API_SRC,
  counterHasTtl,
  rel,
  setHasTtl,
  walk,
  type CollectionHit,
  type RedisCall,
} from './scan';

/**
 * The ratchet rules of the cache audit (Sheet3 #64), as pure functions: each takes what the scanners found plus the register and
 * returns a list of violations (empty = pass). The spec runs them on the real source; the bad-example tests run them on deliberately
 * wrong input to prove each one can fail.
 */
/** A cache's instrumentation block as the register writes it: the rules and the spec read these fields. */
export interface CacheInstrumentation {
  instrumented: boolean;
  metrics: string[];
  exemption?: string;
  reason?: string;
  hitRatioAlert?: boolean;
  [field: string]: unknown;
}

/** One cache in the register. Only the fields the rules read are typed; the rest of the entry is kept as it is. */
export interface CacheEntry {
  id: string;
  layer: string;
  location: string;
  priority?: string;
  ttl?: unknown;
  ttlException?: string;
  bound?: CacheBound;
  tenant?: CacheTenant;
  instrumentation: CacheInstrumentation;
  [field: string]: unknown;
}

/** How a cache is capped; the rule reads the note that says why it cannot grow without limit. */
export interface CacheBound {
  note?: string;
  [field: string]: unknown;
}

/** How a cache's key is scoped to a tenant: the mode, and the key part that must carry the organisation (and user) id. */
export interface CacheTenant {
  mode?: string;
  anchor?: string;
  reason?: string;
  [field: string]: unknown;
}

export interface Register {
  caches: CacheEntry[];
  redisFamilies: RedisFamily[];
  redisWriters: Record<string, string>;
  redisNoTtlAllowed: Record<string, string>;
  inProcessFields: Record<string, { cache?: string; allow?: string }>;
  httpPublicAllowed: Record<string, string>;
  rbacWriters: Record<string, string>;
}

/** A Redis key family as the rules read it: its id and files, the reason it is keyed as it is, and its time to live. */
export interface RedisFamily {
  id: string;
  files: string[];
  tenant?: { reason?: string };
  ttl?: string;
}

export const REGISTER_PATH = join(REPO_ROOT, 'docs/performance/cache/register.json');
export const loadRegister = (): Register =>
  JSON.parse(readFileSync(REGISTER_PATH, 'utf8')) as Register;

const short = (f: string) => f.replace('apps/api/src/', '');
const MIN_REASON = 30;

/** Rule 1: every mutable Map/Set is bounded (size cap or TTL sweep) or on the commented allowlist; the register has no dead entries. */
export function checkCollections(hits: CollectionHit[], reg: Register): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = `${short(h.file)}#${h.name}`;
    seen.add(id);
    const e = reg.inProcessFields[id];
    if (!e) {
      out.push(
        `${id}: a mutable ${h.ctor} that is not in register.json inProcessFields. Bound it (setCapped / CappedMap) or list it with a reason.`,
      );
      continue;
    }
    if (e.cache && !reg.caches.some((c) => c.id === e.cache))
      out.push(`${id}: refers to cache ${e.cache}, which is not in the register.`);
    if (
      !h.sizeCapped &&
      !e.allow &&
      !(
        e.cache &&
        /ttl|in-flight|finite|singleton|size-cap/.test(
          JSON.stringify(reg.caches.find((c) => c.id === e.cache)?.bound ?? ''),
        )
      )
    ) {
      out.push(`${id}: unbounded (no size cap found) and not allowlisted with a reason.`);
    }
    if (!h.sizeCapped && e.cache) {
      const bound = reg.caches.find((c) => c.id === e.cache)?.bound;
      if (!bound?.note || bound.note.length < MIN_REASON)
        out.push(
          `${id}: not size-capped; the register entry ${e.cache} must explain in bound.note why it cannot grow without limit.`,
        );
    }
    if (e.allow !== undefined && e.allow.length < MIN_REASON)
      out.push(`${id}: allowlist reason is too short to be a reason.`);
  }
  for (const id of Object.keys(reg.inProcessFields))
    if (!seen.has(id))
      out.push(
        `${id}: in register.json but no such mutable collection exists any more (remove it).`,
      );
  return out;
}

/** Rule 2 and 3: every Redis writer file is registered; every cache write has a TTL; counters get theirs in the same transaction. */
export function checkRedisWrites(
  calls: RedisCall[],
  reg: Register,
  fileExists: (f: string) => boolean = (f) => existsSync(join(API_SRC, f)),
  opts: { stale?: boolean } = { stale: true },
): string[] {
  const out: string[] = [];
  const files = new Set(calls.map((c) => short(c.file)));
  for (const f of files)
    if (!reg.redisWriters[f])
      out.push(
        `${f}: writes to Redis but is not in register.json redisWriters (add it to a cache or a family).`,
      );
  for (const [f, id] of Object.entries(reg.redisWriters)) {
    if (!fileExists(f)) out.push(`${f}: listed in redisWriters but the file does not exist.`);
    const known = reg.caches.some((c) => c.id === id) || reg.redisFamilies.some((x) => x.id === id);
    if (!known) out.push(`${f}: maps to ${id}, which is neither a cache nor a family.`);
  }
  for (const c of calls) {
    const f = short(c.file);
    if (c.method === 'eval' || c.method === 'evalsha') continue;
    const allowed = reg.redisNoTtlAllowed[f];
    if (
      c.method === 'set' ||
      c.method === 'setex' ||
      c.method === 'psetex' ||
      c.method === 'setnx' ||
      c.method === 'getset' ||
      c.method === 'append' ||
      c.method === 'mset'
    ) {
      if (!setHasTtl(c) && !allowed)
        out.push(
          `${f}:${c.line} ${c.receiver}.${c.method}(${c.args[0]}): stored without a time to live.`,
        );
      continue;
    }
    if (c.method === 'incr' || c.method === 'incrby' || c.method === 'incrbyfloat') {
      if (c.chain.includes('multi') && c.after.some((m) => /^p?expire$/i.test(m))) continue; // multi().incr().expire(): one transaction
      if (/\.(p?expire)\(/i.test(c.scope) && !allowed)
        out.push(
          `${f}:${c.line} INCR and EXPIRE are separate commands: if the second is lost the counter never expires. Use incrWithTtl().`,
        );
      else if (!counterHasTtl(c) && !allowed)
        out.push(
          `${f}:${c.line} ${c.receiver}.${c.method}(${c.args[0]}): a counter with no expiry.`,
        );
      continue;
    }
    if (c.method === 'decr') continue;
    if (!counterHasTtl(c) && !allowed)
      out.push(
        `${f}:${c.line} ${c.receiver}.${c.method}(${c.args[0]}): no expiry set in the same pipeline or function.`,
      );
  }
  if (opts.stale ?? true)
    for (const f of Object.keys(reg.redisNoTtlAllowed))
      if (!files.has(f))
        out.push(
          `${f}: has a no-TTL allowance but no longer writes to Redis (remove the allowance).`,
        );
  return out;
}

let sourceCache: string[] | null = null;
/** True when any API or web source file contains the text (keys may be built in a sibling file). */
function sourceContains(needle: string): boolean {
  sourceCache ??= [...walk(API_SRC), ...walk(join(REPO_ROOT, 'apps/web/src'))].map((f) =>
    readFileSync(f, 'utf8'),
  );
  return sourceCache.some((t) => t.includes(needle));
}

const REQUIRED = [
  'id',
  'name',
  'layer',
  'priority',
  'location',
  'what',
  'key',
  'tenant',
  'ttl',
  'bound',
  'invalidation',
  'stampede',
  'backingStoreFailure',
  'staleWindow',
  'hitMissPoint',
  'status',
];

/** Rule 4: every register entry is complete; keys carry the organisation or say in writing why not; anchors exist in the code. */
export function checkRegisterEntries(
  reg: Register,
  anywhere: (needle: string) => boolean = sourceContains,
  read: (f: string) => string | null = (f) => {
    const p = join(REPO_ROOT, f);
    if (!existsSync(p)) return null;
    return statSync(p).isDirectory() ? '' : readFileSync(p, 'utf8');
  },
): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const c of reg.caches) {
    if (ids.has(c.id)) out.push(`${c.id}: duplicate id.`);
    ids.add(c.id);
    for (const k of REQUIRED)
      if (c[k] === undefined || c[k] === '') out.push(`${c.id}: missing field "${k}".`);
    if (!['P0', 'P1'].includes(c.priority ?? '')) out.push(`${c.id}: priority must be P0 or P1.`);
    const t: CacheTenant = c.tenant ?? {};
    if (t.mode === 'org' || t.mode === 'org+user') {
      if (!t.anchor) out.push(`${c.id}: tenant-keyed but has no key anchor to check.`);
      else if (!/org/i.test(t.anchor))
        out.push(`${c.id}: tenant.anchor "${t.anchor}" does not contain the organisation id.`);
      if (t.mode === 'org+user' && t.anchor && !/user|actor/i.test(t.anchor))
        out.push(`${c.id}: per-user value but the key anchor has no user id.`);
    } else if (
      t.mode === 'global' ||
      t.mode === 'id-unique' ||
      t.mode === 'per-session' ||
      t.mode === 'mixed'
    ) {
      if (!t.reason || t.reason.length < MIN_REASON)
        out.push(`${c.id}: not keyed by organisation (${t.mode}) and no written reason.`);
    } else out.push(`${c.id}: unknown tenant mode "${t.mode}".`);
    if (c.layer === 'redis' && !c.ttlException && !/\d/.test(String(c.ttl)))
      out.push(`${c.id}: Redis cache with no TTL and no ttlException.`);
    const text = read(c.location);
    if (text === null) out.push(`${c.id}: location ${c.location} does not exist.`);
    else if (t.anchor && !text.includes(t.anchor) && !anywhere(t.anchor))
      out.push(
        `${c.id}: key anchor "${t.anchor}" not found in the source (the key design changed; update the register).`,
      );
  }
  for (const f of reg.redisFamilies) {
    const x = f;
    if (!x.tenant?.reason || x.tenant.reason.length < MIN_REASON)
      out.push(`${x.id}: family has no tenant reason.`);
    if (!x.ttl) out.push(`${x.id}: family has no ttl description.`);
  }
  return out;
}

/** Rule 5: `public` cache headers only on routes that are public by design and written down; one place sets them for authenticated data. */
export function checkHttpCache(
  files: Array<{ file: string; text: string }>,
  reg: Register,
): string[] {
  const out: string[] = [];
  const has = new Set<string>();
  for (const { file, text } of files) {
    // a header value, not a comment: quoted `public,` or `public` followed by max-age / s-maxage
    if (!/['"`]public,\s*(max-age|s-maxage|immutable|stale)/i.test(text)) continue;
    has.add(file);
    if (!reg.httpPublicAllowed[file])
      out.push(
        `${file}: sends "Cache-Control: public" but is not in register.json httpPublicAllowed with a reason.`,
      );
  }
  for (const [f, reason] of Object.entries(reg.httpPublicAllowed)) {
    if (reason.length < MIN_REASON) out.push(`${f}: public-cache reason is too short.`);
    if (!has.has(f))
      out.push(`${f}: allowed to send public caching but no longer does (remove the entry).`);
  }
  return out;
}

/** Rule 6 (invalidation, for item #66): code that writes role/grant tables is known and says who bumps the version. */
export function checkRbacWriters(
  files: Array<{ file: string; text: string }>,
  reg: Register,
): string[] {
  const out: string[] = [];
  const re =
    /(insert|delete|update)\(\s*(roleGrants|userRoles|roles)\s*\)|(INSERT INTO|DELETE FROM|UPDATE)\s+(role_grants|user_roles|roles)\b/i;
  const found = new Set<string>();
  for (const { file, text } of files) {
    if (!re.test(text)) continue;
    found.add(file);
    if (!reg.rbacWriters[file])
      out.push(
        `${file}: writes role / grant tables but is not in register.json rbacWriters (who calls bumpRolesVersion?).`,
      );
  }
  for (const f of Object.keys(reg.rbacWriters))
    if (!found.has(f)) out.push(`${f}: listed in rbacWriters but no longer writes role tables.`);
  return out;
}

export function loadFiles(
  roots: string[],
  pattern: RegExp = /\.tsx?$/,
): Array<{ file: string; text: string }> {
  return roots
    .flatMap((r) => walk(r, pattern))
    .map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
}
