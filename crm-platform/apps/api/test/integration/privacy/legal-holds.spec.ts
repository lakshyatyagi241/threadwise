import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { ERROR_CODES } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import type { CryptoService } from '../../../src/common/crypto/crypto.service';
import { AppError } from '../../../src/common/errors/app-error';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { CallLogRetentionService } from '../../../src/modules/calling-voice/logging/call-log-retention.service';
import { CallRecordingRepository } from '../../../src/modules/calling-voice/call-recording.repository';
import { LeadRetentionSweepService } from '../../../src/modules/leads/lead-retention-sweep.service';
import { LeadScoringRepository } from '../../../src/modules/lead-scoring/lead-scoring.repository';
import { SubjectResolver } from '../../../src/modules/privacy/engine/subject-resolver';
import { LegalHoldGuard } from '../../../src/modules/privacy/legal-holds/legal-hold.guard';
import { LegalHoldsRepository } from '../../../src/modules/privacy/legal-holds/legal-holds.repository';
import { LegalHoldsService } from '../../../src/modules/privacy/legal-holds/legal-holds.service';
import { PrivacyRequestsRepository } from '../../../src/modules/privacy/requests/privacy-requests.repository';
import { PersonalDataErasureService } from '../../../src/modules/privacy/engine/erasure.service';

