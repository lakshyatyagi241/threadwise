import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callLogStatus } from '../../../src/modules/calling-voice/call-logs.rules';
import { seedDemoCalls } from '../../../src/modules/calling-voice/cli/demo-calls';
import {
  addNumber,
  enableRecording,
  grantConsentRow,
  startCallPipeline,
  type CallNumber,
  type CallPipeline,
} from './support';

/**
 * The call log and the call analytics (TW-CALL-022 onward) against the real API, real Postgres (restricted role) and the real private
 * media store. Calls are written straight into `wa_calls` the way the webhook leaves them, so each spec states exactly what it reads.
 */
let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let seq = 0;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// The first bytes of a WebM file: an EBML header declaring the document type "webm", padded.
const WEBM = Buffer.concat([
  Buffer.from(
    '1a45dfa39f4286810142f7810142f2810442f3810842820477656 26d'.replace(/ /g, '') +
      '4287810442858102',
    'hex',
  ),
  Buffer.alloc(400, 0x7f),
]);

interface CallSeed {
  direction?: 'USER_INITIATED' | 'BUSINESS_INITIATED';
  status?: string;
  durationSec?: number;
  endReason?: string | null;
  handlerUserId?: number | null;
  contactId?: number | null;
  startedAt?: Date;
  customer?: string;
  recordingPath?: string | null;
}

async function addCall(
  t: { orgId: number },
  number: CallNumber,
  o: CallSeed = {},
): Promise<string> {
  const inbound = (o.direction ?? 'USER_INITIATED') === 'USER_INITIATED';
  const customer = o.customer ?? `91981110${String(1000 + seq++)}`;
  const ours = number.phone.replace(/\D/g, '');
  const started = o.startedAt ?? new Date(Date.now() - HOUR);
  const duration = o.durationSec ?? 0;
  const res = await p.h.owner.query(
    `INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, direction, from_phone, to_phone, contact_id, status,
                           handler_type, handler_user_id, started_at, answered_at, ended_at, duration_sec, end_reason, recording_path)
     VALUES ($1, 'waba', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING uuid`,
    [
      t.orgId,
      number.configId,
      `wacid.logs.${Date.now()}.${seq++}`,
      o.direction ?? 'USER_INITIATED',
      inbound ? customer : ours,
      inbound ? ours : customer,
      o.contactId ?? null,
      o.status ?? 'ended',
      o.handlerUserId ? 'operator' : 'none',
      o.handlerUserId ?? null,
      started.toISOString(),
      duration > 0 ? new Date(started.getTime() + 5000).toISOString() : null,
      new Date(started.getTime() + (duration + 5) * 1000).toISOString(),
      duration,
      o.endReason === undefined ? (duration > 0 ? 'COMPLETED' : 'NO_ANSWER') : o.endReason,
      o.recordingPath ?? null,
    ],
  );
  return String(res.rows[0].uuid);
}

async function setup(label: string) {
  const t = await p.api.signup(label);
  const number = await addNumber(p, t);
  return { t, number };
}

const read = (token: string, path: string) => p.api.as(token).get(`/v2/calling/call-logs${path}`);

