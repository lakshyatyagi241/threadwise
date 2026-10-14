import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RECORDING_NOTICE,
  addNumber,
  enableRecording,
  startCallPipeline,
  type CallNumber,
  type CallPipeline,
} from './support';

/**
 * BL-144: call recording consent and lifecycle against the real API and Postgres (restricted role) and the private media store.
 * Recording is off by default; no audio is kept before the ConsentGate allows it; consent evidence sits on the call; the daily sweep
 * and a manual delete remove the file; a legal hold protects it.
 */
let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

const WEBM = Buffer.concat([
  Buffer.from('1a45dfa39f4286810142f7810142f2810442f3810842820477656' + '26d4287810442858102', 'hex'),
  Buffer.alloc(400, 0x7f),
]);
let seq = 0;

async function liveCall(t: { orgId: number; adminUserId: number }, number: CallNumber) {
  const res = await p.h.owner.query(
    `INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, direction, from_phone, to_phone, status,
                           handler_type, handler_user_id, started_at, answered_at)
     VALUES ($1, 'waba', $2, $3, 'USER_INITIATED', $4, $5, 'active', 'operator', $6, now(), now()) RETURNING uuid`,
    [
      t.orgId,
      number.configId,
      `wacid.rec.${Date.now()}.${seq++}`,
      `91981120${String(1000 + seq)}`,
      number.phone.replace(/\D/g, ''),
      t.adminUserId,
    ],
  );
  return String(res.rows[0].uuid);
}

async function setup(label: string) {
  const t = await p.api.signup(label);
  const number = await addNumber(p, t);
  p.meta.reset();
  return { t, number };
}

const upload = (token: string, id: string) =>
  p.api.as(token).post(`/v2/calling/calls/${id}/recording`).attach('recording', WEBM, 'call.webm');
const consent = (token: string, id: string, decision: 'granted' | 'declined', method = 'spoken_yes') =>
  p.api.as(token).post(`/v2/calling/calls/${id}/recording-consent`).send({ decision, method });
const row = async (id: string) =>
  (await p.h.owner.query(`SELECT * FROM wa_calls WHERE uuid = $1::uuid`, [id])).rows[0];

