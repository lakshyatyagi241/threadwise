import request from 'supertest';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  marketAppDetailSchema,
  marketAppListSchema,
  marketCategoryListSchema,
  marketOperatorAppDetailSchema,
  marketOperatorAppListSchema,
  marketOperatorCategoryListSchema,
  marketRequestListSchema,
  marketShelvesSchema,
  marketUsageSchema,
  validateMarketManifest,
} from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  Api,
  bearer,
  code,
  LeadPipelineStub,
  marketApi,
  miniManifest,
  operatorLogin,
  platformApi,
  publishListing,
  publishVersion,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';
import { OPERATOR_EMAIL } from '../auth-registration-security/harness';

/**
 * The Marketplace catalogue end to end through HTTP: what the seed shows a workspace (one real listing, the planned portals invisible),
 * the operator API (permissions, manifest and recipe validation, the draft -> review -> approve -> publish flow, hide, categories), browse
 * and search with keyset paging over every sort, the plan and module locks, the workspace permissions of the three market keys, request
 * voting with its dedupe, and tenant isolation at the database. The real API, a real Postgres with row-level security, a real Redis.
 */
let h: Harness;
let api: Api;
let superToken = '';
let reviewerToken = '';
let supportToken = '';
let A: Tenant;
let B: Tenant;
let stub: LeadPipelineStub;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tokens = () => ({ manage: superToken, review: reviewerToken });
const ops = () => platformApi(h, superToken);
const mp = (t: Tenant | string) => marketApi(h, typeof t === 'string' ? t : t.admin);

const MINI = [
  { id: 'quote-panel', name: 'Quote panel', category: 'sales-tools' },
  { id: 'emi-calculator', name: 'EMI calculator', category: 'utilities' },
  { id: 'birthday-greeter', name: 'Birthday greeter', category: 'automation' },
  { id: 'lead-scorer', name: 'Lead scorer', category: 'sales-tools' },
  { id: 'site-visit-planner', name: 'Site visit planner', category: 'booking-and-payments' },
];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  stub = new LeadPipelineStub().install(h);
  superToken = await superOperator(h);
  supportToken = await operatorLogin(h, 'support@platform.test');

  // An operator who may only REVIEW: a custom role with the review key and nothing else.
  const role = await request(h.app.getHttpServer())
    .post('/v2/platform/roles')
    .set(bearer(superToken))
    .send({ name: 'Market reviewer', permissions: ['platform.market.review'] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'reviewer@platform.test', 'Reviewer', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  const staff = await request(h.app.getHttpServer())
    .get('/v2/platform/staff')
    .set(bearer(superToken));
  const rv = (staff.body.data as Array<{ id: string; email: string }>).find(
    (s) => s.email === 'reviewer@platform.test',
  )!;
  const set = await request(h.app.getHttpServer())
    .put(`/v2/platform/staff/${rv.id}/roles`)
    .set(bearer(superToken))
    .send({ roleIds: [role.body.id] });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  reviewerToken = await operatorLogin(h, 'reviewer@platform.test');

  A = await api.signup('mktA');
  B = await api.signup('mktB');
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the seeded catalogue', () => {
  it('shows a workspace every category of both tabs, with one published integration and nothing else', async () => {
    const mini = await mp(A).get('/categories?kind=mini_app');
    expect(mini.status, JSON.stringify(mini.body)).toBe(200);
    const miniList = marketCategoryListSchema.parse(mini.body);
    expect(miniList.data.map((c) => c.slug)).toEqual([
      'sales-tools',
      'contacts-and-data',
      'inbox-and-chat',
      'automation',
      'reporting',
      'booking-and-payments',
      'industry-packs',
      'utilities',
    ]);
    expect(miniList.data.every((c) => c.appCount === 0)).toBe(true);

    const integ = marketCategoryListSchema.parse(
      (await mp(A).get('/categories?kind=integration')).body,
    );
    expect(integ.data).toHaveLength(13);
    expect(integ.data.find((c) => c.slug === 'lead-sources')?.appCount).toBe(1);
    expect(integ.data.find((c) => c.slug === 'automation')?.name).toContain('Zapier');
    expect(integ.data.filter((c) => c.appCount > 0)).toHaveLength(1);

    const apps = marketAppListSchema.parse((await mp(A).get('/apps?kind=integration')).body);
    expect(apps.data.map((a) => a.slug)).toEqual(['webhook']);
    expect(apps.data[0]).toMatchObject({
      kind: 'integration',
      connectorType: 'webhook_relay',
      firstParty: true,
      featured: true,
      version: '1.0.0',
      pricing: { model: 'free' },
      install: null,
      locked: null,
      category: { slug: 'lead-sources' },
    });
    expect(apps.data[0]!.id).toMatch(uuidRe);
  });

  it('the planned portals exist only as drafts: not in browse, search or a direct read, and none of them can be published', async () => {
    for (const slug of [
      'indiamart',
      'justdial',
      'acres99',
      'magicbricks',
      'housing-com',
      'shiksha',
    ]) {
      const direct = await mp(A).get(`/apps/${slug}`);
      expect(direct.status, slug).toBe(404);
      expect(code(direct)).toBe('MKT_APP_NOT_FOUND');
    }
    const search = marketAppListSchema.parse((await mp(A).get('/apps?q=india')).body);
    expect(search.data).toEqual([]);

    const drafts = marketOperatorAppListSchema.parse((await ops().get('/apps?status=draft')).body);
    expect(drafts.data.map((a) => a.slug).sort()).toEqual([
      'acres99',
      'housing-com',
      'indiamart',
      'justdial',
      'magicbricks',
      'shiksha',
    ]);
    for (const d of drafts.data) {
      const detail = marketOperatorAppDetailSchema.parse((await ops().get(`/apps/${d.slug}`)).body);
      expect(validateMarketManifest(detail.manifest).ok, d.slug).toBe(true);
      expect(detail.versions[0]).toMatchObject({ version: '0.1.0', status: 'draft' });
    }
    // Approving one and trying to publish it: no recipe yet, and its connector type is not built.
    const pm = platformApi(h, reviewerToken);
    const d = marketOperatorAppDetailSchema.parse((await ops().get('/apps/indiamart')).body);
    expect((await pm.post(`/apps/indiamart/versions/${d.versionId}/approve`, {})).status).toBe(200);
    const publish = await pm.post('/apps/indiamart/publish', {});
    expect(publish.status).toBe(422);
    expect(code(publish)).toBe('MKT_RECIPE_INVALID');
  });

  it("an app's page carries what the admin needs and nothing internal: permissions in words, setup fields, changelog; never endpoints, mapping or test payloads", async () => {
    const res = await mp(A).get('/apps/webhook');
    expect(res.status).toBe(200);
    const d = marketAppDetailSchema.parse(res.body);
    expect(d.scopes).toEqual([
      { id: 'leads.write', label: 'Add leads', description: expect.any(String), risk: 'medium' },
    ]);
    expect(d.setup).toMatchObject({
      connectorType: 'webhook_relay',
      authFields: [],
      hasTestPayload: true,
    });
    expect(d.setup!.setupInstructions).toHaveLength(3);
    expect(d.changelog).toEqual([
      { version: '1.0.0', notes: 'First version.', publishedAt: expect.any(String) },
    ]);
    expect(d.listing.dataProcessing.summary).toContain('lead pipeline');
    expect(d.surfaces).toEqual([{ type: 'webhook_in', key: 'leads', label: 'Incoming leads' }]);
    const text = JSON.stringify(res.body);
    for (const internal of [
      'testPayloads',
      'asha@example.com',
      'mapping',
      'rateLimits',
      'credentials_enc',
      'recipe',
    ]) {
      expect(text, internal).not.toContain(internal);
    }
    expect((await mp(A).get(`/apps/${d.id}`)).body.slug).toBe('webhook');
    expect((await mp(A).get('/apps/Not_A_Slug')).status).toBe(422);
  });
});