describe('the list', () => {
  it('pages the calls newest first with Reference’s four totals and the totals of the selection', async () => {
    const { t, number } = await setup('clist');
    const now = Date.now();
    await addCall(t, number, { durationSec: 60, startedAt: new Date(now - 2 * HOUR) });
    await addCall(t, number, { durationSec: 120, startedAt: new Date(now - 3 * HOUR) });
    await addCall(t, number, { endReason: 'NO_ANSWER', startedAt: new Date(now - 4 * HOUR) });
    await addCall(t, number, { endReason: 'REJECTED', startedAt: new Date(now - 5 * HOUR) });
    await addCall(t, number, {
      status: 'failed',
      direction: 'BUSINESS_INITIATED',
      endReason: 'NO_PERMISSION',
      startedAt: new Date(now - 6 * HOUR),
    });
    await addCall(t, number, {
      status: 'ringing',
      endReason: null,
      startedAt: new Date(now - 60_000),
    });
    // 10 days old: in the 30-day default window, outside "24h" and "7d".
    await addCall(t, number, { durationSec: 600, startedAt: new Date(now - 10 * DAY) });
    // 40 days old: outside every preset, but part of the workspace totals (Reference counted all time).
    await addCall(t, number, { durationSec: 30, startedAt: new Date(now - 40 * DAY) });

    const all = await read(t.admin, '');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.total).toBe(7);
    expect(all.body.rows.map((r: { status: string }) => r.status)).toEqual([
      'in-progress',
      'completed',
      'completed',
      'no-answer',
      'declined',
      'failed',
      'completed',
    ]);
    expect(all.body.kpis.workspace).toEqual({
      total: 8,
      last24h: 6,
      minutes24h: 3,
      completed: 4,
      failed: 2,
    });
    expect(all.body.kpis.selection).toEqual({
      total: 7,
      answered: 3,
      missed: 2,
      avgDurationSec: 260,
      totalMinutes: 13,
    });

    const day = await read(t.admin, '?range=24h');
    expect(day.body.total).toBe(6);
    const week = await read(t.admin, '?range=7d');
    expect(week.body.total).toBe(6);

    const paged = await read(t.admin, '?pageSize=3&page=2');
    expect(paged.body.rows).toHaveLength(3);
    expect(paged.body).toMatchObject({ page: 2, pageSize: 3, total: 7 });
    const last = await read(t.admin, '?pageSize=3&page=3');
    expect(last.body.rows).toHaveLength(1);
    const beyond = await read(t.admin, '?pageSize=3&page=9');
    expect(beyond.body.rows).toEqual([]);
  });

  it('filters by status, direction, number, teammate and search text', async () => {
    const { t, number } = await setup('cfilt');
    const second = await addNumber(p, t, { phone: '+919700000001' });
    const agent = await p.api.member(t, 'PriyaAgent', [['call.calls.use']]);
    const [contact] = await p.api.seedContacts(t, [
      { name: 'Rahul Sharma', phone: '+919811100123' },
    ]);
    const contactId = Number(
      (await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contact])).rows[0].id,
    );
    await addCall(t, number, {
      durationSec: 90,
      handlerUserId: agent.userId,
      contactId,
      customer: '919811100123',
    });
    await addCall(t, number, { endReason: 'NO_ANSWER', customer: '919822200456' });
    await addCall(t, second, {
      direction: 'BUSINESS_INITIATED',
      durationSec: 45,
      handlerUserId: t.adminUserId,
      customer: '919833300789',
    });

    const status = await read(t.admin, '?status=no-answer');
    expect(status.body.total).toBe(1);
    expect(status.body.rows[0]).toMatchObject({
      customerPhone: '919822200456',
      direction: 'inbound',
    });

    const out = await read(t.admin, '?direction=outbound');
    expect(out.body.total).toBe(1);
    expect(out.body.rows[0]).toMatchObject({
      direction: 'outbound',
      customerPhone: '919833300789',
      ourPhone: '919700000001',
      numberId: second.uuid,
    });

    expect((await read(t.admin, `?numberId=${number.uuid}`)).body.total).toBe(2);
    const byAgent = await read(
      t.admin,
      `?agentId=${(await read(t.admin, '/filters')).body.agents.find((a: { name: string }) => a.name === 'PriyaAgent').id}`,
    );
    expect(byAgent.body.total).toBe(1);
    expect(byAgent.body.rows[0]).toMatchObject({
      handlerName: 'PriyaAgent',
      contactName: 'Rahul Sharma',
    });

    // A phone number (digits, plus and spaces ignored) and a part of the contact's name.
    expect((await read(t.admin, '?q=%2B91%209822200')).body.total).toBe(1);
    expect((await read(t.admin, '?q=rahul')).body.total).toBe(1);
    expect((await read(t.admin, '?q=nobody')).body.total).toBe(0);
    // LIKE wildcards in the text mean themselves.
    expect((await read(t.admin, '?q=%25')).body.total).toBe(0);

    const filters = await read(t.admin, '/filters');
    expect(filters.body.numbers.map((n: { id: string }) => n.id).sort()).toEqual(
      [number.uuid, second.uuid].sort(),
    );
    expect(filters.body.agents.map((a: { name: string }) => a.name).sort()).toEqual([
      'Admin Person',
      'PriyaAgent',
    ]);
  });

  it('a custom range is whole days in the caller’s zone; a bad range is refused in words', async () => {
    const { t, number } = await setup('crange');
    const noon = new Date(Date.now() - 3 * DAY);
    noon.setUTCHours(12, 0, 0, 0);
    await addCall(t, number, { durationSec: 10, startedAt: noon });
    const day = noon.toISOString().slice(0, 10);
    const next = new Date(noon.getTime() + DAY).toISOString().slice(0, 10);
    expect((await read(t.admin, `?from=${day}&to=${day}`)).body.total).toBe(1);
    expect((await read(t.admin, `?from=${next}&to=${next}`)).body.total).toBe(0);
    // 12:00 UTC is 17:30 in Kolkata, still the same local day.
    expect((await read(t.admin, `?from=${day}&to=${day}&tz=Asia%2FKolkata`)).body.total).toBe(1);

    const back = await read(t.admin, `?from=${next}&to=${day}`);
    expect(back.status).toBe(422);
    expect(back.body.code).toBe('CALL_RANGE_INVALID');
    const zone = await read(t.admin, '?from=2026-10-01&tz=Mars%2FBase');
    expect(zone.body.code).toBe('CALL_RANGE_INVALID');
    expect((await read(t.admin, '?status=weird')).status).toBe(422);
    expect((await read(t.admin, '?pageSize=500')).status).toBe(422);
  });

  it('the SQL status rule gives the same answer as the code rule for every combination', async () => {
    const { t, number } = await setup('cstat');
    const combos: Array<{ status: string; durationSec: number; endReason: string | null }> = [];
    for (const status of ['ringing', 'connecting', 'active', 'ended', 'failed']) {
      for (const durationSec of [0, 42]) {
        for (const endReason of [
          null,
          'COMPLETED',
          'REJECTED',
          'DECLINED',
          'NO_ANSWER',
          'FAILED',
        ]) {
          combos.push({ status, durationSec, endReason });
        }
      }
    }
    const ids = new Map<string, (typeof combos)[number]>();
    for (const c of combos) ids.set(await addCall(t, number, c), c);
    const res = await read(t.admin, '?pageSize=100');
    expect(res.body.total).toBe(combos.length);
    for (const row of res.body.rows as Array<{ id: string; status: string }>) {
      expect(row.status, JSON.stringify(ids.get(row.id))).toBe(callLogStatus(ids.get(row.id)!));
    }
  });
});

