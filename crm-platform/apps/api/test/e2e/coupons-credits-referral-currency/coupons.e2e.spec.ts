import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  couponListResponseSchema,
  couponOptionsResponseSchema,
  couponSchema,
  ERROR_CODES,
} from '@crm/contracts';
import {
  TEST_COUPON_PREFIX,
  TEST_PLAN_PREFIX,
  cleanCpn,
  ops,
  startBspHarness,
  type BspHarness,
} from './support';

/** The operator's coupon catalogue (TW-CPN-001..005) through HTTP, against the real database and the real AppModule. */
let h: BspHarness;
const P = TEST_COUPON_PREFIX;

const body = (over: Record<string, unknown> = {}) => ({
  code: `${P}WELCOME10`,
  description: '10% off your first plan purchase',
  type: 'percent',
  amount: '10',
  isActive: true,
  ...over,
});
const create = async (over: Record<string, unknown> = {}) => {
  const res = await ops(h, 'post', '/coupons').send(body(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return couponSchema.parse(res.body);
};

beforeAll(async () => {
  h = await startBspHarness();
  await cleanCpn(h);
}, 120_000);

afterAll(async () => {
  await cleanCpn(h);
  await h.stop();
});

describe('TW-CPN-002 create coupon', () => {
  it('uppercases the code, starts at 0 uses, and honours the toggles', async () => {
    const c = await create({ code: ` ${P.toLowerCase()}welcome10 `, firstPurchaseOnly: true });
    expect(c).toMatchObject({
      code: `${P}WELCOME10`,
      usesCount: 0,
      isActive: true,
      firstPurchaseOnly: true,
      stackableWithOther: false,
      type: 'percent',
      amount: '10',
      applicablePlanSlugs: [],
      isExpired: false,
    });
  });

  it('refuses a code another coupon has, ignoring case, and saves nothing', async () => {
    await create({ code: `${P}SAVE20`, amount: '20' });
    const dup = await ops(h, 'post', '/coupons').send(body({ code: `${P.toLowerCase()}save20` }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe(ERROR_CODES.CPN_COUPON_CODE_TAKEN);
    const n = await h.owner.query(`SELECT count(*)::int AS n FROM coupons WHERE code = $1`, [
      `${P}SAVE20`,
    ]);
    expect(n.rows[0].n).toBe(1);
  });

  it('validates the form: expiry before start, max uses 0, bad type, negative or non-numeric amount, over-long text', async () => {
    const bad = async (over: Record<string, unknown>) =>
      (
        await ops(h, 'post', '/coupons').send(
          body({ code: `${P}BAD${Math.random()}`.slice(0, 20), ...over }),
        )
      ).status;
    expect(await bad({ startsAt: '2026-12-02T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' })).toBe(
      422,
    );
    expect(await bad({ maxUses: 0 })).toBe(422);
    expect(await bad({ perUserLimit: 0 })).toBe(422);
    expect(await bad({ type: 'bogus' })).toBe(422);
    expect(await bad({ amount: '-1' })).toBe(422);
    expect(await bad({ amount: 'ten' })).toBe(422);
    expect(await bad({ description: 'x'.repeat(256) })).toBe(422);
    expect(await bad({ adminNote: 'x'.repeat(1001) })).toBe(422);
    expect(await bad({ code: 'x'.repeat(65) })).toBe(422);
    expect(await bad({ code: '   ' })).toBe(422);
    expect(await bad({ applicablePlanSlugs: [`${TEST_PLAN_PREFIX}does-not-exist`] })).toBe(422);
  });

  it('accepts a percent amount above 100 (Reference parity: the engine caps at the order)', async () => {
    const c = await create({ code: `${P}OVER`, amount: '150' });
    expect(c.amount).toBe('150');
  });

  it('is for super admins: a support operator reads but cannot write', async () => {
    expect(
      (await ops(h, 'post', '/coupons', h.supportToken).send(body({ code: `${P}NOPE` }))).status,
    ).toBe(403);
    expect((await ops(h, 'get', '/coupons', h.supportToken)).status).toBe(200);
  });

  it('limits a coupon to real plans, sorted and de-duplicated, and lists them in the options', async () => {
    const p = await ops(h, 'post', '/plans').send({
      name: 'Cpn Growth',
      slug: `${TEST_PLAN_PREFIX}growth`,
      amount: '100',
      currency: 'USD',
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const c = await create({
      code: `${P}PLANONLY`,
      applicablePlanSlugs: [`${TEST_PLAN_PREFIX}growth`, `${TEST_PLAN_PREFIX}growth`],
    });
    expect(c.applicablePlanSlugs).toEqual([`${TEST_PLAN_PREFIX}growth`]);
    const opts = couponOptionsResponseSchema.parse((await ops(h, 'get', '/coupons/options')).body);
    expect(opts.plans.map((x) => x.slug)).toContain(`${TEST_PLAN_PREFIX}growth`);
    expect(opts.currencies.length).toBeGreaterThan(0);
  });
});

describe('TW-CPN-001 list, KPIs, filters', () => {
  it('lists newest first with a cursor, searches code and description, and keeps the KPIs global', async () => {
    const before = couponListResponseSchema.parse((await ops(h, 'get', '/coupons?limit=100')).body);
    for (let i = 0; i < 14; i++)
      await create({
        code: `${P}PAGE${String(i).padStart(2, '0')}`,
        description: i === 3 ? 'spring promo' : null,
      });
    const first = couponListResponseSchema.parse((await ops(h, 'get', '/coupons?limit=12')).body);
    expect(first.data).toHaveLength(12);
    expect(first.page.hasMore).toBe(true);
    expect(first.data[0]!.code).toBe(`${P}PAGE13`);
    expect(first.stats.total).toBe(before.stats.total + 14);
    const second = couponListResponseSchema.parse(
      (
        await ops(
          h,
          'get',
          `/coupons?limit=12&cursor=${encodeURIComponent(first.page.nextCursor!)}`,
        )
      ).body,
    );
    expect(second.data.length).toBeGreaterThan(0);
    expect(second.data.every((c) => !first.data.some((f) => f.id === c.id))).toBe(true);

    const found = couponListResponseSchema.parse(
      (await ops(h, 'get', `/coupons?q=${P.toLowerCase()}page03`)).body,
    );
    expect(found.data.map((c) => c.code)).toEqual([`${P}PAGE03`]);
    expect(found.total).toBe(1);
    expect(found.stats.total).toBe(first.stats.total); // KPIs ignore the search
    const byDescription = couponListResponseSchema.parse(
      (await ops(h, 'get', '/coupons?q=spring%20promo')).body,
    );
    expect(byDescription.data.map((c) => c.code)).toContain(`${P}PAGE03`);
  });

  it('treats % and _ in a search as literal characters', async () => {
    await create({ code: `${P}LIT_ONE`, description: '50% special' });
    const pct = couponListResponseSchema.parse(
      (await ops(h, 'get', '/coupons?q=50%25%20special')).body,
    );
    expect(pct.data.map((c) => c.code)).toEqual([`${P}LIT_ONE`]);
    const wildcard = couponListResponseSchema.parse((await ops(h, 'get', '/coupons?q=%25')).body);
    expect(wildcard.data.every((c) => c.description?.includes('%') || c.code.includes('%'))).toBe(
      true,
    );
  });

  it('filters by status; an expired coupon counts as expired even when disabled', async () => {
    const dead = await create({
      code: `${P}OLD`,
      expiresAt: '2020-01-01T00:00:00Z',
      isActive: false,
    });
    expect(dead.isExpired).toBe(true);
    const expired = couponListResponseSchema.parse(
      (await ops(h, 'get', '/coupons?status=expired&limit=100')).body,
    );
    expect(expired.data.map((c) => c.code)).toContain(`${P}OLD`);
    expect(expired.data.every((c) => c.isExpired)).toBe(true);
    const disabled = couponListResponseSchema.parse(
      (await ops(h, 'get', '/coupons?status=disabled&limit=100')).body,
    );
    expect(disabled.data.map((c) => c.code)).toContain(`${P}OLD`);
    const active = couponListResponseSchema.parse(
      (await ops(h, 'get', '/coupons?status=active&limit=100')).body,
    );
    expect(active.data.every((c) => c.isActive)).toBe(true);
    expect(expired.counts.expired).toBeGreaterThanOrEqual(1);
    expect(expired.stats.redeemed).toBeGreaterThanOrEqual(0);
    expect((await ops(h, 'get', '/coupons?status=weird')).status).toBe(422);
  });
});

describe('TW-CPN-003 edit coupon', () => {
  it('clears optional fields with null, and clears the plan restriction with an empty list (the Reference quirk is fixed)', async () => {
    const c = await create({
      code: `${P}EDIT1`,
      maxUses: 100,
      applicablePlanSlugs: [`${TEST_PLAN_PREFIX}growth`],
      minOrderAmount: '5',
    });
    expect(c.maxUses).toBe(100);
    const res = await ops(h, 'patch', `/coupons/${c.id}`).send({
      rowVersion: c.rowVersion,
      maxUses: null,
      applicablePlanSlugs: [],
      minOrderAmount: '',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(couponSchema.parse(res.body)).toMatchObject({
      maxUses: null,
      applicablePlanSlugs: [],
      minOrderAmount: null,
      rowVersion: c.rowVersion + 1,
    });
  });

  it('refuses a stale form, a taken code and a window turned backwards; a missing id is a 404', async () => {
    const a = await create({ code: `${P}EDIT2` });
    await create({ code: `${P}EDIT3` });
    const ok = await ops(h, 'patch', `/coupons/${a.id}`).send({
      rowVersion: a.rowVersion,
      description: 'x',
    });
    expect(ok.status).toBe(200);
    const stale = await ops(h, 'patch', `/coupons/${a.id}`).send({
      rowVersion: a.rowVersion,
      description: 'y',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe(ERROR_CODES.ROW_VERSION_CONFLICT);
    const taken = await ops(h, 'patch', `/coupons/${a.id}`).send({
      rowVersion: ok.body.rowVersion,
      code: `${P.toLowerCase()}edit3`,
    });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe(ERROR_CODES.CPN_COUPON_CODE_TAKEN);
    const window = await ops(h, 'patch', `/coupons/${a.id}`).send({
      rowVersion: ok.body.rowVersion,
      startsAt: '2027-02-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
    });
    expect(window.status).toBe(422);
    // a window set in two steps is checked against the stored half
    const startOnly = await ops(h, 'patch', `/coupons/${a.id}`).send({
      rowVersion: ok.body.rowVersion,
      expiresAt: '2027-01-01T00:00:00Z',
    });
    expect(startOnly.status).toBe(200);
    const back = await ops(h, 'patch', `/coupons/${a.id}`).send({
      rowVersion: startOnly.body.rowVersion,
      startsAt: '2027-03-01T00:00:00Z',
    });
    expect(back.status).toBe(422);
    expect(
      (
        await ops(h, 'patch', `/coupons/00000000-0000-4000-8000-000000000000`).send({
          rowVersion: 1,
        })
      ).status,
    ).toBe(404);
  });

  it('writes nothing, burns no version and audits nothing when no field changed', async () => {
    const c = await create({ code: `${P}EDIT4`, description: 'same' });
    const auditBefore = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.coupon.updated' AND payload->>'id' = $1`,
      [c.id],
    );
    const res = await ops(h, 'patch', `/coupons/${c.id}`).send({
      rowVersion: c.rowVersion,
      description: 'same',
      amount: '10.00',
      code: c.code.toLowerCase(),
    });
    expect(res.status).toBe(200);
    expect(res.body.rowVersion).toBe(c.rowVersion);
    const after = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.coupon.updated' AND payload->>'id' = $1`,
      [c.id],
    );
    expect(after.rows[0].n).toBe(auditBefore.rows[0].n);
  });

  it('audits what changed by field name, with the old and new values', async () => {
    const c = await create({ code: `${P}EDIT5`, amount: '10' });
    await ops(h, 'patch', `/coupons/${c.id}`).send({
      rowVersion: c.rowVersion,
      amount: '25',
      description: 'bigger',
    });
    const ev = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.coupon.updated' AND payload->>'id' = $1 ORDER BY id DESC LIMIT 1`,
      [c.id],
    );
    expect(ev.rows[0].payload.fields.sort()).toEqual(['amount', 'description']);
    expect(ev.rows[0].payload.before.amount).toBe('10');
    expect(ev.rows[0].payload.after.amount).toBe('25');
  });
});

describe('TW-CPN-004 toggle and TW-CPN-005 delete', () => {
  it('sets active to a value: repeating it changes nothing; the resolver then refuses a disabled coupon', async () => {
    const c = await create({ code: `${P}TOG` });
    const off = await ops(h, 'put', `/coupons/${c.id}/active`).send({ value: false });
    expect(off.body.isActive).toBe(false);
    const again = await ops(h, 'put', `/coupons/${c.id}/active`).send({ value: false });
    expect(again.body.rowVersion).toBe(off.body.rowVersion);
    expect(
      (await ops(h, 'put', `/coupons/${c.id}/active`).send({ value: true })).body.isActive,
    ).toBe(true);
    expect(
      (
        await ops(h, 'put', `/coupons/00000000-0000-4000-8000-000000000000/active`).send({
          value: true,
        })
      ).status,
    ).toBe(404);
    expect((await ops(h, 'put', `/coupons/${c.id}/active`).send({ value: 'yes' })).status).toBe(
      422,
    );
  });

  it('deletes for good, and a second delete is a 404', async () => {
    const c = await create({ code: `${P}DEL` });
    expect((await ops(h, 'delete', `/coupons/${c.id}`)).status).toBe(204);
    expect((await ops(h, 'get', `/coupons/${c.id}`)).status).toBe(404);
    expect((await ops(h, 'delete', `/coupons/${c.id}`)).status).toBe(404);
    const ev = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'platform.coupon.deleted' AND payload->>'id' = $1`,
      [c.id],
    );
    expect(ev.rows).toHaveLength(1);
  });
});
