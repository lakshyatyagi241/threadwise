import { writeFileSync } from 'node:fs';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../e2e/contacts-attributes-tags/support';
import { concretePath, negativeRoutes, type NegRoute } from '../e2e/negative/routes';
import { installBodyLimits } from '../../src/modules/platform-infrastructure/body-limits/body-limits';
import { Rng, anything, perturb, text } from './gen';
import { show } from './engine';
import { sampleOf } from './targets/schemas';
import { ProblemExceptionFilter } from '../../src/common/filters/problem-exception.filter';

/**
 * HTTP layer fuzz (smaller volume than the pure targets): the whole Nest app in-process on its own throwaway Postgres and Redis (the
 * e2e harness starts and removes them), hit with hostile requests on every route. For each: never a 5xx, no stack trace in the body,
 * an answer inside the deadline, and the process neither crashes nor logs an unhandled rejection.
 *
 * Egress is shut: DNS answers only for localhost and a connection to a host that is not loopback is refused and counted, so a hostile
 * URL in a body can never reach a real machine. Run through `tools/quality/fuzz.mjs`; environment: FUZZ_SEED, FUZZ_HTTP_REQUESTS
 * (default 4000), FUZZ_HTTP_REPORT (a JSON file), FUZZ_HTTP_ROUTE (a regex on "METHOD /path").
 */
const seed = process.env.FUZZ_SEED
  ? Number(process.env.FUZZ_SEED) >>> 0
  : Math.floor(Math.random() * 0xffffffff) >>> 0;
const TOTAL = Number(process.env.FUZZ_HTTP_REQUESTS ?? 4000);
const DEADLINE_MS = 15_000;
/** encodeURIComponent throws on a lone surrogate. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** JSON.stringify that survives a value nested too deep for it (the request then carries the unclosed deep text instead). */
const stringify = (v: unknown): string | null => {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x)) ?? 'null';
  } catch {
    return null;
  }
};
const SKIP = /^(POST|DELETE) \/v2\/auth\/(logout|sessions)|^GET \/docs\/api\.json/; // the OpenAPI document is attached by main.ts, not by the harness

let lastError = '';
const origCatch = ProblemExceptionFilter.prototype.catch;
/** Remembers what the filter was handed, so a 500 can be reported with its cause (the reply never carries it). */
ProblemExceptionFilter.prototype.catch = function (
  this: ProblemExceptionFilter,
  e: unknown,
  host: never,
) {
  lastError =
    e instanceof Error
      ? `${e.constructor.name}: ${e.message.replace(/\s+/g, ' ').slice(0, 140)} @ ${(e.stack ?? '').split('\n')[1]?.trim().slice(-90) ?? ''}`
      : String(e);
  return origCatch.call(this, e, host);
};

const egress = new Map<string, number>();
const unhandled: string[] = [];

function shutEgress(): void {
  const loopback = (h: unknown) =>
    typeof h === 'string' && /^(localhost|127\.|::1|\[::1\]|0\.0\.0\.0|::ffff:127\.)/i.test(h);
  const origConnect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = args[0] as
      { host?: string; path?: string; port?: number } | number | string | undefined;
    const host =
      typeof first === 'object' && first !== null
        ? first.host
        : typeof args[1] === 'string'
          ? args[1]
          : 'localhost';
    const isPath = typeof first === 'object' && first !== null && first.path !== undefined;
    if (!isPath && host !== undefined && !loopback(host)) {
      egress.set(String(host), (egress.get(String(host)) ?? 0) + 1);
      queueMicrotask(() =>
        this.destroy(
          Object.assign(new Error(`egress blocked: ${String(host)}`), { code: 'ECONNREFUSED' }),
        ),
      );
      return this;
    }
    return origConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;
  const fail = (host: string) =>
    Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  const origLookup = dns.lookup;
  (dns as { lookup: unknown }).lookup = ((host: string, ...rest: unknown[]) => {
    const cb = rest[rest.length - 1] as (e: Error | null, ...r: unknown[]) => void;
    if (/^localhost$/i.test(host) || net.isIP(host))
      return (origLookup as (...a: unknown[]) => unknown)(host, ...rest);
    egress.set(`dns:${host}`, (egress.get(`dns:${host}`) ?? 0) + 1);
    return void process.nextTick(() => cb(fail(host)));
  }) as typeof dns.lookup;
  const origP = dnsPromises.lookup;
  (dnsPromises as { lookup: unknown }).lookup = (async (host: string, ...rest: unknown[]) => {
    if (/^localhost$/i.test(host) || net.isIP(host))
      return (origP as (...a: unknown[]) => unknown)(host, ...rest);
    egress.set(`dns:${host}`, (egress.get(`dns:${host}`) ?? 0) + 1);
    throw fail(host);
  }) as typeof dnsPromises.lookup;
  syncBuiltinESMExports();
}

