import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The workspace's Google account in the database (TW-GACC): the grant table keeps its tenant isolation with the three new columns, the
 * last-error pair cannot be half set, and the two permission keys exist and reach the admin presets. Run as the restricted application
 * role (a superuser bypasses every policy and would make the isolation assertions vacuous, see rls.spec.ts).
 */
describe('google account: the grant table and its permissions', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;

  const url = () => container.getConnectionUri();
  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  const insertGrant = (
    org: number,
    over: { client?: Client; cols?: string; vals?: unknown[] } = {},
  ) =>
    (over.client ?? owner).query(
      `INSERT INTO appointment_calendar_connections (org_id, refresh_token_enc, scopes${over.cols ? `, ${over.cols}` : ''})
       VALUES ($1, 'sealed', 'openid email' ${over.vals ? ', ' + over.vals.map((_, i) => `$${i + 2}`).join(', ') : ''}) RETURNING id`,
      [org, ...(over.vals ?? [])],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: url() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(url(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('gaa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('gab','B','starter') RETURNING id`,
    );
    const u = new URL(url());
    u.username = 'crm_app_user';
    u.password = 'test';
    app = new Client({ connectionString: u.toString() });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  const asOrg = async <T>(org: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };

  it('has the four new columns, empty by default', async () => {
    const id = Number((await insertGrant(orgA)).rows[0].id);
    const row = (
      await owner.query(
        `SELECT last_error_code, last_error_at, last_error_capability, last_used_at FROM appointment_calendar_connections WHERE id = $1`,
        [id],
      )
    ).rows[0];
    expect(row).toEqual({
      last_error_code: null,
      last_error_at: null,
      last_error_capability: null,
      last_used_at: null,
    });
    await owner.query(`DELETE FROM appointment_calendar_connections WHERE org_id = $1`, [orgA]);
  });

  it('refuses a last error without its time, and a time without its error', async () => {
    await expect(
      insertGrant(orgA, { cols: 'last_error_code', vals: ['GOOGLE_RATE_LIMITED'] }),
    ).rejects.toThrow(/chk_appointment_calendar_connections_last_error/);
    await expect(
      insertGrant(orgA, { cols: 'last_error_at', vals: ['2026-10-15T00:00:00Z'] }),
    ).rejects.toThrow(/chk_appointment_calendar_connections_last_error/);
    await expect(
      insertGrant(orgA, {
        cols: 'last_error_code, last_error_at, last_error_capability',
        vals: ['GOOGLE_RATE_LIMITED', '2026-10-15T00:00:00Z', 'gmail'],
      }),
    ).rejects.toThrow(/chk_appointment_calendar_connections_last_error_capability/);
    const ok = await insertGrant(orgA, {
      cols: 'last_error_code, last_error_at, last_error_capability',
      vals: ['GOOGLE_RATE_LIMITED', '2026-10-15T00:00:00Z', 'sheets'],
    });
    expect(ok.rows).toHaveLength(1);
    await owner.query(`DELETE FROM appointment_calendar_connections WHERE org_id = $1`, [orgA]);
  });

  it('keeps one grant per workspace, and shows a workspace only its own', async () => {
    await insertGrant(orgA);
    await insertGrant(orgB);
    await expect(insertGrant(orgA)).rejects.toThrow(/uq_appointment_calendar_connections_org/);
    const seen = await asOrg(orgA, async () =>
      (await app.query(`SELECT org_id FROM appointment_calendar_connections`)).rows.map((r) =>
        Number(r.org_id),
      ),
    );
    expect(seen).toEqual([orgA]);
    const none = await asOrg(
      orgA,
      async () =>
        (
          await app.query(`SELECT 1 FROM appointment_calendar_connections WHERE org_id = $1`, [
            orgB,
          ])
        ).rows,
    );
    expect(none).toEqual([]);
  });

  it('refuses writing a grant into another workspace, updating or deleting its row', async () => {
    await expect(asOrg(orgA, () => insertGrant(orgB, { client: app }))).rejects.toThrow(
      /row-level security/,
    );
    const updated = await asOrg(orgA, async () =>
      app.query(
        `UPDATE appointment_calendar_connections SET last_used_at = now() WHERE org_id = $1`,
        [orgB],
      ),
    );
    expect(updated.rowCount).toBe(0);
    const deleted = await asOrg(orgA, async () =>
      app.query(`DELETE FROM appointment_calendar_connections WHERE org_id = $1`, [orgB]),
    );
    expect(deleted.rowCount).toBe(0);
  });

  it('forces row security on the table', async () => {
    const r = (
      await owner.query(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'appointment_calendar_connections'`,
      )
    ).rows[0];
    expect(r).toEqual({ on: true, forced: true });
  });

  it('registers the two permission keys, and the admin presets hold them by baseline', async () => {
    const defs = (
      await owner.query(
        `SELECT key, category, supports_scope FROM permission_defs WHERE key LIKE 'google.account.%' ORDER BY key`,
      )
    ).rows;
    expect(defs).toEqual([
      { key: 'google.account.manage', category: 'integrations', supports_scope: false },
      { key: 'google.account.read', category: 'integrations', supports_scope: false },
    ]);
    const base = (
      await owner.query(
        `SELECT preset_key, permission_key FROM workspace_preset_baseline WHERE permission_key LIKE 'google.account.%' ORDER BY 1, 2`,
      )
    ).rows;
    expect(base).toEqual([
      { preset_key: 'admin', permission_key: 'google.account.manage' },
      { preset_key: 'admin', permission_key: 'google.account.read' },
      { preset_key: 'workspace_admin', permission_key: 'google.account.manage' },
      { preset_key: 'workspace_admin', permission_key: 'google.account.read' },
    ]);
  });

  // --- consent confirmations (TW-GACC-010) and drift (TW-GACC-011) ---------------------------------------------------------

  let consentUser = 0;
  const insertConsent = (
    org: number,
    over: { client?: Client; nonce?: string; caps?: string; status?: string } = {},
  ) =>
    (over.client ?? owner).query(
      `INSERT INTO google_consent_requests (org_id, nonce_hash, user_id, capabilities, return_to, status, expires_at)
       VALUES ($1, $2, $3, $4::text[], '/google-account', $5, now() + interval '10 minutes') RETURNING id`,
      [
        org,
        over.nonce ?? `n-${Math.random()}`,
        consentUser,
        over.caps ?? '{sheets}',
        over.status ?? 'pending',
      ],
    );

  it('keeps each consent confirmation in its own workspace, forced behind row security', async () => {
    consentUser = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, 'gc-a@example.test', 'A', 'x') RETURNING id`,
      [orgA],
    );
    await insertConsent(orgA);
    await insertConsent(orgB).catch(() => undefined); // the user belongs to orgA: the composite foreign key refuses orgB
    const seen = await asOrg(orgA, async () =>
      (await app.query(`SELECT org_id FROM google_consent_requests`)).rows.map((r) =>
        Number(r.org_id),
      ),
    );
    expect(new Set(seen)).toEqual(new Set([orgA]));
    expect(
      await asOrg(
        orgB,
        async () => (await app.query(`SELECT 1 FROM google_consent_requests`)).rows,
      ),
    ).toEqual([]);
    await expect(asOrg(orgB, () => insertConsent(orgA, { client: app }))).rejects.toThrow(
      /row-level security/,
    );
    const r = (
      await owner.query(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'google_consent_requests'`,
      )
    ).rows[0];
    expect(r).toEqual({ on: true, forced: true });
  });

  it('a consent is bound to a user of the same workspace, a known status and known capabilities, and its nonce is unique', async () => {
    await expect(insertConsent(orgB, { nonce: 'x-b' })).rejects.toThrow(
      /fk_google_consent_requests_user/,
    );
    await expect(insertConsent(orgA, { status: 'done' })).rejects.toThrow(
      /chk_google_consent_requests_status/,
    );
    await expect(insertConsent(orgA, { caps: '{gmail}' })).rejects.toThrow(
      /chk_google_consent_requests_capabilities/,
    );
    await expect(insertConsent(orgA, { caps: '{}' })).rejects.toThrow(
      /chk_google_consent_requests_capabilities/,
    );
    await insertConsent(orgA, { nonce: 'same' });
    await expect(insertConsent(orgA, { nonce: 'same' })).rejects.toThrow(
      /uq_google_consent_requests_nonce/,
    );
  });

  it('an appointment is drifted only with a reason from the list, and in sync or unchecked without one', async () => {
    const set = (state: string | null, reason: string | null) =>
      owner.query(
        `INSERT INTO appointments (org_id, title, starts_at, ends_at, google_sync_state, google_sync_reason)
         VALUES ($1, 'T', now(), now() + interval '30 minutes', $2, $3)`,
        [orgA, state, reason],
      );
    await expect(set('drifted', null)).rejects.toThrow(/chk_appointments_google_sync_reason/);
    await expect(set('in_sync', 'time_changed')).rejects.toThrow(
      /chk_appointments_google_sync_reason/,
    );
    await expect(set('drifted', 'whatever')).rejects.toThrow(/chk_appointments_google_sync_reason/);
    await expect(set('lost', null)).rejects.toThrow(/chk_appointments_google_sync_state/);
    await expect(set('unreadable', null)).rejects.toThrow(/chk_appointments_google_sync_reason/);
    await expect(set('unreadable', 'time_changed')).resolves.toBeDefined(); // a reason from the list is allowed for both states
    await set('unreadable', 'event_forbidden');
    await set('unreadable', 'event_unreadable');
    await expect(set('in_sync', 'event_forbidden')).rejects.toThrow(
      /chk_appointments_google_sync_reason/,
    );
    await set('drifted', 'event_deleted');
    await set('in_sync', null);
    await set(null, null);
    await owner.query(`DELETE FROM appointments WHERE org_id = $1`, [orgA]);
  });

  it('writing only the monitoring columns keeps row_version and updated_at; any other column bumps them', async () => {
    const id = Number(
      (
        await owner.query(
          `INSERT INTO appointments (org_id, title, starts_at, ends_at) VALUES ($1, 'RV', now(), now() + interval '30 minutes') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    const read = async () =>
      (
        await owner.query(
          `SELECT row_version, updated_at, google_checked_at FROM appointments WHERE org_id = $1 AND id = $2`,
          [orgA, id],
        )
      ).rows[0];
    const v0 = await read();
    await owner.query(
      `UPDATE appointments SET google_checked_at = now(), google_sync_state = 'in_sync', google_event_etag = '"1"' WHERE org_id = $1 AND id = $2`,
      [orgA, id],
    );
    const v1 = await read();
    expect(v1.row_version).toBe(v0.row_version);
    expect(v1.updated_at).toEqual(v0.updated_at);
    expect(v1.google_checked_at).not.toBeNull();
    // A monitoring column together with a real one is a real change.
    await owner.query(
      `UPDATE appointments SET google_checked_at = now(), title = 'RV2' WHERE org_id = $1 AND id = $2`,
      [orgA, id],
    );
    expect((await read()).row_version).toBe(v0.row_version + 1);
    await owner.query(`UPDATE appointments SET notes = 'n' WHERE org_id = $1 AND id = $2`, [
      orgA,
      id,
    ]);
    expect((await read()).row_version).toBe(v0.row_version + 2);
    await owner.query(`DELETE FROM appointments WHERE org_id = $1 AND id = $2`, [orgA, id]);
  });

  it('the grant carries the reconcile schedule, empty by default', async () => {
    const rows = (
      await owner.query(
        `SELECT next_reconcile_at, last_reconcile_at, reconcile_failures FROM appointment_calendar_connections`,
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toEqual({
        next_reconcile_at: null,
        last_reconcile_at: null,
        reconcile_failures: 0,
      });
    }
  });
});
