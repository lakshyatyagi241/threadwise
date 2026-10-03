// Twin spec for the catalog-products screens (WD-CAT-014..027, 035): Send tab, Collections (create, edit, delete, send panel),
// Activity, the products list, the product create/edit form, delete, the share modal, and the reviews queue, on WaDesk and on ours.
// Run:  parity.sh run apps/web/e2e/catalog-products/parity/WD-CAT.twin.mjs --depth full
// Needs a PARITY_CONFIG made by `node prepare-org.mjs <config.json>` (a throw-away organisation: no device, no catalog connection,
// wa_storefront on) and PARITY_WEB_URL / PARITY_API_URL, see docs/wadesk-port/parity/catalog-products.md ("Twin harness").
// The reference needs one storefront row (its product and review pages return HTTP 500 without one); this spec inserts a tagged
// `cat-wk-shop` row when it is missing and leaves it in place for the next run (remove it by hand when you are done).
// Test data: every product, collection and review carries the run tag (pwp-...), names also start with `cat-wk-`; the teardown removes
// what the run made on both sides (reference by SQL, because it soft-deletes and keeps the slug reserved).
import { execFileSync } from 'node:child_process';

export default (h) => {
  // ---------------------------------------------------------------------------------------------------------------
  // database access (readback and cleanup only; every write the screens make goes through the screens)
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
    process.env.CAT_DB || 'crm_cat',
    '-tAc',
  ];
  const mysql = (sql) => execFileSync('docker', [...REF_DB, sql], { encoding: 'utf8' }).trim();
  const psql = (sql) => execFileSync('docker', [...OURS_DB, sql], { encoding: 'utf8' }).trim();
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const likeTag = (tag) => String(tag).replace(/[%_\\]/g, '');
  const listMode = process.argv.includes('--list');
  const WS = 1; // reference workspace of the seeded admin

  const ensureRefShop = () => {
    if (listMode) return;
    if (mysql(`select count(*) from wa_storefronts where workspace_id=${WS}`) === '0')
      mysql(
        `insert into wa_storefronts (workspace_id,shop_name,slug,theme_key,enabled,currency_code,created_at,updated_at) values (${WS},'cat-wk-shop','cat-wk-shop','aurora',1,'INR',now(),now())`,
      );
  };
  ensureRefShop();

  const orgOf = (c) => `(SELECT id FROM organizations WHERE slug = '${q(c.cfg.ours.org)}')`;
  const uniq = () => Math.random().toString(36).slice(2, 7);
  const json = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------------------------------------------------------
  // seeding through each side's own write path
  // ---------------------------------------------------------------------------------------------------------------
  // The reference never goes network-quiet (background polling), so c.goto would wait out its 8 s cap on every page: open it
  // on DOM ready and wait for the element the scenario needs instead. Ours settles normally.
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

  async function seedProduct(c, over = {}) {
    const name = over.name ?? `cat-wk-${c.tag('p')}-${uniq()}`;
    const sku = over.sku ?? c.tag('s');
    if (c.side === 'wadesk') {
      const r = await c.http('POST', '/store/products', {
        form: {
          name,
          sku,
          price_major: over.price ?? '10',
          currency_code: 'INR',
          in_stock: '1',
          status: over.status ?? 'active',
          ...(over.extra || {}),
        },
      });
      if (!r.ok) throw new Error(`reference product seed failed: ${r.status}`);
      const id = mysql(
        `select id from wa_products where workspace_id=${WS} and name='${q(name)}' order by id desc limit 1`,
      );
      return { name, sku, id };
    }
    const r = await c.http('POST', '/v2/catalog/products', {
      headers: idem(),
      data: {
        name,
        sku,
        priceMajor: over.price ?? '10',
        currencyCode: 'INR',
        inStock: true,
        status: over.status ?? 'active',
        tags: [],
        galleryUrls: [],
        ...(over.ours || {}),
      },
    });
    if (!r.ok) throw new Error(`product seed failed: ${r.status} ${r.text.slice(0, 120)}`);
    return { name, sku, id: r.body.id };
  }

  // one shared product per run and side, for pickers
  const shared = new Map();
  const sharedProduct = (c) => {
    const k = `${c.side}|${c.tagBase}`;
    if (!shared.has(k))
      shared.set(
        k,
        seedProduct(c, { name: `cat-wk-${c.tagBase}-shared`, sku: `${c.tagBase}-shared` }),
      );
    return shared.get(k);
  };

  async function seedCollection(c, over = {}) {
    const p = over.product || (await sharedProduct(c));
    const name = over.name ?? `cat-wk-${c.tag('c')}`;
    if (c.side === 'wadesk') {
      const r = await c.http('POST', '/catalog/sets', {
        form: {
          name,
          ...(over.description ? { description: over.description } : {}),
          'product_ids[]': p.id,
        },
      });
      if (!r.ok) throw new Error(`reference collection seed failed: ${r.status}`);
      const id = mysql(
        `select id from wa_product_sets where workspace_id=${WS} and name='${q(name)}' order by id desc limit 1`,
      );
      return { name, id, product: p };
    }
    const r = await c.http('POST', '/v2/catalog/collections', {
      headers: idem(),
      data: { name, description: over.description ?? null, productIds: [p.id], isActive: true },
    });
    if (!r.ok) throw new Error(`collection seed failed: ${r.status} ${r.text.slice(0, 120)}`);
    return { name, id: r.body.id, product: p };
  }

  async function seedReview(c, over = {}) {
    const p = over.product || (await sharedProduct(c));
    const who = over.who ?? `cat-wk-${c.tag('r')}`;
    const body = over.body ?? `Review by ${who}`;
    const rating = over.rating ?? 4;
    const status = over.status ?? 'pending';
    if (c.side === 'wadesk')
      mysql(
        `insert into wa_product_reviews (workspace_id,storefront_id,product_id,customer_name,rating,body,status,created_at,updated_at) select ${WS},(select id from wa_storefronts where workspace_id=${WS} limit 1),${p.id},'${q(who)}',${rating},'${q(body)}','${status}',now(),now()`,
      );
    else
      psql(
        `INSERT INTO wa_product_reviews (org_id, product_id, customer_name, rating, body, status) VALUES (${orgOf(c)}, ${p.id.length > 20 ? `(SELECT id FROM wa_products WHERE org_id = ${orgOf(c)} AND uuid = '${q(p.id)}')` : p.id}, '${q(who)}', ${rating}, '${q(body)}', '${status}')`,
      );
    return { who, body, rating, status, product: p };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // readback of what a form stored
  // ---------------------------------------------------------------------------------------------------------------
  const norm = (r) => {
    if (!r) return { found: 'no row' };
    const tags = typeof r.tags === 'string' ? json(r.tags) : r.tags;
    const out = {
      name: r.name,
      sku: r.sku,
      description: r.description,
      body: r.body,
      price: r.price,
      compare: r.compare,
      currency: r.currency,
      stock: r.stock,
      weight: r.weight,
      inStock: r.inStock === true || r.inStock === 1 || r.inStock === '1' ? 'yes' : 'no',
      sort: r.sort,
      status: r.status,
      category: r.category,
      tags: Array.isArray(tags) ? tags.join('|') : '',
      image: r.image,
    };
    for (const k of Object.keys(out)) if (out[k] == null) out[k] = '';
    return out;
  };

  const readProduct = (c, tag) => {
    const t = likeTag(tag);
    if (c.side === 'wadesk')
      return norm(
        json(
          mysql(
            `select json_object('name',name,'sku',sku,'description',description,'body',body_html,'price',price_minor,'compare',compare_price_minor,'currency',currency_code,'stock',stock_qty,'weight',weight_grams,'inStock',in_stock,'sort',sort_order,'status',status,'category',category,'tags',tags_json,'image',image_url) from wa_products where workspace_id=${WS} and deleted_at is null and (name like '%${t}%' or sku like '%${t}%') order by id desc limit 1`,
          ),
        ),
      );
    return norm(
      json(
        psql(
          `select row_to_json(t) from (select name, sku, description, body_html as body, price_minor as price, compare_price_minor as compare, currency_code as currency, stock_qty as stock, weight_grams as weight, in_stock as "inStock", sort_order as sort, status, category, tags_json as tags, image_url as image from wa_products where org_id = ${orgOf(c)} and (name like '%${t}%' or sku like '%${t}%') order by id desc limit 1) t`,
        ),
      ),
    );
  };

  const readCollection = (c, tag) => {
    const t = likeTag(tag);
    let r;
    if (c.side === 'wadesk')
      r = json(
        mysql(
          `select json_object('name',name,'description',description,'products',json_length(product_ids)) from wa_product_sets where workspace_id=${WS} and (name like '%${t}%' or description like '%${t}%') order by id desc limit 1`,
        ),
      );
    else
      r = json(
        psql(
          `select row_to_json(t) from (select name, description, jsonb_array_length(coalesce(product_ids, '[]'::jsonb)) as products from wa_product_sets where org_id = ${orgOf(c)} and (name like '%${t}%' or description like '%${t}%') order by id desc limit 1) t`,
        ),
      );
    if (!r) return { found: 'no row' };
    return {
      name: r.name ?? '',
      description: r.description ?? '',
      products: String(r.products ?? 0),
    };
  };

  const countProducts = (c, tag) => {
    const t = likeTag(tag);
    return Number(
      c.side === 'wadesk'
        ? mysql(
            `select count(*) from wa_products where workspace_id=${WS} and deleted_at is null and (name like '%${t}%' or sku like '%${t}%')`,
          )
        : psql(
            `select count(*) from wa_products where org_id = ${orgOf(c)} and (name like '%${t}%' or sku like '%${t}%')`,
          ),
    );
  };
  const countCollections = (c, tag) => {
    const t = likeTag(tag);
    return Number(
      c.side === 'wadesk'
        ? mysql(
            `select count(*) from wa_product_sets where workspace_id=${WS} and (name like '%${t}%' or description like '%${t}%')`,
          )
        : psql(
            `select count(*) from wa_product_sets where org_id = ${orgOf(c)} and (name like '%${t}%' or description like '%${t}%')`,
          ),
    );
  };

  // ---------------------------------------------------------------------------------------------------------------
  // shared locators
  // ---------------------------------------------------------------------------------------------------------------
  // a list row: the empty-search notice also contains the searched text, so a row must carry its actions
  const rowOf = (c, name) =>
    c.page
      .locator('tbody tr', { hasText: name })
      .filter({ has: c.page.getByRole('button', { name: /share/i }) });
  const searchBox = { placeholder: /search by name or sku/i };
  const none = { css: '#__no-such-element__' };
  const dialogOurs = 'dialog[open]';

  // search the list for a name so the row is on the visible page whatever the data volume
  async function findInList(c, name) {
    await go(c, '/store/products', { ready: 'main' });
    const box = c.loc(searchBox).first();
    await box.fill(name);
    await box.press('Enter');
    await c.afterAction({ quiet: 700 });
    return rowOf(c, name).first();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // product form definition (create and edit share fields)
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
  const productFields = ({ edit = false } = {}) => {
    const F = (id, type, loc, extra = {}) => {
      const f = { id, type, loc, ...extra };
      if (type === 'number' || type === 'integer') f.fill = typeLike(loc);
      return f;
    };
    const lite = edit ? { skipMatrix: true } : {};
    return [
      F(
        'name',
        'name',
        { wadesk: '[name=name]', ours: '#cat-p-name' },
        { required: true, max: 191 },
      ),
      F('sku', 'text', { wadesk: '[name=sku]', ours: '#cat-p-sku' }, { max: 96, ...lite }),
      F(
        'description',
        'textarea',
        { wadesk: '[name=description]', ours: '#cat-p-description' },
        { max: 2000, ...lite },
      ),
      F(
        'body_html',
        'textarea',
        { wadesk: '[name=body_html]', ours: '#cat-p-body' },
        { max: 65535, skipCases: ['very-long', 'max+1'], ...lite },
      ),
      F(
        'image_url',
        'url',
        { wadesk: '[name=image_url]', ours: '#cat-p-image' },
        { max: 1024, ...lite },
      ),
      F(
        'price_major',
        'number',
        { wadesk: '[name=price_major]', ours: '#cat-p-price' },
        { required: true, minValue: 0, maxValue: 1000000 },
      ),
      F(
        'compare_price_major',
        'number',
        { wadesk: '[name=compare_price_major]', ours: '#cat-p-compare' },
        { minValue: 0, maxValue: 1000000 },
      ),
      F(
        'currency_code',
        'select',
        { wadesk: '[name=currency_code]', ours: '#cat-p-currency' },
        { ...lite },
      ),
      F(
        'stock_qty',
        'integer',
        { wadesk: '[name=stock_qty]', ours: '#cat-p-stock' },
        { minValue: 0, maxValue: 1000000 },
      ),
      F(
        'weight_grams',
        'integer',
        { wadesk: '[name=weight_grams]', ours: '#cat-p-weight' },
        { minValue: 0, maxValue: 1000000, ...lite },
      ),
      F(
        'in_stock',
        'checkbox',
        { wadesk: 'input[type=checkbox][name=in_stock]', ours: '#cat-p-instock' },
        { ...lite },
      ),
      F(
        'sort_order',
        'integer',
        { wadesk: '[name=sort_order]', ours: '#cat-p-sort' },
        { minValue: 0, maxValue: 9999, ...lite },
      ),
      F(
        'status',
        'select',
        { wadesk: '[name=status]', ours: { label: /^visibility/i } },
        { ...lite },
      ),
      F(
        'category',
        'text',
        { wadesk: '[name=category]', ours: '#cat-p-category' },
        { max: 96, ...lite },
      ),
      F('tags', 'text', { wadesk: '[name=tags]', ours: '#cat-p-tags' }, { max: 1024, ...lite }),
    ];
  };

  const productRoot = { wadesk: 'form[action*="/store/products"]', ours: 'main form' };
  const productValid = (c) => ({ price_major: '10' });
  const productReadback = {
    wadesk: async (c, { tag }) => readProduct(c, tag || c.tagBase),
    ours: async (c, { tag }) => readProduct(c, tag || c.tagBase),
  };

  // ---------------------------------------------------------------------------------------------------------------
  // forms
  // ---------------------------------------------------------------------------------------------------------------
  const productCreate = {
    id: 'product-create',
    title: 'Add product',
    open: {
      wadesk: async (c) => go(c, '/store/products/create', { ready: 'form' }),
      ours: async (c) => go(c, '/store/products/create', { ready: 'form' }),
    },
    root: productRoot,
    submit: {
      wadesk: { role: 'button', name: /create product/i },
      ours: { role: 'button', name: /create product/i },
    },
    cancel: { wadesk: { role: 'link', name: /cancel/i }, ours: { role: 'link', name: /cancel/i } },
    valid: productValid,
    tagField: ['name', 'sku'],
    fields: productFields(),
    readback: productReadback,
    countAfter: {
      wadesk: async (c, tag) => countProducts(c, tag),
      ours: async (c, tag) => countProducts(c, tag),
    },
  };

  const productEdit = {
    id: 'product-edit',
    title: 'Edit product',
    open: {
      wadesk: async (c) => {
        const p = await seedProduct(c);
        await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      },
      ours: async (c) => {
        const p = await seedProduct(c);
        await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      },
    },
    root: productRoot,
    submit: {
      wadesk: { role: 'button', name: /save changes/i },
      ours: { role: 'button', name: /save changes/i },
    },
    cancel: { wadesk: { role: 'link', name: /cancel/i }, ours: { role: 'link', name: /cancel/i } },
    valid: productValid,
    tagField: ['name', 'sku'],
    fields: productFields({ edit: true }),
    readback: productReadback,
    countAfter: {
      wadesk: async (c, tag) => countProducts(c, tag),
      ours: async (c, tag) => countProducts(c, tag),
    },
  };

  // collections: the picker is a grid of cards; one pseudo field toggles the first card
  const pickFirstCard = async (c, root, on) => {
    const card = c.page
      .locator(root)
      .locator(c.side === 'wadesk' ? '[data-pick-card]' : 'label:has(input[type=checkbox])')
      .filter({ visible: true })
      .first();
    const box = card.locator('input[type=checkbox]').first();
    const now = await box.isChecked().catch(() => false);
    if (now !== !!on) await card.click();
  };
  const collectionOpen = async (c) => {
    await sharedProduct(c);
    await go(c, '/catalog/collections', { ready: 'main' });
    if (c.side === 'wadesk') {
      if (!(await c.visible('form[action$="/catalog/sets"] input[name=name]')))
        await c.click({ text: 'New collection' });
    } else if (!(await c.visible('#cat-col-new-name'))) await c.click({ text: 'New collection' });
    await c.page.waitForTimeout(250);
  };
  const collectionRoot = {
    wadesk: 'form[action$="/catalog/sets"]',
    ours: { css: 'form', has: { css: '#cat-col-new-name' } },
  };
  const collectionCreate = {
    id: 'collection-create',
    title: 'New collection',
    open: { wadesk: collectionOpen, ours: collectionOpen },
    root: collectionRoot,
    submit: {
      wadesk: { role: 'button', name: /create collection/i },
      ours: { role: 'button', name: /create collection/i },
    },
    valid: () => ({ products: true }),
    tagField: ['name', 'description'],
    fields: [
      {
        id: 'name',
        type: 'name',
        required: true,
        max: 120,
        loc: { wadesk: 'input[name=name]', ours: '#cat-col-new-name' },
      },
      {
        id: 'description',
        type: 'text',
        max: 500,
        loc: { wadesk: 'input[name=description]', ours: '#cat-col-new-description' },
      },
      {
        id: 'products',
        type: 'checkbox',
        required: true,
        loc: {
          wadesk: '[data-pick-card] input[type=checkbox]',
          ours: 'label:has(input[type=checkbox]) input[type=checkbox]',
        },
        fill: {
          wadesk: async (c, v) => pickFirstCard(c, 'form[action$="/catalog/sets"]', v),
          ours: async (c, v) => pickFirstCard(c, 'form:has(#cat-col-new-name)', v),
        },
      },
    ],
    readback: {
      wadesk: async (c, { tag }) => readCollection(c, tag || c.tagBase),
      ours: async (c, { tag }) => readCollection(c, tag || c.tagBase),
    },
    countAfter: {
      wadesk: async (c, tag) => countCollections(c, tag),
      ours: async (c, tag) => countCollections(c, tag),
    },
  };

  const shareOpen = async (c) => {
    const p = await seedProduct(c);
    c.product = p;
    const row = await findInList(c, p.name);
    await row.getByRole('button', { name: /share/i }).first().click();
    await c.page.waitForTimeout(500);
  };
  const shareSend = {
    id: 'share-send',
    title: 'Share modal: send to a number',
    open: { wadesk: shareOpen, ours: shareOpen },
    root: { wadesk: '#share-modal', ours: dialogOurs },
    submit: { wadesk: '#share-send-btn', ours: { role: 'button', name: /^send$/i } },
    valid: () => ({ phone: '+14155550123' }),
    tagField: [],
    fields: [
      {
        id: 'phone',
        type: 'phone',
        required: true,
        loc: { wadesk: '#share-send-phone', ours: { placeholder: /whatsapp number/i } },
      },
    ],
  };

  // ---------------------------------------------------------------------------------------------------------------
  // custom scenarios
  // ---------------------------------------------------------------------------------------------------------------
  const scen = [];
  const add = (s) => scen.push({ tags: [], ...s });

  // --- products list --------------------------------------------------------------------------------------------
  add({
    id: 'products.search-hit',
    title: 'Products: search by name finds the product, survives reload and Back',
    tags: ['search'],
    run: async (c) => {
      const p = await seedProduct(c);
      await go(c, '/store/products', { ready: 'main' });
      const box = c.loc(searchBox).first();
      await box.fill(p.name);
      await box.press('Enter');
      await c.afterAction({ quiet: 700 });
      c.obs.flag('hitShown', await rowOf(c, p.name).first().isVisible());
      c.obs.num('hitRows', await c.page.locator('tbody tr').count());
      const url = new URL(c.page.url());
      c.obs.flag(
        'searchInUrl',
        [...url.searchParams.values()].some((v) => v.includes(p.name)),
      );
      await c.page.reload({ waitUntil: 'load' });
      await c.quiet();
      c.obs.flag('hitAfterReload', await rowOf(c, p.name).first().isVisible());
      c.obs.flag(
        'boxKeepsTerm',
        (await c
          .loc(searchBox)
          .first()
          .inputValue()
          .catch(() => '')) === p.name,
      );
      // by SKU too
      await go(c, '/store/products', { ready: 'main' });
      await c.loc(searchBox).first().fill(p.sku);
      await c.loc(searchBox).first().press('Enter');
      await c.afterAction({ quiet: 700 });
      c.obs.flag('hitBySku', await rowOf(c, p.name).first().isVisible());
      // case-insensitive
      await c.loc(searchBox).first().fill(p.name.toUpperCase());
      await c.loc(searchBox).first().press('Enter');
      await c.afterAction({ quiet: 700 });
      c.obs.flag('hitUpperCase', await rowOf(c, p.name).first().isVisible());
      await c.shot('search-hit');
    },
  });
  add({
    id: 'products.row-fields',
    title: 'Products: a row shows name, SKU, price and stock, with Share, Edit and Delete',
    run: async (c) => {
      const p = await seedProduct(c, {
        price: '1299.5',
        extra: { stock_qty: '5', compare_price_major: '1999' },
        ours: { stockQty: 5, comparePriceMajor: '1999' },
      });
      const row = await findInList(c, p.name);
      const text = (await row.innerText()).replace(/\s+/g, ' ');
      c.obs.flag('priceShown', /1,299\.50/.test(text));
      c.obs.flag('skuShown', text.includes(p.sku));
      c.obs.flag('hasShare', (await row.getByRole('button', { name: /share/i }).count()) > 0);
      c.obs.flag('hasEdit', (await row.getByRole('link', { name: /edit/i }).count()) > 0);
      c.obs.flag('hasDelete', (await row.getByRole('button', { name: /delete/i }).count()) > 0);
      c.obs.flag('inStockBadge', /in stock/i.test(text));
      c.obs.info('rowText', text);
      await c.shot('row');
    },
  });
  add({
    id: 'products.empty-search-state',
    title: 'Products: empty list state when nothing matches',
    run: async (c) => {
      await go(c, '/store/products', { ready: 'main' });
      const box = c.loc(searchBox).first();
      await box.fill(`zz-nomatch-${uniq()}`);
      await box.press('Enter');
      await c.afterAction({ quiet: 700 });
      c.obs.num(
        'rows',
        await c.page.locator('tbody tr[class], tbody tr').filter({ hasNotText: /^$/ }).count(),
      );
      const s = await c.snap('empty');
      c.obs.set(
        'abs.emptyStateShown',
        !!s.emptyState || /(no products|no results|nothing)/i.test(s.textSample),
      );
      c.obs.flag(
        'addProductOffered',
        (await c.page.getByRole('link', { name: /add (a )?product/i }).count()) > 0,
      );
    },
  });
  add({
    id: 'products.list-xss',
    title: 'Products: a script-looking name is inert in the list and the delete confirmation',
    tags: ['xss'],
    run: async (c) => {
      const p = await seedProduct(c, {
        name: `cat-wk-${c.tag('x')} <img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`,
      });
      await go(c, '/store/products', { ready: 'main' });
      await c.loc(searchBox).first().fill(c.tagBase);
      await c.loc(searchBox).first().press('Enter');
      await c.afterAction({ quiet: 800 });
      await c.page.waitForTimeout(500);
      c.obs.set(
        'sec.xssExecuted',
        (await c.page.evaluate(() => !!window.__xss).catch(() => false)) ||
          c.rec.events.dialogs.length > 0,
      );
      c.obs.flag(
        'rowRenderedAsText',
        (
          await c.page
            .locator('tbody')
            .innerText()
            .catch(() => '')
        ).includes('<script>'),
      );
      void p;
    },
  });
  add({
    id: 'products.deep-link-back',
    title: 'Products: ?q= deep link, Back from the edit screen keeps the search',
    run: async (c) => {
      const p = await seedProduct(c);
      await go(c, `/store/products?q=${encodeURIComponent(p.name)}`, { ready: 'main' });
      c.obs.flag('deepLinkFilters', await rowOf(c, p.name).first().isVisible());
      c.obs.flag(
        'boxFilled',
        (await c
          .loc(searchBox)
          .first()
          .inputValue()
          .catch(() => '')) === p.name,
      );
      await rowOf(c, p.name).first().getByRole('link', { name: /edit/i }).click();
      await c.afterAction({ quiet: 700 });
      c.obs.flag('editOpened', /\/edit/.test(c.page.url()));
      await c.page.goBack();
      await c.quiet();
      c.obs.flag('backKeepsSearch', await rowOf(c, p.name).first().isVisible());
    },
  });

  // --- product edit --------------------------------------------------------------------------------------------
  add({
    id: 'product-edit.prefill',
    title: 'Product edit: the form is prefilled with what was stored',
    run: async (c) => {
      const p = await seedProduct(c, {
        price: '1299.5',
        extra: {
          description: 'Soft cotton',
          category: 'Apparel',
          tags: 'cotton, summer, cotton',
          stock_qty: '7',
          weight_grams: '250',
          sort_order: '3',
          compare_price_major: '1999',
        },
        ours: {
          description: 'Soft cotton',
          category: 'Apparel',
          tags: ['cotton', 'summer'],
          stockQty: 7,
          weightGrams: 250,
          sortOrder: 3,
          comparePriceMajor: '1999',
        },
      });
      await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      const v = async (spec) =>
        (
          await c
            .loc(spec)
            .first()
            .inputValue()
            .catch(() => '')
        ).trim();
      const f = (ref, ours) => ({ wadesk: ref, ours });
      c.obs.set('map.prefill', {
        nameIsSeeded: (await v(f('[name=name]', '#cat-p-name'))) === p.name ? 'yes' : 'no',
        sku: await v(f('[name=sku]', '#cat-p-sku')),
        description: await v(f('[name=description]', '#cat-p-description')),
        price: Number(await v(f('[name=price_major]', '#cat-p-price'))).toString(),
        compare: Number(await v(f('[name=compare_price_major]', '#cat-p-compare'))).toString(),
        stock: await v(f('[name=stock_qty]', '#cat-p-stock')),
        weight: await v(f('[name=weight_grams]', '#cat-p-weight')),
        sort: await v(f('[name=sort_order]', '#cat-p-sort')),
        category: await v(f('[name=category]', '#cat-p-category')),
        tags: (await v(f('[name=tags]', '#cat-p-tags'))).split(/\s*,\s*/).join('|'),
        inStock: (await c
          .loc(f('input[type=checkbox][name=in_stock]', '#cat-p-instock'))
          .first()
          .isChecked())
          ? 'yes'
          : 'no',
      });
      c.obs.flag('h1IsName', (await c.page.locator('h1').first().innerText()).includes(p.name));
    },
  });
  add({
    id: 'product-edit.unchanged-save',
    title: 'Product edit: saving without changes keeps every stored value and the slug',
    run: async (c) => {
      const p = await seedProduct(c, { price: '49.99' });
      const before = readProduct(c, p.sku);
      const slugOf = () =>
        c.side === 'wadesk'
          ? mysql(`select slug from wa_products where id=${p.id}`)
          : psql(`select slug from wa_products where org_id=${orgOf(c)} and uuid='${q(p.id)}'`);
      const slug0 = slugOf();
      await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      await c.click({ role: 'button', name: /save changes/i });
      await c.afterAction({ quiet: 900 });
      c.obs.flag('leftEditScreen', !/\/edit/.test(c.page.url()));
      c.obs.flag('storedSame', JSON.stringify(readProduct(c, p.sku)) === JSON.stringify(before));
      c.obs.flag('slugSame', slugOf() === slug0);
      await go(c, '/store/products', { ready: 'main' });
    },
  });
  add({
    id: 'product-edit.rename-keeps-slug',
    title: 'Product edit: renaming never changes the slug',
    run: async (c) => {
      const p = await seedProduct(c);
      const slugOf = () =>
        c.side === 'wadesk'
          ? mysql(`select slug from wa_products where id=${p.id}`)
          : psql(`select slug from wa_products where org_id=${orgOf(c)} and uuid='${q(p.id)}'`);
      const s0 = slugOf();
      await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      await c.fill({ wadesk: '[name=name]', ours: '#cat-p-name' }, `${p.name}-renamed`);
      await c.click({ role: 'button', name: /save changes/i });
      await c.afterAction({ quiet: 900 });
      c.obs.flag('slugUnchanged', slugOf() === s0);
      c.obs.flag('renamed', readProduct(c, p.sku).name === `${p.name}-renamed`);
    },
  });
  add({
    id: 'product-edit.compare-zero-clears',
    title: 'Product edit: a compare-at price of 0 or blank clears it',
    run: async (c) => {
      const p = await seedProduct(c, {
        price: '10',
        extra: { compare_price_major: '20' },
        ours: { comparePriceMajor: '20' },
      });
      await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      await c.fill({ wadesk: '[name=compare_price_major]', ours: '#cat-p-compare' }, '0');
      await c.click({ role: 'button', name: /save changes/i });
      await c.afterAction({ quiet: 900 });
      c.obs.enum('compareAfterZero', readProduct(c, p.sku).compare || 'none');
    },
  });
  add({
    id: 'product-edit.tags-normalised',
    title:
      'Product edit: tags are trimmed (invisible characters too), exact repeats and empty parts dropped, case variants kept',
    run: async (c) => {
      const p = await seedProduct(c);
      await go(c, `/store/products/${p.id}/edit`, { ready: 'form' });
      await c.fill(
        { wadesk: '[name=tags]', ours: '#cat-p-tags' },
        ' cotton , summer,Cotton,, cotton, \u200bsummer\u200d, ',
      );
      await c.click({ role: 'button', name: /save changes/i });
      await c.afterAction({ quiet: 900 });
      c.obs.enum('tags', readProduct(c, p.sku).tags);
    },
  });
  add({
    id: 'product-create.price-rounding',
    title: 'Product create: price in minor units (rounding of 1.005, 0.1+0.2 style values)',
    run: async (c) => {
      const out = {};
      for (const [k, v] of [
        ['a', '1299.50'],
        ['b', '0.01'],
        ['c', '19.999'],
        ['d', '1000000'],
      ]) {
        const p = await seedProduct(c, { price: v });
        out[k] = readProduct(c, p.sku).price;
      }
      c.obs.set('map.minorUnits', out);
    },
  });
  add({
    id: 'product-create.slug-unique',
    title: 'Product create: two products with one name get distinct slugs',
    run: async (c) => {
      const name = `cat-wk-${c.tag('same')}-${uniq()}`;
      const a = await seedProduct(c, { name });
      const b = await seedProduct(c, { name });
      const slugOf = (p) =>
        c.side === 'wadesk'
          ? mysql(`select slug from wa_products where id=${p.id}`)
          : psql(`select slug from wa_products where org_id=${orgOf(c)} and uuid='${q(p.id)}'`);
      const sa = slugOf(a);
      const sb = slugOf(b);
      c.obs.flag('slugsDiffer', sa !== sb);
      c.obs.flag('secondHasSuffix', sb === `${sa}-2`);
    },
  });
  add({
    id: 'product-create.gallery-limit',
    title: 'Product create: gallery URLs are limited (12) and de-duplicated',
    run: async (c) => {
      const mk = (n) => Array.from({ length: n }, (_, i) => `https://example.com/g${i}.png`);
      const attempt = async (urls) => {
        const name = `cat-wk-${c.tag('g')}-${uniq()}`;
        if (c.side === 'wadesk') {
          const r = await c.http('POST', '/store/products', {
            form: {
              name,
              price_major: '10',
              currency_code: 'INR',
              in_stock: '1',
              status: 'active',
              ...Object.fromEntries(urls.map((u, i) => [`gallery_urls[${i}]`, u])),
            },
          });
          return r.status >= 500 ? 'crash' : r.status === 422 ? 'rejected' : 'accepted';
        }
        const r = await c.http('POST', '/v2/catalog/products', {
          headers: idem(),
          data: {
            name,
            priceMajor: '10',
            currencyCode: 'INR',
            inStock: true,
            status: 'active',
            tags: [],
            galleryUrls: urls,
          },
        });
        return r.status >= 500 ? 'crash' : r.status >= 400 ? 'rejected' : 'accepted';
      };
      c.obs.enum('twelve', await attempt(mk(12)));
      c.obs.enum('thirteen', await attempt(mk(13)));
      c.obs.enum('duplicatesOfThirteen', await attempt([...mk(12), mk(12)[0]]));
    },
  });
  add({
    id: 'product-create.currency-list',
    title: 'Product create: the currency list and a code outside it',
    run: async (c) => {
      await go(c, '/store/products/create', { ready: 'form' });
      const opts = await c
        .loc({ wadesk: '[name=currency_code]', ours: '#cat-p-currency' })
        .first()
        .evaluate((s) => [...s.options].map((o) => o.value));
      c.obs.list('currencies', opts);
      c.obs.set('map.defaultCurrency', {
        v: await c
          .loc({ wadesk: '[name=currency_code]', ours: '#cat-p-currency' })
          .first()
          .inputValue(),
      });
    },
  });
  add({
    id: 'product-create.live-preview',
    title: 'Product create: the preview and profit indicator react while typing',
    run: async (c) => {
      await go(c, '/store/products/create', { ready: 'form' });
      await c.fill({ wadesk: '[name=name]', ours: '#cat-p-name' }, 'cat-wk preview probe');
      await c.fill({ wadesk: '[name=price_major]', ours: '#cat-p-price' }, '1000');
      await c.fill({ wadesk: '[name=compare_price_major]', ours: '#cat-p-compare' }, '2000');
      await c.page.waitForTimeout(300);
      const body = await c.page.locator('main').innerText();
      c.obs.flag('previewShowsName', body.split('cat-wk preview probe').length > 2);
      c.obs.flag('offBadge', /-50%\s*off/i.test(body));
      await c.fill({ wadesk: '[name=compare_price_major]', ours: '#cat-p-compare' }, '500');
      await c.page.waitForTimeout(300);
      c.obs.flag(
        'lowerCompareWarned',
        /compare\s*<\s*price/i.test(await c.page.locator('main').innerText()),
      );
    },
  });

  // --- collections ---------------------------------------------------------------------------------------------
  const colCard = (c, name) =>
    c.side === 'wadesk'
      ? c.page
          .locator('div.rounded-2xl', { hasText: name })
          .filter({ has: c.page.locator('[data-edit-toggle]') })
          .last()
      : c.page.locator('article', { hasText: name }).first();
  const colButton = (c, card, label) =>
    c.side === 'wadesk'
      ? card
          .locator(
            label === 'Edit'
              ? '[data-edit-toggle]'
              : label === 'Send'
                ? '[data-send-toggle]'
                : 'button',
            label === 'Delete' ? { hasText: 'Delete' } : undefined,
          )
          .first()
      : card.getByRole('button', { name: label, exact: true }).first();
  const openCollections = async (c) => go(c, '/catalog/collections', { ready: 'main' });

  add({
    id: 'collections.edit-save',
    title: 'Collections: edit panel renames, keeps members, saves',
    run: async (c) => {
      const col = await seedCollection(c, { description: c.tag('d') });
      await openCollections(c);
      const card = colCard(c, col.name);
      await colButton(c, card, 'Edit').click();
      await c.page.waitForTimeout(250);
      const nameBox =
        c.side === 'wadesk'
          ? card.locator('[data-edit-panel] input[name=name]')
          : card.locator('input[id^="cat-col-edit-"][id$="-name"]');
      c.obs.flag('prefilledName', (await nameBox.inputValue()) === col.name);
      const checked = await (
        c.side === 'wadesk'
          ? card.locator('[data-edit-panel] input[name="product_ids[]"]:checked')
          : card.locator('ul input[type=checkbox]:checked')
      ).count();
      c.obs.num('membersChecked', checked);
      await nameBox.fill(`${col.name}-edited`);
      await card.getByRole('button', { name: /save changes/i }).click();
      await c.afterAction({ quiet: 900 });
      c.obs.flag(
        'renamedShown',
        await c.page
          .getByText(`${col.name}-edited`)
          .first()
          .isVisible()
          .catch(() => false),
      );
      c.obs.set('map.stored', readCollection(c, col.name));
    },
  });
  add({
    id: 'collections.edit-blank-name',
    title: 'Collections: a blank name on edit is refused and nothing changes',
    run: async (c) => {
      const col = await seedCollection(c);
      await openCollections(c);
      const card = colCard(c, col.name);
      await colButton(c, card, 'Edit').click();
      const nameBox =
        c.side === 'wadesk'
          ? card.locator('[data-edit-panel] input[name=name]')
          : card.locator('input[id^="cat-col-edit-"][id$="-name"]');
      await nameBox.fill('');
      const mark = c.rec.mark();
      await card.getByRole('button', { name: /save changes/i }).click();
      await c.afterAction({ quiet: 700 });
      c.obs.flag('storedUnchanged', readCollection(c, col.name).name === col.name);
      c.obs.num('writes', c.rec.since(mark).http.filter((h) => h.method !== 'GET').length);
    },
  });
  add({
    id: 'collections.edit-unselect-all',
    title: 'Collections: removing every product on edit is refused',
    run: async (c) => {
      const col = await seedCollection(c);
      await openCollections(c);
      const card = colCard(c, col.name);
      await colButton(c, card, 'Edit').click();
      const first =
        c.side === 'wadesk'
          ? card.locator('[data-edit-panel] [data-pick-card]').first()
          : card.locator('ul label').first();
      await first.click();
      await card.getByRole('button', { name: /save changes/i }).click();
      await c.afterAction({ quiet: 900 });
      c.obs.set('map.stored', readCollection(c, col.name));
    },
  });
  add({
    id: 'collections.card',
    title: 'Collections: card shows name, product count and the three actions',
    run: async (c) => {
      const col = await seedCollection(c);
      await openCollections(c);
      const card = colCard(c, col.name);
      const text = (await card.innerText()).replace(/\s+/g, ' ');
      c.obs.flag('countText', /1 product\b/.test(text));
      for (const a of ['Send', 'Edit', 'Delete'])
        c.obs.flag(
          `has${a}`,
          (await card.getByRole('button', { name: a, exact: true }).count()) > 0,
        );
      await c.shot('card');
    },
  });
  add({
    id: 'collections.send-panel-no-sender',
    title: 'Collections: the send panel with no connected sender',
    run: async (c) => {
      const col = await seedCollection(c);
      await openCollections(c);
      const card = colCard(c, col.name);
      await colButton(c, card, 'Send').click();
      await c.page.waitForTimeout(300);
      const text = (await card.innerText()).replace(/\s+/g, ' ');
      c.obs.flag('noSenderNotice', /no connected sender/i.test(text));
      c.obs.flag('hasNumberField', (await card.getByText(/recipient number/i).count()) > 0);
      c.obs.flag('hasHeaderField', (await card.getByText(/header \(optional\)/i).count()) > 0);
      c.obs.flag(
        'sendButton',
        (await card.getByRole('button', { name: /send as mpm/i }).count()) > 0,
      );
      await c.shot('send-panel');
    },
  });
  add({
    id: 'collections.send-no-number',
    title: 'Collections: Send as MPM without a number or a sender',
    run: async (c) => {
      const col = await seedCollection(c);
      await openCollections(c);
      const card = colCard(c, col.name);
      await colButton(c, card, 'Send').click();
      const mark = c.rec.mark();
      await card.getByRole('button', { name: /send as mpm/i }).click();
      await c.afterAction({ quiet: 700 });
      c.obs.num('sendRequests', c.rec.since(mark).http.filter((h) => h.method !== 'GET').length);
      c.obs.flag('feedbackShown', (await card.innerText()).replace(/\s+/g, ' ').length > 0);
    },
  });
  add({
    id: 'collections.list-xss',
    title: 'Collections: a script-looking name and description are inert on the card',
    tags: ['xss'],
    run: async (c) => {
      const col = await seedCollection(c, {
        name: `cat-wk-${c.tag('x')} <img src=x onerror="window.__xss=1">`,
        description: '<script>window.__xss=1</script>',
      });
      await openCollections(c);
      await c.page.waitForTimeout(500);
      c.obs.set(
        'sec.xssExecuted',
        (await c.page.evaluate(() => !!window.__xss).catch(() => false)) ||
          c.rec.events.dialogs.length > 0,
      );
      void col;
    },
  });
  add({
    id: 'collections.empty-state',
    title: 'Collections: empty state text and the create panel',
    run: async (c) => {
      await openCollections(c);
      const s = await c.snap('collections');
      c.obs.flag('createPanelOffered', (await c.page.getByText(/new collection/i).count()) > 0);
      c.obs.set('ui.collections.headings', s.headings.map((x) => x.level).join(','));
    },
  });
  add({
    id: 'collections.picker-filter',
    title: 'Collections: the product picker filters as you type and counts the selection',
    run: async (c) => {
      const p = await sharedProduct(c);
      await collectionOpen(c);
      const root =
        c.side === 'wadesk'
          ? c.page.locator('form[action$="/catalog/sets"]')
          : c.page.locator('form', { has: c.page.locator('#cat-col-new-name') });
      const filter = root.getByPlaceholder(/filter products/i).first();
      await filter.fill(`zz-nomatch-${uniq()}`);
      await c.page.waitForTimeout(300);
      const visibleCards = async () => {
        let n = 0;
        const cards = root.locator(
          c.side === 'wadesk' ? '[data-pick-card]' : 'ul li:has(input[type=checkbox])',
        );
        const total = await cards.count();
        for (let i = 0; i < total; i++) if (await cards.nth(i).isVisible()) n++;
        return n;
      };
      c.obs.num('visibleAfterMiss', await visibleCards());
      await filter.fill(p.name);
      await c.page.waitForTimeout(300);
      c.obs.flag('hitVisible', (await visibleCards()) >= 1);
      await pickFirstCard(
        c,
        c.side === 'wadesk' ? 'form[action$="/catalog/sets"]' : 'form:has(#cat-col-new-name)',
        true,
      );
      c.obs.flag(
        'counterSaysOne',
        /(^|\s)1\/30/.test((await root.innerText()).replace(/\s+/g, ' ')),
      );
    },
  });

  // --- send tab (empty state: no device) -----------------------------------------------------------------------
  add({
    id: 'send.no-device-state',
    title: 'Send tab: with no connected device only the connect card is offered',
    run: async (c) => {
      await go(c, '/catalog/send', { ready: 'main' });
      const text = (await c.page.locator('main').innerText()).replace(/\s+/g, ' ');
      c.obs.flag('connectCard', /connect a device first/i.test(text));
      c.obs.flag(
        'connectButton',
        (await c.page
          .getByRole('link', { name: /connect a device/i })
          .or(c.page.getByRole('button', { name: /connect a device/i }))
          .count()) > 0,
      );
      c.obs.flag(
        'noFormShown',
        (await c.page.locator('main textarea, main input[type=radio]').count()) === 0,
      );
      c.obs.flag(
        'tabsShown',
        (await c.page.getByRole('link', { name: /^collections$/i }).count()) > 0,
      );
      await c.shot('send-empty');
    },
  });
  add({
    id: 'send.connect-button-target',
    title: 'Send tab: the connect button leads to the channel connection screen',
    run: async (c) => {
      await go(c, '/catalog/send', { ready: 'main' });
      const btn = c.page
        .getByRole('link', { name: /connect a device/i })
        .or(c.page.getByRole('button', { name: /connect a device/i }))
        .first();
      await btn.click().catch(() => {});
      await c.afterAction({ quiet: 800 });
      c.obs.flag('leftSendTab', !/\/catalog\/send/.test(c.page.url()));
      c.obs.flag('notCrashed', c.rec.events.pageErrors.length === 0);
    },
  });
  add({
    id: 'send.api-no-sender',
    title: 'Send: an API send with no connected sender is refused, never a crash',
    api: true,
    needsUi: false,
    run: async (c) => {
      const r =
        c.side === 'wadesk'
          ? await c.http('POST', '/catalog/send', {
              form: { recipient_mode: 'manual', numbers: '919810000001', mode: 'catalog_link' },
            })
          : await c.http('POST', '/v2/catalog/send', {
              headers: idem(),
              data: { recipientMode: 'manual', numbers: ['919810000001'], mode: 'catalog_link' },
            });
      c.obs.flag('notCrashed', r.status < 500);
      c.obs.flag(
        'refused',
        r.status >= 400 ||
          (r.status >= 300 && r.status < 400 && !/success/i.test(r.location || '')),
      );
    },
  });

  // --- activity ------------------------------------------------------------------------------------------------
  add({
    id: 'activity.empty-state',
    title: 'Activity: empty log shows the empty state and a way to send',
    run: async (c) => {
      await go(c, '/catalog/activity', { ready: 'main' });
      const text = (await c.page.locator('main').innerText()).replace(/\s+/g, ' ');
      c.obs.flag('noSendsText', /no sends yet/i.test(text));
      c.obs.flag(
        'sendAnotherLink',
        /send another/i.test(text) ||
          (await c.page.getByRole('link', { name: /send/i }).count()) > 0,
      );
      c.obs.flag('headerShown', /catalog send activity/i.test(text));
    },
  });
  add({
    id: 'activity.tab-nav',
    title: 'Activity: the four tabs navigate and mark the current one',
    run: async (c) => {
      await go(c, '/catalog/activity', { ready: 'main' });
      const names = ['Setup', 'Send', 'Collections', 'Activity'];
      const present = [];
      for (const n of names)
        if ((await c.page.getByRole('link', { name: new RegExp(`^${n}`, 'i') }).count()) > 0)
          present.push(n);
      c.obs.list('tabs', present);
      await c.page
        .getByRole('link', { name: /^collections/i })
        .first()
        .click();
      await c.afterAction({ quiet: 700 });
      c.obs.flag('collectionsOpened', /\/catalog\/collections/.test(c.page.url()));
    },
  });

  // --- share modal ---------------------------------------------------------------------------------------------
  add({
    id: 'share.modal-contents',
    title: 'Share modal: product name, two read-only links, copy buttons, send field',
    run: async (c) => {
      await shareOpen(c);
      const root =
        c.side === 'wadesk' ? c.page.locator('#share-modal') : c.page.locator(dialogOurs);
      c.obs.flag('modalVisible', await root.isVisible());
      c.obs.flag('showsName', (await root.innerText()).includes(c.product.name));
      c.obs.num('readonlyLinks', await root.locator('input[readonly]').count());
      c.obs.num('copyButtons', await root.getByRole('button', { name: /copy/i }).count());
      c.obs.flag('sendField', (await root.locator('input[type=tel]').count()) > 0);
      c.obs.flag('closeButton', (await root.getByRole('button', { name: /close/i }).count()) > 0);
      const links = await root
        .locator('input[readonly]')
        .evaluateAll((els) => els.map((e) => e.value));
      c.obs.flag('storefrontLinkHasSlug', /\/s\/|shop|http/i.test(links[0] || ''));
      c.obs.flag(
        'waLinkIsWaMe',
        /wa\.me|whatsapp/i.test(links[1] || '') || /connect a phone/i.test(links[1] || ''),
      );
      await c.shot('share');
    },
  });
  add({
    id: 'share.close-ways',
    title: 'Share modal: Close button, Escape and a click outside close it',
    run: async (c) => {
      const root = () =>
        c.side === 'wadesk' ? c.page.locator('#share-modal') : c.page.locator(dialogOurs);
      await shareOpen(c);
      await root().getByRole('button', { name: /close/i }).first().click();
      await c.page.waitForTimeout(300);
      c.obs.flag(
        'closeButtonCloses',
        !(await root()
          .isVisible()
          .catch(() => false)),
      );
      await shareOpen(c);
      await c.page.keyboard.press('Escape');
      await c.page.waitForTimeout(300);
      c.obs.flag(
        'escapeCloses',
        !(await root()
          .isVisible()
          .catch(() => false)),
      );
      await shareOpen(c);
      await c.page.mouse.click(5, 5);
      await c.page.waitForTimeout(300);
      c.obs.flag(
        'backdropCloses',
        !(await root()
          .isVisible()
          .catch(() => false)),
      );
    },
  });
  add({
    id: 'share.focus-and-keyboard',
    title: 'Share modal: focus moves into the dialog and the send field takes Enter',
    run: async (c) => {
      await shareOpen(c);
      const inside = await c.page.evaluate(() => {
        const a = document.activeElement;
        return !!a && !!a.closest('#share-modal, dialog');
      });
      c.obs.set('abs.focusInsideOnOpen', inside);
      const phone = c
        .loc({ wadesk: '#share-send-phone', ours: { placeholder: /whatsapp number/i } })
        .first();
      await phone.fill('+14155550123');
      const mark = c.rec.mark();
      await phone.press('Enter');
      await c.afterAction({ quiet: 800 });
      c.obs.flag(
        'enterSends',
        c.rec.since(mark).http.some((h) => h.method !== 'GET'),
      );
    },
  });
  add({
    id: 'share.copy-without-link',
    title: 'Share modal: copy buttons when a link is missing',
    run: async (c) => {
      await shareOpen(c);
      const root =
        c.side === 'wadesk' ? c.page.locator('#share-modal') : c.page.locator(dialogOurs);
      const copy = root.getByRole('button', { name: /copy/i }).first();
      c.obs.flag('copyEnabled', await copy.isEnabled().catch(() => false));
      c.obs.set(
        'sec.pageErrorsOnCopy',
        await (async () => {
          const mark = c.rec.mark();
          await copy.click().catch(() => {});
          await c.page.waitForTimeout(300);
          return c.rec.since(mark).pageErrors.length > 0;
        })(),
      );
    },
  });

  // --- reviews -------------------------------------------------------------------------------------------------
  const reviewCard = (c, who) =>
    c.side === 'wadesk'
      ? c.page
          .locator('div', { hasText: who })
          .filter({ has: c.page.getByRole('button', { name: /delete/i }) })
          .last()
      : c.page.locator('article', { hasText: who }).first();
  const tabLink = (c, label) =>
    c.page.getByRole('link', { name: new RegExp(`^${label}`, 'i') }).first();
  add({
    id: 'reviews.empty-state',
    title: 'Reviews: the three tabs with counts and the empty text',
    run: async (c) => {
      await go(c, '/store/reviews?status=rejected', { ready: 'main' });
      const text = (await c.page.locator('main').innerText()).replace(/\s+/g, ' ');
      c.obs.flag('emptyRejected', /no rejected reviews/i.test(text));
      for (const t of ['Pending', 'Approved', 'Rejected'])
        c.obs.flag(`tab${t}`, (await tabLink(c, t).count()) > 0);
    },
  });
  add({
    id: 'reviews.unknown-status',
    title: 'Reviews: an unknown status falls back to the pending tab',
    run: async (c) => {
      const r = await seedReview(c, { status: 'pending' });
      await go(c, '/store/reviews?status=bogus', { ready: 'main' });
      c.obs.flag(
        'pendingShown',
        await c.page
          .getByText(r.who)
          .first()
          .isVisible()
          .catch(() => false),
      );
    },
  });
  add({
    id: 'reviews.moderation-flow',
    title: 'Reviews: approve, reject, delete with the right buttons per tab and updated counts',
    run: async (c) => {
      const a = await seedReview(c, { rating: 4 });
      const b = await seedReview(c, { rating: 2 });
      await go(c, '/store/reviews', { ready: 'main' });
      const count = async (t) => ((await tabLink(c, t).innerText()).match(/\d+/) || ['0'])[0];
      const before = {
        pending: Number(await count('Pending')),
        approved: Number(await count('Approved')),
      };
      c.obs.flag('pendingHasA', await c.page.getByText(a.who).first().isVisible());
      let card = reviewCard(c, a.who);
      c.obs.flag(
        'pendingHasApprove',
        (await card.getByRole('button', { name: /approve/i }).count()) > 0,
      );
      c.obs.flag(
        'pendingHasReject',
        (await card.getByRole('button', { name: /reject/i }).count()) > 0,
      );
      await card
        .getByRole('button', { name: /approve/i })
        .first()
        .click();
      await c.afterAction({ quiet: 900 });
      c.obs.flag(
        'aLeftPending',
        !(await c.page
          .getByText(a.who)
          .first()
          .isVisible()
          .catch(() => false)),
      );
      c.obs.num('pendingDropped', before.pending - Number(await count('Pending')));
      c.obs.num('approvedGrew', Number(await count('Approved')) - before.approved);
      await tabLink(c, 'Approved').click();
      await c.afterAction({ quiet: 800 });
      card = reviewCard(c, a.who);
      c.obs.flag('approvedHasA', await card.isVisible().catch(() => false));
      c.obs.flag(
        'approvedNoApprove',
        (await card.getByRole('button', { name: /approve/i }).count()) === 0,
      );
      c.obs.flag(
        'approvedHasReject',
        (await card.getByRole('button', { name: /reject/i }).count()) > 0,
      );
      await tabLink(c, 'Pending').click();
      await c.afterAction({ quiet: 800 });
      card = reviewCard(c, b.who);
      await card
        .getByRole('button', { name: /reject/i })
        .first()
        .click();
      await c.afterAction({ quiet: 900 });
      await tabLink(c, 'Rejected').click();
      await c.afterAction({ quiet: 800 });
      card = reviewCard(c, b.who);
      c.obs.flag('rejectedHasB', await card.isVisible().catch(() => false));
      c.obs.flag(
        'rejectedNoReject',
        (await card.getByRole('button', { name: /reject/i }).count()) === 0,
      );
      c.obs.flag(
        'rejectedHasApprove',
        (await card.getByRole('button', { name: /approve/i }).count()) > 0,
      );
      c.obs.flag('flashShown', true);
      await c.shot('moderation');
    },
  });
  add({
    id: 'reviews.card-contents',
    title: 'Reviews: card shows stars, customer, product and body; anonymous when no name',
    run: async (c) => {
      const named = await seedReview(c, { rating: 3, body: 'Decent value' });
      await go(c, '/store/reviews', { ready: 'main' });
      const card = reviewCard(c, named.who);
      const text = (await card.innerText()).replace(/\s+/g, ' ');
      c.obs.flag('bodyShown', text.includes('Decent value'));
      c.obs.flag('productNamed', text.includes(named.product.name));
      const filled = await card
        .locator(
          'svg[class*="amber"], svg[class*="warning"], [data-star="on"], [class*="star"][class*="on"]',
        )
        .count();
      c.obs.num('starsOn', filled);
      c.obs.info('cardText', text);
      await c.shot('card');
    },
  });
  add({
    id: 'reviews.xss',
    title: 'Reviews: script in the customer name and body is inert',
    tags: ['xss'],
    run: async (c) => {
      await seedReview(c, {
        who: `cat-wk-${c.tag('x')} <img src=x onerror="window.__xss=1">`,
        body: '<script>window.__xss=1</script>',
      });
      await go(c, '/store/reviews', { ready: 'main' });
      await c.page.waitForTimeout(500);
      c.obs.set(
        'sec.xssExecuted',
        (await c.page.evaluate(() => !!window.__xss).catch(() => false)) ||
          c.rec.events.dialogs.length > 0,
      );
    },
  });

  // --- access and robustness ----------------------------------------------------------------------------------
  add({
    id: 'access.anonymous-writes',
    title: 'Access: unauthenticated writes to products, collections and reviews are refused',
    api: true,
    needsUi: false,
    loggedIn: false,
    run: async (c) => {
      const probe = async (method, ref, ours, body) => {
        const r = await c.http(method, c.side === 'wadesk' ? ref : ours, {
          anonymous: true,
          ...(c.side === 'wadesk' ? { form: body } : { data: body, headers: idem() }),
        });
        return r.status >= 200 && r.status < 300 ? 'allowed' : 'denied';
      };
      c.obs.enum(
        'createProduct',
        await probe('POST', '/store/products', '/v2/catalog/products', {
          name: 'cat-wk-anon',
          price_major: '1',
        }),
      );
      c.obs.enum(
        'createCollection',
        await probe('POST', '/catalog/sets', '/v2/catalog/collections', { name: 'cat-wk-anon' }),
      );
      c.obs.enum(
        'deleteProduct',
        await probe(
          'DELETE',
          '/store/products/1',
          '/v2/catalog/products/00000000-0000-4000-8000-000000000001',
        ),
      );
      c.obs.enum(
        'moderateReview',
        await probe(
          'PUT',
          '/store/reviews/1',
          '/v2/catalog/reviews/00000000-0000-4000-8000-000000000001',
          { status: 'approved' },
        ),
      );
    },
  });
  add({
    id: 'access.unknown-ids',
    title: 'Access: an unknown product or collection id is a clean not-found, never a crash',
    api: true,
    needsUi: false,
    run: async (c) => {
      const ghost = c.side === 'wadesk' ? '999999991' : '00000000-0000-4000-8000-0000000000aa';
      const paths =
        c.side === 'wadesk'
          ? [
              ['GET', `/store/products/${ghost}/edit`],
              ['DELETE', `/store/products/${ghost}`],
              ['PUT', `/store/reviews/${ghost}`],
            ]
          : [
              ['GET', `/v2/catalog/products/${ghost}`],
              ['DELETE', `/v2/catalog/products/${ghost}`],
              ['PUT', `/v2/catalog/reviews/${ghost}`],
            ];
      const out = [];
      for (const [m, p] of paths) {
        const r = await c.http(m, p, {
          ...(m === 'PUT'
            ? c.side === 'wadesk'
              ? { form: { status: 'approved' } }
              : { data: { status: 'approved' }, headers: idem() }
            : m === 'DELETE' && c.side !== 'wadesk'
              ? { headers: idem() }
              : {}),
        });
        out.push(
          r.status >= 500
            ? 'crash'
            : r.status === 404
              ? 'not-found'
              : r.status >= 200 && r.status < 400
                ? 'ok'
                : 'rejected',
        );
      }
      c.obs.seq('statuses', out);
    },
  });
  add({
    id: 'product-edit.unknown-id-screen',
    title: 'Product edit screen with an unknown id shows not-found',
    run: async (c) => {
      const ghost = c.side === 'wadesk' ? '999999991' : '00000000-0000-4000-8000-0000000000aa';
      const resp = await c.page.goto(c.url(`/store/products/${ghost}/edit`), { waitUntil: 'load' });
      await c.quiet();
      c.obs.set(
        'status.load',
        resp
          ? resp.status() === 404
            ? 'not-found'
            : resp.status() < 400
              ? 'ok'
              : 'other'
          : 'none',
      );
      c.obs.flag('formShown', (await c.page.locator('main form').count()) > 0);
    },
  });
  add({
    id: 'layout.rtl',
    title: 'Layout: RTL document direction does not overflow on the catalog screens',
    run: async (c) => {
      const out = {};
      for (const path of [
        '/store/products',
        '/catalog/collections',
        '/store/products/create',
        '/store/reviews',
      ]) {
        await go(c, path, { ready: 'main' });
        await c.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
        await c.page.waitForTimeout(250);
        out[path] = await c.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      }
      c.obs.set('low.overflowX.rtl', Math.max(0, ...Object.values(out)));
      c.obs.info('overflowByPath', out);
    },
  });
  add({
    id: 'layout.zoom-and-mobile-form',
    title: 'Layout: product form at 390 px and at 200 percent zoom keeps every field usable',
    run: async (c) => {
      const extra = await c.openAlso({ viewport: { width: 390, height: 844 } });
      const page = extra.page;
      await page.goto(c.url('/store/products/create'), { waitUntil: 'load' });
      await c.quiet();
      c.obs.set(
        'low.overflowX.mobileForm',
        await page.evaluate(() =>
          Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        ),
      );
      const submit = page.getByRole('button', { name: /create product/i }).first();
      await submit.scrollIntoViewIfNeeded().catch(() => {});
      c.obs.flag('submitReachableOnPhone', await submit.isVisible().catch(() => false));
      const zoomed = await c.openAlso({ viewport: { width: 683, height: 450 } });
      await zoomed.page.goto(c.url('/store/products'), { waitUntil: 'load' });
      await c.quiet();
      c.obs.set(
        'low.overflowX.zoom200',
        await zoomed.page.evaluate(() =>
          Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        ),
      );
    },
  });
  add({
    id: 'layout.dark-mode-contrast',
    title: 'Layout: dark colour scheme renders the products list without losing the text',
    run: async (c) => {
      await c.page.emulateMedia({ colorScheme: 'dark' });
      await go(c, '/store/products', { ready: 'main' });
      const ratio = await c.page.evaluate(() => {
        const el = document.querySelector('main h1') || document.body;
        const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const fg = parse(getComputedStyle(el).color);
        let node = el;
        let bg = [0, 0, 0, 0];
        while (node && (!bg[3] && bg[3] !== undefined ? false : bg[3] === 0)) {
          bg = parse(getComputedStyle(node).backgroundColor);
          if (bg.length === 3) bg.push(1);
          node = node.parentElement;
        }
        const lum = ([r, g, b]) => {
          const f = (v) =>
            v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const a = lum(fg);
        const b = lum(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      c.obs.set('abs.headingContrastDark', ratio >= 3);
    },
  });
  add({
    id: 'keyboard.create-form-tab-to-submit',
    title:
      'Keyboard: Tab reaches the submit button of the product form and Enter in the name field submits',
    run: async (c) => {
      await go(c, '/store/products/create', { ready: 'form' });
      let reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await c.page.keyboard.press('Tab');
        reached = await c.page.evaluate(() =>
          /create product/i.test(document.activeElement?.textContent || ''),
        );
      }
      c.obs.set('abs.submitReachableByTab', reached);
    },
  });

  // --- rules checked through the screen, by what ends up stored (the reference shows server errors in a red list the
  //     harness's form detector does not recognise, so the generated matrix cannot tell "refused" from "accepted" there) ---
  const RULE_CASES = [
    ['price-over', { price_major: '1000001' }],
    ['price-max', { price_major: '1000000' }],
    ['price-exp', { price_major: '1e3' }],
    ['price-three-decimals', { price_major: '19.999' }],
    ['price-negative', { price_major: '-1' }],
    ['price-dot-five', { price_major: '.5' }],
    ['compare-over', { compare_price_major: '1000001' }],
    ['compare-exp', { compare_price_major: '1e3' }],
    ['stock-leading-zero', { stock_qty: '007' }],
    ['stock-exp', { stock_qty: '1e3' }],
    ['stock-negative', { stock_qty: '-1' }],
    ['stock-max', { stock_qty: '1000000' }],
    ['stock-over', { stock_qty: '1000001' }],
    ['weight-over', { weight_grams: '1000001' }],
    ['sort-over', { sort_order: '10000' }],
    ['name-spaces', { name: '   ' }],
    ['name-zero-width-only', { name: '\u200b\u200d' }],
    ['name-192', { name: 'n'.repeat(192) }],
    ['sku-97', { sku: 's'.repeat(97) }],
    ['category-97', { category: 'k'.repeat(97) }],
    ['tags-1025', { tags: 't'.repeat(1025) }],
    ['tags-one-long-tag', { tags: 't'.repeat(200) }],
    ['description-2001', { description: 'd'.repeat(2001) }],
    ['image-javascript', { image_url: 'javascript:alert(1)' }],
    ['image-no-scheme', { image_url: 'example.com' }],
  ];
  RULE_CASES.reduce((chunks, rule, i) => {
    (chunks[Math.floor(i / 5)] ||= []).push(rule);
    return chunks;
  }, []).forEach((rules, n) =>
    add({
      id: `product-create.server-rules-${n + 1}`,
      title: `Product create: which values are refused and which are stored (${rules.map(([id]) => id).join(', ')})`,
      run: async (c) => {
        const out = {};
        for (const [id, over] of rules) {
          await go(c, '/store/products/create', { ready: 'form' });
          const tag = c.tag('sr');
          const vals = { name: tag, price_major: '10', ...over };
          if (!('sku' in over) && 'name' in over) vals.sku = tag;
          const fields = Object.fromEntries(productFields().map((f) => [f.id, f]));
          for (const [k, v] of Object.entries(vals)) {
            const f = fields[k];
            if (f.fill) await f.fill(c, v);
            else await c.loc(f.loc).first().fill(String(v));
          }
          await c.click({ role: 'button', name: /create product/i });
          await c.page.waitForTimeout(1500);
          const n = countProducts(c, tag);
          const row = n ? readProduct(c, tag) : null;
          out[id] = n
            ? `stored price=${row.price} compare=${row.compare} stock=${row.stock}`
            : 'refused';
        }
        c.obs.set('map.rules', out);
      },
    }),
  );
  add({
    id: 'share.phone-rules',
    title: 'Share modal: which numbers reach the server and which are stopped in the browser',
    run: async (c) => {
      await shareOpen(c);
      const phone = c
        .loc({ wadesk: '#share-send-phone', ours: { placeholder: /whatsapp number/i } })
        .first();
      const send = c
        .loc({ wadesk: '#share-send-btn', ours: { role: 'button', name: /^send$/i } })
        .first();
      const message =
        c.side === 'wadesk'
          ? c.page.locator('#share-send-msg')
          : c.page.locator(dialogOurs).locator('p[role=alert], p[role=status]');
      const CASES = {
        empty: '',
        letters: 'abc',
        five: '12345',
        six: '123456',
        seven: '1234567',
        e164: '+14155550123',
        spaces: '+1 415 555 0123',
        dashes: '415-555-0123',
        arabic: '+٩١٩٨٧٦٥٤٣٢١٠',
        long: `+${'1'.repeat(40)}`,
        plus: '+',
        padded: '  +14155550123  ',
      };
      const out = {};
      for (const [k, v] of Object.entries(CASES)) {
        await phone.fill(v);
        const mark = c.rec.mark();
        await send.click();
        await c.page.waitForTimeout(1000);
        const sent = c.rec
          .since(mark)
          .http.filter((h) => h.method !== 'GET' && !/realtime/.test(h.path)).length;
        const said =
          (
            (await message
              .first()
              .innerText()
              .catch(() => '')) || ''
          ).trim().length > 0;
        out[k] = `${sent ? 'sent' : 'blocked'}/${said ? 'message' : 'silent'}`;
      }
      c.obs.set('map.phoneRules', out);
    },
  });

  // --- stock and money edge through the screens -----------------------------------------------------------------
  add({
    id: 'product-create.stock-zero-in-stock',
    title: 'Product create: stock 0 with Available checked stays in stock in the list',
    run: async (c) => {
      const p = await seedProduct(c, { extra: { stock_qty: '0' }, ours: { stockQty: 0 } });
      const row = await findInList(c, p.name);
      const text = (await row.innerText()).replace(/\s+/g, ' ');
      c.obs.flag('badgeInStock', /in stock/i.test(text));
      c.obs.flag('badgeOut', /\bout\b/i.test(text));
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  return {
    feature: 'WD-CAT-019',
    title:
      'Catalog and products screens (Send, Collections, Activity, Products, form, delete, share, Reviews)',
    domain: 'catalog-products',
    pages: [
      { id: 'catalog-send', title: 'Send tab', path: '/catalog/send', ready: 'main' },
      {
        id: 'catalog-collections',
        title: 'Collections tab',
        path: '/catalog/collections',
        ready: 'main',
      },
      { id: 'catalog-activity', title: 'Activity tab', path: '/catalog/activity', ready: 'main' },
      { id: 'products-page', title: 'Products list', path: '/store/products', ready: 'main' },
      {
        id: 'product-create-page',
        title: 'Product create screen',
        path: '/store/products/create',
        ready: 'main',
      },
      { id: 'reviews-page', title: 'Reviews queue', path: '/store/reviews', ready: 'main' },
    ],
    forms: [productCreate, productEdit, collectionCreate, shareSend],
    lists: [
      {
        id: 'products-list',
        title: 'Products',
        page: '/store/products',
        ready: 'main',
        rows: 'tbody tr',
        search: { input: searchBox, submit: 'enter' },
      },
    ],
    deletes: [
      {
        id: 'product-delete',
        title: 'Delete product',
        page: '/store/products',
        ready: 'main',
        seed: async (c) => seedProduct(c),
        row: (made, c) => rowOf(c, made.name ?? '__none__'),
        start: async (c, _row, made) => {
          const row = await findInList(c, made.name);
          await row
            .getByRole('button', { name: /delete/i })
            .first()
            .click();
        },
        confirm: { wadesk: none, ours: { css: `${dialogOurs} button`, nth: 'last' } },
        cancel: { wadesk: none, ours: { css: `${dialogOurs} button`, nth: 0 } },
      },
      {
        id: 'collection-delete',
        title: 'Delete collection',
        page: '/catalog/collections',
        ready: 'main',
        seed: async (c) => seedCollection(c),
        row: (made, c) => colCard(c, made.name ?? '__none__'),
        start: async (c, _row, made) => {
          const card = colCard(c, made.name);
          await colButton(c, card, 'Delete').click();
        },
        confirm: { wadesk: none, ours: { css: `${dialogOurs} button`, nth: 'last' } },
        cancel: { wadesk: none, ours: { css: `${dialogOurs} button`, nth: 0 } },
      },
      {
        id: 'review-delete',
        title: 'Delete review',
        page: '/store/reviews',
        ready: 'main',
        seed: async (c) => seedReview(c),
        row: (made, c) => reviewCard(c, made.who ?? '__none__'),
        start: async (c, _row, made) => {
          await reviewCard(c, made.who)
            .getByRole('button', { name: /delete/i })
            .first()
            .click();
        },
        confirm: { wadesk: none, ours: { css: `${dialogOurs} button`, nth: 'last' } },
        cancel: { wadesk: none, ours: { css: `${dialogOurs} button`, nth: 0 } },
      },
    ],
    scenarios: scen,
    intended: [
      {
        // verified one by one: the reference answers with a re-rendered page and a red error list (or a collapsed panel) that the
        // harness cannot read as a refusal; its stored row is "none" in each of these, and ours stores nothing either
        scenario:
          /^(collection-create\.(name\.spaces|products\.off|products\.required)|product-create\.(compare_price_major\.(huge|max\+1)|image_url\.(data-uri|javascript|spaces)|name\.spaces|price_major\.(huge|max\+1)|sort_order\.(exp|leading-zeros)|stock_qty\.(exp|leading-zeros)|weight_grams\.(exp|leading-zeros))|product-edit\.(compare_price_major\.(huge|max\+1)|name\.spaces|price_major\.(huge|max\+1)|stock_qty\.(exp|leading-zeros)))$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|num\.submitRequests|abs\.focusQuality|flag\.valueKept)$/,
        quirk:
          'WaDesk shows server-side refusals in a red list the harness form detector cannot recognise',
        reason:
          'Both sides refuse the value and store nothing (the reference readback is "no row", ours blocks in the browser or answers 422). The harness reads the reference as accepted because its refusal is a re-rendered page with a plain red list; the refusals are compared explicitly by product-create.server-rules-N (stored or refused per value).',
      },
      {
        scenario: /^(product-create|product-edit|collection-create)\.[a-z_]+\.null-byte$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|num\.submitRequests|abs\.focusQuality|flag\.valueKept)$/,
        quirk: 'WaDesk stores a NUL character typed into a text field',
        reason:
          'PostgreSQL text cannot hold U+0000, so ours refuses the value (a flagged field) where the reference stores it. Deliberate: a NUL in a name or description is never intended.',
      },
      {
        scenario: /^product-create\.name\.(max\+1|very-long)$/,
        key: /^(enum\.outcome|flag\.accepted|status\.submit)$/,
        quirk: 'WaDesk answers HTTP 500 when two 191-character product names collide on the slug',
        reason:
          'The slug column is 191 characters, so the reference cannot append "-2" to a slug that long and the save fails with a database error (verified: the second product with the same 191-character name gets 500). Ours truncates the slug before the suffix and saves.',
      },
      {
        scenario: /^product-create\.sort_order\.(empty|text)$/,
        key: /^(enum\.outcome|flag\.accepted|status\.submit)$/,
        quirk: 'WaDesk answers HTTP 500 for an empty sort order',
        reason:
          'An empty sort-order box reaches the reference as NULL for a NOT NULL column and the save fails with a database error (verified; a form that omits the field saves). Ours treats a blank sort order as 0.',
      },
      {
        scenario: /^product-create\.image_url\.ftp$/,
        key: /^(enum\.outcome|flag\.accepted|map\.stored|set\.flaggedFields|status\.submit|num\.submitRequests|abs\.focusQuality|flag\.valueKept)$/,
        quirk: "WaDesk's url rule lets ftp:// image links through",
        reason:
          'An image link is fetched by Meta and WhatsApp over the web; ours accepts only http and https and refuses ftp:// (the reference stores it and the later push fails). Deliberate, stricter than the reference.',
      },
      {
        scenario: /^product-create\.(description|body_html)\.newline$/,
        key: 'map.stored',
        quirk: 'a native form post turns every line break of a textarea into CRLF',
        reason:
          'The reference posts a browser form, which normalises line breaks to \\r\\n; ours sends JSON and keeps \\n. Same text, different line-break byte.',
      },
      {
        scenario: /^collection-create\.all-empty$/,
        key: 'set.flaggedFields',
        reason:
          'On an empty submit ours flags every problem at once (name and products) and puts focus on the first; the reference browser stops at the required name box and leaves the product rule to the server.',
      },
      {
        scenario: /^(product-create|product-edit|collection-create|share-send)\.session-expired$/,
        key: 'enum.sessionExpiry',
        reason:
          "When the session is gone the shared API client of the web app shows the error and keeps what was typed (only an idle timeout redirects to sign-in, WD-AUTH-033); the reference redirects (forms) or stays silent (share modal). Owned by the auth domain's client, not by the catalog screens.",
      },
      {
        scenario:
          /^(catalog-activity|catalog-collections|catalog-send|product-create-page|products-page|reviews-page)\.keyboard$/,
        key: 'abs.keyboard.focusVisible',
        reason:
          'After the last real stop, Tab lands on the Next.js development-tools portal element, which has no focus ring; that element exists only under `next dev` and is absent from a production build (every real stop shows focus).',
      },
      {
        scenario: /^product-edit\.unknown-id-screen$/,
        key: 'status.load',
        reason:
          'The edit screen is rendered in the browser from the API: the shell answers 200 and the screen shows a not-found state (the product request answers 404). The reference renders on the server and answers 404 for the page itself.',
      },
      {
        scenario: /^send\.connect-button-target$/,
        key: 'flag.leftSendTab',
        reason:
          'The reference opens an in-page sheet that frames its device connect screen; the web app has no such sheet yet (it belongs to the channels/devices screens), so the button links to the channels screen. Recorded as blocked on that owner, not built in this domain.',
      },
      {
        scenario: /^share\.close-ways$/,
        key: 'flag.escapeCloses',
        reason:
          'Ours closes the share dialog on Escape (native dialog behaviour, keyboard accessibility); the reference ignores Escape.',
      },
      {
        scenario: /^share\.copy-without-link$/,
        key: 'flag.copyEnabled',
        quirk: 'the reference copy button copies the placeholder text when there is no link',
        reason:
          'Documented WaDesk bug (difference 21 of the parity notes): with no link the Copy button is disabled in ours instead of copying the placeholder sentence.',
      },
      {
        scenario: /^share\.modal-contents$/,
        key: 'flag.storefrontLinkHasSlug',
        reason:
          'The storefront link needs the storefront slug, which belongs to the STORE domain and is not ported yet (WD-CAT-036); ours says to set the storefront up first where the reference shows its shop URL.',
      },
      {
        scenario: /^share-send\./,
        key: /^(enum\.outcome|set\.flaggedFields|status\.submit)$/,
        quirk:
          'the reference shows its send message in a coral line the harness colour test does not count',
        reason:
          'Both modals stop an invalid number in the browser with a line of text under the field and send nothing for it, and send valid numbers to the server; the reference line is coral (232,122,93), just outside the harness red test (green channel at most 120), so its refusals read as "no request". Compared explicitly by share.phone-rules (request sent or blocked, message shown, per number).',
      },
    ],
    teardown: {
      wadesk: async (c) => {
        const t = likeTag(c.tagBase);
        mysql(
          `delete from wa_product_reviews where workspace_id=${WS} and (customer_name like '%${t}%' or body like '%${t}%' or product_id in (select id from wa_products where workspace_id=${WS} and (name like '%${t}%' or sku like '%${t}%')))`,
        );
        mysql(
          `delete from wa_product_sets where workspace_id=${WS} and (name like '%${t}%' or description like '%${t}%')`,
        );
        mysql(
          `delete from wa_products where workspace_id=${WS} and (name like '%${t}%' or sku like '%${t}%')`,
        );
      },
      ours: async (c) => {
        const t = likeTag(c.tagBase);
        const o = orgOf(c);
        psql(
          `delete from wa_product_reviews where org_id=${o} and (customer_name like '%${t}%' or body like '%${t}%')`,
        );
        psql(
          `delete from wa_product_sets where org_id=${o} and (name like '%${t}%' or description like '%${t}%')`,
        );
        psql(
          `delete from wa_products where org_id=${o} and (name like '%${t}%' or sku like '%${t}%')`,
        );
      },
    },
  };
};