describe('operator permissions', () => {
  it('support (no market key) is refused everywhere; the reviewer may read and decide but not create or operate', async () => {
    const asSupport = platformApi(h, supportToken);
    for (const res of [
      await asSupport.get('/apps'),
      await asSupport.get('/categories'),
      await asSupport.get('/usage'),
      await asSupport.get('/requests'),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('RBAC_PLATFORM_PERMISSION_REQUIRED');
    }
    const reviewer = platformApi(h, reviewerToken);
    expect((await reviewer.get('/apps')).status).toBe(200);
    expect((await reviewer.get('/usage')).status).toBe(200);
    const create = await reviewer.post('/apps', {
      manifest: miniManifest(),
      tagline: 'x'.repeat(10),
    });
    expect(create.status).toBe(403);
    expect(create.body.errors?.[0]?.message ?? create.body.detail).toContain(
      'platform.market.manage',
    );
    expect((await reviewer.post('/apps/webhook/hide', {})).status).toBe(403);
    expect((await reviewer.post('/apps/webhook/kill', { reason: 'testing 123' })).status).toBe(403);
    expect(
      (await reviewer.post('/categories', { kind: 'mini_app', slug: 'x-cat', name: 'X' })).status,
    ).toBe(403);
    expect((await request(h.app.getHttpServer()).get('/v2/platform/marketplace/apps')).status).toBe(
      401,
    );
  });

  it('the two keys are platform system permissions held by Super Admin', async () => {
    const held = await h.owner.query(
      `SELECT p.name::text AS name FROM platform_role_permissions rp
         JOIN platform_permissions p ON p.id = rp.permission_id JOIN platform_roles r ON r.id = rp.role_id
        WHERE r.name = 'Super Admin' AND p.name::text LIKE 'platform.market.%' ORDER BY p.name::text`,
    );
    expect(held.rows.map((r) => r.name)).toEqual([
      'platform.market.manage',
      'platform.market.review',
    ]);
    const rows = await h.owner.query(
      `SELECT name::text AS name, is_system FROM platform_permissions WHERE name::text LIKE 'platform.market.%' ORDER BY name`,
    );
    expect(rows.rows).toEqual([
      { name: 'platform.market.manage', is_system: true },
      { name: 'platform.market.review', is_system: true },
    ]);
  });
});

describe('operator validation', () => {
  it('a manifest that does not follow v1 is refused with every problem and its path', async () => {
    const res = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: miniManifest({
        scopes: ['contacts.read', 'root.everything'],
        version: '1.0',
        postInstall: 'x',
      }),
    });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('MKT_MANIFEST_INVALID');
    const paths = (res.body.errors as Array<{ path: string }>).map((d) => d.path);
    expect(paths).toContain('manifest.version');
    expect(paths).toContain('manifest.scopes.1');
  });

  it('the slug is unique, the category must exist for the kind, a mini app has no recipe, a recipe must agree with its manifest', async () => {
    const dup = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: miniManifest({ id: 'webhook' }),
    });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('MKT_SLUG_TAKEN');

    const noCategory = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: miniManifest({ id: 'x-app', category: 'lead-sources' }),
    });
    expect(noCategory.status).toBe(422);
    expect(code(noCategory)).toBe('MKT_CATEGORY_NOT_FOUND');

    const recipeOnMini = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: miniManifest({ id: 'x-app' }),
      recipe: { schemaVersion: 1 },
    });
    expect(code(recipeOnMini)).toBe('MKT_RECIPE_INVALID');

    const manifest = {
      manifestVersion: 1,
      id: 'x-int',
      name: 'X Int',
      kind: 'integration',
      category: 'lead-sources',
      version: '1.0.0',
      description: 'Receive leads from the X portal.',
      scopes: ['leads.write'],
      connector: { type: 'webhook_relay' },
    };
    const relay = {
      schemaVersion: 1,
      key: 'x-int',
      name: 'X Int',
      category: 'lead-sources',
      connector: { type: 'webhook_relay' },
      mapping: { mode: 'auto' },
    };
    const wrongKey = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest,
      recipe: { ...relay, key: 'other' },
    });
    expect(code(wrongKey)).toBe('MKT_RECIPE_INVALID');
    expect((wrongKey.body.errors as Array<{ path: string }>)[0]!.path).toBe('recipe.key');
    const wrongType = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest,
      recipe: {
        ...relay,
        connector: { type: 'push', auth: { scheme: 'hmac_sha256', header: 'X-Sig' } },
      },
    });
    expect(code(wrongType)).toBe('MKT_RECIPE_INVALID');
    expect((wrongType.body.errors as Array<{ path: string }>)[0]!.path).toBe(
      'recipe.connector.type',
    );
    // An address that is not a public https host name is refused when the recipe is saved.
    const pull = {
      schemaVersion: 1,
      key: 'x-int',
      name: 'X Int',
      category: 'lead-sources',
      connector: {
        type: 'pull',
        request: { baseUrl: 'https://169.254.169.254', path: '/latest' },
        response: {},
        pollIntervalSeconds: 300,
      },
      mapping: { mode: 'explicit', fields: [{ to: 'name', from: 'n' }] },
    };
    const metadata = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: { ...manifest, connector: { type: 'pull' } },
      recipe: pull,
    });
    expect(code(metadata)).toBe('MKT_RECIPE_INVALID');
    expect(JSON.stringify(metadata.body)).toContain('public host name');
    // Nothing was stored by any of the above.
    expect((await ops().get('/apps/x-int')).status).toBe(404);
    expect((await ops().get('/apps/x-app')).status).toBe(404);
  });

  it('a first-party module link belongs to a first-party app only', async () => {
    const res = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: miniManifest({ id: 'linked', module: 'quotes' }),
      firstParty: false,
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.errors)).toContain('manifest.module');
  });

  it('a listing whose connector type is only a framework can be created and approved, never published', async () => {
    const manifest = {
      manifestVersion: 1,
      id: 'pull-test',
      name: 'Pull Test',
      kind: 'integration',
      category: 'lead-sources',
      version: '1.0.0',
      description: 'A portal polled on a schedule, for the test.',
      scopes: ['leads.write'],
      connector: { type: 'pull' },
    };
    const recipe = {
      schemaVersion: 1,
      key: 'pull-test',
      name: 'Pull Test',
      category: 'lead-sources',
      connector: {
        type: 'pull',
        request: { baseUrl: 'https://api.portal-example.com', path: '/v1/enquiries' },
        response: { itemsPath: 'items' },
        pollIntervalSeconds: 300,
      },
      mapping: { mode: 'explicit', fields: [{ to: 'name', from: 'name', required: true }] },
    };
    const created = await ops().post('/apps', { tagline: 'A short line.', manifest, recipe });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ok = await platformApi(h, reviewerToken).post(
      `/apps/pull-test/versions/${created.body.versionId}/approve`,
      {},
    );
    expect(ok.status).toBe(200);
    const publish = await platformApi(h, reviewerToken).post('/apps/pull-test/publish', {});
    expect(publish.status).toBe(409);
    expect(code(publish)).toBe('MKT_CONNECTOR_NOT_AVAILABLE');
    expect((await mp(A).get('/apps/pull-test')).status).toBe(404);
  });
});