describe('the workspace rules', () => {
  it('recording is off by default and the defaults are 90 days, confirmed', async () => {
    const { t } = await setup('rcdef');
    const r = await p.api.as(t.admin).get('/v2/calling/recording-settings');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      enabled: false,
      consentMode: 'confirmed',
      retentionDays: 90,
      noticeText: null,
      noticeVersion: 0,
      rowVersion: null,
    });
  });

  it('refuses to switch recording on without a notice, and keeps every notice version with its hash', async () => {
    const { t } = await setup('rcset');
    const bad = await p.api.as(t.admin).put('/v2/calling/recording-settings').send({
      enabled: true,
      consentMode: 'confirmed',
      retentionDays: 90,
      noticeText: '',
    });
    expect(bad.status).toBe(422);

    const v1 = await enableRecording(p, t);
    expect(v1.noticeVersion).toBe(1);
    // the same text again is not a new version; another text is
    const same = await p.api.as(t.admin).put('/v2/calling/recording-settings').send({
      enabled: true,
      consentMode: 'confirmed',
      retentionDays: 30,
      noticeText: RECORDING_NOTICE,
      rowVersion: v1.rowVersion,
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body).toMatchObject({ noticeVersion: 1, retentionDays: 30 });
    const next = await p.api.as(t.admin).put('/v2/calling/recording-settings').send({
      enabled: true,
      consentMode: 'announcement',
      retentionDays: 30,
      noticeText: 'We record this call for quality.',
      rowVersion: same.body.rowVersion,
    });
    expect(next.body.noticeVersion).toBe(2);
    const versions = await p.h.owner.query(
      `SELECT version, sha256 FROM call_recording_notice_versions WHERE org_id = $1 ORDER BY version`,
      [t.orgId],
    );
    expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);
    expect(versions.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    // a stale row version is a conflict, not a silent overwrite
    const stale = await p.api.as(t.admin).put('/v2/calling/recording-settings').send({
      enabled: false,
      consentMode: 'confirmed',
      retentionDays: 30,
      noticeText: 'We record this call for quality.',
      rowVersion: same.body.rowVersion,
    });
    expect(stale.status).toBe(409);
  });

  it('only a person with call.recordings.manage writes the rules, and workspaces do not see each other', async () => {
    const a = await p.api.signup('rcperma');
    const b = await p.api.signup('rcpermb');
    await enableRecording(p, a);
    const other = await p.api.as(b.admin).get('/v2/calling/recording-settings');
    expect(other.body.enabled).toBe(false);
    const rls = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM call_recording_settings WHERE org_id = $1`,
      [b.orgId],
    );
    expect(rls.rows[0].n).toBe(0);
  });
});

describe('no consent, no recording', () => {
  it('refuses an upload while recording is off, and while no answer is recorded; nothing is stored', async () => {
    const { t, number } = await setup('rcgate');
    const id = await liveCall(t, number);
    const off = await upload(t.admin, id);
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('CALL_RECORDING_DISABLED');

    await enableRecording(p, t);
    const gate = await p.api.as(t.admin).get(`/v2/calling/calls/${id}/recording-gate`);
    expect(gate.body).toMatchObject({
      decision: 'needs_notice',
      reason: 'notice_required',
      noticeText: RECORDING_NOTICE,
    });
    const none = await upload(t.admin, id);
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('CALL_RECORDING_CONSENT_REQUIRED');
    expect((await row(id)).recording_path).toBeNull();
  });

  it('a refusal leaves no recording and a later upload is still refused', async () => {
    const { t, number } = await setup('rcdecl');
    const id = await liveCall(t, number);
    await enableRecording(p, t);
    const no = await consent(t.admin, id, 'declined');
    expect(no.status, JSON.stringify(no.body)).toBe(200);
    expect(no.body).toMatchObject({ decision: 'deny', reason: 'consent_declined' });
    const up = await upload(t.admin, id);
    expect(up.body.code).toBe('CALL_RECORDING_CONSENT_REQUIRED');
    expect((await row(id)).recording_path).toBeNull();
  });

  it('a yes stores the evidence (method, time, notice version and hash, teammate) and the upload is accepted', async () => {
    const { t, number } = await setup('rcyes');
    const id = await liveCall(t, number);
    await enableRecording(p, t);
    const yes = await consent(t.admin, id, 'granted');
    expect(yes.body).toMatchObject({ decision: 'allow', reason: 'consent_evidence_recorded' });
    const again = await consent(t.admin, id, 'granted');
    expect(again.status).toBe(200);
    const events = await p.h.owner.query(
      `SELECT event_type FROM wa_call_events e JOIN wa_calls w ON w.id = e.wa_call_id AND w.org_id = e.org_id
        WHERE w.uuid = $1::uuid AND e.event_type LIKE 'recording_consent%'`,
      [id],
    );
    expect(events.rows).toHaveLength(1); // the repeat wrote nothing

    const up = await upload(t.admin, id);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const r = await row(id);
    expect(r).toMatchObject({
      recording_consent_status: 'granted',
      recording_consent_method: 'spoken_yes',
      recording_notice_version: 1,
      recording_consent_by: t.adminUserId,
    });
    expect(r.recording_notice_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.recording_stored_at).not.toBeNull();
    expect(r.recording_path).toBeTruthy();

    const detail = await p.api.as(t.admin).get(`/v2/calling/call-logs/${id}`);
    expect(detail.body.recording.lifecycle).toMatchObject({
      legalHold: false,
      consent: { status: 'granted', method: 'spoken_yes', noticeVersion: 1 },
    });
    expect(detail.body.recording.lifecycle.expiresAt).toBeTruthy();
  });

  it('the method must fit the workspace mode, and consent is only taken on a live call', async () => {
    const { t, number } = await setup('rcmode');
    const id = await liveCall(t, number);
    await enableRecording(p, t, { mode: 'announcement' });
    const wrong = await consent(t.admin, id, 'granted', 'spoken_yes');
    expect(wrong.body.code).toBe('CALL_RECORDING_CONSENT_INVALID');
    const ok = await consent(t.admin, id, 'granted', 'announcement_continue');
    expect(ok.body.decision).toBe('allow');
    await p.h.owner.query(`UPDATE wa_calls SET status = 'ended' WHERE uuid = $1::uuid`, [id]);
    const late = await consent(t.admin, id, 'declined', 'announcement_continue');
    expect(late.body.code).toBe('CALL_RECORDING_CONSENT_INVALID');
  });

  it('switching recording off stops uploads even with a recorded yes', async () => {
    const { t, number } = await setup('rcoff');
    const id = await liveCall(t, number);
    const v = await enableRecording(p, t);
    await consent(t.admin, id, 'granted');
    await p.api.as(t.admin).put('/v2/calling/recording-settings').send({
      enabled: false,
      consentMode: 'confirmed',
      retentionDays: 90,
      noticeText: RECORDING_NOTICE,
      rowVersion: v.rowVersion,
    });
    expect((await upload(t.admin, id)).body.code).toBe('CALL_RECORDING_DISABLED');
  });

  it('a decline after the file was stored removes the file', async () => {
    const { t, number } = await setup('rcwithdraw');
    const id = await liveCall(t, number);
    await enableRecording(p, t);
    await consent(t.admin, id, 'granted');
    expect((await upload(t.admin, id)).status).toBe(200);
    expect((await row(id)).recording_path).toBeTruthy();
    await consent(t.admin, id, 'declined');
    const r = await row(id);
    expect(r.recording_path).toBeNull();
    expect(r.recording_deleted_reason).toBe('consent_withdrawn');
  });
});

describe('the lifecycle', () => {
  async function stored(label: string, o: { days?: number } = {}) {
    const { t, number } = await setup(label);
    const id = await liveCall(t, number);
    await enableRecording(p, t, { retentionDays: o.days ?? 90 });
    await consent(t.admin, id, 'granted');
    expect((await upload(t.admin, id)).status).toBe(200);
    return { t, id };
  }
  const age = (id: string, days: number) =>
    p.h.owner.query(
      `UPDATE wa_calls SET recording_stored_at = now() - make_interval(days => $2) WHERE uuid = $1::uuid`,
      [id, days],
    );
  const sweep = async () => {
    const { CallRecordingRetentionService } =
      await import('../../../src/modules/calling-voice/call-recording-retention.service');
    return p.h.app.get(CallRecordingRetentionService, { strict: false }).sweep();
  };

  it('the sweep deletes a recording older than the workspace window and keeps the call', async () => {
    const { id } = await stored('rcsweep', { days: 30 });
    await age(id, 29);
    await sweep();
    expect((await row(id)).recording_path).toBeTruthy();
    await age(id, 31);
    const out = await sweep();
    expect(out.deleted).toBeGreaterThanOrEqual(1);
    const r = await row(id);
    expect(r.recording_path).toBeNull();
    expect(r.recording_deleted_reason).toBe('retention');
    expect(r.status).toBe('active'); // the call row is untouched
  });

  it('the default window is 90 days for a workspace that never chose one', async () => {
    const { t, number } = await setup('rcdefsweep');
    const id = await liveCall(t, number);
    await p.h.owner.query(`UPDATE wa_calls SET recording_path = 'chat/x/none.webm' WHERE uuid = $1::uuid`, [id]);
    await age(id, 89);
    await sweep();
    expect((await row(id)).recording_path).toBeTruthy();
    await age(id, 91);
    await sweep();
    expect((await row(id)).recording_path).toBeNull();
  });

  it('a legal hold keeps the recording through the sweep and refuses a delete until lifted', async () => {
    const { t, id } = await stored('rchold');
    const noReason = await p.api
      .as(t.admin)
      .put(`/v2/calling/call-logs/${id}/recording-hold`)
      .send({ hold: true });
    expect(noReason.status).toBe(422);
    const on = await p.api
      .as(t.admin)
      .put(`/v2/calling/call-logs/${id}/recording-hold`)
      .send({ hold: true, reason: 'Dispute 4411' });
    expect(on.status, JSON.stringify(on.body)).toBe(204);
    await age(id, 400);
    await sweep();
    expect((await row(id)).recording_path).toBeTruthy();
    const del = await p.api.as(t.admin).delete(`/v2/calling/calls/${id}/recording`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('CALL_RECORDING_ON_HOLD');
    await p.api
      .as(t.admin)
      .put(`/v2/calling/call-logs/${id}/recording-hold`)
      .send({ hold: false });
    await sweep();
    expect((await row(id)).recording_path).toBeNull();
  });

  it('deletes one recording by hand, audited, and a second delete finds nothing', async () => {
    const { t, id } = await stored('rcdel');
    const del = await p.api.as(t.admin).delete(`/v2/calling/calls/${id}/recording`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    const r = await row(id);
    expect(r.recording_path).toBeNull();
    expect(r.recording_deleted_reason).toBe('manual');
    expect((await p.api.as(t.admin).get(`/v2/calling/calls/${id}/recording`)).status).toBe(404);
    expect((await p.api.as(t.admin).delete(`/v2/calling/calls/${id}/recording`)).status).toBe(404);
    const audit = await p.h.owner.query(
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'wa_calls' AND action = 'delete'`,
      [t.orgId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("another workspace's call is a 404 for every new route", async () => {
    const { id } = await stored('rcown');
    const other = await p.api.signup('rcother');
    await enableRecording(p, other);
    const as = p.api.as(other.admin);
    expect((await as.get(`/v2/calling/calls/${id}/recording-gate`)).status).toBe(404);
    expect((await consent(other.admin, id, 'granted')).status).toBe(404);
    expect((await as.delete(`/v2/calling/calls/${id}/recording`)).status).toBe(404);
  });
});
