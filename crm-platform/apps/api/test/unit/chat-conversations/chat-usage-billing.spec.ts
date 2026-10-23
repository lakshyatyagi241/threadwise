import { describe, expect, it, vi } from 'vitest';
import { USAGE_REPORTED_EVENT } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { DeliveryReporter } from '../../../src/modules/chat-conversations/delivery-reporter';
import { ChatUsageReporter } from '../../../src/modules/chat-conversations/chat-usage-reporter';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';

/**
 * Email and the other chat channels carry the platform's per-message fee: reported when the provider accepts the message (or, for
 * Viber, never refunded), and refused up front when the wallet cannot pay.
 */
const message = { senderKind: 'agent', templateId: null, meta: {}, kind: 'text' };

function reporter() {
  const emit = vi.fn(async () => undefined);
  const templateFacts = vi.fn(async () => ({ category: null, templateName: null }));
  const r = new DeliveryReporter({ emit } as never, { templateFacts } as never);
  const report = (o: Record<string, unknown>) =>
    r.report({} as never, 7, {
      channelKind: 'email',
      conversationId: 55,
      peerKey: 't:abc',
      status: 'sent',
      providerMessageId: 'gmail-1',
      message,
      ...o,
    });
  const reported = () =>
    emit.mock.calls.map(
      (c) => (c as unknown as [unknown, { eventType: string; payload: unknown }])[1],
    );
  return { report, reported, templateFacts };
}

describe('DeliveryReporter: the fee on email and the chat channels', () => {
  it('reports an accepted email as one email usage on its provider id, in the conversation', async () => {
    const { report, reported } = reporter();
    await report({});
    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toMatchObject({
      aggregateModule: 'conversations',
      aggregateId: 55,
      eventType: USAGE_REPORTED_EVENT,
      payload: {
        kind: 'email',
        usageId: 'gmail-1',
        status: 'used',
        units: 1,
        source: 'inbox',
        provider: 'email',
      },
    });
  });

  it('reports a Telegram message under its bot, so two bots never share a billing key', async () => {
    const { report, reported } = reporter();
    await report({
      channelKind: 'telegram',
      channelExternalId: '12',
      providerMessageId: '555:9',
      peerKey: '555',
    });
    expect(reported()[0]).toMatchObject({
      payload: { kind: 'chat_message', usageId: 'tg12:555:9', provider: 'telegram' },
    });
  });

  it('says where an automated message came from', async () => {
    const { report, reported } = reporter();
    await report({ message: { ...message, senderKind: 'bot' } });
    expect(reported()[0]).toMatchObject({ payload: { source: 'auto_reply' } });
  });

  it("never gives the fee back when Viber reports the message failed: that receipt is signed with the workspace's own token", async () => {
    const { report, reported } = reporter();
    await report({
      channelKind: 'viber',
      providerMessageId: 'tok:u1',
      peerKey: 'u1',
      status: 'failed',
    });
    await report({
      channelKind: 'viber',
      providerMessageId: 'tok:u1',
      peerKey: 'u1',
      status: 'undelivered',
    });
    expect(reported()).toHaveLength(0);
  });

  it('does not bill again on a delivered or seen receipt', async () => {
    const { report, reported } = reporter();
    await report({ channelKind: 'viber', providerMessageId: 'tok:u1', status: 'delivered' });
    await report({ channelKind: 'viber', providerMessageId: 'tok:u1', status: 'read' });
    expect(reported()).toHaveLength(0);
  });

  it('reports nothing for the simulator, a personal number, a reaction or a message without a provider id', async () => {
    const { report, reported } = reporter();
    await report({ channelKind: 'simulator' });
    await report({ channelKind: 'whatsapp_qr' });
    await report({ channelKind: 'telegram', message: { ...message, kind: 'reaction' } });
    await report({ providerMessageId: null });
    expect(reported()).toHaveLength(0);
  });

  it('leaves WhatsApp to the rate card: no usage event, and the template is still looked up', async () => {
    const { report, reported, templateFacts } = reporter();
    await report({ channelKind: 'whatsapp_cloud', peerKey: '919876543210' });
    expect(templateFacts).toHaveBeenCalled();
    expect(reported().every((e) => e.eventType !== USAGE_REPORTED_EVENT)).toBe(true);
  });
});

