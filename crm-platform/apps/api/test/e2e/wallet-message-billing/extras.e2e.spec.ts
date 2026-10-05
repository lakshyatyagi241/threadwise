import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  creditPackageListSchema,
  creditPackageSchema,
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
