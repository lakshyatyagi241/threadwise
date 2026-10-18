import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addNumber, startCallPipeline, type CallPipeline, type Tenant } from './support';

/**
 * BL-257 end to end: the Call logs list, cards, filters, detail and analytics need `call.logs.read`, not the plan feature
 * `waba_calling`. A workspace that only writes calls down (Log a call, the mobile app, a telephony provider) has them; what is
 * WhatsApp's (playing a recording, the filter by WhatsApp number, the calling numbers, readiness and recording settings) stays behind
 * the feature with the existing 422 PLAN_FEATURE_LOCKED. The record scope of `call.logs.read` and the tenant walls hold either way.
 * Real API, real Postgres (restricted role); the logged calls are written through the real routes.
 */
let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
}, 900_000);
afterAll(async () => {
  await p?.stop();
});

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
let seq = 0;
const phone = () => `+9198120${String(10000 + seq++)}`;

const LOGS = '/v2/calling/call-logs';
const post = (token: string, path: string, body: unknown = {}) =>
  p.api
    .as(token)
    .post(path)
    .send(body as object);
const get = (token: string, path: string) => p.api.as(token).get(path);
const ids = (body: { rows: Array<{ id: string }> }) => body.rows.map((r) => r.id);

const setPlan = (t: Tenant, whatsappCalling: boolean) =>
  p.h.owner.query(`UPDATE org_plan_state SET overrides = $2 WHERE org_id = $1`, [
    t.orgId,
    whatsappCalling ? '{}' : '{"features":{"waba_calling":false}}',
  ]);

/** A workspace with one contact, and (unless told otherwise) without WhatsApp calling. */
async function setup(label: string, o: { whatsapp?: boolean } = {}) {
  const t = await p.api.signup(label);
  await setPlan(t, o.whatsapp ?? false);
  const number = phone();
  const [contactId] = await p.api.seedContacts(t, [{ name: 'Asha Rao', phone: number }]);
  return { t, contactId: contactId!, number };
}

const logCall = (token: string, contactId: string, over: Record<string, unknown> = {}) =>
  post(token, '/v2/calls/log', {
    contactId,
    direction: 'outbound',
    outcome: 'connected',
    durationSec: 120,
    startedAt: iso(HOUR),
    ...over,
  });

/** A WhatsApp call left in the workspace from the time it had the feature. */
async function whatsappCall(t: Tenant, contactUuid: string, handlerUserId: number | null) {
  const number = await addNumber(p, t);
  const contact = (await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid]))
    .rows[0].id;
  const res = await p.h.owner.query(
    `INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, direction, from_phone, to_phone, contact_id, status,
                           handler_type, handler_user_id, started_at, answered_at, ended_at, duration_sec, end_reason)
     VALUES ($1,'waba',$2,$3,'USER_INITIATED','919811011111',$4,$5,'ended',$6,$7,$8,$8,$8,75,'COMPLETED') RETURNING uuid`,
    [
      t.orgId,
      number.configId,
      `wacid.nowa.${Date.now()}.${seq++}`,
      number.phone.replace(/\D/g, ''),
      contact,
      handlerUserId ? 'operator' : 'none',
      handlerUserId,
      iso(30 * 60_000),
    ],
  );
  return { uuid: String(res.rows[0].uuid), number };
}

