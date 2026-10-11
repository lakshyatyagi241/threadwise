import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orgLifecycleLogEntrySchema, orgLifecycleResponseSchema } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The operator's workspace lifecycle controls through HTTP (ADR-0028): permissions per key, validation, the never-delete switch, the
 * legal hold, restore, and that every change is recorded against the operator. Workspaces are arranged with the owner connection;
 * everything asserted goes through the real API, guards and database.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let auditorToken = '';
const ids: Record<string, { id: number; uuid: string }> = {};
const base = '/v2/platform/workspace-lifecycle';

async function operatorToken(email: string, role: string): Promise<string> {
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT $1, $2, password_hash, $3 FROM platform_operators WHERE email = $4 ON CONFLICT DO NOTHING`,
    [email, `${role} operator`, role, OPERATOR_EMAIL],
  );
  const res = await api()
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  return res.body.tokens.accessToken as string;
}

async function org(slug: string, idleDays: number, status = 'active') {
  const r = await h.owner.query(
    `INSERT INTO organizations (slug, name, status, last_activity_at, archived_at)
     VALUES ($1, $1, $2, now() - make_interval(days => $3),
             CASE WHEN $2 = 'archived' THEN now() - interval '5 days' END) RETURNING id, uuid`,
    [slug, status, idleDays],
  );
  ids[slug] = { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

const idem = () => ({
  'idempotency-key': `lc-${Math.random().toString(36).slice(2)}-${Date.now()}`,
});

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  superToken = token;
  auditorToken = await operatorToken('auditor-lc@platform.test', 'auditor');
  await org('lc-idle', 70);
  await org('lc-archived', 120, 'archived');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('workspace lifecycle operator API', () => {
  it('needs an operator token', async () => {
    expect((await api().get(base)).status).toBe(401);
  });

  it('lists workspaces most idle first with the schedule', async () => {
    const res = await api().get(`${base}?order=asc&limit=50`).set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (res.body.data as unknown[]).map((r) => orgLifecycleResponseSchema.parse(r));
    const idle = rows.find((r) => r.slug === 'lc-idle')!;
    expect(idle.daysInactive).toBe(70);
    expect(idle.archiveAfterDays).toBe(90);
    expect(idle.deleteAfterDays).toBe(180);
    expect(idle.scheduledArchiveAt).not.toBeNull();
    expect(idle.exemptByPlan).toBe(false);
    const days = rows.map((r) => r.daysInactive);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  it('a read-only operator can look but not change anything', async () => {
    expect(
      (await api().get(`${base}/${ids['lc-idle']!.uuid}`).set(bearer(auditorToken))).status,
    ).toBe(200);
    const body = { archiveAfterDays: 120, reason: 'trying it out' };
    const res = await api()
      .patch(`${base}/${ids['lc-idle']!.uuid}/policy`)
      .set({ ...bearer(auditorToken), ...idem() })
      .send(body);
    expect(res.status).toBe(403);
  });

  it('changes timings, validates them, and resets to the default', async () => {
    const url = `${base}/${ids['lc-idle']!.uuid}/policy`;
    const ok = await api()
      .patch(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ archiveAfterDays: 120, deleteAfterDays: 240, reason: 'enterprise onboarding' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(orgLifecycleResponseSchema.parse(ok.body)).toMatchObject({
      archiveAfterDays: 120,
      deleteAfterDays: 240,
    });

    const tooClose = await api()
      .patch(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ deleteAfterDays: 150, reason: 'too close to archive' });
    expect(tooClose.status).toBe(422);
    const tooShort = await api()
      .patch(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ archiveAfterDays: 10, reason: 'below the minimum' });
    expect(tooShort.status).toBe(422);
    const noReason = await api()
      .patch(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ archiveAfterDays: 100 });
    expect(noReason.status).toBe(422);

    const reset = await api()
      .patch(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ archiveAfterDays: null, deleteAfterDays: null, reason: 'back to the default' });
    expect(orgLifecycleResponseSchema.parse(reset.body)).toMatchObject({
      archiveAfterDays: 90,
      deleteAfterDays: 180,
    });
  });

  it('never delete: needs a reason, shows in the row, can be cleared', async () => {
    const url = `${base}/${ids['lc-idle']!.uuid}/exemption`;
    expect(
      (
        await api()
          .post(url)
          .set({ ...bearer(superToken), ...idem() })
          .send({ exempt: true, reason: 'x' })
      ).status,
    ).toBe(422);
    const on = await api()
      .post(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ exempt: true, reason: 'key account, contract until 2028' });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const row = orgLifecycleResponseSchema.parse(on.body);
    expect(row.retentionExempt).toBe(true);
    expect(row.scheduledArchiveAt).toBeNull();
    expect(row.retentionExemptBy).toMatch(/^platform_operator:\d+$/);
    const off = await api()
      .post(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ exempt: false, reason: 'contract ended' });
    expect(orgLifecycleResponseSchema.parse(off.body).retentionExempt).toBe(false);
  });

  it('legal hold has its own key; a role without it is refused', async () => {
    const url = `${base}/${ids['lc-idle']!.uuid}/legal-hold`;
    expect(
      (
        await api()
          .post(url)
          .set({ ...bearer(auditorToken), ...idem() })
          .send({ legalHold: true, reason: 'litigation' })
      ).status,
    ).toBe(403);
    const res = await api()
      .post(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ legalHold: true, reason: 'litigation 2027-01' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.legalHold).toBe(true);
    await api()
      .post(url)
      .set({ ...bearer(superToken), ...idem() })
      .send({ legalHold: false, reason: 'litigation closed' });
  });

  it('restores an archived workspace; an active one cannot be restored', async () => {
    const restore = (slug: string) =>
      api()
        .post(`${base}/${ids[slug]!.uuid}/restore`)
        .set({ ...bearer(superToken), ...idem() })
        .send({ reason: 'customer asked to come back' });
    const ok = await restore('lc-archived');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(orgLifecycleResponseSchema.parse(ok.body)).toMatchObject({
      status: 'active',
      daysInactive: 0,
    });
    expect((await restore('lc-archived')).status).toBe(422);
  });

  it('records every change against the operator', async () => {
    const res = await api().get(`${base}/${ids['lc-idle']!.uuid}/log`).set(bearer(superToken));
    expect(res.status).toBe(200);
    const log = (res.body as unknown[]).map((e) => orgLifecycleLogEntrySchema.parse(e));
    const kinds = log.map((e) => e.eventType);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'policy_changed',
        'exemption_set',
        'exemption_cleared',
        'legal_hold_set',
      ]),
    );
    expect(
      log.every(
        (e) =>
          e.actorType === 'platform_operator' && /^platform_operator:\d+$/.test(e.actorRef ?? ''),
      ),
    ).toBe(true);
  });

  it('unknown workspace is a 404, a malformed id a 422', async () => {
    expect(
      (await api().get(`${base}/7a5a5a5a-1111-4111-8111-111111111111`).set(bearer(superToken)))
        .status,
    ).toBe(404);
    expect((await api().get(`${base}/not-a-uuid`).set(bearer(superToken))).status).toBe(422);
  });
});
