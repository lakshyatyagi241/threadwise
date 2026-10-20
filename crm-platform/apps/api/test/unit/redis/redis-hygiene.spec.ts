import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Redis hygiene ratchet (Sheet3 #67). Static, no Redis, about a second. Each test fails with the file and line that broke the rule and
 * what to do. A rule that has a known exception keeps it in a commented allowlist below: the list may only shrink (a stale entry fails
 * too, so a fixed exception is removed rather than forgotten). The scanner is tools/redis-audit/scan.mjs; the full picture it builds is
 * docs/performance/redis/inventory.json.
 */
const ROOT = resolve(__dirname, '../../../../..');
const load = async <T>(p: string): Promise<T> =>
  (await import(pathToFileURL(resolve(ROOT, p)).href)) as T;

interface Call {
  cmd: string;
  args: string[];
  line: number;
  text: string;
  direct: boolean;
}
interface Scan {
  callsIn(src: string): Call[];
  redisCalls(f: { path: string; src: string }): Array<Call & { file: string }>;
  setHasTtl(c: Call): boolean;
  sourceFiles(): Array<{ path: string; src: string }>;
}
interface Site {
  file: string;
  line: number;
  kind: string;
  options: string;
}
interface Inv {
  buildInventory(): {
    files: Array<{ path: string; src: string }>;
    fileRows: Array<{ file: string; ttlStatus: string }>;
    lua: Array<{
      file: string;
      name: string;
      commands: string[];
      writes: boolean;
      setsTtl: boolean;
    }>;
    forbidden: Record<string, Array<{ file: string; line: number; cmd: string }>>;
    sites: Site[];
    sequential: Array<{ file: string; line: number; cmd: string }>;
  };
}

let scan: Scan;
let inv: ReturnType<Inv['buildInventory']>;

beforeAll(async () => {
  scan = await load<Scan>('tools/redis-audit/scan.mjs');
  inv = (await load<Inv>('tools/redis-audit/inventory.mjs')).buildInventory();
});

const at = (r: { file: string; line: number }) =>
  `${r.file.replace('apps/api/src/', '')}:${r.line}`;
const short = (f: string) => f.replace('apps/api/src/', '');

describe('Redis hygiene: commands that must not be in application code', () => {
  it('uses no KEYS and no FLUSHALL/FLUSHDB', () => {
    const bad = [...inv.forbidden.keys!, ...inv.forbidden.flush!].map((r) => `${at(r)} ${r.cmd}`);
    expect(
      bad,
      'KEYS walks every key and blocks Redis; use SCAN with COUNT (or keep an index). FLUSH* deletes other tenants.',
    ).toEqual([]);
    const lua = inv.lua.filter((l) =>
      l.commands.some((c) => c === 'keys' || c === 'flushall' || c === 'flushdb'),
    );
    expect(lua.map((l) => `${short(l.file)} ${l.name}`)).toEqual([]);
  });

  it('reads no list or sorted set in full (LRANGE/ZRANGE 0 -1)', () => {
    const bad: string[] = [];
    for (const f of inv.files) {
      for (const c of scan.redisCalls(f)) {
        if (['lrange', 'zrange', 'zrevrange'].includes(c.cmd) && /,\s*-1\s*$/.test(c.text))
          bad.push(`${short(f.path)}:${c.line} ${c.cmd}`);
      }
    }
    expect(bad, 'Pass a bounded end index; a list that grows is read in pages.').toEqual([]);
  });

  // SMEMBERS and HGETALL return the whole structure. Allowed only on a structure with a fixed, small shape or an explicit bound.
  const FULL_READ_ALLOWED: Record<string, { max: number; why: string }> = {
    'apps/api/src/infra/providers/whatsapp-cloud-api-waba/throughput/throughput-store.ts': {
      max: 6,
      why: "HGETALL on hashes with a fixed set of fields (global settings, one number's config and penalty): a handful of fields each",
    },
    'apps/api/src/modules/whatsapp-devices-baileys/history-import.sink.ts': {
      max: 2,
      why: "one history import run's tally; bounded by the run's max_chats and expires after 3 days. Read once per batch: O(chats) per batch, a candidate for a counter if a run is ever allowed 100k chats",
    },
  };
  it('reads whole sets/hashes (SMEMBERS, HGETALL) only where the structure is bounded', () => {
    const found = [...inv.forbidden.smembers!, ...inv.forbidden.hgetall!];
    const per: Record<string, number> = {};
    for (const r of found) per[r.file] = (per[r.file] ?? 0) + 1;
    const unlisted = Object.keys(per).filter((f) => !FULL_READ_ALLOWED[f]);
    expect(
      unlisted.map(short),
      'New full-structure read: prove the structure is bounded and add it to FULL_READ_ALLOWED with the bound, or page it (SSCAN/HSCAN).',
    ).toEqual([]);
    for (const [f, a] of Object.entries(FULL_READ_ALLOWED)) {
      expect(
        per[f] ?? 0,
        `${short(f)} no longer reads this way: remove it from FULL_READ_ALLOWED (${a.why})`,
      ).toBeGreaterThan(0);
      expect(
        per[f],
        `${short(f)} has more full reads than reviewed (${a.max}): ${a.why}`,
      ).toBeLessThanOrEqual(a.max);
    }
  });

  it('uses SCAN only with MATCH and COUNT', () => {
    const bad = inv.forbidden.scan!.filter(
      (r) =>
        !/MATCH/i.test((r as unknown as { args: string }).args) ||
        !/COUNT/i.test((r as unknown as { args: string }).args),
    );
    expect(bad.map(at)).toEqual([]);
  });
});

describe('Redis hygiene: every key has a lifetime or a reason', () => {
  // `SET` with no EX/PX/KEEPTTL. Each one is a single fixed key (not a family that can grow).
  const SET_WITHOUT_TTL_ALLOWED: Record<string, string> = {
  };
  it('has a TTL on every SET/SETEX that can grow (or is a listed single key)', () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const f of inv.files) {
      for (const c of scan.redisCalls(f)) {
        if (!['set', 'setnx', 'getset'].includes(c.cmd) || scan.setHasTtl(c)) continue;
        if (SET_WITHOUT_TTL_ALLOWED[f.path]) seen.add(f.path);
        else bad.push(`${short(f.path)}:${c.line} ${c.cmd}(${c.args[0]})`);
      }
    }
    expect(
      bad,
      "A cache entry, lock or claim with no TTL stays for ever. Add 'EX', seconds (or setex), or list a single fixed key in SET_WITHOUT_TTL_ALLOWED with the reason.",
    ).toEqual([]);
    for (const f of Object.keys(SET_WITHOUT_TTL_ALLOWED))
      expect(
        seen.has(f),
        `${short(f)} now sets a TTL: remove it from SET_WITHOUT_TTL_ALLOWED`,
      ).toBe(true);
  });

  // Growth commands (INCR, HSET, SADD, ZADD, LPUSH, PFADD, HINCRBY ...) in a file with no EXPIRE/PEXPIRE/TTL'd SET/EVAL at all.
  const GROWTH_WITHOUT_LIFETIME_ALLOWED: Record<string, string> = {
  };
  it('has a lifetime command beside every counter / hash / set / list / sorted-set write', () => {
    const review = inv.fileRows.filter((r) => r.ttlStatus === 'review').map((r) => r.file);
    const bad = review.filter((f) => !GROWTH_WITHOUT_LIFETIME_ALLOWED[f]);
    expect(
      bad.map(short),
      'This file grows a Redis key and never sets a lifetime (EXPIRE/PEXPIRE/SETEX/EX). Bound it, or list it with the reason.',
    ).toEqual([]);
    for (const f of Object.keys(GROWTH_WITHOUT_LIFETIME_ALLOWED))
      expect(
        review,
        `${short(f)} is now fine: remove it from GROWTH_WITHOUT_LIFETIME_ALLOWED`,
      ).toContain(f);
  });

  // Lua scripts that write must give the key a lifetime (EX/PX/EXPIRE/PEXPIRE/KEEPTTL).
  it('has a lifetime inside every Lua script that writes', () => {
    const bad = inv.lua
      .filter((l) => l.writes && !l.setsTtl)
      .map((l) => `${short(l.file)} ${l.name} [${l.commands.join(',')}]`);
    expect(bad).toEqual([]);
  });

  // `INCR key` then a separate `EXPIRE key` when the answer was 1: a lost second command leaves a counter that never expires. New code
  // uses incrWithTtl (infra/redis/counter.ts: one MULTI). These are the older sites, all on time-bucketed or one-shot keys, so a lost
  // EXPIRE leaks one small key rather than blocking anyone; the sites where it blocked someone (API-key failure counters) are fixed.
  const SEPARATE_EXPIRE_ALLOWED: Record<string, number> = {
    'apps/api/src/modules/auth/flows/login.service.ts': 1,
    'apps/api/src/modules/auth/platform/operator-auth.service.ts': 1,
    'apps/api/src/modules/broadcasts/send-safety.ts': 1,
    'apps/api/src/modules/broadcasts/tracking/link-redirect.service.ts': 1,
    'apps/api/src/modules/channel-line/inbound.service.ts': 1,
    'apps/api/src/modules/channel-telegram/inbound.service.ts': 1,
    'apps/api/src/modules/channel-viber/inbound.service.ts': 1,
    'apps/api/src/modules/channel-wechat/inbound.service.ts': 1,
    'apps/api/src/modules/chatbot-widget/widget-throttle.service.ts': 1,
    'apps/api/src/modules/crm/invoicing/invoice-public.service.ts': 1,
    'apps/api/src/modules/storefront-builder/public/public-rate-limiter.ts': 1,
  };
  it('does not add a counter that is INCR-ed and given its lifetime by a separate command', () => {
    const per: Record<string, number> = {};
    for (const r of inv.forbidden.directIncr!) per[r.file] = (per[r.file] ?? 0) + 1;
    const bad = Object.entries(per).filter(([f, n]) => n > (SEPARATE_EXPIRE_ALLOWED[f] ?? 0));
    expect(
      bad.map(([f, n]) => `${short(f)} (${n})`),
      'Use incrWithTtl(redis, key, seconds) from infra/redis/counter.ts: INCR + EXPIRE NX in one MULTI.',
    ).toEqual([]);
    for (const [f, n] of Object.entries(SEPARATE_EXPIRE_ALLOWED))
      expect(per[f] ?? 0, `${short(f)} was converted: remove it from SEPARATE_EXPIRE_ALLOWED`).toBe(
        n,
      );
  });
});

