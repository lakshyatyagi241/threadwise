import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { AuthMaintenanceService } from '../../../src/modules/auth/maintenance/auth-maintenance.service';
import { startHarness, type Harness } from './harness';

/** Retention housekeeping (TW-AUTH-037 audit_log_retention_days, TW-AUTH-046). */
let h: Harness;
const api = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/** The job is registered by the worker process only, so the app does not host it. */
const maintenance = () => new AuthMaintenanceService(h.app.get(DatabaseService));

async function organizationId(): Promise<number> {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', '10.8.0.1')
    .send({
      orgName: 'Retention Co',
      fullName: 'Retention Person',
      email: `retention${Date.now()}@example.test`,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = await h.owner.query(`SELECT id FROM organizations ORDER BY id DESC LIMIT 1`);
  return Number(row.rows[0].id);
}

describe('retention sweep', () => {
  it('prunes audit_log and security_events older than the window and keeps the rest', async () => {
    const orgId = await organizationId();
    await h.owner.query(
      `INSERT INTO audit_log (org_id, actor_type, module, record_id, action, at)
       VALUES ($1, 'user', 'auth', 9001, 'login', now() - interval '400 days'),
              ($1, 'user', 'auth', 9002, 'login', now() - interval '370 days'),
              ($1, 'user', 'contacts', 9003, 'update', now() - interval '366 days'),
              ($1, 'user', 'auth', 9004, 'login', now() - interval '10 days')`,
      [orgId],
    );
    await h.owner.query(
      `INSERT INTO security_events (actor_type, event, status, at)
       VALUES ('system', 'test.old', 'info', now() - interval '500 days'),
              ('system', 'test.recent', 'info', now())`,
    );

    const svc = maintenance();
    const counts = await svc.sweep();
    expect(counts.retentionDays).toBe(365);
    expect(counts.securityEvents).toBeGreaterThanOrEqual(1);
    expect(await svc.pruneAuditLog(365)).toBe(3);

    const left = await h.owner.query(
      `SELECT record_id FROM audit_log WHERE org_id = $1 AND module IN ('auth', 'contacts') AND record_id IN (9001, 9002, 9003, 9004)`,
      [orgId],
    );
    expect(left.rows.map((r) => Number(r.record_id))).toEqual([9004]);
    const events = await h.owner.query(
      `SELECT event FROM security_events WHERE event IN ('test.old', 'test.recent')`,
    );
    expect(events.rows.map((r) => r.event)).toEqual(['test.recent']);
  });

  it('keeps everything when retention is 0', async () => {
    const svc = maintenance();
    const before = await h.owner.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(await svc.pruneAuditLog(0)).toBe(0);
    const after = await h.owner.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
