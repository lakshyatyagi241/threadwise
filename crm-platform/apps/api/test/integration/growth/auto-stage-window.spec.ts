import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GrowthRepository } from '../../../src/modules/growth-pilot/growth.repository';

const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
const APP_URL = `${OWNER_URL}${OWNER_URL.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;

/**
 * Issue #1181: the auto-stage query took the 200 most confident suggestions and only then dropped the ones it would not apply. Rows it
 * dropped filled the window, so the run could apply nothing. The eligible stage moves are now part of the query.
 */
describe('auto-stage candidates fill the window with moves that can apply (#1181)', () => {
  let owner: Client;
  let app: Pool;
  let orgId: number;
  const repo = new GrowthRepository();

  const inOrg = <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
    drizzle(app).transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${String(orgId)}, true)`);
      return fn(tx as never);
    });

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new Pool({ connectionString: APP_URL, max: 4 });
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
      [`autostage-${Date.now()}`],
    );
    orgId = Number(org.rows[0].id);
    // One pending suggestion per contact: three ineligible moves (into a lost stage) with the highest confidence, then one eligible
    // move below them.
    const moves: Array<[string, string, number]> = [
      ['lead', 'lost', 0.99],
      ['lead', 'lost', 0.98],
      ['lead', 'lost', 0.97],
      ['lead', 'qualified', 0.5],
    ];
    for (const [from, to, conf] of moves) {
      const contact = await owner.query(`INSERT INTO contacts (org_id) VALUES ($1) RETURNING id`, [
        orgId,
      ]);
      await owner.query(
        `INSERT INTO lifecycle_stage_suggestions (org_id, contact_id, from_stage, to_stage, confidence) VALUES ($1, $2, $3, $4, $5)`,
        [orgId, Number(contact.rows[0].id), from, to, conf],
      );
    }
  });

  afterAll(async () => {
    await app.end();
    await owner.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await owner.end();
  });

  it('returns only eligible moves, so a small window still reaches them', async () => {
    const rows = await inOrg((tx) =>
      repo.autoStageCandidates(tx, orgId, 0.3, 2, [{ from: 'lead', to: 'qualified' }], null),
    );
    expect(rows.map((r) => r.toStage)).toEqual(['qualified']);
  });
});