describe('the review and publish flow', () => {
  it('draft -> submit -> approve -> publish, with the states each step allows and the reasons a rejection carries', async () => {
    const created = await ops().post('/apps', {
      tagline: 'Builds a quote from your catalogue.',
      manifest: miniManifest(),
      firstParty: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(marketOperatorAppDetailSchema.parse(created.body)).toMatchObject({
      status: 'draft',
      publishedVersion: null,
      versionStatus: 'draft',
    });
    const vid = created.body.versionId as string;
    expect((await mp(A).get('/apps/quote-panel')).status).toBe(404);

    // Publishing a draft is not possible; submitting moves the listing to in review.
    expect(code(await platformApi(h, reviewerToken).post('/apps/quote-panel/publish', {}))).toBe(
      'MKT_VERSION_STATE',
    );
    const submitted = await ops().post(`/apps/quote-panel/versions/${vid}/submit`, {});
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ status: 'in_review', versionStatus: 'in_review' });

    const review = platformApi(h, reviewerToken);
    const noNote = await review.post(`/apps/quote-panel/versions/${vid}/reject`, { note: 'no' });
    expect(noNote.status).toBe(422);
    const rejected = await review.post(`/apps/quote-panel/versions/${vid}/reject`, {
      note: 'The scopes are not justified.',
    });
    expect(rejected.body).toMatchObject({ status: 'draft', versionStatus: 'rejected' });
    expect(rejected.body.versions[0].reviewNote).toBe('The scopes are not justified.');
    // A rejected version is edited, resubmitted, approved and published.
    const edit = await ops().put(`/apps/quote-panel/versions/${vid}`, {
      manifest: miniManifest({ scopes: ['contacts.read'] }),
      changelog: 'Fewer scopes.',
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.versionStatus).toBe('draft');
    expect((await ops().post(`/apps/quote-panel/versions/${vid}/submit`, {})).status).toBe(200);
    expect(
      (await review.post(`/apps/quote-panel/versions/${vid}/approve`, { note: 'Good.' })).body
        .versionStatus,
    ).toBe('approved');
    // An approved version can no longer be edited.
    const frozen = await ops().put(`/apps/quote-panel/versions/${vid}`, {
      manifest: miniManifest(),
      changelog: 'x',
    });
    expect(frozen.status).toBe(409);
    expect(code(frozen)).toBe('MKT_VERSION_STATE');

    const published = await review.post('/apps/quote-panel/publish', {});
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body).toMatchObject({
      app: { status: 'published', publishedVersion: '1.0.0' },
      upgraded: 0,
      awaitingConsent: 0,
    });
    const page = marketAppDetailSchema.parse((await mp(A).get('/apps/quote-panel')).body);
    expect(page).toMatchObject({
      name: 'Quote panel',
      version: '1.0.0',
      firstParty: true,
      scopes: [{ id: 'contacts.read' }],
      setup: null,
    });
  });

  it('a new version has a higher number than any before, and only a draft listing can be deleted', async () => {
    const same = await ops().post('/apps/quote-panel/versions', {
      manifest: miniManifest(),
      changelog: 'Again.',
    });
    expect(code(same)).toBe('MKT_VERSION_EXISTS');
    const lower = await ops().post('/apps/quote-panel/versions', {
      manifest: miniManifest({ version: '0.9.0' }),
      changelog: 'Older.',
    });
    expect(code(lower)).toBe('MKT_VERSION_EXISTS');
    const otherId = await ops().post('/apps/quote-panel/versions', {
      manifest: miniManifest({ id: 'renamed', version: '2.0.0' }),
      changelog: 'Renamed.',
    });
    expect(code(otherId)).toBe('MKT_MANIFEST_INVALID');
    expect(code(await ops().delete('/apps/quote-panel'))).toBe('MKT_VERSION_STATE');
    const draft = await ops().post('/apps', {
      tagline: 'A short line.',
      manifest: miniManifest({ id: 'scratch', name: 'Scratch' }),
    });
    expect(draft.status).toBe(201);
    expect((await ops().delete('/apps/scratch')).status).toBe(204);
    expect((await ops().get('/apps/scratch')).status).toBe(404);
  });

  it('editing the listing needs the row version, and hide and unhide take the app out of browse and back', async () => {
    const detail = marketOperatorAppDetailSchema.parse((await ops().get('/apps/quote-panel')).body);
    const stale = await ops().patch('/apps/quote-panel', {
      rowVersion: detail.rowVersion + 5,
      tagline: 'Stale tagline here.',
    });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    const ok = await ops().patch('/apps/quote-panel', {
      rowVersion: detail.rowVersion,
      tagline: 'Quote any deal in a click.',
      featured: true,
      listing: { highlights: ['Fast'], logo: 'https://example.com/logo.png' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ tagline: 'Quote any deal in a click.', featured: true });
    const card = marketAppListSchema.parse((await mp(A).get('/apps?q=quote')).body).data[0]!;
    expect(card).toMatchObject({
      slug: 'quote-panel',
      logo: 'https://example.com/logo.png',
      featured: true,
    });

    expect((await ops().post('/apps/quote-panel/hide', {})).body.status).toBe('hidden');
    expect(marketAppListSchema.parse((await mp(A).get('/apps?q=quote')).body).data).toEqual([]);
    expect((await mp(A).get('/apps/quote-panel')).status).toBe(404);
    expect(code(await ops().post('/apps/quote-panel/hide', {}))).toBe('MKT_VERSION_STATE');
    expect((await ops().post('/apps/quote-panel/unhide', {})).body.status).toBe('published');
    expect((await mp(A).get('/apps/quote-panel')).status).toBe(200);
  });

  it('categories: add, edit with the row version, deactivate hides it from a workspace, delete only when empty', async () => {
    const created = await ops().post('/categories', {
      kind: 'mini_app',
      slug: 'finance-extras',
      name: 'Finance extras',
      sortOrder: 5,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(
      code(
        await ops().post('/categories', {
          kind: 'mini_app',
          slug: 'finance-extras',
          name: 'Again',
        }),
      ),
    ).toBe('MKT_SLUG_TAKEN');
    const list = marketOperatorCategoryListSchema.parse((await ops().get('/categories')).body);
    expect(list.data.filter((c) => c.kind === 'mini_app')[0]!.slug).toBe('finance-extras');
    const edit = await ops().patch(`/categories/${created.body.id}`, {
      rowVersion: created.body.rowVersion,
      name: 'Finance add-ons',
      isActive: false,
    });
    expect(edit.body).toMatchObject({ name: 'Finance add-ons', isActive: false });
    expect(
      code(
        await ops().patch(`/categories/${created.body.id}`, {
          rowVersion: created.body.rowVersion,
          name: 'Xy',
        }),
      ),
    ).toBe('ROW_VERSION_CONFLICT');
    const seen = marketCategoryListSchema.parse(
      (await mp(A).get('/categories?kind=mini_app')).body,
    );
    expect(seen.data.map((c) => c.slug)).not.toContain('finance-extras');
    expect((await ops().delete(`/categories/${created.body.id}`)).status).toBe(204);
    const salesTools = list.data.find((c) => c.slug === 'sales-tools')!;
    const inUse = await ops().delete(`/categories/${salesTools.id}`);
    expect(code(inUse)).toBe('MKT_CATEGORY_IN_USE');
  });
});

describe('browse and search', () => {
  it('publishes five mini apps, then pages every sort without a gap or a repeat', async () => {
    for (const m of MINI.slice(1)) {
      await publishListing(h, tokens(), {
        manifest: miniManifest({ id: m.id, name: m.name, category: m.category, scopes: [] }),
        featured: m.id === 'emi-calculator',
      });
    }
    for (const sort of ['featured', 'popular', 'new', 'name']) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await mp(A).get(
          `/apps?kind=mini_app&sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(res.status, `${sort} ${JSON.stringify(res.body)}`).toBe(200);
        const page = marketAppListSchema.parse(res.body);
        seen.push(...page.data.map((a) => a.slug));
        cursor = page.page.nextCursor ?? undefined;
        pages += 1;
        expect(page.page.hasMore).toBe(cursor !== undefined);
      } while (cursor && pages < 10);
      expect(pages, sort).toBe(3);
      expect([...seen].sort(), sort).toEqual(MINI.map((m) => m.id).sort());
      expect(new Set(seen).size).toBe(5);
    }
    const byName = marketAppListSchema.parse(
      (await mp(A).get('/apps?kind=mini_app&sort=name')).body,
    );
    expect(byName.data.map((a) => a.name)).toEqual([
      'Birthday greeter',
      'EMI calculator',
      'Lead scorer',
      'Quote panel',
      'Site visit planner',
    ]);
    // The featured sort leads with featured apps.
    const featured = marketAppListSchema.parse(
      (await mp(A).get('/apps?kind=mini_app&sort=featured')).body,
    );
    expect(
      featured.data
        .slice(0, 2)
        .map((a) => a.slug)
        .sort(),
    ).toEqual(['emi-calculator', 'quote-panel']);
  });

  it('filters by category and by a search that treats % and _ literally; a malformed cursor is a 422', async () => {
    const sales = marketAppListSchema.parse(
      (await mp(A).get('/apps?kind=mini_app&category=sales-tools')).body,
    );
    expect(sales.data.map((a) => a.slug).sort()).toEqual(['lead-scorer', 'quote-panel']);
    const q = marketAppListSchema.parse((await mp(A).get('/apps?q=SCORER')).body);
    expect(q.data.map((a) => a.slug)).toEqual(['lead-scorer']);
    expect(marketAppListSchema.parse((await mp(A).get('/apps?q=%25')).body).data).toEqual([]);
    expect(marketAppListSchema.parse((await mp(A).get('/apps?q=_____')).body).data).toEqual([]);
    expect((await mp(A).get('/apps?cursor=garbage')).status).toBe(422);
    expect((await mp(A).get('/apps?limit=1000')).status).toBe(422);
    expect((await mp(A).get('/apps?kind=mystery')).status).toBe(422);
  });

  it('shelves of a tab: popular, new and featured', async () => {
    const shelves = marketShelvesSchema.parse((await mp(A).get('/shelves?kind=mini_app')).body);
    expect(shelves.new.map((a) => a.slug)).toHaveLength(5);
    expect(shelves.featured.map((a) => a.slug).sort()).toEqual(['emi-calculator', 'quote-panel']);
    expect(shelves.popular).toHaveLength(5);
    expect(
      marketShelvesSchema
        .parse((await mp(A).get('/shelves?kind=integration')).body)
        .new.map((a) => a.slug),
    ).toEqual(['webhook']);
    expect((await mp(A).get('/shelves')).status).toBe(422);
  });
});

describe('locks: plan feature, billing add-on, module', () => {
  it('an app behind a plan feature shows locked and cannot be installed; an add-on or an override that grants the feature unlocks it', async () => {
    await publishListing(h, tokens(), {
      manifest: miniManifest({
        id: 'pro-report',
        name: 'Pro report',
        category: 'reporting',
        scopes: ['analytics.read'],
      }),
      planFeature: 'analytics',
    });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"analytics":false}}' WHERE org_id = $1`,
      [A.orgId],
    );
    const card = marketAppListSchema.parse((await mp(A).get('/apps?q=pro')).body).data[0]!;
    expect(card.locked).toEqual({
      reason: 'plan_feature',
      key: 'analytics',
      upgradeUrl: '/account/plans',
    });
    const install = await mp(A).post('/apps/pro-report/install', {
      acceptedScopes: ['analytics.read'],
    });
    expect(install.status).toBe(422);
    expect(code(install)).toBe('MKT_APP_LOCKED');
    expect(install.body.errors).toEqual(
      expect.arrayContaining([{ path: 'reason', message: 'plan_feature' }]),
    );
    expect(
      marketAppDetailSchema.parse((await mp(A).get('/apps/pro-report')).body).locked?.reason,
    ).toBe('plan_feature');

    // A workspace whose plan grants the feature is not locked.
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"analytics":true}}' WHERE org_id = $1`,
      [B.orgId],
    );
    expect(
      marketAppListSchema.parse((await mp(B).get('/apps?q=pro')).body).data[0]!.locked,
    ).toBeNull();
    // The operator can open an app to every plan.
    const detail = marketOperatorAppDetailSchema.parse((await ops().get('/apps/pro-report')).body);
    expect(
      (await ops().patch('/apps/pro-report', { rowVersion: detail.rowVersion, planFeature: null }))
        .status,
    ).toBe(200);
    expect(
      marketAppListSchema.parse((await mp(A).get('/apps?q=pro')).body).data[0]!.locked,
    ).toBeNull();
  });

  it('a first-party mini app backed by a module is locked while the module is not installed', async () => {
    await publishListing(h, tokens(), {
      manifest: miniManifest({
        id: 'quotes-engine',
        name: 'Quotes engine',
        category: 'sales-tools',
        scopes: [],
        module: 'quotes-engine',
      }),
      firstParty: true,
    });
    const card = marketAppListSchema.parse((await mp(A).get('/apps?q=quotes')).body).data[0]!;
    expect(card.locked).toEqual({
      reason: 'module_disabled',
      key: 'quotes-engine',
      upgradeUrl: null,
    });
    const install = await mp(A).post('/apps/quotes-engine/install', { acceptedScopes: [] });
    expect(code(install)).toBe('MKT_APP_LOCKED');
  });

  it('the plan feature `marketplace` gates every workspace route (reads included), and the cap `installed_apps` limits what is installed', async () => {
    const L = await api.signup('mktL');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"marketplace":false}}' WHERE org_id = $1`,
      [L.orgId],
    );
    for (const res of [
      await mp(L).get('/apps'),
      await mp(L).get('/categories'),
      await mp(L).get('/installations'),
      await mp(L).get('/requests'),
    ]) {
      expect(res.status).toBe(422);
      expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([{ path: 'feature', message: 'marketplace' }]),
      );
    }
    // A workspace on the plan of a locked one is not locked by the same flag.
    expect((await mp(A).get('/apps')).status).toBe(200);

    const M = await api.signup('mktM');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"installed_apps":1}}' WHERE org_id = $1`,
      [M.orgId],
    );
    expect((await mp(M).post('/apps/emi-calculator/install', { acceptedScopes: [] })).status).toBe(
      201,
    );
    const second = await mp(M).post('/apps/birthday-greeter/install', { acceptedScopes: [] });
    expect(second.status).toBe(422);
    expect(code(second)).toBe('PLAN_LIMIT_REACHED');
    expect(second.body.errors).toEqual(
      expect.arrayContaining([{ path: 'limit', message: 'installed_apps' }]),
    );
    const card = marketAppListSchema.parse((await mp(M).get('/apps?kind=mini_app')).body);
    expect(card.data.find((a) => a.slug === 'birthday-greeter')!.locked?.reason).toBe(
      'limit_reached',
    );
    // The installed app is never locked (it can still be managed and removed); the list says how much of the cap is used.
    expect(card.data.find((a) => a.slug === 'emi-calculator')!.locked).toBeNull();
    const inst = await mp(M).get('/installations');
    expect(inst.body.usage).toEqual({ installed: 1, limit: 1 });
    const iid = inst.body.data[0].id as string;
    expect(
      (await mp(M).post(`/installations/${iid}/uninstall`, { dataChoice: 'keep' })).status,
    ).toBe(204);
    expect(
      (await mp(M).post('/apps/birthday-greeter/install', { acceptedScopes: [] })).status,
    ).toBe(201);
  });
});

