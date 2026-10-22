import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient, type Tx } from '@crm/db';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { tokenColumns, tokenHash } from '../../../src/common/crypto/secret-columns';
import {
  SEAL_TARGETS,
  sealPlaintextSecrets,
} from '../../../src/common/crypto/seal-plaintext-secrets';
import { OrdersRepository } from '../../../src/modules/platform-payment-gateways/orders.repository';
import { SqlOrdersGateway } from '../../../src/modules/storefront-builder/_shims/sql-orders-gateway';
import { startTestPg, type TestPg } from '../../support/pg-it';

/**
 * Encryption audit E8: the platform order return token (`orders.return_token`) and the storefront order tracking token
 * (`wa_orders.recovery_token`) are bearer links. Both are now found by their SHA-256 (with the legacy plaintext column as the fallback), the
 * tracking token is kept sealed so the admin screen can show the link again, and a backfill plus scrub removes the plaintext without
 * breaking a link that was already sent.
 */
const crypto = new CryptoService({
  get: (n: string) =>
    n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? '' : randomBytes(32).toString('base64'),
} as unknown as ConfigService<never, true>);

describe('bearer-link tokens are looked up by hash (E8)', () => {
  let pg: TestPg;
  let client: DbClient;
  let org: number;
  const privileged = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    client.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.privileged', 'on', true)`);
      return fn(tx);
    });

  beforeAll(async () => {
    pg = await startTestPg();
    client = createDbClient({ url: pg.uri, poolMax: 2 });
    org = Number(
      (
        await pg.owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ('bt-hash','B','starter') RETURNING id`,
        )
      ).rows[0].id,
    );
  }, 300_000);
  afterAll(async () => {
    await client?.close();
    await pg?.stop();
  });

  it('orders.return_token: found as legacy, backfilled and scrubbed; a new order stores only hash + sealed copy when the mirror is off', async () => {
    const repo = new OrdersRepository();
    const legacy = 'a'.repeat(32);
    await pg.owner.query(
      `INSERT INTO orders (org_id, order_number, kind, plan_slug, currency, amount, return_token)
       VALUES ($1, 'ORD-LEGACY', 'plan', 'x', 'USD', 1, $2)`,
      [org, legacy],
    );
    expect((await privileged((tx) => repo.byReturnToken(tx, legacy)))?.orderNumber).toBe(
      'ORD-LEGACY',
    );

    const target = SEAL_TARGETS.filter((t) => t.name === 'orders.return_token');
    expect(target).toHaveLength(1);
    await sealPlaintextSecrets(pg.owner, crypto, { targets: target });
    const hashed = await pg.owner.query(
      `SELECT return_token_hash AS h FROM orders WHERE order_number = 'ORD-LEGACY'`,
    );
    expect(hashed.rows[0].h).toBe(tokenHash(legacy));
    await sealPlaintextSecrets(pg.owner, crypto, { targets: target, scrub: true });
    const scrubbed = await pg.owner.query(
      `SELECT return_token AS t FROM orders WHERE order_number = 'ORD-LEGACY'`,
    );
    expect(scrubbed.rows[0].t).toBeNull();
    expect((await privileged((tx) => repo.byReturnToken(tx, legacy)))?.orderNumber).toBe(
      'ORD-LEGACY',
    );
    expect(await privileged((tx) => repo.byReturnToken(tx, 'f'.repeat(32)))).toBeNull();

    // A row from a writer that still omits the hash (the previous release) gets it from the trigger.
    await pg.owner.query(
      `INSERT INTO orders (org_id, order_number, kind, plan_slug, currency, amount, return_token)
       VALUES ($1, 'ORD-OLDCODE', 'plan', 'x', 'USD', 1, $2)`,
      [org, 'b'.repeat(32)],
    );
    const trig = await pg.owner.query(
      `SELECT return_token_hash AS h FROM orders WHERE order_number = 'ORD-OLDCODE'`,
    );
    expect(trig.rows[0].h).toBe(tokenHash('b'.repeat(32)));

    // The new release: explicit columns, no plaintext with the mirror off.
    process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR = 'off';
    const t = tokenColumns(crypto, 'c'.repeat(32));
    delete process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR;
    await pg.owner.query(
      `INSERT INTO orders (org_id, order_number, kind, plan_slug, currency, amount, return_token, return_token_hash)
       VALUES ($1, 'ORD-NEW', 'plan', 'x', 'USD', 1, $2, $3)`,
      [org, t.plain, t.hash],
    );
    expect((await privileged((tx) => repo.byReturnToken(tx, 'c'.repeat(32))))?.orderNumber).toBe(
      'ORD-NEW',
    );
  });

  it('wa_orders.recovery_token: the tracking link keeps working through backfill and scrub, and the admin can still read it', async () => {
    const gw = new SqlOrdersGateway({} as never, crypto);
    const sf = Number(
      (
        await pg.owner.query(
          `INSERT INTO wa_storefronts (org_id, shop_name, slug) VALUES ($1, 'S', 'bt-shop') RETURNING id`,
          [org],
        )
      ).rows[0].id,
    );
    const legacy = 'L'.repeat(40);
    await pg.owner.query(
      `INSERT INTO wa_orders (org_id, source, items_json, storefront_id, recovery_token) VALUES ($1,'storefront','[]'::jsonb,$2,$3)`,
      [org, sf, legacy],
    );
    const find = (tok: string) => privileged((tx) => gw.findByToken(tx, org, sf, tok));
    expect((await find(legacy))?.recoveryToken).toBe(legacy);

    const target = SEAL_TARGETS.filter((t) => t.name === 'wa_orders.recovery_token');
    expect(target).toHaveLength(1);
    await sealPlaintextSecrets(pg.owner, crypto, { targets: target });
    await sealPlaintextSecrets(pg.owner, crypto, { targets: target, scrub: true });
    const gone = await pg.owner.query(
      `SELECT recovery_token AS t FROM wa_orders WHERE storefront_id = $1`,
      [sf],
    );
    expect(gone.rows[0].t).toBeNull();
    expect((await find(legacy))?.recoveryToken).toBe(legacy); // found by hash, read back from the sealed copy
    expect(await find('M'.repeat(40))).toBeUndefined();
  });
});
