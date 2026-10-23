import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The recipients page finds the page of ids on the recipient table alone and joins the contact only for those rows (QA task 45: on
 * 300,000 recipients page 3,000 went from 1.5 s to 60 ms). It must return exactly the rows, in the order, the plain
 * `ORDER BY r.id DESC LIMIT OFFSET` returned. The two statements below are the ones in campaigns.repository.ts `recipientsPage`; the
 * source check keeps them in step.
 */
const SELECT = `SELECT r.id, c.uuid AS contact_uuid, r.status,
  coalesce(nullif(r.recipient_name, ''), c.name) AS recipient_name
  FROM wp_campaign_contacts r LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id`;
const where = (status?: string) =>
  `r.org_id = 1 AND r.campaign_id = 1${status ? ` AND r.status = '${status}'` : ''}`;
const plain = (status: string | undefined, off: number) =>
  `${SELECT} WHERE ${where(status)} ORDER BY r.id DESC LIMIT 7 OFFSET ${off}`;
const idsFirst = (status: string | undefined, off: number) =>
  `${SELECT} WHERE r.org_id = 1 AND r.id IN (SELECT r.id FROM wp_campaign_contacts r WHERE ${where(status)} ORDER BY r.id DESC LIMIT 7 OFFSET ${off}) ORDER BY r.id DESC`;

describe('campaign recipients page', () => {
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
    await db.query(`INSERT INTO wpcampaigns (org_id, id, campaign_name) VALUES (1, 1, 'c')`);
    await db.query(
      `INSERT INTO contacts (org_id, id, name, phone) SELECT 1, g, 'Contact ' || g, '91990' || lpad(g::text, 6, '0') FROM generate_series(1, 100) g`,
    );
    // 120 recipients: 100 with a contact (every third has its own name), 20 without one; statuses rotate
    await db.query(
      `INSERT INTO wp_campaign_contacts (org_id, id, campaign_id, contact_id, status, recipient_name)
       SELECT 1, g, 1, CASE WHEN g <= 100 THEN g END, (ARRAY['queued','sent','delivered','read','failed'])[1 + g % 5],
              CASE WHEN g % 3 = 0 THEN 'Own name ' || g END FROM generate_series(1, 120) g`,
    );
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await container?.stop();
  });

  it.each([undefined, 'delivered', 'failed'])(
    'returns the same rows in the same order as the plain query at every depth (status %s)',
    async (status) => {
      for (const off of [0, 1, 6, 7, 40, 100, 118, 119, 500]) {
        const a = (await db.query(plain(status, off))).rows;
        const b = (await db.query(idsFirst(status, off))).rows;
        expect(b, `offset ${off}`).toEqual(a);
      }
    },
  );

  it('is the statement the repository runs', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../src/modules/campaigns/campaigns.repository.ts'),
      'utf8',
    );
    expect(src).toContain('r.id IN (');
    expect(src).toMatch(
      /SELECT r\.id FROM wp_campaign_contacts r WHERE \$\{where\} ORDER BY r\.id DESC LIMIT \$\{o\.limit\} OFFSET \$\{o\.offset\}\)/,
    );
  });
});
