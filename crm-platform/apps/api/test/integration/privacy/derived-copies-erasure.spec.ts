import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  PersonalDataErasureService,
  ALL_TIERS,
} from '../../../src/modules/privacy/engine/erasure.service';
import { SubjectResolver } from '../../../src/modules/privacy/engine/subject-resolver';
import { companyBriefs, revenueExports } from '../../../src/modules/privacy/manifests/derived';
import type { PrivacyCtx } from '../../../src/modules/privacy/registry/types';
import { RevenueExportRepository } from '../../../src/modules/crm/revenue-report/revenue-export.repository';
import { LegalHoldGuard } from '../../../src/modules/privacy/legal-holds/legal-hold.guard';

/** These tests hold nobody: the guard only reads through the transaction it is given, so it needs no database service of its own. */
const noHold = new LegalHoldGuard(null as never);

/**
 * Derived convenience copies leave with the person they were derived from (owner decision, legal reasoning in
 * `src/modules/privacy/manifests/derived.ts`), on a real migrated Postgres and through the real erasure service:
 *
 *  - a staff member is erased: the revenue exports they asked for or were mailed, with their stored file (it is the `file_gz` column of
 *    the row: there is no object store), and the AI briefs they generated are gone;
 *  - a buyer (contact) is erased: every unexpired export of the workspace is purged (the row does not record whom a file lists) and so
 *    are the briefs of the companies the contact is linked to; a contact who never bought anything purges no export;
 *  - another workspace, other members' briefs of unrelated companies and expired export rows are untouched;
 *  - each purge writes one audit row (a count, never a value), and no other audit row is changed.
 */