describe('workspace permissions', () => {
  it('browsing needs market.apps.read, installing needs .install, configuring needs .manage; nothing without a key', async () => {
    const none = await api.member(A, 'nokeys', [['record.contacts.read']]);
    expect((await mp(none.token).get('/apps')).status).toBe(403);
    expect((await mp(none.token).get('/installations')).status).toBe(403);
    expect((await mp(none.token).post('/requests', { name: 'Tally' })).status).toBe(403);

    const reader = await api.member(A, 'reader', [['market.apps.read']]);
    expect((await mp(reader.token).get('/apps')).status).toBe(200);
    expect((await mp(reader.token).get('/categories')).status).toBe(200);
    expect((await mp(reader.token).get('/installations')).status).toBe(200);
    const denied = await mp(reader.token).post('/apps/emi-calculator/install', {
      acceptedScopes: [],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.detail).toContain('market.apps.install');
    const fakeId = '00000000-0000-4000-8000-000000000000';
    for (const res of [
      await mp(reader.token).patch(`/installations/${fakeId}`, { rowVersion: 1 }),
      await mp(reader.token).post(`/installations/${fakeId}/disable`, { rowVersion: 1 }),
      await mp(reader.token).post(`/installations/${fakeId}/test`),
      await mp(reader.token).post(`/installations/${fakeId}/uninstall`, { dataChoice: 'keep' }),
      await mp(reader.token).post(`/installations/${fakeId}/consent`, { acceptedScopes: [] }),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('installing is never a way to gain a capability: the installer must hold every permission the scopes stand for', async () => {
    const P = await api.signup('mktP');
    const weak = await api.member(P, 'weak', [
      ['market.apps.read'],
      ['market.apps.install'],
      ['record.contacts.read'],
    ]);
    // contacts.read is held; an app with no scopes needs nothing.
    const held = await mp(weak.token).post('/apps/quote-panel/install', {
      acceptedScopes: ['contacts.read'],
    });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    expect(
      (await mp(weak.token).post('/apps/lead-scorer/install', { acceptedScopes: [] })).status,
    ).toBe(201);

    // A webhook writes leads: it needs the contact create and update keys the member lacks.
    const webhook = await mp(weak.token).post('/apps/webhook/install', {
      acceptedScopes: ['leads.write'],
    });
    expect(webhook.status).toBe(403);
    expect(code(webhook)).toBe('MKT_SCOPE_EXCEEDS_INSTALLER');
    expect(webhook.body.errors.map((d: { message: string }) => d.message).sort()).toEqual([
      'record.contacts.create',
      'record.contacts.update',
    ]);
    expect(stub.ensured.filter((e) => e.orgId === P.orgId)).toEqual([]);
    const strong = await api.member(P, 'strong', [
      ['market.apps.read'],
      ['market.apps.install'],
      ['record.contacts.create'],
      ['record.contacts.update'],
    ]);
    expect(
      (await mp(strong.token).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] }))
        .status,
    ).toBe(201);
  });
});

describe('requests: ask, dedupe, vote', () => {
  let requestId = '';

  it('asking for something new creates it with one vote; the same name from another workspace (any case, spacing, punctuation) is a vote on it', async () => {
    const first = await mp(A).post('/requests', {
      name: 'Tally Prime',
      categorySlug: 'accounting-and-finance',
      note: 'We export invoices every week.',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      created: true,
      request: {
        name: 'Tally Prime',
        kind: 'integration',
        status: 'open',
        voteCount: 1,
        hasVoted: true,
        categorySlug: 'accounting-and-finance',
      },
    });
    requestId = first.body.request.id as string;

    const second = await mp(B).post('/requests', {
      name: '  tally-prime! ',
      note: 'Our accountant needs it.',
    });
    expect(second.body).toMatchObject({
      created: false,
      request: { id: requestId, name: 'Tally Prime', voteCount: 2, hasVoted: true },
    });

    // A workspace counts once, however often it asks or votes.
    const again = await mp(A).post('/requests', { name: 'TALLY PRIME' });
    expect(again.body).toMatchObject({ created: false, request: { voteCount: 2 } });
    expect((await mp(A).post(`/requests/${requestId}/vote`)).body.voteCount).toBe(2);
    expect((await mp(B).post(`/requests/${requestId}/vote`)).body.voteCount).toBe(2);
    // The same name of another kind is another request.
    const app = await mp(A).post('/requests', { name: 'Tally Prime', kind: 'mini_app' });
    expect(app.body).toMatchObject({ created: true, request: { kind: 'mini_app', voteCount: 1 } });
  });

  it('a third workspace votes, takes the vote back, and the list shows names and counts only', async () => {
    const C = await api.signup('mktC');
    expect((await mp(C).post(`/requests/${requestId}/vote`)).body).toMatchObject({
      voteCount: 3,
      hasVoted: true,
    });
    expect((await mp(C).delete(`/requests/${requestId}/vote`)).body).toMatchObject({
      voteCount: 2,
      hasVoted: false,
    });
    expect((await mp(C).delete(`/requests/${requestId}/vote`)).body).toMatchObject({
      voteCount: 2,
      hasVoted: false,
    });
    const list = await mp(C).get('/requests');
    expect(list.status).toBe(200);
    const parsed = marketRequestListSchema.parse(list.body);
    expect(parsed.data[0]).toMatchObject({
      name: 'Tally Prime',
      kind: 'integration',
      voteCount: 2,
      hasVoted: false,
    });
    const text = JSON.stringify(list.body);
    for (const leak of ['We export invoices', 'accountant', A.slug, B.slug, 'mktA', 'mktB', 'note'])
      expect(text, leak).not.toContain(leak);
    expect((await mp(C).post('/requests/00000000-0000-4000-8000-000000000001/vote')).status).toBe(
      404,
    );
    expect((await mp(C).post('/requests', { name: '!!' })).status).toBe(422);
  });

  it('the operator sees demand: votes, notes, the first workspace, a status they can triage', async () => {
    const res = await ops().get('/requests');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (res.body.data as Array<Record<string, unknown>>).find((r) => r.id === requestId)!;
    expect(row).toMatchObject({
      name: 'Tally Prime',
      voteCount: 2,
      status: 'open',
      firstWorkspace: { name: expect.stringContaining('mktA') },
    });
    expect((row.notes as string[]).sort()).toEqual([
      'Our accountant needs it.',
      'We export invoices every week.',
    ]);
    expect(res.body.data[0].voteCount).toBeGreaterThanOrEqual(res.body.data[1].voteCount);
    const stale = await ops().patch(`/requests/${requestId}`, {
      rowVersion: 99,
      status: 'planned',
    });
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    // A vote moved the count in the database, not the row version: the version the operator read is still current.
    const ok = await ops().patch(`/requests/${requestId}`, {
      rowVersion: row.rowVersion,
      status: 'planned',
      operatorNote: 'Next quarter.',
    });
    expect(ok.body).toMatchObject({
      status: 'planned',
      operatorNote: 'Next quarter.',
      voteCount: 2,
    });
    expect((await mp(A).get('/requests?status=planned')).body.data).toHaveLength(1);
    expect((await mp(A).get('/requests?q=nothing-like-it')).body.data).toHaveLength(0);
    // Paging by votes.
    const p1 = await mp(A).get('/requests?limit=1');
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await mp(A).get(
      `/requests?limit=1&cursor=${encodeURIComponent(p1.body.page.nextCursor)}`,
    );
    expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
  });
});

describe('tenant isolation at the database', () => {
  it('a workspace cannot read another one’s installations, drafts, or connections, and cannot write the catalogue or the requests of others', async () => {
    const db = h.app.get(DatabaseService);
    await mp(A).post('/apps/emi-calculator/install', { acceptedScopes: [] });
    const ownCount = await db.txAs({ orgId: A.orgId, userId: null }, async (tx) =>
      Number(
        (
          (await tx.execute(sql`SELECT count(*)::int AS n FROM workspace_app_installations`))
            .rows[0] as { n: number }
        ).n,
      ),
    );
    expect(ownCount).toBeGreaterThan(0);
    const asB = <T>(fn: (tx: Parameters<Parameters<typeof db.txAs>[1]>[0]) => Promise<T>) =>
      db.txAs({ orgId: B.orgId, userId: null }, fn);

    const seen = await asB(async (tx) => ({
      foreign: (
        await tx.execute(sql`SELECT id FROM workspace_app_installations WHERE org_id = ${A.orgId}`)
      ).rows.length,
      foreignConsents: (
        await tx.execute(sql`SELECT id FROM marketplace_consents WHERE org_id = ${A.orgId}`)
      ).rows.length,
      foreignConnections: (
        await tx.execute(sql`SELECT id FROM marketplace_connections WHERE org_id = ${A.orgId}`)
      ).rows.length,
      foreignVotes: (
        await tx.execute(sql`SELECT id FROM market_request_votes WHERE org_id = ${A.orgId}`)
      ).rows.length,
      drafts: (
        await tx.execute(
          sql`SELECT slug FROM marketplace_apps WHERE status IN ('draft', 'in_review')`,
        )
      ).rows.length,
      draftVersions: (
        await tx.execute(
          sql`SELECT id FROM marketplace_app_versions WHERE status IN ('draft', 'in_review', 'approved', 'rejected')`,
        )
      ).rows.length,
    }));
    expect(seen).toEqual({
      foreign: 0,
      foreignConsents: 0,
      foreignConnections: 0,
      foreignVotes: 0,
      drafts: 0,
      draftVersions: 0,
    });

    // Writing the catalogue is the operator's alone.
    const renamed = await asB(
      async (tx) =>
        (await tx.execute(sql`UPDATE marketplace_apps SET name = 'hacked' RETURNING id`)).rows
          .length,
    );
    expect(renamed).toBe(0);
    await expect(
      asB((tx) =>
        tx.execute(
          sql`INSERT INTO marketplace_apps (slug, kind, category_id, name) SELECT 'sneaky', 'mini_app', id, 'Sneaky' FROM marketplace_categories LIMIT 1`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asB((tx) => tx.execute(sql`DELETE FROM marketplace_categories`)),
    ).resolves.toBeDefined();
    const categories = await h.owner.query(`SELECT count(*)::int AS n FROM marketplace_categories`);
    expect(categories.rows[0].n).toBeGreaterThan(20);
    // Another workspace's row cannot be inserted or changed.
    await expect(
      asB((tx) =>
        tx.execute(
          sql`INSERT INTO market_request_votes (org_id, request_id) SELECT ${A.orgId}, id FROM market_requests LIMIT 1`,
        ),
      ),
    ).rejects.toThrow();
    const stolen = await asB(
      async (tx) =>
        (
          await tx.execute(
            sql`UPDATE workspace_app_installations SET status = 'disabled' WHERE org_id = ${A.orgId} RETURNING id`,
          )
        ).rows.length,
    );
    expect(stolen).toBe(0);
    // A request can be added as oneself but not changed by anyone but the operator.
    const status = await asB(
      async (tx) =>
        (await tx.execute(sql`UPDATE market_requests SET status = 'shipped' RETURNING id`)).rows
          .length,
    );
    expect(status).toBe(0);
    await expect(
      asB((tx) =>
        tx.execute(
          sql`INSERT INTO market_requests (name, name_key, created_by_org_id) VALUES ('Forged', 'forged', ${A.orgId})`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('through the API, workspace B cannot see or act on the installation of workspace A', async () => {
    const a = (await mp(A).get('/installations')).body.data[0] as {
      id: string;
      rowVersion: number;
    };
    expect(a).toBeDefined();
    for (const res of [
      await mp(B).get(`/installations/${a.id}`),
      await mp(B).get(`/installations/${a.id}/events`),
      await mp(B).patch(`/installations/${a.id}`, { rowVersion: a.rowVersion, config: {} }),
      await mp(B).post(`/installations/${a.id}/disable`, { rowVersion: a.rowVersion }),
      await mp(B).post(`/installations/${a.id}/test`),
      await mp(B).post(`/installations/${a.id}/uninstall`, { dataChoice: 'delete' }),
    ]) {
      expect(res.status).toBe(404);
      expect(code(res)).toBe('MKT_NOT_INSTALLED');
    }
    expect((await mp(A).get(`/installations/${a.id}`)).status).toBe(200);
  });
});

describe('usage and the operator report', () => {
  it('counts installations and health per app, and what has been installed shows in the card counts', async () => {
    const usage = marketUsageSchema.parse((await ops().get('/usage')).body);
    const emi = usage.data.find((u) => u.slug === 'emi-calculator')!;
    expect(emi.installs.total).toBeGreaterThanOrEqual(1);
    expect(emi.installs.active).toBe(emi.installs.total);
    expect(emi.health.unknown).toBe(emi.installs.total);
    expect(usage.data.find((u) => u.slug === 'webhook')).toMatchObject({
      status: 'published',
      kind: 'integration',
    });
    const apps = marketOperatorAppListSchema.parse(
      (await ops().get('/apps?kind=mini_app&limit=3')).body,
    );
    expect(apps.data).toHaveLength(3);
    expect(apps.page.hasMore).toBe(true);
    const next = marketOperatorAppListSchema.parse(
      (
        await ops().get(
          `/apps?kind=mini_app&limit=3&cursor=${encodeURIComponent(apps.page.nextCursor!)}`,
        )
      ).body,
    );
    expect(next.data.map((a) => a.slug).some((s) => apps.data.map((x) => x.slug).includes(s))).toBe(
      false,
    );
    const installed = marketAppListSchema.parse(
      (await mp(A).get('/apps?kind=mini_app&installed=true')).body,
    );
    expect(installed.data.map((a) => a.slug)).toContain('emi-calculator');
    expect(
      marketAppListSchema
        .parse((await mp(A).get('/apps?kind=mini_app&installed=false')).body)
        .data.map((a) => a.slug),
    ).not.toContain('emi-calculator');
    // publishVersion keeps its helper honest: a new version that asks for no more than was granted moves the installations that exist (one workspace has lead-scorer) at once.
    const out = await publishVersion(h, tokens(), 'lead-scorer', {
      manifest: miniManifest({
        id: 'lead-scorer',
        name: 'Lead scorer',
        category: 'sales-tools',
        version: '1.1.0',
        scopes: [],
      }),
    });
    expect(out).toMatchObject({
      upgraded: 1,
      awaitingConsent: 0,
      app: { publishedVersion: '1.1.0' },
    });
  });
});
