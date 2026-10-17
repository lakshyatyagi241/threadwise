import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  marketListingSchema,
  validateMarketManifest,
  validateMarketRecipe,
  PLAN_FEATURE_DEFS,
} from '@crm/contracts';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { Api, code, marketApi, platformApi, startHarness, superOperator } from './support';
import type { Harness, Tenant } from './support';

/**
 * The Marketplace listings audit (migrations 20261228090100_mkt_optional_tool_listings.sql and 20261228090200_mkt_info_and_planned_listings.sql;
 * the lead scoring app, migration ..090000, has its own spec). Real Postgres with forced row-level security, the real AppModule.
 *
 *   gated    six built optional tools, gated by install through the plan feature each already had (off by default): locked until the app is
 *            bought and installed, and a workspace whose PLAN grants the feature keeps it with no purchase and no install (nothing is lost);
 *   info     two built features that must NOT be gated: listed for discovery, changing nothing about who can use the feature;
 *   planned  ten features that are not built: drafts that cannot be published, invisible to every workspace.
 */
let h: Harness;
let api: Api;
let token = '';
let N: Tenant; // a new workspace on a plan that grants none of the features
let P: Tenant; // a workspace whose plan already grants every one of them

const GATED = [
  {
    slug: 'ai-crm-copilot',
    feature: 'ai_crm_copilot',
    kind: 'mini_app',
    category: 'sales-tools',
    route: '/v2/ai-crm',
  },
  {
    slug: 'chatbot-widget',
    feature: 'chatbot_widgets',
    kind: 'mini_app',
    category: 'inbox-and-chat',
    route: null,
  },
  {
    slug: 'help-assistant',
    feature: 'help_agent',
    kind: 'mini_app',
    category: 'utilities',
    route: '/v2/help-agent/settings',
  },
  {
    slug: 'whatsapp-catalog',
    feature: 'wa_storefront',
    kind: 'mini_app',
    category: 'booking-and-payments',
    route: '/v2/store/orders',
  },
  {
    slug: 'whatsapp-groups',
    feature: 'waba_groups',
    kind: 'mini_app',
    category: 'inbox-and-chat',
    route: null,
  },
  {
    slug: 'sms',
    feature: 'sms',
    kind: 'integration',
    category: 'messaging-and-email',
    route: '/v2/sms/senders',
  },
] as const;

const INFO = [
  { slug: 'whatsapp-devices', category: 'messaging-and-email' },
  { slug: 'meta-lead-forms', category: 'lead-sources' },
] as const;

const PLANNED = [
  ['lead-finder', 'lead-sources', 'BL-259'],
  ['ai-call-assistant', 'telephony', 'BL-260'],
  ['openai-ads', 'ads-and-social', 'BL-261'],
  ['meta-ads', 'ads-and-social', 'BL-262'],
  ['tiktok', 'ads-and-social', 'BL-263'],
  ['hubspot', 'marketing', 'BL-264'],
  ['slack', 'productivity', 'BL-265'],
  ['trello', 'productivity', 'BL-266'],
  ['linkedin-lead-gen', 'lead-sources', 'BL-267'],
  ['google-ads-leads', 'lead-sources', 'BL-268'],
] as const;

const MIGRATIONS = [
  '20261228090100_mkt_optional_tool_listings',
  '20261228090200_mkt_info_and_planned_listings',
].map((name) =>
  readFileSync(resolve(__dirname, `../../../../../packages/db/migrations/${name}.sql`), 'utf8'),
);

type Row = Record<string, unknown>;
const rows = async (query: string, params: unknown[] = []): Promise<Row[]> =>
  (await h.owner.query(query, params)).rows as Row[];
const one = async (query: string, params: unknown[] = []): Promise<Row> =>
  (await rows(query, params))[0]!;
const count = async (query: string, params: unknown[] = []) => Number((await one(query, params)).n);
const mp = (t: Tenant) => marketApi(h, t.admin);

