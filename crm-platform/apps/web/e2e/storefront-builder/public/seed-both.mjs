// Seeds IDENTICAL public-shop fixture data on both sides so screenshots and behaviour are comparable.
//   node seed-both.mjs seed ours|ref|both     (re-runnable: cleans its own tagged rows first)
//   node seed-both.mjs clean ours|ref|both    (removes every tagged row again)
// Ours: crm_store, org slug `pubshop-e2e` (NEVER database `crm`). Reference Reference MariaDB: a tagged workspace (id 9001, slug
// `stp-workspace`), shops `stp-<theme>`, products named `stp ...` with ids 910001+, orders 9101+. The reference is read-only
// product code; these are test rows that `clean ref` deletes again (hard delete, soft-deleted products keep their slugs).
import { execFileSync } from 'node:child_process';

export const THEMES = [
  'aurora',
  'meridian',
  'verdure',
  'bazaar',
  'noir',
  'kraft',
  'mercato',
  'studio',
];
const PRODUCT_COUNT = 60;
const WS = 9001; // reference workspace id
const WS2 = 9002; // an empty workspace: the shop `stp-empty` (no products, no sending number)
const WS3 = 9003; // workspace of the shop `stp-nonumber` (products, no sending number)
const P0 = 910000; // product id base (same ids on both sides)
const O0 = 9100; // order id base

