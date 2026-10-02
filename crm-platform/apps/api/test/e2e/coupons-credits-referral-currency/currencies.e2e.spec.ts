import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  currencyItemSchema,
  currencyListResponseSchema,
  ERROR_CODES,
  workspaceCurrencyResponseSchema,
} from '@crm/contracts';
import { OpenErApiProvider } from '../../../src/infra/providers/coupons-credits-referral-currency';
import { SettingsService } from '../../../src/modules/platform-settings-branding-storage';
import {
  as,
  cleanCpn,
  newTenant,
  ops,
  setting,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/** The currency catalog (TW-CPN-018..024, 027) through HTTP, against the real database and the real AppModule. */
let h: BspHarness;
let owner: Tenant;
let savedDefault: unknown;
let savedCatalog: Array<Record<string, unknown>> = [];

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Swiss Franc',
  code: 'chf',
  symbol: 'CHF',
  precision: 2,
  exchangeRate: '0.88',
  isActive: true,
  ...over,
});
const create = async (over: Record<string, unknown> = {}) => {
  const res = await ops(h, 'post', '/currencies').send(body(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return currencyItemSchema.parse(res.body);
};
const list = async (qs = '') =>
  currencyListResponseSchema.parse((await ops(h, 'get', `/currencies${qs}`)).body);
const defaultCode = async () =>
  ((await h.app.get(SettingsService).values('general')).defaultCurrency as string).toUpperCase();

beforeAll(async () => {
  h = await startBspHarness();
  owner = await newTenant(h, 'cur');
  // Arrange a known catalog: the tests own the currencies table for their duration and put it back afterwards.
  savedCatalog = (await h.owner.query(`SELECT * FROM currencies`)).rows;
  savedDefault = (
    await h.owner.query(`SELECT value FROM platform_settings WHERE key = 'set.general'`)
  ).rows[0]?.value;
  await h.owner.query(`TRUNCATE currencies`);
  await h.owner.query(
    `INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active) VALUES
       ('US Dollar','USD','$',2,1,true), ('Indian Rupee','INR','₹',2,83.25,true), ('Indonesian Rupiah','IDR','Rp',0,15700,true),
       ('Pakistani Rupee','PKR','Rs',2,278,true), ('Euro','EUR','€',2,0.92,true), ('Thai Baht','THB','฿',2,36.2,false)`,
  );
  await setting(h, 'set.general', { appName: 'CPN', defaultCurrency: 'USD', _rv: 1 });
}, 120_000);

afterAll(async () => {
  await cleanCpn(h);
  await h.owner.query(`TRUNCATE currencies`);
  for (const r of savedCatalog) {
    await h.owner.query(
      `INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.name, r.code, r.symbol, r.precision, r.exchange_rate, r.is_active],
    );
  }
  if (savedDefault === undefined) {
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'set.general'`);
  } else {
    await h.owner.query(
      `UPDATE platform_settings SET value = $1::jsonb WHERE key = 'set.general'`,
      [JSON.stringify(savedDefault)],
    );
  }
  await h.stop();
});

describe('TW-CPN-018 catalog list', () => {
  it('lists by code with the KPIs, the default and the active options; the default is flagged', async () => {
    const l = await list();
    expect(l.data.map((c) => c.code)).toEqual(['EUR', 'IDR', 'INR', 'PKR', 'THB', 'USD']);
    expect(l.stats).toEqual({ total: 6, active: 5, inactive: 1, defaultCode: 'USD' });
    expect(l.data.find((c) => c.code === 'USD')?.isDefault).toBe(true);
    expect(l.data.filter((c) => c.isDefault)).toHaveLength(1);
    expect(l.activeOptions.map((o) => o.code)).toEqual(['EUR', 'IDR', 'INR', 'PKR', 'USD']);
    expect(l.data.find((c) => c.code === 'INR')).toMatchObject({
      exchangeRate: '83.250000',
      precision: 2,
      symbol: '₹',
    });
  });

  it('searches code, name and symbol: "rup" finds the three rupees; a typed % is a literal', async () => {
    expect((await list('?q=rup')).data.map((c) => c.code)).toEqual(['IDR', 'INR', 'PKR']);
    expect((await list('?q=%E2%82%B9')).data.map((c) => c.code)).toEqual(['INR']);
    expect((await list('?q=%25')).data).toEqual([]);
    expect((await list('?q=nothing-matches')).total).toBe(0);
  });

  it('pages by code with a cursor, and the KPIs stay global', async () => {
    const everything = (await list('?limit=100')).data.map((c) => c.code);
    const first = await list('?limit=4');
    expect(first.data.map((c) => c.code)).toEqual(everything.slice(0, 4));
    expect(first.page.hasMore).toBe(true);
    const second = await list(`?limit=4&cursor=${encodeURIComponent(first.page.nextCursor!)}`);
    expect(second.data.map((c) => c.code)).toEqual(everything.slice(4, 8));
    expect(second.stats.total).toBe(everything.length);
  });

  it('every operator role reads; a workspace user is refused', async () => {
    expect((await ops(h, 'get', '/currencies', h.supportToken)).status).toBe(200);
    expect((await as(h, owner.admin, 'get', 'platform/currencies')).status).toBeGreaterThanOrEqual(
      401,
    );
  });
});

describe('TW-CPN-019 add currency', () => {
  it('adds an active currency with its code upper-cased', async () => {
    const c = await create();
    expect(c).toMatchObject({
      code: 'CHF',
      name: 'Swiss Franc',
      exchangeRate: '0.880000',
      isActive: true,
      isDefault: false,
    });
  });

  it('refuses an existing code in any case, a zero rate, and badly shaped input', async () => {
    const dup = await ops(h, 'post', '/currencies').send(
      body({ code: 'usd', name: 'Dollar again' }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe(ERROR_CODES.CPN_CURRENCY_CODE_TAKEN);
    for (const bad of [
      { code: 'QQQ', exchangeRate: '0' },
      { code: 'QQQ', exchangeRate: '-1' },
      { code: 'QQQ', exchangeRate: 'abc' },
      { code: 'QQQ', precision: 7 },
      { code: 'QQQ', precision: -1 },
      { code: 'QQQ', name: '' },
      { code: 'QQQ', name: 'x'.repeat(121) },
      { code: 'QQQ', symbol: 'x'.repeat(21) },
      { code: '1BAD' },
      { code: 'A' },
      { code: 'TOOLONGCODE1' },
    ]) {
      const r = await ops(h, 'post', '/currencies').send(body(bad));
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await list()).data.some((c) => c.code === 'QQQ')).toBe(false);
  });

  it('defaults precision to 2, the rate to 1 and active to true; no symbol is stored as null', async () => {
    const c = await create({
      code: 'XTA',
      name: 'Test A',
      symbol: undefined,
      precision: undefined,
      exchangeRate: undefined,
      isActive: undefined,
    });
    expect(c).toMatchObject({
      precision: 2,
      exchangeRate: '1.000000',
      isActive: true,
      symbol: null,
    });
  });

  it('only a super admin writes', async () => {
    expect(
      (await ops(h, 'post', '/currencies', h.supportToken).send(body({ code: 'QQQ' }))).status,
    ).toBe(403);
  });

  it('flushes the display cache so the new currency is usable at once', async () => {
    const money = (await import('../../../src/modules/platform-settings-branding-storage'))
      .CurrencyService;
    const svc = h.app.get(money);
    expect(await svc.symbolFor('XTB')).toBe('XTB');
    await create({ code: 'XTB', name: 'Test B', symbol: '¤' });
    expect(await svc.symbolFor('XTB')).toBe('¤');
  });
});

describe('TW-CPN-020 update, TW-CPN-021 toggle', () => {
  it('edits name, symbol, decimals and rate; the code cannot change; a stale form is refused; audit holds before and after', async () => {
    const c = await create({ code: 'XTC', name: 'Test C', exchangeRate: '2' });
    const res = await ops(h, 'patch', `/currencies/${c.id}`).send({
      rowVersion: c.rowVersion,
      exchangeRate: '84.1',
      symbol: 'C$',
      precision: 3,
      name: 'Test Cee',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(currencyItemSchema.parse(res.body)).toMatchObject({
      code: 'XTC',
      exchangeRate: '84.100000',
      symbol: 'C$',
      precision: 3,
      name: 'Test Cee',
      rowVersion: c.rowVersion + 1,
    });
    const stale = await ops(h, 'patch', `/currencies/${c.id}`).send({
      rowVersion: c.rowVersion,
      name: 'again',
    });
    expect(stale.status).toBe(409);
    // a PATCH naming a code is not an edit of the code: the schema has no such field, the stored code stays
    const sneaky = await ops(h, 'patch', `/currencies/${c.id}`).send({
      rowVersion: c.rowVersion + 1,
      code: 'ZZZ',
      name: 'Test Cee',
    });
    expect(sneaky.body.code).toBe('XTC');
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.currency.updated' AND payload->>'currencyCode' = 'XTC' AND payload->'before'->>'rate' = '2.000000' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.rows[0].payload.after.rate).toBe('84.100000');
    // the "sneaky" call changed nothing, so it wrote and audited nothing
    expect(sneaky.body.rowVersion).toBe(c.rowVersion + 1);
    expect(
      (
        await ops(h, 'patch', `/currencies/00000000-0000-4000-8000-000000000000`).send({
          rowVersion: 1,
        })
      ).status,
    ).toBe(404);
  });

  it('a PATCH that omits is_active leaves the flag alone (Reference deactivated the currency)', async () => {
    const c = await create({ code: 'XTD', name: 'Test D' });
    const res = await ops(h, 'patch', `/currencies/${c.id}`).send({
      rowVersion: c.rowVersion,
      name: 'Test Dee',
    });
    expect(res.body.isActive).toBe(true);
  });

  it('switches on and off by value; repeating changes nothing', async () => {
    const thb = (await list('?q=THB')).data[0]!;
    expect(thb.isActive).toBe(false);
    const on = await ops(h, 'put', `/currencies/${thb.id}/active`).send({ value: true });
    expect(on.body.isActive).toBe(true);
    const again = await ops(h, 'put', `/currencies/${thb.id}/active`).send({ value: true });
    expect(again.body.rowVersion).toBe(on.body.rowVersion);
    const off = await ops(h, 'put', `/currencies/${thb.id}/active`).send({ value: false });
    expect(off.body.isActive).toBe(false);
    expect((await list()).activeOptions.map((o) => o.code)).not.toContain('THB');
  });

  it('the platform default cannot be switched off, by toggle or by edit', async () => {
    const usd = (await list('?q=USD')).data[0]!;
    const toggle = await ops(h, 'put', `/currencies/${usd.id}/active`).send({ value: false });
    expect(toggle.status).toBe(409);
    expect(toggle.body.code).toBe(ERROR_CODES.CPN_CURRENCY_IS_DEFAULT);
    const edit = await ops(h, 'patch', `/currencies/${usd.id}`).send({
      rowVersion: usd.rowVersion,
      isActive: false,
    });
    expect(edit.body.code).toBe(ERROR_CODES.CPN_CURRENCY_IS_DEFAULT);
    expect((await list('?q=USD')).data[0]!.isActive).toBe(true);
  });
});

describe('TW-CPN-024 set the platform default', () => {
  it('stores the default as TEXT that reads back, flags the row, and audits previous and new', async () => {
    const res = await ops(h, 'put', '/currencies/default').send({ code: 'inr' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ defaultCode: 'INR' });
    expect(await defaultCode()).toBe('INR');
    const raw = await h.owner.query(
      `SELECT value->>'defaultCurrency' AS v, jsonb_typeof(value->'defaultCurrency') AS t FROM platform_settings WHERE key = 'set.general'`,
    );
    expect(raw.rows[0]).toEqual({ v: 'INR', t: 'string' });
    const l = await list();
    expect(l.stats.defaultCode).toBe('INR');
    expect(l.data.find((c) => c.code === 'INR')?.isDefault).toBe(true);
    expect(l.data.filter((c) => c.isDefault)).toHaveLength(1);
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.currency.default_changed' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.rows[0].payload).toMatchObject({ previous: 'USD', now: 'INR' });
  });

  it('refuses a code that is not in the catalog and one that is switched off', async () => {
    expect((await ops(h, 'put', '/currencies/default').send({ code: 'NOPE' })).status).toBe(422);
    const off = await ops(h, 'put', '/currencies/default').send({ code: 'THB' });
    expect(off.status).toBe(422);
    expect(off.body.code).toBe(ERROR_CODES.CPN_CURRENCY_NOT_ACTIVE);
    expect(await defaultCode()).toBe('INR');
  });

  it('the checkout and the wallet read the same default', async () => {
    const wallet = await h.app
      .get((await import('../../../src/modules/wallet-message-billing')).WalletSettingsService)
      .currency();
    expect(wallet).toBe('INR');
    const checkout = await (
      await import('../../../src/modules/platform-payment-gateways/checkout-settings.service')
    ).CheckoutSettingsService;
    expect((await h.app.get(checkout).load()).defaultCurrency).toBe('INR');
  });

  it('the General settings form is held to the same rule', async () => {
    const svc = h.app.get(SettingsService);
    const cur = await svc.read('general');
    await expect(
      svc.patch(
        'general',
        { values: { defaultCurrency: 'XXX' }, secrets: {}, rowVersion: cur.rowVersion },
        1,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(await defaultCode()).toBe('INR');
    const ok = await svc.patch(
      'general',
      { values: { defaultCurrency: 'USD' }, secrets: {}, rowVersion: cur.rowVersion },
      1,
    );
    expect(ok.values.defaultCurrency).toBe('USD');
  });

  it('with the default put back to USD for the next tests', async () => {
    await ops(h, 'put', '/currencies/default').send({ code: 'USD' });
    expect(await defaultCode()).toBe('USD');
  });
});

describe('TW-CPN-022 delete', () => {
  it('refuses the default (and audits the refusal), deletes an unused currency, and a repeat is a 404', async () => {
    const usd = (await list('?q=USD')).data[0]!;
    const blocked = await ops(h, 'delete', `/currencies/${usd.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe(ERROR_CODES.CPN_CURRENCY_IS_DEFAULT);
    const audit = await h.owner.query(
      `SELECT status, payload FROM security_events WHERE event = 'platform.currency.delete_blocked' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      status: 'failure',
      payload: { reason: 'is_system_default' },
    });
    const c = await create({ code: 'XTD', name: 'Test D2' }).catch(
      async () => (await list('?q=XTD')).data[0]!,
    );
    expect((await ops(h, 'delete', `/currencies/${c.id}`)).status).toBe(204);
    expect((await ops(h, 'delete', `/currencies/${c.id}`)).status).toBe(404);
    expect((await list()).data.some((x) => x.code === 'XTD')).toBe(false);
  });

  it('refuses a currency that a workspace, a coupon or a plan still uses', async () => {
    const used = await create({ code: 'RUP', name: 'Used currency' });
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, currency) VALUES ($1, 'RUP') ON CONFLICT (org_id) DO UPDATE SET currency = 'RUP'`,
      [owner.orgId],
    );
    const res = await ops(h, 'delete', `/currencies/${used.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ERROR_CODES.CPN_CURRENCY_IN_USE);
    expect(JSON.stringify(res.body)).toContain('workspaces');
    await h.owner.query(`UPDATE workspace_settings SET currency = NULL WHERE org_id = $1`, [
      owner.orgId,
    ]);
    // the onboarding screen stores the workspace currency in the settings document: that counts as in use too
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"currency":"RUP"}'::jsonb WHERE id = $1`,
      [owner.orgId],
    );
    expect((await ops(h, 'delete', `/currencies/${used.id}`)).body.code).toBe(
      ERROR_CODES.CPN_CURRENCY_IN_USE,
    );
    await h.owner.query(`UPDATE organizations SET settings = settings - 'currency' WHERE id = $1`, [
      owner.orgId,
    ]);
    await h.owner.query(
      `INSERT INTO coupons (code, type, amount, currency_code) VALUES ('CPNTRUP', 'fixed', 5, 'RUP')`,
    );
    expect((await ops(h, 'delete', `/currencies/${used.id}`)).body.code).toBe(
      ERROR_CODES.CPN_CURRENCY_IN_USE,
    );
    await h.owner.query(`DELETE FROM coupons WHERE code = 'CPNTRUP'`);
    expect((await ops(h, 'delete', `/currencies/${used.id}`)).status).toBe(204);
  });
});

describe('TW-CPN-023 fetch live rates', () => {
  const provider = () => h.app.get(OpenErApiProvider);
  const answer = (status: number, json: unknown): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

  it('updates every catalog currency the provider knows (active or not) and leaves the rest', async () => {
    provider().transport = {
      fetchImpl: answer(200, {
        result: 'success',
        rates: { USD: 1, INR: 90.5, EUR: 0.9, THB: 35.5, ZZZ: 3 },
      }),
    };
    const res = await ops(h, 'post', '/currencies/fetch-rates');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ updated: 4, provider: 'open.er-api.com' });
    const rate = async (code: string) =>
      (await list(`?q=${code}`)).data.find((c) => c.code === code)!.exchangeRate;
    expect(await rate('INR')).toBe('90.500000');
    expect(await rate('THB')).toBe('35.500000'); // inactive rows are refreshed too
    expect(await rate('USD')).toBe('1.000000');
    expect(await rate('PKR')).toBe('278.000000'); // not in the response: untouched
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.currency.rates_fetched' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.rows[0].payload).toMatchObject({ provider: 'open.er-api.com', updated: 4 });
  });

  it('a provider error, an empty answer and a timeout change nothing, say why, and are audited', async () => {
    const before = (await list()).data.map((c) => `${c.code}:${c.exchangeRate}`);
    for (const [transport, expected] of [
      [{ fetchImpl: answer(500, {}) }, 'Rate provider returned HTTP 500'],
      [{ fetchImpl: answer(200, { rates: {} }) }, 'Rate provider returned no rates.'],
      [{ fetchImpl: answer(200, { nothing: 1 }) }, 'Rate provider returned no rates.'],
      [
        {
          fetchImpl: (async () => {
            throw new Error('socket hang up');
          }) as unknown as typeof fetch,
        },
        'Fetch failed: socket hang up',
      ],
    ] as const) {
      provider().transport = transport;
      const res = await ops(h, 'post', '/currencies/fetch-rates');
      expect(res.status).toBe(502);
      expect(res.body.code).toBe(ERROR_CODES.CPN_RATES_FETCH_FAILED);
      expect(res.body.detail).toBe(expected);
    }
    expect((await list()).data.map((c) => `${c.code}:${c.exchangeRate}`)).toEqual(before);
    const ev = await h.owner.query(
      `SELECT status, payload FROM security_events WHERE event = 'platform.currency.rates_fetch_failed' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.rows[0]).toMatchObject({ status: 'failure' });
    provider().transport = {};
  });

  it('skips rates the catalog cannot hold (below 0.000001) rather than corrupting the row', async () => {
    provider().transport = { fetchImpl: answer(200, { rates: { INR: 0.0000001, EUR: 0.95 } }) };
    const res = await ops(h, 'post', '/currencies/fetch-rates');
    expect(res.body.updated).toBe(1);
    provider().transport = {};
  });
});

describe('TW-CPN-027 workspace display currency', () => {
  it('follows the platform default until the owner picks one, and lists only active currencies', async () => {
    const w = workspaceCurrencyResponseSchema.parse(
      (await as(h, owner.admin, 'get', 'workspace/currency')).body,
    );
    expect(w).toMatchObject({ currency: null, effective: 'USD', platformDefault: 'USD' });
    expect(w.options.map((o) => o.code)).toEqual(
      expect.arrayContaining(['EUR', 'IDR', 'INR', 'PKR', 'USD']),
    );
    expect(w.options.some((o) => o.code === 'THB')).toBe(false);
    await ops(h, 'put', '/currencies/default').send({ code: 'INR' });
    const moved = workspaceCurrencyResponseSchema.parse(
      (await as(h, owner.admin, 'get', 'workspace/currency')).body,
    );
    expect(moved).toMatchObject({ currency: null, effective: 'INR' });
    await ops(h, 'put', '/currencies/default').send({ code: 'USD' });
  });

  it('the owner saves EUR (stored upper-case), it sticks when the default changes, and null goes back to following it', async () => {
    const set = await as(h, owner.admin, 'put', 'workspace/currency').send({ currency: 'eur' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ currency: 'EUR', effective: 'EUR' });
    // one value in both homes: the settings document the onboarding and the profile read, and the column the reseller billing reads
    const row = await h.owner.query(
      `SELECT o.settings->>'currency' AS doc, ws.currency AS col FROM organizations o LEFT JOIN workspace_settings ws ON ws.org_id = o.id WHERE o.id = $1`,
      [owner.orgId],
    );
    expect(row.rows[0]).toEqual({ doc: 'EUR', col: 'EUR' });
    await ops(h, 'put', '/currencies/default').send({ code: 'INR' });
    expect((await as(h, owner.admin, 'get', 'workspace/currency')).body).toMatchObject({
      currency: 'EUR',
      effective: 'EUR',
      platformDefault: 'INR',
    });
    await ops(h, 'put', '/currencies/default').send({ code: 'USD' });
    const cleared = await as(h, owner.admin, 'put', 'workspace/currency').send({ currency: null });
    expect(cleared.body).toMatchObject({ currency: null, effective: 'USD' });
    expect(
      (
        await h.owner.query(
          `SELECT o.settings ? 'currency' AS has, ws.currency AS col FROM organizations o JOIN workspace_settings ws ON ws.org_id = o.id WHERE o.id = $1`,
          [owner.orgId],
        )
      ).rows[0],
    ).toEqual({ has: false, col: null });
    // a currency chosen during onboarding (the settings document alone) is the one this screen shows
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"currency":"INR"}'::jsonb WHERE id = $1`,
      [owner.orgId],
    );
    expect((await as(h, owner.admin, 'get', 'workspace/currency')).body).toMatchObject({
      currency: 'INR',
      effective: 'INR',
    });
    await as(h, owner.admin, 'put', 'workspace/currency').send({ currency: null });
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'workspace.currency_changed' AND subject_org_id = $1 ORDER BY id`,
      [owner.orgId],
    );
    expect(ev.rows.map((r) => r.payload.now)).toEqual(['EUR', null, null]);
  });

  it('refuses a code outside the active catalog and a non-owner', async () => {
    const bad = await as(h, owner.admin, 'put', 'workspace/currency').send({ currency: 'THB' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe(ERROR_CODES.CPN_WORKSPACE_CURRENCY_INVALID);
    const missing = await as(h, owner.admin, 'put', 'workspace/currency').send({ currency: 'ZZZ' });
    expect(missing.status).toBe(422);
    const viewer = await h.api.member(owner, 'viewer', [['wallet.balance.read']]);
    expect(
      (await as(h, viewer.token, 'put', 'workspace/currency').send({ currency: 'EUR' })).status,
    ).toBe(403);
    expect((await as(h, viewer.token, 'get', 'workspace/currency')).status).toBe(200);
  });
});
