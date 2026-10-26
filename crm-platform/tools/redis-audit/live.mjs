#!/usr/bin/env node
// Live Redis key audit (Sheet4 V-04). Scans ONE database of a running Redis, groups the keys into families, and reports per family the
// count, bytes (MEMORY USAGE), and whether every key expires. A family with a key that never expires must have a named owner in
// docs/performance/redis/key-owners.json; anything else fails with --check. Also stores the server's memory baseline (INFO memory).
// Read only: SCAN, TYPE, TTL, MEMORY USAGE, INFO, CONFIG GET. It never writes, so it is safe on a shared instance, but scan a scratch
// database or a key prefix (--prefix) so the numbers are yours.
//   node tools/redis-audit/live.mjs --url redis://localhost:6379 --db 9 [--prefix qa-1234:] [--out live.json] [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BULL_PARTS = new Set([
  'id',
  'meta',
  'events',
  'stalled-check',
  'marker',
  'wait',
  'active',
  'completed',
  'failed',
  'delayed',
  'paused',
  'prioritized',
  'waiting-children',
  'limiter',
  'repeat',
  'de',
  'pc',
  'stalled',
  'metrics',
]);

/** A segment that is a value (id, uuid, hash, address, long token) and not a name. */
export const isValue = (s) =>
  /^\d+$/.test(s) ||
  /^\d+\.\d+\.\d+\.\d+$/.test(s) ||
  UUID.test(s) ||
  /^[0-9a-f]{8,}$/i.test(s) ||
  s.includes('@') ||
  s.length > 24;

/** The family of a key: its prefix removed, value segments as `*`; BullMQ keys as bull:*:<part>. */
export function familyOf(key, prefix = '') {
  const k = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const seg = k.split(':');
  if (seg[0] === 'bull') {
    const last = seg.at(-1);
    return `${seg[0]}:*:${BULL_PARTS.has(last) ? last : '*'}`;
  }
  return seg.map((s, i) => (i > 0 && isValue(s) ? '*' : s)).join(':');
}

const globToRe = (g) =>
  new RegExp(
    `^${g
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );

/** The named owner of a family from the owners file ([{ family: glob, owner, reason }]), or null. */
export function ownerOf(family, owners) {
  return owners.find((o) => globToRe(o.family).test(family)) ?? null;
}

/** Rows ({ key, type, ttl, bytes }) to families. ttl -1 is "never expires". */
export function summarize(rows, owners, prefix = '') {
  const fam = new Map();
  for (const r of rows) {
    const f = familyOf(r.key, prefix);
    const e = fam.get(f) ?? {
      family: f,
      keys: 0,
      bytes: 0,
      maxBytes: 0,
      noTtl: 0,
      ttlMax: 0,
      types: new Set(),
    };
    e.keys++;
    e.bytes += r.bytes;
    e.maxBytes = Math.max(e.maxBytes, r.bytes);
    if (r.ttl === -1) e.noTtl++;
    else e.ttlMax = Math.max(e.ttlMax, r.ttl);
    e.types.add(r.type);
    fam.set(f, e);
  }
  const families = [...fam.values()]
    .map((e) => {
      const own = e.noTtl ? ownerOf(e.family, owners) : null;
      return {
        family: e.family,
        keys: e.keys,
        bytes: e.bytes,
        avgBytes: Math.round(e.bytes / e.keys),
        maxBytes: e.maxBytes,
        noTtl: e.noTtl,
        ttlMaxSeconds: e.ttlMax,
        types: [...e.types].sort(),
        owner: own?.owner ?? null,
        ownerReason: own?.reason ?? null,
        status: e.noTtl === 0 ? 'ttl' : own ? 'owned' : 'UNOWNED',
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
  const total = families.reduce((s, f) => s + f.keys, 0);
  return {
    families,
    totals: {
      keys: total,
      bytes: families.reduce((s, f) => s + f.bytes, 0),
      families: families.length,
      keysNoTtl: families.reduce((s, f) => s + f.noTtl, 0),
      familiesUnowned: families.filter((f) => f.status === 'UNOWNED').length,
    },
  };
}

/** Why --check fails, or null. An empty scan is a wrong database or prefix, not a pass. */
export function checkVerdict(totals) {
  if (!totals.keys) return 'NO KEYS scanned: the database index or the prefix is wrong';
  if (totals.familiesUnowned)
    return `${totals.familiesUnowned} key family(ies) never expire and have no named owner`;
  return null;
}

async function main() {
  const url = arg('--url', 'redis://localhost:6379');
  const db = Number(arg('--db', 0));
  const prefix = arg('--prefix', '');
  const owners = JSON.parse(
    readFileSync(arg('--owners', join(root, 'docs/performance/redis/key-owners.json')), 'utf8'),
  ).owners;
  const req = createRequire(join(root, 'apps/api/package.json'));
  const { default: Redis } = await import(pathToFileURL(req.resolve('ioredis')).href);
  const r = new Redis(url, { db, lazyConnect: false, maxRetriesPerRequest: 2 });
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await r.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 1000);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  const rows = [];
  for (let i = 0; i < keys.length; i += 500) {
    const part = keys.slice(i, i + 500);
    const p = r.pipeline();
    for (const k of part) p.type(k).ttl(k).call('MEMORY', 'USAGE', k, 'SAMPLES', '0'); // SAMPLES 0: exact, not an estimate from 5 elements
    const out = await p.exec();
    part.forEach((key, j) =>
      rows.push({
        key,
        type: out[j * 3][1],
        ttl: out[j * 3 + 1][1],
        bytes: Number(out[j * 3 + 2][1]) || 0,
      }),
    );
  }
  const info = Object.fromEntries(
    (await r.info('memory'))
      .split('\r\n')
      .filter((l) => l.includes(':') && !l.startsWith('#'))
      .map((l) => l.split(':')),
  );
  const cfgArr = await r.config('GET', 'maxmemory*');
  const cfg = {};
  for (let i = 0; i < cfgArr.length; i += 2) cfg[cfgArr[i]] = cfgArr[i + 1];
  const version = (await r.info('server')).match(/(?:redis|valkey)_version:(\S+)/)?.[1];
  const result = {
    at: new Date().toISOString(),
    url: url.replace(/\/\/[^@]*@/, '//'),
    db,
    prefix,
    server: version,
    memory: {
      usedMemory: Number(info.used_memory),
      usedMemoryPeak: Number(info.used_memory_peak),
      fragmentation: Number(info.mem_fragmentation_ratio),
      maxmemory: Number(cfg.maxmemory),
      policy: cfg['maxmemory-policy'],
    },
    ...summarize(rows, owners, prefix),
  };
  writeFileSync(arg('--out', 'redis-live.json'), JSON.stringify(result, null, 2));
  console.log(
    `${result.totals.keys} keys in ${result.totals.families} families, ${result.totals.keysNoTtl} without TTL, ${result.totals.familiesUnowned} unowned; used_memory ${(result.memory.usedMemory / 1048576).toFixed(1)} MB, policy ${result.memory.policy}`,
  );
  for (const f of result.families.filter((x) => x.status === 'UNOWNED'))
    console.log(`UNOWNED  ${f.family}  (${f.noTtl} keys never expire)`);
  await r.quit();
  if (process.argv.includes('--check')) {
    const v = checkVerdict(result.totals);
    if (v) console.log(v);
    if (v) process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
