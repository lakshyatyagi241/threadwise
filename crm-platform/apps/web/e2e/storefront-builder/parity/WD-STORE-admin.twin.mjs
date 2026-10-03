// Twin spec for the STORE admin screens (WD-STORE-001..008, 022..025, 029, 030): the shop wizard (/connect?platform=wa-store: list, add,
// edit, delete, share), the dashboard (/store), the sidebar, the storefront settings (/store/storefront) and the store rail on the
// catalog pages (/store/products, /store/reviews), on WaDesk and on ours.
// Run:  node apps/web/e2e/storefront-builder/parity/prepare-org.mjs <cfg.json> --shop
//       PARITY_WEB_URL=http://localhost:3109 PARITY_API_URL=http://localhost:53109 PARITY_CONFIG=<cfg.json> \
//         parity.sh run apps/web/e2e/storefront-builder/parity/WD-STORE-admin.twin.mjs --depth full --workers 1
// One worker: the scenarios share one demo shop per side (the reference edits "the first shop of the workspace").
// Reference test data (workspace 1; nothing the public-shop agent owns, that is workspace 9001 / prefix stp-):
//   - one device row (sent_24h = 7777) so the wizard form shows; one shop with slug `stw-demo`, both created on load when missing
//   - tagged shops the screens create (everything in workspace 1 with an id above the demo shop), orders (customer name stw-...)
// The teardown removes what the run created but keeps the demo shop and the device (so a re-run of failed scenarios works). Remove them
// with:  delete from wa_storefronts where workspace_id=1 and slug='stw-demo';  delete from devices where workspace_id=1 and sent_24h=7777;
import { execFileSync } from 'node:child_process';

