// QA #63: bytes on the wire. Measures what the top endpoints send (with and without compression), what each web route ships as JavaScript,
// and checks both against perf/bandwidth-budgets.json.
//   node tools/perf/bandwidth.mjs api    --token T [--out perf/results/bandwidth-api.json] [--check]
//   node tools/perf/bandwidth.mjs web    --next apps/web/.next [--out perf/results/bandwidth-web.json] [--check]
// `api` calls the listed endpoints twice (Accept-Encoding: identity, then gzip/br) and records body bytes, wire bytes and whether it was compressed.
// `web` sums the gzip size of the JavaScript each route loads, from the build manifests next build wrote.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};

/** Compression of a response: the ratio of wire bytes to body bytes, and whether the server compressed at all. */
export function compression(identityBytes, wireBytes, encoding) {
  return {
    compressed: Boolean(encoding && encoding !== 'identity'),
    encoding: encoding || null,
    ratio: identityBytes ? wireBytes / identityBytes : null,
  };
}

/** Endpoints over their byte budget (body bytes, uncompressed: the figure that decides memory and parse cost) and, when the budget asks for it, uncompressed on the wire. */
export function checkApi(rows, budgets) {
  const problems = [];
  for (const r of rows) {
    const b = budgets.api.endpoints[r.route] ?? budgets.api.default;
    if (r.identityBytes > b.maxBytes)
      problems.push(`${r.route}: ${r.identityBytes} bytes over its budget of ${b.maxBytes}`);
    if (
      budgets.api.requireCompression &&
      r.identityBytes > budgets.api.compressAboveBytes &&
      !r.gzip.compressed
    )
      problems.push(
        `${r.route}: ${r.identityBytes} bytes sent without compression (limit ${budgets.api.compressAboveBytes})`,
      );
  }
  return problems;
}

/** Sum of the gzip size of the distinct chunks one route loads, plus the chunks every route loads. */
export function routeBytes(chunksByRoute, sizeOf, shared = []) {
  const out = {};
  for (const [route, chunks] of Object.entries(chunksByRoute)) {
    const all = new Set([...shared, ...chunks].filter((c) => c.endsWith('.js')));
    out[route] = { chunks: all.size, gzipBytes: [...all].reduce((n, c) => n + sizeOf(c), 0) };
  }
  return out;
}

/**
 * The App Router (Turbopack) has no per-page list in build-manifest.json. Each page writes a client-reference manifest instead:
 * `globalThis.__RSC_MANIFEST["/route/page"] = {...}` whose client modules name the chunks they load. The union of those chunks is
 * the JavaScript the route can ask for (an upper bound: a chunk is fetched only when its client component renders).
 */
export function chunksFromClientManifest(text) {
  const m = /__RSC_MANIFEST\[("[^"]+")\]\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(text);
  if (!m) return null;
  const route =
    JSON.parse(m[1])
      .replace(/\/page$/, '')
      .replace(/\/\([^)]+\)/g, '') || '/';
  const data = JSON.parse(m[2]);
  const chunks = new Set();
  const add = (list) => {
    for (const c of list ?? []) if (typeof c === 'string') chunks.add(c.replace(/^\/_next\//, ''));
  };
  for (const mod of Object.values(data.clientModules ?? {})) add(mod.chunks);
  for (const files of Object.values(data.entryJSFiles ?? {})) add(files);
  return { route, chunks: [...chunks] };
}

export function checkWeb(routes, budgets) {
  const problems = [];
  for (const [route, r] of Object.entries(routes)) {
    const limit = budgets.web.routes[route] ?? budgets.web.defaultRouteGzipBytes;
    if (r.gzipBytes > limit)
      problems.push(
        `${route}: ${r.gzipBytes} bytes of JavaScript (gzip) over its budget of ${limit}`,
      );
  }
  return problems;
}

const loadBudgets = () =>
  JSON.parse(readFileSync(arg('--budgets', join(ROOT, 'perf/bandwidth-budgets.json')), 'utf8'));

async function measureApi() {
  const base = process.env.API_URL || 'http://localhost:3000';
  const budgets = loadBudgets();
  const token = arg('--token', process.env.PERF_TOKEN);
  const rows = [];
  for (const route of budgets.api.measure) {
    const [method, path] = route.split(' ');
    const get = async (enc) => {
      const res = await fetch(base + path, {
        method,
        headers: { authorization: `Bearer ${token}`, 'accept-encoding': enc },
      });
      const body = Buffer.from(await res.arrayBuffer());
      return {
        status: res.status,
        body,
        bytes: body.length,
        encoding: res.headers.get('content-encoding'),
        cache: res.headers.get('cache-control'),
        etag: res.headers.get('etag'),
      };
    };
    const id = await get('identity');
    const comp = await get('gzip, br');
    // fetch hands back the decoded body, so when the server did compress, the wire size is estimated with a gzip of the same body.
    const gzipped = gzipSync(id.body).length;
    rows.push({
      route,
      status: id.status,
      identityBytes: id.bytes,
      gzip: compression(id.bytes, comp.encoding ? gzipped : id.bytes, comp.encoding),
      gzipIfCompressedBytes: gzipped,
      cacheControl: id.cache,
      etag: Boolean(id.etag),
    });
  }
  return rows;
}

function* clientManifests(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* clientManifests(p);
    else if (e.name === 'page_client-reference-manifest.js') yield p;
  }
}

function measureWeb() {
  const next = resolve(arg('--next', join(ROOT, 'apps/web/.next')));
  const manifestPath = join(next, 'build-manifest.json');
  if (!existsSync(manifestPath))
    throw new Error(`no build manifest under ${next}: run next build first`);
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const shared = m.rootMainFiles ?? [];
  const cache = new Map();
  const sizeOf = (chunk) => {
    if (cache.has(chunk)) return cache.get(chunk);
    const f = join(next, chunk);
    const n = existsSync(f) && statSync(f).isFile() ? gzipSync(readFileSync(f)).length : 0;
    cache.set(chunk, n);
    return n;
  };
  const byRoute = { ...(m.pages ?? {}) };
  const appDir = join(next, 'server/app');
  if (existsSync(appDir))
    for (const f of clientManifests(appDir)) {
      const c = chunksFromClientManifest(readFileSync(f, 'utf8'));
      if (c) byRoute[c.route] = c.chunks;
    }
  return routeBytes(byRoute, sizeOf, shared);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const budgets = mode ? loadBudgets() : null;
  let result;
  let problems = [];
  if (mode === 'api') {
    result = await measureApi();
    problems = checkApi(result, budgets);
  } else if (mode === 'web') {
    result = measureWeb();
    problems = checkWeb(result, budgets);
  } else {
    console.error('usage: bandwidth.mjs api|web [...]');
    process.exit(2);
  }
  if (arg('--out'))
    writeFileSync(
      arg('--out'),
      JSON.stringify({ generatedAt: new Date().toISOString(), mode, result }, null, 1) + '\n',
    );
  console.log(JSON.stringify(result, null, 1));
  if (problems.length) {
    console.error(problems.join('\n'));
    if (process.argv.includes('--check')) process.exit(1);
  }
}