/** The operator's "show this app on this plan" (the plan decides which paid apps a workspace on it can see), done directly with the privileged write the console performs. */
const showOn = async (planSlug: string, appSlug: string) => {
  await h.owner.query(
    `BEGIN;
     SELECT set_config('app.privileged', 'on', true);
     INSERT INTO plan_visible_addons (plan_id, addon_plan_id)
       SELECT p.id, ap.id FROM plans p, plans ap, marketplace_apps a
       WHERE p.slug = '${planSlug}' AND p.kind = 'plan' AND a.slug = '${appSlug}' AND ap.marketplace_app_id = a.id
       ON CONFLICT DO NOTHING;
     COMMIT;`,
  );
};
const ops = () => platformApi(h, token);
const featureOn = (t: Tenant, feature: string) =>
  h.app.get(PlanEntitlementService).featureEnabled(t.orgId, feature as never);

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  token = await superOperator(h);
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'USD', 1, true)`,
  );
  const granted = Object.fromEntries(GATED.map((g) => [g.feature, true]));
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free, features)
     VALUES ('granting', 'plan', 'Granting', 0, 'USD', 2, true, $1::jsonb)`,
    [JSON.stringify(granted)],
  );
  N = await api.signup('audN');
  P = await api.signup('audP');
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = $1`, [N.orgId]);
  await h.owner.query(`UPDATE organizations SET plan = 'granting' WHERE id = $1`, [P.orgId]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the seed', () => {
  it('migrations sort after the latest one that existed, in the order they depend on each other', async () => {
    const { readdirSync } = await import('node:fs');
    const all = readdirSync(resolve(__dirname, '../../../../../packages/db/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const mine = all.filter((f) => f.startsWith('20261228'));
    expect(mine).toEqual([
      '20261228090000_mkt_lead_scoring_app.sql',
      '20261228090100_mkt_optional_tool_listings.sql',
      '20261228090200_mkt_info_and_planned_listings.sql',
    ]);
    expect(all.indexOf(mine[0]!)).toBe(all.length - 3);
  });

  it.each(GATED)(
    '$slug is a draft first-party $kind in $category: paid with no price, granting $feature (off by default), marked to comp existing users',
    async ({ slug, feature, kind, category }) => {
      const app = await one(
        `SELECT a.*, c.slug AS category_slug, c.kind AS category_kind FROM marketplace_apps a
         JOIN marketplace_categories c ON c.id = a.category_id WHERE a.slug = $1`,
        [slug],
      );
      expect(app).toMatchObject({
        kind,
        status: 'draft',
        first_party: true,
        pricing_model: 'paid_monthly',
        price_amount: null,
        grants_plan_features: [feature],
        grandfather_existing: true,
        category_slug: category,
        category_kind: kind,
        current_version_id: null,
      });
      // the registry default is off: publishing an app that owns a default-on feature is refused
      expect(PLAN_FEATURE_DEFS.find((d) => d.key === feature)?.default).toBe(false);
      expect(marketListingSchema.safeParse(app.listing).success, slug).toBe(true);

      const versions = await rows(`SELECT * FROM marketplace_app_versions WHERE app_id = $1`, [
        app.id,
      ]);
      expect(versions).toHaveLength(1);
      const v = versions[0]!;
      expect(v).toMatchObject({ version: '1.0.0', status: 'draft' });
      const manifest = validateMarketManifest(v.manifest);
      expect(manifest.ok, JSON.stringify(manifest)).toBe(true);
      if (manifest.ok) {
        expect(manifest.manifest.id).toBe(slug);
        expect(manifest.manifest.kind).toBe(kind);
        expect(manifest.manifest.category).toBe(category);
        expect(manifest.manifest.pricing.model).toBe('addon');
        expect(v.scopes).toEqual(manifest.manifest.scopes);
        if (kind === 'integration') expect(manifest.manifest.connector).toEqual({ type: 'client' });
      }
      if (kind === 'integration') {
        const recipe = validateMarketRecipe(v.recipe);
        expect(recipe.ok, JSON.stringify(recipe)).toBe(true);
      } else {
        expect(v.recipe).toBeNull();
      }
    },
  );

  it.each(INFO)(
    '$slug is an information listing: a free first-party client integration that grants nothing and gates nothing',
    async ({ slug, category }) => {
      const app = await one(
        `SELECT a.*, c.slug AS category_slug FROM marketplace_apps a JOIN marketplace_categories c ON c.id = a.category_id WHERE a.slug = $1`,
        [slug],
      );
      expect(app).toMatchObject({
        kind: 'integration',
        status: 'draft',
        first_party: true,
        pricing_model: 'free',
        connector_type: 'client',
        grants_plan_features: [],
        grandfather_existing: false,
        plan_feature: null,
        category_slug: category,
      });
      expect(marketListingSchema.safeParse(app.listing).success, slug).toBe(true);
      const v = await one(`SELECT * FROM marketplace_app_versions WHERE app_id = $1`, [app.id]);
      expect(validateMarketManifest(v.manifest).ok).toBe(true);
      expect(validateMarketRecipe(v.recipe).ok).toBe(true);
    },
  );

  it.each(PLANNED)(
    '%s is a planned, unbuilt listing: a draft whose connector type is framework-only, recorded as blocked in %s with its id %s',
    async (slug, category, bl) => {
      const app = await one(
        `SELECT a.*, c.slug AS category_slug FROM marketplace_apps a JOIN marketplace_categories c ON c.id = a.category_id WHERE a.slug = $1`,
        [slug],
      );
      expect(app).toMatchObject({
        kind: 'integration',
        status: 'draft',
        first_party: true,
        pricing_model: 'free',
        connector_type: 'oauth',
        grants_plan_features: [],
        category_slug: category,
        current_version_id: null,
      });
      const v = await one(`SELECT * FROM marketplace_app_versions WHERE app_id = $1`, [app.id]);
      expect(v).toMatchObject({ version: '0.1.0', status: 'draft', recipe: null });
      expect(validateMarketManifest(v.manifest).ok, slug).toBe(true);
      // "coming soon" is written for the operator only: the version's changelog, never the listing a workspace reads
      expect(v.changelog).toContain(`COMING SOON, NOT BUILT (${bl}, blocked)`);
      expect(JSON.stringify(app.listing)).not.toMatch(/coming soon|not built/i);
      expect(String(app.tagline)).not.toMatch(/coming soon|not built/i);
    },
  );

  it('OpenAI Ads is a placeholder with no invented behaviour', async () => {
    const app = await one(
      `SELECT name, tagline, listing FROM marketplace_apps WHERE slug = 'openai-ads'`,
    );
    expect(app.name).toBe('OpenAI Ads');
    expect(app.tagline).toBe('Placeholder: this listing has no definition yet.');
    expect(app.listing).toEqual({});
    const v = await one(
      `SELECT changelog FROM marketplace_app_versions v JOIN marketplace_apps a ON a.id = v.app_id WHERE a.slug = 'openai-ads'`,
    );
    expect(v.changelog).toContain('No feature called OpenAI Ads exists');
  });

  it('adds no permission key, hides none and changes no plan: the zero-loss listings are data only', async () => {
    expect(
      await count(`SELECT count(*) AS n FROM permission_defs WHERE app_slug = ANY($1::text[])`, [
        [...GATED.map((g) => g.slug), ...INFO.map((i) => i.slug), ...PLANNED.map((p) => p[0])],
      ]),
    ).toBe(0);
    // no plan row got any of the six features written (they stay off unless an operator turns them on)
    for (const g of GATED)
      expect(
        await count(
          `SELECT count(*) AS n FROM plans WHERE kind = 'plan' AND features->>$1 = 'true' AND slug <> 'granting'`,
          [g.feature],
        ),
        g.feature,
      ).toBe(0);
  });

  it('re-running the migrations changes nothing and never overwrites an operator edit', async () => {
    await h.owner.query(
      `UPDATE marketplace_apps SET tagline = 'Edited by an operator.' WHERE slug = 'sms'`,
    );
    const before = {
      apps: await count(`SELECT count(*) AS n FROM marketplace_apps`),
      versions: await count(`SELECT count(*) AS n FROM marketplace_app_versions`),
    };
    for (const sql of MIGRATIONS) {
      await h.owner.query(sql);
      await h.owner.query(sql);
    }
    expect({
      apps: await count(`SELECT count(*) AS n FROM marketplace_apps`),
      versions: await count(`SELECT count(*) AS n FROM marketplace_app_versions`),
    }).toEqual(before);
    expect((await one(`SELECT tagline FROM marketplace_apps WHERE slug = 'sms'`)).tagline).toBe(
      'Edited by an operator.',
    );
  });
});

describe('nothing unbuilt, and nothing unpriced, is visible to a workspace', () => {
  it('lists none of the new drafts and answers 404 for each', async () => {
    const list = await mp(N).get('/apps?limit=100');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const slugs = (list.body.data as Array<{ slug: string }>).map((a) => a.slug);
    const all = [
      ...GATED.map((g) => g.slug),
      ...INFO.map((i) => i.slug),
      ...PLANNED.map((p) => p[0]),
    ];
    for (const s of all) {
      expect(slugs, s).not.toContain(s);
      expect((await mp(N).get(`/apps/${s}`)).status, s).toBe(404);
    }
    const integ = await mp(N).get('/apps?kind=integration&limit=100');
    expect((integ.body.data as Array<{ slug: string }>).map((a) => a.slug)).not.toContain('sms');
  });
});

describe('(c) the unbuilt drafts cannot be published', () => {
  it.each(PLANNED.map((p) => p[0]))(
    '%s: publish is refused, whatever the operator does',
    async (slug) => {
      const detail = await ops().get(`/apps/${slug}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      const versionId = (detail.body.versions as Array<{ id: string }>)[0]!.id;

      // nothing is approved
      const early = await ops().post(`/apps/${slug}/publish`, {});
      expect(early.status).toBe(409);
      expect(code(early)).toBe('MKT_VERSION_STATE');

      // approved by mistake: the listing still has no recipe, so it is refused again
      expect((await ops().post(`/apps/${slug}/versions/${versionId}/approve`, {})).status).toBe(
        200,
      );
      const noRecipe = await ops().post(`/apps/${slug}/publish`, {});
      expect(noRecipe.status).toBeGreaterThanOrEqual(400);
      expect(['MKT_RECIPE_INVALID', 'MKT_CONNECTOR_NOT_AVAILABLE']).toContain(code(noRecipe));

      expect((await ops().get(`/apps/${slug}`)).body.status, 'the listing is still a draft').toBe(
        'draft',
      );
      expect((await mp(N).get(`/apps/${slug}`)).status).toBe(404);
    },
  );

  it('even with a complete, valid OAuth recipe the answer is 409 MKT_CONNECTOR_NOT_AVAILABLE (the connector type is only a framework)', async () => {
    const slug = 'lead-finder';
    const manifest = {
      manifestVersion: 1,
      id: slug,
      name: 'Lead finder',
      kind: 'integration',
      category: 'lead-sources',
      version: '0.2.0',
      description: 'Find businesses by category and city and add them to your contacts.',
      scopes: ['leads.write'],
      connector: { type: 'oauth' },
    };
    const recipe = {
      schemaVersion: 1,
      key: slug,
      name: 'Lead finder',
      category: 'lead-sources',
      connector: {
        type: 'oauth',
        authorizeUrl: 'https://accounts.example.com/auth',
        tokenUrl: 'https://accounts.example.com/token',
        scopes: ['read'],
        clientSettingKey: 'leadfinder',
      },
    };
    const saved = await ops().post(`/apps/${slug}/versions`, {
      manifest,
      recipe,
      changelog: 'test',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const versionId = (saved.body.versions as Array<{ id: string; version: string }>).find(
      (v) => v.version === '0.2.0',
    )!.id;
    expect((await ops().post(`/apps/${slug}/versions/${versionId}/submit`, {})).status).toBe(200);
    expect((await ops().post(`/apps/${slug}/versions/${versionId}/approve`, {})).status).toBe(200);
    const publish = await ops().post(`/apps/${slug}/publish`, { versionId });
    expect(publish.status, JSON.stringify(publish.body)).toBe(409);
    expect(code(publish)).toBe('MKT_CONNECTOR_NOT_AVAILABLE');
    expect((await mp(N).get(`/apps/${slug}`)).status).toBe(404);
  });
});