// --- request building -----------------------------------------------------------------------------------------------------------

const QUERIES = [
  'limit[toString]=1',
  'limit[a][b]=1',
  'limit=-1',
  'limit=1e9',
  'limit=NaN',
  'limit[]=1&limit[]=2',
  'page=0',
  'page=-1',
  'cursor=%00',
  'cursor=MjAyNnwgNw',
  'cursor=MTJ8MQ',
  '__proto__[polluted]=1',
  'constructor[prototype][polluted]=1',
  'sort=;drop table x',
  'sort=-',
  'q=%ZZ',
  'q[$ne]=1',
  'a[b][c][d][e][f][g][h][i][j]=1',
  'a=%E0%A4%A',
  'from=0000-00-00',
  'to=275760-09-14',
  'id=%00',
  'x=\ud800',
];

function hostileQuery(r: Rng): string {
  const k = r.next();
  if (k < 0.5) return r.pick(QUERIES);
  if (k < 0.7)
    return `${encodeURIComponent(text(r).slice(0, 20).replace(LONE_SURROGATE, '?')) || 'q'}=${encodeURIComponent(text(r).slice(0, 200).replace(LONE_SURROGATE, '?'))}`;
  if (k < 0.8) return Array.from({ length: r.range(50, 1200) }, (_, i) => `p${i}=${i}`).join('&');
  if (k < 0.9) return `a${'[b]'.repeat(r.range(5, 300))}=1`;
  return `${text(r).slice(0, 40)}`.replace(/[\s#]/g, '');
}

interface Built {
  path: string;
  headers: Record<string, string>;
  body: Buffer | string | null;
  summary: string;
}

function deepJson(r: Rng): string {
  const n = r.range(500, 12_000);
  return r.chance(0.5) ? '['.repeat(n) + ']'.repeat(n) : '{"a":'.repeat(n) + '1' + '}'.repeat(n);
}

function build(r: Rng, route: NegRoute, token: string): Built {
  const parts = concretePath(route.path).split('/');
  const rawParts = route.path.split('/');
  const path = parts
    .map((p, i) =>
      rawParts[i]!.startsWith(':') && r.chance(0.5)
        ? encodeURIComponent(text(r).slice(0, 80).replace(LONE_SURROGATE, '?')) || 'x'
        : p,
    )
    .join('/');
  const headers: Record<string, string> = {
    'x-forwarded-for': `10.${r.range(1, 250)}.${r.range(1, 250)}.${r.range(1, 250)}`,
  };
  const a = r.next();
  if (a < 0.6) Object.assign(headers, bearer(token));
  else if (a < 0.75)
    headers.authorization = `Bearer ${text(r)
      .replace(/[^\x20-\x7e]/g, '')
      .slice(0, 300)}`;
  const q = r.chance(0.5) ? `?${hostileQuery(r)}` : '';
  let body: Buffer | string | null = null;
  const k = r.next();
  const sample = route.bodySchema ? sampleOf(route.bodySchema) : undefined;
  if (route.method !== 'GET') {
    headers['content-type'] = 'application/json';
    if (k < 0.4)
      body = stringify(sample !== undefined ? perturb(r, sample) : anything(r)) ?? deepJson(r);
    else if (k < 0.5) body = stringify(anything(r)) ?? deepJson(r);
    else if (k < 0.58) body = deepJson(r);
    else if (k < 0.66)
      body = text(r).slice(0, 5000); // not JSON
    else if (k < 0.72)
      body = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc0, 0xaf, 0xff, 0xfe, 0x22, 0x7d]); // invalid UTF-8
    else if (k < 0.78)
      body = '{"a":"\\u0000","__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}';
    else if (k < 0.84) {
      headers['content-type'] = r.pick([
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
        'multipart/form-data; boundary=',
        'application/xml',
        'application/json; charset=utf-16',
        '',
      ]);
      body = hostileQuery(r);
    } else if (k < 0.9)
      body = JSON.stringify({
        items: Array.from({ length: r.range(100, 3000) }, (_, i) => ({
          id: i,
          v: text(r).slice(0, 20),
        })),
      });
    else if (k < 0.95) body = '';
    else body = stringify(perturb(r, sample ?? { a: 'x' })) ?? deepJson(r);
  }
  return {
    path: `${path}${q}`,
    headers,
    body,
    summary: `${route.method} ${route.path} ct=${headers['content-type'] ?? '-'} auth=${headers.authorization ? 'yes' : 'no'} body=${body === null ? '-' : show(typeof body === 'string' ? body.slice(0, 160) : `<${body.length} bytes>`, 200)}`,
  };
}

// --- run --------------------------------------------------------------------------------------------------------------------------

