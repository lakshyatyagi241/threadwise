import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNCONTACTED_DEFAULTS } from '@crm/contracts';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  asUser,
  conversationOf,
  messagesOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from './pipeline-support';

/**
 * Lead handling on the real message pipeline (BL-290): a person's message that the provider accepted clears the contact's "Uncontacted"
 * marker (the dispatch worker's `markSent`), and a campaign, broadcast or flow message recorded by another domain clears it under its own
 * toggle. A bot that is not one of those (an auto reply) never does. Real Postgres, Redis, the simulator channel and BullMQ workers.
 */
let p: Pipeline;
let facade: ConversationsFacade;

beforeAll(async () => {
  p = await startPipeline();
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
}, 1_500_000);

afterAll(async () => {
  await p?.stop();
});

let n = 0;
const peer = () => `9197000${String(20_000 + n++)}`;

/** A thread with a customer message in it, whose contact is marked uncontacted. */
async function uncontactedThread(t: Tenant, ch: SimChannel) {
  const who = peer();
  await simInbound(p, t, ch, { from: who, name: 'Lead', text: 'hello' });
  const conv = await conversationOf(p, t, ch, who);
  await until('inbound stored', async () => (await messagesOf(p, conv.id as number)).length >= 1);
  const contactId = Number(
    (await until('contact linked', async () => {
      const r = await p.h.owner.query(`SELECT contact_id FROM conversations WHERE id = $1`, [
        conv.id,
      ]);
      return r.rows[0]?.contact_id ?? undefined;
    })) as number,
  );
  await p.h.owner.query(`UPDATE contacts SET uncontacted_since = now() WHERE id = $1`, [contactId]);
  return { uuid: conv.uuid as string, peer: who, contactId };
}

const since = async (contactId: number) =>
  (await p.h.owner.query(`SELECT uncontacted_since FROM contacts WHERE id = $1`, [contactId]))
    .rows[0].uncontacted_since as Date | null;

const setClearOn = async (t: Tenant, clearOn: Partial<typeof UNCONTACTED_DEFAULTS.clearOn>) => {
  const url = '/v2/lead-handling/settings/uncontacted';
  const cur = (await p.api.as(t.admin).get('/v2/lead-handling/settings')).body.uncontacted as {
    rowVersion: number | null;
  };
  const res = await p.api
    .as(t.admin)
    .put(url)
    .send({
      ...UNCONTACTED_DEFAULTS,
      clearOn: { ...UNCONTACTED_DEFAULTS.clearOn, ...clearOn },
      ...(cur.rowVersion ? { rowVersion: cur.rowVersion } : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const reply = (t: Tenant, uuid: string, sender?: { kind: 'agent' | 'bot' }) =>
  asUser(t.orgId, t.adminUserId, () =>
    facade.enqueueOutbound({
      conversationId: uuid,
      clientMessageId: randomUUID(),
      content: { kind: 'text', body: 'Hello from the team' },
      ...(sender ? { sender } : {}),
    }),
  );

const waitSent = (messageUuid: string) =>
  until('message sent', async () => {
    const r = await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [messageUuid]);
    return ['sent', 'delivered', 'read'].includes(r.rows[0]?.status) ? true : undefined;
  });

describe('an inbox message the provider accepted', () => {
  it('clears the marker and leaves an audit row and an event with the cause', async () => {
    const t = await p.api.signup('lhm1');
    const ch = await simChannel(p, t);
    const th = await uncontactedThread(t, ch);
    const { message } = await reply(t, th.uuid);
    // Queued is not sent: nothing has reached the contact yet.
    expect(await since(th.contactId)).not.toBeNull();
    await waitSent(message.id);
    await until('marker cleared', async () =>
      (await since(th.contactId)) === null ? true : undefined,
    );
    const events = await p.api.events(t.orgId, 'contact.uncontacted_changed');
    expect(events.at(-1)).toMatchObject({ uncontacted: false, cause: 'message' });
  }, 120_000);

  it('does nothing when the "message" option is switched off', async () => {
    const t = await p.api.signup('lhm2');
    await setClearOn(t, { message: false });
    const ch = await simChannel(p, t);
    const th = await uncontactedThread(t, ch);
    const { message } = await reply(t, th.uuid);
    await waitSent(message.id);
    expect(await since(th.contactId)).not.toBeNull();
  }, 120_000);

  it('is not cleared by a bot reply: only a person reaching out counts', async () => {
    const t = await p.api.signup('lhm3');
    const ch = await simChannel(p, t);
    const th = await uncontactedThread(t, ch);
    const { message } = await reply(t, th.uuid, { kind: 'bot' });
    await waitSent(message.id);
    expect(await since(th.contactId)).not.toBeNull();
  }, 120_000);
});

describe('a message another domain recorded', () => {
  const record = (t: Tenant, ch: SimChannel, who: string, source: string, senderUserId?: number) =>
    asUser(t.orgId, t.adminUserId, () =>
      facade.recordOutbound({
        channelId: ch.id,
        peerKey: who,
        source,
        body: `from ${source}`,
        providerMessageId: `wamid.${randomUUID()}`,
        ...(senderUserId ? { senderUserId } : {}),
      }),
    );

  it.each(['flow', 'campaign', 'broadcast'])(
    'a %s message clears the marker under "automation", and not when that option is off',
    async (source) => {
      const t = await p.api.signup(`lha${source}`);
      const ch = await simChannel(p, t);
      const a = await uncontactedThread(t, ch);
      await setClearOn(t, { automation: false });
      await record(t, ch, a.peer, source);
      expect(await since(a.contactId), `${source} with the option off`).not.toBeNull();
      await setClearOn(t, { automation: true });
      await record(t, ch, a.peer, source);
      expect(await since(a.contactId), `${source} with the option on`).toBeNull();
    },
    180_000,
  );

  it('an auto reply, an AI answer or a system line never clears it', async () => {
    const t = await p.api.signup('lhauto');
    const ch = await simChannel(p, t);
    const a = await uncontactedThread(t, ch);
    for (const source of ['auto_reply', 'ai', 'bot', 'appointment']) {
      await record(t, ch, a.peer, source);
    }
    expect(await since(a.contactId)).not.toBeNull();
  }, 120_000);

  it('a message with a sender person counts as theirs, under "message"', async () => {
    const t = await p.api.signup('lhperson');
    const ch = await simChannel(p, t);
    const a = await uncontactedThread(t, ch);
    await record(t, ch, a.peer, 'email', t.adminUserId);
    expect(await since(a.contactId)).toBeNull();
  }, 120_000);
});
