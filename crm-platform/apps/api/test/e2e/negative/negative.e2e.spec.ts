import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { mutations, validSample } from '../../support/negative';
import { concretePath, negativeRoutes, type NegRoute } from './routes';

/**
 * Negative testing (QA task 13): send every route the wrong thing and prove it refuses cleanly.
 *
 *  1. Body sweep: for every route that validates its body with a zod schema, send each generated bad body
 *     (see test/support/negative.ts). Expect 4xx with the standard error envelope, never 5xx, never 2xx,
 *     no stack trace in the reply.
 *  2. Auth sweep: every non-public route with no token, a garbage token and a tampered token is 401 (never 2xx, never 5xx).
 *  3. Protocol checks on a sample route: malformed JSON, a body over the limit, the wrong content type, a very long query
 *     string, a method the route does not have.
 *
 * `known-gaps.json` lists routes allowed to fail today (owner and reason each). Environment knobs:
 *   NEGATIVE_FILTER=regex   only routes whose "METHOD /path" matches (run one domain at a time)
 *   NEGATIVE_MAX_CASES=n    cases per route (default 12; 0 means all)
 *   NEGATIVE_REPORT=file    write the failures as JSON, to fill known-gaps.json from
 */
const GAPS_FILE = resolve(__dirname, 'known-gaps.json');
const gaps = (
  JSON.parse(readFileSync(GAPS_FILE, 'utf8')) as {
    gaps: Record<string, { owner: string; reason: string }>;
  }
).gaps;
const filter = process.env.NEGATIVE_FILTER ? new RegExp(process.env.NEGATIVE_FILTER) : null;
const maxCases = Number(process.env.NEGATIVE_MAX_CASES ?? 12);
/** Routes the sweep must not call with a valid token: they end the session the sweep is using. */
const SKIP_AUTHED = /^(POST|DELETE) \/v2\/auth\/(logout|sessions)/;

let h: Harness;
let api: Api;
let t: Tenant;
let routes: NegRoute[] = [];
const failures: Array<{ route: string; case: string; status: number; why: string }> = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('negative');
  routes = (await negativeRoutes(h.app)).filter((r) => !filter || filter.test(r.route));
}, 240_000);
afterAll(async () => {
  if (process.env.NEGATIVE_REPORT)
    writeFileSync(process.env.NEGATIVE_REPORT, JSON.stringify(failures, null, 2));
  await h?.stop();
});

const send = (r: NegRoute, token: string | null, body?: unknown) => {
  const req = api.http()[r.method.toLowerCase() as 'post'](concretePath(r.path));
  if (token) req.set('authorization', `Bearer ${token}`);
  // Always real JSON: supertest turns a bare string into a form body, which the server reads as {} and a schema of optional fields accepts.
  return body === undefined
    ? req
    : req.set('content-type', 'application/json').send(JSON.stringify(body));
};

/** The checks every refusal must pass. Returns the reason it did not, or null. */
function badReply(res: { status: number; body: unknown; text: string }): string | null {
  if (res.status >= 500) return `5xx (${res.status})`;
  if (res.status >= 200 && res.status < 300) return `accepted (${res.status})`;
  if (/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(res.text)) return 'stack trace in the reply';
  // Platform routes answer problem+json with a top-level `code`; the customer API (/api/v1) answers `{ error: { code, message } }`.
  const b = res.body as { code?: unknown; error?: { code?: unknown } } | null;
  const code = b?.code ?? b?.error?.code;
  if (res.status !== 404 && res.status !== 401 && typeof code !== 'string')
    return 'no error code in the reply';
  return null;
}

describe('body sweep: a bad body is refused cleanly', () => {
  it('covers the routes that validate their body with a zod schema', () => {
    const withSchema = routes.filter((r) => r.bodySchema);
    console.log(`NEGATIVE routes=${routes.length} withBodySchema=${withSchema.length}`);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('refuses every generated bad body with a 4xx and the error envelope', async () => {
    const bad: Record<string, string[]> = {};
    let sent = 0;
    for (const r of routes) {
      if (!r.bodySchema || r.method === 'GET' || SKIP_AUTHED.test(r.route)) continue;
      const base = validSample(r.bodySchema);
      let cases = mutations(r.bodySchema, base ?? {});
      if (maxCases > 0) cases = cases.slice(0, maxCases);
      for (const c of cases) {
        const res = await send(r, r.isPublic ? null : t.admin, c.body);
        sent++;
        const why = badReply(res);
        if (why) {
          (bad[r.route] ??= []).push(`${c.label}: ${why}`);
          failures.push({ route: r.route, case: c.label, status: res.status, why });
        }
      }
    }
    console.log(`NEGATIVE sent=${sent} failingRoutes=${Object.keys(bad).length}`);
    const unexpected = Object.entries(bad).filter(([route]) => !(route in gaps));
    expect(unexpected, JSON.stringify(unexpected.slice(0, 20), null, 1)).toEqual([]);
    const stale = Object.keys(gaps).filter(
      (k) => routes.some((r) => r.route === k) && !(k in bad) && !filter,
    );
    expect(stale, 'these routes now pass: take them off known-gaps.json').toEqual([]);
  }, 1_800_000);
});

describe('auth sweep: no token, a garbage token, a tampered token', () => {
  it('is 401 on every protected route, never 2xx or 5xx', async () => {
    const real = t.admin;
    const tampered = `${real.slice(0, -4)}${real.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    const bad: string[] = [];
    for (const r of routes) {
      if (r.isPublic) continue;
      for (const [label, token] of [
        ['no token', null],
        ['garbage token', 'not.a.token'],
        ['tampered token', tampered],
      ] as const) {
        const res = await send(
          r,
          token,
          r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
        );
        if (res.status !== 401) bad.push(`${r.route} (${label}): ${res.status}`);
      }
    }
    const unexpected = bad.filter((b) => !(b.split(' (')[0]! in gaps));
    expect(unexpected.slice(0, 40)).toEqual([]);
  }, 1_800_000);
});

describe('protocol checks on POST /v2/tags', () => {
  const post = () => api.as(t.admin).post('/v2/tags');
  it('malformed JSON is a 400', async () => {
    const res = await post().set('content-type', 'application/json').send('{"name": "x"');
    expect(res.status).toBe(400);
  });
  it('a body over the limit is a 413', async () => {
    const res = await post().send({ name: 'x', pad: 'y'.repeat(1024 * 1024) });
    expect(res.status).toBe(413);
  });
  it('the wrong content type is refused, not a 500', async () => {
    const res = await post().set('content-type', 'text/plain').send('name=x');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  it('a very long query string is refused, not a 500', async () => {
    const res = await api.as(t.admin).get(`/v2/tags?q=${'a'.repeat(20_000)}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  it('a method the route does not have is a 404 or 405', async () => {
    const res = await api.as(t.admin).put('/v2/tags');
    expect([404, 405]).toContain(res.status);
  });
});
