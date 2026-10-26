#!/usr/bin/env node
// Rate-limit census (QA sheet 3, item 33). LIVE, LOCAL ONLY: it sends bursts to every public route of an API you started yourself
// and records where each one first answers 429, or that it never does.
//
//   node tools/rate-limit/census.mjs --api http://127.0.0.1:3931 [--out file.json] [--only regex] [--concurrency 4]
//
// It refuses any address that is not loopback or a private range: a census is a flood on purpose. Every route is called from its own
// forged client address (X-Forwarded-For, honoured because the local API trusts its loopback peer), so one route's bucket never
// spends another's. Bodies are empty or invalid on purpose, so nothing is created and no provider is called. The guard counts
// before it validates, which is why an invalid body still spends quota.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleOf } from './sample.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** How many requests a class may take before "never limited" is the honest reading. Above the largest policy for that class. */
export const CAPS = { credential: 120, 'public-write': 400, webhook: 700, 'public-read': 700 };
const PLACEHOLDER = '11111111-1111-4111-8111-111111111111';

/** Only a loopback or private address may be flooded. */
export function isLocal(url) {
  const h = new URL(url).hostname;
  return /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
    h,
  );
}

/** A client address that is unique per route index (10.x.y.z, never repeated). */
export const clientIp = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

/** A route that declares a limit is tested past it, however high: a cap below the declared number would call a working limit missing. */
export function capFor(route) {
  const declared = Number(/^(\d+)\//.exec(route.effective ?? '')?.[1] ?? 0);
  return Math.min(1500, Math.max(CAPS[route.class], declared ? declared + 25 : 0));
}

export const urlFor = (path) => path.replace(/:[A-Za-z0-9_]+/g, PLACEHOLDER).replace(/\/\*$/, '/x');

/** Reads one burst's responses into the facts the report needs. Pure. */
export function summarise(rows, cap) {
  const first429 = rows.findIndex((r) => r.status === 429);
  const statuses = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const hit = first429 >= 0 ? rows[first429] : null;
  const firstOk = rows.find((r) => r.status !== 429);
  const guardHeaders = Boolean(
    rows.find((r) => r.headers['x-ratelimit-limit'])?.headers['x-ratelimit-limit'],
  );
  return {
    sent: rows.length,
    cap,
    first429: first429 >= 0 ? first429 + 1 : null,
    allowedBeforeBlock: first429 >= 0 ? first429 : null,
    limited: first429 >= 0,
    mechanism: first429 < 0 ? 'none' : guardHeaders ? 'guard' : 'bespoke',
    declaredLimit: firstOk?.headers['x-ratelimit-limit']
      ? Number(firstOk.headers['x-ratelimit-limit'])
      : null,
    retryAfter: hit?.headers['retry-after'] ?? null,
    retryAfterOk: hit
      ? /^\d+$/.test(hit.headers['retry-after'] ?? '') && Number(hit.headers['retry-after']) >= 1
      : null,
    code: hit?.code ?? null,
    contentType: hit?.headers['content-type'] ?? null,
    statuses,
    fiveXX: rows.filter((r) => r.status >= 500).length,
    firstFiveXX: rows.find((r) => r.status >= 500)?.status ?? null,
    timeouts: rows.filter((r) => r.status === 0).length,
  };
}

async function one(api, route, ip, timeoutMs) {
  const method = route.method;
  const init = {
    method,
    headers: {
      'x-forwarded-for': ip,
      accept: 'application/json',
      ...(method === 'GET' || method === 'HEAD' ? {} : { 'content-type': 'application/json' }),
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(route.body ?? {});
  try {
    const res = await fetch(api + urlFor(route.path), init);
    const headers = {};
    for (const k of [
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'content-type',
    ]) {
      const v = res.headers.get(k);
      if (v !== null) headers[k] = v;
    }
    let code = null;
    if (res.status === 429) {
      try {
        const b = await res.json();
        code = b?.code ?? b?.error?.code ?? null;
      } catch {
        /* a 429 with no JSON body is recorded as code null */
      }
    } else if (!(res.headers.get('content-type') ?? '').includes('event-stream')) {
      await res.arrayBuffer().catch(() => undefined);
    } else {
      await res.body?.cancel().catch(() => undefined);
    }
    return { status: res.status, headers, code };
  } catch {
    return { status: 0, headers: {}, code: null };
  }
}

export async function burst(api, route, ip, cap, timeoutMs = 8000) {
  const rows = [];
  for (let i = 0; i < cap; i++) {
    const r = await one(api, route, ip, timeoutMs);
    rows.push(r);
    if (r.status === 429) break;
    if (r.status === 0 && rows.filter((x) => x.status === 0).length >= 3) break; // a route that hangs is reported, not waited on
  }
  return rows;
}

/**
 * A body the route's own schema accepts. An empty body is refused by validation before the limiters that sit inside the services
 * (login attempts, one-time codes) ever count it, so a census that sent `{}` would call every credential route "never limited".
 */
export function bodyFor(contracts, bodySchema) {
  const schema = bodySchema ? contracts[bodySchema] : null;
  const sample = schema && typeof schema.safeParse === 'function' ? sampleOf(schema) : undefined;
  return sample === undefined
    ? { body: {}, bodyKind: 'empty' }
    : { body: sample, bodyKind: 'valid' };
}

/** The routes a census sends: public, abuse-prone, and callable without a key. */
export function selectRoutes(inventory, only) {
  return inventory.routes.filter(
    (r) =>
      r.public &&
      ['credential', 'public-write', 'webhook', 'public-read'].includes(r.class) &&
      !r.key.includes('/api/v1/') &&
      (!only || only.test(r.key)),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const api = val('--api');
  if (!api) {
    console.error(
      'usage: census.mjs --api http://127.0.0.1:PORT [--out file] [--only regex] [--concurrency N]',
    );
    process.exit(2);
  }
  if (!isLocal(api)) {
    console.error(
      `refusing ${api}: the census floods a route on purpose, so it only runs against a loopback or private address`,
    );
    process.exit(2);
  }
  const inv = JSON.parse(
    readFileSync(join(ROOT, 'docs/security/rate-limiting/route-inventory.json'), 'utf8'),
  );
  const only = val('--only') ? new RegExp(val('--only')) : null;
  const routes = selectRoutes(inv, only);
  const conc = Number(val('--concurrency', 4));
  const contracts = createRequire(join(ROOT, 'packages/contracts/package.json'))('./dist/index.js');
  const out = val('--out', join(ROOT, 'docs/security/rate-limiting/census.json'));
  const overrides = JSON.parse(readFileSync(join(ROOT, 'tools/rate-limit/bodies.json'), 'utf8'));
  const results = [];
  let next = 0;
  const started = Date.now();
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= routes.length) return;
      const r = routes[i];
      const t = Date.now();
      const { body, bodyKind } = overrides[r.key]
        ? { body: overrides[r.key], bodyKind: 'override' }
        : bodyFor(contracts, r.bodySchema);
      const rows = await burst(
        api,
        { method: r.key.split(' ')[0], path: r.key.split(' ')[1], body },
        clientIp(i + 1),
        capFor(r),
      );
      results[i] = {
        key: r.key,
        class: r.class,
        declared: r.limiter,
        bodyKind,
        ...summarise(rows, capFor(r)),
        ms: Date.now() - t,
      };
      if ((i + 1) % 25 === 0) console.error(`  ${i + 1}/${routes.length}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const doc = {
    generatedBy: 'tools/rate-limit/census.mjs',
    api: 'local',
    routes: results.length,
    seconds: Math.round((Date.now() - started) / 1000),
    results: results.sort((a, b) => a.key.localeCompare(b.key)),
  };
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  const limited = results.filter((r) => r.limited).length;
  console.log(
    `census: ${results.length} routes, ${limited} limited, ${results.length - limited} never limited within the cap, ${results.filter((r) => r.fiveXX).length} answered 5xx; wrote ${out}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