describe('who sees which calls', () => {
  it('needs the key; the plan feature closes every route like the dial routes', async () => {
    const { t, number } = await setup('cgate');
    const id = await addCall(t, number, { durationSec: 5 });
    const none = await p.api.member(t, 'nokey', [['call.calls.use']]);
    for (const path of ['', '/filters', '/analytics', `/${id}`]) {
      expect((await read(none.token, path)).status, path).toBe(403);
    }
    expect((await p.api.as(none.token).post(`/v2/calling/call-logs/${id}/playback`)).status).toBe(
      403,
    );

    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"waba_calling":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const path of ['', '/filters', '/analytics', `/${id}`]) {
        const r = await read(t.admin, path);
        expect(r.status, path).toBe(422);
        expect(r.body.code, path).toBe('PLAN_FEATURE_LOCKED');
      }
      const play = await p.api.as(t.admin).post(`/v2/calling/call-logs/${id}/playback`);
      expect(play.body.code).toBe('PLAN_FEATURE_LOCKED');
    } finally {
      await p.h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
    expect((await read(t.admin, '')).status).toBe(200);
  });

  it('record scope: all, own and team', async () => {
    const { t, number } = await setup('cscope');
    const alice = await p.api.member(t, 'alice', [['call.logs.read', 'own']]);
    const bob = await p.api.member(t, 'bob', [['call.logs.read', 'own']]);
    const lead = await p.api.member(t, 'lead', [['call.logs.read', 'team']]);
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
    const a = await addCall(t, number, { durationSec: 10, handlerUserId: alice.userId });
    const b = await addCall(t, number, { durationSec: 20, handlerUserId: bob.userId });
    const unhandled = await addCall(t, number, { endReason: 'NO_ANSWER' });

    const ids = async (token: string) =>
      ((await read(token, '')).body.rows as Array<{ id: string }>).map((r) => r.id).sort();
    expect(await ids(alice.token)).toEqual([a]);
    expect(await ids(bob.token)).toEqual([b]);
    expect(await ids(lead.token)).toEqual([b]); // lead handled none; bob is on their team
    expect(await ids(wide.token)).toEqual([a, b, unhandled].sort());
    expect(await ids(t.admin)).toEqual([a, b, unhandled].sort());

    // The totals follow the scope too, and a call outside it is a 404 (never "forbidden", which would confirm it exists).
    expect((await read(alice.token, '')).body.kpis.workspace.total).toBe(1);
    expect((await read(alice.token, `/${a}`)).status).toBe(200);
    expect((await read(alice.token, `/${b}`)).status).toBe(404);
    expect((await read(alice.token, `/${unhandled}`)).status).toBe(404);
    expect((await read(alice.token, '/filters')).body.agents).toHaveLength(1);
    expect((await read(alice.token, '/analytics')).body.totals.total).toBe(1);
  });

  it('another workspace’s calls are not there', async () => {
    const mine = await setup('ctena');
    const theirs = await setup('ctenb');
    const id = await addCall(theirs.t, theirs.number, { durationSec: 5 });
    await addCall(mine.t, mine.number, { durationSec: 7 });
    expect((await read(mine.t.admin, '')).body.total).toBe(1);
    expect((await read(mine.t.admin, `/${id}`)).status).toBe(404);
    expect((await p.api.as(mine.t.admin).post(`/v2/calling/call-logs/${id}/playback`)).status).toBe(
      404,
    );
    expect((await read(mine.t.admin, `?numberId=${theirs.number.uuid}`)).body.total).toBe(0);
    expect(
      (await read(mine.t.admin, '/filters')).body.numbers.map((n: { id: string }) => n.id),
    ).toEqual([mine.number.uuid]);
  });
});