describe('Redis hygiene: key names carry a prefix', () => {
  it('starts every literal key with a lowercase "<name>:" prefix', () => {
    const bad: string[] = [];
    for (const f of inv.files) {
      for (const c of scan.redisCalls(f)) {
        if (
          [
            'eval',
            'evalsha',
            'ping',
            'publish',
            'subscribe',
            'unsubscribe',
            'scan',
            'zscan',
            'sscan',
            'hscan',
          ].includes(c.cmd)
        )
          continue;
        const k = c.args[0]?.trim() ?? '';
        if (!/^[`'"]/.test(k) || k.startsWith('`${')) continue; // a variable, or a key derived from one (`${key}:lock`): checked where the literal is
        if (!/^[`'"][a-z][a-z0-9_-]*:/.test(k))
          bad.push(`${short(f.path)}:${c.line} ${c.cmd}(${k.slice(0, 40)})`);
      }
    }
    expect(
      bad,
      'An unprefixed key can collide with another feature and cannot be found by its owner. Use "<feature>:<scope>:<id>".',
    ).toEqual([]);
  });
});

describe('Redis hygiene: BullMQ queues and jobs are bounded', () => {
  interface QueueRow {
    queue: string;
    removeOnComplete: unknown;
    removeOnFail: unknown;
    attempts: number;
    backoff: unknown;
  }
  let queues: QueueRow[];
  beforeAll(async () => {
    process.removeAllListeners('warning');
    const q = (await import(
      pathToFileURL(resolve(ROOT, 'apps/api/src/infra/queue/queues.ts')).href
    )) as {
      QUEUES: Record<string, string>;
      jobOptionsFor(n: string): QueueRow;
    };
    queues = Object.values(q.QUEUES).map((n) => ({ ...q.jobOptionsFor(n), queue: n }));
  });

  const bounded = (v: unknown): boolean =>
    v === true ||
    typeof v === 'number' ||
    (typeof v === 'object' && v !== null && ('count' in v || 'age' in v));

  it('keeps a bounded history of completed and failed jobs on every queue', () => {
    const bad = queues
      .filter((q) => !bounded(q.removeOnComplete) || !bounded(q.removeOnFail))
      .map((q) => q.queue);
    expect(
      bad,
      'removeOnComplete/removeOnFail must be true, a number, or {count|age}; "false" or missing keeps every job for ever.',
    ).toEqual([]);
  });

  it('retries a bounded number of times with a backoff', () => {
    const bad = queues
      .filter((q) => !(q.attempts >= 1 && q.attempts <= 10) || (q.attempts > 1 && !q.backoff))
      .map((q) => `${q.queue} attempts=${q.attempts}`);
    expect(bad).toEqual([]);
  });

  it('sets no unbounded retention or retry count at a producer', () => {
    const bad: string[] = [];
    for (const f of inv.files) {
      for (const m of f.src.matchAll(
        /removeOn(?:Complete|Fail)\s*:\s*(false|undefined|Infinity)\b/g,
      ))
        bad.push(`${short(f.path)} ${m[0]}`);
      for (const m of f.src.matchAll(/\battempts\s*:\s*(\d{3,}|Infinity|Number\.MAX\w*)/g))
        bad.push(`${short(f.path)} ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('creates no queue, worker or events handle outside the queue module', () => {
    const bad: string[] = [];
    for (const f of inv.files) {
      if (f.path.endsWith('infra/queue/queue.module.ts') || !/from 'bullmq'/.test(f.src)) continue;
      for (const m of f.src.matchAll(/new\s+(Queue|Worker|QueueEvents|FlowProducer)\s*\(/g))
        bad.push(`${short(f.path)} ${m[0]}`);
    }
    expect(
      bad,
      'Each hand-made BullMQ object opens its own Redis connections and skips the retention defaults. Register the queue in QUEUES and use @InjectQueue / @Processor.',
    ).toEqual([]);
  });
});

describe('Redis hygiene: connections have deadlines', () => {
  // Each client the application constructs must set `commandTimeout`, or be listed with the reason.
  const NO_COMMAND_TIMEOUT_ALLOWED: Record<string, { why: string }> = {
    'apps/api/src/realtime/redis-io.adapter.ts': {
      why: 'socket.io adapter publisher/subscriber: maxRetriesPerRequest null keeps the subscription across an outage. A deadline on the publisher is recommended (report, open item); the subscriber must not have one',
    },
    'apps/api/src/modules/platform-infrastructure/observability/worker-probe.ts': {
      why: 'one-shot container healthcheck: connectTimeout 2 s, one retry, and Docker kills the check at its own timeout',
    },
  };
  it('sets commandTimeout on every client constructed in application code', () => {
    const news = inv.sites.filter((s) => s.kind === 'new');
    const missing = news.filter((s) => !/commandTimeout\s*:/.test(s.options)).map((s) => s.file);
    const bad = [...new Set(missing)].filter((f) => !NO_COMMAND_TIMEOUT_ALLOWED[f]);
    expect(
      bad.map(short),
      'A silent Redis (dropped route, frozen host) raises no error; without commandTimeout the command waits for ever.',
    ).toEqual([]);
    for (const f of Object.keys(NO_COMMAND_TIMEOUT_ALLOWED)) {
      expect(
        missing,
        `${short(f)} sets commandTimeout now: remove it from NO_COMMAND_TIMEOUT_ALLOWED`,
      ).toContain(f);
    }
  });

  it('sets commandTimeout on the BullMQ producer connection', () => {
    const src = inv.files.find((f) => f.path.endsWith('infra/queue/queue.module.ts'))!.src;
    expect(src).toMatch(/PRODUCER_CONNECTION_OPTIONS\s*=\s*\{[^}]*commandTimeout/);
  });
});

describe('Redis hygiene: the inventory is current', () => {
  it('matches docs/performance/redis/inventory.json', () => {
    expect(() =>
      execFileSync(process.execPath, ['tools/redis-audit/inventory.mjs', '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('keeps the number of Redis calls awaited in a loop from growing', () => {
    // 16 reviewed sites: per-item dedupe claims (one SET NX per inbound message / recipient / webhook) and a small retry loop. Each is
    // bounded by the size of one webhook batch or one send; a new site should batch (pipeline) or say why not.
    expect(inv.sequential.length).toBeLessThanOrEqual(16);
  });
});

describe('the ratchet itself bites (so a green run means something)', () => {
  it('sees a KEYS call, a SET without TTL and a full LRANGE in a snippet', () => {
    const calls = (src: string) => (scan.callsIn(src) as Call[]).map((c) => c.cmd);
    expect(calls("await this.redis.keys('x:*');")).toContain('keys');
    const set = scan.callsIn("await this.redis.set('a:b', v);").find((c) => c.cmd === 'set')!;
    expect(scan.setHasTtl(set)).toBe(false);
    expect(
      scan.setHasTtl(
        scan.callsIn("await this.redis.set('a:b', v, 'EX', 60);").find((c) => c.cmd === 'set')!,
      ),
    ).toBe(true);
    expect(
      scan.setHasTtl(
        scan.callsIn("await this.redis.setex('a:b', 60, v);").find((c) => c.cmd === 'setex')!,
      ),
    ).toBe(true);
    expect(scan.callsIn('await this.redis.lrange(k, 0, -1);')[0]!.text).toMatch(/,\s*-1$/);
  });

  it('tells a lone INCR from one inside a MULTI', () => {
    const lone = scan.callsIn('const n = await this.redis.incr(k);').find((c) => c.cmd === 'incr')!;
    const tx = scan
      .callsIn("await this.redis.multi().incr(k).expire(k, 60, 'NX').exec();")
      .find((c) => c.cmd === 'incr')!;
    expect(lone.direct).toBe(true);
    expect(tx.direct).toBe(false);
  });
});
