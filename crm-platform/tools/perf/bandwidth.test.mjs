import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkApi,
  checkWeb,
  chunksFromClientManifest,
  compression,
  routeBytes,
} from './bandwidth.mjs';

const budgets = {
  api: {
    default: { maxBytes: 50000 },
    endpoints: { 'GET /big': { maxBytes: 200000 } },
    requireCompression: true,
    compressAboveBytes: 1024,
  },
  web: { defaultRouteGzipBytes: 1000, routes: { '/heavy': 5000 } },
};
const row = (route, identityBytes, encoding = null) => ({
  route,
  identityBytes,
  gzip: compression(identityBytes, encoding ? identityBytes / 4 : identityBytes, encoding),
});

test('compression: a gzip response is compressed with its ratio; no header means not compressed', () => {
  assert.deepEqual(compression(1000, 250, 'gzip'), {
    compressed: true,
    encoding: 'gzip',
    ratio: 0.25,
  });
  assert.equal(compression(1000, 1000, null).compressed, false);
});
test('an endpoint over its byte budget is named', () => {
  const p = checkApi([row('GET /list', 60000, 'gzip')], budgets);
  assert.match(p[0], /GET \/list: 60000 bytes over its budget of 50000/);
});
test('a per-endpoint budget replaces the default', () =>
  assert.deepEqual(checkApi([row('GET /big', 150000, 'gzip')], budgets), []));
test('a large response sent uncompressed is a problem, a small one is not', () => {
  assert.match(checkApi([row('GET /a', 20000)], budgets)[0], /without compression/);
  assert.deepEqual(checkApi([row('GET /b', 500)], budgets), []);
});
test('route bytes sum the distinct chunks once, with the shared ones, JavaScript only', () => {
  const sizes = { 'a.js': 100, 'b.js': 200, 'shared.js': 50, 'x.css': 999 };
  const r = routeBytes({ '/p': ['a.js', 'b.js', 'a.js', 'x.css'] }, (c) => sizes[c], ['shared.js']);
  assert.deepEqual(r['/p'], { chunks: 3, gzipBytes: 350 });
});
test('a route over its JavaScript budget is named; a named budget replaces the default', () => {
  const p = checkWeb({ '/a': { gzipBytes: 1500 }, '/heavy': { gzipBytes: 4000 } }, budgets);
  assert.equal(p.length, 1);
  assert.match(p[0], /^\/a: 1500 bytes/);
});

test('a client-reference manifest gives the route and the distinct chunks its client modules load', () => {
  const text =
    'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/b/manage/[token]/page"] = ' +
    JSON.stringify({
      clientModules: {
        a: { chunks: ['/_next/static/chunks/x.js', '/_next/static/chunks/y.js'] },
        b: { chunks: ['/_next/static/chunks/x.js'] },
      },
      entryJSFiles: { '[project]/page': ['static/chunks/z.js'] },
    }) +
    ';\n';
  const r = chunksFromClientManifest(text);
  assert.equal(r.route, '/b/manage/[token]');
  assert.deepEqual(r.chunks.sort(), [
    'static/chunks/x.js',
    'static/chunks/y.js',
    'static/chunks/z.js',
  ]);
});
test('text that is not a client-reference manifest gives null', () =>
  assert.equal(chunksFromClientManifest('console.log(1)'), null));