const svg = (g) =>
  'data:image/svg+xml;utf8,' +
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="hsl(${(g * 37) % 360},35%,72%)"/><circle cx="200" cy="200" r="90" fill="hsl(${(g * 37) % 360},40%,45%)"/></svg>`.replace(
    /#/g,
    '%23',
  );
const LOGO =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%23A6845A"/><text x="32" y="43" font-size="34" text-anchor="middle" fill="white" font-family="serif">K</text></svg>';

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function shops() {
  return THEMES.map((t) => ({
    slug: `stp-${t}`,
    theme: t,
    name: `${cap(t)} Goods`,
    enabled: true,
    settings:
      t === 'meridian'
        ? {
            hero_text: 'Objects for a <em>slower</em> day',
            footer_text: 'Made by hand in small batches',
          }
        : t === 'noir'
          ? {
              hero_text: 'After dark',
              hero_sub: 'Quiet objects, loud presence.',
              top_strip: 'Free delivery this week only',
              footer_text: 'Noir Goods · since 2019',
              brand_color: '#B8860B',
            }
          : t === 'kraft'
            ? { logo_url: LOGO, footer_text: '© Kraft Goods, packed with care' }
            : t === 'studio'
              ? { brand_color: '#7B2D8E' }
              : {},
    shipping: { flat_minor: 5000, free_above_minor: 50000, note: '2-5 business days · Tracked' },
    payment: t === 'bazaar' ? { provider: 'upi', config: { handle: 'shop@upi' } } : null,
  })).concat([
    {
      slug: 'stp-off',
      theme: 'aurora',
      name: 'Closed Goods',
      enabled: false,
      settings: {},
      shipping: null,
      payment: null,
    },
    // empty catalog is not possible (catalog is workspace wide), so no empty shop here.
  ]);
}

export function products() {
  const base = [
    'Linen Shirt',
    'Clay Mug',
    'Canvas Tote',
    'Soy Candle',
    'Wool Scarf',
    'Brass Lamp',
    'Oak Tray',
    'Silk Cap',
  ];
  const cats = ['Tops', 'Home', 'Bags', 'Decor'];
  const out = [];
  for (let g = 1; g <= PRODUCT_COUNT; g++) {
    const price = g * 1000 + 9900;
    out.push({
      id: P0 + g,
      name: `stp ${base[g % 8]} ${g}`,
      slug: `stp-item-${g}`,
      description: `A well made everyday object, number ${g}.`,
      body_html:
        g === 1
          ? '<p>Hand finished <strong>linen</strong> shirt.</p><ul><li>Pre-washed</li><li>Pearl buttons</li></ul><script>alert(1)</script>'
          : null,
      price,
      compare: g % 5 === 0 || g === 1 ? Math.round((price * 14) / 10) : null,
      category: g === 9 ? null : cats[g % 4],
      status: g === 60 ? 'draft' : 'active', // drafts that are in stock are visible (QUIRK)
      in_stock: g !== 6,
      stock_qty: g === 2 || g === 3 ? 3 : g === 4 ? 1 : g % 7 === 0 ? 10 : g === 12 ? 0 : null,
      sort_order: g,
      image: g === 11 ? null : svg(g),
      gallery: g === 1 ? [svg(101), svg(102), svg(1)] : null,
      sku: `SKU-${g}`,
      tags: g === 1 ? ['linen', 'summer'] : null,
      weight: g === 1 ? 250 : null,
      brand: g === 1 ? 'Acme' : null,
      ageDays: g,
    });
  }
  return out;
}

const reviews = [
  {
    product: 1,
    name: 'Asha',
    rating: 5,
    body: 'Lovely fabric, fits perfectly.',
    status: 'approved',
    ageHours: 5,
  },
  {
    product: 1,
    name: 'Ravi',
    rating: 4,
    body: 'Good value. <b>bold</b> test',
    status: 'approved',
    ageHours: 30,
  },
  {
    product: 1,
    name: 'Pending Pat',
    rating: 1,
    body: 'Should never show',
    status: 'pending',
    ageHours: 1,
  },
  { product: 2, name: 'Mira', rating: 3, body: null, status: 'approved', ageHours: 10 },
];
const coupons = [
  {
    code: 'SAVE10',
    type: 'percent',
    amount: 10,
    max_discount: 50000,
    free_shipping: false,
    active: true,
  },
  {
    code: 'FLAT100',
    type: 'flat',
    amount: 10000,
    min_subtotal: 30000,
    free_shipping: false,
    active: true,
  },
  { code: 'SHIPFREE', type: 'flat', amount: 0, free_shipping: true, active: true },
  { code: 'OFF', type: 'percent', amount: 50, free_shipping: false, active: false },
  { code: 'OLD', type: 'percent', amount: 50, free_shipping: false, active: true, expired: true },
];
const orderStatuses = ['new', 'confirmed', 'paid', 'shipped', 'cancelled', 'delivered'];
const TOKEN = (i) => `stptoken${String(i).padStart(2, '0')}`.padEnd(40, 'x');
export const orderTokens = Object.fromEntries(orderStatuses.map((s, i) => [s, TOKEN(i)]));
const orders = orderStatuses.map((status, i) => ({
  id: O0 + i,
  status,
  token: TOKEN(i),
  shop: i === 5 ? 'stp-meridian' : 'stp-aurora',
  payment_link: status === 'new' || status === 'paid' ? 'https://pay.example.com/link/abc' : null,
  address: i === 3 ? null : '12 Test Street\nBangalore 560001',
  items: [
    { product_id: P0 + 1, name: 'stp Clay Mug 1', qty: 2, price_minor: 10900, image: svg(1) },
    { product_id: P0 + 11, name: 'stp Oak Tray 11', qty: 1, price_minor: 20900, image: null },
  ],
  shipping: i === 2 ? 0 : 5000,
  total: 2 * 10900 + 20900 + (i === 2 ? 0 : 5000),
}));

const WA = { country: '91', phone: '9876543210' };

// ---------- SQL builders ----------
const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const qm = (s) =>
  s === null || s === undefined
    ? 'NULL'
    : `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const j = (o) => (o === null || o === undefined ? 'NULL' : JSON.stringify(o));

