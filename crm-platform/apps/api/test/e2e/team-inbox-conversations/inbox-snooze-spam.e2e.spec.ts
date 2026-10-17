import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboxTriageService } from '../../../src/modules/team-inbox-conversations/inbox-triage.service';
import { AGENT, Api, Inbox, startHarness, type Grant, type Harness, type Tenant } from './support';

/**
 * Snoozed and spam, end to end (Reference: the snooze menu and the bulk "Mark as spam"; the spam tab of the list).
 *
 * Snooze works from any status and comes back as open at the time, by the wake-up sweep or by hand. Spam is marked from any status,
 * by the single route or the bulk action, leaves every live list, is found under the spam filter, and comes back to open by the status
 * route. Each change writes its timeline event and audit row; a repeat is a no-op.
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

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const ids = async (token: string, qs = '') =>
  (
    (await api.as(token).get(`/v2/inbox/conversations${qs}`)).body.data as Array<{ id: string }>
  ).map((r) => r.id);
const eventTypes = async (token: string, uuid: string) =>
  (
    (await api.as(token).get(`/v2/inbox/conversations/${uuid}/events?limit=100`)).body
      .data as Array<{
      type: string;
    }>
  ).map((e) => e.type);

const BULK: Grant[] = [...AGENT, ['inbox.conversation.bulk', 'all']];

describe('snooze from any status, and the wake-up', () => {
  let t: Tenant;
  let ch: { id: string };
  let agent: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('isn');
    ch = await inbox.channel(t.admin);
    agent = await api.member(t, 'agent', [...AGENT, ['inbox.conversation.snooze', 'all']]);
  });

  it.each(['open', 'resolved', 'closed', 'spam'] as const)(
    'snoozes a %s thread; it is listed under snoozed with its wake time',
    async (status) => {
      const c = await inbox.conversation(t, ch.id, { status, messages: 1 });
      const res = await api
        .as(agent.token)
        .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
        .send({ rowVersion: await inbox.version(c.uuid), until: inAnHour() });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('snoozed');
      expect(res.body.snoozedUntil).not.toBeNull();
      expect(await ids(agent.token, '?status=snoozed')).toContain(c.uuid);
      expect(await ids(agent.token)).not.toContain(c.uuid);
    },
  );

  it('the sweep wakes a due thread back to open, clears the wake time, and records it', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'open', messages: 1 });
    await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
      .send({ rowVersion: await inbox.version(c.uuid), until: inAnHour() });
    const triage = h.app.get(InboxTriageService);
    expect(await triage.wakeDue()).toBe(0);
    expect((await inbox.row(c.uuid)).status).toBe('snoozed');

    await h.owner.query(
      `UPDATE conversations SET snoozed_until = now() - interval '1 minute' WHERE uuid = $1`,
      [c.uuid],
    );
    expect(await triage.wakeDue()).toBeGreaterThanOrEqual(1);
    const row = await inbox.row(c.uuid);
    expect(row.status).toBe('open');
    expect(row.snoozed_until).toBeNull();
    expect(await ids(agent.token)).toContain(c.uuid);
    expect(await eventTypes(agent.token, c.uuid)).toEqual(
      expect.arrayContaining(['snoozed', 'auto_unsnoozed']),
    );
  });

  it('a snoozed spam thread that wakes comes back as open (it is no longer spam)', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'spam' });
    await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
      .send({ rowVersion: await inbox.version(c.uuid), until: inAnHour() });
    await h.owner.query(
      `UPDATE conversations SET snoozed_until = now() - interval '1 minute' WHERE uuid = $1`,
      [c.uuid],
    );
    await h.app.get(InboxTriageService).wakeDue();
    expect((await inbox.row(c.uuid)).status).toBe('open');
  });

  it('a snooze to a time already set is a no-op; a past time is refused (422)', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'snoozed' });
    const until = inAnHour();
    await h.owner.query(`UPDATE conversations SET snoozed_until = $2 WHERE uuid = $1`, [
      c.uuid,
      until,
    ]);
    const same = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
      .send({ rowVersion: 999, until });
    expect(same.status).toBe(200);
    expect(await eventTypes(agent.token, c.uuid)).toEqual([]);
    const past = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
      .send({
        rowVersion: await inbox.version(c.uuid),
        until: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(past.status).toBe(422);
  });
});

describe('spam: mark, find, take off', () => {
  let t: Tenant;
  let ch: { id: string };
  let agent: { token: string; userId: number };
  let reader: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('isp');
    ch = await inbox.channel(t.admin);
    agent = await api.member(t, 'agent', AGENT);
    reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
  });

  const mark = (token: string, uuid: string, rowVersion: number) =>
    api.as(token).post(`/v2/inbox/conversations/${uuid}/spam`).send({ rowVersion });

  it('marks an open thread as spam: it leaves the open list, is found under spam, and is logged once', async () => {
    const c = await inbox.conversation(t, ch.id, { messages: 1 });
    const res = await mark(agent.token, c.uuid, await inbox.version(c.uuid));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('spam');
    expect(await ids(agent.token)).not.toContain(c.uuid);
    expect(await ids(agent.token, '?status=spam')).toContain(c.uuid);
    expect(await eventTypes(agent.token, c.uuid)).toEqual(['spam_flagged']);

    const again = await mark(agent.token, c.uuid, 999);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('spam');
    expect(await eventTypes(agent.token, c.uuid)).toEqual(['spam_flagged']);
  });

  it('marks a snoozed thread as spam and drops its wake time', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'snoozed' });
    await h.owner.query(
      `UPDATE conversations SET snoozed_until = now() + interval '1 day' WHERE uuid = $1`,
      [c.uuid],
    );
    const res = await mark(agent.token, c.uuid, await inbox.version(c.uuid));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('spam');
    expect(res.body.snoozedUntil).toBeNull();
  });

  it('a stale version is 409 and changes nothing; no permission is 403', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const stale = await mark(agent.token, c.uuid, 999);
    expect(stale.status).toBe(409);
    expect((await inbox.row(c.uuid)).status).toBe('open');
    const denied = await mark(reader.token, c.uuid, await inbox.version(c.uuid));
    expect(denied.status).toBe(403);
    expect((await inbox.row(c.uuid)).status).toBe('open');
  });

  it('takes a thread off spam with the status route (spam to open), back in the open list; resolving spam is refused', async () => {
    const c = await inbox.conversation(t, ch.id, { status: 'spam' });
    const refused = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/status`)
      .send({ rowVersion: await inbox.version(c.uuid), status: 'resolved' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('CONVERSATION_STATUS_INVALID');

    const back = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/status`)
      .send({ rowVersion: await inbox.version(c.uuid), status: 'open' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('open');
    expect(await ids(agent.token)).toContain(c.uuid);
    expect(await ids(agent.token, '?status=spam')).not.toContain(c.uuid);
  });

  it('bulk: marks many as spam with one outcome each, a re-run is unchanged, and it needs the bulk and resolve rights', async () => {
    const lead = await api.member(t, 'lead', BULK);
    const a = await inbox.conversation(t, ch.id, {});
    const b = await inbox.conversation(t, ch.id, { status: 'resolved' });
    const bulk = (token: string, body: Record<string, unknown>) =>
      api.as(token).post('/v2/inbox/conversations/bulk').send(body);

    const first = await bulk(lead.token, { ids: [a.uuid, b.uuid], action: { type: 'spam' } });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.done).toBe(2);
    expect((await inbox.row(a.uuid)).status).toBe('spam');
    expect((await inbox.row(b.uuid)).status).toBe('spam');

    const again = await bulk(lead.token, { ids: [a.uuid, b.uuid], action: { type: 'spam' } });
    expect(again.body.unchanged).toBe(2);

    const noBulk = await bulk(agent.token, { ids: [a.uuid], action: { type: 'spam' } });
    expect(noBulk.status).toBe(403);
  });
});
