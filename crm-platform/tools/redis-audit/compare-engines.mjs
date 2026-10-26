#!/usr/bin/env node
// Same keys, two servers (Sheet4 V-04): reads the keys of one database by type and writes them into Redis and into Valkey, then compares
// used_memory against each server's own empty baseline. Both servers are started by the caller (script-testing/redis-memory/run.sh).
// Not DUMP/RESTORE: a Redis 7.4 dump is refused by Valkey 8 ("payload version"), and a restored key would keep the source's encoding anyway.
// Each server builds every key natively. Values are read as text (strings, hashes, lists, sets, sorted sets, streams); TTLs are kept.
//   node tools/redis-audit/compare-engines.mjs --src redis://h:p/9 --a redis://localhost:7001 --b redis://localhost:7002 [--prefix p:] [--copies 10] [--out f.json]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);

export const TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream'];

/** Reads one key's value by its type; null for a type we do not copy. */
export async function readKey(r, key, type) {
  switch (type) {
    case 'string':
      return r.get(key);
    case 'hash':
      return r.hgetall(key);
    case 'list':
      return r.lrange(key, 0, -1);
    case 'set':
      return r.smembers(key);
    case 'zset':
      return r.zrange(key, 0, -1, 'WITHSCORES');
    case 'stream':
      return r.xrange(key, '-', '+');
    default:
      return null;
  }
}

/** Queues the commands that build `value` as `key` on a pipeline. */
export function writeKey(p, key, type, value) {
  switch (type) {
    case 'string':
      p.set(key, value);
      break;
    case 'hash':
      if (Object.keys(value).length) p.hset(key, value);
      break;
    case 'list':
      if (value.length) p.rpush(key, ...value);
      break;
    case 'set':
      if (value.length) p.sadd(key, ...value);
      break;
    case 'zset': {
      const args = [];
      for (let i = 0; i < value.length; i += 2) args.push(value[i + 1], value[i]);
      if (args.length) p.zadd(key, ...args);
      break;
    }
    case 'stream':
      for (const [id, fields] of value) p.xadd(key, id, ...fields);
      break;
  }
}

const used = async (r) => Number((await r.info('memory')).match(/used_memory:(\d+)/)[1]);
const name = async (r) => {
  const info = await r.info('server');
  // Valkey also prints redis_version (7.2.4, for compatibility): its own number is valkey_version.
  const v = /valkey_version:(\S+)/.exec(info)?.[1];
  return v ? `valkey ${v}` : `redis ${/redis_version:(\S+)/.exec(info)?.[1]}`;
};

async function main() {
  const req = createRequire(join(root, 'apps/api/package.json'));
  const { default: Redis } = await import(pathToFileURL(req.resolve('ioredis')).href);
  const src = new Redis(arg('--src'), { maxRetriesPerRequest: 2 });
  const prefix = arg('--prefix', '');
  const copies = Number(arg('--copies', 10));
  const keys = [];
  let cur = '0';
  do {
    const [n, b] = await src.scan(cur, 'MATCH', `${prefix}*`, 'COUNT', 1000);
    cur = n;
    keys.push(...b);
  } while (cur !== '0');
  const items = [];
  for (const k of keys) {
    const type = await src.type(k);
    const ttl = await src.pttl(k);
    if (ttl === -2 || !TYPES.includes(type)) continue; // expired meanwhile, or a type we do not copy
    items.push({ k, type, ttl, value: await readKey(src, k, type) });
  }

  async function load(url) {
    const r = new Redis(url, { maxRetriesPerRequest: 2 });
    await r.flushall();
    const empty = await used(r);
    const steps = [];
    for (let c = 1; c <= copies; c++) {
      for (let i = 0; i < items.length; i += 200) {
        const p = r.pipeline();
        for (const it of items.slice(i, i + 200)) {
          const key = `c${c}:${it.k}`;
          writeKey(p, key, it.type, it.value);
          if (it.ttl > 0) p.pexpire(key, it.ttl);
        }
        const bad = (await p.exec()).find(([e]) => e);
        if (bad) throw new Error(`write failed on ${url}: ${bad[0].message}`);
      }
      if (c === 1 || c === copies)
        steps.push({ copies: c, keys: await r.dbsize(), usedMemory: await used(r) });
    }
    // every copied key has to be there, or the comparison is of two different data sets
    const missing = items.length * copies - (await r.dbsize());
    if (missing > 0)
      throw new Error(
        `${url} is missing ${missing} keys (empty hashes/lists/sets are not copied, or keys expired)`,
      );
    const res = { server: await name(r), emptyBytes: empty, steps };
    await r.quit();
    return res;
  }
  const a = await load(arg('--a'));
  const b = await load(arg('--b'));
  const data = (x) => x.steps.at(-1).usedMemory - x.emptyBytes;
  const result = {
    at: new Date().toISOString(),
    sourceKeys: items.length,
    copies,
    engines: [a, b].map((x) => ({
      ...x,
      dataBytes: data(x),
      bytesPerKey: Math.round(data(x) / x.steps.at(-1).keys),
    })),
    valkeyVsRedisPct: Math.round((data(b) / data(a) - 1) * 1000) / 10,
  };
  writeFileSync(arg('--out', 'engines.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await src.quit();
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