/**
 * BL-295 legal hold against a real Postgres, as the restricted application role (forced RLS): the table and its two functions, the
 * delete trigger under every purge path, the register service (place, extend, review, release, expiry), and the sweeps that must skip a
 * held person while they keep purging everyone else.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const DAY = 86_400_000;

const sealed = {
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.slice(4),
} as unknown as CryptoService;

describe('legal hold', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let seq = 0;

  const guard = () => new LegalHoldGuard(db);
  const repo = new LegalHoldsRepository();
  const requests = new PrivacyRequestsRepository();
  let service: LegalHoldsService;

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  const contact = async (org: number, name = 'Rita Sharma') => {
    seq += 1;
    const phone = `+91981230${String(2000 + seq)}`;
    const id = await one(
      `INSERT INTO contacts (org_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
      [org, `${name} ${seq}`, phone],
    );
    const uuid = (await owner.query(`SELECT uuid FROM contacts WHERE id = $1`, [id])).rows[0].uuid;
    return { id, uuid: uuid as string, phone };
  };

  const ctxOf = (orgId: number, userId: number): RequestContext => ({
    requestId: `t-${++seq}`,
    orgId,
    actorType: 'user',
    actorId: userId,
    userId,
  });
  const as = <T>(orgId: number, userId: number, fn: () => Promise<T>): Promise<T> =>
    RequestContextStore.run(ctxOf(orgId, userId), fn);

  const place = (
    orgId: number,
    userId: number,
    over: Partial<Parameters<LegalHoldsService['place']>[0]> & { subjectId?: string },
  ) =>
    as(orgId, userId, () =>
      service.place({
        scope: 'contact',
        reasonCategory: 'legal_claim',
        caseRef: `CASE-${++seq}`,
        ...over,
      } as Parameters<LegalHoldsService['place']>[0]),
    );

  const held = async (org: number, type: 'contact' | 'lead', id: number | null) =>
    (await owner.query(`SELECT is_subject_held($1::bigint, $2, $3::bigint) AS h`, [org, type, id]))
      .rows[0].h as boolean;

  const code = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (err) {
      return err instanceof AppError ? String(err.code) : `non-app: ${String(err)}`;
    }
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('lh-a','Hold A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('lh-b','Hold B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@lh.test','Ada Admin','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@lh.test','Bo Admin','x') RETURNING id`,
      [orgB],
    );
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 8,
    });
    db = new DatabaseService(clients);
    service = new LegalHoldsService(
      db,
      repo,
      requests,
      new SubjectResolver(),
      guard(),
      new OutboxService(),
      sealed,
    );
  }, 300_000);

  afterAll(async () => {
    await clients?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  describe('the table and the functions', () => {
    it('has row level security enabled AND forced, one tenant policy, and the unique active-hold indexes', async () => {
      const r = await owner.query(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'legal_holds'`,
      );
      expect(r.rows[0]).toEqual({ on: true, forced: true });
      const p = await owner.query(
        `SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'legal_holds' AND policyname = 'tenant_isolation'`,
      );
      expect(p.rows[0].n).toBe(1);
      const idx = await owner.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'legal_holds' AND indexname LIKE 'uq_legal_holds_active_%' ORDER BY 1`,
      );
      expect(idx.rows.map((x) => x.indexname)).toEqual([
        'uq_legal_holds_active_contact',
        'uq_legal_holds_active_lead',
        'uq_legal_holds_active_workspace',
      ]);
    });

    it('is_subject_held answers for a contact, for the person through a lead, for the workspace, and not after the end', async () => {
      const c = await contact(orgA);
      const d = await contact(orgA);
      const leadId = await one(
        `INSERT INTO leads (org_id, name, phone, contact_id, source) VALUES ($1,'L',$2,$3,'manual') RETURNING id`,
        [orgA, c.phone, c.id],
      );
      expect(await held(orgA, 'contact', c.id)).toBe(false);
      const h = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      expect(await held(orgA, 'contact', c.id)).toBe(true);
      // the same person through their lead
      expect(await held(orgA, 'lead', leadId)).toBe(true);
      // another person, and another workspace asking about the same id
      expect(await held(orgA, 'contact', d.id)).toBe(false);
      expect(await held(orgB, 'contact', c.id)).toBe(false);
      // a row with no known person is held only by a workspace-wide hold
      expect(await held(orgA, 'contact', null)).toBe(false);
      await as(orgA, userA, () => service.release(h.id, {}));
      expect(await held(orgA, 'contact', c.id)).toBe(false);
      expect(await held(orgA, 'lead', leadId)).toBe(false);
    });

    it('a workspace hold holds everyone and every row without a person; an end date in the past holds nobody', async () => {
      const c = await contact(orgB);
      const w = await place(orgB, userB, { scope: 'workspace' });
      expect(await held(orgB, 'contact', c.id)).toBe(true);
      expect(await held(orgB, 'contact', null)).toBe(true);
      expect(
        (await owner.query(`SELECT org_has_active_legal_hold($1::bigint) AS h`, [orgB])).rows[0].h,
      ).toBe(true);
      // The end date passes without the worker having run: the answer never waits for it.
      await owner.query(
        `UPDATE legal_holds SET placed_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE uuid = $1`,
        [w.id],
      );
      expect(await held(orgB, 'contact', c.id)).toBe(false);
      expect(
        (await owner.query(`SELECT org_has_active_legal_hold($1::bigint) AS h`, [orgB])).rows[0].h,
      ).toBe(false);
      // and the next hold is not refused for the expired one that still occupies the slot
      const again = await place(orgB, userB, { scope: 'workspace' });
      expect(again.status).toBe('active');
      await as(orgB, userB, () => service.release(again.id, {}));
    });

    it("the operator's own workspace hold counts too", async () => {
      const c = await contact(orgB);
      await owner.query(`UPDATE organizations SET legal_hold = true WHERE id = $1`, [orgB]);
      expect(await held(orgB, 'contact', c.id)).toBe(true);
      await owner.query(`UPDATE organizations SET legal_hold = false WHERE id = $1`, [orgB]);
      expect(await held(orgB, 'contact', c.id)).toBe(false);
    });
  });

  describe('the delete trigger, the net under every purge path', () => {
    it('refuses a direct delete of a held contact and of a held lead, and lets the delete through once released', async () => {
      const c = await contact(orgA);
      const leadId = await one(
        `INSERT INTO leads (org_id, name, phone, contact_id, source) VALUES ($1,'L',$2,$3,'manual') RETURNING id`,
        [orgA, c.phone, c.id],
      );
      const h = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      await expect(owner.query(`DELETE FROM contacts WHERE id = $1`, [c.id])).rejects.toThrow(
        /LEGAL_HOLD_ACTIVE/,
      );
      await expect(owner.query(`DELETE FROM leads WHERE id = $1`, [leadId])).rejects.toThrow(
        /LEGAL_HOLD_ACTIVE/,
      );
      await as(orgA, userA, () => service.release(h.id, {}));
      await owner.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
      await owner.query(`DELETE FROM contacts WHERE id = $1`, [c.id]);
      // the register keeps the released hold, without a link to the person
      const row = (
        await owner.query(`SELECT status, contact_id FROM legal_holds WHERE uuid = $1`, [h.id])
      ).rows[0];
      expect(row).toEqual({ status: 'released', contact_id: null });
    });

    it('a workspace hold refuses the delete of any contact in it, and not of another workspace', async () => {
      const inA = await contact(orgA);
      const inB = await contact(orgB);
      const w = await place(orgA, userA, { scope: 'workspace' });
      await expect(owner.query(`DELETE FROM contacts WHERE id = $1`, [inA.id])).rejects.toThrow(
        /LEGAL_HOLD_ACTIVE/,
      );
      await owner.query(`DELETE FROM contacts WHERE id = $1`, [inB.id]);
      await as(orgA, userA, () => service.release(w.id, {}));
      await owner.query(`DELETE FROM contacts WHERE id = $1`, [inA.id]);
    });

    it('the erasure door of the CRM (single and bulk delete) refuses before anything is touched', async () => {
      const a1 = await contact(orgA);
      const a2 = await contact(orgA);
      const h = await place(orgA, userA, { scope: 'contact', subjectId: a1.uuid });
      const eraser = new PersonalDataErasureService(new SubjectResolver(), guard());
      const single = await as(orgA, userA, () =>
        code(db.tx((tx) => eraser.eraseContactHistory(tx, orgA, [a1.id], 'delete'))),
      );
      expect(single).toBe(ERROR_CODES.LEGAL_HOLD_ACTIVE);
      // a bulk batch with one held contact is refused whole: the free one is not touched either
      const bulk = await as(orgA, userA, () =>
        code(db.tx((tx) => eraser.eraseContactHistory(tx, orgA, [a1.id, a2.id], 'delete'))),
      );
      expect(bulk).toBe(ERROR_CODES.LEGAL_HOLD_ACTIVE);
      expect(
        (
          await owner.query(`SELECT count(*)::int AS n FROM contacts WHERE id IN ($1, $2)`, [
            a1.id,
            a2.id,
          ])
        ).rows[0].n,
      ).toBe(2);
      // the refusal is audited in its own transaction (the refusing one rolled back)
      const audited = await owner.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'legal_holds' AND action = 'read'`,
        [orgA],
      );
      expect(audited.rows[0].n).toBeGreaterThanOrEqual(2);
      // a free contact goes through the same door
      const free = await as(orgA, userA, () =>
        code(db.tx((tx) => eraser.eraseContactHistory(tx, orgA, [a2.id], 'delete'))),
      );
      expect(free).toBeUndefined();
      await as(orgA, userA, () => service.release(h.id, {}));
    });
  });

  describe('tenant isolation', () => {
    it("one workspace never sees, releases or is blocked by another's hold", async () => {
      const a = await contact(orgA);
      const h = await place(orgA, userA, { scope: 'contact', subjectId: a.uuid });
      // from workspace B: the register is empty of A's hold, the hold is a 404, and B cannot release it
      const listB = await as(orgB, userB, () => service.list({ limit: 50 }));
      expect(listB.data.map((x) => x.id)).not.toContain(h.id);
      expect(await as(orgB, userB, () => code(service.get(h.id)))).toBe(
        ERROR_CODES.LEGAL_HOLD_NOT_FOUND,
      );
      expect(await as(orgB, userB, () => code(service.release(h.id, {})))).toBe(
        ERROR_CODES.LEGAL_HOLD_NOT_FOUND,
      );
      // the restricted role in B sees no row of A, and the function asked from B says no
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgB)]);
        const seen = await app.query(
          `SELECT count(*)::int AS n FROM legal_holds WHERE org_id = $1`,
          [orgA],
        );
        expect(seen.rows[0].n).toBe(0);
        const fn = await app.query(
          `SELECT is_subject_held($1::bigint, 'contact', $2::bigint) AS h`,
          [orgA, a.id],
        );
        expect(fn.rows[0].h).toBe(false);
        // and cannot write a hold into A
        await expect(
          app.query(
            `INSERT INTO legal_holds (org_id, scope, subject_label, reason_category, case_ref) VALUES ($1,'workspace','x','legal_claim','X')`,
            [orgA],
          ),
        ).rejects.toThrow();
      } finally {
        await app.query('ROLLBACK');
      }
      await as(orgA, userA, () => service.release(h.id, {}));
    });
  });

  describe('the register', () => {
    it('places once per subject (409 LEGAL_HOLD_EXISTS), with a masked label and no personal value in the answer', async () => {
      const c = await contact(orgA, 'Priya Nair');
      const h = await place(orgA, userA, {
        scope: 'contact',
        subjectId: c.uuid,
        reasonCategory: 'regulator_request',
        caseRef: 'REG-2026-17',
        note: 'letter received',
      });
      expect(h).toMatchObject({
        scope: 'contact',
        status: 'active',
        reasonCategory: 'regulator_request',
        caseRef: 'REG-2026-17',
        subjectId: c.uuid,
        placedBy: 'Ada Admin',
      });
      expect(JSON.stringify(h)).not.toContain('Priya');
      expect(JSON.stringify(h)).not.toContain(c.phone);
      expect(h.subjectLabel).toMatch(/^P••••/);
      expect(await code(place(orgA, userA, { scope: 'contact', subjectId: c.uuid }))).toBe(
        ERROR_CODES.LEGAL_HOLD_EXISTS,
      );
      expect(await code(place(orgA, userA, { scope: 'contact', subjectId: c.uuid }))).toBe(
        ERROR_CODES.LEGAL_HOLD_EXISTS,
      );
      // a person who is not in this workspace
      const other = await contact(orgB);
      expect(await code(place(orgA, userA, { scope: 'contact', subjectId: other.uuid }))).toBe(
        ERROR_CODES.PRIVACY_SUBJECT_NOT_FOUND,
      );
      await as(orgA, userA, () => service.release(h.id, {}));
    });

    it('extends (a further case reference, dates), records a review, lists with filters, and exports', async () => {
      const c = await contact(orgA);
      const h = await place(orgA, userA, {
        scope: 'contact',
        subjectId: c.uuid,
        caseRef: 'CASE-A',
        reviewAt: new Date(Date.now() - DAY).toISOString(),
      });
      expect(h.reviewDue).toBe(true);
      const ext = await as(orgA, userA, () =>
        service.extend(h.id, {
          addCaseRef: 'CASE-B',
          expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
        }),
      );
      expect(ext.caseRef).toBe('CASE-A; CASE-B');
      expect(ext.expiresAt).not.toBeNull();
      const rev = await as(orgA, userA, () =>
        service.review(h.id, { nextReviewAt: new Date(Date.now() + 90 * DAY).toISOString() }),
      );
      expect(rev.reviewDue).toBe(false);
      expect(rev.lastReviewedBy).toBe('Ada Admin');

      const due = await as(orgA, userA, () => service.list({ limit: 50, reviewDue: true }));
      expect(due.data.map((x) => x.id)).not.toContain(h.id);
      const byRef = await as(orgA, userA, () => service.list({ limit: 50, q: 'CASE-B' }));
      expect(byRef.data.map((x) => x.id)).toContain(h.id);
      const byCat = await as(orgA, userA, () =>
        service.list({ limit: 50, reasonCategory: 'internal_investigation' }),
      );
      expect(byCat.data.map((x) => x.id)).not.toContain(h.id);

      const detail = await as(orgA, userA, () => service.get(h.id));
      expect(detail.history.map((e) => e.action)).toEqual(
        expect.arrayContaining(['insert', 'update']),
      );
      // the note never travels in an audit delta
      expect(JSON.stringify(detail.history)).not.toContain('letter');

      const csv = await as(orgA, userA, () => service.exportCsv({ limit: 100 }));
      expect(csv.csv.split('\r\n')[0]).toContain('Case reference');
      expect(csv.csv).toContain('CASE-A; CASE-B');
      expect(csv.fileName).toMatch(/^legal-holds-\d{4}-\d{2}-\d{2}\.csv$/);
      await as(orgA, userA, () => service.release(h.id, {}));
    });

    it('rejects a past end date', async () => {
      const c = await contact(orgA);
      expect(
        await code(
          place(orgA, userA, {
            scope: 'contact',
            subjectId: c.uuid,
            expiresAt: new Date(Date.now() - DAY).toISOString(),
          }),
        ),
      ).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('releases once; a second release is refused; the audit trail says who and when', async () => {
      const c = await contact(orgA);
      const h = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      const out = await as(orgA, userA, () => service.release(h.id, { reason: 'matter closed' }));
      expect(out.hold).toMatchObject({
        status: 'released',
        releasedBy: 'Ada Admin',
        releaseNote: 'matter closed',
      });
      expect(await as(orgA, userA, () => code(service.release(h.id, {})))).toBe(
        ERROR_CODES.LEGAL_HOLD_NOT_ACTIVE,
      );
      expect(await as(orgA, userA, () => code(service.extend(h.id, { note: 'x' })))).toBe(
        ERROR_CODES.LEGAL_HOLD_NOT_ACTIVE,
      );
      const trail = await owner.query(
        `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'legal_holds' AND record_id =
           (SELECT id FROM legal_holds WHERE uuid = $2) ORDER BY id`,
        [orgA, h.id],
      );
      expect(trail.rows.map((r) => r.action)).toEqual(['insert', 'delete']);
      // the outbox carries the category and the scope, never the person
      const ev = await owner.query(
        `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'legal_holds'
          AND payload->>'uuid' = $2 ORDER BY id`,
        [orgA, h.id],
      );
      expect(ev.rows.map((r) => r.event_type)).toEqual([
        'legal_hold.placed',
        'legal_hold.released',
      ]);
      expect(JSON.stringify(ev.rows)).not.toContain(c.phone);
    });

    it('the worker ends a hold whose date has passed, and the slot is free for a new one', async () => {
      const c = await contact(orgA);
      const h = await place(orgA, userA, {
        scope: 'contact',
        subjectId: c.uuid,
        expiresAt: new Date(Date.now() + DAY).toISOString(),
      });
      await owner.query(
        `UPDATE legal_holds SET placed_at = now() - interval '3 days', expires_at = now() - interval '1 day' WHERE uuid = $1`,
        [h.id],
      );
      const ended = await service.expireDue();
      expect(ended).toBeGreaterThanOrEqual(1);
      const row = (
        await owner.query(`SELECT status, released_by FROM legal_holds WHERE uuid = $1`, [h.id])
      ).rows[0];
      expect(row).toEqual({ status: 'expired', released_by: null });
      const again = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      expect(again.status).toBe('active');
      await as(orgA, userA, () => service.release(again.id, {}));
    });

    it('marks the open erasure cases of the person restricted when the hold is placed, and lifts them when it ends', async () => {
      const c = await contact(orgA);
      const other = await contact(orgA);
      const mk = async (contactId: number, status = 'in_progress', type = 'erasure') =>
        one(
          `INSERT INTO privacy_requests (org_id, request_type, status, subject_kind, contact_id, subject_label, due_at)
           VALUES ($1, $2, $3, 'contact', $4, 'R••••', now() + interval '30 days') RETURNING id`,
          [orgA, type, status, contactId],
        );
      const mine = await mk(c.id);
      const mineAccess = await mk(c.id, 'in_progress', 'access');
      const mineDone = await mk(c.id, 'completed');
      const theirs = await mk(other.id);
      const state = async (id: number) =>
        (
          await owner.query(
            `SELECT restricted_at, restricted_hold_id FROM privacy_requests WHERE id = $1`,
            [id],
          )
        ).rows[0];

      const h = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      expect((await state(mine)).restricted_at).not.toBeNull();
      expect((await state(mineAccess)).restricted_at).toBeNull();
      expect((await state(mineDone)).restricted_at).toBeNull();
      expect((await state(theirs)).restricted_at).toBeNull();
      const detail = await as(orgA, userA, () => service.get(h.id));
      expect(detail.hold.restrictedCases).toBe(1);
      const ev = await owner.query(
        `SELECT event_type FROM privacy_request_events WHERE request_id = $1`,
        [mine],
      );
      expect(ev.rows.map((r) => r.event_type)).toContain('restricted');

      // a confirmed erasure is counted as resuming; an unconfirmed one just leaves the restriction
      await owner.query(
        `UPDATE privacy_requests SET erasure_confirmed_at = now(), erasure_confirmed_by = $2 WHERE id = $1`,
        [mine, userA],
      );
      const out = await as(orgA, userA, () => service.release(h.id, {}));
      expect(out.casesLifted).toBe(1);
      expect(out.erasuresResuming).toBe(1);
      expect((await state(mine)).restricted_at).toBeNull();
      const ev2 = await owner.query(
        `SELECT event_type FROM privacy_request_events WHERE request_id = $1`,
        [mine],
      );
      expect(ev2.rows.map((r) => r.event_type)).toContain('restriction_lifted');
    });

    it('a case stays restricted while another hold still covers the person', async () => {
      const c = await contact(orgA);
      const caseId = await one(
        `INSERT INTO privacy_requests (org_id, request_type, status, subject_kind, contact_id, subject_label, due_at)
         VALUES ($1, 'erasure', 'in_progress', 'contact', $2, 'R••••', now() + interval '30 days') RETURNING id`,
        [orgA, c.id],
      );
      const contactHold = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      const wide = await place(orgA, userA, { scope: 'workspace' });
      const out = await as(orgA, userA, () => service.release(contactHold.id, {}));
      expect(out.casesLifted).toBe(0);
      const row = (
        await owner.query(`SELECT restricted_at FROM privacy_requests WHERE id = $1`, [caseId])
      ).rows[0];
      expect(row.restricted_at).not.toBeNull();
      const out2 = await as(orgA, userA, () => service.release(wide.id, {}));
      // The workspace hold restricted every open erasure case of the workspace, so others are lifted with it.
      expect(out2.casesLifted).toBeGreaterThanOrEqual(1);
      const after = (
        await owner.query(`SELECT restricted_at FROM privacy_requests WHERE id = $1`, [caseId])
      ).rows[0];
      expect(after.restricted_at).toBeNull();
    });
  });

  describe('the status of one person (the contact banner)', () => {
    it('says held with the hold, or not held, and a workspace hold is flagged as such', async () => {
      const c = await contact(orgA);
      const none = await as(orgA, userA, () => service.status('contact', c.uuid));
      expect(none).toEqual({ held: false, hold: null, viaWorkspace: false });
      const h = await place(orgA, userA, { scope: 'contact', subjectId: c.uuid });
      const yes = await as(orgA, userA, () => service.status('contact', c.uuid));
      expect(yes.held).toBe(true);
      expect(yes.hold?.id).toBe(h.id);
      expect(yes.viaWorkspace).toBe(false);
      await as(orgA, userA, () => service.release(h.id, {}));
      const w = await place(orgA, userA, { scope: 'workspace' });
      const via = await as(orgA, userA, () => service.status('contact', c.uuid));
      expect(via).toMatchObject({ held: true, viaWorkspace: true });
      await as(orgA, userA, () => service.release(w.id, {}));
    });
  });

  describe('retention sweeps skip a held person and keep purging everyone else', () => {
    it('lead payloads: the held contact keeps the payload, the other is purged, and a release lets the next run purge it', async () => {
      const keep = await contact(orgA);
      const free = await contact(orgA);
      const sourceId = await one(
        `INSERT INTO lead_sources (org_id, kind, name, external_ref) VALUES ($1, 'connector', 'S', $2) RETURNING id`,
        [orgA, `ref-${++seq}`],
      );
      const event = (contactId: number, ext: string) =>
        one(
          `INSERT INTO lead_events (org_id, source_id, external_id, status, contact_id, payload, payload_expires_at)
           VALUES ($1, $2, $3, 'created', $4, '{"name":"x"}'::jsonb, now() - interval '1 day') RETURNING id`,
          [orgA, sourceId, ext, contactId],
        );
      const eKeep = await event(keep.id, 'k1');
      const eFree = await event(free.id, 'f1');
      const h = await place(orgA, userA, { scope: 'contact', subjectId: keep.uuid });
      const sweeper = new LeadRetentionSweepService(db, {
        prune: async () => 0,
      } as never);
      await sweeper.sweep();
      const payload = async (id: number) =>
        (
          await owner.query(`SELECT payload IS NOT NULL AS has FROM lead_events WHERE id = $1`, [
            id,
          ])
        ).rows[0].has;
      expect(await payload(eKeep)).toBe(true);
      expect(await payload(eFree)).toBe(false);
      await as(orgA, userA, () => service.release(h.id, {}));
      await sweeper.sweep();
      expect(await payload(eKeep)).toBe(false);
    });

    it('call log recordings: the reference to the recording of a held person stays', async () => {
      const keep = await contact(orgA);
      const free = await contact(orgA);
      const entry = (contactId: number, ext: string) =>
        one(
          `INSERT INTO call_log_entries (org_id, source, direction, outcome, started_at, contact_id, customer_phone, our_phone, external_id, recording_ref, recording_stored_at, recording_consent_status, recording_notice_version)
           VALUES ($1, 'telephony', 'outbound', 'connected', now(), $2, '+910000000000', '+911140000000', $3, 'rec/1', now() - interval '400 days', 'granted', 1) RETURNING id`,
          [orgA, contactId, ext],
        );
      const eKeep = await entry(keep.id, 'c-keep');
      const eFree = await entry(free.id, 'c-free');
      const h = await place(orgA, userA, { scope: 'contact', subjectId: keep.uuid });
      await new CallLogRetentionService(db).sweep();
      const ref = async (id: number) =>
        (await owner.query(`SELECT recording_ref FROM call_log_entries WHERE id = $1`, [id]))
          .rows[0].recording_ref;
      expect(await ref(eKeep)).toBe('rec/1');
      expect(await ref(eFree)).toBeNull();
      await as(orgA, userA, () => service.release(h.id, {}));
    });

    it('call recordings: the expired list leaves the held person out', async () => {
      const keep = await contact(orgA);
      const free = await contact(orgA);
      const call = (contactId: number, key: string) =>
        one(
          `INSERT INTO wa_calls (org_id, direction, from_phone, to_phone, contact_id, recording_path, recording_stored_at)
           VALUES ($1, 'USER_INITIATED', '+910000000001', '+918000000000', $2, $3, now() - interval '400 days') RETURNING id`,
          [orgA, contactId, key],
        );
      const cKeep = await call(keep.id, `calls/${orgA}/keep.ogg`);
      const cFree = await call(free.id, `calls/${orgA}/free.ogg`);
      const h = await place(orgA, userA, { scope: 'contact', subjectId: keep.uuid });
      const calls = new CallRecordingRepository();
      const due = await db.privileged((tx) => calls.expired(tx, new Date(), 500, 90));
      const ids = due.filter((d) => d.orgId === orgA).map((d) => d.id);
      expect(ids).toContain(cFree);
      expect(ids).not.toContain(cKeep);
      const lock = await db.txAs({ orgId: orgA, userId: null }, (tx) =>
        calls.lockExpired(tx, orgA, cKeep, `calls/${orgA}/keep.ogg`, new Date(), 90),
      );
      expect(lock).toBe(false);
      await as(orgA, userA, () => service.release(h.id, {}));
    });

    it('the AI scoring log: a run about a held person is kept past its retention', async () => {
      const keep = await contact(orgA);
      const free = await contact(orgA);
      const run = (contactId: number) =>
        one(
          `INSERT INTO lead_scoring_runs (org_id, contact_id, status, trigger, created_at) VALUES ($1, $2, 'ok', 'manual', now() - interval '400 days') RETURNING id`,
          [orgA, contactId],
        );
      const rKeep = await run(keep.id);
      const rFree = await run(free.id);
      const h = await place(orgA, userA, { scope: 'contact', subjectId: keep.uuid });
      await db.privileged((tx) => new LeadScoringRepository().deleteOlderThan(tx, 90));
      const left = (
        await owner.query(`SELECT id FROM lead_scoring_runs WHERE id IN ($1, $2)`, [rKeep, rFree])
      ).rows.map((r) => Number(r.id));
      expect(left).toEqual([rKeep]);
      await as(orgA, userA, () => service.release(h.id, {}));
    });

    it('a generated export file is kept while the workspace is under a workspace hold, and expires after', async () => {
      const file = await one(
        `INSERT INTO audit_log_exports (org_id, requested_by, status, file_gz, expires_at) VALUES ($1, $2, 'ready', '\\x00'::bytea, now() - interval '1 day') RETURNING id`,
        [orgA, userA],
      );
      const { AuditLogRepository } =
        await import('../../../src/modules/audit-log/audit-log.repository');
      const logs = new AuditLogRepository();
      const w = await place(orgA, userA, { scope: 'workspace' });
      await db.privileged((tx) => logs.expireExports(tx, new Date()));
      expect(
        (await owner.query(`SELECT status FROM audit_log_exports WHERE id = $1`, [file])).rows[0]
          .status,
      ).toBe('ready');
      await as(orgA, userA, () => service.release(w.id, {}));
      await db.privileged((tx) => logs.expireExports(tx, new Date()));
      expect(
        (await owner.query(`SELECT status FROM audit_log_exports WHERE id = $1`, [file])).rows[0]
          .status,
      ).toBe('expired');
    });
  });
});