describe('one call', () => {
  it('shows who handled it, the timeline without Meta’s payload, and the recording state', async () => {
    const { t, number } = await setup('cdetail');
    const id = await addCall(t, number, { durationSec: 75, handlerUserId: t.adminUserId });
    const callId = Number(
      (await p.h.owner.query(`SELECT id FROM wa_calls WHERE uuid = $1`, [id])).rows[0].id,
    );
    const ev = (type: string, payload: unknown, offset: number) =>
      p.h.owner.query(
        `INSERT INTO wa_call_events (org_id, wa_call_id, event_type, payload, received_at)
         VALUES ($1, $2, $3, $4::jsonb, now() + ($5 || ' seconds')::interval)`,
        [t.orgId, callId, type, JSON.stringify(payload), String(offset)],
      );
    await ev(
      'connect',
      { id: 'x', session: { sdp: 'v=0 TOP-SECRET-SDP' }, from: '919811100001' },
      0,
    );
    await ev('accept_sent', { by: t.adminUserId }, 1);
    await ev('terminate', { status: 'COMPLETED', session: { sdp: 'v=0 TOP-SECRET-SDP' } }, 80);

    const r = await read(t.admin, `/${id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.call).toMatchObject({
      id,
      status: 'completed',
      durationSec: 75,
      handlerName: 'Admin Person',
      handlerType: 'operator',
      failureReason: null,
      conversationId: null,
      hasRecording: false,
    });
    expect(r.body.call.answeredAt).toBeTruthy();
    expect(r.body.timeline.map((e: { type: string }) => e.type)).toEqual([
      'connect',
      'accept_sent',
      'terminate',
    ]);
    expect(r.body.timeline[2].note).toBe('COMPLETED');
    expect(JSON.stringify(r.body)).not.toContain('TOP-SECRET-SDP');
    expect(r.body.recording).toEqual({
      available: false,
      mime: null,
      sizeBytes: null,
      lifecycle: {
        storedAt: null,
        expiresAt: null,
        legalHold: false,
        holdReason: null,
        deletedAt: null,
        deletedReason: null,
        consent: { status: null, method: null, at: null, noticeVersion: null, noticeSha256: null },
      },
    });
  });

  it('a failed call says why', async () => {
    const { t, number } = await setup('cfail');
    const id = await addCall(t, number, {
      status: 'failed',
      direction: 'BUSINESS_INITIATED',
      endReason: 'NO_PERMISSION',
    });
    const r = await read(t.admin, `/${id}`);
    expect(r.body.call).toMatchObject({
      status: 'failed',
      failureReason: 'NO_PERMISSION',
      direction: 'outbound',
    });
  });

  it('a call that is not a uuid or does not exist is refused', async () => {
    const { t } = await setup('cmiss');
    expect((await read(t.admin, '/not-a-uuid')).status).toBe(400);
    expect((await read(t.admin, '/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('playing a recording', () => {
  const play = (token: string, id: string) =>
    p.api.as(token).post(`/v2/calling/call-logs/${id}/playback`);

  async function recorded(label: string) {
    const { t, number } = await setup(label);
    // The real path: a call row, then the operator's own upload into the private store.
    const id = await addCall(t, number, { durationSec: 40, handlerUserId: t.adminUserId });
    await enableRecording(p, t);
    await grantConsentRow(p, t, id);
    const up = await p.api
      .as(t.admin)
      .post(`/v2/calling/calls/${id}/recording`)
      .attach('recording', WEBM, 'call.webm');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    return { t, number, id };
  }

  it('gives a short-lived link that plays in ranges for that person only, and audits every play', async () => {
    const { t, id } = await recorded('cplay');
    const detail = await read(t.admin, `/${id}`);
    expect(detail.body.call.hasRecording).toBe(true);
    expect(detail.body.recording).toMatchObject({ available: true, mime: 'audio/webm' });

    const before = await p.api.auditCount(t.orgId, 'wa_calls', 'read');
    const first = await play(t.admin, id);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.url).toMatch(/^\/v2\/media\/[A-Za-z0-9_-]{40,}$/);
    expect(first.body.mime).toBe('audio/webm');
    const left = new Date(first.body.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(200_000);
    expect(left).toBeLessThanOrEqual(300_000);

    const bytes = await p.api
      .as(t.admin)
      .get(first.body.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(bytes.status).toBe(200);
    expect((bytes.body as Buffer).length).toBe(WEBM.length);
    expect(bytes.headers['accept-ranges']).toBe('bytes');
    const part = await p.api.as(t.admin).get(first.body.url).set('Range', 'bytes=0-9');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${WEBM.length}`);

    // The link is for the person it was made for: a teammate with the same rights cannot use it, nor can another workspace.
    const mate = await p.api.member(t, 'mate', [['call.logs.read'], ['call.recordings.play']]);
    expect((await p.api.as(mate.token).get(first.body.url)).status).toBe(404);
    const other = await p.api.signup('cplayother');
    expect((await p.api.as(other.admin).get(first.body.url)).status).toBe(404);
    expect((await p.api.http().get(first.body.url)).status).toBe(401);

    await play(t.admin, id);
    expect(await p.api.auditCount(t.orgId, 'wa_calls', 'read')).toBe(before + 2);
  });

  it('needs the playback key as well as the log key, and the call in the person’s scope', async () => {
    const { t, id } = await recorded('cplaykey');
    const reader = await p.api.member(t, 'readonly', [['call.logs.read']]);
    expect((await read(reader.token, `/${id}`)).status).toBe(200);
    const denied = await play(reader.token, id);
    expect(denied.status).toBe(403);

    const own = await p.api.member(t, 'ownplay', [
      ['call.logs.read', 'own'],
      ['call.recordings.play'],
    ]);
    expect((await play(own.token, id)).status).toBe(404); // not their call
    const allowed = await p.api.member(t, 'allplay', [
      ['call.logs.read'],
      ['call.recordings.play'],
    ]);
    expect((await play(allowed.token, id)).status).toBe(200);
  });

  it('a call with no recording has nothing to play', async () => {
    const { t, number } = await setup('cplaynone');
    const id = await addCall(t, number, { durationSec: 5 });
    const r = await play(t.admin, id);
    expect(r.status).toBe(404);
    expect(await p.api.auditCount(t.orgId, 'wa_calls', 'read')).toBe(0);
  });
});

