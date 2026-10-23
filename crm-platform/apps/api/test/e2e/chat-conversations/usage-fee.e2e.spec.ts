import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USAGE_REPORTED_EVENT, type ChannelKind } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type OutboundEnvelope,
  type SendResult,
} from '../../../src/infra/providers/chat-conversations';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { InboundIngestService } from '../../../src/modules/chat-conversations/inbound-ingest.service';
import { ReceiptsService } from '../../../src/modules/chat-conversations/receipts.service';
import type { Tenant } from '../contacts-attributes-tags/support';
import { FakeEmailAdapter } from './fake-email-adapter';
import {
  conversationOf,
  fundWallet,
  scalar,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
} from './pipeline-support';

/**
 * The platform's per-message fee on email and the other chat channels, at the inbox pipeline's two hook points: a reply that the
 * provider accepted writes ONE `usage.reported` in the transaction that marks it sent (the worker's billing consumer, not loaded here,
 * turns it into the charge), a Viber `failed` receipt reports nothing (no refund on a receipt the workspace signs), and an empty wallet refuses an
 * email before anything is stored. The simulator is never billed. Real Postgres (restricted role), Redis and BullMQ workers in one
 * process; the providers are stand-ins.
 */
let p: Pipeline;
const email = new FakeEmailAdapter();

/** A chat channel's stand-in: accepts everything, one provider id per message, receipts reported by the spec. */
class FakeChatAdapter implements ChannelAdapter {
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields: readonly string[] = [];
  sent: OutboundEnvelope[] = [];
  constructor(readonly kind: ChannelKind) {}
  externalIdOf(): string | null {
    return null;
  }
  capabilities() {
    return {
      windowHours: null,
      templates: false,
      media: [] as never[],
      reactions: false,
      editDelete: false,
      receipts: ['sent' as const, 'delivered' as const, 'read' as const],
      typing: false,
    };
  }
  windowInfo(_c: ChannelRuntime, lastInboundAt: Date | null, now: Date) {
    return windowFromLastInbound(null, lastInboundAt, now);
  }
  async send(_c: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    this.sent.push(envelope);
    return { providerMessageId: `fake-${this.kind}-${randomUUID()}`, acceptedAt: new Date() };
  }
  verifyInbound(): boolean {
    return false;
  }
  parseInbound() {
    return { messages: [], receipts: [] };
  }
}
const viber = new FakeChatAdapter('viber');

