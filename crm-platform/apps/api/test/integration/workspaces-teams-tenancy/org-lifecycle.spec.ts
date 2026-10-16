import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, type DbClient } from '@crm/db';
import type { ConfigService } from '@nestjs/config';
import { LifecycleRepository } from '../../../src/modules/workspaces-teams-tenancy/lifecycle/lifecycle.repository';
import { StoragePurgeService } from '../../../src/modules/workspaces-teams-tenancy/lifecycle/storage-purge.service';
import { LifecycleService } from '../../../src/modules/workspaces-teams-tenancy/lifecycle/lifecycle.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import type { DatabaseService } from '../../../src/infra/db/database.service';

/**
 * Workspace inactivity lifecycle against real Postgres, connected as the
 * restricted worker login (NOT the superuser), so the grants and RLS the
 * feature depends on are the ones actually under test.
 *
 * Time travel: instead of faking the clock, `advance(n)` shifts every stored
 * timestamp n days into the past (activity clock, archive stamp, reminder log),
 * which is equivalent to n days having elapsed.
 */
describe('workspace lifecycle', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let worker: DbClient;
  let appClient: Client;
  let svc: LifecycleService;
  const tombstoned: string[] = [];
  const flags = {
    ORG_LIFECYCLE_DRY_RUN: false,
    ORG_LIFECYCLE_DELETE_ENABLED: false,
    FINANCIAL_RECORD_RETENTION_YEARS: 8,
  } as Record<string, boolean | number>;

  const advance = async (orgId: number, days: number) => {
    await owner.query(
      `UPDATE organizations SET last_activity_at = last_activity_at - make_interval(days => $2),
              archived_at = archived_at - make_interval(days => $2) WHERE id = $1`,
      [orgId, days],
    );
    await owner.query(
      `UPDATE org_lifecycle_log SET created_at = created_at - make_interval(days => $2),
              inactivity_cycle = inactivity_cycle - make_interval(days => $2) WHERE org_id = $1`,
      [orgId, days],
    );
  };
  const newOrg = async (slug: string, idleDays = 0) => {
    const r = await owner.query<{ id: number; uuid: string }>(
      `INSERT INTO organizations (slug, name, last_activity_at)
       VALUES ($1, $1, now() - make_interval(days => $2)) RETURNING id, uuid`,
      [slug, idleDays],
    );
    return { id: Number(r.rows[0]!.id), uuid: r.rows[0]!.uuid };
  };
  const status = async (id: number) =>
    (await owner.query(`SELECT status FROM organizations WHERE id = $1`, [id])).rows[0]?.status as
      string | undefined;
  const events = async (uuid: string) =>
    (
      await owner.query(
        `SELECT event_type, stage, reminder_no FROM org_lifecycle_log WHERE org_uuid = $1 ORDER BY id`,
        [uuid],
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
    await owner.query(`CREATE ROLE crm_worker_user LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS`);
    await owner.query(`CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS`);
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    const as = (u: string) => container.getConnectionUri().replace('crm:crm@', `${u}:test@`);
    worker = createDbClient({ url: as('crm_worker_user'), poolMax: 3 });
    appClient = new Client({ connectionString: as('crm_app_user') });
    await appClient.connect();

    const db = {
      privileged: (fn: Parameters<typeof withPrivileged>[1]) => withPrivileged(worker.db, fn),
    } as unknown as DatabaseService;
    const config = { get: (k: string) => flags[k] } as unknown as ConfigService<never, true>;
    const sessions = { tombstone: async (sid: string) => void tombstoned.push(sid) } as never;
    svc = new LifecycleService(
      db,
      new LifecycleRepository(),
      new OutboxService(),
      sessions,
      config as never,
    );
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await appClient?.end();
    await owner?.end();
    await container?.stop();
  });

  it('runs the full ladder: 3 reminders, archive at 90, 3 reminders, hard delete at 180', async () => {
    const org = await newOrg('ladder', 59);
    await owner.query(
      `INSERT INTO contacts (org_id, name, email) VALUES ($1,'Pii Person','pii@example.com')`,
      [org.id],
    );
    const c = await owner.query(`SELECT id FROM contacts WHERE org_id = $1`, [org.id]);
    await owner.query(
      `INSERT INTO contact_files (org_id, contact_id, file_name, storage_key) VALUES ($1,$2,'a.pdf','orgs/ladder/a.pdf')`,
      [org.id, c.rows[0].id],
    );
    const u = await owner.query(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'o@ladder.test','Owner','x') RETURNING id`,
      [org.id],
    );
    const sess = await owner.query(
      `INSERT INTO auth_sessions (org_id, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days') RETURNING uuid`,
      [org.id, u.rows[0].id],
    );
    await owner.query(
      `INSERT INTO security_events (subject_org_id, actor_type, event, status, ip) VALUES ($1,'user','auth.login','success','10.0.0.1')`,
      [org.id],
    );
    await owner.query(
      `INSERT INTO audit_log (org_id, actor_type, module, record_id, action, delta)
       VALUES ($1,'user','contacts',1,'update','{"phone":{"old":"+911","new":"+912"}}')`,
      [org.id],
    );

    await svc.sweep();
    expect(await status(org.id)).toBe('active');
    expect((await events(org.uuid)).length).toBe(0); // day 59: nothing

    for (const step of [1, 15, 10]) {
      // day 60, 75, 85
      await advance(org.id, step);
      await svc.sweep();
      await svc.sweep(); // same-day re-run must not double-send
    }
    expect((await events(org.uuid)).map((e) => e.reminder_no)).toEqual([1, 2, 3]);

    await advance(org.id, 4); // day 89, last reminder 4d ago
    await svc.sweep();
    expect(await status(org.id)).toBe('active');
    await advance(org.id, 1); // day 90
    await svc.sweep();
    expect(await status(org.id)).toBe('archived');
    // Archiving ends every live session at once, not at token expiry.
    expect(
      (await owner.query(`SELECT revoked_reason FROM auth_sessions WHERE org_id=$1`, [org.id]))
        .rows[0].revoked_reason,
    ).toBe('workspace_archived');
    expect(tombstoned).toContain(sess.rows[0].uuid);

    for (const step of [60, 15, 8]) {
      // day 150, 165, 173
      await advance(org.id, step);
      await svc.sweep();
    }
    const delReminders = (await events(org.uuid)).filter((e) => e.stage === 'delete');
    expect(delReminders.map((e) => e.reminder_no)).toEqual([1, 2, 3]);

    await advance(org.id, 7); // day 180, delete switch OFF -> blocked, data intact
    await svc.sweep();
    expect(await status(org.id)).toBe('archived');
    expect((await events(org.uuid)).some((e) => e.event_type === 'delete_blocked')).toBe(true);

    flags.ORG_LIFECYCLE_DELETE_ENABLED = true;
    await svc.sweep();
    flags.ORG_LIFECYCLE_DELETE_ENABLED = false;

    expect(await status(org.id)).toBeUndefined();
    expect((await owner.query(`SELECT 1 FROM contacts WHERE org_id = $1`, [org.id])).rowCount).toBe(
      0,
    );
    expect(
      (await owner.query(`SELECT 1 FROM audit_log WHERE org_id = $1`, [org.id])).rowCount,
    ).toBe(0);
    expect(
      (
        await owner.query(`SELECT storage_key FROM storage_purge_queue WHERE org_uuid = $1`, [
          org.uuid,
        ])
      ).rows,
    ).toEqual([{ storage_key: 'orgs/ladder/a.pdf' }]);
    // Completeness: no table that carries org_id (FK-cascaded or not) may still hold a row of the erased workspace. A table added
    // later without an FK to organizations fails here instead of silently surviving an erasure.
    const tables = await owner.query(
      `SELECT c.relname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE a.attname = 'org_id' AND NOT a.attisdropped AND c.relkind IN ('r','p') AND n.nspname = 'public'
         AND NOT c.relispartition AND c.relname NOT IN ('org_lifecycle_log', 'storage_purge_queue')`,
    );
    const leftovers: string[] = [];
    for (const t of tables.rows as Array<{ relname: string }>) {
      const r = await owner.query(`SELECT 1 FROM "${t.relname}" WHERE org_id = $1 LIMIT 1`, [
        org.id,
      ]);
      if (r.rowCount) leftovers.push(t.relname);
    }
    expect(leftovers).toEqual([]);
    expect(
      (await owner.query(`SELECT 1 FROM security_events WHERE subject_org_id = $1`, [org.id]))
        .rowCount,
    ).toBe(0);
    const log = await events(org.uuid);
    expect(log.at(-1)?.event_type).toBe('deleted'); // tombstone survives
    const tomb = await owner.query(
      `SELECT details::text AS d FROM org_lifecycle_log WHERE org_uuid=$1 AND event_type='deleted'`,
      [org.uuid],
    );
    expect(tomb.rows[0].d).not.toMatch(/pii|ladder|Pii/); // no personal data
  });

  it('an active paid plan is never idle-archived; a lapsed one is', async () => {
    await owner.query(
      `INSERT INTO plans (slug, name, amount, is_free) VALUES ('protest','Pro',99,false) ON CONFLICT DO NOTHING`,
    );
    const org = await newOrg('payer', 400);
    await owner.query(`UPDATE organizations SET plan='protest' WHERE id=$1`, [org.id]);
    await owner.query(
      `INSERT INTO org_plan_state (org_id, plan_ends_at) VALUES ($1, now() + interval '30 days')`,
      [org.id],
    );
    await svc.sweep();
    expect(await events(org.uuid)).toEqual([]);
    expect((await svc.get(org.uuid)).scheduledArchiveAt).toBeNull();
    await owner.query(
      `UPDATE org_plan_state SET plan_ends_at = now() - interval '1 day' WHERE org_id=$1`,
      [org.id],
    );
    await svc.sweep();
    expect((await events(org.uuid)).some((e) => e.event_type === 'reminder_sent')).toBe(true);
  });

  it('erases a workspace its owner deleted after 30 days, keeping only the sales records, without the buyer', async () => {
    flags.ORG_LIFECYCLE_DELETE_ENABLED = true;
    const mk = async (slug: string, deletedDaysAgo: number) => {
      const o = await newOrg(slug, 5);
      await owner.query(
        `UPDATE organizations SET status='deleted', deleted_at = now() - make_interval(days => $2) WHERE id=$1`,
        [o.id, deletedDaysAgo],
      );
      return o;
    };
    const fresh = await mk('del-fresh', 10);
    const old = await mk('del-old', 31);
    const held = await mk('del-held', 60);
    await owner.query(`UPDATE organizations SET legal_hold = true WHERE id=$1`, [held.id]);
    const never = await mk('del-never', 45);
    await owner.query(
      `UPDATE organizations SET retention_exempt = true, retention_exempt_reason = 'key account' WHERE id=$1`,
      [never.id],
    );
    await owner.query(
      `INSERT INTO orders (org_id, order_number, kind, wallet_topup_minor, currency, amount, total_amount, tax_rate, tax_amount,
                           customer_name, customer_email, billing_company, billing_address, billing_country, billing_tax_id,
                           status, gateway_slug, paid_at)
       VALUES ($1,'ORD-KEEP-1','wallet_topup',5000,'INR',50.00,59.00,18.00,9.00,'Pii Buyer','buyer@pii.test','Pii Co','1 Pii Road',
               'IN','29ABCDE1234F1Z5','paid','razorpay', now() - interval '40 days'),
              ($1,'ORD-UNPAID-1','wallet_topup',5000,'INR',50.00,59.00,18.00,9.00,'Pii Buyer','buyer@pii.test',NULL,NULL,'IN',NULL,
               'pending',NULL,NULL)`,
      [old.id],
    );
    await svc.sweep();
    flags.ORG_LIFECYCLE_DELETE_ENABLED = false;

    expect(await status(fresh.id)).toBe('deleted'); // still inside the 30-day grace
    expect(await status(held.id)).toBe('deleted'); // legal hold
    expect(await status(old.id)).toBeUndefined();
    expect(await status(never.id)).toBeUndefined(); // an owner's erasure outranks never-delete
    expect((await events(old.uuid)).at(-1)?.event_type).toBe('deleted');
    expect(
      (
        await owner.query(
          `SELECT details->>'cause' AS c FROM org_lifecycle_log WHERE org_uuid=$1 AND event_type='deleted'`,
          [old.uuid],
        )
      ).rows[0].c,
    ).toBe('owner_deleted');

    // Only the paid order is kept, and nothing that identifies the buyer.
    const kept = await owner.query(`SELECT * FROM financial_records_archive WHERE org_uuid = $1`, [
      old.uuid,
    ]);
    expect(kept.rows.map((r) => r.order_number)).toEqual(['ORD-KEEP-1']);
    const row = kept.rows[0];
    expect(JSON.stringify(row)).not.toMatch(/Pii|buyer@|Road/);
    expect(row).toMatchObject({
      billing_country: 'IN',
      billing_tax_id: '29ABCDE1234F1Z5',
      currency: 'INR',
    });
    expect(Number(row.total_amount)).toBe(59);
    const years = (new Date(row.retain_until).getTime() - Date.now()) / (365.25 * 86_400_000);
    expect(years).toBeGreaterThan(7.9);
    expect(years).toBeLessThan(8.1);

    // After the legal period the record goes too.
    await owner.query(
      `UPDATE financial_records_archive SET retain_until = now() - interval '1 day' WHERE org_uuid = $1`,
      [old.uuid],
    );
    await svc.sweep();
    expect(
      (await owner.query(`SELECT 1 FROM financial_records_archive WHERE org_uuid = $1`, [old.uuid]))
        .rowCount,
    ).toBe(0);
  });

  it('finds every file-key column from the catalogue, and the purge worker removes queued files and retries failures', async () => {
    const repo = new LifecycleRepository();
    const cols = await worker.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.privileged', 'on', true)`);
      return repo.fileKeyColumns(tx);
    });
    const names = cols.map((c) => `${c.table}.${c.column}`);
    expect(names).toEqual(
      expect.arrayContaining([
        'contact_files.storage_key',
        'messages.media_key',
        'invoices.pdf_path',
      ]),
    );
    expect(names.every((n) => !n.includes('search_path'))).toBe(true);

    const removed: string[] = [];
    let fail = false;
    const media = {
      remove: async (k: string) => {
        if (fail) throw new Error('bucket unavailable');
        removed.push(k);
      },
    };
    const chat = { remove: async (_o: number, k: string) => void removed.push(`chat:${k}`) };
    const db = {
      privileged: (fn: Parameters<typeof withPrivileged>[1]) => withPrivileged(worker.db, fn),
    } as unknown as DatabaseService;
    const purge = new StoragePurgeService(db, media as never, chat as never);

    const u = '00000000-0000-4000-8000-0000000000aa';
    await owner.query(
      `INSERT INTO storage_purge_queue (org_id, org_uuid, storage_key) VALUES (1, $1, 'contact-files/1/ok.pdf'), (1, $1, 'contact-files/1/retry.pdf')`,
      [u],
    );
    fail = true;
    await purge.pass();
    expect(
      (
        await owner.query(
          `SELECT attempts, last_error, purged_at FROM storage_purge_queue WHERE org_uuid=$1 ORDER BY id`,
          [u],
        )
      ).rows,
    ).toMatchObject([
      { attempts: 1, last_error: 'bucket unavailable', purged_at: null },
      { attempts: 1, purged_at: null },
    ]);
    fail = false;
    await purge.pass();
    const done = await owner.query(`SELECT purged_at FROM storage_purge_queue WHERE org_uuid=$1`, [
      u,
    ]);
    expect(done.rows.every((r) => r.purged_at !== null)).toBe(true);
    expect(removed).toEqual(
      expect.arrayContaining([
        'contact-files/1/ok.pdf',
        'chat:contact-files/1/ok.pdf',
        'contact-files/1/retry.pdf',
      ]),
    );
    await purge.pass();
    expect(removed.filter((k) => k === 'contact-files/1/ok.pdf')).toHaveLength(1); // a purged row is not touched again
  });

  it('dry run changes nothing', async () => {
    const org = await newOrg('dry', 100);
    flags.ORG_LIFECYCLE_DRY_RUN = true;
    await svc.sweep();
    flags.ORG_LIFECYCLE_DRY_RUN = false;
    expect(await events(org.uuid)).toEqual([]);
  });

  it('never deletes without the full chain, even when idle for years', async () => {
    flags.ORG_LIFECYCLE_DELETE_ENABLED = true;
    const org = await newOrg('ancient', 900);
    await svc.sweep(); // reminder 1 only
    expect(await status(org.id)).toBe('active');
    flags.ORG_LIFECYCLE_DELETE_ENABLED = false;
  });

  it('exemption ("never delete") blocks every step; expired exemption does not; clearing needs a reason', async () => {
    const org = await newOrg('exempt', 400);
    await svc.setExempt(
      org.uuid,
      { exempt: true, reason: 'enterprise contract' },
      { type: 'platform_operator', ref: 'platform_operator:1' },
    );
    await svc.sweep();
    expect((await events(org.uuid)).map((e) => e.event_type)).toEqual(['exemption_set']);

    await owner.query(
      `UPDATE organizations SET retention_exempt_until = now() - interval '1 day' WHERE id=$1`,
      [org.id],
    );
    await svc.sweep();
    expect((await events(org.uuid)).some((e) => e.event_type === 'reminder_sent')).toBe(true);

    await expect(
      owner.query(
        `UPDATE organizations SET retention_exempt = true, retention_exempt_reason = '' WHERE id=$1`,
        [org.id],
      ),
    ).rejects.toThrow(/chk_organizations_exempt_reason/);
  });

  it('per-org timing override and validation', async () => {
    const org = await newOrg('custom', 100);
    const a = { type: 'platform_operator', ref: 'platform_operator:1' } as const;
    const res = await svc.updatePolicy(
      org.uuid,
      { archiveAfterDays: 365, deleteAfterDays: 500, reason: 'slow customer' },
      a,
    );
    expect(res.archiveAfterDays).toBe(365);
    await svc.sweep();
    expect(await events(org.uuid)).toHaveLength(1); // only the policy_changed row: day 100 < first reminder day 335
    await expect(
      svc.updatePolicy(org.uuid, { deleteAfterDays: 400, reason: 'too close' }, a),
    ).rejects.toThrow(/at least 60 days/);
    const reset = await svc.updatePolicy(
      org.uuid,
      { archiveAfterDays: null, deleteAfterDays: null, reason: 'back to default' },
      a,
    );
    expect([reset.archiveAfterDays, reset.deleteAfterDays]).toEqual([90, 180]);
  });

  it('legal hold blocks; restore reopens a fresh cycle', async () => {
    const a = { type: 'platform_operator', ref: 'platform_operator:1' } as const;
    const held = await newOrg('held', 400);
    await svc.setLegalHold(held.uuid, { legalHold: true, reason: 'litigation 2027-01' }, a);
    await svc.sweep();
    expect((await events(held.uuid)).map((e) => e.event_type)).toEqual(['legal_hold_set']);

    const org = await newOrg('restoreme', 95);
    await owner.query(`UPDATE organizations SET status='archived', archived_at=now() WHERE id=$1`, [
      org.id,
    ]);
    const r = await svc.restore(org.uuid, { reason: 'customer asked' }, a);
    expect(r.status).toBe('active');
    expect(r.daysInactive).toBe(0);
    await expect(svc.restore(org.uuid, { reason: 'again again' }, a)).rejects.toThrow(
      /only an archived/,
    );
  });

  it('app role cannot read lifecycle tables, delete an org, or alter the log', async () => {
    await expect(appClient.query(`SELECT * FROM org_lifecycle_log`)).resolves.toMatchObject({
      rowCount: 0,
    });
    await expect(appClient.query(`DELETE FROM organizations`)).rejects.toThrow(/permission denied/);
    await expect(worker.pool.query(`UPDATE org_lifecycle_log SET event_type='x'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(worker.pool.query(`DELETE FROM org_lifecycle_log`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
