#!/usr/bin/env node
// Redis usage inventory (item #67). Static: reads apps/api/src, queues.ts and the compose files; needs no Redis.
//
//   node tools/redis-audit/inventory.mjs            # write docs/performance/redis/inventory.json
//   node tools/redis-audit/inventory.mjs --check    # exit 1 when the committed file is stale (CI; keeps the inventory true)
//
// What is exact and what is not:
//  - call sites, commands, TTL arguments, Lua scripts and queue options are read from code (exact for this codebase's one convention:
//    the injected client is called `redis`; the hygiene test pins that);
//  - key families are the key-shaped string templates found in files that use Redis (`auth:gate:${email}` -> `auth:gate:*`). Which
//    command writes a family is known per FILE, not per key, so TTL status is file-level (`ttlStatus`), and the exact per-command
//    TTL arguments are in `files[].writes`;
//  - value size classes are heuristics from the command; real bytes per key are measured by the integration tests.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, sourceFiles, redisCalls, clientSites, GROWTH, LIFETIME, setHasTtl } from './scan.mjs';
import { buildIndex, normalize, interpolations } from './keys.mjs';

const OUT = join(root, 'docs/performance/redis/inventory.json');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Strings that look like keys but are not (permission names, header names, SQL casts, MIME types, URL schemes). */
const NOT_KEYS = /^(?:node|http|https|data|user|users|bucket|text|image|audio|video|application|multipart|x|content|api|oauth|org|ws|wss|mailto|tel)[:.-]/i;

