import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { tokenHash } from '../../../src/common/crypto/secret-columns';
import {
  SEAL_TARGETS,
  sealPlaintextSecrets,
} from '../../../src/common/crypto/seal-plaintext-secrets';
import { startTestPg, type TestPg } from '../../support/pg-it';

/**
 * Encryption audit E3: the public webhook routes of Telegram, LINE, Viber and WeChat find a channel by the token in the URL. The
 * lookup functions now match the token's SHA-256 as well as the legacy plaintext column, so a row can be backfilled and its
 * plaintext blanked without a URL that was already given to the provider ever changing.
 */
const crypto = new CryptoService({
  get: (n: string) =>
    n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? '' : randomBytes(32).toString('base64'),
} as unknown as ConfigService<never, true>);

const CHANNELS = [
  {
    table: 'telegram_bots',
    fn: 'tg_bot_lookup',
    cols: 'bot_token',
    vals: "'x'",
    target: 'telegram_bots.webhook_token',
  },
  {
    table: 'line_channels',
    fn: 'line_channel_lookup',
    cols: 'channel_access_token, channel_secret',
    vals: "'x', 'x'",
    target: 'line_channels.webhook_token',
  },
  {
    table: 'viber_channels',
    fn: 'vib_channel_lookup',
    cols: 'auth_token',
    vals: "'x'",
    target: 'viber_channels.webhook_token',
  },
  {
    table: 'wechat_channels',
    fn: 'wech_channel_lookup',
    cols: 'app_secret, verify_token',
    vals: "'x', 'x'",
    target: 'wechat_channels.webhook_token',
  },
] as const;

describe('channel webhook tokens are looked up by hash (E3)', () => {
  let pg: TestPg;
  let org: number;

  beforeAll(async () => {
    pg = await startTestPg();
    org = Number(
      (
        await pg.owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ('wt-hash','W','starter') RETURNING id`,
        )
      ).rows[0].id,
    );
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  });

  for (const c of CHANNELS) {
    it(`${c.table}: finds a legacy row, a backfilled row and a scrubbed row by the same token`, async () => {
      const legacy = `legacy-${c.table}-${'a'.repeat(30)}`;
      const fresh = `fresh-${c.table}-${'b'.repeat(30)}`;
      const find = async (token: string) =>
        (await pg.owner.query(`SELECT * FROM ${c.fn}($1)`, [token])).rows;
      const ins = (token: string, withHash: boolean) =>
        pg.owner.query(
          `INSERT INTO ${c.table} (org_id, ${c.cols}, webhook_token${withHash ? ', webhook_token_hash' : ''})
           VALUES ($1, ${c.vals}, ${withHash ? 'NULL, $2' : '$2'}) RETURNING id`,
          [org, withHash ? tokenHash(token) : token],
        );

      await ins(legacy, false); // a row written before this change: plaintext only
      expect(await find(legacy)).toHaveLength(1);

      const target = SEAL_TARGETS.filter((t) => t.name === c.target);
      expect(target).toHaveLength(1);
      const [r] = await sealPlaintextSecrets(pg.owner, crypto, { targets: target });
      expect(r!.done).toBeGreaterThanOrEqual(1);
      const row = (
        await pg.owner.query(
          `SELECT webhook_token_hash AS h, webhook_token_enc AS e FROM ${c.table} WHERE webhook_token = $1`,
          [legacy],
        )
      ).rows[0];
      expect(row.h).toBe(tokenHash(legacy));
      expect(crypto.decrypt(row.e)).toBe(legacy);
      expect(await find(legacy)).toHaveLength(1);

      await sealPlaintextSecrets(pg.owner, crypto, { targets: target, scrub: true });
      const left = await pg.owner.query(
        `SELECT webhook_token FROM ${c.table} WHERE webhook_token_hash = $1`,
        [tokenHash(legacy)],
      );
      expect(left.rows[0].webhook_token).toBeNull(); // the plaintext is gone
      expect(await find(legacy)).toHaveLength(1); // and the URL still resolves

      // A row written by the new release with the mirror off: no plaintext at all.
      await ins(fresh, true);
      expect(await find(fresh)).toHaveLength(1);
      // Nothing matches an empty or wrong token, even though scrubbed rows hold NULL.
      expect(await find('')).toHaveLength(0);
      expect(await find('nope-nope-nope-nope-nope')).toHaveLength(0);
    });
  }
});