export function oursSql() {
  const out = [];
  out.push(
    `INSERT INTO organizations (slug, name) VALUES ('pubshop-e2e', 'Public Shop E2E') ON CONFLICT (slug) DO NOTHING;`,
  );
  out.push(
    `DO $$ DECLARE oid bigint := (SELECT id FROM organizations WHERE slug = 'pubshop-e2e'); dev bigint; BEGIN`,
  );
  out.push(`PERFORM set_config('app.org_id', oid::text, true);`);
  for (const t of [
    'wa_orders',
    'wa_coupons',
    'wa_product_reviews',
    'wa_storefront_views',
    'storefront_cart_recoveries',
  ])
    out.push(`DELETE FROM ${t} WHERE org_id = oid;`);
  for (const t of ['wa_products', 'wa_storefronts', 'devices'])
    out.push(`DELETE FROM ${t} WHERE org_id = oid;`);
  out.push(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES (oid, 'stp device', ${q(WA.country)}, ${q(WA.phone)}, 'connected', true) RETURNING id INTO dev;`,
  );
  for (const s of shops()) {
    out.push(
      `INSERT INTO wa_storefronts (org_id, device_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json, settings_json, payment_provider, payment_config_json) VALUES (oid, dev, ${q(s.name)}, ${q(s.slug)}, ${q(s.theme)}, ${s.enabled}, 'INR', ${s.shipping ? q(j(s.shipping)) + '::jsonb' : 'NULL'}, ${q(j(s.settings))}::jsonb, ${q(s.payment?.provider)}, ${s.payment ? q(j(s.payment.config)) + '::jsonb' : 'NULL'});`,
    );
  }
  for (const p of products()) {
    out.push(
      `INSERT INTO wa_products (org_id, id, name, slug, description, body_html, price_minor, compare_price_minor, category, status, in_stock, stock_qty, sort_order, image_url, gallery_json, sku, tags_json, weight_grams, brand, created_at) OVERRIDING SYSTEM VALUE VALUES (oid, ${p.id}, ${q(p.name)}, ${q(p.slug)}, ${q(p.description)}, ${q(p.body_html)}, ${p.price}, ${p.compare ?? 'NULL'}, ${q(p.category)}, ${q(p.status)}, ${p.in_stock}, ${p.stock_qty ?? 'NULL'}, ${p.sort_order}, ${q(p.image)}, ${p.gallery ? q(j(p.gallery)) + '::jsonb' : 'NULL'}, ${q(p.sku)}, ${p.tags ? q(j(p.tags)) + '::jsonb' : 'NULL'}, ${p.weight ?? 'NULL'}, ${q(p.brand)}, now() - interval '${p.ageDays} days');`,
    );
  }
  for (const r of reviews)
    out.push(
      `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, body, status, created_at) VALUES (oid, ${P0 + r.product}, ${q(r.name)}, ${r.rating}, ${q(r.body)}, ${q(r.status)}, now() - interval '${r.ageHours} hours');`,
    );
  for (const c of coupons)
    out.push(
      `INSERT INTO wa_coupons (org_id, code, type, amount, min_subtotal_minor, max_discount_minor, free_shipping, active, expires_at) VALUES (oid, ${q(c.code)}, ${q(c.type)}, ${c.amount}, ${c.min_subtotal ?? 'NULL'}, ${c.max_discount ?? 'NULL'}, ${c.free_shipping}, ${c.active}, ${c.expired ? "now() - interval '1 day'" : 'NULL'});`,
    );
  for (const o of orders)
    out.push(
      `INSERT INTO wa_orders (org_id, id, source, customer_phone, customer_name, customer_address, items_json, total_minor, shipping_minor, currency_code, status, payment_link, storefront_id, recovery_token, payment_method) OVERRIDING SYSTEM VALUE VALUES (oid, ${o.id}, 'storefront', '+919876543210', 'Asha Test', ${q(o.address)}, ${q(j(o.items))}::jsonb, ${o.total}, ${o.shipping}, 'INR', ${q(o.status)}, ${q(o.payment_link)}, (SELECT id FROM wa_storefronts WHERE org_id = oid AND slug = ${q(o.shop)}), ${q(o.token)}, 'prepaid');`,
    );
  out.push('END $$;');
  // an empty organization: the shop `stp-empty` has no products and no sending number
  out.push(
    `INSERT INTO organizations (slug, name) VALUES ('pubshop-empty-e2e', 'Public Shop Empty') ON CONFLICT (slug) DO NOTHING;`,
  );
  out.push(
    `DO $$ DECLARE oid bigint := (SELECT id FROM organizations WHERE slug = 'pubshop-empty-e2e'); BEGIN PERFORM set_config('app.org_id', oid::text, true); DELETE FROM wa_orders WHERE org_id = oid; DELETE FROM wa_storefronts WHERE org_id = oid; INSERT INTO wa_storefronts (org_id, shop_name, slug, theme_key, enabled, currency_code, settings_json) VALUES (oid, 'Empty Goods', 'stp-empty', 'aurora', true, 'INR', '{}'::jsonb); END $$;`,
  );
  // a shop with products but no sending number: the buyer-side WhatsApp links are left out and checkout ends on the dialog
  out.push(
    `INSERT INTO organizations (slug, name) VALUES ('pubshop-nonumber-e2e', 'Public Shop No Number') ON CONFLICT (slug) DO NOTHING;`,
  );
  out.push(
    `DO $$ DECLARE oid bigint := (SELECT id FROM organizations WHERE slug = 'pubshop-nonumber-e2e'); BEGIN PERFORM set_config('app.org_id', oid::text, true); DELETE FROM wa_orders WHERE org_id = oid; DELETE FROM wa_products WHERE org_id = oid; DELETE FROM wa_storefronts WHERE org_id = oid; INSERT INTO wa_storefronts (org_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json, settings_json) VALUES (oid, 'No Number Goods', 'stp-nonumber', 'aurora', true, 'INR', '{"flat_minor": 5000, "free_above_minor": 50000}'::jsonb, '{}'::jsonb); ${[1, 2, 3].map((n) => `INSERT INTO wa_products (org_id, id, name, slug, price_minor, status, in_stock, sort_order, created_at) OVERRIDING SYSTEM VALUE VALUES (oid, ${920000 + n}, 'stp Plain ${n}', 'stp-plain-${n}', ${n * 10000}, 'active', true, ${n}, now() - interval '30 days');`).join(' ')} END $$;`,
  );
  return out.join('\n');
}

export function cleanOursSql() {
  return (
    oursSql()
      .split('\n')
      .slice(0, 11)
      .join('\n')
      .replace(
        "INSERT INTO organizations (slug, name) VALUES ('pubshop-e2e', 'Public Shop E2E') ON CONFLICT (slug) DO NOTHING;",
        '',
      ) +
    '\nEND $$;' +
    `\nDO $$ DECLARE oid bigint := (SELECT id FROM organizations WHERE slug = 'pubshop-empty-e2e'); BEGIN PERFORM set_config('app.org_id', oid::text, true); DELETE FROM wa_orders WHERE org_id = oid; DELETE FROM wa_storefronts WHERE org_id = oid; END $$;` +
    `\nDO $$ DECLARE oid bigint := (SELECT id FROM organizations WHERE slug = 'pubshop-nonumber-e2e'); BEGIN PERFORM set_config('app.org_id', oid::text, true); DELETE FROM wa_orders WHERE org_id = oid; DELETE FROM wa_products WHERE org_id = oid; DELETE FROM wa_storefronts WHERE org_id = oid; END $$;`
  );
}

export function refSql() {
  const out = [];
  out.push('SET FOREIGN_KEY_CHECKS=0;', ...refCleanStatements());
  // The reference's currencies table is empty on a fresh install; Reference's seeder has INR (symbol + 2 decimals), which the
  // free-shipping text and the "Range" hint format through. Tagged by its name so `clean` removes exactly this row.
  out.push(
    `INSERT IGNORE INTO currencies (name, code, symbol, \`precision\`, exchange_rate, is_active, created_at, updated_at) VALUES ('stp Indian Rupee', 'INR', '\u20B9', 2, 83.25, 1, NOW(), NOW());`,
  );
  out.push(
    `INSERT INTO workspaces (id, owner_user_id, name, slug, created_at, updated_at) VALUES (${WS}, 1, 'stp Workspace', 'stp-workspace', NOW(), NOW());`,
    `INSERT INTO devices (id, user_id, workspace_id, device_name, country_code, phone_number, status, active, created_at, updated_at) VALUES (${WS}, 1, ${WS}, ${q(enc('stp device'))}, ${q(enc(WA.country))}, ${q(enc(WA.phone))}, 'connected', 1, NOW(), NOW());`,
  );
  out.push(
    `INSERT INTO workspaces (id, owner_user_id, name, slug, created_at, updated_at) VALUES (${WS2}, 1, 'stp Empty Workspace', 'stp-empty-workspace', NOW(), NOW());`,
    `INSERT INTO wa_storefronts (workspace_id, device_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json, settings_json, created_at, updated_at) VALUES (${WS2}, NULL, 'Empty Goods', 'stp-empty', 'aurora', 1, 'INR', NULL, '{}', NOW(), NOW());`,
  );
  out.push(
    `INSERT INTO workspaces (id, owner_user_id, name, slug, created_at, updated_at) VALUES (${WS3}, 1, 'stp No Number Workspace', 'stp-nonumber-workspace', NOW(), NOW());`,
    `INSERT INTO wa_storefronts (workspace_id, device_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json, settings_json, created_at, updated_at) VALUES (${WS3}, NULL, 'No Number Goods', 'stp-nonumber', 'aurora', 1, 'INR', '{"flat_minor": 5000, "free_above_minor": 50000}', '{}', NOW(), NOW());`,
    ...[1, 2, 3].map(
      (n) =>
        `INSERT INTO wa_products (id, workspace_id, user_id, name, slug, price_minor, status, in_stock, sort_order, created_at, updated_at) VALUES (${920000 + n}, ${WS3}, 1, 'stp Plain ${n}', 'stp-plain-${n}', ${n * 10000}, 'active', 1, ${n}, NOW() - INTERVAL 30 DAY, NOW());`,
    ),
  );
  for (const s of shops())
    out.push(
      `INSERT INTO wa_storefronts (workspace_id, device_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json, settings_json, payment_provider, payment_config_json, created_at, updated_at) VALUES (${WS}, ${WS}, ${qm(s.name)}, ${q(s.slug)}, ${q(s.theme)}, ${s.enabled ? 1 : 0}, 'INR', ${s.shipping ? qm(j(s.shipping)) : 'NULL'}, ${qm(j(s.settings))}, ${q(s.payment?.provider)}, ${s.payment ? qm(j(s.payment.config)) : 'NULL'}, NOW(), NOW());`,
    );
  for (const p of products())
    out.push(
      `INSERT INTO wa_products (id, workspace_id, user_id, name, slug, description, body_html, price_minor, compare_price_minor, category, status, in_stock, stock_qty, sort_order, image_url, gallery_json, sku, tags_json, weight_grams, brand, created_at, updated_at) VALUES (${p.id}, ${WS}, 1, ${qm(p.name)}, ${q(p.slug)}, ${qm(p.description)}, ${qm(p.body_html)}, ${p.price}, ${p.compare ?? 'NULL'}, ${q(p.category)}, ${q(p.status)}, ${p.in_stock ? 1 : 0}, ${p.stock_qty ?? 'NULL'}, ${p.sort_order}, ${qm(p.image)}, ${p.gallery ? qm(j(p.gallery)) : 'NULL'}, ${q(p.sku)}, ${p.tags ? qm(j(p.tags)) : 'NULL'}, ${p.weight ?? 'NULL'}, ${q(p.brand)}, NOW() - INTERVAL ${p.ageDays} DAY, NOW());`,
    );
  for (const r of reviews)
    out.push(
      `INSERT INTO wa_product_reviews (workspace_id, product_id, customer_name, rating, body, status, created_at, updated_at) VALUES (${WS}, ${P0 + r.product}, ${q(r.name)}, ${r.rating}, ${qm(r.body)}, ${q(r.status)}, NOW() - INTERVAL ${r.ageHours} HOUR, NOW());`,
    );
  for (const c of coupons)
    out.push(
      `INSERT INTO wa_coupons (workspace_id, code, type, amount, min_subtotal_minor, max_discount_minor, free_shipping, active, expires_at, created_at, updated_at) VALUES (${WS}, ${q(c.code)}, ${q(c.type)}, ${c.amount}, ${c.min_subtotal ?? 'NULL'}, ${c.max_discount ?? 'NULL'}, ${c.free_shipping ? 1 : 0}, ${c.active ? 1 : 0}, ${c.expired ? 'NOW() - INTERVAL 1 DAY' : 'NULL'}, NOW(), NOW());`,
    );
  for (const o of orders)
    out.push(
      `INSERT INTO wa_orders (id, workspace_id, source, customer_phone, customer_name, customer_address, items_json, total_minor, shipping_minor, currency_code, status, payment_link, storefront_id, recovery_token, payment_method, created_at, updated_at) VALUES (${o.id}, ${WS}, 'storefront', '+919876543210', 'Asha Test', ${qm(o.address)}, ${qm(j(o.items))}, ${o.total}, ${o.shipping}, 'INR', ${q(o.status)}, ${q(o.payment_link)}, (SELECT id FROM wa_storefronts WHERE slug = ${q(o.shop)}), ${q(o.token)}, 'prepaid', NOW(), NOW());`,
    );
  out.push('SET FOREIGN_KEY_CHECKS=1;');
  return out.join('\n');
}

