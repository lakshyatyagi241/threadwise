import { GATE_ON } from '../../support/unofficial-gate';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { BuilderContextService } from '../../../src/modules/flow-builder-editor/builder-context.service';

type Row = Record<string, unknown>;
const dialect = new PgDialect();

/** A fake transaction: every query is answered from the first matching `[pattern, rows]` of the table, and recorded. */
function fakeDb(answers: Array<[RegExp, Row[]]>) {
  const seen: string[] = [];
  const execute = async (q: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const text = dialect.sqlToQuery(q).sql.replace(/\s+/g, ' ');
    seen.push(text);
    const hit = answers.find(([re]) => re.test(text));
    return { rows: hit ? hit[1] : [] };
  };
  const tx = { execute };
  return {
    seen,
    db: {
      tx: async (fn: (t: unknown) => unknown) => fn(tx),
      privileged: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
}

const run = <T>(fn: () => Promise<T>): Promise<T> =>
  RequestContextStore.run(
    { requestId: 'r', orgId: 5, actorType: 'user', actorId: 1, userId: 1 },
    fn,
  );

function service(answers: Array<[RegExp, Row[]]>, flags: Record<string, unknown> = {}) {
  const { db, seen } = fakeDb(answers);
  const settings = { get: async (k: string) => flags[k] };
  const svc = new BuilderContextService(db as never, settings as never, GATE_ON);
  return { svc, seen };
}

describe('BuilderContextService.context (TW-FLB-026)', () => {
  it('offers WhatsApp only when nothing is connected, and never invents a channel', async () => {
    const { svc } = service([]);
    const ctx = await run(() => svc.context());
    expect(ctx.channels).toEqual(['chat']);
    expect(Object.values(ctx.senders).every((l) => l.length === 0)).toBe(true);
    expect(ctx.flows).toEqual([]);
    expect(ctx.stores).toEqual({ whatsapp_shop: [], woocommerce: [], shopify: [] });
  });

  it('gates Facebook, TikTok and Email on their platform switches AND a connected account', async () => {
    const rows: Array<[RegExp, Row[]]> = [
      [/FROM facebook_pages/, [{ id: 1, uuid: 'fb-1', name: 'Page', page_id: '9' }]],
      [/FROM tiktok_accounts/, [{ id: 1, uuid: 'tt-1', display_name: 'TT' }]],
      [/FROM workspace_email_accounts/, [{ id: 1, uuid: 'em-1', email: 'a@b.test' }]],
      [/FROM telegram_bots/, [{ id: 1, uuid: 'tg-1', bot_name: 'Bot' }]],
    ];
    // Facebook is a built channel: unset means on (nothing writes the switch), only an explicit false hides it. TikTok and Email are not built: unset means off.
    const unset = await run(() => service(rows).svc.context());
    expect(unset.channels).toEqual(['chat', 'facebook', 'telegram']);
    const off = await run(() => service(rows, { facebook_enabled: false }).svc.context());
    expect(off.channels).toEqual(['chat', 'telegram']);
    expect(off.senders.facebook).toEqual([]);

    const on = await run(() =>
      service(rows, {
        facebook_enabled: true,
        tiktok_enabled: 1,
        email_enabled: 'true',
      }).svc.context(),
    );
    expect(on.channels).toEqual(['chat', 'facebook', 'tiktok', 'telegram', 'email']);
    expect(on.senders.facebook).toEqual([{ key: 'facebook:fb-1', label: 'Page' }]);
    expect(on.senders.email).toEqual([{ key: 'email:em-1', label: 'a@b.test' }]);
  });

  it('reads only label columns of the channel tables, never `*` (those rows hold access tokens)', async () => {
    const { svc, seen } = service([], {
      facebook_enabled: true,
      tiktok_enabled: true,
      email_enabled: true,
    });
    await run(() => svc.context());
    const channelQueries = seen.filter((q) =>
      /FROM (workspace_ig_accounts|facebook_pages|tiktok_accounts|telegram_bots|line_channels|wechat_channels|viber_channels|workspace_email_accounts)\b/.test(
        q,
      ),
    );
    expect(channelQueries).toHaveLength(8);
    for (const q of channelQueries) {
      expect(q).not.toMatch(/SELECT \*/);
      expect(q).not.toMatch(/token|secret|auth/i);
    }
  });

  it('keeps an Instagram mirror account unless it was flagged disconnected', async () => {
    const { svc, seen } = service([
      [/FROM workspace_ig_accounts/, [{ id: 3, uuid: 'ig-1', username: 'shop' }]],
    ]);
    const ctx = await run(() => svc.context());
    expect(ctx.channels).toContain('instagram');
    expect(ctx.senders.instagram).toEqual([{ key: 'instagram:ig-1', label: '@shop' }]);
    expect(seen.find((q) => q.includes('workspace_ig_accounts'))).toContain(
      "status IS DISTINCT FROM 'disconnected'",
    );
  });

  it('lists Shopify and WooCommerce stores that are `active` (their default status), with the store currency', async () => {
    const { svc, seen } = service([
      [
        /FROM woocommerce_integrations/,
        [{ uuid: 'w-1', store_name: null, store_url: 'https://w.test', currency: 'EUR' }],
      ],
      [
        /FROM shopify_integrations/,
        [{ uuid: 's-1', store_name: 'Shop', store_url: 's.test', currency: 'USD' }],
      ],
      [/FROM wa_catalogs/, [{ uuid: 'c-1', catalog_name: null, catalog_id: '77' }]],
    ]);
    const ctx = await run(() => svc.context());
    expect(ctx.stores.woocommerce).toEqual([
      { id: 'w-1', name: 'https://w.test', currency: 'EUR' },
    ]);
    expect(ctx.stores.shopify).toEqual([{ id: 's-1', name: 'Shop', currency: 'USD' }]);
    expect(ctx.stores.whatsapp_shop).toEqual([{ id: 'c-1', name: 'Catalog 77', currency: null }]);
    for (const table of ['woocommerce_integrations', 'shopify_integrations']) {
      const q = seen.find((x) => x.includes(`FROM ${table}`))!;
      expect(q).toContain("status = 'active'");
      expect(q).not.toContain("'connected'");
    }
  });

  it('lists every booking type (inactive ones too) with duration, and every form with its published state', async () => {
    const { svc, seen } = service([
      [
        /FROM booking_types/,
        [
          { uuid: 'b-1', name: 'Consult', duration_minutes: 30, is_active: true },
          { uuid: 'b-2', name: 'Old', duration_minutes: 45, is_active: false },
        ],
      ],
      [
        /FROM wa_forms/,
        [
          { uuid: 'f-1', title: 'Lead', status: 'published', meta_flow_id: '1' },
          { uuid: 'f-2', title: 'Draft', status: 'draft', meta_flow_id: null },
        ],
      ],
    ]);
    const ctx = await run(() => svc.context());
    expect(ctx.bookingTypes).toEqual([
      { id: 'b-1', name: 'Consult', duration: 30, active: true },
      { id: 'b-2', name: 'Old', duration: 45, active: false },
    ]);
    expect(ctx.forms).toEqual([
      { id: 'f-1', title: 'Lead', isPublished: true },
      { id: 'f-2', title: 'Draft', isPublished: false },
    ]);
    expect(seen.find((q) => q.includes('FROM booking_types'))).not.toMatch(
      /is_active\s*(=|\))?\s*(true)?\s*ORDER/i,
    );
    expect(seen.find((q) => q.includes('FROM booking_types'))).not.toContain('AND is_active');
    expect(seen.find((q) => q.includes('FROM wa_forms'))).not.toContain("'published'");
  });

  it('flows carry their channel and published state; agents carry the provider (inactive agents are listed too, oldest first)', async () => {
    const { svc, seen } = service([
      [
        /FROM flows/,
        [
          { uuid: 'fl-1', flow_name: 'Welcome', flow_type: 'instagram', is_published: true },
          { uuid: 'fl-2', flow_name: 'Old', flow_type: null, is_published: false },
        ],
      ],
      [
        /FROM ai_agents/,
        [
          { uuid: 'ag-1', name: 'Triage', provider: 'openai', model: 'gpt-4o-mini' },
          { uuid: 'ag-2', name: 'Bare', provider: null, model: '' },
        ],
      ],
    ]);
    const ctx = await run(() => svc.context());
    expect(ctx.flows).toEqual([
      { id: 'fl-1', name: 'Welcome', flowType: 'instagram', isPublished: true },
      { id: 'fl-2', name: 'Old', flowType: 'chat', isPublished: false },
    ]);
    expect(ctx.agents).toEqual([
      { id: 'ag-1', name: 'Triage', provider: 'openai', model: 'gpt-4o-mini' },
      { id: 'ag-2', name: 'Bare', provider: null, model: null },
    ]);
    const q = seen.find((x) => x.includes('FROM ai_agents'))!;
    expect(q).not.toContain('is_active');
    expect(q).toContain('ORDER BY id');
  });

  it('offers templates the way the broadcast composer does: Meta approval on a Meta workspace, the local approval (or public) elsewhere', async () => {
    const tpl = {
      uuid: 't-1',
      template_name: 'order_ready',
      category: 'utility',
      header: null,
      template_body: 'Hi',
      footer: null,
      attachment_type: null,
      attachment_file: null,
      buttons: [],
      carousel_data: null,
      variable_map: {},
    };
    const waba = service([
      [/FROM workspace_settings/, [{ default_engine: 'waba' }]],
      [/FROM wa_templates/, [tpl]],
    ]);
    const wctx = await run(() => waba.svc.context());
    expect(wctx.templates.map((t) => t.name)).toEqual(['order_ready']);
    const metaQuery = waba.seen.find((q) => q.includes('FROM wa_templates'))!;
    expect(metaQuery).toContain("t.meta_status = 'APPROVED'");
    expect(metaQuery).not.toContain("t.status IN ('approved', 'public')");

    const local = service([
      [/FROM workspace_settings/, [{ default_engine: 'twilio' }]],
      [/FROM wa_templates/, [tpl]],
    ]);
    await run(() => local.svc.context());
    const localQuery = local.seen.find((q) => q.includes('FROM wa_templates'))!;
    expect(localQuery).toContain("t.status IN ('approved', 'public')");
    expect(localQuery).not.toContain("t.meta_status = 'APPROVED'");
    expect(localQuery).toContain("c.status = 'connected'");
    expect(localQuery).toContain("coalesce(t.channel, 'waba') <> 'sms'");
  });

  it('teams group their members; a team with no member has an empty list', async () => {
    const { svc } = service([
      [
        /FROM teams t/,
        [
          { team_uuid: 't-1', team_name: 'Sales', user_uuid: 'u-1', full_name: 'Ana' },
          { team_uuid: 't-1', team_name: 'Sales', user_uuid: 'u-2', full_name: 'Raj' },
          { team_uuid: 't-2', team_name: 'Empty', user_uuid: null, full_name: null },
        ],
      ],
    ]);
    const ctx = await run(() => svc.context());
    expect(ctx.teams).toEqual([
      {
        id: 't-1',
        name: 'Sales',
        members: [
          { id: 'u-1', name: 'Ana' },
          { id: 'u-2', name: 'Raj' },
        ],
      },
      { id: 't-2', name: 'Empty', members: [] },
    ]);
  });

  it('a workspace key replaces that provider\'s admin models with the fixed BYOK defaults (label says "your key")', async () => {
    const { svc } = service([
      [
        /FROM admin_ai_keys/,
        [
          { provider: 'openai', default_model: 'gpt-x', extra_config: '{"models":["gpt-y"]}' },
          { provider: 'anthropic', default_model: 'claude-z', extra_config: '{}' },
        ],
      ],
      [/FROM ai_provider_keys/, [{ provider: 'openai' }]],
    ]);
    const ctx = await run(() => svc.context());
    expect(ctx.aiModels.map((m) => m.value)).toEqual(['claude-z', 'gpt-4o-mini', 'gpt-4o']);
    expect(ctx.aiModels.find((m) => m.value === 'gpt-4o')!.label).toBe(
      'OpenAI (your key) · gpt-4o',
    );
    expect(ctx.aiModels.find((m) => m.value === 'claude-z')!.label).toBe('Anthropic · claude-z');
  });
});

describe('BuilderContextService.commerceProducts (TW-FLB-052)', () => {
  const productRow = {
    uuid: 'p-1',
    retailer_id: 'R1',
    name: 'Mug',
    sku: 'S1',
    image_url: null,
    price_minor: 500,
    currency_code: 'USD',
    product_url: 'https://s/m',
    in_stock: false,
  };

  it('lists the active catalogue newest first, out-of-stock ones included and flagged', async () => {
    const { svc, seen } = service([[/FROM wa_products/, [productRow]]]);
    const res = await run(() => svc.commerceProducts({ provider: 'whatsapp_shop', limit: 50 }));
    expect(res.data).toEqual([
      {
        id: 'p-1',
        retailerId: 'R1',
        name: 'Mug',
        sku: 'S1',
        image: null,
        priceMinor: 500,
        currency: 'USD',
        url: 'https://s/m',
        inStock: false,
      },
    ]);
    const q = seen.find((x) => x.includes('FROM wa_products'))!;
    expect(q).toContain("status = 'active'");
    expect(q).toContain('ORDER BY p.id DESC');
  });

  it('WooCommerce and Shopify offer only products their sync mirrored', async () => {
    const woo = service([[/FROM wa_products/, []]]);
    await run(() => woo.svc.commerceProducts({ provider: 'woocommerce', limit: 10 }));
    expect(woo.seen.find((x) => x.includes('FROM wa_products'))).toContain(
      'woo_product_id IS NOT NULL',
    );
    const shop = service([[/FROM wa_products/, []]]);
    await run(() => shop.svc.commerceProducts({ provider: 'shopify', limit: 10 }));
    expect(shop.seen.find((x) => x.includes('FROM wa_products'))).toContain(
      'shopify_product_id IS NOT NULL',
    );
  });

  it("a store id that is not this workspace's returns nothing and never reaches the catalogue", async () => {
    const { svc, seen } = service([
      [/FROM wa_catalogs/, []],
      [/FROM wa_products/, [productRow]],
    ]);
    const res = await run(() =>
      svc.commerceProducts({
        provider: 'whatsapp_shop',
        storeId: '00000000-0000-4000-8000-000000000001',
        limit: 50,
      }),
    );
    expect(res.data).toEqual([]);
    expect(seen.some((x) => x.includes('FROM wa_products'))).toBe(false);
  });

  it("a search is a name ILIKE with the user's wildcards escaped", async () => {
    const { svc, seen } = service([[/FROM wa_products/, []]]);
    await run(() => svc.commerceProducts({ provider: 'instagram', q: '50%_off', limit: 5 }));
    expect(seen.find((x) => x.includes('FROM wa_products'))).toContain('ILIKE');
  });
});