describe('analytics', () => {
  it('counts calls per day, the answered rate, by teammate, by hour of the week and the average handle time', async () => {
    const { t, number } = await setup('cana');
    const agent = await p.api.member(t, 'DevAgent', [['call.calls.use']]);
    const today = new Date();
    const at = (daysAgo: number, hour: number) => {
      const d = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - daysAgo,
          hour,
          15,
        ),
      );
      return d;
    };
    await addCall(t, number, {
      durationSec: 100,
      handlerUserId: t.adminUserId,
      startedAt: at(1, 10),
    });
    await addCall(t, number, {
      durationSec: 200,
      handlerUserId: agent.userId,
      startedAt: at(1, 10),
    });
    await addCall(t, number, { endReason: 'NO_ANSWER', startedAt: at(2, 14) });
    await addCall(t, number, {
      durationSec: 300,
      handlerUserId: agent.userId,
      startedAt: at(4, 23),
    });
    // Our own unanswered outbound call: counted, but not "missed".
    await addCall(t, number, {
      direction: 'BUSINESS_INITIATED',
      endReason: 'NO_ANSWER',
      startedAt: at(4, 9),
    });
    // Outside the 7 days.
    await addCall(t, number, { durationSec: 999, startedAt: at(20, 9) });

    const r = await read(t.admin, '/analytics?range=7d');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.series).toHaveLength(7);
    expect(r.body.tz).toBe('UTC');
    expect(r.body.totals).toEqual({
      total: 5,
      answered: 3,
      missed: 1,
      answeredRate: 0.6,
      avgHandleSec: 200,
      totalMinutes: 10,
    });
    const byDay = new Map<string, { total: number; answered: number; missed: number }>(
      r.body.series.map((d: { day: string }) => [d.day, d]),
    );
    expect(byDay.get(at(1, 0).toISOString().slice(0, 10))).toMatchObject({
      total: 2,
      answered: 2,
      missed: 0,
    });
    expect(byDay.get(at(2, 0).toISOString().slice(0, 10))).toMatchObject({
      total: 1,
      answered: 0,
      missed: 1,
    });
    expect(byDay.get(at(3, 0).toISOString().slice(0, 10))).toMatchObject({ total: 0 });
    expect(byDay.get(at(4, 0).toISOString().slice(0, 10))).toMatchObject({
      total: 2,
      answered: 1,
      missed: 0,
    });

    const dev = r.body.byAgent.find((a: { name: string | null }) => a.name === 'DevAgent');
    expect(dev).toMatchObject({ calls: 2, answered: 2, avgHandleSec: 250, totalMinutes: 8 });
    expect(r.body.byAgent.find((a: { name: string | null }) => a.name === null).calls).toBe(2);

    const cell = (daysAgo: number, hour: number) =>
      r.body.heatmap.find(
        (c: { weekday: number; hour: number }) =>
          c.weekday === at(daysAgo, hour).getUTCDay() && c.hour === hour,
      );
    expect(cell(1, 10).calls).toBe(2);
    expect(cell(2, 14).calls).toBe(1);
    expect(cell(4, 23).calls).toBe(1);

    // The same calls, counted in a zone far from UTC, land on other hours (and 23:15 UTC is already tomorrow in Kolkata).
    const ist = await read(t.admin, '/analytics?range=7d&tz=Asia%2FKolkata');
    expect(ist.body.tz).toBe('Asia/Kolkata');
    expect(ist.body.heatmap.find((c: { hour: number }) => c.hour === 15)?.calls).toBe(2); // 10:15 UTC = 15:45 IST
    expect(ist.body.totals.total).toBe(5);

    const filtered = await read(t.admin, `/analytics?range=7d&numberId=${number.uuid}`);
    expect(filtered.body.totals.total).toBe(5);
    const nothing = await read(
      t.admin,
      `/analytics?range=7d&numberId=00000000-0000-4000-8000-000000000000`,
    );
    expect(nothing.body.totals).toMatchObject({ total: 0, answeredRate: 0, avgHandleSec: 0 });
    expect(nothing.body.heatmap).toEqual([]);
  });

  it('an empty workspace gives zeros and a full set of empty days; a bad range is refused', async () => {
    const { t } = await setup('canaempty');
    const r = await read(t.admin, '/analytics?range=30d');
    expect(r.body.series).toHaveLength(30);
    expect(r.body.totals).toEqual({
      total: 0,
      answered: 0,
      missed: 0,
      answeredRate: 0,
      avgHandleSec: 0,
      totalMinutes: 0,
    });
    expect((await read(t.admin, '/analytics?from=2024-01-01&to=2026-01-01')).body.code).toBe(
      'CALL_RANGE_INVALID',
    );
  });
});

