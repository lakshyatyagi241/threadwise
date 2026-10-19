import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient, type Tx } from '@crm/db';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { tokenColumns, tokenHash, tokenOf } from '../../../src/common/crypto/secret-columns';
import {
  SEAL_TARGETS,
  sealPlaintextSecrets,
} from '../../../src/common/crypto/seal-plaintext-secrets';
import { StoresRepository } from '../../../src/modules/shopify-woocommerce/stores.repository';
import { startTestPg, type TestPg } from '../../support/pg-it';

/**
 * Encryption audit E2: the Shopify / WooCommerce webhook secret is the path segment of the URL, the key the public route finds the store
 * by, and (WooCommerce) the HMAC key given to the plugin. It is now stored as a SHA-256 (the lookup) and a sealed copy (the URL and the
 * key), `ecom_store_lookup()` matches the hash as well as the old column, and a backfill + scrub removes the plaintext. A webhook URL a
 * store already holds must keep resolving through every step.
 */
const crypto = new CryptoService({
  get: (n: string) =>
    n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? '' : randomBytes(32).toString('base64'),
} as unknown as ConfigService<never, true>);

const KINDS = [
  { kind: 'shopify', table: 'shopify_integrations', target: 'shopify_integrations.webhook_secret' },
  {
    kind: 'woocommerce',
    table: 'woocommerce_integrations',
    target: 'woocommerce_integrations.webhook_secret',
  },
] as const;

describe('store webhook secrets are looked up by hash (E2)', () => {
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
          `INSERT INTO organizations (slug, name, plan) VALUES ('ecom-hash','E','starter') RETURNING id`,
        )
      ).rows[0].id,
    );
  }, 300_000);
  afterAll(async () => {
    await client?.close();
    await pg?.stop();
  });

  for (const k of KINDS) {
    it(`${k.kind}: a legacy row, a backfilled row and a scrubbed row resolve by the same URL secret`, async () => {
      const find = async (secret: string) =>
        (await pg.owner.query(`SELECT * FROM ecom_store_lookup($1, $2)`, [k.kind, secret])).rows;
      const legacy = `${k.kind}-legacy-${'a'.repeat(30)}`;
      const cols =
        k.kind === 'shopify'
          ? 'store_url, access_token'
          : 'store_url, consumer_key, consumer_secret';
      const vals =
        k.kind === 'shopify' ? "'legacy.myshopify.com', 'x'" : "'https://legacy.test', 'x', 'x'";
      await pg.owner.query(
        `INSERT INTO ${k.table} (org_id, ${cols}, webhook_secret) VALUES ($1, ${vals}, $2)`,
        [org, legacy],
      );
      expect(await find(legacy)).toHaveLength(1);

      const target = SEAL_TARGETS.filter((t) => t.name === k.target);
      expect(target).toHaveLength(1);
      await sealPlaintextSecrets(pg.owner, crypto, { targets: target });
      const row = (
        await pg.owner.query(
          `SELECT webhook_secret_hash AS h, webhook_secret_enc AS e FROM ${k.table} WHERE webhook_secret = $1`,
          [legacy],
        )
      ).rows[0];
      expect(row.h).toBe(tokenHash(legacy));
      expect(crypto.decrypt(row.e)).toBe(legacy);
      await sealPlaintextSecrets(pg.owner, crypto, { targets: target, scrub: true });
      const left = await pg.owner.query(
        `SELECT webhook_secret AS s FROM ${k.table} WHERE webhook_secret_hash = $1`,
        [tokenHash(legacy)],
      );
      expect(left.rows[0].s).toBeNull();
      expect(await find(legacy)).toHaveLength(1);
      expect(await find('')).toHaveLength(0);
      expect(await find(`${k.kind}-nope-${'z'.repeat(30)}`)).toHaveLength(0);
    });
  }

  it('the repository writes hash + sealed copy, and the row reads back the plaintext secret from the sealed copy', async () => {
    const repo = new StoresRepository();
    const secret = `woo-new-${'q'.repeat(32)}`;
    process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR = 'off';
    const cols = tokenColumns(crypto, secret);
    delete process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR;
    const { row } = await privileged((tx) =>
      repo.upsertWoo(tx, org, {
        userId: null,
        storeUrl: 'https://new.test',
        storeName: null,
        storeCurrency: null,
        storeCountry: null,
        storeVersion: null,
        consumerKey: 'k',
        consumerSecret: 's',
        webhookSecret: cols,
      }),
    );
    expect(row.webhookSecret).toBeNull(); // mirror off: no plaintext in the row
    expect(tokenOf(crypto, { enc: row.webhookSecretEnc, plain: row.webhookSecret })).toBe(secret);
    const hit = await pg.owner.query(`SELECT * FROM ecom_store_lookup('woocommerce', $1)`, [
      secret,
    ]);
    expect(hit.rows).toHaveLength(1);
  });
});
