import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlowsRepository } from '../../../src/modules/flow-builder-editor/flows.repository';

const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
const APP_URL = `${OWNER_URL}${OWNER_URL.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;

/**
 * Issue #1165: saving a flow read every bot in the workspace to check its subflow links. The check needs only the bots the graph links
 * to, so the read is limited to those ids.
 */
describe('flow link targets are read only for the bots a graph links to (#1165)', () => {
  let owner: Client;
  let app: Pool;
  let orgId: number;
  let a: string;
  let b: string;
  const repo = new FlowsRepository();

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
      [`links-${Date.now()}`],
    );
    orgId = Number(org.rows[0].id);
    a = (
      await owner.query(`INSERT INTO flows (org_id, flow_name) VALUES ($1, 'a') RETURNING uuid`, [
        orgId,
      ])
    ).rows[0].uuid;
    b = (
      await owner.query(`INSERT INTO flows (org_id, flow_name) VALUES ($1, 'b') RETURNING uuid`, [
        orgId,
      ])
    ).rows[0].uuid;
    await owner.query(`INSERT INTO flows (org_id, flow_name) VALUES ($1, 'c')`, [orgId]);
  });

  afterAll(async () => {
    await app.end();
    await owner.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await owner.end();
  });

  it('returns only the linked bots', async () => {
    const rows = await inOrg((tx) => repo.linkTargets(tx, orgId, [a]));
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it('reads nothing for a graph with no links', async () => {
    expect(await inOrg((tx) => repo.linkTargets(tx, orgId, []))).toEqual([]);
  });

  it('ignores an id that is not a bot of this workspace', async () => {
    const rows = await inOrg((tx) =>
      repo.linkTargets(tx, orgId, [a, b, '00000000-0000-4000-8000-000000000000']),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  });
});