describe('(a) the gated tools: locked until bought and installed; a plan that already grants the feature loses nothing', () => {
  it('a new workspace on a plan without the feature is locked on the tool, reads included', async () => {
    for (const g of GATED) expect(await featureOn(N, g.feature), g.feature).toBe(false);
    for (const g of GATED.filter((x) => x.route)) {
      const res = await api.as(N.admin).get(g.route!);
      expect(res.status, `${g.route} ${JSON.stringify(res.body)}`).toBe(422);
      expect(code(res), g.route!).toBe('PLAN_FEATURE_LOCKED');
      expect(JSON.stringify(res.body), g.route!).toContain('feature_disabled');
    }
  });

  it('a workspace whose PLAN grants the features keeps every one, with no purchase and no installation', async () => {
    for (const g of GATED) expect(await featureOn(P, g.feature), g.feature).toBe(true);
    for (const g of GATED.filter((x) => x.route)) {
      const res = await api.as(P.admin).get(g.route!);
      expect(res.status, `${g.route} ${JSON.stringify(res.body)}`).not.toBe(422);
    }
    expect(
      await count(`SELECT count(*) AS n FROM workspace_app_installations WHERE org_id = $1`, [
        P.orgId,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [
        P.orgId,
      ]),
    ).toBe(0);
  });

  it.each(GATED)(
    '$slug: priced and published by the operator, bought (comped) but not installed is still locked, installed is unlocked, uninstalled is locked again',
    async ({ slug, feature, route }) => {
      const app = await ops().get(`/apps/${slug}`);
      expect(app.status, JSON.stringify(app.body)).toBe(200);
      const priced = await ops().put(`/apps/${slug}/pricing`, {
        rowVersion: app.body.rowVersion,
        model: 'paid_monthly',
        amount: '499',
        currency: 'INR',
        grantsPlanFeatures: [feature],
        grandfatherExisting: true,
      });
      expect(priced.status, JSON.stringify(priced.body)).toBe(200);
      const versionId = (app.body.versions as Array<{ id: string }>)[0]!.id;
      expect((await ops().post(`/apps/${slug}/versions/${versionId}/approve`, {})).status).toBe(
        200,
      );
      const published = await ops().post(`/apps/${slug}/publish`, {});
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      // a paid app is shown only to workspaces on a plan that makes it visible
      expect((await mp(N).get(`/apps/${slug}`)).status).toBe(404);
      await showOn('freebie', slug);

      // a workspace now sees it, and cannot install without a subscription
      const detail = await mp(N).get(`/apps/${slug}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.pricing.access).toBe('subscription_required');
      const scopes = (detail.body.scopes as Array<{ id: string }>).map((s) => s.id);
      expect(
        (await mp(N).post(`/apps/${slug}/install`, { acceptedScopes: scopes })).status,
      ).toBeGreaterThanOrEqual(400);
      expect(await featureOn(N, feature)).toBe(false);

      // bought, not installed: still locked, and told to install
      const org = await one(`SELECT uuid FROM organizations WHERE id = $1`, [N.orgId]);
      const comp = await ops().post(`/apps/${slug}/subscriptions/comp`, {
        workspaceId: org.uuid,
        months: null,
        note: 'Bought for the test',
      });
      expect(comp.status, JSON.stringify(comp.body)).toBe(200);
      expect(await featureOn(N, feature)).toBe(false);
      if (route) {
        const locked = await api.as(N.admin).get(route);
        expect(locked.status).toBe(422);
        expect(JSON.stringify(locked.body)).toContain('app_not_installed');
        expect(JSON.stringify(locked.body)).toContain(`/marketplace/app/${slug}`);
      }

      // installed: unlocked
      const install = await mp(N).post(`/apps/${slug}/install`, { acceptedScopes: scopes });
      expect(install.status, JSON.stringify(install.body)).toBe(201);
      expect(await featureOn(N, feature)).toBe(true);
      expect((await api.as(N.admin).get('/v2/billing/entitlements')).body.features).toContain(
        feature,
      );
      if (route) {
        const open = await api.as(N.admin).get(route);
        expect(open.status, `${route} ${JSON.stringify(open.body)}`).not.toBe(422);
      }

      // uninstalled: locked again
      const inst = await one(
        `SELECT i.uuid FROM workspace_app_installations i JOIN marketplace_apps a ON a.id = i.app_id WHERE i.org_id = $1 AND a.slug = $2`,
        [N.orgId, slug],
      );
      const gone = await mp(N).post(`/installations/${inst.uuid}/uninstall`, {
        dataChoice: 'keep',
      });
      expect(gone.status, JSON.stringify(gone.body)).toBe(204);
      expect(await featureOn(N, feature)).toBe(false);
    },
  );
});

describe('the information listings gate nothing', () => {
  it.each(INFO)(
    '$slug publishes as a client listing, and installing it changes nothing about the feature',
    async ({ slug }) => {
      const app = await ops().get(`/apps/${slug}`);
      const versionId = (app.body.versions as Array<{ id: string }>)[0]!.id;
      expect((await ops().post(`/apps/${slug}/versions/${versionId}/approve`, {})).status).toBe(
        200,
      );
      const published = await ops().post(`/apps/${slug}/publish`, {});
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      const before = (await api.as(N.admin).get('/v2/billing/entitlements')).body
        .features as string[];
      const permsBefore = await count(
        `SELECT count(*) AS n FROM permission_defs WHERE app_slug IS NOT NULL`,
      );

      const detail = await mp(N).get(`/apps/${slug}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.pricing.model).toBe('free');
      const scopes = (detail.body.scopes as Array<{ id: string }>).map((s) => s.id);
      const install = await mp(N).post(`/apps/${slug}/install`, { acceptedScopes: scopes });
      expect(install.status, JSON.stringify(install.body)).toBe(201);

      expect(
        (await api.as(N.admin).get('/v2/billing/entitlements')).body.features as string[],
      ).toEqual(before);
      expect(
        await count(`SELECT count(*) AS n FROM permission_defs WHERE app_slug IS NOT NULL`),
      ).toBe(permsBefore);
      // the feature's own keys were never tied to the listing
      const keys = await count(
        `SELECT count(*) AS n FROM permission_defs WHERE key LIKE ANY($1::text[]) AND (app_slug IS NOT NULL OR plan_feature IS NOT NULL)`,
        [slug === 'whatsapp-devices' ? ['wa.devices.%', 'wa.groups.%'] : ['leads.sources.%']],
      );
      expect(keys).toBe(0);
    },
  );
});
