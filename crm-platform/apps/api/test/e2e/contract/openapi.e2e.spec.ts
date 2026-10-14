import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { startHarness, type Harness } from '../contacts-attributes-tags/support';
import { negativeRoutes } from '../negative/routes';
import { buildOpenApiDocument } from '../../../src/common/openapi';
import { ApiV1DocsService } from '../../../src/modules/developer-rest-api-v1/docs/api-v1-docs.service';
import { API_V1_TAGS } from '../../../src/modules/developer-rest-api-v1/docs/api-v1-tags';

/**
 * API contract: the documents (QA task 8).
 *
 *  1. Route registry. Every route the app serves is either in the internal OpenAPI document or on a reasoned list of
 *     routes that are not documented yet (`undocumented-routes.json`). A NEW undocumented route fails; a route that
 *     gets documented must come off the list, so the list only shrinks.
 *  2. The customer API document (`/api/v1`, served at /docs/api.json) is well formed, and does not break its callers
 *     compared with the committed baseline (`docs/quality/contract/api-v1.openapi.json`).
 *
 * Refresh the files on purpose with `QA_UPDATE=1`. The first run on a fresh checkout creates both files and says so.
 * `QA_OUT=<dir>` also writes the two documents there, for the diff tool and for review.
 */
const ROOT = resolve(__dirname, '../../../../..');
const UNDOCUMENTED = resolve(__dirname, 'undocumented-routes.json');
const BASELINE = resolve(ROOT, 'docs/quality/contract/api-v1.openapi.json');

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

/** `/v2/tags/:id` as the OpenAPI document writes it: `/v2/tags/{id}`. */
const openApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');

const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

describe('route registry: every served route is documented or listed', () => {
  it('has no new undocumented route, and the list only shrinks', async () => {
    const doc = buildOpenApiDocument(h.app) as OpenAPIObject;
    if (process.env.QA_OUT) writeJson(resolve(process.env.QA_OUT, 'internal.openapi.json'), doc);
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([path, item]) =>
        Object.keys(item)
          .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
          .map((m) => `${m.toUpperCase()} ${path}`),
      ),
    );
    const served = (await negativeRoutes(h.app)).map((r) => `${r.method} ${openApiPath(r.path)}`);
    const unique = [...new Set(served)].sort();
    const missing = unique.filter((r) => !documented.has(r));
    console.log(
      `CONTRACT served=${unique.length} documented=${documented.size} undocumented=${missing.length}`,
    );
    if (process.env.QA_UPDATE || !existsSync(UNDOCUMENTED)) {
      writeJson(UNDOCUMENTED, missing);
      console.log(`CONTRACT wrote ${UNDOCUMENTED} (${missing.length} routes); commit it`);
      return;
    }
    const known = new Set(JSON.parse(readFileSync(UNDOCUMENTED, 'utf8')) as string[]);
    const added = missing.filter((r) => !known.has(r));
    const nowDocumented = [...known].filter((r) => !missing.includes(r));
    expect(
      added,
      'new routes with no OpenAPI entry: tag the controller, or list it on purpose',
    ).toEqual([]);
    expect(
      nowDocumented,
      'these routes are documented now: take them off undocumented-routes.json',
    ).toEqual([]);
  });
});

describe('customer API document (/api/v1)', () => {
  let doc: OpenAPIObject;
  beforeAll(async () => {
    const docs = h.app.get(ApiV1DocsService);
    docs.attach(h.app);
    doc = await docs.spec();
    if (process.env.QA_OUT) writeJson(resolve(process.env.QA_OUT, 'api-v1.openapi.json'), doc);
  });

  it('only describes /api/v1 resources, each with a summary, a tag from the published list and a success response', () => {
    const tags = new Set(API_V1_TAGS.map((t) => t.name));
    const problems: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!path.startsWith('/api/v1/')) problems.push(`${path}: not under /api/v1`);
      for (const [method, op] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const o = op as { summary?: string; tags?: string[]; responses?: Record<string, unknown> };
        const where = `${method.toUpperCase()} ${path}`;
        if (!o.summary) problems.push(`${where}: no summary`);
        if (!o.tags?.length || o.tags.some((t) => !tags.has(t)))
          problems.push(`${where}: tag missing or not published`);
        if (!Object.keys(o.responses ?? {}).some((c) => /^2/.test(c)))
          problems.push(`${where}: no 2xx response`);
      }
    }
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
    expect(problems.slice(0, 40)).toEqual([]);
  });

  it('does not break the callers of the committed baseline', async () => {
    if (process.env.QA_UPDATE || !existsSync(BASELINE)) {
      writeJson(BASELINE, doc);
      console.log(`CONTRACT wrote ${BASELINE}; commit it`);
      return;
    }
    // The differ is plain JavaScript; load it by path so the type checker does not need a declaration for it.
    const differ = (await import(
      /* @vite-ignore */ resolve(ROOT, 'tools/quality/openapi-diff.mjs')
    )) as {
      diffDocuments: (
        b: unknown,
        h: unknown,
        o?: { prefix?: string },
      ) => Array<{ severity: string; where: string; message: string }>;
    };
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const breaking = differ
      .diffDocuments(base, JSON.parse(JSON.stringify(doc)), { prefix: '/api/v1' })
      .filter((d) => d.severity === 'breaking')
      .map((d) => `${d.where}: ${d.message}`);
    expect(
      breaking,
      'breaking change to the customer API; version it or refresh the baseline with QA_UPDATE=1 on purpose',
    ).toEqual([]);
  });
});
