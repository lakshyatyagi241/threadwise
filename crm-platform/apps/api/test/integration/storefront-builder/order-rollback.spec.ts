import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlOrdersGateway } from '../../../src/modules/storefront-builder/_shims/sql-orders-gateway';
import type { NewStorefrontOrder } from '../../../src/modules/storefront-builder/_shims/tokens';
import { startRlsPg, type RlsPg } from '../../support/rls-pg';

/**
 * A storefront order and the buyer's contact are one unit (audit D-11): the gateway finds or creates the contact and inserts the
 * order in the caller's transaction. If the checkout fails after the order is placed (a payment-link call, a later write), neither
 * may remain, or the shop shows an order nobody paid for and a contact nobody asked for.
 */
describe('storefront order: a checkout that fails leaves neither the order nor the buyer', () => {
  let h: RlsPg;
  let orgId: number;
  let gateway: SqlOrdersGateway;
  let seq = 0;

  /** The contact resolver of the CRM, reduced to what the gateway needs: it writes the contact on the caller's transaction. */
  const contacts = {
    async findOrCreateByPhone(
      tx: { execute: (q: unknown) => Promise<{ rows: Array<{ id: number | string }> }> },
      org: number,
      input: { phone: string; name: string | null },
    ) {
      const res = await tx.execute(
        sql`INSERT INTO contacts (org_id, name, phone) VALUES (${org}, ${input.name}, ${input.phone}) RETURNING id`,
      );
      return { outcome: 'created', contactId: Number(res.rows[0]!.id) };
    },
  };
  const crypto = { encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.slice(4) };

  const order = (): NewStorefrontOrder => ({
    storefrontId: null as never,
    customerPhone: `+91999000${String(1000 + ++seq)}`,
    customerName: 'Rollback Buyer',
    customerEmail: null,
    customerAddress: null,
    items: [],
    totalMinor: 49900,
    shippingMinor: 0,
    discountMinor: 0,
    couponCode: null,
    currencyCode: 'INR',
    paymentMethod: 'cod',
    rtoScore: null,
    rtoBand: null,
    recoveryToken: `tok-${seq}-${'x'.repeat(30)}`,
    notes: null,
  });

  const counts = async () => {
    const n = async (table: string) =>
      Number(
        (
          await h.pg.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [
            orgId,
          ])
        ).rows[0].n,
      );
    return { orders: await n('wa_orders'), contacts: await n('contacts') };
  };

  beforeAll(async () => {
    h = await startRlsPg();
    orgId = await h.newOrg(`order-rollback-${Date.now()}`);
    gateway = new SqlOrdersGateway(contacts as never, crypto as never);
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('a placed order creates the order and the buyer together (the control)', async () => {
    expect(await counts()).toEqual({ orders: 0, contacts: 0 });
    const placed = await h.inOrg(orgId, (tx) => gateway.create(tx, orgId, order()));
    expect(placed.id).toBeGreaterThan(0);
    expect(await counts()).toEqual({ orders: 1, contacts: 1 });
  });

  it('an error after the order is placed removes the order and the buyer it created', async () => {
    const before = await counts();
    await expect(
      h.inOrg(orgId, async (tx) => {
        await gateway.create(tx, orgId, order());
        throw new Error('the payment link could not be created');
      }),
    ).rejects.toThrow('the payment link could not be created');
    expect(await counts()).toEqual(before);
  });

  it('a database error after the order is placed removes it too', async () => {
    const before = await counts();
    await expect(
      h.inOrg(orgId, async (tx) => {
        await gateway.create(tx, orgId, order());
        await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
          sql`SELECT 1/0`,
        );
      }),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
});
