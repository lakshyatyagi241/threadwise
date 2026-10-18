import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import {
  PersonalDataErasureService,
  ALL_TIERS,
} from '../../../src/modules/privacy/engine/erasure.service';
import { SubjectResolver } from '../../../src/modules/privacy/engine/subject-resolver';

/**
 * The call-logging framework (call_log_entries, telephony_click_calls) keeps a customer's number, so an erasure has to reach it.
 *
 * `telephony_click_calls` was created without a registry entry, which failed `registry.spec.ts`. The registry test proves the entry
 * exists and fits the schema; this one proves the real erasure pipeline, on a real migrated Postgres, does what the entry says: a click
 * placement still waiting for the provider's callback is deleted (found by contact id AND by number, because `contact_id` is
 * ON DELETE SET NULL and a placement can outlive its contact link), and the call log entry keeps the call without the number.
 */
describe('privacy: erasing a person reaches the call-logging tables', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let orgId: number;
  let connectionId: number;
  let other: number;
  let seq = 0;

  const OTHER_PHONE = '+919812300088';

  /** A fresh person with their own number per test: the subject tier of a real erasure rewrites the contact row. */
  async function person(): Promise<{ id: number; phone: string }> {
    seq += 1;
    const phone = `+91981230${String(1000 + seq)}`;
    const id = await one(
      `INSERT INTO contacts (org_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, `Rita Sharma ${seq}`, phone],
    );
    return { id, phone };
  }

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  const placement = (externalId: string, contactId: number | null, phone: string) =>
    one(
      `INSERT INTO telephony_click_calls (org_id, connection_id, external_id, user_id, contact_id, customer_phone)
       VALUES ($1, $2, $3, NULL, $4, $5) RETURNING id`,
      [orgId, connectionId, externalId, contactId, phone],
    );

  const entry = (externalId: string, contactId: number | null, phone: string) =>
    one(
      `INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at, contact_id, customer_phone, our_phone, notes, external_id)
       VALUES ($1, 'telephony', 'outbound', 'connected', now(), $2, $3, '+911140000000', $4, $5) RETURNING id`,
      [orgId, contactId, phone, `spoke to the customer on ${phone}`, externalId],
    );

  const placementIds = async (): Promise<number[]> =>
    (
      await owner.query(`SELECT id FROM telephony_click_calls WHERE org_id = $1 ORDER BY id`, [
        orgId,
      ])
    ).rows.map((r) => Number(r.id));

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    orgId = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('call-erase','Call Erase Org','starter') RETURNING id`,
    );
    connectionId = await one(
      `INSERT INTO telephony_connections (org_id, provider, label, numbers, webhook_secret_cipher, secret_hint)
       VALUES ($1, 'generic', 'Sales line', ARRAY['+911140000000'], 'v1:sealed', 'abcd') RETURNING id`,
      [orgId],
    );
    other = await one(
      `INSERT INTO contacts (org_id, name, phone) VALUES ($1, 'Omar Khan', $2) RETURNING id`,
      [orgId, OTHER_PHONE],
    );
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it("a dry run counts the person's waiting placements and changes nothing", async () => {
    const rita = await person();
    await placement('click-dry-linked', rita.id, rita.phone);
    const before = await placementIds();
    const run = await eraseOnce(rita.id, 'delete', true);
    const line = run.report.lines.find((l) => l.table === 'telephony_click_calls');
    expect(line?.disposition).toBe('deleted');
    expect(line?.count).toBe(1);
    expect(await placementIds()).toEqual(before);
    await owner.query(`DELETE FROM telephony_click_calls WHERE org_id = $1`, [orgId]);
  });

  for (const mode of ['delete', 'anonymise'] as const) {
    it(`history mode "${mode}": waiting placements are deleted by contact and by number, another person's stay`, async () => {
      const rita = await person();
      const linked = await placement(`click-linked-${mode}`, rita.id, rita.phone);
      // The contact link was set to NULL (the contact row went, or the click had no contact): only the number is left to find it by.
      const unlinked = await placement(`click-unlinked-${mode}`, null, rita.phone);
      const others = await placement(`click-other-${mode}`, other, OTHER_PHONE);

      const run = await eraseOnce(rita.id, mode, false);
      const line = run.report.lines.find((l) => l.table === 'telephony_click_calls');
      expect(line?.disposition).toBe('deleted');
      expect(line?.count).toBe(2);

      const left = await placementIds();
      expect(left).not.toContain(linked);
      expect(left).not.toContain(unlinked);
      expect(left).toContain(others);
      await owner.query(`DELETE FROM telephony_click_calls WHERE org_id = $1`, [orgId]);
    });
  }

  it('a call log entry keeps the call but loses the number, the notes and the provider call id', async () => {
    const rita = await person();
    const mine = await entry('provider-call-1', rita.id, rita.phone);
    const theirs = await entry('provider-call-2', other, OTHER_PHONE);

    await eraseOnce(rita.id, 'delete', false);

    const row = (
      await owner.query(
        `SELECT customer_phone, our_phone, notes, external_id, direction, outcome FROM call_log_entries WHERE id = $1`,
        [mine],
      )
    ).rows[0];
    expect(row.customer_phone).toBeNull();
    expect(row.our_phone).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.external_id).toBeNull();
    expect(row.direction).toBe('outbound');
    expect(row.outcome).toBe('connected');

    const untouched = (
      await owner.query(`SELECT customer_phone, notes FROM call_log_entries WHERE id = $1`, [
        theirs,
      ])
    ).rows[0];
    expect(untouched.customer_phone).toBe(OTHER_PHONE);
    expect(untouched.notes).toContain(OTHER_PHONE);
  });

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    await owner.query('BEGIN');
    try {
      const out = await fn(drizzle(owner) as unknown as Tx);
      await owner.query('COMMIT');
      return out;
    } catch (err) {
      await owner.query('ROLLBACK');
      throw err;
    }
  }

  function eraseOnce(contactId: number, mode: 'delete' | 'anonymise', dryRun: boolean) {
    return inTx(async (tx) => {
      const subject = await new SubjectResolver().resolve(tx, orgId, {
        kind: 'contact',
        contactId,
      });
      return new PersonalDataErasureService(new SubjectResolver()).run(tx, {
        orgId,
        requestId: null,
        subject,
        tiers: ALL_TIERS,
        mode,
        dryRun,
      });
    });
  }
});
