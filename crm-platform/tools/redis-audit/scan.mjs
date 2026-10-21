// Static scan of every Redis call site in apps/api/src (item #67). No Redis needed; used by the ratchet tests
// (apps/api/test/unit/redis/redis-hygiene.spec.ts) and by `node tools/redis-audit/inventory.mjs`.
//
// A "call" is `<receiver>.<command>(args)` where the receiver is the injected client (`redis` / `this.redis`) or a pipeline/multi
// bound from it, including chains such as `this.redis.multi().incr(k).expire(k, 60).exec()`. The scan is textual, not a type check:
// it is exact for this codebase's one naming convention (`private readonly redis: Redis`) and the ratchet test pins that convention.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = join(root, 'apps/api/src');

export function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

/** Index of the `)` that closes the `(` at `open`, skipping strings, template literals and comments. */
export function closeParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) {
        if (src[i] === '\\') i++;
        else if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 0;
          for (i += 1; i < src.length; i++) {
            if (src[i] === '{') d++;
            else if (src[i] === '}' && --d === 0) break;
          }
        }
      }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1 || src.length;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Top-level comma split of an argument list (strings, templates, brackets respected). */
export function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      cur += c;
      for (i++; i < s.length && s[i] !== q; i++) {
        cur += s[i];
        if (s[i] === '\\') cur += s[++i] ?? '';
      }
      cur += q;
    } else if ('([{'.includes(c)) {
      depth++;
      cur += c;
    } else if (')]}'.includes(c)) {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** Receivers: the injected client plus any local bound from `redis.pipeline()` / `redis.multi()`. */
function receivers(src) {
  const names = new Set(['redis']);
  for (const m of src.matchAll(
    /\b(?:const|let)\s+(\w+)\s*=\s*(?:this\.)?redis\s*\.\s*(?:pipeline|multi)\s*\(/g,
  ))
    names.add(m[1]);
  return names;
}

/** Every Redis command call in one source file: {cmd, args, line, text}. */
export function callsIn(src) {
  const recv = receivers(src);
  const calls = [];
  const start = new RegExp(
    `(?<![\\w.])(?:this\\.)?(${[...recv].join('|')})\\s*\\??\\.\\s*(\\w+)\\s*\\(`,
    'g',
  );
  for (const m of src.matchAll(start)) {
    let cmdName = m[2];
    let idx = 0;
    let open = m.index + m[0].length - 1;
    const recvName = m[1];
    for (;;) {
      const close = closeParen(src, open);
      if (close < 0) break;
      const argText = src.slice(open + 1, close);
      // `direct`: a lone command on the client, not a link of a MULTI/pipeline (those are sent together, one round trip).
      calls.push({
        cmd: cmdName.toLowerCase(),
        args: splitArgs(argText),
        line: lineOf(src, open),
        text: argText,
        direct: idx === 0 && recvName === 'redis',
      });
      idx++;
      const next = /^\s*\.\s*(\w+)\s*\(/.exec(src.slice(close + 1));
      if (!next) break;
      cmdName = next[1];
      open = close + 1 + next[0].length - 1;
    }
  }
  return calls;
}

export function sourceFiles() {
  return walk(SRC).map((p) => ({
    path: relative(root, p).split(sep).join('/'),
    abs: p,
    src: readFileSync(p, 'utf8'),
  }));
}

/** First string-literal prefix of a key expression: `auth:gate:${x}` -> `auth:gate:`; a bare identifier -> null. */
export function keyPrefix(expr) {
  if (!expr) return null;
  const m = /^(?:`|'|")([^`'"$]*)/.exec(expr.trim());
  if (m) return m[1];
  return null;
}

const SET_FAMILY = new Set(['set', 'setex', 'psetex', 'setnx', 'getset']);

/** True when a SET carries a lifetime: SETEX/PSETEX, or an EX/PX/EXAT/PXAT/KEEPTTL option. */
export function setHasTtl(call) {
  if (call.cmd === 'setex' || call.cmd === 'psetex') return true;
  return (
    call.args.slice(2).some((a) => /^['"`](?:EX|PX|EXAT|PXAT|KEEPTTL)['"`]$/i.test(a)) ||
    /\b(?:EX|PX)\s*:/.test(call.text)
  );
}

export function setCalls(file) {
  return callsIn(file.src)
    .filter((c) => SET_FAMILY.has(c.cmd))
    .map((c) => ({ ...c, file: file.path, hasTtl: setHasTtl(c) }));
}

/** Redis commands (lower case). The chain walker also meets `.catch()/.then()/.exec()`; only these count as calls. */
export const COMMANDS = new Set(
  `append decr decrby del eval evalsha exists expire expireat expiretime flushall flushdb get getbuffer getdel getdelbuffer getex getset hdel hexists hget hgetall hincrby hincrbyfloat hkeys hlen hmget hmset hscan hset hsetnx hvals incr incrby incrbyfloat keys lindex llen lpop lpush lrange lrem ltrim mget mset msetnx persist pexpire pexpireat pfadd pfcount pfmerge ping psetex psubscribe pttl publish rpop rpush sadd scan scard sdiff set setex setnx sinter sismember smembers spop srandmember srem sscan subscribe sunion ttl type unlink unsubscribe xadd xlen xrange xread xtrim zadd zcard zcount zincrby zrange zrangebyscore zrem zremrangebyrank zremrangebyscore zrevrange zrevrangebyscore zscan`.split(
    /\s+/,
  ),
);

/** Commands that create or grow a key (so the key needs a lifetime or an explicit bound). */
export const GROWTH = new Set(
  'set setex psetex setnx getset incr incrby incrbyfloat hincrby hincrbyfloat hset hsetnx hmset sadd zadd zincrby lpush rpush pfadd append xadd mset msetnx'.split(
    ' ',
  ),
);
/** Commands that give an existing key a lifetime. */
export const LIFETIME = new Set(
  'expire pexpire expireat pexpireat setex psetex persist'.split(' '),
);

export function redisCalls(file) {
  return callsIn(file.src)
    .filter((c) => COMMANDS.has(c.cmd))
    .map((c) => ({ ...c, file: file.path }));
}

/** Plain `ioredis` constructions and `.duplicate()` in application code (not specs). */
export function clientSites(files) {
  const sites = [];
  for (const f of files) {
    for (const m of f.src.matchAll(/new\s+(?:Redis|IORedis)\s*\(/g)) {
      const close = closeParen(f.src, m.index + m[0].length - 1);
      sites.push({
        file: f.path,
        line: lineOf(f.src, m.index),
        kind: 'new',
        args: f.src.slice(m.index + m[0].length, close),
      });
    }
    for (const m of f.src.matchAll(/\b(\w+)\.duplicate\s*\(\s*\)/g)) {
      if (/redis|pub|client/i.test(m[1]))
        sites.push({ file: f.path, line: lineOf(f.src, m.index), kind: 'duplicate', args: '' });
    }
  }
  return sites;
}
