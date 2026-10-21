#!/usr/bin/env node
// Rate-limit behaviour probes (QA sheet 3, item 33). LIVE, LOCAL ONLY, against an API started from a seeded scratch database.
//
//   node tools/rate-limit/probes.mjs --api http://127.0.0.1:PORT --db <scratch db> [--direct-api URL] [--redis-prefix qa-xxx:] [--out file]
//
// The census asks "does this route ever answer 429?". That misses three things, and these probes cover them:
//   1. limits that are silent on purpose (forgot-password answers the same neutral 201 so it cannot be used to find accounts, but it
//      still mails at most once a minute per address): measured by what the system DID, not what it said;
//   2. attacks the per-address limit cannot see (many addresses against one account, many guesses at one code);
//   3. ways round a limit (a forged address header, a path variant, the other spelling of one address).
// Each probe returns PASS / FAIL / INFO with the severity a FAIL would carry and the numbers behind it.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { isLocal } from './census.mjs';

const args = process.argv.slice(2);
const val = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);

/** One HTTP call from a chosen client address. Never throws. */
export async function call(api, method, path, { ip, body, headers = {} } = {}) {
  const t = Date.now();
  try {
    const res = await fetch(api + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(ip ? { 'x-forwarded-for': ip } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const h = Object.fromEntries(res.headers.entries());
    return { status: res.status, headers: h, json, text, ms: Date.now() - t };
  } catch (err) {
    return { status: 0, headers: {}, json: null, text: String(err), ms: Date.now() - t };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A first octet that changes every run, so state left by an earlier run on the same database cannot colour this one. */
const RUN = 100 + (Math.floor(Date.now() / 1000) % 100);
const ip4 = (a, b, c, d) => `${a === 100 ? RUN : a}.${b}.${c}.${d}`;

/** The guard-limited public route the probes use as their yardstick (60 per minute per address, set by @Throttle). */
const YARDSTICK = '/v2/public/compliance/trust/census-probe';

export function makeProbes({ api, db, direct, redisPrefix, redisDb = '9' }) {
  const psql = (sql) =>
    execFileSync(
      'docker',
      ['exec', '-i', 'crm-platform-postgres', 'psql', '-U', 'crm', '-d', db, '-tA', '-c', sql],
      { encoding: 'utf8' },
    ).trim();
  const redis = (...a) =>
    execFileSync('docker', ['exec', '-i', 'crm-platform-redis', 'redis-cli', '-n', redisDb, ...a], {
      encoding: 'utf8',
    }).trim();

  return [
    {
      id: 'forgot-password-mail-flood',
      title: 'Password-reset mail is capped per address, whatever the client address',
      ifFails: 'High',
      run: async () => {
        const email = 'nachiket.challawar@geta.ai';
        const tokens = () =>
          Number(psql("SELECT count(*) FROM user_tokens WHERE kind = 'password_reset'"));
        const send = (ip) =>
          call(api, 'POST', '/v2/auth/forgot-password', { ip, body: { orgSlug: 'Admin', email } });
        const before = tokens();
        // positive control: ONE request must issue exactly one token, or the count below proves nothing
        const control = await send(ip4(100, 1, 1, 1));
        await sleep(1500);
        const issued = tokens() - before;
        if (issued !== 1)
          return {
            status: 'ERROR',
            detail: `the control request (status ${control.status}) issued ${issued} token(s), not 1, so the oracle cannot be trusted`,
          };
        const one = [];
        for (let i = 0; i < 29; i++) one.push((await send(ip4(100, 1, 1, 1))).status);
        const many = [];
        for (let i = 0; i < 30; i++) many.push((await send(ip4(100, 2 + i, 1, 1))).status);
        await sleep(1500);
        const total = tokens() - before;
        const statuses = [control.status, ...one, ...many];
        const uniform = new Set(statuses).size === 1;
        return {
          status: total === 1 ? 'PASS' : 'FAIL',
          detail: `1 control request issued 1 reset token; 59 more (29 from the same address, 30 from 30 other addresses) for the same account brought the total to ${total}. The reply was ${uniform ? 'the same neutral ' + statuses[0] : 'NOT uniform: ' + [...new Set(statuses)].join(',')} every time.`,
        };
      },
    },
    {
      id: 'distributed-login-guessing',
      title:
        'Guessing one account from many networks is stopped, and the owner on a known network is not locked out',
      ifFails: 'Critical',
      run: async () => {
        const login = (ip, password) =>
          call(api, 'POST', '/v2/auth/login', {
            ip,
            body: { orgSlug: 'Admin', email: 'nachiket.challawar@geta.ai', password },
          });
        const home = ip4(100, 250, 0, 1);
        const first = await login(home, 'Passw0rd!'); // a successful sign-in makes this a known network
        const signedIn = (r) => r.status < 300 && r.json?.status === 'authenticated';
        if (!signedIn(first))
          return {
            status: 'ERROR',
            detail: `the control sign-in answered ${first.status}, so there is no known network to protect`,
          };
        let blockedAt = null;
        const seen = {};
        for (let i = 0; i < 80 && blockedAt === null; i++) {
          const r = await login(ip4(100, i, 7, 7), `wrong-${i}`);
          seen[r.status] = (seen[r.status] ?? 0) + 1;
          if (r.status === 429) blockedAt = i + 1;
        }
        const stranger = await login(ip4(101, 1, 1, 1), 'Passw0rd!');
        const owner = await login(home, 'Passw0rd!');
        const ok =
          blockedAt !== null && blockedAt <= 60 && stranger.status === 429 && signedIn(owner);
        return {
          status: ok ? 'PASS' : 'FAIL',
          detail: `control sign-in ${first.status}; blocked after ${blockedAt ?? 'never (80 tried)'} wrong guesses from different networks (${JSON.stringify(seen)}); a stranger with the RIGHT password then got ${stranger.status} (${stranger.json?.code ?? '-'}); the owner from the known network got ${owner.status}.`,
        };
      },
    },
    {
      id: 'retry-after-recovers',
      title: 'A client that waits for Retry-After is let back in',
      ifFails: 'Medium',
      run: async () => {
        const ip = ip4(100, 60, 0, 1);
        let hit = null;
        for (let i = 0; i < 90 && !hit; i++) {
          const r = await call(api, 'GET', YARDSTICK, { ip });
          if (r.status === 429) hit = r;
        }
        if (!hit)
          return {
            status: 'FAIL',
            detail: 'the yardstick route never answered 429 in 90 requests',
          };
        const wait = Number(hit.headers['retry-after']);
        await sleep((wait + 1) * 1000);
        const again = await call(api, 'GET', YARDSTICK, { ip });
        return {
          status: again.status !== 429 ? 'PASS' : 'FAIL',
          detail: `429 carried Retry-After ${wait}s; after waiting ${wait + 1}s the next request answered ${again.status}.`,
        };
      },
    },
    {
      id: 'parallel-burst-is-atomic',
      title: '150 simultaneous requests against a limit of 60 admit exactly 60',
      ifFails: 'High',
      run: async () => {
        const ip = ip4(100, 61, 0, 1);
        const rs = await Promise.all(
          Array.from({ length: 150 }, () => call(api, 'GET', YARDSTICK, { ip })),
        );
        const allowed = rs.filter((r) => r.status !== 429).length;
        const limited = rs.filter((r) => r.status === 429).length;
        return {
          status: allowed === 60 && limited === 90 ? 'PASS' : 'FAIL',
          detail: `${allowed} allowed, ${limited} refused of 150 simultaneous; the limit is 60.`,
        };
      },
    },
    {
      id: 'path-variants-share-the-bucket',
      title: 'A limited route stays limited under path and header variants',
      ifFails: 'High',
      run: async () => {
        const ip = ip4(100, 62, 0, 1);
        for (let i = 0; i < 70; i++) await call(api, 'GET', YARDSTICK, { ip });
        const variants = {
          'trailing slash': [YARDSTICK + '/', {}],
          'double slash': [YARDSTICK.replace('/v2/public', '/v2//public'), {}],
          'cache-buster query': [YARDSTICK + '?cb=' + Date.now(), {}],
          'upper-case segment': [YARDSTICK.replace('trust', 'TRUST'), {}],
          'encoded character': [YARDSTICK.replace('trust', 'tru%73t'), {}],
          'other Accept header': [YARDSTICK, { accept: 'text/html' }],
          'other User-Agent': [YARDSTICK, { 'user-agent': 'curl/9' }],
          'HEAD instead of GET': [YARDSTICK, {}, 'HEAD'],
        };
        const out = {};
        for (const [name, [p, h, m]] of Object.entries(variants))
          out[name] = (await call(api, m ?? 'GET', p, { ip, headers: h })).status;
        const escaped = Object.entries(out).filter(([, s]) => s !== 429 && s !== 404);
        // a 404 means the variant is a different (unrouted) path, which spends nothing and reaches nothing
        return { status: escaped.length === 0 ? 'PASS' : 'FAIL', detail: JSON.stringify(out) };
      },
    },
    {
      id: 'ip-spellings',
      title: 'One client under two spellings of its address shares one counter',
      ifFails: 'Medium',
      run: async () => {
        const plain = '100.70.0.9';
        const mapped = '::ffff:100.70.0.9';
        let spent = 0;
        for (let i = 0; i < 60; i++) {
          const r = await call(api, 'GET', YARDSTICK, { ip: i % 2 ? mapped : plain });
          if (r.status !== 429) spent++;
        }
        // 60 alternating requests: one shared counter admits 60 in total; two counters would admit 60 and still have room
        const after = await call(api, 'GET', YARDSTICK, { ip: plain });
        const afterMapped = await call(api, 'GET', YARDSTICK, { ip: mapped });
        const shared = after.status === 429 && afterMapped.status === 429;
        return {
          status: shared ? 'PASS' : 'FAIL',
          detail: `after 60 alternating requests: plain ${after.status}, IPv4-mapped IPv6 ${afterMapped.status} (shared counter: both 429)`,
        };
      },
    },
    {
      id: 'ipv6-block-rotation',
      title:
        'A client rotating addresses inside one IPv6 /64 does not get a fresh counter each time',
      ifFails: 'Medium',
      run: async () => {
        let allowed = 0;
        for (let i = 0; i < 100; i++) {
          const r = await call(api, 'GET', YARDSTICK, {
            ip: `2001:db8:abcd:12::${(i + 1).toString(16)}`,
          });
          if (r.status !== 429) allowed++;
        }
        return {
          status: allowed <= 60 ? 'PASS' : 'FAIL',
          detail: `100 requests from 100 addresses of one /64 against a limit of 60: ${allowed} allowed.`,
        };
      },
    },
    {
      id: 'forged-header-ignored-direct',
      title: 'A client the API does not trust cannot dodge a limit with X-Forwarded-For',
      ifFails: 'Critical',
      run: async () => {
        if (!direct)
          return {
            status: 'SKIP',
            detail: 'no --direct-api (an API booted so that its peer is NOT a trusted proxy)',
          };
        let allowed = 0;
        for (let i = 0; i < 100; i++) {
          const r = await call(direct, 'GET', YARDSTICK, { ip: ip4(100, 80, i, 1) });
          if (r.status !== 429) allowed++;
        }
        return {
          status: allowed <= 60 ? 'PASS' : 'FAIL',
          detail: `100 requests each claiming a different X-Forwarded-For, from an untrusted peer: ${allowed} allowed (limit 60).`,
        };
      },
    },
    {
      id: 'limited-response-shape',
      title: 'A refusal is a clean problem+json with consistent quota headers',
      ifFails: 'Low',
      run: async () => {
        const ip = ip4(100, 90, 0, 1);
        const rem = [];
        let hit = null;
        let first = null;
        for (let i = 0; i < 80 && !hit; i++) {
          const r = await call(api, 'GET', YARDSTICK, { ip });
          if (i === 0) first = r;
          if (r.status === 429) hit = r;
          else rem.push(Number(r.headers['x-ratelimit-remaining']));
        }
        if (!hit) return { status: 'FAIL', detail: 'never limited' };
        const countsDown = rem.slice(1).every((v, i) => v === rem[i] - 1);
        const bodyOk =
          hit.json?.code === 'RATE_LIMITED' &&
          hit.json?.status === 429 &&
          /problem\+json/.test(hit.headers['content-type'] ?? '') &&
          !/\bat \S+ \(/.test(hit.text);
        const ra = Number(hit.headers['retry-after']);
        const limitOk = Number(first.headers['x-ratelimit-limit']) === 60;
        const ok = countsDown && bodyOk && ra >= 1 && ra <= 60 && limitOk;
        return {
          status: ok ? 'PASS' : 'FAIL',
          detail: `remaining counts down by one: ${countsDown}; problem+json with code RATE_LIMITED and no stack: ${bodyOk}; Retry-After ${ra}; X-RateLimit-Limit ${first.headers['x-ratelimit-limit']}.`,
        };
      },
    },
    {
      id: 'counters-expire',
      title:
        'Every rate-limit counter in Redis has an expiry (an attacker rotating addresses cannot fill Redis)',
      ifFails: 'High',
      run: async () => {
        const keys = redis('--scan', '--pattern', '*rl:*').split('\n').filter(Boolean);
        if (!keys.length)
          return { status: 'SKIP', detail: 'no rl: keys found (is the prefix right?)' };
        let noTtl = 0;
        let longest = 0;
        for (const k of keys.slice(0, 400)) {
          const ttl = Number(redis('ttl', k));
          if (ttl < 0) noTtl++;
          longest = Math.max(longest, ttl);
        }
        return {
          status: noTtl === 0 ? 'PASS' : 'FAIL',
          detail: `${keys.length} counters, ${noTtl} without an expiry, longest remaining lifetime ${longest}s.`,
        };
      },
    },
  ];
}

async function main() {
  const api = val('--api');
  const db = val('--db');
  if (!api || !db) {
    console.error(
      'usage: probes.mjs --api URL --db <scratch database> [--direct-api URL] [--redis-prefix qa-xxx:] [--out file] [--only id]',
    );
    process.exit(2);
  }
  for (const u of [api, val('--direct-api')].filter(Boolean)) {
    if (!isLocal(u)) {
      console.error(
        `refusing ${u}: the probes flood an API on purpose, so they only run against a loopback or private address`,
      );
      process.exit(2);
    }
  }
  const only = val('--only');
  const probes = makeProbes({
    api,
    db,
    direct: val('--direct-api'),
    redisPrefix: val('--redis-prefix', ''),
    redisDb: val('--redis-db', '9'),
  }).filter((p) => !only || p.id === only);
  const results = [];
  for (const p of probes) {
    let r;
    try {
      r = await p.run();
    } catch (err) {
      r = { status: 'ERROR', detail: String(err).slice(0, 300) };
    }
    results.push({ id: p.id, title: p.title, severityIfFails: p.ifFails, ...r });
    console.log(`  ${r.status.padEnd(5)} ${p.id}: ${r.detail}`);
  }
  const out = val('--out');
  if (out)
    writeFileSync(
      out,
      JSON.stringify({ generatedBy: 'tools/rate-limit/probes.mjs', results }, null, 2) + '\n',
    );
  process.exit(results.some((r) => r.status === 'FAIL' || r.status === 'ERROR') ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) main();