describe('privacy: erasing a person removes their derived copies', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let seq = 0;

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  interface World {
    org: number;
    alice: number; // the staff member who is erased
    bob: number; // another member of the same workspace
    aliceMail: string;
    buyer: number; // a contact with an invoice, linked to company `acme`
    buyerPhone: string;
    stranger: number; // a contact with no invoice, linked to company `globex`
    acme: number;
    globex: number;
    initech: number; // a company nobody erased is linked to
  }

  /** A fresh workspace per test, so tests never see each other's rows. */
  async function world(): Promise<World> {
    seq += 1;
    const org = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $2, 'starter') RETURNING id`,
      [`derived-${seq}`, `Derived ${seq}`],
    );
    const aliceMail = `alice${seq}@staff.example`;
    const alice = await one(
      `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Alice Staff') RETURNING id`,
      [org, aliceMail],
    );
    const bob = await one(
      `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Bob Staff') RETURNING id`,
      [org, `bob${seq}@staff.example`],
    );
    const company = (name: string) =>
      one(`INSERT INTO companies (org_id, name) VALUES ($1, $2) RETURNING id`, [org, name]);
    const acme = await company('Acme Traders');
    const globex = await company('Globex');
    const initech = await company('Initech');
    const buyerPhone = `+9198100${String(10000 + seq)}`;
    const buyer = await one(
      `INSERT INTO contacts (org_id, name, phone, company_id) VALUES ($1, 'Rita Buyer', $2, $3) RETURNING id`,
      [org, buyerPhone, acme],
    );
    const stranger = await one(
      `INSERT INTO contacts (org_id, name, phone, company_id) VALUES ($1, 'Sam Stranger', $2, $3) RETURNING id`,
      [org, `+9198200${String(10000 + seq)}`, globex],
    );
    await owner.query(
      `INSERT INTO invoices (org_id, source, currency, contact_id, buyer_name) VALUES ($1, 'manual', 'USD', $2, 'Rita Buyer')`,
      [org, buyer],
    );
    return { org, alice, bob, aliceMail, buyer, buyerPhone, stranger, acme, globex, initech };
  }

  /** One revenue export row. `ready` rows carry a file in the row itself. */
  async function exportRow(
    w: World,
    requestedBy: number,
    status: 'queued' | 'running' | 'ready' | 'expired' | 'failed',
    emailedTo: string | null = null,
  ): Promise<number> {
    const hasFile = status === 'ready';
    return one(
      `INSERT INTO revenue_report_exports (org_id, requested_by, emailed_to, format, csv_kind, scope, filters, status, file_name, file_bytes, file_gz, expires_at)
       VALUES ($1, $2, $3, 'csv', 'payments', 'all', '{}'::jsonb, $4, $5, $6, $7, $8) RETURNING id`,
      [
        w.org,
        requestedBy,
        emailedTo,
        status,
        hasFile ? 'revenue-payments.csv' : null,
        hasFile ? 12 : null,
        hasFile ? Buffer.from('Rita Buyer,100') : null,
        hasFile ? new Date(Date.now() + 5 * 86_400_000) : null,
      ],
    );
  }

  const brief = (w: World, company: number, user: number) =>
    one(
      `INSERT INTO company_briefs (org_id, company_id, user_id, input_hash, content, provider, model)
       VALUES ($1, $2, $3, 'h', $4::jsonb, 'openai', 'gpt-test') RETURNING id`,
      [
        w.org,
        company,
        user,
        JSON.stringify({ summary: 'Acme Traders: two open deals.', sections: [] }),
      ],
    );

  const byId = (a: number, b: number) => a - b;

  const ids = async (table: string, org: number): Promise<number[]> =>
    (await owner.query(`SELECT id FROM ${table} WHERE org_id = $1 ORDER BY id`, [org])).rows.map(
      (r) => Number(r.id),
    );

  const auditRows = async (org: number, table: string) =>
    (
      await owner.query(
        `SELECT actor_id, actor_type, request_id, record_id, action, delta FROM audit_log WHERE org_id = $1 AND module = $2 ORDER BY id`,
        [org, table],
      )
    ).rows;

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
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  // --- a staff member is erased ----------------------------------------------------------------------------------------------------

  it('a staff member: their exports (asked for or mailed to them, with the stored file) and their briefs are gone, nothing else', async () => {
    const w = await world();
    const mine = await exportRow(w, w.alice, 'ready', w.aliceMail);
    const mineRunning = await exportRow(w, w.alice, 'running', w.aliceMail);
    const mineExpired = await exportRow(w, w.alice, 'expired', w.aliceMail);
    // asked for by Bob but mailed to Alice's address (the address was reassigned): her personal data, so it goes with her
    const mailedToHer = await exportRow(w, w.bob, 'ready', w.aliceMail.toUpperCase());
    const bobs = await exportRow(w, w.bob, 'ready', 'bob@staff.example');
    const bobsExpired = await exportRow(w, w.bob, 'expired', 'bob@staff.example');
    const aliceBrief = await brief(w, w.acme, w.alice);
    const aliceBrief2 = await brief(w, w.globex, w.alice);
    const bobBrief = await brief(w, w.acme, w.bob);
    const bobBrief2 = await brief(w, w.initech, w.bob);

    // a second workspace that must not be touched, and an audit row of the same workspace that must stay as it is
    const other = await world();
    const otherExport = await exportRow(other, other.alice, 'ready', other.aliceMail);
    const otherBrief = await brief(other, other.acme, other.alice);
    await owner.query(
      `INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action) VALUES ($1, $2, 'user', 'contacts', $3, 'update')`,
      [w.org, w.alice, w.buyer],
    );
    const auditBefore = (
      await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [w.org])
    ).rows[0].n;

    const run = await RequestContextStore.run(
      {
        requestId: 'req-staff-1',
        orgId: w.org,
        actorType: 'user',
        actorId: w.bob,
        userId: w.bob,
      },
      () => inTx((tx) => eraser().eraseStaff(tx, w.org, [w.alice])),
    );

    expect(await ids('revenue_report_exports', w.org)).toEqual([bobs, bobsExpired].sort(byId));
    expect(await ids('company_briefs', w.org)).toEqual([bobBrief, bobBrief2].sort(byId));
    for (const gone of [mine, mineRunning, mineExpired, mailedToHer]) {
      expect(
        (await owner.query(`SELECT 1 FROM revenue_report_exports WHERE id = $1`, [gone])).rowCount,
      ).toBe(0);
    }
    for (const gone of [aliceBrief, aliceBrief2]) {
      expect(
        (await owner.query(`SELECT 1 FROM company_briefs WHERE id = $1`, [gone])).rowCount,
      ).toBe(0);
    }
    // the file lived in the row: no object-storage key is queued for anything
    expect(run.files).toBe(0);
    expect(
      (await owner.query(`SELECT 1 FROM privacy_erasure_files WHERE org_id = $1`, [w.org]))
        .rowCount,
    ).toBe(0);

    // another workspace is untouched
    expect(await ids('revenue_report_exports', other.org)).toEqual([otherExport]);
    expect(await ids('company_briefs', other.org)).toEqual([otherBrief]);

    // the report counts what was removed
    const line = (t: string) => run.report.lines.find((l) => l.table === t);
    expect(line('revenue_report_exports')).toMatchObject({ disposition: 'deleted', count: 4 });
    expect(line('company_briefs')).toMatchObject({ disposition: 'deleted', count: 2 });
    expect(run.report.lines.map((l) => l.table).sort()).toEqual([
      'company_briefs',
      'revenue_report_exports',
    ]);

    // one audit row per table, a count and a cause, written for the actor of the request; every other audit row is as it was
    const exportsAudit = await auditRows(w.org, 'revenue_report_exports');
    expect(exportsAudit).toHaveLength(1);
    expect(exportsAudit[0]).toMatchObject({
      actor_id: w.bob,
      actor_type: 'user',
      request_id: 'req-staff-1',
      action: 'delete',
      delta: { rows: { old: 4, new: 0 }, cause: { old: null, new: 'staff_erased' } },
    });
    expect(await auditRows(w.org, 'company_briefs')).toHaveLength(1);
    const auditAfter = (
      await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [w.org])
    ).rows[0].n;
    expect(auditAfter).toBe(auditBefore + 2);
    expect(
      (
        await owner.query(
          `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND actor_id = $2`,
          [w.org, w.alice],
        )
      ).rows,
    ).toEqual([{ action: 'update' }]);
    // no audit row holds an address, a name or a file
    expect(JSON.stringify(exportsAudit)).not.toMatch(/alice|staff\.example|Rita/i);
  });

  it('deleting the staff member (the account deletion path) removes the same rows even without the erasure call', async () => {
    const w = await world();
    const mine = await exportRow(w, w.alice, 'ready', w.aliceMail);
    const bobs = await exportRow(w, w.bob, 'ready', 'bob@staff.example');
    await brief(w, w.acme, w.alice);
    const bobBrief = await brief(w, w.acme, w.bob);

    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [w.org, w.alice]);

    expect(await ids('revenue_report_exports', w.org)).toEqual([bobs]);
    expect(await ids('company_briefs', w.org)).toEqual([bobBrief]);
    expect(
      (await owner.query(`SELECT 1 FROM revenue_report_exports WHERE id = $1`, [mine])).rowCount,
    ).toBe(0);
  });

  it('a staff id from another workspace erases nothing', async () => {
    const w = await world();
    const other = await world();
    const theirs = await exportRow(other, other.alice, 'ready', other.aliceMail);
    const kept = await brief(other, other.acme, other.alice);
    const run = await inTx((tx) => eraser().eraseStaff(tx, w.org, [other.alice]));
    expect(run.report.lines.every((l) => l.count === 0)).toBe(true);
    expect(await ids('revenue_report_exports', other.org)).toEqual([theirs]);
    expect(await ids('company_briefs', other.org)).toEqual([kept]);
  });

  // --- a buyer is erased -------------------------------------------------------------------------------------------------------------

  it('a buyer deleted in the CRM: every unexpired export of the workspace and the briefs of their company are gone', async () => {
    const w = await world();
    const ready = await exportRow(w, w.alice, 'ready', w.aliceMail);
    const bobsReady = await exportRow(w, w.bob, 'ready', 'bob@staff.example');
    const queued = await exportRow(w, w.bob, 'queued');
    const running = await exportRow(w, w.alice, 'running');
    const expired = await exportRow(w, w.alice, 'expired', w.aliceMail);
    const failed = await exportRow(w, w.bob, 'failed');
    const acmeBriefs = [await brief(w, w.acme, w.alice), await brief(w, w.acme, w.bob)];
    const globexBrief = await brief(w, w.globex, w.alice);
    const initechBrief = await brief(w, w.initech, w.bob);

    const other = await world();
    const otherExport = await exportRow(other, other.alice, 'ready', other.aliceMail);
    const otherBrief = await brief(other, other.acme, other.alice);

    const run = await inTx((tx) => eraser().eraseContactHistory(tx, w.org, [w.buyer], 'delete'));

    // regenerable derived copies are purged; rows that hold no file stay as the record that an export was made
    expect(await ids('revenue_report_exports', w.org)).toEqual([expired, failed].sort(byId));
    for (const gone of [ready, bobsReady, queued, running]) {
      expect(
        (await owner.query(`SELECT 1 FROM revenue_report_exports WHERE id = $1`, [gone])).rowCount,
      ).toBe(0);
    }
    // the briefs of the company the buyer belongs to, whoever wrote them; other companies keep theirs
    expect(await ids('company_briefs', w.org)).toEqual([globexBrief, initechBrief].sort(byId));
    for (const gone of acmeBriefs) {
      expect(
        (await owner.query(`SELECT 1 FROM company_briefs WHERE id = $1`, [gone])).rowCount,
      ).toBe(0);
    }
    // another workspace is untouched
    expect(await ids('revenue_report_exports', other.org)).toEqual([otherExport]);
    expect(await ids('company_briefs', other.org)).toEqual([otherBrief]);

    const line = (t: string) => run.report.lines.find((l) => l.table === t);
    expect(line('revenue_report_exports')).toMatchObject({ disposition: 'deleted', count: 4 });
    expect(line('company_briefs')).toMatchObject({ disposition: 'deleted', count: 2 });

    // the invoice is an accounting record: this erasure does not touch it (its own manifest decides, and only a data request does)
    expect((await owner.query(`SELECT 1 FROM invoices WHERE org_id = $1`, [w.org])).rowCount).toBe(
      1,
    );

    const audit = await auditRows(w.org, 'revenue_report_exports');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: 'system',
      action: 'delete',
      delta: { rows: { old: 4, new: 0 }, cause: { old: null, new: 'contact_deleted' } },
    });
    expect(await auditRows(w.org, 'company_briefs')).toHaveLength(1);
  });

  it('a data request for a buyer (all tiers): the same purge, and the invoice is anonymised by its own manifest, not deleted', async () => {
    const w = await world();
    const ready = await exportRow(w, w.alice, 'ready', w.aliceMail);
    const expired = await exportRow(w, w.alice, 'expired', w.aliceMail);
    await brief(w, w.acme, w.alice);
    const globexBrief = await brief(w, w.globex, w.alice);

    const run = await inTx(async (tx) => {
      const subject = await new SubjectResolver().resolve(tx, w.org, {
        kind: 'contact',
        contactId: w.buyer,
      });
      return eraser().run(tx, {
        orgId: w.org,
        requestId: null,
        subject,
        tiers: ALL_TIERS,
        mode: 'delete',
        dryRun: false,
      });
    });

    expect(await ids('revenue_report_exports', w.org)).toEqual([expired]);
    expect(await ids('company_briefs', w.org)).toEqual([globexBrief]);
    expect(
      (await owner.query(`SELECT 1 FROM revenue_report_exports WHERE id = $1`, [ready])).rowCount,
    ).toBe(0);
    const invoice = (
      await owner.query(`SELECT buyer_name FROM invoices WHERE org_id = $1`, [w.org])
    ).rows;
    expect(invoice).toHaveLength(1);
    expect(invoice[0].buyer_name).toBe('[erased]');
    expect(run.report.lines.find((l) => l.table === 'invoices')?.disposition).toBe('anonymised');
  });

  it('a buyer known only by the e-mail printed on an invoice (no contact row) also purges the exports', async () => {
    const w = await world();
    await owner.query(
      `INSERT INTO invoices (org_id, source, currency, buyer_name, buyer_email) VALUES ($1, 'manual', 'USD', 'Walk In', 'walkin@buyer.example')`,
      [w.org],
    );
    const ready = await exportRow(w, w.alice, 'ready', w.aliceMail);

    await inTx(async (tx) => {
      const subject = await new SubjectResolver().resolve(tx, w.org, {
        kind: 'identifier',
        identifierKind: 'email',
        value: 'Walkin@Buyer.example',
      });
      return eraser().run(tx, {
        orgId: w.org,
        requestId: null,
        subject,
        tiers: ALL_TIERS,
        mode: 'delete',
        dryRun: false,
      });
    });

    expect(
      (await owner.query(`SELECT 1 FROM revenue_report_exports WHERE id = $1`, [ready])).rowCount,
    ).toBe(0);
  });

  it('a contact who never bought anything purges no export, but the briefs of their company still go', async () => {
    const w = await world();
    const ready = await exportRow(w, w.alice, 'ready', w.aliceMail);
    const globexBrief = await brief(w, w.globex, w.alice);
    const acmeBrief = await brief(w, w.acme, w.alice);

    const run = await inTx((tx) => eraser().eraseContactHistory(tx, w.org, [w.stranger], 'delete'));

    expect(await ids('revenue_report_exports', w.org)).toEqual([ready]);
    expect(await ids('company_briefs', w.org)).toEqual([acmeBrief]);
    expect(
      (await owner.query(`SELECT 1 FROM company_briefs WHERE id = $1`, [globexBrief])).rowCount,
    ).toBe(0);
    expect(run.report.lines.find((l) => l.table === 'revenue_report_exports')?.count).toBe(0);
    expect(await auditRows(w.org, 'revenue_report_exports')).toHaveLength(0);
    expect(await auditRows(w.org, 'company_briefs')).toHaveLength(1);
  });

  it('a dry run counts the purge and changes nothing, and writes no audit row', async () => {
    const w = await world();
    await exportRow(w, w.alice, 'ready', w.aliceMail);
    await brief(w, w.acme, w.alice);
    const beforeExports = await ids('revenue_report_exports', w.org);
    const beforeBriefs = await ids('company_briefs', w.org);

    const run = await inTx(async (tx) => {
      const subject = await new SubjectResolver().resolve(tx, w.org, {
        kind: 'contact',
        contactId: w.buyer,
      });
      return eraser().run(tx, {
        orgId: w.org,
        requestId: null,
        subject,
        tiers: ALL_TIERS,
        mode: 'delete',
        dryRun: true,
      });
    });

    expect(run.report.lines.find((l) => l.table === 'revenue_report_exports')?.count).toBe(1);
    expect(run.report.lines.find((l) => l.table === 'company_briefs')?.count).toBe(1);
    expect(await ids('revenue_report_exports', w.org)).toEqual(beforeExports);
    expect(await ids('company_briefs', w.org)).toEqual(beforeBriefs);
    expect(await auditRows(w.org, 'revenue_report_exports')).toHaveLength(0);
  });

  it('an export that is still being built when its buyer is erased stores no file afterwards', async () => {
    const w = await world();
    const running = await exportRow(w, w.alice, 'running');
    await inTx((tx) => eraser().eraseContactHistory(tx, w.org, [w.buyer], 'delete'));
    const stored = await inTx((tx) =>
      new RevenueExportRepository().finish(tx, w.org, running, {
        fileName: 'late.csv',
        file: Buffer.from('Rita Buyer,100'),
        rowCount: 1,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      }),
    );
    expect(stored).toBe(false);
    expect(await ids('revenue_report_exports', w.org)).toEqual([]);
  });

  // --- what is put in a person's own export ---------------------------------------------------------------------------------------

  it("a contact's export never lists other members' export rows or briefs; a staff member's export lists their own, without the file", async () => {
    const w = await world();
    await exportRow(w, w.alice, 'ready', w.aliceMail);
    await exportRow(w, w.bob, 'ready', 'bob@staff.example');
    await brief(w, w.acme, w.alice);
    await brief(w, w.acme, w.bob);

    await inTx(async (tx) => {
      const resolver = new SubjectResolver();
      const contactSubject = await resolver.resolve(tx, w.org, {
        kind: 'contact',
        contactId: w.buyer,
      });
      const staffSubject = await resolver.fromUsers(tx, w.org, [w.alice]);
      const ctx = (): PrivacyCtx => ({
        tx,
        orgId: w.org,
        requestId: null,
        tiers: ALL_TIERS,
        dryRun: false,
        now: new Date(),
      });

      const forContact = await revenueExports.export(ctx(), contactSubject);
      expect(forContact.tables[0]!.rows).toEqual([]);
      const briefsForContact = await companyBriefs.export(ctx(), contactSubject);
      expect(briefsForContact.tables[0]!.rows).toEqual([]);

      const forStaff = await revenueExports.export(ctx(), staffSubject);
      expect(forStaff.tables[0]!.count).toBe(1);
      const row = forStaff.tables[0]!.rows[0]!;
      expect(row.emailed_to).toBe(w.aliceMail);
      expect(row).not.toHaveProperty('file_gz');
      const briefsForStaff = await companyBriefs.export(ctx(), staffSubject);
      expect(briefsForStaff.tables[0]!.count).toBe(1);
    });
  });

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  function eraser(): PersonalDataErasureService {
    return new PersonalDataErasureService(new SubjectResolver(), noHold);
  }

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
});