describe('a workspace without WhatsApp calling opens the Call logs', () => {
  it('lists, counts and filters the calls it logged, whatever the way they were logged', async () => {
    const { t, contactId, number } = await setup('nwa1');
    const manual = await logCall(t.admin, contactId, { notes: 'Quote sent' });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    const missed = await logCall(t.admin, contactId, {
      direction: 'inbound',
      outcome: 'no_answer',
      durationSec: 0,
      startedAt: iso(2 * HOUR),
    });
    const mobile = await post(t.admin, '/v2/calls/ingest', {
      deviceId: 'pixel-7',
      platform: 'android',
      entries: [
        {
          deviceCallId: '1',
          direction: 'inbound',
          startedAt: iso(3 * HOUR),
          durationSec: 45,
          customerPhone: number,
          deviceCallType: 'incoming',
        },
      ],
    });
    expect(mobile.body.counts.created, JSON.stringify(mobile.body)).toBe(1);

    const list = await get(t.admin, LOGS);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.total).toBe(3);
    expect(ids(list.body)).toEqual([
      manual.body.entry.id,
      missed.body.entry.id,
      mobile.body.results[0].id,
    ]);
    expect(list.body.rows.map((r: { source: string }) => r.source)).toEqual([
      'manual',
      'manual',
      'mobile_app',
    ]);
    expect(list.body.kpis.workspace).toMatchObject({
      total: 3,
      last24h: 3,
      completed: 2,
      failed: 1,
    });
    expect(list.body.kpis.selection).toMatchObject({ total: 3, answered: 2, missed: 1 });

    // The Source filter, the status and the direction narrow it as with the feature.
    const bySource = await get(t.admin, `${LOGS}?source=mobile_app`);
    expect(ids(bySource.body)).toEqual([mobile.body.results[0].id]);
    expect(ids((await get(t.admin, `${LOGS}?source=telephony`)).body)).toEqual([]);
    const noAnswer = await get(t.admin, `${LOGS}?status=no-answer&direction=inbound`);
    expect(ids(noAnswer.body)).toEqual([missed.body.entry.id]);
    const search = await get(t.admin, `${LOGS}?q=Asha`);
    expect(search.body.total).toBe(3);
  });

  it('has no WhatsApp rows to show and offers no WhatsApp number, even when one is connected', async () => {
    const { t, contactId } = await setup('nwa2');
    await addNumber(p, t);
    await logCall(t.admin, contactId);
    const filters = await get(t.admin, `${LOGS}/filters`);
    expect(filters.status, JSON.stringify(filters.body)).toBe(200);
    expect(filters.body.numbers).toEqual([]);
    expect(filters.body.agents.map((a: { name: string }) => a.name)).toEqual(['Admin Person']);
    // "WhatsApp" as a source finds nothing; it is not an error (a bookmarked address from before keeps working).
    const wa = await get(t.admin, `${LOGS}?source=whatsapp`);
    expect(wa.status).toBe(200);
    expect(wa.body.total).toBe(0);
  });

  it('opens one logged call, with its notes and no recording to play', async () => {
    const { t, contactId } = await setup('nwa3');
    const made = await logCall(t.admin, contactId, { notes: 'Wants the annual plan' });
    const d = await get(t.admin, `${LOGS}/${made.body.entry.id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.call).toMatchObject({
      source: 'manual',
      outcome: 'connected',
      notes: 'Wants the annual plan',
      contactName: 'Asha Rao',
    });
    expect(d.body.recording.available).toBe(false);
    expect(d.body.timeline[0]).toMatchObject({ type: 'logged' });
  });

  it('draws the analytics of the logged calls, by source', async () => {
    const { t, contactId } = await setup('nwa4');
    await logCall(t.admin, contactId);
    await logCall(t.admin, contactId, {
      direction: 'inbound',
      outcome: 'no_answer',
      durationSec: 0,
    });
    const a = await get(t.admin, `${LOGS}/analytics?range=7d`);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.totals).toMatchObject({ total: 2, answered: 1, missed: 1 });
    expect(a.body.bySource).toEqual([{ source: 'manual', calls: 2, answered: 1, missed: 1 }]);
    expect(a.body.byAgent[0]).toMatchObject({ name: 'Admin Person', calls: 2 });
    const filtered = await get(t.admin, `${LOGS}/analytics?range=7d&source=telephony`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.totals.total).toBe(0);
  });

  it('still shows the contact’s calls, as before', async () => {
    const { t, contactId } = await setup('nwa5');
    const made = await logCall(t.admin, contactId);
    const calls = await get(t.admin, `/v2/contacts/${contactId}/calls`);
    expect(calls.status).toBe(200);
    expect(calls.body.data.map((r: { id: string }) => r.id)).toEqual([made.body.entry.id]);
  });
});

describe('what is WhatsApp’s stays behind the plan feature', () => {
  const locked = (res: { status: number; body: { code?: string } }, what: string) => {
    expect(res.status, what).toBe(422);
    expect(res.body.code, what).toBe('PLAN_FEATURE_LOCKED');
  };

  it('refuses the filter by WhatsApp number, playing a recording, the calling numbers and the recording settings', async () => {
    const { t, contactId } = await setup('wagate1');
    const number = await addNumber(p, t);
    const made = await logCall(t.admin, contactId);
    locked(await get(t.admin, `${LOGS}?numberId=${number.uuid}`), 'list by number');
    locked(await get(t.admin, `${LOGS}/analytics?numberId=${number.uuid}`), 'analytics by number');
    locked(await post(t.admin, `${LOGS}/${made.body.entry.id}/playback`), 'playback');
    locked(await get(t.admin, '/v2/calling/numbers'), 'calling numbers');
    locked(await get(t.admin, '/v2/calling/recording-settings'), 'recording settings');
    // The refusal changes nothing the log shows.
    expect((await get(t.admin, LOGS)).status).toBe(200);
  });

  it('opens them again when the feature is on, and the number filter then narrows the list', async () => {
    const { t, contactId } = await setup('wagate2', { whatsapp: true });
    const wa = await whatsappCall(t, contactId, t.adminUserId);
    const made = await logCall(t.admin, contactId);
    const all = await get(t.admin, LOGS);
    expect(all.body.total).toBe(2);
    const filters = await get(t.admin, `${LOGS}/filters`);
    expect(filters.body.numbers.map((n: { id: string }) => n.id)).toEqual([wa.number.uuid]);
    const byNumber = await get(t.admin, `${LOGS}?numberId=${wa.number.uuid}`);
    expect(byNumber.status, JSON.stringify(byNumber.body)).toBe(200);
    expect(ids(byNumber.body)).toEqual([wa.uuid]);
    expect((await get(t.admin, `${LOGS}/analytics?numberId=${wa.number.uuid}`)).status).toBe(200);
    expect((await get(t.admin, '/v2/calling/numbers')).status).toBe(200);
    // Playing is not refused by the plan: this call has no recording, so it is a plain 404.
    expect((await post(t.admin, `${LOGS}/${made.body.entry.id}/playback`)).status).toBe(404);
  });

  it('keeps the calls from the time the workspace had the feature readable, but cannot play their recordings', async () => {
    const { t, contactId } = await setup('wagate3', { whatsapp: true });
    const wa = await whatsappCall(t, contactId, t.adminUserId);
    await logCall(t.admin, contactId);
    await setPlan(t, false);
    const list = await get(t.admin, LOGS);
    expect(list.body.total).toBe(2);
    expect(list.body.rows.map((r: { source: string }) => r.source).sort()).toEqual([
      'manual',
      'whatsapp',
    ]);
    expect((await get(t.admin, `${LOGS}/${wa.uuid}`)).status).toBe(200);
    locked(await post(t.admin, `${LOGS}/${wa.uuid}/playback`), 'playback of an old call');
    // The contact’s calls read the same two tables, as they always did.
    const calls = await get(t.admin, `/v2/contacts/${contactId}/calls`);
    expect(calls.body.data).toHaveLength(2);
  });
});

describe('permissions, record scope and tenant walls hold without the feature', () => {
  it('still needs call.logs.read: calling alone does not open the log, and the plan does not matter', async () => {
    const { t, contactId } = await setup('perm1');
    const made = await logCall(t.admin, contactId);
    const none = await p.api.member(t, 'nokey', [['call.calls.use']]);
    for (const path of [
      LOGS,
      `${LOGS}/filters`,
      `${LOGS}/analytics`,
      `${LOGS}/${made.body.entry.id}`,
    ]) {
      expect((await get(none.token, path)).status, path).toBe(403);
    }
    expect((await post(none.token, `${LOGS}/${made.body.entry.id}/playback`)).status).toBe(403);
    const reader = await p.api.member(t, 'reader', [['call.logs.read']]);
    expect((await get(reader.token, LOGS)).status).toBe(200);
    // Reading the log does not give the right to log: that is call.logs.create.
    expect((await logCall(reader.token, contactId)).status).toBe(403);
  });

  it('applies own, team and all to the logged calls', async () => {
    const { t, contactId } = await setup('scope1');
    const alice = await p.api.member(t, 'alice', [
      ['call.logs.create'],
      ['call.logs.read', 'own'],
      ['record.contacts.read'],
    ]);
    const bob = await p.api.member(t, 'bob', [
      ['call.logs.create'],
      ['call.logs.read', 'own'],
      ['record.contacts.read'],
    ]);
    const lead = await p.api.member(t, 'lead', [
      ['call.logs.read', 'team'],
      ['record.contacts.read'],
    ]);
    const wide = await p.api.member(t, 'wide', [['call.logs.read', 'all']]);
    const team = await p.h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, 'Support') RETURNING id`,
      [t.orgId],
    );
    for (const u of [lead.userId, bob.userId]) {
      await p.h.owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1, $2, $3)`,
        [t.orgId, team.rows[0].id, u],
      );
    }
    const a = await logCall(alice.token, contactId);
    const b = await logCall(bob.token, contactId, { outcome: 'busy', durationSec: 0 });
    expect(a.status, JSON.stringify(a.body)).toBe(201);

    const idsOf = async (token: string) => ids((await get(token, LOGS)).body).sort();
    expect(await idsOf(alice.token)).toEqual([a.body.entry.id]);
    expect(await idsOf(bob.token)).toEqual([b.body.entry.id]);
    expect(await idsOf(lead.token)).toEqual([b.body.entry.id]);
    expect(await idsOf(wide.token)).toEqual([a.body.entry.id, b.body.entry.id].sort());
    // The cards and the analytics count only what the person may see.
    expect((await get(alice.token, LOGS)).body.kpis.workspace.total).toBe(1);
    expect((await get(alice.token, `${LOGS}/analytics?range=7d`)).body.totals.total).toBe(1);
    expect((await get(lead.token, `${LOGS}/analytics?range=7d`)).body.totals.total).toBe(1);
    expect((await get(wide.token, `${LOGS}/analytics?range=7d`)).body.totals.total).toBe(2);
    // Outside the scope the detail is a 404, not a 403: it does not confirm the call exists.
    expect((await get(alice.token, `${LOGS}/${b.body.entry.id}`)).status).toBe(404);
    expect((await get(lead.token, `${LOGS}/${a.body.entry.id}`)).status).toBe(404);
    expect((await get(wide.token, `${LOGS}/${a.body.entry.id}`)).status).toBe(200);
    // And the teammates offered to the filter are those whose calls the person may see.
    const agents = await get(alice.token, `${LOGS}/filters`);
    expect(agents.body.agents.map((x: { name: string }) => x.name)).toEqual(['alice']);
  });

  it('keeps one workspace’s calls from another, with the feature off in both, and RLS under the routes', async () => {
    const one = await setup('wall1');
    const two = await setup('wall2');
    const mine = await logCall(one.t.admin, one.contactId, { notes: 'secret of workspace one' });
    await logCall(two.t.admin, two.contactId);

    const seenByTwo = await get(two.t.admin, LOGS);
    expect(seenByTwo.body.total).toBe(1);
    expect(ids(seenByTwo.body)).not.toContain(mine.body.entry.id);
    expect((await get(two.t.admin, `${LOGS}/${mine.body.entry.id}`)).status).toBe(404);
    const analytics = await get(two.t.admin, `${LOGS}/analytics?range=7d`);
    expect(analytics.body.totals.total).toBe(1);
    expect(JSON.stringify(seenByTwo.body)).not.toContain('secret of workspace one');
    const contact = await get(two.t.admin, `/v2/contacts/${one.contactId}/calls`);
    expect(contact.status).toBe(404);

    // Below the routes, the restricted role sees only its own workspace's entries, and none without a workspace.
    const asTenant = async (orgId: number | null) => {
      await p.h.owner.query('BEGIN');
      try {
        await p.h.owner.query('SET LOCAL ROLE crm_app_user');
        if (orgId !== null)
          await p.h.owner.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
        return Number(
          (await p.h.owner.query(`SELECT count(*) AS n FROM call_log_entries`)).rows[0].n,
        );
      } finally {
        await p.h.owner.query('ROLLBACK');
      }
    };
    expect(await asTenant(null)).toBe(0);
    expect(await asTenant(two.t.orgId)).toBe(1);
  });
});