function refCleanStatements() {
  // every table that carries workspace_id gets the tagged workspace's rows removed (checkout tests create contacts etc.)
  return ['__CLEAN_ALL__'];
}

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', 'crm-postgres', 'psql', '-U', 'crm', '-d', 'crm_store', '-v', 'ON_ERROR_STOP=1'],
    {
      input: sql,
      encoding: 'utf8',
    },
  );
// Reference encrypts device columns with the app key: ask the reference container to encrypt (no reference code is touched).
const enc = (v) =>
  execFileSync(
    'docker',
    [
      'exec',
      'threadwise-app',
      'php',
      '-r',
      `require "/app/vendor/autoload.php"; $app=require "/app/bootstrap/app.php"; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo Crypt::encryptString("${v}");`,
    ],
    { encoding: 'utf8' },
  ).trim();
const maria = (sql) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'threadwise-db',
      'mariadb',
      '-uthreadwise',
      '-pthreadwise_local_pw',
      'threadwise',
    ],
    {
      input: sql,
      encoding: 'utf8',
    },
  );

function cleanRef() {
  const tables = maria(
    "select table_name from information_schema.columns where table_schema='threadwise' and column_name='workspace_id' and table_name not in ('workspaces')",
  )
    .split('\n')
    .slice(1)
    .filter(Boolean);
  const stmts = ['SET FOREIGN_KEY_CHECKS=0;'];
  for (const t of tables)
    stmts.push(`DELETE FROM \`${t}\` WHERE workspace_id IN (${WS}, ${WS2}, ${WS3});`);
  stmts.push(
    `DELETE FROM wa_storefront_views WHERE storefront_id NOT IN (SELECT id FROM wa_storefronts);`,
    `DELETE FROM workspaces WHERE id IN (${WS}, ${WS2}, ${WS3});`,
    `DELETE FROM currencies WHERE name = 'stp Indian Rupee';`,
    'SET FOREIGN_KEY_CHECKS=1;',
  );
  maria(stmts.join('\n'));
}

if (process.argv[1] && process.argv[1].endsWith('seed-both.mjs')) {
  const [cmd, side = 'both'] = process.argv.slice(2);
  const doOurs = side === 'ours' || side === 'both';
  const doRef = side === 'ref' || side === 'both';
  if (cmd === 'seed') {
    if (doOurs) {
      psql(oursSql());
      console.log('ours seeded');
    }
    if (doRef) {
      cleanRef();
      maria(refSql().replace('__CLEAN_ALL__', ''));
      console.log('ref seeded');
    }
  } else if (cmd === 'clean') {
    if (doOurs) {
      psql(cleanOursSql());
      console.log('ours cleaned');
    }
    if (doRef) {
      cleanRef();
      console.log('ref cleaned');
    }
  } else {
    console.error('usage: node seed-both.mjs seed|clean ours|ref|both');
    process.exit(1);
  }
}
