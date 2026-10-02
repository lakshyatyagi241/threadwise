import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, OWNER_URL } from '../bsp-billing-engine/live-db';

/**
 * The wallet tables against the real migrated schema. Constraint and trigger checks use the owner connection (owners skip RLS but
 * never CHECK, UNIQUE, FK or triggers); isolation checks use the restricted application role, because a superuser would make
 * every policy assertion vacuous.
 */
describe('wallet schema: ledger rules, immutability, isolation', () => {
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  const created: number[] = [];

  const asOrg = async <T>(orgId: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };

  const post = (orgId: number, over: Record<string, unknown> = {}) => {
    const v: Record<string, string | undefined> = {
      type: 'topup',
      direction: 'in',
      amount: '10.00',
      balance_after: '10.00',
      key: `k-${Math.random()}`,
      ...over,
    };
    return owner.query(
      `INSERT INTO wallet_transactions (org_id, kind, type, direction, amount, balance_after, idempotency_key, note, actor_type, actor_label)
       VALUES ($1, 'credit', $2, $3, $4::numeric, $5::numeric, $6, $7, $8, $9) RETURNING id`,
      [
        orgId,
        v.type,
        v.direction,
        v.amount,
        v.balance_after,
        v.key,
        v.note ?? null,
        v.actor_type ?? 'system',
        v.actor_label ?? null,
      ],
    );
  };

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    app = new Client({ connectionString: APP_URL });
    await Promise.all([owner.connect(), app.connect()]);
    const mk = async (slug: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
            [`walsch-${slug}-${Date.now()}`],
          )
        ).rows[0].id,
      );
    orgA = await mk('a');
    orgB = await mk('b');
    created.push(orgA, orgB);
  });

  afterAll(async () => {
    // The trail is append-only, yet deleting a workspace removes it with the workspace (the foreign key's own cascade).
    if (created.length)
      await owner.query(`DELETE FROM organizations WHERE id = ANY($1)`, [created]);
    await owner
      .query(`DELETE FROM wallet_platform_log WHERE event = 'wallet.test'`)
      .catch(() => undefined);
    await Promise.all([owner.end(), app.end()]);
  });

  it('the application role is neither a superuser nor able to bypass RLS (else every isolation check is vacuous)', async () => {
    const r = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  describe('wallet_transactions', () => {
    it('stores money in with a positive amount and money out with a negative one, and refuses the mismatch (the sign bug of Reference)', async () => {
      await expect(post(orgA, { direction: 'in', amount: '5.00' })).resolves.toBeTruthy();
      await expect(
        post(orgA, { type: 'spend', direction: 'out', amount: '-5.00', balance_after: '5.00' }),
      ).resolves.toBeTruthy();
      await expect(post(orgA, { type: 'spend', direction: 'out', amount: '5.00' })).rejects.toThrow(
        /chk_wallet_transactions_direction/,
      );
      await expect(post(orgA, { direction: 'in', amount: '-5.00' })).rejects.toThrow(
        /chk_wallet_transactions_direction/,
      );
      await expect(post(orgA, { direction: 'in', amount: '0' })).rejects.toThrow(
        /chk_wallet_transactions_direction/,
      );
    });

    it('refuses an unknown type', async () => {
      await expect(post(orgA, { type: 'bonus' })).rejects.toThrow(/chk_wallet_transactions_type/);
    });

    it('refuses a manual adjustment without a note, with a short note, or without an operator named', async () => {
      const base = {
        type: 'admin_adjust',
        actor_type: 'platform_operator',
        actor_label: 'Ops <ops@x.test>',
      };
      await expect(post(orgA, { ...base })).rejects.toThrow(/chk_wallet_transactions_adjust_note/);
      await expect(post(orgA, { ...base, note: '    ' })).rejects.toThrow(
        /chk_wallet_transactions_adjust_note/,
      );
      await expect(post(orgA, { ...base, note: 'oops' })).rejects.toThrow(
        /chk_wallet_transactions_adjust_note/,
      );
      await expect(
        post(orgA, { ...base, note: 'Goodwill after the outage', actor_label: null }),
      ).rejects.toThrow(/chk_wallet_transactions_adjust_note/);
      await expect(
        post(orgA, { ...base, note: 'Goodwill after the outage', actor_type: 'system' }),
      ).rejects.toThrow(/chk_wallet_transactions_adjust_note/);
      await expect(
        post(orgA, { ...base, note: 'Goodwill after the outage' }),
      ).resolves.toBeTruthy();
    });

    it('makes a posting happen once per idempotency key', async () => {
      await post(orgA, { key: 'order:dup' });
      await expect(post(orgA, { key: 'order:dup' })).rejects.toThrow(
        /uq_wallet_transactions_idempotency_key/,
      );
      // the same key in another workspace is a different posting
      await expect(post(orgB, { key: 'order:dup' })).resolves.toBeTruthy();
    });

    it('is append-only: an entry can be neither edited nor deleted by the application', async () => {
      const id = (await post(orgA)).rows[0].id;
      await expect(
        owner.query(`UPDATE wallet_transactions SET amount = 99 WHERE org_id = $1 AND id = $2`, [
          orgA,
          id,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        owner.query(
          `UPDATE wallet_transactions SET note = 'edited' WHERE org_id = $1 AND id = $2`,
          [orgA, id],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        owner.query(`DELETE FROM wallet_transactions WHERE org_id = $1 AND id = $2`, [orgA, id]),
      ).rejects.toThrow(/append-only/);
      await asOrg(orgA, async () => {
        await expect(
          app.query(`DELETE FROM wallet_transactions WHERE org_id = $1`, [orgA]),
        ).rejects.toThrow(/append-only/);
      });
    });

    it('lets the user reference go to NULL when the user is deleted, and nothing else change', async () => {
      const u = await owner.query(
        `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Walt') RETURNING id`,
        [orgA, `walt-${Date.now()}@wallet.test`],
      );
      const userId = u.rows[0].id;
      const ins = await owner.query(
        `INSERT INTO wallet_transactions (org_id, user_id, kind, type, direction, amount, balance_after, idempotency_key)
         VALUES ($1, $2, 'credit', 'topup', 'in', 1, 1, $3) RETURNING id`,
        [orgA, userId, `u-${Date.now()}`],
      );
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, userId]);
      const after = await owner.query(
        `SELECT user_id FROM wallet_transactions WHERE org_id = $1 AND id = $2`,
        [orgA, ins.rows[0].id],
      );
      expect(after.rows[0].user_id).toBeNull();
    });

    it('hides a workspace ledger from every other workspace', async () => {
      await post(orgB, { key: `iso-${Date.now()}` });
      await asOrg(orgA, async () => {
        const seen = await app.query(`SELECT DISTINCT org_id FROM wallet_transactions`);
        expect(seen.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
      });
    });

    it('refuses to write a ledger row into another workspace', async () => {
      await asOrg(orgA, async () => {
        await expect(
          app.query(
            `INSERT INTO wallet_transactions (org_id, kind, type, direction, amount, balance_after, idempotency_key)
             VALUES ($1, 'credit', 'topup', 'in', 1, 1, 'x-iso')`,
            [orgB],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });
  });

  describe('wallets', () => {
    it('never holds a negative balance, and reserved never exceeds balance', async () => {
      await expect(
        owner.query(`INSERT INTO wallets (org_id, unit, balance) VALUES ($1, 'USD', -1)`, [orgA]),
      ).rejects.toThrow(/chk_wallet_invariant/);
      await expect(
        owner.query(
          `INSERT INTO wallets (org_id, unit, balance, reserved) VALUES ($1, 'USD', 1, 2)`,
          [orgA],
        ),
      ).rejects.toThrow(/chk_wallet_invariant/);
    });

    it('is one wallet per workspace and unit, and isolated', async () => {
      await owner.query(
        `INSERT INTO wallets (org_id, unit, balance) VALUES ($1, 'USD', 3), ($2, 'USD', 4)`,
        [orgA, orgB],
      );
      await expect(
        owner.query(`INSERT INTO wallets (org_id, unit) VALUES ($1, 'USD')`, [orgA]),
      ).rejects.toThrow(/uq_wallets_unit/);
      await asOrg(orgB, async () => {
        const seen = await app.query(`SELECT org_id, balance::text FROM wallets`);
        expect(seen.rows).toEqual([{ org_id: String(orgB), balance: '4.0000' }]);
      });
    });
  });

  describe('usage_charge_keys, usage_charges, wallet_usage_months', () => {
    it('claims a provider message id once per workspace', async () => {
      await owner.query(
        `INSERT INTO usage_charge_keys (org_id, provider_message_id) VALUES ($1, 'wamid.1')`,
        [orgA],
      );
      await expect(
        owner.query(
          `INSERT INTO usage_charge_keys (org_id, provider_message_id) VALUES ($1, 'wamid.1')`,
          [orgA],
        ),
      ).rejects.toThrow(/uq_usage_charge_keys_message/);
      await expect(
        owner.query(
          `INSERT INTO usage_charge_keys (org_id, provider_message_id) VALUES ($1, '  ')`,
          [orgA],
        ),
      ).rejects.toThrow(/chk_usage_charge_keys_message/);
      await expect(
        owner.query(
          `INSERT INTO usage_charge_keys (org_id, provider_message_id) VALUES ($1, 'wamid.1')`,
          [orgB],
        ),
      ).resolves.toBeTruthy();
    });

    it('limits a charge to a known status, a known free reason and non-negative amounts', async () => {
      const ins = (over: string) =>
        owner.query(
          `INSERT INTO usage_charges (org_id, wamid, ${over.split('|')[0]}) VALUES ($1, 'w', ${over.split('|')[1]})`,
          [orgA],
        );
      await expect(ins(`status|'paid'`)).rejects.toThrow(/chk_usage_charges_status/);
      await expect(ins(`free_reason|'because'`)).rejects.toThrow(/chk_usage_charges_free_reason/);
      await expect(ins(`credits|-1`)).rejects.toThrow(/chk_usage_charges_amounts/);
      await expect(ins(`billing_mode|'prepaid'`)).rejects.toThrow(/chk_usage_charges_mode/);
    });

    it('keeps the month counter on the first of a month, once per workspace', async () => {
      await expect(
        owner.query(`INSERT INTO wallet_usage_months (org_id, month) VALUES ($1, '2026-10-15')`, [
          orgA,
        ]),
      ).rejects.toThrow(/chk_wallet_usage_months_first_day/);
      await owner.query(
        `INSERT INTO wallet_usage_months (org_id, month, messages) VALUES ($1, '2026-10-01', 1)`,
        [orgA],
      );
      await expect(
        owner.query(`INSERT INTO wallet_usage_months (org_id, month) VALUES ($1, '2026-10-01')`, [
          orgA,
        ]),
      ).rejects.toThrow(/uq_wallet_usage_months_month/);
    });

    it('isolates the claim table and the counter', async () => {
      await asOrg(orgA, async () => {
        const keys = await app.query(`SELECT DISTINCT org_id FROM usage_charge_keys`);
        expect(keys.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
        const months = await app.query(`SELECT DISTINCT org_id FROM wallet_usage_months`);
        expect(months.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
      });
    });
  });

  describe('wallet_events and wallet_platform_log', () => {
    it('is append-only and isolated per workspace', async () => {
      await owner.query(
        `INSERT INTO wallet_events (org_id, event, message) VALUES ($1, 'wallet.test', 'a'), ($2, 'wallet.test', 'b')`,
        [orgA, orgB],
      );
      await expect(
        owner.query(`UPDATE wallet_events SET message = 'x' WHERE org_id = $1`, [orgA]),
      ).rejects.toThrow(/append-only/);
      await expect(
        owner.query(`DELETE FROM wallet_events WHERE org_id = $1`, [orgA]),
      ).rejects.toThrow(/append-only/);
      await asOrg(orgA, async () => {
        const seen = await app.query(`SELECT DISTINCT org_id FROM wallet_events`);
        expect(seen.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
      });
    });

    it('survives the removal of the operator it names: the row stays, the operator goes to NULL', async () => {
      const op = await owner.query(
        `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ($1, 'Gone', 'x', 'support') RETURNING id`,
        [`gone-${Date.now()}@platform.test`],
      );
      const log = await owner.query(
        `INSERT INTO wallet_platform_log (event, message, operator_id) VALUES ('wallet.test', 'by gone', $1) RETURNING id`,
        [op.rows[0].id],
      );
      await owner.query(`DELETE FROM platform_operators WHERE id = $1`, [op.rows[0].id]);
      const after = await owner.query(`SELECT operator_id FROM wallet_platform_log WHERE id = $1`, [
        log.rows[0].id,
      ]);
      expect(after.rows[0].operator_id).toBeNull();
      await expect(
        owner.query(`UPDATE wallet_platform_log SET message = 'x' WHERE id = $1`, [log.rows[0].id]),
      ).rejects.toThrow(/append-only/);
      await owner.query(`SELECT set_config('app.privileged', 'on', false)`);
      await owner.query(`DELETE FROM wallet_platform_log WHERE id = $1`, [log.rows[0].id]);
      await owner.query(`SELECT set_config('app.privileged', 'off', false)`);
    });

    it('limits severity', async () => {
      await expect(
        owner.query(
          `INSERT INTO wallet_events (org_id, event, severity, message) VALUES ($1, 'e', 'fatal', 'm')`,
          [orgA],
        ),
      ).rejects.toThrow(/chk_wallet_events_severity/);
    });

    it('is invisible to a workspace: only a privileged session reads or writes the platform log', async () => {
      await asOrg(orgA, async () => {
        const seen = await app.query(`SELECT count(*)::int AS n FROM wallet_platform_log`);
        expect(seen.rows[0].n).toBe(0);
        await expect(
          app.query(`INSERT INTO wallet_platform_log (event, message) VALUES ('x', 'y')`),
        ).rejects.toThrow(/row-level security/);
      });
    });
  });

  describe('message_rates', () => {
    it('ships the 16-row starter card in the unit the grid shows (hundredths)', async () => {
      const r = await owner.query(
        `SELECT count(*)::int AS n FROM message_rates WHERE country_code IN ('', 'IN', 'US', 'GB', 'BR', 'AE', 'MX')`,
      );
      expect(r.rows[0].n).toBeGreaterThanOrEqual(16);
      const us = await owner.query(
        `SELECT credits FROM message_rates WHERE country_code = 'US' AND category = 'marketing'`,
      );
      expect(us.rows[0].credits).toBe(1200);
    });

    it('refuses a malformed country, an unknown category and a negative price or cost', async () => {
      const ins = (c: string, cat: string, p: number, m: number | null) =>
        owner.query(
          `INSERT INTO message_rates (country_code, category, credits, meta_cost_micros) VALUES ($1, $2, $3, $4)`,
          [c, cat, p, m],
        );
      await expect(ins('usa', '', 1, null)).rejects.toThrow(/chk_message_rates_country/);
      await expect(ins('us', '', 1, null)).rejects.toThrow(/chk_message_rates_country/);
      await expect(ins('QQ', 'vip', 1, null)).rejects.toThrow(/chk_message_rates_category/);
      await expect(ins('QQ', '', -1, null)).rejects.toThrow(/chk_message_rates_amounts/);
      await expect(ins('QQ', '', 1, -5)).rejects.toThrow(/chk_message_rates_amounts/);
    });

    it('lets every workspace read the card but only a privileged session change it', async () => {
      await asOrg(orgA, async () => {
        const seen = await app.query(`SELECT count(*)::int AS n FROM message_rates`);
        expect(seen.rows[0].n).toBeGreaterThan(0);
        await expect(
          app.query(
            `INSERT INTO message_rates (country_code, category, credits) VALUES ('QQ', '', 1)`,
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });
  });
});
