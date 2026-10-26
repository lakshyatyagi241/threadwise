import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, Inbox, startHarness, type Grant, type Harness, type Tenant } from './support';

/**
 * A resolved or closed web chat is final for an agent: the status route, the snooze and the spam mark refuse it, one conversation at a
 * time and in a bulk request, and assigning a closed one keeps it closed. Every other channel keeps those moves. The web chat is a
 * simulator channel whose kind the owner connection sets to `webchat`, which is the only thing these rules read.
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
const userUuid = async (id: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [id])).rows[0].uuid as string;
const statusOf = async (token: string, uuid: string) =>
  (await api.as(token).get(`/v2/inbox/conversations/${uuid}`)).body.status as string;
const BULK: Grant[] = [
  ...AGENT,
  ['inbox.conversation.assign', 'all'],
  ['inbox.conversation.snooze', 'all'],
  ['inbox.conversation.bulk', 'all'],
];

describe('a resolved web chat is final', () => {
  let t: Tenant;
  let web: { id: string };
  let other: { id: string };
  let manager: { token: string; userId: number };
  let agent: { token: string; userId: number };

  const status = (token: string, uuid: string, body: Record<string, unknown>) =>
    api.as(token).post(`/v2/inbox/conversations/${uuid}/status`).send(body);
  const version = (uuid: string) => inbox.version(uuid);

  beforeAll(async () => {
    t = await api.signup('fwc');
    web = await inbox.channel(t.admin, { name: 'Website' });
    await h.owner.query(`UPDATE channels SET kind = 'webchat' WHERE uuid = $1`, [web.id]);
    other = await inbox.channel(t.admin, { name: 'Second line' });
    manager = await api.member(t, 'manager', BULK);
    agent = await api.member(t, 'agent', AGENT);
  });

  it.each(['resolved', 'closed'] as const)(
    'refuses a reopen, a snooze and a spam mark of a %s web chat, which stays as it was',
    async (state) => {
      const c = await inbox.conversation(t, web.id, { status: state, messages: 1 });

      const reopen = await status(manager.token, c.uuid, {
        rowVersion: await version(c.uuid),
        status: 'open',
      });
      expect(reopen.status, JSON.stringify(reopen.body)).toBe(422);
      expect(reopen.body.code).toBe('CONVERSATION_STATUS_INVALID');

      const snooze = await api
        .as(manager.token)
        .post(`/v2/inbox/conversations/${c.uuid}/snooze`)
        .send({ rowVersion: await version(c.uuid), until: inAnHour() });
      expect(snooze.status, JSON.stringify(snooze.body)).toBe(422);
      expect(snooze.body.code).toBe('CONVERSATION_STATUS_INVALID');

      const spam = await api
        .as(manager.token)
        .post(`/v2/inbox/conversations/${c.uuid}/spam`)
        .send({ rowVersion: await version(c.uuid) });
      expect(spam.status, JSON.stringify(spam.body)).toBe(422);
      expect(spam.body.code).toBe('CONVERSATION_STATUS_INVALID');

      expect(await statusOf(manager.token, c.uuid)).toBe(state);
    },
  );

  it('keeps resolved and closed moving between each other, and a live web chat snoozes and goes to spam as before', async () => {
    const c = await inbox.conversation(t, web.id, { status: 'open', messages: 1 });
    const toResolved = await status(manager.token, c.uuid, {
      rowVersion: await version(c.uuid),
      status: 'resolved',
    });
    expect(toResolved.status).toBe(200);
    const toClosed = await status(manager.token, c.uuid, {
      rowVersion: await version(c.uuid),
      status: 'closed',
    });
    expect(toClosed.status).toBe(200);
    expect(await statusOf(manager.token, c.uuid)).toBe('closed');

    const live = await inbox.conversation(t, web.id, { status: 'open', messages: 1 });
    const snoozed = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${live.uuid}/snooze`)
      .send({ rowVersion: await version(live.uuid), until: inAnHour() });
    expect(snoozed.status, JSON.stringify(snoozed.body)).toBe(200);
    const marked = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${live.uuid}/spam`)
      .send({ rowVersion: await version(live.uuid) });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
  });

  it('bulk: the resolved web chat fails with the same code and the other channel reopens, one outcome each', async () => {
    const chat = await inbox.conversation(t, web.id, { status: 'resolved', messages: 1 });
    const plain = await inbox.conversation(t, other.id, { status: 'resolved', messages: 1 });
    const res = await api
      .as(manager.token)
      .post('/v2/inbox/conversations/bulk')
      .send({ ids: [chat.uuid, plain.uuid], action: { type: 'status', status: 'open' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map(
      (res.body.results as Array<{ id: string; outcome: string; code?: string }>).map((r) => [
        r.id,
        r,
      ]),
    );
    expect(byId.get(chat.uuid)).toMatchObject({
      outcome: 'failed',
      code: 'CONVERSATION_STATUS_INVALID',
    });
    expect(byId.get(plain.uuid)?.outcome).toBe('done');
    expect(await statusOf(manager.token, chat.uuid)).toBe('resolved');
    expect(await statusOf(manager.token, plain.uuid)).toBe('open');
  });

  it('giving a closed web chat to someone keeps it closed, while a closed conversation on another channel reopens', async () => {
    const chat = await inbox.conversation(t, web.id, { status: 'closed', messages: 1 });
    const agentUuid = await userUuid(agent.userId);
    const assigned = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${chat.uuid}/assign`)
      .send({ rowVersion: await version(chat.uuid), userId: agentUuid });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(await statusOf(manager.token, chat.uuid)).toBe('closed');

    const plain = await inbox.conversation(t, other.id, { status: 'closed', messages: 1 });
    const reopened = await api
      .as(manager.token)
      .post(`/v2/inbox/conversations/${plain.uuid}/assign`)
      .send({ rowVersion: await version(plain.uuid), userId: agentUuid });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(await statusOf(manager.token, plain.uuid)).toBe('open');
  });
});
