import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboxTriageService } from '../../../src/modules/team-inbox-conversations';
import {
  AGENT,
  Api,
  Inbox,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../team-inbox-conversations/support';

/**
 * Priority, snooze and bulk actions (BL-036 phase 3): the single routes with their permissions, the sweep that wakes a snoozed
 * thread, and the bulk route's per-conversation rules, partial failures, idempotent re-run and one audit row with the counts.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbox = new Inbox(h, api);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const BULK: Grant[] = [
  ...AGENT,
  ['inbox.conversation.bulk', 'all'],
  ['inbox.conversation.priority', 'all'],
  ['inbox.conversation.snooze', 'all'],
  ['inbox.conversation.assign', 'all'],
];

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe('priority and snooze', () => {
  let t: Tenant;
  let ch: { id: string };
  let lead: { token: string; userId: number };
  let plain: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('ibp');
    ch = await inbox.channel(t.admin);
    lead = await api.member(t, 'lead', BULK);
    plain = await api.member(t, 'plain', AGENT);
  });

  it('sets the priority with the permission, one timeline event, one outbox event, and a repeat is a no-op', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const v = await inbox.version(c.uuid);
    const res = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${c.uuid}/priority`)
      .send({ rowVersion: v, priority: 'urgent' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.priority).toBe('urgent');
    expect(res.body.rowVersion).toBeGreaterThan(v);

    const again = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${c.uuid}/priority`)
      .send({ rowVersion: v, priority: 'urgent' });
    expect(again.status).toBe(200);
    expect(again.body.rowVersion).toBe(res.body.rowVersion);

    const events = (await api.as(lead.token).get(`/v2/inbox/conversations/${c.uuid}/events`)).body
      .data as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.filter((e) => e.type === 'priority_changed')).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ from: 'normal', to: 'urgent' });
    const out = (await api.events(t.orgId, 'conversation.priority_changed')).filter(
      (e) => e.conversationId === c.uuid,
    );
    expect(out).toHaveLength(1);
  });

  it('refuses without the permission (403), a stale version (409) and a bad value (422)', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const v = await inbox.version(c.uuid);
    const denied = await api
      .as(plain.token)
      .post(`/v2/inbox/conversations/${c.uuid}/priority`)
      .send({ rowVersion: v, priority: 'high' });
    expect(denied.status).toBe(403);
    const stale = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${c.uuid}/priority`)
      .send({ rowVersion: v + 5, priority: 'high' });
    expect(stale.status).toBe(409);
    const bad = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${c.uuid}/priority`)
      .send({ rowVersion: v, priority: 'whenever' });
    expect(bad.status).toBe(422);
  });

  it('snoozes an open thread, the sweep wakes it when due and leaves it alone before that', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const v = await inbox.version(c.uuid);
    const res = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
      .send({ rowVersion: v, until: inAnHour() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('snoozed');
    expect(res.body.snoozedUntil).not.toBeNull();

    const triage = h.app.get(InboxTriageService);
    await triage.wakeDue();
    expect((await inbox.row(c.uuid)).status).toBe('snoozed');

    await h.owner.query(
      `UPDATE conversations SET snoozed_until = now() - interval '1 minute' WHERE uuid = $1`,
      [c.uuid],
    );
    expect(await triage.wakeDue()).toBeGreaterThanOrEqual(1);
    const row = await inbox.row(c.uuid);
    expect(row.status).toBe('open');
    expect(row.snoozed_until).toBeNull();
    const types = (
      (await api.as(lead.token).get(`/v2/inbox/conversations/${c.uuid}/events`)).body
        .data as Array<{
        type: string;
      }>
    ).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['snoozed', 'auto_unsnoozed']));
    expect(await triage.wakeDue()).toBe(0);
  });

  it('snoozes a resolved thread too (Reference: any status), refuses a past time (422) and a caller without the permission (403)', async () => {
    const resolved = await inbox.conversation(t, ch.id, { status: 'resolved' });
    const v = await inbox.version(resolved.uuid);
    const snoozed = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${resolved.uuid}/snooze`)
      .send({ rowVersion: v, until: inAnHour() });
    expect(snoozed.status, JSON.stringify(snoozed.body)).toBe(200);
    expect(snoozed.body.status).toBe('snoozed');

    const open = await inbox.conversation(t, ch.id, {});
    const ov = await inbox.version(open.uuid);
    const past = await api
      .as(lead.token)
      .post(`/v2/inbox/conversations/${open.uuid}/snooze`)
      .send({ rowVersion: ov, until: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(422);
    const denied = await api
      .as(plain.token)
      .post(`/v2/inbox/conversations/${open.uuid}/snooze`)
      .send({ rowVersion: ov, until: inAnHour() });
    expect(denied.status).toBe(403);
  });
});

describe('bulk actions', () => {
  let t: Tenant;
  let ch: { id: string };
  let lead: { token: string; userId: number };
  let plain: { token: string; userId: number };
  let ownOnly: { token: string; userId: number };
  let agentUuid: string;

  const bulk = (token: string, body: Record<string, unknown>) =>
    api.as(token).post('/v2/inbox/conversations/bulk').send(body);

  beforeAll(async () => {
    t = await api.signup('ibb');
    ch = await inbox.channel(t.admin);
    lead = await api.member(t, 'lead', BULK);
    plain = await api.member(t, 'plain', AGENT);
    ownOnly = await api.member(t, 'ownonly', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.resolve', 'own'],
      ['inbox.conversation.bulk', 'all'],
    ]);
    agentUuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [plain.userId]))
      .rows[0].uuid as string;
  });

  it('resolves many: one outcome each, the state machine per row, one audit row with the counts, and a re-run is unchanged', async () => {
    const a = await inbox.conversation(t, ch.id, {});
    const b = await inbox.conversation(t, ch.id, {});
    const spam = await inbox.conversation(t, ch.id, { status: 'spam' });
    const ids = [a.uuid, b.uuid, spam.uuid];
    const res = await bulk(lead.token, { ids, action: { type: 'status', status: 'resolved' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ requested: 3, done: 2, unchanged: 0, failed: 1 });
    expect(res.body.results.find((r: { id: string }) => r.id === spam.uuid)).toMatchObject({
      outcome: 'failed',
      code: 'CONVERSATION_STATUS_INVALID',
    });
    expect((await inbox.row(a.uuid)).status).toBe('resolved');
    expect((await inbox.row(spam.uuid)).status).toBe('spam');

    const rerun = await bulk(lead.token, { ids, action: { type: 'status', status: 'resolved' } });
    expect(rerun.body).toMatchObject({ requested: 3, done: 0, unchanged: 2, failed: 1 });

    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'conversations.bulk' ORDER BY id`,
      [t.orgId],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0].delta.bulk.new).toMatchObject({
      action: 'status',
      requested: 3,
      done: 2,
      failed: 1,
    });
    const resolvedEvents = await api.events(t.orgId, 'conversation.resolved');
    expect(resolvedEvents.filter((e) => ids.includes(e.conversationId as string))).toHaveLength(2);
  });

  it('needs the bulk permission AND the action permission; without either nothing runs', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const noBulk = await bulk(plain.token, {
      ids: [c.uuid],
      action: { type: 'status', status: 'closed' },
    });
    expect(noBulk.status).toBe(403);
    const noPriority = await bulk(ownOnly.token, {
      ids: [c.uuid],
      action: { type: 'priority', priority: 'high' },
    });
    expect(noPriority.status).toBe(403);
    expect((await inbox.row(c.uuid)).status).toBe('open');
    expect((await inbox.row(c.uuid)).priority).toBe('normal');
  });

  it('hides a conversation the caller cannot see as not found and reports the rest as done', async () => {
    const mine = await inbox.conversation(t, ch.id, { assigneeUserId: ownOnly.userId });
    const theirs = await inbox.conversation(t, ch.id, { assigneeUserId: plain.userId });
    const res = await bulk(ownOnly.token, {
      ids: [mine.uuid, theirs.uuid],
      action: { type: 'status', status: 'resolved' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ done: 1, failed: 1 });
    expect(res.body.results.find((r: { id: string }) => r.id === theirs.uuid).code).toBe(
      'CONVERSATION_NOT_FOUND',
    );
    expect((await inbox.row(theirs.uuid)).status).toBe('open');
  });

  it('assigns, sets priority, snoozes and marks read in bulk, and a made-up id is a failure not a crash', async () => {
    const a = await inbox.conversation(t, ch.id, { unread: 2, messages: 2 });
    const b = await inbox.conversation(t, ch.id, { unread: 1, messages: 1 });
    const ghost = '00000000-0000-4000-8000-000000000000';
    const ids = [a.uuid, b.uuid];

    const assigned = await bulk(lead.token, {
      ids: [...ids, ghost],
      action: { type: 'assign', userId: agentUuid },
    });
    expect(assigned.body).toMatchObject({ requested: 3, done: 2, failed: 1 });
    expect(Number((await inbox.row(a.uuid)).assignee_user_id)).toBe(plain.userId);

    const prio = await bulk(lead.token, { ids, action: { type: 'priority', priority: 'high' } });
    expect(prio.body).toMatchObject({ done: 2 });
    expect((await inbox.row(b.uuid)).priority).toBe('high');

    const read = await bulk(lead.token, { ids, action: { type: 'mark_read' } });
    expect(read.body).toMatchObject({ done: 2 });
    expect(Number((await inbox.row(a.uuid)).unread_count)).toBe(0);
    const readAgain = await bulk(lead.token, { ids, action: { type: 'mark_read' } });
    expect(readAgain.body).toMatchObject({ done: 0, unchanged: 2 });

    const snoozed = await bulk(lead.token, {
      ids,
      action: { type: 'snooze', until: inAnHour() },
    });
    expect(snoozed.body).toMatchObject({ done: 2 });
    expect((await inbox.row(a.uuid)).status).toBe('snoozed');
  });

  it('validates the body: empty, duplicate and oversized selections, an assign with no target', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const action = { type: 'mark_read' };
    expect((await bulk(lead.token, { ids: [], action })).status).toBe(422);
    expect((await bulk(lead.token, { ids: [c.uuid, c.uuid], action })).status).toBe(422);
    const many = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect((await bulk(lead.token, { ids: many, action })).status).toBe(422);
    expect((await bulk(lead.token, { ids: [c.uuid], action: { type: 'assign' } })).status).toBe(
      422,
    );
  });
});
