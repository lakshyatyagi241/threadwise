import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleCalendarConnectionRepository } from '../../../src/modules/appointments-booking/google-calendar-connection.repository';

// The owner connection arranges rows; the restricted application role is what row-level security judges. Read from the process
// environment: the .env file is not part of this checkout.
const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
const APP_URL = `${OWNER_URL}${OWNER_URL.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;

/**
 * Issue #1182: a refresh failure from an old grant flagged a freshly reconnected calendar as needs_reconnect, because the update
 * matched only the connection, not the refresh token that failed. The update now matches the refresh token the failure was about.
 */
describe('calendar needs_reconnect is set only for the grant that failed (#1182)', () => {
  let owner: Client;
  let app: Pool;
  let orgId: number;
  let connId: number;
  const repo = new GoogleCalendarConnectionRepository();

  const inOrg = <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
    drizzle(app).transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${String(orgId)}, true)`);
      return fn(tx as never);
    });

  const status = async () =>
    (
      await owner.query(
        'SELECT status, refresh_token_enc FROM appointment_calendar_connections WHERE org_id = $1 AND id = $2',
        [orgId, connId],
      )
    ).rows[0] as { status: string; refresh_token_enc: string };

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new Pool({ connectionString: APP_URL, max: 4 });
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
      [`calendar-reconnect-${Date.now()}`],
    );
    orgId = Number(org.rows[0].id);
    const conn = await owner.query(
      `INSERT INTO appointment_calendar_connections (org_id, refresh_token_enc, calendar_id, status, status_at, connected_at, reconcile_failures)
       VALUES ($1, 'grant-old', 'primary', 'active', now(), now(), 0) RETURNING id`,
      [orgId],
    );
    connId = Number(conn.rows[0].id);
  });

  afterAll(async () => {
    await app.end();
    await owner.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await owner.end();
  });

  it('does not flag a reconnected calendar when a stale grant fails', async () => {
    // The admin reconnects while a refresh made with the old grant is still failing.
    await owner.query(
      `UPDATE appointment_calendar_connections SET refresh_token_enc = 'grant-new' WHERE org_id = $1 AND id = $2`,
      [orgId, connId],
    );
    const flagged = await inOrg((tx) =>
      repo.markNeedsReconnect(tx, orgId, connId, 'invalid_grant', 'grant-old'),
    );
    expect(flagged).toBe(false);
    expect(await status()).toEqual({ status: 'active', refresh_token_enc: 'grant-new' });
  });

  it('flags the grant that actually failed', async () => {
    const flagged = await inOrg((tx) =>
      repo.markNeedsReconnect(tx, orgId, connId, 'invalid_grant', 'grant-new'),
    );
    expect(flagged).toBe(true);
    expect((await status()).status).toBe('needs_reconnect');
  });
});