export default (h) => {
  // ---------------------------------------------------------------------------------------------------------------
  // database access (seeding, readback and cleanup only; every write the screens make goes through the screens)
  // ---------------------------------------------------------------------------------------------------------------
  const REF_DB = [
    'exec',
    'wadesk-db',
    'mariadb',
    '-uwadesk',
    '-pwadesk_local_pw',
    'wadesk',
    '-N',
    '-B',
    '-r',
    '-e',
  ];
  const OURS_DB = [
    'exec',
    'crm-postgres',
    'psql',
    '-U',
    'crm',
    '-d',
    process.env.STORE_DB || 'crm_store',
    '-tAc',
  ];
  const mysql = (sql) =>
    execFileSync('docker', [...REF_DB, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  const psql = (sql) => execFileSync('docker', [...OURS_DB, sql], { encoding: 'utf8' }).trim();
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const json = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  const pick = h.pick;
  const listMode = process.argv.includes('--list');
  const WS = 1;
  const ORG = h.cfg.ours.org;
  const orgSql = `(SELECT id FROM organizations WHERE slug = '${q(ORG)}')`;

  // ---- the demo shop on both sides --------------------------------------------------------------------------------
  const REF = { id: 0, device: 0, name: 'stw Demo Store', slug: 'stw-demo' };
  const OURS = {
    id: 0,
    uuid: '00000000-0000-0000-0000-000000000000',
    name: '',
    slug: '',
    deviceId: null,
  };
  if (!listMode) {
    REF.device = Number(
      mysql(`select ifnull(max(id),0) from devices where workspace_id=${WS} and sent_24h=7777`),
    );
    if (!REF.device) {
      mysql(
        `insert into devices (user_id, assigned_user_id, device_name, country_code, phone_number, region, active, activate_after_pairing, status, proxy_enabled, sent_24h, failed_24h, warm_day_count, created_at, updated_at, workspace_id) select 1, NULL, device_name, country_code, phone_number, region, 1, 1, 'connected', 0, 7777, 0, 0, NOW(), NOW(), ${WS} from devices where id = 1`,
      );
      REF.device = Number(
        mysql(`select max(id) from devices where workspace_id=${WS} and sent_24h=7777`),
      );
    }
    REF.id = Number(
      mysql(
        `select ifnull(max(id),0) from wa_storefronts where workspace_id=${WS} and slug='stw-demo'`,
      ),
    );
    if (!REF.id) {
      mysql(
        `insert into wa_storefronts (workspace_id,device_id,shop_name,slug,theme_key,enabled,currency_code,created_at,updated_at) values (${WS},${REF.device},'stw Demo Store','stw-demo','aurora',1,'INR',now(),now())`,
      );
      REF.id = Number(
        mysql(`select max(id) from wa_storefronts where workspace_id=${WS} and slug='stw-demo'`),
      );
    }
    const row = json(
      psql(
        `select row_to_json(t) from (select id, uuid, shop_name, slug, device_id from wa_storefronts where org_id = ${orgSql} order by id limit 1) t`,
      ),
    );
    if (row) {
      Object.assign(OURS, {
        id: row.id,
        uuid: row.uuid,
        name: row.shop_name,
        slug: row.slug,
        deviceId: row.device_id,
      });
      // same name and slug as the reference demo shop, so stored values compare equal
      if (row.shop_name !== REF.name || row.slug !== REF.slug)
        try {
          psql(
            `update wa_storefronts set shop_name='${REF.name}', slug='${REF.slug}' where org_id = ${orgSql} and id = ${row.id}`,
          );
          Object.assign(OURS, { name: REF.name, slug: REF.slug });
        } catch {
          /* slug taken by another organisation: the stored slug stays different, the report shows it */
        }
    }
  }

  // reset both demo shops to the same plain state (a scenario that edited them calls this when it ends)
  const resetDemo = (c) => {
    if (c.side === 'wadesk')
      mysql(
        `update wa_storefronts set shop_name='${REF.name}', slug='${REF.slug}', custom_domain=null, custom_domain_verified=0, theme_key='aurora', enabled=1, settings_json=null, shipping_json=null, payment_provider=null, payment_config_json=null, currency_code='INR', device_id=${REF.device}, updated_at=now() where id=${REF.id}`,
      );
    else
      psql(
        `update wa_storefronts set shop_name='${q(OURS.name)}', slug='${q(OURS.slug)}', custom_domain=null, custom_domain_verified=false, theme_key='aurora', enabled=true, settings_json=null, shipping_json=null, payment_provider=null, payment_config_json=null, currency_code='INR', device_id=${OURS.deviceId ?? 'null'} where org_id = ${orgSql} and id = ${OURS.id}`,
      );
  };
  // every shop the screens made: workspace 1 shops above the demo shop (the catalog twin's shop, if present, has a lower id)
  const dropMadeShops = (c) => {
    if (c.side === 'wadesk')
      mysql(
        `delete from wa_storefronts where workspace_id=${WS} and id > ${REF.id} and slug not like 'stp-%' and slug not like 'cat-wk%'`,
      );
    else psql(`delete from wa_storefronts where org_id = ${orgSql} and id > ${OURS.id}`);
  };
  const shopCount = (c) =>
    Number(
      c.side === 'wadesk'
        ? mysql(`select count(*) from wa_storefronts where workspace_id=${WS}`)
        : psql(`select count(*) from wa_storefronts where org_id = ${orgSql}`),
    );

  // The reference never goes network-quiet (background polling), so c.goto would wait out its cap on every page: open it on DOM
  // ready and wait for the element the scenario needs instead. Ours settles normally.
  async function go(c, path, { ready } = {}) {
    if (c.side === 'ours') return c.goto(path, { ready });
    c.obs.actions.navigations += 1;
    const r = await c.page.goto(c.url(path), { waitUntil: 'domcontentloaded' });
    if (ready)
      await c
        .loc(ready)
        .first()
        .waitFor({ state: 'visible', timeout: 8000 })
        .catch(() => {});
    await c.page.waitForTimeout(250);
    return r;
  }

  const idem = () => ({
    'Idempotency-Key': crypto.randomUUID(),
    'Content-Type': 'application/json',
  });

  // ---------------------------------------------------------------------------------------------------------------
  // paths and shared locators
  // ---------------------------------------------------------------------------------------------------------------
  const WIZ = '/connect?platform=wa-store';
  const wizAdd = `${WIZ}&action=add`;
  const wizEdit = { wadesk: `${WIZ}&shop=${REF.id}`, ours: `${WIZ}&shop=${OURS.uuid}` };
  const settingsPath = { wadesk: '/store/storefront', ours: `/store/storefront?shop=${OURS.uuid}` };
  const shopNameInput = { wadesk: '[name=shop_name]', ours: { label: /^shop name/i } };
  const domainInput = { wadesk: '[name=custom_domain]', ours: { label: /^custom domain/i } };
  const none = { css: '#__no-such-element__' };
  // a shop card: the container of the h3 that holds the delete button
  const cardOf = (c, name) =>
    c.page
      .locator('main h3', { hasText: name })
      .locator('xpath=ancestor::div[.//button[@title="Delete shop"]][1]');

  // ---------------------------------------------------------------------------------------------------------------
  // readbacks (side-neutral maps)
  // ---------------------------------------------------------------------------------------------------------------
  const refShop = (where) =>
    json(
      mysql(
        `select json_object('name',shop_name,'slug',slug,'domain',custom_domain,'verified',custom_domain_verified,'enabled',enabled,'theme',theme_key,'device',if(device_id is null,'none','bound'),'currency',currency_code,'provider',payment_provider,'shipping',shipping_json,'payment',payment_config_json,'settings',settings_json) from wa_storefronts where ${where} limit 1`,
      ),
    );
  const oursShop = (where) =>
    json(
      psql(
        `select row_to_json(t) from (select shop_name as name, slug, custom_domain as domain, custom_domain_verified as verified, enabled, theme_key as theme, case when device_id is null then 'none' else 'bound' end as device, currency_code as currency, payment_provider as provider, shipping_json as shipping, payment_config_json as payment, settings_json as settings from wa_storefronts where ${where} limit 1) t`,
      ),
    );
  const parsed = (v) => (typeof v === 'string' ? json(v) : v);
  const flat = (r) => {
    if (!r) return { found: 'no row' };
    const shipping = parsed(r.shipping) || {};
    const payment = parsed(r.payment) || {};
    const settings = parsed(r.settings) || {};
    const out = {
      name: r.name,
      slug: r.slug,
      domain: r.domain,
      verified: r.verified === true || r.verified === 1 || r.verified === '1' ? 'yes' : 'no',
      enabled: r.enabled === true || r.enabled === 1 || r.enabled === '1' ? 'yes' : 'no',
      theme: r.theme,
      device: r.device,
      currency: r.currency,
      provider: r.provider,
      shipFlat: shipping.flat_minor,
      shipFree: shipping.free_above_minor,
      shipNote: shipping.note,
      handle: payment.handle,
      keyId: payment.key_id,
      keySecretSet: payment.key_secret ? 'yes' : 'no',
      webhookSecretSet: payment.webhook_secret ? 'yes' : 'no',
      logo: settings.logo_url,
      brand: settings.brand_color,
      hero: settings.hero_text,
      footer: settings.footer_text,
      recovery: settings.cart_recovery_enabled ? 'on' : 'off',
      delay: settings.cart_recovery_delay_min,
      message: settings.cart_recovery_message,
    };
    for (const k of Object.keys(out)) if (out[k] == null) out[k] = '';
    return out;
  };
  const readDemo = (c) =>
    flat(
      c.side === 'wadesk'
        ? refShop(`id=${REF.id}`)
        : oursShop(`org_id = ${orgSql} and id = ${OURS.id}`),
    );
  const readNewest = (c) =>
    flat(
      c.side === 'wadesk'
        ? refShop(
            `workspace_id=${WS} and id > ${REF.id} and slug not like 'stp-%' and slug not like 'cat-wk%' order by id desc`,
          )
        : oursShop(`org_id = ${orgSql} and id > ${OURS.id} order by id desc`),
    );

  // ---------------------------------------------------------------------------------------------------------------
  // seeding through the shop wizard's own write path (API on ours, SQL on the reference: its only write path is the form)
  // ---------------------------------------------------------------------------------------------------------------
  async function seedShop(c, over = {}) {
    const name = over.name ?? `stw-${c.tag('shop')}`;
    const slug = over.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (c.side === 'wadesk') {
      mysql(
        `insert into wa_storefronts (workspace_id,device_id,shop_name,slug,theme_key,enabled,currency_code,created_at,updated_at) values (${WS},${REF.device},'${q(name)}','${q(slug)}','aurora',1,'INR',now(),now())`,
      );
      return {
        name,
        slug,
        id: Number(
          mysql(
            `select max(id) from wa_storefronts where workspace_id=${WS} and slug='${q(slug)}'`,
          ),
        ),
      };
    }
    const r = await c.http('POST', '/v2/store/shops', {
      headers: idem(),
      data: { shopName: name, ...(OURS.deviceId ? { deviceId: await oursDeviceUuid(c) } : {}) },
    });
    if (!r.ok) throw new Error(`shop seed failed: ${r.status} ${r.text.slice(0, 120)}`);
    return { name, slug: r.body.slug, id: r.body.id };
  }
  let oursDevice;
  const oursDeviceUuid = async (c) => {
    if (!oursDevice) {
      const w = await c.http('GET', '/v2/store/shops');
      oursDevice = w.body?.devices?.[0]?.id ?? null;
    }
    return oursDevice;
  };
  const dropShopByName = (c, made) => {
    if (!made?.name) return;
    if (c.side === 'wadesk')
      mysql(`delete from wa_storefronts where workspace_id=${WS} and shop_name='${q(made.name)}'`);
    else
      psql(`delete from wa_storefronts where org_id = ${orgSql} and shop_name = '${q(made.name)}'`);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // pages
  // ---------------------------------------------------------------------------------------------------------------
  const PROBES = h.ALL_PAGE_PROBES;
  const pages = [
    {
      id: 'wizard-list',
      title: 'Shop wizard: list of shops',
      path: WIZ,
      ready: 'main h3',
      probes: PROBES,
    },
    {
      id: 'wizard-add',
      title: 'Shop wizard: add shop form',
      path: wizAdd,
      ready: shopNameInput,
      probes: PROBES,
    },
    {
      id: 'wizard-edit',
      title: 'Shop wizard: edit shop form',
      path: wizEdit,
      ready: shopNameInput,
      probes: PROBES,
    },
    {
      id: 'store-dashboard',
      title: 'Store dashboard',
      path: '/store',
      ready: 'main h1',
      probes: PROBES,
    },
    {
      id: 'store-settings',
      title: 'Storefront settings',
      path: settingsPath,
      ready: { wadesk: 'form[action$="/store/storefront"]', ours: 'main form' },
      probes: PROBES,
    },
    {
      id: 'store-products',
      title: 'Products page (store rail)',
      path: '/store/products',
      ready: 'main h1',
      probes: PROBES,
    },
    {
      id: 'store-reviews',
      title: 'Reviews page (store rail)',
      path: '/store/reviews',
      ready: 'main h1',
      probes: PROBES,
    },
  ];

  // ---------------------------------------------------------------------------------------------------------------
  // forms
  // ---------------------------------------------------------------------------------------------------------------
  // a number box: type like a user (the browser drops what it does not accept), because fill() refuses text in number inputs
  const typeLike = (spec) => async (c, v) => {
    const l = c.loc(spec).first();
    c.obs.actions.fills += 1;
    await l.focus();
    await c.page.keyboard.press('Control+A');
    await c.page.keyboard.press('Delete');
    if (v !== '' && v != null) await c.page.keyboard.type(String(v));
  };
  const F = (id, type, loc, extra = {}) => {
    const f = { id, type, loc, ...extra };
    if (type === 'number' || type === 'integer') f.fill = typeLike(loc);
    return f;
  };
  const DOMAIN_CASES = [
    { id: 'valid-domain', value: 'stw-shop.example.com', why: 'a plain sub-domain is accepted' },
    { id: 'uppercase', value: 'Shop.Example.com', why: 'case folding before the pattern check' },
    { id: 'no-dot', value: 'localhost', why: 'a domain needs a dot and a top-level part' },
    { id: 'with-scheme', value: 'https://shop.example.com', why: 'a scheme is not a domain' },
    { id: 'with-path', value: 'shop.example.com/x', why: 'a path is not a domain' },
    {
      id: 'underscore',
      value: 'my_shop.example.com',
      why: 'underscore is not allowed in the pattern',
    },
    { id: 'trailing-dot', value: 'shop.example.com.', why: 'trailing root dot' },
    { id: 'idn', value: 'bücher.example.com', why: 'internationalised domain names' },
    { id: 'one-letter-tld', value: 'shop.example.c', why: 'top-level part needs two letters' },
    { id: 'punycode', value: 'xn--bcher-kva.example.com', why: 'punycode form' },
  ];

  const wizardCreate = {
    id: 'wizard-create',
    title: 'Add shop (wizard)',
    open: {
      wadesk: async (c) => go(c, wizAdd, { ready: shopNameInput.wadesk }),
      ours: async (c) => go(c, wizAdd, { ready: shopNameInput.ours }),
    },
    root: { wadesk: 'form[action$="/connect/wa-store/save"]', ours: 'main form' },
    submit: { role: 'button', name: /create shop/i },
    valid: (c) => ({ shop_name: `stw-${c.tag('shop')}` }),
    tagField: ['shop_name'],
    fields: [
      F('shop_name', 'name', shopNameInput, { required: true, max: 191 }),
      F('custom_domain', 'text', domainInput, { max: 191, cases: DOMAIN_CASES }),
    ],
    readback: { wadesk: async (c) => readNewest(c), ours: async (c) => readNewest(c) },
    cleanup: { wadesk: async (c) => dropMadeShops(c), ours: async (c) => dropMadeShops(c) },
    countAfter: { wadesk: async (c) => shopCount(c), ours: async (c) => shopCount(c) },
  };

  const wizardEdit = {
    id: 'wizard-edit',
    title: 'Edit shop (wizard)',
    open: {
      wadesk: async (c) => go(c, wizEdit.wadesk, { ready: shopNameInput.wadesk }),
      ours: async (c) => go(c, wizEdit.ours, { ready: shopNameInput.ours }),
    },
    root: { wadesk: 'form[action$="/connect/wa-store/save"]', ours: 'main form' },
    submit: { role: 'button', name: /save changes/i },
    valid: (c) => ({ shop_name: `stw-${c.tag('edit')}` }),
    tagField: ['shop_name'],
    fields: [
      F('shop_name', 'name', shopNameInput, { required: true, max: 191, skipMatrix: true }),
      F('custom_domain', 'text', domainInput, { max: 191, skipMatrix: true }),
    ],
    readback: { wadesk: async (c) => readDemo(c), ours: async (c) => readDemo(c) },
    cleanup: { wadesk: async (c) => resetDemo(c), ours: async (c) => resetDemo(c) },
    countAfter: { wadesk: async (c) => shopCount(c), ours: async (c) => shopCount(c) },
  };

  // ---- storefront settings --------------------------------------------------------------------------------------
  const L = (css, label) => ({ wadesk: css, ours: label });
  const settingsForm = {
    id: 'settings',
    title: 'Storefront settings',
    open: {
      wadesk: async (c) => {
        resetDemo(c);
        await go(c, settingsPath.wadesk, { ready: 'form[action$="/store/storefront"]' });
      },
      ours: async (c) => {
        resetDemo(c);
        await go(c, settingsPath.ours, { ready: 'main form' });
      },
    },
    root: { wadesk: 'form[action$="/store/storefront"]', ours: 'main form' },
    submit: {
      wadesk: 'button[type=submit]:has-text("Save")',
      ours: { role: 'button', name: /^save/i },
    },
    valid: (c) => ({ slug: `stw-${c.tag('slug')}` }),
    tagField: ['hero_text', 'footer_text'],
    fields: [
      F('slug', 'slug', L('[name=slug]', { label: /^storefront slug/i }), {
        required: true,
        max: 64,
      }),
      F('custom_domain', 'text', L('[name=custom_domain]', { label: /^custom domain/i }), {
        max: 191,
        cases: DOMAIN_CASES,
        skipCases: [
          'padded',
          'script',
          'sql',
          'long-300',
          'very-long',
          'emoji',
          'rtl',
          'null-byte',
        ],
      }),
      F('logo_url', 'url', L('[name=logo_url]', { label: /^logo url/i }), { max: 1024 }),
      F('brand_color', 'text', L('input[maxlength="7"]', { label: /brand color \(hex\)/i }), {
        max: 7,
        cases: [
          { id: 'hex-ok', value: '#1a2B3c', why: 'valid six digit hex' },
          { id: 'hex-no-hash', value: '1a2b3c', why: 'hash is required' },
          { id: 'hex-short', value: '#abc', why: 'three digit shorthand' },
          { id: 'hex-bad-digit', value: '#12345g', why: 'non hex digit' },
        ],
        skipCases: ['padded', 'script', 'sql', 'emoji', 'rtl', 'null-byte', 'max', 'max+1'],
      }),
      F('hero_text', 'textarea', L('[name=hero_text]', { label: /^hero text/i }), { max: 280 }),
      F('footer_text', 'text', L('[name=footer_text]', { label: /^footer text/i }), {
        max: 280,
        skipMatrix: true,
      }),
      F('currency_code', 'select', L('[name=currency_code]', { label: /^currency/i }), {}),
      F('shipping_flat', 'number', L('[name=shipping_flat]', { label: /^flat shipping fee/i }), {
        minValue: 0,
        maxValue: 1000000,
      }),
      F(
        'shipping_free_above',
        'number',
        L('[name=shipping_free_above]', { label: /^free shipping above/i }),
        {
          minValue: 0,
          maxValue: 1000000,
        },
      ),
      F('shipping_note', 'text', L('[name=shipping_note]', { label: /^shipping note/i }), {
        max: 160,
        skipMatrix: true,
      }),
      F('payment_provider', 'select', L('[name=payment_provider]', { label: /^provider/i }), {}),
      F('payment_handle', 'text', L('[name=payment_handle]', { label: /^payment detail/i }), {
        max: 255,
        skipMatrix: true,
      }),
      F('rzp_key_id', 'text', L('[name=rzp_key_id]', { label: /^key id/i }), {
        max: 191,
        skipMatrix: true,
      }),
      F(
        'cart_recovery_enabled',
        'checkbox',
        L('input[type=checkbox][name=cart_recovery_enabled]', { label: /send a whatsapp nudge/i }),
        {},
      ),
      F(
        'cart_recovery_delay_min',
        'integer',
        L('[name=cart_recovery_delay_min]', { label: /^delay \(minutes\)/i }),
        {
          minValue: 5,
          maxValue: 1440,
        },
      ),
      F(
        'cart_recovery_message',
        'text',
        L('[name=cart_recovery_message]', { label: /^message \(blank/i }),
        { max: 1024, skipMatrix: true },
      ),
      F(
        'enabled',
        'checkbox',
        L('input[type=checkbox][name=enabled]', { label: /storefront live/i }),
        {},
      ),
    ],
    readback: { wadesk: async (c) => readDemo(c), ours: async (c) => readDemo(c) },
    cleanup: { wadesk: async (c) => resetDemo(c), ours: async (c) => resetDemo(c) },
    countAfter: { wadesk: async (c) => shopCount(c), ours: async (c) => shopCount(c) },
  };

  // ---------------------------------------------------------------------------------------------------------------
  // deletes
  // ---------------------------------------------------------------------------------------------------------------
  const deletes = [
    {
      id: 'shop-delete',
      title: 'Delete shop',
      page: WIZ,
      ready: 'main h3',
      seed: { wadesk: async (c) => seedShop(c), ours: async (c) => seedShop(c) },
      row: (made, c) => cardOf(c, made.name),
      start: async (c, row) => {
        await row.locator('button[title="Delete shop"]').first().click();
      },
      confirm: {
        wadesk: '#reset-modal button[type=submit]',
        ours: 'dialog[open] button:has-text("Yes, delete")',
      },
      cancel: {
        wadesk: '#reset-modal [data-close-reset]',
        ours: 'dialog[open] button:has-text("Cancel")',
      },
      cleanup: {
        wadesk: async (c, made) => dropShopByName(c, made),
        ours: async (c, made) => dropShopByName(c, made),
      },
    },
  ];

  // ---------------------------------------------------------------------------------------------------------------
  // orders for the dashboard (same figures on both sides)
  // ---------------------------------------------------------------------------------------------------------------
  // [days ago, hour (UTC), customer, phone, source, status, [[product, qty, unit price in minor units]]]
  const ORDERS = [
    [0, 3, 'Asha Rao', '+919876500001', 'storefront', 'paid', [['Linen Shirt', 2, 149900]]],
    [
      0,
      1,
      'Ben Ortiz',
      '+14155550102',
      'waba',
      'new',
      [
        ['Clay Mug', 1, 45000],
        ['Canvas Tote', 1, 65000],
      ],
    ],
    [1, 14, 'Chen Wei', '+8613800000003', 'storefront', 'cancelled', [['Linen Shirt', 1, 149900]]],
    [2, 11, '', '+34600000004', 'storefront', 'shipped', [['Hoodie', 1, 299900]]],
    [6, 10, 'Farid Khan', '+971500000007', 'storefront', 'confirmed', [['Canvas Tote', 2, 65000]]],
    [13, 15, 'Ivy Chen', '+6591000010', 'waba', 'completed', [['Clay Mug', 3, 45000]]],
  ];
  const VIEWS = [12, 19, 26, 33, 17, 24, 31, 15, 22, 29];
  async function seedOrders(c) {
    const total = (items) => items.reduce((s, [, qty, price]) => s + qty * price, 0);
    const rows = ORDERS.map(([d, hr, name, phone, source, status, items]) => ({
      d,
      hr,
      name: name ? `stw-${name}` : null,
      phone,
      source,
      status,
      items: JSON.stringify(items.map(([n, qty, price]) => ({ name: n, qty, price }))),
      total: total(items),
    }));
    if (c.side === 'wadesk') {
      for (const r of rows)
        mysql(
          `insert into wa_orders (workspace_id, source, customer_phone, customer_name, items_json, total_minor, currency_code, status, storefront_id, payment_method, created_at, updated_at) values (${WS}, '${r.source}', '${r.phone}', ${r.name ? `'${q(r.name)}'` : 'NULL'}, '${q(r.items)}', ${r.total}, 'INR', '${r.status}', ${REF.id}, 'prepaid', DATE_SUB(UTC_DATE(), INTERVAL ${r.d} DAY) + INTERVAL ${r.hr} HOUR, UTC_TIMESTAMP())`,
        );
      VIEWS.forEach((v, d) =>
        mysql(
          `insert ignore into wa_storefront_views (storefront_id, day, views) values (${REF.id}, UTC_DATE() - INTERVAL ${d} DAY, ${v})`,
        ),
      );
      c.onCleanup(() => {
        mysql(
          `delete from wa_orders where workspace_id=${WS} and customer_phone in (${rows.map((r) => `'${r.phone}'`).join(',')}) and (customer_name like 'stw-%' or customer_name is null) and storefront_id=${REF.id}`,
        );
        mysql(`delete from wa_storefront_views where storefront_id=${REF.id}`);
      });
    } else {
      for (const r of rows)
        psql(
          `insert into wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, currency_code, status, storefront_id, payment_method, created_at, updated_at) values (${orgSql}, '${r.source}', '${r.phone}', ${r.name ? `'${q(r.name)}'` : 'NULL'}, '${q(r.items)}'::jsonb, ${r.total}, 'INR', '${r.status}', ${OURS.id}, 'prepaid', (date_trunc('day', now() AT TIME ZONE 'UTC') - ${r.d} * interval '1 day' + ${r.hr} * interval '1 hour') AT TIME ZONE 'UTC', now())`,
        );
      VIEWS.forEach((v, d) =>
        psql(
          `insert into wa_storefront_views (org_id, storefront_id, day, views) values (${orgSql}, ${OURS.id}, (now() AT TIME ZONE 'UTC')::date - ${d}, ${v})`,
        ),
      );
      c.onCleanup(() => {
        psql(
          `delete from wa_orders where org_id = ${orgSql} and customer_phone in (${rows.map((r) => `'${r.phone}'`).join(',')}) and storefront_id = ${OURS.id}`,
        );
        psql(
          `delete from wa_storefront_views where org_id = ${orgSql} and storefront_id = ${OURS.id}`,
        );
      });
    }
  }
  const mainText = (c) =>
    c.page
      .locator('main')
      .innerText()
      .catch(() => '');
  const asideText = (c) =>
    c.page
      .locator('aside')
      .first()
      .innerText()
      .catch(() => '');

  // ---------------------------------------------------------------------------------------------------------------
  // observation helpers
  // ---------------------------------------------------------------------------------------------------------------
  const lines = (t) =>
    String(t || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const after = (ls, rx, n = 1) => {
    const i = ls.findLastIndex((l) => rx.test(l));
    return i >= 0 ? (ls[i + n] ?? '') : '';
  };
  // where the browser ended up, with the shop id made neutral
  const landing = (c) => {
    const u = new URL(c.page.url());
    return u.pathname + u.search.replace(/shop=[^&]+/, 'shop=X');
  };
  const sidebar = (c) =>
    c.page
      .locator('aside')
      .filter({ hasText: /public url/i })
      .first();
  const SIDE_LABELS = [
    'Overview',
    'Orders',
    'Products',
    'Groups',
    'Storefront',
    'Coupons',
    'Reviews',
    'Payments',
    'Checkout gateways',
    'Customers',
    'Invoices',
  ];
  async function sidebarFacts(c) {
    const aside = sidebar(c);
    if (!(await aside.count().catch(() => 0))) return null;
    const text = lines(await aside.innerText().catch(() => ''));
    const items = await aside
      .evaluate((root, labels) => {
        const out = {};
        for (const label of labels) {
          const el = [...root.querySelectorAll('a,button,[aria-disabled]')].find((e) =>
            (e.textContent || '').trim().startsWith(label),
          );
          if (!el) {
            out[label] = { kind: 'absent', badge: '', href: '' };
            continue;
          }
          const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
          const badge =
            ((el.textContent || '')
              .trim()
              .slice(label.length)
              .match(/^\s*(\d+)/) || [])[1] || '';
          out[label] = {
            kind: el.tagName === 'A' && href ? 'link' : 'disabled',
            badge,
            href: href.replace(/^https?:\/\/[^/]+/, '').replace(/shop=[^&]+/, 'shop=X'),
          };
        }
        return out;
      }, SIDE_LABELS)
      .catch(() => ({}));
    return { text, items };
  }
  const recordSidebar = async (c, key) => {
    const f = await sidebarFacts(c);
    c.obs.flag(`${key}.present`, !!f);
    if (!f) return;
    c.obs.set(
      `map.${key}.kinds`,
      Object.fromEntries(Object.entries(f.items).map(([k, v]) => [k, v.kind])),
    );
    c.obs.set(
      `map.${key}.badges`,
      Object.fromEntries(Object.entries(f.items).map(([k, v]) => [k, v.badge])),
    );
    c.obs.set(
      `map.${key}.hrefs`,
      Object.fromEntries(
        Object.entries(f.items)
          .filter(([, v]) => v.kind === 'link')
          .map(([k, v]) => [k, v.href]),
      ),
    );
    c.obs.flag(
      `${key}.shopName`,
      f.text.some((l) => l === REF.name),
    );
    c.obs.enum(`${key}.pill`, f.text[0]);
    c.obs.info(`${key}.text`, f.text.join(' | '));
  };

  // the dashboard figures
  const dashboardFacts = async (c, key) => {
    const ls = lines(await mainText(c));
    c.obs.set(`map.${key}.kpi`, {
      revenue: after(ls, /^revenue \(30d\)$/i),
      orders: after(ls, /^orders \(30d\)$/i),
      avg: after(ls, /^avg order$/i),
      products: after(ls, /^products$/i),
      visits: after(ls, /^visits \(30d\)$/i),
    });
    const bi = ls.findLastIndex((l) => /^bestsellers$/i.test(l));
    const ri = ls.findLastIndex((l) => /^recent orders$/i.test(l));
    c.obs.seq(`${key}.bestsellers`, bi >= 0 ? ls.slice(bi + 1, ri > bi ? ri : bi + 12) : []);
    const rows = await c.page
      .locator('table', { has: c.page.locator('th', { hasText: /^when$/i }) })
      .first()
      .locator('tbody tr')
      .evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()))
      .catch(() => []);
    c.obs.seq(`${key}.recentOrders`, rows);
    c.obs.info(
      `${key}.emptyTexts`,
      ls.filter((l) => /^no |yet|empty/i.test(l)),
    );
    c.obs.flag(
      `${key}.addProductLink`,
      await c.page
        .locator('main a[href$="/store/products/create"]')
        .first()
        .isVisible()
        .catch(() => false),
    );
  };

  async function createViaUi(c, name, { domain } = {}) {
    await go(c, wizAdd, { ready: shopNameInput });
    await c.fill(shopNameInput, name);
    if (domain) await c.fill(domainInput, domain);
    await c.click({ role: 'button', name: /create shop/i });
    await c.afterAction({ quiet: 900 });
  }
  // temporarily remove the demo shop (the workspace has no shop); restored when the scenario ends
  function withoutDemoShop(c) {
    if (c.side === 'wadesk') {
      mysql(`delete from wa_storefronts where id=${REF.id}`);
      c.onCleanup(() => {
        dropMadeShops(c);
        mysql(
          `insert into wa_storefronts (id,workspace_id,device_id,shop_name,slug,theme_key,enabled,currency_code,created_at,updated_at) values (${REF.id},${WS},${REF.device},'${REF.name}','${REF.slug}','aurora',1,'INR',now(),now())`,
        );
      });
    } else {
      psql(`delete from wa_storefronts where org_id = ${orgSql} and id = ${OURS.id}`);
      c.onCleanup(() => {
        dropMadeShops(c);
        psql(
          `insert into wa_storefronts (org_id,id,uuid,device_id,shop_name,slug,theme_key,enabled,currency_code) values (${orgSql},${OURS.id},'${OURS.uuid}',${OURS.deviceId ?? 'null'},'${q(OURS.name)}','${q(OURS.slug)}','aurora',true,'INR')`,
        );
      });
    }
  }
  const setDevices = (c, status) =>
    c.side === 'wadesk'
      ? mysql(`update devices set status='${status}' where id=${REF.device}`)
      : psql(`update devices set status='${status}' where org_id = ${orgSql}`);

  const demoName = () => REF.name;
  const dlg = { wadesk: '#share-modal', ours: 'dialog[open]' };
  const demoCard = (c) => cardOf(c, demoName());

  // settings form helpers
  const SET = {
    slug: { wadesk: '[name=slug]', ours: { label: /^storefront slug/i } },
    domain: { wadesk: '[name=custom_domain]', ours: { label: /^custom domain/i } },
    logo: { wadesk: '[name=logo_url]', ours: { label: /^logo url/i } },
    brand: { wadesk: 'input[maxlength="7"]', ours: { label: /brand color \(hex\)/i } },
    hero: { wadesk: '[name=hero_text]', ours: { label: /^hero text/i } },
    footer: { wadesk: '[name=footer_text]', ours: { label: /^footer text/i } },
    currency: { wadesk: '[name=currency_code]', ours: { label: /^currency/i } },
    flat: { wadesk: '[name=shipping_flat]', ours: { label: /^flat shipping fee/i } },
    free: { wadesk: '[name=shipping_free_above]', ours: { label: /^free shipping above/i } },
    note: { wadesk: '[name=shipping_note]', ours: { label: /^shipping note/i } },
    provider: { wadesk: '[name=payment_provider]', ours: { label: /^provider/i } },
    handle: { wadesk: '[name=payment_handle]', ours: { label: /^payment detail/i } },
    keyId: { wadesk: '[name=rzp_key_id]', ours: { label: /^key id/i } },
    keySecret: { wadesk: '[name=rzp_key_secret]', ours: { label: /^key secret/i } },
    webhook: { wadesk: '[name=rzp_webhook_secret]', ours: { label: /^webhook secret/i } },
    recovery: {
      wadesk: 'input[type=checkbox][name=cart_recovery_enabled]',
      ours: { label: /send a whatsapp nudge/i },
    },
    delay: { wadesk: '[name=cart_recovery_delay_min]', ours: { label: /^delay \(minutes\)/i } },
    message: { wadesk: '[name=cart_recovery_message]', ours: { label: /^message \(blank/i } },
    live: { wadesk: 'input[type=checkbox][name=enabled]', ours: { label: /storefront live/i } },
    save: {
      wadesk: 'button[type=submit]:has-text("Save")',
      ours: { role: 'button', name: /^save/i },
    },
  };
  const openSettings = async (c) => {
    resetDemo(c);
    await go(c, settingsPath[c.side], { ready: SET.slug[c.side] });
  };
  const setNumber = async (c, spec, v) => typeLike(spec[c.side])(c, v);
  const saveSettings = async (c) => {
    const mark = c.rec.mark();
    await c.click(SET.save);
    await c.afterAction({ quiet: 900 });
    await c.page.waitForTimeout(400);
    return mark;
  };
  const readForm = async (c) => {
    const val = async (spec) => {
      const l = c.loc(spec).first();
      if (!(await l.count().catch(() => 0))) return '(absent)';
      return l.evaluate((e) =>
        e.type === 'checkbox' ? (e.checked ? 'on' : 'off') : String(e.value),
      );
    };
    const out = {};
    for (const [k, spec] of Object.entries(SET)) if (k !== 'save') out[k] = await val(spec);
    return out;
  };

  const scenarios = [
    // ============================ wizard =============================================================================
    {
      id: 'wizard.list-card',
      title: 'Wizard list: the shop card, its links and the add tiles',
      tags: ['wizard'],
      run: async (c) => {
        resetDemo(c);
        await go(c, WIZ, { ready: 'main h3' });
        const card = demoCard(c);
        c.obs.flag(
          'card.present',
          await card
            .first()
            .isVisible()
            .catch(() => false),
        );
        c.obs.list(
          'card.actions',
          await card
            .locator('a[title], button[title]')
            .evaluateAll((es) => es.map((e) => e.getAttribute('title')))
            .catch(() => []),
        );
        const hrefs = await card
          .locator('a')
          .evaluateAll((es) =>
            es.map((e) => ({
              t: e.getAttribute('title') || '',
              href: e.getAttribute('href') || '',
              target: e.getAttribute('target') || '',
            })),
          )
          .catch(() => []);
        const norm = (u) => u.replace(/^https?:\/\/[^/]+/, '').replace(/shop=[^&]+/, 'shop=X');
        c.obs.set('map.card.hrefs', Object.fromEntries(hrefs.map((h2) => [h2.t, norm(h2.href)])));
        c.obs.set('map.card.targets', Object.fromEntries(hrefs.map((h2) => [h2.t, h2.target])));
        const cardLines = lines(
          await card
            .first()
            .innerText()
            .catch(() => ''),
        );
        c.obs.info('card.text', cardLines);
        c.obs.enum('card.theme', cardLines[0]);
        c.obs.flag(
          'card.domainBuiltIn',
          cardLines.some((l) => /^built-in url$/i.test(l)),
        );
        const ml = lines(await mainText(c));
        c.obs.flag(
          'count.sentence',
          ml.some((l) => /^\d+ shops? in /i.test(l)),
        );
        c.obs.flag(
          'liveBadge',
          ml.some((l) => /^live$/i.test(l)),
        );
        c.obs.flag(
          'addShopLink',
          await c.page
            .locator('main a[href*="action=add"]')
            .first()
            .isVisible()
            .catch(() => false),
        );
        c.obs.num('addLinks', await c.page.locator('main a[href*="action=add"]').count());
        await c.shot('list', { fullPage: true });
      },
    },
    {
      id: 'wizard.add-form-facts',
      title: 'Wizard add form: steps, live slug readout, device choice',
      tags: ['wizard'],
      run: async (c) => {
        await go(c, wizAdd, { ready: shopNameInput });
        const txt = await mainText(c);
        const ls = lines(txt);
        c.obs.flag(
          'steps.three',
          /1\s*·\s*shop details/i.test(txt) &&
            /2\s*·\s*public url/i.test(txt) &&
            /3\s*·\s*sending device/i.test(txt),
        );
        c.obs.flag(
          'back.link',
          await c.page
            .locator('main a[href*="platform=wa-store"]')
            .first()
            .isVisible()
            .catch(() => false),
        );
        const radios = c.page.locator('main input[type=radio]');
        c.obs.num('device.count', await radios.count());
        c.obs.enum(
          'device.checked',
          await radios.evaluateAll((rs) => rs.findIndex((r) => r.checked)).catch(() => -2),
        );
        await c.fill(shopNameInput, 'Zoë  Café & Co! 2024');
        await c.page.waitForTimeout(500);
        const ls2 = lines(await mainText(c));
        c.obs.enum('slug.readout.typed', after(ls2, /^storefront slug \(auto\)$/i, 2));
        c.obs.flag(
          'url.followsSlug',
          ls2.some((l) => /\/s\/zoe-cafe-co-2024$/.test(l)),
        );
        await c.fill(shopNameInput, '');
        await c.page.waitForTimeout(400);
        const ls3 = lines(await mainText(c));
        c.obs.enum(
          'slug.readout.empty',
          after(ls3, /^storefront slug \(auto\)$/i, 2) ===
            after(ls, /^storefront slug \(auto\)$/i, 2)
            ? 'initial'
            : 'changed',
        );
        await c.fill(domainInput, 'shop.example.com');
        await c.page.waitForTimeout(400);
        c.obs.info(
          'domain.typed.text',
          lines(await mainText(c)).filter((l) => /domain|cname/i.test(l)),
        );
        await c.shot('add', { fullPage: true });
      },
    },
    {
      id: 'wizard.slug-suffix',
      title:
        'Wizard: the same name twice gives the second shop a numbered slug; the slug is kept on rename',
      tags: ['wizard', 'edge'],
      run: async (c) => {
        const base = `stw-${c.tag('dup')} Café`;
        c.onCleanup(() => dropMadeShops(c));
        await createViaUi(c, base);
        await createViaUi(c, base);
        const rows =
          c.side === 'wadesk'
            ? mysql(
                `select slug from wa_storefronts where workspace_id=${WS} and id > ${REF.id} and slug not like 'stp-%' and slug not like 'cat-wk%' order by id`,
              ).split('\n')
            : psql(
                `select slug from wa_storefronts where org_id = ${orgSql} and id > ${OURS.id} order by id`,
              ).split('\n');
        const first = rows[0] || '';
        c.obs.num('shops.created', rows.filter(Boolean).length);
        c.obs.seq(
          'slug.suffixes',
          rows.filter(Boolean).map((s) => s.slice(first.length)),
        );
        c.obs.flag('slug.firstIsPlain', /^[a-z0-9-]+$/.test(first) && first.includes('cafe'));
      },
    },
    {
      id: 'wizard.share-modal',
      title: 'Share modal: copy, WhatsApp, Email, Telegram, More, QR, closing',
      tags: ['wizard', 'share'],
      run: async (c) => {
        resetDemo(c);
        await c.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
        await go(c, WIZ, { ready: 'main h3' });
        const urlShown = lines(await demoCard(c).first().innerText())[2] || '';
        await c.click(demoCard(c).locator('button[title="Share"]'));
        await c.page.waitForTimeout(500);
        const root = c.page.locator(pick(dlg, c.side)).first();
        c.obs.flag('opens', await root.isVisible().catch(() => false));
        const dl = lines(await root.innerText().catch(() => ''));
        c.obs.flag('title.shopName', dl.includes(REF.name));
        c.obs.seq(
          'options',
          dl
            .filter((l) =>
              /^(copy|whatsapp|email|telegram|more…?|more\.\.\.|show qr code)$/i.test(l),
            )
            .map((l) => l.toLowerCase().replace('...', '…')),
        );
        c.obs.info('moreHint', after(dl, /^more/i));
        const input = root.locator('input[readonly]').first();
        c.obs.flag('input.hasShopUrl', (await input.inputValue().catch(() => '')) === urlShown);
        const hrefOf = (sel) =>
          root
            .locator(sel)
            .first()
            .getAttribute('href')
            .catch(() => '');
        const wa = (await hrefOf('a[href^="https://wa.me/"]')) || '';
        const mail = (await hrefOf('a[href^="mailto:"]')) || '';
        const tg =
          (await hrefOf('a[href^="https://t.me/"], a[href^="https://telegram.me/"]')) || '';
        c.obs.flag('whatsapp.link', wa.startsWith('https://wa.me/'));
        c.obs.flag('whatsapp.carriesUrl', decodeURIComponent(wa).includes(urlShown));
        c.obs.flag('email.link', mail.startsWith('mailto:'));
        c.obs.flag('email.carriesUrl', decodeURIComponent(mail).includes(urlShown));
        c.obs.flag('telegram.link', /^https:\/\/(t|telegram)\.me\//.test(tg));
        c.obs.flag('telegram.carriesUrl', decodeURIComponent(tg).includes(urlShown));
        c.obs.flag(
          'links.newTab',
          (await root
            .locator('a[href^="https://wa.me/"]')
            .first()
            .getAttribute('target')
            .catch(() => '')) === '_blank',
        );
        await c.click(root.getByRole('button', { name: /^copy$/i }));
        await c.page.waitForTimeout(500);
        c.obs.flag(
          'copy.clipboardHasUrl',
          (await c.page
            .evaluate(() => navigator.clipboard.readText().catch(() => ''))
            .catch(() => '')) === urlShown,
        );
        c.obs.flag(
          'copy.labelChanges',
          !(await root
            .getByRole('button', { name: /^copy$/i })
            .first()
            .isVisible()
            .catch(() => false)),
        );
        await c.page.waitForTimeout(1800);
        c.obs.flag(
          'copy.labelResets',
          await root
            .getByRole('button', { name: /^copy$/i })
            .first()
            .isVisible()
            .catch(() => false),
        );
        await c.click(root.getByText(/show qr code/i).first());
        await c.page.waitForTimeout(700);
        c.obs.flag(
          'qr.shown',
          (await root
            .locator('canvas, svg[role=img], img[alt*=QR i], svg[aria-label*=QR i], svg:has(rect)')
            .count()) > 0,
        );
        await c.shot('share-open');
        await c.press('Escape');
        await c.page.waitForTimeout(500);
        c.obs.flag('closes.onEscape', !(await root.isVisible().catch(() => false)));
        if (await root.isVisible().catch(() => false))
          await c.click(root.getByRole('button', { name: /close/i }).first());
        await c.click(demoCard(c).locator('button[title="Share"]'));
        await c.page.waitForTimeout(500);
        await c.click(root.getByRole('button', { name: /^close$/i }).first());
        await c.page.waitForTimeout(400);
        c.obs.flag('closes.onCloseButton', !(await root.isVisible().catch(() => false)));
        await c.click(demoCard(c).locator('button[title="Share"]'));
        await c.page.waitForTimeout(500);
        await c.page.mouse.click(8, 8);
        await c.page.waitForTimeout(400);
        c.obs.flag('closes.onBackdrop', !(await root.isVisible().catch(() => false)));
      },
    },
    {
      id: 'wizard.gate-no-device',
      title: 'No connected WhatsApp number: the wizard gate and what the store pages do',
      tags: ['wizard', 'gate'],
      run: async (c) => {
        setDevices(c, 'disconnected');
        c.onCleanup(() => setDevices(c, 'connected'));
        for (const [id, path] of [
          ['wizard', WIZ],
          ['add', wizAdd],
          ['store', '/store'],
          ['settings', '/store/storefront'],
        ]) {
          const r = await go(c, path);
          await c.page.waitForTimeout(700);
          c.obs.status(`gate.${id}`, r?.status());
          c.obs.enum(`gate.${id}.landing`, landing(c).replace(/&action=add/, ''));
          const t = await mainText(c);
          c.obs.flag(`gate.${id}.connectFirst`, /connect whatsapp first/i.test(t));
          c.obs.flag(
            `gate.${id}.devicesLink`,
            await c.page
              .locator('main a[href$="/devices"], main a[href$="/channels"]')
              .first()
              .isVisible()
              .catch(() => false),
          );
          c.obs.flag(`gate.${id}.formHidden`, !(await c.visible(shopNameInput)));
        }
        await go(c, WIZ);
        await c.shot('gate');
      },
    },
    {
      id: 'wizard.first-run-no-shop',
      title: 'A workspace with no shop: wizard form first, store pages redirect, catalog pages',
      tags: ['wizard', 'first-run'],
      run: async (c) => {
        withoutDemoShop(c);
        for (const [id, path] of [
          ['wizard', WIZ],
          ['store', '/store'],
          ['settings', '/store/storefront'],
          ['products', '/store/products'],
          ['reviews', '/store/reviews'],
          ['productCreate', '/store/products/create'],
        ]) {
          const r = await go(c, path);
          await c.page.waitForTimeout(900);
          c.obs.status(`noshop.${id}`, r?.status());
          c.obs.enum(`noshop.${id}.landing`, landing(c));
          c.obs.flag(`noshop.${id}.formShown`, await c.visible(shopNameInput));
          c.obs.flag(`noshop.${id}.hasMainText`, (await mainText(c)).length > 40);
        }
        await go(c, WIZ, { ready: shopNameInput[c.side] });
        const ls = lines(await mainText(c));
        c.obs.flag(
          'firstRun.noBackLink',
          !(await c.page
            .locator('main a:has-text("Back to shops")')
            .first()
            .isVisible()
            .catch(() => false)),
        );
        c.obs.info('firstRun.text', ls.slice(0, 14));
        await c.shot('first-run', { fullPage: true });
      },
    },
    {
      id: 'wizard.xss-shop-name',
      title:
        'A shop name with markup is shown as text on the list, dashboard, share and delete screens',
      tags: ['wizard', 'xss'],
      run: async (c) => {
        const name = `stw-${c.tag('xss')}<img src=x onerror=window.__xss=1>`;
        const made = await seedShop(c, { name });
        c.onCleanup(() => dropShopByName(c, made));
        await go(c, WIZ, { ready: 'main h3' });
        c.obs.flag('list.literal', (await mainText(c)).includes('<img src=x'));
        const card = cardOf(c, 'stw-' + c.tagBase);
        await c.click(card.locator('button[title="Share"]').first());
        await c.page.waitForTimeout(500);
        c.obs.flag(
          'share.literal',
          (
            (await c.page
              .locator(pick(dlg, c.side))
              .first()
              .innerText()
              .catch(() => '')) || ''
          ).includes('<img src=x'),
        );
        await c.press('Escape');
        await c.page.waitForTimeout(300);
        await go(c, `/store?shop=${made.id}`, { ready: 'main h1' });
        await c.page.waitForTimeout(800);
        c.obs.flag(
          'dashboard.literal',
          ((await asideText(c)) + (await mainText(c))).includes('<img src=x'),
        );
        await go(c, `${WIZ}&shop=${made.id}`, { ready: shopNameInput[c.side] });
        c.obs.flag(
          'edit.valueLiteral',
          (
            await c
              .loc(shopNameInput)
              .first()
              .inputValue()
              .catch(() => '')
          ).includes('<img src=x'),
        );
        c.obs.set(
          'sec.xssExecuted',
          (await c.page.evaluate(() => !!window.__xss).catch(() => false)) ||
            c.rec.events.dialogs.length > 0,
        );
      },
    },
    {
      id: 'wizard.delete-removes-orders',
      title: 'Deleting a shop deletes its orders and keeps the products',
      tags: ['wizard', 'delete'],
      run: async (c) => {
        const made = await seedShop(c);
        const phone = `+91${c.digits(8)}`;
        const internal =
          c.side === 'wadesk'
            ? made.id
            : Number(
                psql(
                  `select id from wa_storefronts where org_id = ${orgSql} and uuid = '${made.id}'`,
                ),
              );
        if (c.side === 'wadesk')
          mysql(
            `insert into wa_orders (workspace_id, source, customer_phone, customer_name, items_json, total_minor, currency_code, status, storefront_id, payment_method, created_at, updated_at) values (${WS}, 'storefront', '${phone}', 'stw-del', '[{"name":"x","qty":1,"price":100}]', 100, 'INR', 'new', ${internal}, 'prepaid', now(), now())`,
          );
        else
          psql(
            `insert into wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, currency_code, status, storefront_id, payment_method) values (${orgSql}, 'storefront', '${phone}', 'stw-del', '[{"name":"x","qty":1,"price":100}]'::jsonb, 100, 'INR', 'new', ${internal}, 'prepaid')`,
          );
        c.onCleanup(() => {
          dropShopByName(c, made);
          if (c.side === 'wadesk')
            mysql(`delete from wa_orders where workspace_id=${WS} and customer_phone='${phone}'`);
          else psql(`delete from wa_orders where org_id = ${orgSql} and customer_phone='${phone}'`);
        });
        const count = () =>
          Number(
            c.side === 'wadesk'
              ? mysql(
                  `select count(*) from wa_orders where workspace_id=${WS} and customer_phone='${phone}'`,
                )
              : psql(
                  `select count(*) from wa_orders where org_id = ${orgSql} and customer_phone='${phone}'`,
                ),
          );
        const products = () =>
          Number(
            c.side === 'wadesk'
              ? mysql(
                  `select count(*) from wa_products where workspace_id=${WS} and deleted_at is null`,
                )
              : psql(`select count(*) from wa_products where org_id = ${orgSql}`),
          );
        const before = products();
        c.obs.num('orders.before', count());
        await go(c, WIZ, { ready: 'main h3' });
        await c.click(cardOf(c, made.name).locator('button[title="Delete shop"]'));
        await c.page.waitForTimeout(400);
        c.obs.flag(
          'modal.namesShop',
          (
            await c.page
              .locator(c.side === 'wadesk' ? '#reset-modal' : 'dialog[open]')
              .first()
              .innerText()
          ).includes(made.name),
        );
        await c.click(
          pick(
            {
              wadesk: '#reset-modal button[type=submit]',
              ours: 'dialog[open] button:has-text("Yes, delete")',
            },
            c.side,
          ),
        );
        await c.afterAction({ quiet: 900 });
        c.obs.num('orders.after', count());
        c.obs.flag('productsKept', products() === before);
        c.obs.flag('shopGone', (await shopCount(c)) === 1);
        const t = lines(await mainText(c));
        c.obs.flag(
          'feedbackShown',
          t.some((l) => /shop deleted|deleted/i.test(l)) ||
            (await c.visible({ role: 'status' })) ||
            (await c.visible({ role: 'alert' })),
        );
        c.obs.info(
          'feedbackText',
          t.filter((l) => /deleted/i.test(l)),
        );
      },
    },
    {
      id: 'wizard.unknown-shop-id',
      title: 'Edit and dashboard links with a shop id that does not exist',
      tags: ['wizard', 'edge'],
      run: async (c) => {
        const bogus = c.side === 'wadesk' ? '99999999' : '11111111-2222-4333-8444-555555555555';
        for (const [id, path] of [
          ['edit', `${WIZ}&shop=${bogus}`],
          ['dashboard', `/store?shop=${bogus}`],
          ['settings', `/store/storefront?shop=${bogus}`],
        ]) {
          const r = await go(c, path);
          await c.page.waitForTimeout(900);
          c.obs.status(`unknown.${id}`, r?.status());
          c.obs.enum(`unknown.${id}.landing`, landing(c));
          const t = await mainText(c);
          c.obs.flag(
            `unknown.${id}.showsDemoShop`,
            t.includes(REF.name) || (await asideText(c)).includes(REF.name),
          );
          c.obs.flag(`unknown.${id}.formShown`, await c.visible(shopNameInput));
        }
      },
    },
    // ============================ dashboard and sidebar ==============================================================
    {
      id: 'dashboard.empty',
      title: 'Dashboard without orders: zeros and empty copy',
      tags: ['dashboard'],
      run: async (c) => {
        resetDemo(c);
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(1200);
        await dashboardFacts(c, 'empty');
        await recordSidebar(c, 'sidebar.empty');
        await c.shot('dashboard-empty', { fullPage: true });
      },
    },
    {
      id: 'dashboard.with-data',
      title:
        'Dashboard with six orders and ten days of visits: figures, bestsellers, recent orders',
      tags: ['dashboard'],
      run: async (c) => {
        resetDemo(c);
        await seedOrders(c);
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(1500);
        await dashboardFacts(c, 'data');
        await recordSidebar(c, 'sidebar.data');
        c.obs.flag('chart.rendered', (await c.page.locator('main svg').count()) > 0);
        await c.shot('dashboard-data', { fullPage: true });
      },
    },
    {
      id: 'dashboard.shop-switcher',
      title: 'Dashboard with two shops: switch shop, manage all shops',
      tags: ['dashboard', 'multi-shop'],
      run: async (c) => {
        resetDemo(c);
        const second = await seedShop(c);
        c.onCleanup(() => dropShopByName(c, second));
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(900);
        const sel = c.page.locator('main select').first();
        c.obs.flag('switcher.present', await sel.isVisible().catch(() => false));
        c.obs.num(
          'switcher.options',
          await sel
            .locator('option')
            .count()
            .catch(() => 0),
        );
        c.obs.flag(
          'manageAll.link',
          await c.page
            .locator('main a[href*="platform=wa-store"]')
            .first()
            .isVisible()
            .catch(() => false),
        );
        if (await sel.isVisible().catch(() => false)) {
          await sel
            .selectOption({ label: second.name })
            .catch(async () => sel.selectOption({ index: 1 }));
          await c.afterAction({ quiet: 900 });
          await c.page.waitForTimeout(800);
          c.obs.flag('switcher.urlHasShop', /shop=/.test(c.page.url()));
          c.obs.flag('switcher.sidebarFollows', (await asideText(c)).includes(second.name));
          c.obs.flag(
            'switcher.titleFollows',
            (await mainText(c)).includes(second.name) || (await asideText(c)).includes(second.name),
          );
          await go(c, '/store/storefront', { ready: SET.slug[c.side] });
          c.obs.flag(
            'settingsAfterSwitch.isSecondShop',
            (await c
              .loc(SET.slug)
              .first()
              .inputValue()
              .catch(() => '')) !== REF.slug && c.side === 'ours',
          );
        }
        await c.shot('switcher');
      },
    },
    {
      id: 'sidebar.shop-card',
      title:
        'Sidebar: shop card, live pill, public URL, open and copy, connection panel, items and badges',
      tags: ['sidebar'],
      run: async (c) => {
        resetDemo(c);
        await c.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(1000);
        await recordSidebar(c, 'sidebar');
        const aside = sidebar(c);
        const open = aside.locator('a', { hasText: /^open/i }).first();
        c.obs.flag('openLink', await open.isVisible().catch(() => false));
        c.obs.flag(
          'openLink.newTab',
          (await open.getAttribute('target').catch(() => '')) === '_blank',
        );
        const copy = aside.getByRole('button', { name: /copy/i }).first();
        c.obs.flag('copyButton', await copy.isVisible().catch(() => false));
        if (await copy.isVisible().catch(() => false)) {
          const url = lines(await aside.innerText()).find((l) => /\/s\//.test(l)) || '';
          await c.click(copy);
          await c.page.waitForTimeout(500);
          c.obs.flag(
            'copy.putsUrlOnClipboard',
            (await c.page
              .evaluate(() => navigator.clipboard.readText().catch(() => ''))
              .catch(() => '')) === url,
          );
          c.obs.flag('copy.feedback', /copied/i.test(await aside.innerText().catch(() => '')));
          await c.page.waitForTimeout(2000);
          c.obs.flag(
            'copy.feedbackResets',
            !/copied/i.test(await aside.innerText().catch(() => '')),
          );
        }
        const al = lines(await aside.innerText());
        c.obs.flag(
          'connection.panel',
          al.some((l) => /^connection$/i.test(l)),
        );
        c.obs.enum('connection.status', after(al, /^connection$/i));
        c.obs.flag(
          'settings.groupLabel',
          al.some((l) => /^settings$/i.test(l)),
        );
        await c.shot('sidebar');
      },
    },
    {
      id: 'sidebar.connection-cases',
      title: 'Sidebar connection line with a connected number and with none',
      tags: ['sidebar', 'gate'],
      run: async (c) => {
        // connected device bound to the shop (default state)
        resetDemo(c);
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(800);
        let al = lines(await asideText(c));
        c.obs.flag(
          'bound.unofficialLine',
          al.some((l) => /^unofficial api/i.test(l)),
        );
        c.obs.flag(
          'bound.providerLive',
          al.some((l) => /provider live/i.test(l)),
        );
        // shop without a device
        if (c.side === 'wadesk')
          mysql(`update wa_storefronts set device_id=null where id=${REF.id}`);
        else
          psql(
            `update wa_storefronts set device_id=null where org_id = ${orgSql} and id = ${OURS.id}`,
          );
        c.onCleanup(() => resetDemo(c));
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(800);
        al = lines(await asideText(c));
        c.obs.info('unbound.lines', al.slice(0, 5));
        c.obs.flag('unbound.pillLive', /^live$/i.test(al[0] || ''));
        c.obs.flag(
          'unbound.notConnectedText',
          al.some((l) => /not connected|device connected|no device/i.test(l)),
        );
        // the only device is offline
        setDevices(c, 'disconnected');
        c.onCleanup(() => setDevices(c, 'connected'));
        await go(c, '/store', { ready: 'main h1' });
        await c.page.waitForTimeout(800);
        al = lines(await asideText(c));
        c.obs.info('offline.lines', al.slice(0, 5));
        c.obs.flag('offline.pillSetup', /^setup$/i.test(al[0] || ''));
      },
    },
    {
      id: 'rail.catalog-pages',
      title:
        'Store sidebar on the catalog pages (products, reviews): present, active item, shop card',
      tags: ['sidebar', 'rail'],
      run: async (c) => {
        resetDemo(c);
        for (const [id, path] of [
          ['products', '/store/products'],
          ['reviews', '/store/reviews'],
          ['productCreate', '/store/products/create'],
        ]) {
          await go(c, path, { ready: 'main h1' });
          await c.page.waitForTimeout(1000);
          await recordSidebar(c, `rail.${id}`);
          const active = await sidebar(c)
            .evaluate((root) => {
              const a = [
                ...root.querySelectorAll(
                  'a[aria-current], a[data-active=true], a[class*=active], a[class*=bg-]',
                ),
              ].find((e) => e.getAttribute('aria-current') || /active|bg-/.test(e.className));
              return a ? (a.textContent || '').trim().replace(/\d+$/, '').trim() : '';
            })
            .catch(() => '');
          c.obs.info(`rail.${id}.activeItem`, active);
        }
      },
    },
    // ============================ settings ===========================================================================
    {
      id: 'settings.themes',
      title: 'Settings: every theme tile selects, saves and reads back',
      tags: ['settings'],
      run: async (c) => {
        await openSettings(c);
        const keys = [
          'aurora',
          'meridian',
          'verdure',
          'bazaar',
          'noir',
          'kraft',
          'mercato',
          'studio',
        ];
        c.obs.num(
          'tiles',
          await c.page.locator('form input[type=radio], main input[type=radio]').count(),
        );
        const saved = [];
        for (const key of keys) {
          const byValue = c.page.locator(`input[type=radio][value="${key}"]`).first();
          if (await byValue.count()) await byValue.check({ force: true }).catch(() => {});
          else
            await c.page
              .locator('label', { hasText: new RegExp(`^\\s*${key}`, 'i') })
              .first()
              .click({ timeout: 4000 })
              .catch(() => {});
          await saveSettings(c);
          saved.push(readDemo(c).theme);
          await go(c, settingsPath[c.side], { ready: SET.slug[c.side] });
        }
        c.obs.seq('saved.themes', saved);
        c.obs.enum(
          'checked.afterReload',
          await c.page
            .locator('input[type=radio]:checked')
            .evaluateAll((rs) =>
              rs.map((r) => r.value || r.getAttribute('aria-label') || '').join('|'),
            )
            .catch(() => ''),
        );
        await c.shot('themes', { fullPage: true });
      },
    },
    {
      id: 'settings.roundtrip',
      title:
        'Settings: fill every field, save, reload; the form shows what was saved (and what is stored)',
      tags: ['settings'],
      run: async (c) => {
        await openSettings(c);
        const tag = c.tag('rt');
        await c.fill(SET.slug, `stw-${tag}`);
        await c.fill(SET.logo, 'https://example.com/logo.png');
        await c.fill(SET.brand, '#1a2b3c');
        await c.fill(SET.hero, `Hero ${tag}`);
        await c.fill(SET.footer, `Footer ${tag}`);
        await c
          .loc(SET.currency)
          .first()
          .selectOption('USD')
          .catch(() => {});
        await setNumber(c, SET.flat, '49.5');
        await setNumber(c, SET.free, '999');
        await c.fill(SET.note, 'Ships in 3 days');
        await c
          .loc(SET.provider)
          .first()
          .selectOption('upi')
          .catch(() => {});
        await c.fill(SET.handle, 'stw@upi');
        await c
          .loc(SET.recovery)
          .first()
          .check()
          .catch(() => {});
        await setNumber(c, SET.delay, '45');
        await c.fill(SET.message, 'Hi {name}, your cart at {shop} is waiting: {url}');
        await saveSettings(c);
        c.obs.set(
          'map.stored',
          Object.fromEntries(
            Object.entries(readDemo(c)).map(([k, v]) => [k, String(v).replace(tag, 'TAG')]),
          ),
        );
        await go(
          c,
          c.side === 'ours' ? `/store/storefront?shop=${OURS.uuid}` : '/store/storefront',
          { ready: SET.slug[c.side] },
        );
        const f = await readForm(c);
        c.obs.set(
          'map.formAfterReload',
          Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).replace(tag, 'TAG')])),
        );
        c.onCleanup(() => resetDemo(c));
      },
    },
    {
      id: 'settings.provider-fields',
      title: 'Settings: which payment fields show for each provider',
      tags: ['settings', 'payment'],
      run: async (c) => {
        await openSettings(c);
        const sel = c.loc(SET.provider).first();
        const values = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
        c.obs.list('provider.options', values);
        for (const v of values) {
          await sel.selectOption(v);
          await c.page.waitForTimeout(250);
          const vis = {};
          for (const k of ['handle', 'keyId', 'keySecret', 'webhook'])
            vis[k] = await c.visible(SET[k]);
          c.obs.set(`map.provider.${v || 'none'}`, vis);
        }
        await c.shot('provider', { fullPage: true });
      },
    },
    {
      id: 'settings.razorpay-secrets',
      title:
        'Settings: Razorpay secrets are write-only, kept when left blank, never echoed or stored in clear',
      tags: ['settings', 'payment', 'security'],
      run: async (c) => {
        await openSettings(c);
        const secret = `sec${c.digits(10)}`;
        const hook = `whk${c.digits(10)}`;
        await c.loc(SET.provider).first().selectOption('razorpay_api');
        await c.fill(SET.keyId, 'rzp_test_stwKey123');
        await c.fill(SET.keySecret, secret);
        await c.fill(SET.webhook, hook);
        await saveSettings(c);
        const s1 = readDemo(c);
        c.obs.set('map.afterFirstSave', {
          provider: s1.provider,
          keyId: s1.keyId,
          keySecretSet: s1.keySecretSet,
          webhookSecretSet: s1.webhookSecretSet,
        });
        const raw =
          c.side === 'wadesk'
            ? mysql(`select payment_config_json from wa_storefronts where id=${REF.id}`)
            : psql(
                `select payment_config_json::text from wa_storefronts where org_id = ${orgSql} and id = ${OURS.id}`,
              );
        c.obs.set('sec.secretStoredInClear', raw.includes(secret) || raw.includes(hook));
        await go(c, settingsPath[c.side], { ready: SET.slug[c.side] });
        const html = await c.page.content();
        c.obs.set('sec.secretInPage', html.includes(secret) || html.includes(hook));
        const f = await readForm(c);
        c.obs.flag('keySecretField.empty', f.keySecret === '');
        c.obs.flag('webhookField.empty', f.webhook === '');
        c.obs.enum('keyId.afterReload', f.keyId);
        c.obs.info(
          'keySecret.placeholder',
          await c
            .loc(SET.keySecret)
            .first()
            .getAttribute('placeholder')
            .catch(() => ''),
        );
        // saving again with the secrets blank keeps what is stored
        await c.fill(SET.hero, `Hero ${c.tag('h')}`);
        await saveSettings(c);
        const s2 = readDemo(c);
        c.obs.set('map.afterBlankResave', {
          keyId: s2.keyId,
          keySecretSet: s2.keySecretSet,
          webhookSecretSet: s2.webhookSecretSet,
        });
        // switching away from the Razorpay API provider drops the keys (WaDesk) or keeps them
        await c.loc(SET.provider).first().selectOption('upi');
        await c.fill(SET.handle, 'stw@upi');
        await saveSettings(c);
        const s3 = readDemo(c);
        c.obs.set('map.afterProviderSwitch', {
          provider: s3.provider,
          handle: s3.handle,
          keySecretSet: s3.keySecretSet,
        });
        c.onCleanup(() => resetDemo(c));
      },
    },
    {
      id: 'settings.verify-domain',
      title: 'Settings: Verify now with and without a domain (a domain that has no CNAME)',
      tags: ['settings', 'domain'],
      run: async (c) => {
        await openSettings(c);
        const verify = () =>
          c.page.locator('button:has-text("Verify"), a:has-text("Verify")').first();
        c.obs.flag(
          'verify.visibleWithoutDomain',
          await verify()
            .isVisible()
            .catch(() => false),
        );
        await c.fill(SET.domain, 'stw-shop.example.com');
        await saveSettings(c);
        await go(c, settingsPath[c.side], { ready: SET.slug[c.side] });
        c.obs.flag(
          'verify.visibleWithDomain',
          await verify()
            .isVisible()
            .catch(() => false),
        );
        const mark = c.rec.mark();
        if (
          await verify()
            .isVisible()
            .catch(() => false)
        ) {
          await c.click(verify());
          await c.afterAction({ quiet: 1500 });
          await c.page.waitForTimeout(1500);
        }
        const posts = c.rec.since(mark).http.filter((h2) => h2.method === 'POST');
        c.obs.num('verify.requests', posts.length);
        c.obs.status('verify', posts[0]?.status);
        const text = lines(await mainText(c));
        c.obs.flag(
          'verify.notVerifiedMessage',
          text.some((l) => /not pointing|not verified|cname|pending/i.test(l)),
        );
        c.obs.info(
          'verify.text',
          text.filter((l) => /cname|verified|pointing/i.test(l)),
        );
        c.obs.enum('stored.verified', readDemo(c).verified);
        await c.shot('verify');
        c.onCleanup(() => resetDemo(c));
      },
    },
    {
      id: 'settings.two-tabs',
      title: 'Settings: two tabs save the same shop one after the other',
      tags: ['settings', 'concurrency'],
      run: async (c) => {
        await openSettings(c);
        const b = await c.openAlso({});
        await b.page.goto(c.url(settingsPath[c.side]), { waitUntil: 'domcontentloaded' });
        await b.page
          .locator(c.side === 'wadesk' ? '[name=slug]' : 'main form')
          .first()
          .waitFor({ timeout: 10000 });
        await b.page.waitForTimeout(800);
        const tagA = `A-${c.tag('a')}`;
        const tagB = `B-${c.tag('b')}`;
        await c.fill(SET.hero, tagA);
        await saveSettings(c);
        const heroB =
          c.side === 'wadesk'
            ? b.page.locator('[name=hero_text]')
            : b.page.getByLabel(/^hero text/i);
        await heroB.fill(tagB);
        const saveB =
          c.side === 'wadesk'
            ? b.page.locator('button[type=submit]:has-text("Save")')
            : b.page.getByRole('button', { name: /^save/i });
        await saveB.click();
        await b.page.waitForTimeout(2200);
        const hero = readDemo(c).hero;
        c.obs.enum(
          'concurrentEdit',
          hero === tagB ? 'last-write-wins' : hero === tagA ? 'conflict' : 'other',
        );
        c.obs.info(
          'tabB.text',
          lines(
            await b.page
              .locator('main')
              .innerText()
              .catch(() => ''),
          ).filter((l) => /updated|changed|reload|conflict|another/i.test(l)),
        );
        c.onCleanup(() => resetDemo(c));
      },
    },
    {
      id: 'settings.second-shop',
      title: 'Settings of the second shop: WaDesk always edits the first shop of the workspace',
      tags: ['settings', 'multi-shop'],
      run: async (c) => {
        resetDemo(c);
        const second = await seedShop(c);
        c.onCleanup(() => dropShopByName(c, second));
        await go(
          c,
          `/store/storefront${c.side === 'ours' ? `?shop=${second.id}` : `?shop=${second.id}`}`,
          { ready: SET.slug[c.side] },
        );
        const slug = await c
          .loc(SET.slug)
          .first()
          .inputValue()
          .catch(() => '');
        c.obs.enum(
          'editedShop',
          slug === REF.slug ? 'first' : slug === second.slug ? 'second' : 'other',
        );
      },
    },
    {
      id: 'settings.validation-feedback',
      title: 'Settings: an invalid slug is reported on the slug field and nothing is saved',
      tags: ['settings', 'validation'],
      run: async (c) => {
        await openSettings(c);
        await c.fill(SET.slug, 'Bad Slug!');
        const mark = await saveSettings(c);
        c.obs.flag('saved', readDemo(c).slug !== REF.slug);
        const invalid = await c.page.evaluate(
          () =>
            [...document.querySelectorAll('input,select,textarea')]
              .filter((e) => !e.checkValidity() || e.getAttribute('aria-invalid') === 'true')
              .map((e) => e.name || e.id).length,
        );
        c.obs.flag(
          'flagged',
          invalid > 0 ||
            (await c.visible({ role: 'alert' })) ||
            (await c.page.locator('main :text-matches("slug", "i")').count()) > 1,
        );
        void mark;
      },
    },
    // ============================ cross-cutting ======================================================================
    {
      id: 'reset-all.ours-only',
      title: 'Clear all store data needs confirmation (ours only: WaDesk has no entry point)',
      tags: ['wizard', 'delete'],
      run: async (c) => {
        const r = await c.http('POST', '/v2/store/shops/reset', {
          headers: idem(),
          data: { confirm: 'nope' },
        });
        c.obs.set('abs.refusesWithoutConfirm', r.status === 422 || r.status === 400);
      },
    },
  ];

  return {
    feature: 'WD-STORE-003',
    title: 'Store admin screens (wizard, dashboard, sidebar, settings, rail)',
    pages,
    forms: [wizardCreate, wizardEdit, settingsForm],
    deletes,
    scenarios,
    intended: [],
    skip: [
      {
        scenario: 'reset-all.ours-only',
        side: 'wadesk',
        reason:
          'WaDesk has no UI entry point for the all-data reset, and its reset form wipes every product of workspace 1 (shared with the catalog twin); ours is checked on its own',
      },
    ],
    severity: {},
    teardown: {
      wadesk: async (c) => {
        dropMadeShops(c);
        resetDemo(c);
        mysql(`delete from wa_orders where workspace_id=${WS} and customer_name like 'stw-%'`);
      },
      ours: async (c) => {
        dropMadeShops(c);
        resetDemo(c);
        psql(`delete from wa_orders where org_id = ${orgSql} and customer_name like 'stw-%'`);
      },
    },
  };
};