describe('OutboundService: an empty wallet is refused before an email or chat message is stored', () => {
  function build(assertCanAfford = vi.fn(async () => undefined)) {
    const none = {} as never;
    const svc = new OutboundService(
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      { assertCanAfford } as never,
      none,
      none,
      none,
      none,
    );
    const gate = (kind: string, reaction = false) =>
      (
        svc as unknown as { assertUsageAffordable: (...a: unknown[]) => Promise<void> }
      ).assertUsageAffordable(7, kind, reaction);
    return { gate, assertCanAfford };
  }

  it('asks for one email, and for one chat message', async () => {
    const { gate, assertCanAfford } = build();
    await gate('email');
    await gate('viber');
    expect(assertCanAfford).toHaveBeenNthCalledWith(1, 7, 'email');
    expect(assertCanAfford).toHaveBeenNthCalledWith(2, 7, 'chat_message');
  });

  it('lets the wallet refusal through (WALLET_EMPTY) so nothing is queued', async () => {
    const refusal = new AppError('WALLET_EMPTY', 'empty', 422);
    const { gate } = build(
      vi.fn(async () => {
        throw refusal;
      }),
    );
    await expect(gate('telegram')).rejects.toBe(refusal);
  });

  it('never asks for the simulator, WhatsApp, a personal number, or a reaction', async () => {
    const { gate, assertCanAfford } = build();
    await gate('simulator');
    await gate('whatsapp_cloud');
    await gate('whatsapp_qr');
    await gate('telegram', true);
    expect(assertCanAfford).not.toHaveBeenCalled();
  });
});

describe("ChatUsageReporter: the channels' own senders", () => {
  const ref = { module: 'telegram_broadcasts', id: 3, uuid: 'b-uuid', name: 'Diwali' };
  const sent = { channelKind: 'telegram', peerKey: '555', providerMessageId: '555:9', scope: '12' };

  function build(
    opts: { emit?: ReturnType<typeof vi.fn>; assertCanAfford?: ReturnType<typeof vi.fn> } = {},
  ) {
    const emit = opts.emit ?? vi.fn(async () => undefined);
    const assertCanAfford = opts.assertCanAfford ?? vi.fn(async () => undefined);
    const db = { txAs: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) => fn({})) };
    const svc = new ChatUsageReporter(db as never, { emit } as never, { assertCanAfford } as never);
    return { svc, emit, assertCanAfford };
  }

  it('reports a broadcast message on its broadcast, named, as a broadcast', async () => {
    const { svc, emit } = build();
    await svc.reportMessage(7, ref, sent);
    expect(emit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: 7,
        aggregateModule: 'telegram_broadcasts',
        aggregateId: 3,
        eventType: USAGE_REPORTED_EVENT,
        payload: expect.objectContaining({
          kind: 'chat_message',
          usageId: 'tg12:555:9',
          source: 'broadcast',
          subjectName: 'Diwali',
        }),
      }),
    );
  });

  it('never throws when the report cannot be written: the message is gone and must not become a failed recipient', async () => {
    const { svc } = build({
      emit: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(svc.reportMessage(7, ref, sent)).resolves.toBeUndefined();
  });

  it('says why the wallet cannot pay, and nothing when it can', async () => {
    expect(await build().svc.refusal(7)).toBeNull();
    const empty = build({
      assertCanAfford: vi.fn(async () => {
        throw new AppError('WALLET_EMPTY', 'Top up to continue.', 422);
      }),
    });
    expect(await empty.svc.refusal(7, 25)).toBe('Top up to continue.');
    expect(empty.assertCanAfford).toHaveBeenCalledWith(7, 'chat_message', 25);
  });

  it('lets any other failure through instead of reading it as an empty wallet', async () => {
    const boom = new Error('boom');
    const { svc } = build({
      assertCanAfford: vi.fn(async () => {
        throw boom;
      }),
    });
    await expect(svc.refusal(7)).rejects.toBe(boom);
  });
});