let h: Harness;
let api: Api;
let tenant: Tenant;
let routes: NegRoute[] = [];

beforeAll(async () => {
  process.on('unhandledRejection', (e) =>
    unhandled.push(`unhandledRejection: ${String((e as Error)?.stack ?? e).slice(0, 300)}`),
  );
  process.on('uncaughtException', (e) =>
    unhandled.push(`uncaughtException: ${String(e.stack ?? e).slice(0, 300)}`),
  );
  shutEgress();
  h = await startHarness({ configureApp: (app) => installBodyLimits(app as never) });
  api = new Api(h);
  tenant = await api.signup('fuzz');
  const only = process.env.FUZZ_HTTP_ROUTE ? new RegExp(process.env.FUZZ_HTTP_ROUTE) : null;
  routes = (await negativeRoutes(h.app)).filter(
    (x) => !SKIP.test(x.route) && (!only || only.test(x.route)),
  );
}, 600_000);
afterAll(async () => {
  await h?.stop();
});

interface HttpFailure {
  route: string;
  kind: string;
  status: number | null;
  detail: string;
  request: string;
  iter: number;
  count: number;
}

describe('http fuzz', () => {
  it('answers every hostile request cleanly', async () => {
    console.log(`FUZZ seed=${seed} routes=${routes.length} requests=${TOTAL}`);
    const failures = new Map<string, HttpFailure>();
    const statuses: Record<string, number> = {};
    const t0 = Date.now();
    let token = tenant.admin;
    let sent = 0;
    for (let i = 0; i < TOTAL; i += 1) {
      const r = Rng.for(seed, 'http', i);
      const route = routes[i % routes.length]!;
      if (i % 400 === 399) token = (await api.signup('fuzz')).admin;
      const b = build(r, route, token);
      let status: number | null = null;
      let bodyText = '';
      let kind: string | null = null;
      lastError = '';
      let detail = '';
      const start = Date.now();
      try {
        let req = request(h.app.getHttpServer())
          [route.method.toLowerCase() as 'get'](b.path)
          .timeout({ response: DEADLINE_MS, deadline: DEADLINE_MS + 5000 });
        for (const [k, v] of Object.entries(b.headers)) req = req.set(k, v);
        const res = await (b.body === null ? req : req.send(b.body as never));
        status = res.status;
        bodyText = res.text ?? '';
      } catch (e) {
        kind = 'no answer';
        detail = String((e as Error).message).slice(0, 160);
      }
      sent += 1;
      const key = status === null ? 'none' : `${Math.floor(status / 100)}xx`;
      statuses[key] = (statuses[key] ?? 0) + 1;
      if (kind === null && status !== null && status >= 500) {
        kind = '5xx';
        detail = lastError || bodyText.replace(/\s+/g, ' ').slice(0, 200);
      } else if (
        kind === null &&
        /\bat\s+\S+\s+\(.*:\d+:\d+\)|node_modules|\.ts:\d+:\d+/.test(bodyText)
      ) {
        kind = 'stack trace in the body';
        detail = bodyText.replace(/\s+/g, ' ').slice(0, 200);
      } else if (kind === null && Date.now() - start > DEADLINE_MS) {
        kind = 'slow';
        detail = `${Date.now() - start} ms`;
      }
      if (kind !== null) {
        const sig = `${route.route}|${kind}|${status}|${detail.slice(0, 60)}`;
        const seen = failures.get(sig);
        if (seen) seen.count += 1;
        else
          failures.set(sig, {
            route: route.route,
            kind,
            status,
            detail,
            request: `${b.summary} path=${b.path.slice(0, 160)}`,
            iter: i,
            count: 1,
          });
      }
    }
    for (const u of unhandled)
      failures.set(u, {
        route: '(process)',
        kind: 'unhandled',
        status: null,
        detail: u,
        request: '',
        iter: -1,
        count: 1,
      });
    const out = {
      seed,
      routes: routes.length,
      sent,
      durationMs: Date.now() - t0,
      statuses,
      egressBlocked: Object.fromEntries(egress),
      failures: [...failures.values()],
    };
    if (process.env.FUZZ_HTTP_REPORT)
      writeFileSync(process.env.FUZZ_HTTP_REPORT, JSON.stringify(out, null, 2));
    console.log(
      `FUZZ HTTP sent=${sent} ms=${out.durationMs} statuses=${JSON.stringify(statuses)} failures=${out.failures.length} egressBlocked=${egress.size}`,
    );
    for (const f of out.failures)
      console.log(
        `FUZZ HTTP FAIL ${f.route} [${f.kind} ${f.status}] x${f.count} ${f.detail}\n   ${f.request}`,
      );
    expect(out.failures).toEqual([]);
  }, 3_600_000);
});
