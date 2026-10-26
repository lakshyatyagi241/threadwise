import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The campaign list prices each campaign from usage_charges (a month-partitioned table) through the wamid of its recipients.
 * Without a created_at bound Postgres probes every month partition for every recipient (prod: 849k buffer hits, 838 ms for 19
 * campaigns). The join below is the one in campaigns.repository.ts; the source check keeps the two in step.
 */
const COST_JOIN = `
  SELECT c.id, cost.cost_minor
    FROM wpcampaigns c
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(u.credits) FILTER (WHERE u.status = 'charged'), 0)::bigint AS cost_minor
        FROM wp_campaign_contacts r
        JOIN usage_charges u ON u.org_id = r.org_id AND u.wamid = r.whatsapp_message_id AND u.created_at >= c.created_at
       WHERE r.org_id = c.org_id AND r.campaign_id = c.id AND r.whatsapp_message_id IS NOT NULL
    ) cost ON true
   WHERE c.org_id = 1`;

describe('campaign list cost join', () => {
  let container: StartedPostgreSqlContainer;
  let db: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    db = new Client({ connectionString: container.getConnectionUri() });
    await db.connect();
    await db.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    await db.query(
      `INSERT INTO organizations (id, slug, name, plan) VALUES (1,'oa','A','starter')`,
    );
    await db.query(
      `INSERT INTO wpcampaigns (org_id, id, campaign_name, created_at) VALUES (1, 1, 'c', now() - interval '1 hour')`,
    );
    await db.query(
      `INSERT INTO wp_campaign_contacts (org_id, id, campaign_id, whatsapp_message_id) VALUES (1,1,1,'wamid.NEW'), (1,2,1,'wamid.OLD')`,
    );
    await db.query(
      `INSERT INTO usage_charges (org_id, wamid, credits, currency, status, created_at) VALUES
         (1, 'wamid.NEW', 150, 'INR', 'charged', now()),
         (1, 'wamid.OLD', 999, 'INR', 'charged', now() - interval '3 months')`,
    );
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await container?.stop();
  });

  it('prices a campaign from charges made after it was created', async () => {
    const res = await db.query(COST_JOIN);
    expect(res.rows).toEqual([{ id: 1, cost_minor: 150 }]);
  });

  it('skips the usage_charges partitions older than the campaign', async () => {
    const plan = (await db.query(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${COST_JOIN}`)).rows
      .map((r) => r['QUERY PLAN'] as string)
      .join('\n');
    // runtime pruning shows as a partition scan that never ran
    expect(plan).toMatch(
      /usage_charges_\d{6}_org_id_wamid_idx on usage_charges_\d{6} \w+ \(never executed\)/,
    );
  });

  it('keeps that bound in the repository query', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../src/modules/campaigns/campaigns.repository.ts'),
      'utf8',
    );
    expect(src).toContain('u.wamid = r.whatsapp_message_id AND u.created_at >= c.created_at');
  });
});
