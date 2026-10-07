import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_RECEIVED_EVENT, messageReceivedPayloadSchema } from '@crm/contracts';
import {
  ConversationLifecycleService,
  notificationNameOf,
} from '../../../src/modules/chat-conversations/conversation-lifecycle.service';

const conv = (over: Record<string, unknown> = {}) =>
  ({
    id: 11,
    uuid: '22222222-2222-4222-8222-222222222222',
    peerKey: '919812345678',
    peerName: null,
    title: '+919812345678',
    ...over,
  }) as never;
const channel = {
  id: 5,
  uuid: '33333333-3333-4333-8333-333333333333',
  kind: 'whatsapp_cloud',
} as never;

function lifecycle() {
  const emitted: Array<Record<string, unknown>> = [];
  const outbox = {
    emit: vi.fn(async (_tx: unknown, e: Record<string, unknown>) => void emitted.push(e)),
  };
  const service = new ConversationLifecycleService({} as never, {} as never, outbox as never);
  return { service, emitted, outbox };
}

const AT = '2026-10-07T10:00:00.000Z';
const msg = { uuid: '44444444-4444-4444-8444-444444444444', preview: 'Hello there' };

describe('the message.received outbox event', () => {
  afterEach(() => {
    delete process.env.NOTIFY_CONVERSATIONS_ENABLED;
  });

  it('carries ids, the channel kind and a short preview that satisfies the published contract', async () => {
    const { service, emitted } = lifecycle();
    await service.messageReceived({} as never, 9, channel, conv(), msg, {
      firstInbound: true,
      group: false,
      at: AT,
    });
    expect(emitted).toHaveLength(1);
    const e = emitted[0]!;
    expect(e).toMatchObject({
      aggregateModule: 'conversations',
      aggregateId: 11,
      eventType: MESSAGE_RECEIVED_EVENT,
      orgId: 9,
    });
    const payload = messageReceivedPayloadSchema.parse(e.payload);
    expect(payload).toMatchObject({
      conversationId: '22222222-2222-4222-8222-222222222222',
      messageId: msg.uuid,
      channelId: '33333333-3333-4333-8333-333333333333',
      channelKind: 'whatsapp_cloud',
      firstInbound: true,
      preview: 'Hello there',
    });
  });

  it('puts no secret and no full phone number in the event', async () => {
    const { service, emitted } = lifecycle();
    await service.messageReceived({} as never, 9, channel, conv(), msg, {
      firstInbound: false,
      group: false,
      at: AT,
    });
    const text = JSON.stringify(emitted[0]!.payload);
    expect(text).not.toContain('919812345678');
    expect(Object.keys(emitted[0]!.payload as object).sort()).toEqual(
      [
        'at',
        'channelId',
        'channelKind',
        'contactName',
        'conversationId',
        'firstInbound',
        'group',
        'messageId',
        'preview',
      ].sort(),
    );
  });

  it('cuts the preview to 80 characters', async () => {
    const { service, emitted } = lifecycle();
    await service.messageReceived(
      {} as never,
      9,
      channel,
      conv(),
      { ...msg, preview: 'x'.repeat(500) },
      {
        firstInbound: false,
        group: false,
        at: AT,
      },
    );
    expect((emitted[0]!.payload as { preview: string }).preview).toHaveLength(80);
  });

  it('writes nothing while the notification switch is off, so the outbox does not fill with unread events', async () => {
    process.env.NOTIFY_CONVERSATIONS_ENABLED = 'false';
    const { service, outbox } = lifecycle();
    await service.messageReceived({} as never, 9, channel, conv(), msg, {
      firstInbound: true,
      group: false,
      at: AT,
    });
    expect(outbox.emit).not.toHaveBeenCalled();
  });
});

describe('notificationNameOf', () => {
  it('prefers the sender name, then a group title, then the last four digits, then nothing', () => {
    expect(notificationNameOf('whatsapp_cloud', conv({ peerName: ' Ada ' }), false)).toBe('Ada');
    expect(notificationNameOf('whatsapp_cloud', conv({ title: 'Family' }), true)).toBe('Family');
    expect(notificationNameOf('whatsapp_cloud', conv(), false)).toBe('…5678');
    expect(notificationNameOf('webchat', conv({ peerKey: 'visitor-9' }), false)).toBeNull();
  });
});