describe('the demo seed', () => {
  it('makes a month of calls, plays its recordings through the real route, and adds nothing the second time', async () => {
    const { t } = await setup('cseed');
    const stored = new Map<string, Buffer>();
    const store = {
      put: (key: string, body: Buffer) => {
        stored.set(key, body);
        return Promise.resolve();
      },
    };
    const first = await seedDemoCalls(p.h.owner, t.orgId, { count: 40, store });
    expect(first.created).toBe(40);
    expect(first.recordings).toBeGreaterThan(0);
    expect(stored.size).toBe(first.recordings);
    const again = await seedDemoCalls(p.h.owner, t.orgId, { count: 40, store });
    expect(again).toMatchObject({ created: 0, existing: 40 });

    const r = await read(t.admin, '?pageSize=100');
    expect(r.body.total).toBe(40);
    const statuses = new Set((r.body.rows as Array<{ status: string }>).map((x) => x.status));
    expect([...statuses].sort()).toEqual(['completed', 'declined', 'failed', 'no-answer']);
    expect(r.body.kpis.selection.answered).toBeGreaterThan(0);
    const analytics = await read(t.admin, '/analytics?range=30d');
    expect(analytics.body.totals.total).toBe(40);
  });
});

describe('the query plan on a few thousand calls', () => {
  it('reads the list page and the scope-own page through their indexes', async () => {
    const { t, number } = await setup('cplan');
    const other = await setup('cplanb');
    const agent = await p.api.member(t, 'planagent', [['call.logs.read', 'own']]);
    // 6 000 calls in this workspace, 3 000 in another one: the org filter has to do its job.
    for (const [org, cfg, rows] of [
      [t.orgId, number.configId, 6000],
      [other.t.orgId, other.number.configId, 3000],
    ] as const) {
      await p.h.owner.query(
        `INSERT INTO wa_calls (org_id, provider, wa_provider_config_id, meta_call_id, direction, from_phone, to_phone, status,
                               handler_type, handler_user_id, started_at, duration_sec, end_reason)
         SELECT $1::bigint, 'waba', $2::bigint, 'plan.' || $1::text || '.' || g, 'USER_INITIATED', '9198111' || g, '919800000000', 'ended',
                'operator', CASE WHEN g % 20 = 0 THEN $3::bigint END, now() - (g || ' minutes')::interval, g % 300,
                CASE WHEN g % 300 = 0 THEN 'NO_ANSWER' ELSE 'COMPLETED' END
         FROM generate_series(1, $4::int) g`,
        [org, cfg, org === t.orgId ? agent.userId : null, rows],
      );
    }
    await p.h.owner.query(`ANALYZE wa_calls`);

    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const { CallLogsRepository } =
      await import('../../../src/modules/calling-voice/call-logs.repository');
    const { sql } = await import('drizzle-orm');
    const db = p.h.app.get(DatabaseService, { strict: false });
    const repo = new CallLogsRepository();
    const explain = async (scope: 'all' | 'own') =>
      db.txAs({ orgId: t.orgId, userId: agent.userId }, async (tx) => {
        const spy = {
          execute: (q: unknown) => tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS) ${q as never}`),
        };
        const res = await repo.page(
          spy as never,
          { orgId: t.orgId, userId: agent.userId, scope },
          { start: new Date(Date.now() - 30 * DAY), end: null },
          25,
          0,
        );
        return res.map((r) => String(r['QUERY PLAN'])).join('\n');
      });

    const all = await explain('all');
    const own = await explain('own');
    // eslint-disable-next-line no-console
    console.log('PLAN all\n' + all + '\nPLAN own\n' + own);
    expect(all).toContain('idx_wa_calls_org_started_at');
    expect(all).not.toMatch(/Seq Scan on wa_calls/);
    expect(own).toMatch(/idx_wa_calls_handler_started_at|idx_wa_calls_org_started_at/);
    expect(own).not.toMatch(/Seq Scan on wa_calls/);

    const first = await read(t.admin, '?pageSize=25');
    expect(first.body.total).toBe(6000);
    expect(first.body.rows).toHaveLength(25);
    const mine = await read(agent.token, '?pageSize=25');
    expect(mine.body.total).toBe(300);
  });
});