function ttlOf(c) {
  if (c.cmd === 'setex' || c.cmd === 'psetex') return `${c.cmd === 'psetex' ? 'PX' : 'EX'} ${c.args[1]}`;
  if (c.cmd === 'set') {
    const i = c.args.findIndex((a, n) => n >= 2 && /^['"`](EX|PX|EXAT|PXAT)['"`]$/i.test(a));
    return i >= 0 ? `${c.args[i].replace(/['"`]/g, '').toUpperCase()} ${c.args[i + 1]}` : /\b(EX|PX)\s*:/.test(c.text) ? 'options' : null;
  }
  if (['expire', 'pexpire', 'expireat', 'pexpireat'].includes(c.cmd)) return `${c.cmd.toUpperCase()} ${c.args[1]}`;
  return null;
}

function scopeOf(vars) {
  const v = vars.join(' ').toLowerCase();
  if (/org|tenant|workspace/.test(v)) return 'org';
  if (/user|operator|agent|member/.test(v)) return 'user';
  if (/\bip\b|address/.test(v)) return 'ip';
  if (vars.length === 0) return 'global';
  return 'other';
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

export function buildInventory() {
  const files = sourceFiles();
  const index = buildIndex(files);
  const forbidden = { keys: [], flush: [], scan: [], fullRange: [], smembers: [], hgetall: [], directIncr: [] };
  const calls = [];
  const fileRows = [];
  const keyFamilies = new Map();
  const keyDefs = [];

  for (const f of files) {
    const cs = redisCalls(f);
    const usesRedis = cs.length > 0 || /REDIS_CLIENT|from 'ioredis'/.test(f.src);
    // Files that only DEFINE keys (`throughput-keys.ts`, `redis-keys.ts`) are scanned for templates; their lifetime comes from the importers.
    const definesKeys = /(?:^|[-_/])keys\.ts$/.test(f.path);
    if (!usesRedis && !definesKeys) continue;
    const writes = [];
    let growth = 0;
    let lifetime = 0;
    let growthWithoutInlineTtl = 0;
    for (const c of cs) {
      const rec = { file: f.path, line: c.line, cmd: c.cmd };
      calls.push(rec);
      if (c.cmd === 'keys') forbidden.keys.push(rec);
      if (c.cmd === 'flushall' || c.cmd === 'flushdb') forbidden.flush.push(rec);
      if (['scan', 'sscan', 'hscan', 'zscan'].includes(c.cmd)) forbidden.scan.push({ ...rec, args: c.args.join(', ').slice(0, 120) });
      if (c.cmd === 'lrange' && /,\s*-1\s*$/.test(c.text)) forbidden.fullRange.push(rec);
      if (c.cmd === 'smembers') forbidden.smembers.push(rec);
      if (c.cmd === 'hgetall') forbidden.hgetall.push(rec);
      if (c.cmd === 'incr' && c.direct) forbidden.directIncr.push(rec);
      const ttl = ttlOf(c);
      const isGrowth = GROWTH.has(c.cmd);
      if (isGrowth || LIFETIME.has(c.cmd)) writes.push({ line: c.line, cmd: c.cmd, ttl });
      if (isGrowth) {
        growth++;
        if (!ttl && !(c.cmd === 'set' && setHasTtl(c))) growthWithoutInlineTtl++;
      }
      if (LIFETIME.has(c.cmd) || (c.cmd === 'set' && setHasTtl(c)) || c.cmd === 'eval') lifetime++;
    }

    // Key-shaped templates in this file.
    const text = stripComments(f.src);
    const seen = new Set();
    for (const m of text.matchAll(/(`(?:\\.|[^`\\\n])*`|'[^'\n]*'|"[^"\n]*")/g)) {
      const lit = m[1];
      const body = lit.slice(1, -1);
      if (!/^[a-z][a-z0-9_.-]*(?::[^\s'"`]*)+$/.test(body.replace(/\$\{[^}]*\}/g, '*')) || NOT_KEYS.test(body) || body.includes('//') || body.length > 120) continue;
      const tpl = normalize(lit, f.path, index);
      if (!tpl || seen.has(tpl)) continue;
      seen.add(tpl);
      const e = keyFamilies.get(tpl) ?? keyFamilies.set(tpl, { template: tpl, files: new Set(), vars: new Set(), props: new Map() }).get(tpl);
      e.files.add(f.path);
      // the builder name (`epoch:` in `AuthKeys = { epoch: ... }`), to find the files that really use this key
      const before = text.slice(Math.max(0, m.index - 160), m.index);
      const prop = /(\w+)\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)\s*(?::[^=]+)?=>\s*)?\(?\s*$/.exec(before)?.[1];
      if (prop && !usesRedis) e.props.set(f.path, prop);
      for (const v of interpolations(lit)) e.vars.add(v);
    }

    if (!usesRedis) {
      keyDefs.push(f.path);
      continue;
    }
    const ttlStatus =
      growth === 0 && !cs.some((c) => c.cmd === 'eval') ? 'read-only' : growthWithoutInlineTtl === 0 || lifetime > 0 ? 'ttl' : 'review';
    fileRows.push({
      file: f.path,
      commands: [...new Set(cs.map((c) => c.cmd))].sort(),
      writes,
      ttlStatus,
    });
  }

  // Lua scripts: any template string containing redis.call.
  const lua = [];
  const WRITE_LUA = new Set(['set', 'incr', 'incrby', 'hset', 'hincrby', 'zadd', 'sadd', 'lpush', 'rpush', 'setex', 'pfadd']);
  for (const f of files)
    for (const m of f.src.matchAll(/(?:const|static)\s+(\w+)\s*(?::[^=]+)?=\s*`([^`]*redis\.call[^`]*)`/g)) {
      const commands = [...new Set([...m[2].matchAll(/redis\.call\(\s*'(\w+)'/gi)].map((x) => x[1].toLowerCase()))].sort();
      lua.push({
        file: f.path,
        name: m[1],
        commands,
        writes: commands.some((c) => WRITE_LUA.has(c)),
        setsTtl: /pexpire|expire|KEEPTTL|'(?:PX|EX)'|"(?:PX|EX)"/i.test(m[2]),
      });
    }

  // Pipelines / multi, and a Redis call awaited inside a loop body (N sequential round trips).
  const batched = [];
  const sequential = [];
  for (const f of files) {
    for (const m of f.src.matchAll(/\bredis\s*\.\s*(pipeline|multi)\s*\(/g)) batched.push({ file: f.path, kind: m[1] });
    for (const m of f.src.matchAll(/\b(for\s*\([^)]*\)|for\s+await\s*\([^)]*\)|while\s*\([^)]*\))\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      let d = 0;
      let end = open;
      for (let i = open; i < f.src.length; i++) {
        if (f.src[i] === '{') d++;
        else if (f.src[i] === '}' && --d === 0) {
          end = i;
          break;
        }
      }
      const hit = /\bawait\s+(?:this\.)?redis\s*\.\s*(?!multi|pipeline)(\w+)\s*\(/.exec(f.src.slice(open, end));
      if (hit) sequential.push({ file: f.path, line: f.src.slice(0, open).split('\n').length, cmd: hit[1] });
    }
  }

  const families = [...keyFamilies.values()]
    .map((e) => {
      const rows = [...e.files].flatMap((p) => {
        const own = fileRows.find((r) => r.file === p);
        if (own) return [own];
        const base = p.split('/').pop().replace(/\.ts$/, '');
        const importers = fileRows.filter((r) => files.find((x) => x.path === r.file).src.includes(`/${base}'`));
        const prop = e.props.get(p);
        const users = prop ? importers.filter((r) => new RegExp(`\\.${prop}\\b`).test(files.find((x) => x.path === r.file).src)) : [];
        return prop ? users : importers;
      });
      const status = rows.some((r) => r.ttlStatus === 'review') ? 'review' : rows.length && rows.every((r) => r.ttlStatus === 'read-only') ? 'read-only' : rows.length ? 'ttl' : 'indirect';
      return {
        template: e.template,
        files: [...e.files].sort(),
        scope: scopeOf([...e.vars]),
        ttlStatus: status,
      };
    })
    .sort((a, b) => a.template.localeCompare(b.template));

  const sites = clientSites(files).map((s) => ({ file: s.file, line: s.line, kind: s.kind, options: s.args.replace(/\s+/g, ' ').trim() }));
  return { files, fileRows, families, lua, batched, sequential, forbidden, sites, calls };
}

async function queuesInventory() {
  // queues.ts is TypeScript, read by Node's type stripping; the package has no "type": "module", which Node warns about once.
  process.removeAllListeners('warning');
  const q = await import(pathToFileURL(join(root, 'apps/api/src/infra/queue/queues.ts')).href);
  const prior = JSON.parse(read('docs/performance/queue-capacity/queue-inventory.json'));
  return Object.entries(q.QUEUES).map(([constant, name]) => {
    const o = q.jobOptionsFor(name);
    const p = prior.queues.find((x) => x.queue === name);
    return {
      queue: name,
      constant,
      removeOnComplete: o.removeOnComplete,
      removeOnFail: o.removeOnFail,
      attempts: o.attempts,
      backoff: o.backoff,
      consumers: p?.consumerFiles?.length ?? null,
      concurrencyPerWorker: p?.concurrencyPerWorker ?? null,
    };
  });
}

function composeRedis() {
  const grab = (p) => {
    const t = read(p);
    const block = t.slice(t.search(/^\s{2}redis:/m));
    const next = block.slice(10).search(/^\s{2}\w[\w-]*:\s*$/m);
    const b = next > 0 ? block.slice(0, next + 10) : block;
    return {
      file: p,
      appendonly: /appendonly['",\s]+yes/.test(b),
      maxmemory: (/--maxmemory['",\s]+([0-9]+\w+)/.exec(b) ?? [])[1] ?? null,
      policy: (/maxmemory-policy['",\s]+(\w+)/.exec(b) ?? [])[1] ?? null,
    };
  };
  return ['docker-compose.yml', 'docker-compose.prod.yml', 'deploy/hostinger/docker-compose.yml'].map(grab);
}

export async function render() {
  const inv = buildInventory();
  const queues = await queuesInventory();
  const fams = inv.families;
  const count = (f) => fams.filter(f).length;
  return {
    generatedBy: 'node tools/redis-audit/inventory.mjs',
    generatedFrom: 'apps/api/src (static scan; see the header of tools/redis-audit/inventory.mjs for what is exact)',
    totals: {
      sourceFilesUsingRedis: inv.fileRows.length,
      commandCallSites: inv.calls.length,
      keyFamilies: fams.length,
      familiesInFilesWhereEveryWriteHasATtl: count((f) => f.ttlStatus === 'ttl'),
      familiesInFilesToReview: count((f) => f.ttlStatus === 'review'),
      familiesInReadOnlyFiles: count((f) => f.ttlStatus === 'read-only'),
      orgScopedFamilies: count((f) => f.scope === 'org'),
      queues: queues.length,
      luaScripts: inv.lua.length,
      clientConstructionSites: inv.sites.length,
      redisCallsInsideLoops: inv.sequential.length,
      pipelineOrMultiUses: inv.batched.length,
    },
    clients: inv.sites,
    serverConfig: composeRedis(),
    queues,
    keyFamilies: fams,
    files: inv.fileRows,
    luaScripts: inv.lua,
    commandUse: {
      KEYS: inv.forbidden.keys,
      FLUSH: inv.forbidden.flush,
      SCAN: inv.forbidden.scan,
      LRANGE_0_MINUS_1: inv.forbidden.fullRange,
      SMEMBERS: inv.forbidden.smembers,
      HGETALL: inv.forbidden.hgetall,
      INCR_THEN_SEPARATE_EXPIRE: inv.forbidden.directIncr,
    },
    pipelinesAndMulti: inv.batched,
    redisCallInsideLoop: inv.sequential,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const doc = JSON.stringify(await render(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    let cur = '';
    try {
      cur = readFileSync(OUT, 'utf8');
    } catch {
      /* missing */
    }
    if (cur !== doc) {
      console.error('docs/performance/redis/inventory.json is stale. Run: node tools/redis-audit/inventory.mjs');
      process.exit(1);
    }
    console.log('redis inventory is current');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, doc);
    console.log(`wrote ${OUT}`);
  }
}