beforeAll(async () => {
  p = await startPipeline();
  const registry = p.h.app.get(ChannelAdapterRegistry);
  registry.register(email);
  registry.register(viber);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const system = <T>(t: Tenant, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'spec-system', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

interface Chan {
  uuid: string;
  id: number;
}

/** A shared mailbox and its email channel (a channel with no mailbox row fails closed, TW-MAIL-035). */
async function emailChannel(t: Tenant): Promise<Chan> {
  const mb = await p.h.owner.query(
    `INSERT INTO mail_mailboxes (org_id, address, display_name, status, scope)
     VALUES ($1, 'support@shop.test', 'Support mailbox', 'connected', 'shared') RETURNING uuid`,
    [t.orgId],
  );
  const res = await p.h.owner.query(
    `INSERT INTO channels (org_id, kind, name, status, display_address, external_id, settings)
     VALUES ($1, 'email', 'Support mailbox', 'connected', 'support@shop.test', $2, '{"metered": false}'::jsonb)
     RETURNING id, uuid`,
    [t.orgId, mb.rows[0].uuid as string],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

async function viberChannel(t: Tenant): Promise<Chan> {
  const res = await p.h.owner.query(
    `INSERT INTO channels (org_id, kind, name, status, external_id, settings)
     VALUES ($1, 'viber', 'Viber', 'connected', $2, '{"metered": false}'::jsonb) RETURNING id, uuid`,
    [t.orgId, `vb-${randomUUID().slice(0, 8)}`],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

/** A customer writes first, so the thread exists. */
async function inbound(t: Tenant, ch: Chan, peer: string, kind: 'email' | 'viber') {
  await system(t, () =>
    p.h.app.get(InboundIngestService).ingest({
      orgId: t.orgId,
      channelUuid: ch.uuid,
      message: {
        providerMessageId: `in.${randomUUID()}`,
        peerKey: peer,
        peerName: 'Ada',
        kind: 'text',
        body: 'hello',
        ...(kind === 'email'
          ? {
              title: 'Question',
              contactIdentity: { kind: 'email', value: 'ada@example.com', name: 'Ada' },
              meta: {
                email: {
                  subject: 'Question',
                  from: { name: 'Ada', address: 'ada@example.com' },
                  to: [{ name: null, address: 'support@shop.test' }],
                  messageId: `m${randomUUID()}@example.com`,
                  references: [],
                  threadId: peer.slice(2),
                  html: null,
                },
              },
            }
          : {}),
        providerTimestamp: new Date().toISOString(),
      } as never,
    }),
  );
  const row = await until('conversation', async () => {
    const r = await p.h.owner.query(
      `SELECT id, uuid FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
      [t.orgId, ch.id, peer],
    );
    return r.rows[0] as { id: number | string; uuid: string } | undefined;
  });
  return { id: Number(row.id), uuid: row.uuid };
}

const reply = (t: Tenant, conv: { uuid: string }, over: Record<string, unknown> = {}) =>
  p.api
    .as(t.admin)
    .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
    .send({ kind: 'text', body: 'On it.', clientMessageId: randomUUID(), ...over });

const sentRow = (uuid: string) =>
  until('sent', async () => {
    const r = await p.h.owner.query(
      `SELECT id, status, provider_message_id FROM messages WHERE uuid = $1`,
      [uuid],
    );
    const row = r.rows[0] as { status: string; provider_message_id: string | null } | undefined;
    return row?.status === 'sent' || row?.status === 'delivered' ? row : undefined;
  });

interface UsageEvent {
  aggregate_module: string;
  aggregate_id: string | number;
  payload: Record<string, unknown>;
}
const usageEvents = async (t: Tenant): Promise<UsageEvent[]> =>
  (
    await p.h.owner.query(
      `SELECT aggregate_module, aggregate_id, payload FROM event_outbox
        WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [t.orgId, USAGE_REPORTED_EVENT],
    )
  ).rows as UsageEvent[];

describe('an email reply', () => {
  it('reports one email usage on the provider message id when the mailbox accepts it, and a repeat of the same send reports nothing more', async () => {
    const t = await p.api.signup('fee-mail');
    await fundWallet(p, t);
    const ch = await emailChannel(t);
    const conv = await inbound(t, ch, 't:thread-1', 'email');

    const clientMessageId = randomUUID();
    const res = await reply(t, conv, { clientMessageId });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const done = await sentRow(res.body.id as string);

    const events = await usageEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregate_module: 'conversations',
      payload: {
        kind: 'email',
        usageId: done.provider_message_id,
        status: 'used',
        units: 1,
        source: 'inbox',
        provider: 'email',
      },
    });
    expect(Number(events[0]!.aggregate_id)).toBe(conv.id);
    // An address is not a number to dial: no country on the charge.
    expect(events[0]!.payload.recipient ?? null).toBeNull();

    // The same client id again: the first message, nothing sent and nothing reported twice.
    const again = await reply(t, conv, { clientMessageId });
    expect(again.status).toBe(202);
    expect(again.body.id).toBe(res.body.id);
    expect(await usageEvents(t)).toHaveLength(1);
  });

  it('is refused with WALLET_EMPTY before anything is stored when the wallet cannot pay for it', async () => {
    const t = await p.api.signup('fee-empty');
    const ch = await emailChannel(t);
    const conv = await inbound(t, ch, 't:thread-2', 'email');
    const before = email.sent.length;

    const res = await reply(t, conv);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('WALLET_EMPTY');
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'out'`,
        [conv.id],
      ),
    ).toBe(0);
    expect(email.sent.length).toBe(before);
    expect(await usageEvents(t)).toHaveLength(0);

    // A top-up and the same reply goes.
    await fundWallet(p, t);
    const ok = await reply(t, conv);
    expect(ok.status, JSON.stringify(ok.body)).toBe(202);
  });

  it("never refuses the platform's own workspace", async () => {
    const t = await p.api.signup('fee-own');
    await p.h.owner.query(`UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1`, [
      t.orgId,
    ]);
    const ch = await emailChannel(t);
    const conv = await inbound(t, ch, 't:thread-3', 'email');
    const res = await reply(t, conv);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  });
});

describe('a chat channel (Viber)', () => {
  it('is billed as a chat message with no country, free until the operator prices it, and an empty wallet does not stop it while it is free', async () => {
    const t = await p.api.signup('fee-viber');
    const ch = await viberChannel(t);
    const conv = await inbound(t, ch, 'AbCdEf123==', 'viber');
    const res = await reply(t, conv);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const done = await sentRow(res.body.id as string);

    const events = await usageEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: {
        kind: 'chat_message',
        usageId: done.provider_message_id,
        status: 'used',
        units: 1,
        provider: 'viber',
      },
    });
    expect(events[0]!.payload.recipient ?? null).toBeNull();
  });

  it("never gives the fee back when Viber says it was not delivered: the receipt is signed with the workspace's own token", async () => {
    const t = await p.api.signup('fee-viber-fail');
    const ch = await viberChannel(t);
    const conv = await inbound(t, ch, 'ZyXwVu987==', 'viber');
    const res = await reply(t, conv);
    const done = await sentRow(res.body.id as string);
    const receipt = (status: 'delivered' | 'read' | 'failed') =>
      system(t, () =>
        p.h.app.get(ReceiptsService).apply({
          orgId: t.orgId,
          channelUuid: ch.uuid,
          receipt: {
            providerMessageId: done.provider_message_id!,
            status,
            at: new Date().toISOString(),
          },
        }),
      );

    expect(await receipt('delivered')).toBe('applied');
    expect(await receipt('read')).toBe('applied');
    expect(await usageEvents(t)).toHaveLength(1);

    // `failed` over a delivery is ignored, so use a fresh message for the failure.
    const res2 = await reply(t, conv, { body: 'second' });
    const done2 = await sentRow(res2.body.id as string);
    const failed = await system(t, () =>
      p.h.app.get(ReceiptsService).apply({
        orgId: t.orgId,
        channelUuid: ch.uuid,
        receipt: {
          providerMessageId: done2.provider_message_id!,
          status: 'failed',
          at: new Date().toISOString(),
        },
      }),
    );
    expect(failed).toBe('applied');
    // The message is marked failed, and the wallet is told nothing more: both messages were billed once, as `used`.
    const events = await usageEvents(t);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.payload.status === 'used')).toBe(true);
  });
});

describe('what is never billed', () => {
  it('a message through the simulator reports no usage', async () => {
    const t = await p.api.signup('fee-sim');
    const ch = await simChannel(p, t);
    await simInbound(p, t, ch, { from: '919833333333', name: 'Sim', text: 'hi' });
    const conv = await conversationOf(p, t, ch, '919833333333');
    const res = await reply(t, { uuid: conv.uuid as string });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await sentRow(res.body.id as string);
    expect(await usageEvents(t)).toHaveLength(0);
  });
});
