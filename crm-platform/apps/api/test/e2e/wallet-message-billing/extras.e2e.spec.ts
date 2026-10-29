import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  creditPackageListSchema,
  creditPackageSchema,
  walletLegacyInvoiceSchema,
  walletSnapshotSchema,
} from '@crm/contracts';
import {
  cleanWallet,
  fixedPricing,
  fund,
  newTenant,
  services,
  setPlan,
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/** Credit packages (TW-WALLET-019) and the mobile/extension snapshot (TW-WALLET-025, -029). */
let h: BspHarness;
let startedAt: Date;
let t: Tenant;
const ops = (m: 'get' | 'post' | 'put' | 'delete', path: string, token = h.superToken) =>
  h.api
    .http()
    [m](`/v2/platform/wallet${path}`)
    .set({ authorization: `Bearer ${token}` });
const body = (over: Record<string, unknown> = {}) => ({
  name: 'Starter Pack',
  slug: '',
  description: '100 plus 10 free',
  price: '100.00',
  currency: 'USD',
  walletCredit: '110.00',
  badge: 'Popular',
  sortOrder: 10,
  isActive: true,
  isFeatured: false,
  ...over,
});

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  await fixedPricing(h);
  t = await newTenant(h, 'ex');
}, 120_000);

afterAll(async () => {
  await h.owner.query(
    `DELETE FROM credit_packages WHERE name LIKE 'Starter Pack%' OR name LIKE 'Pack Two%'`,
  );
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('credit packages', () => {
  it('creates a package with a slug from its name, shows the bonus, and makes a repeated name unique', async () => {
    const a = await ops('post', '/packages').send(body());
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const pkg = creditPackageSchema.parse(a.body);
    expect(pkg).toMatchObject({
      slug: 'starter-pack',
      priceMinor: 10_000,
      walletCreditMinor: 11_000,
      bonusPercent: 10,
      currency: 'USD',
    });
    const b = creditPackageSchema.parse((await ops('post', '/packages').send(body())).body);
    expect(b.slug).toBe('starter-pack-2');
    const listed = creditPackageListSchema.parse((await ops('get', '/packages')).body);
    expect(listed.data.map((p) => p.slug)).toEqual(
      expect.arrayContaining(['starter-pack', 'starter-pack-2']),
    );
    expect(listed.currencies.length).toBeGreaterThan(0);
  });

  it('allows a free package, refuses an inactive currency and bad amounts, and is for super admins only', async () => {
    expect(
      (
        await ops('post', '/packages').send(
          body({ name: 'Starter Pack Free', price: '0', walletCredit: '5' }),
        )
      ).status,
    ).toBe(201);
    const cur = await ops('post', '/packages').send(
      body({ name: 'Starter Pack X', currency: 'QQQ' }),
    );
    expect(cur.status).toBe(422);
    expect(cur.body.code).toBe(ERROR_CODES.WALLET_PACKAGE_INVALID);
    expect((await ops('post', '/packages').send(body({ price: '1.234' }))).status).toBe(422);
    expect((await ops('post', '/packages').send(body({ walletCredit: '0' }))).status).toBe(422);
    expect((await ops('post', '/packages', h.supportToken).send(body())).status).toBe(403);
    expect((await ops('get', '/packages', h.supportToken)).status).toBe(200);
  });

  it('edits with the form version: a stale form is refused, toggle flips, delete is final, and every change is logged', async () => {
    const created = creditPackageSchema.parse(
      (await ops('post', '/packages').send(body({ name: 'Pack Two' }))).body,
    );
    const edited = await ops('put', `/packages/${created.id}`).send(
      body({ name: 'Pack Two', price: '200', walletCredit: '230', rowVersion: created.rowVersion }),
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ priceMinor: 20_000, bonusPercent: 15, slug: 'pack-two' });
    const stale = await ops('put', `/packages/${created.id}`).send(
      body({ name: 'Pack Two', rowVersion: created.rowVersion }),
    );
    expect(stale.status).toBe(409);
    expect((await ops('post', `/packages/${created.id}/toggle`)).body.isActive).toBe(false);
    expect((await ops('post', `/packages/${created.id}/toggle`)).body.isActive).toBe(true);
    expect((await ops('delete', `/packages/${created.id}`)).body).toEqual({ deleted: true });
    expect((await ops('delete', `/packages/${created.id}`)).status).toBe(404);
    const logs = await ops('get', '/logs?scope=platform&event=platform.package.saved');
    expect(logs.body.data.length).toBeGreaterThan(0);
  });
});

describe('the invoice of a migrated top-up', () => {
  const INVOICE = '3500650000008567084';
  const html = '<html><body><h1>Invoice INV-000123</h1><script>alert(1)</script></body></html>';

  it('the wallet row names the stored invoice, the workspace opens it, and another workspace cannot', async () => {
    const mine = await newTenant(h, 'inv1');
    const other = await newTenant(h, 'inv2');
    const { db, ledger } = services(h);
    await db.txAs({ orgId: mine.orgId, userId: null }, (tx) =>
      ledger.post(tx, {
        orgId: mine.orgId,
        unit: 'USD',
        type: 'topup',
        direction: 'in',
        amountMinor: 200000,
        idempotencyKey: `legacy-inv:${mine.orgId}`,
        source: 'waboo_purchase',
        description: `Credits purchased (invoice ${INVOICE})`,
        meta: { legacy: { waboo: { invoice: INVOICE } } },
      }),
    );
    await fund(h, mine.orgId, 100); // a top-up with no invoice stored
    const before = await h.api.as(mine.admin).get('/v2/wallet/ledger');
    expect(
      before.body.data.every((r: { legacyInvoiceId?: string | null }) => !r.legacyInvoiceId),
    ).toBe(true);

    await h.owner.query(
      `INSERT INTO wallet_legacy_invoices (org_id, invoice_id, invoice_number, invoice_date, currency, total, status, html)
       VALUES ($1, $2, 'INV-000123', '2026-10-15', 'INR', 2000, 'paid', $3)`,
      [mine.orgId, INVOICE, html],
    );
    const ledgerRes = await h.api.as(mine.admin).get('/v2/wallet/ledger');
    const withInvoice = ledgerRes.body.data.filter(
      (r: { legacyInvoiceId?: string | null }) => r.legacyInvoiceId,
    );
    expect(withInvoice).toHaveLength(1);
    const id = withInvoice[0].legacyInvoiceId as string;

    const opened = await h.api.as(mine.admin).get(`/v2/wallet/legacy-invoices/${id}`);
    expect(opened.status).toBe(200);
    expect(walletLegacyInvoiceSchema.parse(opened.body)).toMatchObject({
      id,
      number: 'INV-000123',
      date: '2026-10-15',
      currency: 'INR',
      status: 'paid',
      html,
    });
    // the other workspace sees it as not found (row-level security), and an unknown id is the same
    expect((await h.api.as(other.admin).get(`/v2/wallet/legacy-invoices/${id}`)).status).toBe(404);
    expect(
      (
        await h.api
          .as(mine.admin)
          .get('/v2/wallet/legacy-invoices/00000000-0000-4000-8000-000000000000')
      ).status,
    ).toBe(404);
    expect((await h.api.as(mine.admin).get('/v2/wallet/legacy-invoices/nope')).status).toBe(422);
    await h.owner.query(`DELETE FROM wallet_legacy_invoices WHERE org_id = $1`, [mine.orgId]);
  });
});

describe('wallet snapshot for the mobile app and the extension', () => {
  const snap = async () =>
    walletSnapshotSchema.parse((await h.api.as(t.admin).get('/v2/wallet/snapshot')).body);

  it('plan mode: what is left of the plan allowance, with the wallet as a buffer', async () => {
    await setPlan(h, t.orgId, { monthly: 1000 });
    await fund(h, t.orgId, 5000);
    await services(h).billing.settleDelivered({
      orgId: t.orgId,
      provider: 'waba',
      providerMessageId: 'snap-1',
      recipient: '+14155550100',
      category: 'utility',
    });
    const s = await snap();
    expect(s).toMatchObject({
      billingMode: 'plan',
      messagesRemaining: 999,
      usedThisMonth: 1,
      monthlyMessagesLimit: 1000,
      walletBufferMessages: 50,
      balanceMinor: 5000,
    });
  });

  it('unlimited plan reports -1', async () => {
    await setPlan(h, t.orgId, {});
    expect((await snap()).messagesRemaining).toBe(-1);
  });

  it('wallet mode: how many messages the balance buys, and what the month cost', async () => {
    await setReseller(h, t.orgId, true);
    await services(h).billing.settleDelivered({
      orgId: t.orgId,
      provider: 'waba',
      providerMessageId: 'snap-2',
      recipient: '+14155550100',
      category: 'utility',
    });
    const s = await snap();
    expect(s).toMatchObject({
      billingMode: 'wallet',
      walletBufferMessages: null,
      flatPriceMinor: 100,
      spentThisMonthMinor: 100,
    });
    expect(s.messagesRemaining).toBe(Math.floor(s.balanceMinor / 100));
  });

  it('needs the balance permission', async () => {
    const none = await h.api.member(t, 'snapnone', []);
    expect((await h.api.as(none.token).get('/v2/wallet/snapshot')).status).toBe(403);
  });
});
