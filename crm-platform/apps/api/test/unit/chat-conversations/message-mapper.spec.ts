import { describe, expect, it } from 'vitest';
import { messageResponseSchema } from '@crm/contracts';
import {
  toMessageResponse,
  toRealtimeMessage,
} from '../../../src/modules/chat-conversations/message.mapper';
import type { MessageRow } from '../../../src/modules/chat-conversations/messages.repository';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (over: Partial<MessageRow> = {}): MessageRow =>
  ({
    id: 99,
    createdAtText: '2026-10-02 10:00:00.123456+00',
    createdAt: new Date('2026-10-02T10:00:00.123Z'),
    uuid: UUID(1),
    conversationId: 5,
    conversationUuid: UUID(2),
    seq: 3,
    direction: 'in',
    kind: 'text',
    senderKind: 'customer',
    senderUserId: null,
    senderUserUuid: null,
    senderName: null,
    body: 'hello',
    mediaKey: null,
    mediaMime: null,
    mediaSize: null,
    mediaName: null,
    latitude: null,
    longitude: null,
    status: 'received',
    failureCode: null,
    failureReason: null,
    clientMessageId: null,
    providerMessageId: 'wamid.X',
    replyToMessageUuid: null,
    reaction: null,
    isTranslated: false,
    translatedBody: null,
    detectedLanguage: null,
    starred: false,
    pinned: false,
    editedAt: null,
    deletedAt: null,
    templateId: null,
    templateUuid: null,
    meta: {},
    providerTs: new Date('2026-10-02T09:59:58.000Z'),
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    ...over,
  }) as MessageRow;

describe('toMessageResponse: the wire shape, ids and keys never leak', () => {
  it('an inbound text message matches the contract and carries only uuids', () => {
    const wire = toMessageResponse(row(), () => null);
    expect(messageResponseSchema.parse(wire)).toEqual(wire);
    expect(wire.id).toBe(UUID(1));
    expect(wire.conversationId).toBe(UUID(2));
    expect(JSON.stringify(wire)).not.toContain('wamid.X'); // the provider id is not on the wire
    expect(Object.keys(wire)).not.toContain('conversationInternalId');
  });

  it('a file is a link minted per reader; the storage key is never in the response', () => {
    const r = row({
      kind: 'image',
      mediaKey: 'chat/7/2026/10/1_abc.png',
      mediaMime: 'image/png',
      mediaSize: 120,
      mediaName: 'photo.png',
    });
    const wire = toMessageResponse(r, () => '/api/v2/media/TOKEN');
    expect(wire.media).toEqual({
      url: '/api/v2/media/TOKEN',
      mime: 'image/png',
      sizeBytes: 120,
      name: 'photo.png',
    });
    expect(JSON.stringify(wire)).not.toContain('chat/7/');
  });

  it('the realtime copy has no link (it is sent to everyone with the thread open): an empty url tells the client to refetch', () => {
    const r = row({ kind: 'image', mediaKey: 'chat/7/2026/10/1_abc.png', mediaMime: 'image/png' });
    const wire = toRealtimeMessage(r);
    expect(wire.media?.url).toBe('');
    expect(messageResponseSchema.parse(wire)).toEqual(wire);
  });

  it('a failed outbound message carries its reason and the client id the optimistic bubble is swapped by', () => {
    const wire = toMessageResponse(
      row({
        direction: 'out',
        senderKind: 'agent',
        senderUserUuid: UUID(9),
        senderName: 'Nachiket',
        status: 'failed',
        failureCode: 'SIM_REJECTED',
        failureReason: 'The simulated provider rejected this message',
        clientMessageId: UUID(7),
      }),
      () => null,
    );
    expect(wire.failure).toEqual({
      code: 'SIM_REJECTED',
      reason: 'The simulated provider rejected this message',
    });
    expect(wire.clientMessageId).toBe(UUID(7));
    expect(wire.sender).toEqual({ kind: 'agent', userId: UUID(9), name: 'Nachiket' });
  });

  it('failure is present only while the message is failed', () => {
    expect(
      toMessageResponse(row({ direction: 'out', status: 'sent', failureCode: 'X' }), () => null)
        .failure,
    ).toBeNull();
  });

  it('a location and a template are rebuilt from their columns and meta', () => {
    const loc = toMessageResponse(
      row({
        kind: 'location',
        latitude: 19.07,
        longitude: 72.87,
        meta: { locationName: 'Mumbai' },
        body: null,
      }),
      () => null,
    );
    expect(loc.location).toEqual({
      latitude: 19.07,
      longitude: 72.87,
      name: 'Mumbai',
      address: null,
    });
    const tpl = toMessageResponse(
      row({
        direction: 'out',
        kind: 'template',
        status: 'queued',
        templateUuid: UUID(5),
        meta: {
          templateName: 'welcome',
          templateLanguage: 'en',
          templateVariables: { '1': 'Asha', bad: 3 },
        },
      }),
      () => null,
    );
    expect(tpl.template).toEqual({
      templateId: UUID(5),
      name: 'welcome',
      language: 'en',
      variables: { '1': 'Asha' },
    });
    expect(messageResponseSchema.parse(tpl)).toEqual(tpl);
  });
});

describe('toMessageResponse: rows stored before the adapter understood a type', () => {
  it('an old call-permission placeholder reads as an interactive reply', () => {
    const wire = toMessageResponse(
      row({
        direction: 'in',
        kind: 'text',
        body: '[Interactive · call_permission_reply]',
        meta: {
          unsupported: true,
          rawType: 'interactive',
          interactiveType: 'call_permission_reply',
        },
      }),
      () => null,
    );
    expect(wire.kind).toBe('interactive');
    expect(wire.interactive?.title).toBe('Call permission reply');
    expect(wire.unsupported).toBeUndefined();
  });

  it('an old flow answer is read as lines; a forwarded flag is passed on', () => {
    const wire = toMessageResponse(
      row({
        direction: 'in',
        kind: 'interactive',
        body: 'Sent',
        meta: { flowResponse: '{"flow_token":"t","city":"Pune"}', forwarded: true },
      }),
      () => null,
    );
    expect(wire.body).toBe('city: Pune');
    expect(wire.forwarded).toBe(true);
  });
});

describe('toMessageResponse: the delivery tally of a message sent to a WhatsApp group', () => {
  const sent = (meta: Record<string, unknown>) =>
    toMessageResponse(
      row({ direction: 'out', kind: 'text', status: 'delivered', meta }),
      () => null,
    );

  it('rolls the per-member statuses up: delivered counts the members who read it too, failed is apart, no phone number on the wire', () => {
    const wire = sent({
      group_members: 8,
      group_delivery: {
        participants: {
          '919900000001': { status: 'read', billable: true },
          '919900000002': { status: 'read', billable: true },
          '919900000003': { status: 'delivered', billable: true },
          '919900000004': { status: 'delivered', billable: false },
          '919900000005': { status: 'sent', billable: true },
          '919900000006': { status: 'failed', billable: true },
        },
        delivered_to: 6,
        billable_count: 5,
        free_count: 1,
      },
    });
    expect(messageResponseSchema.parse(wire)).toEqual(wire);
    expect(wire.groupDelivery).toEqual({
      members: 8,
      deliveredTo: 4,
      readBy: 2,
      failed: 1,
      billable: 5,
      free: 1,
    });
    expect(JSON.stringify(wire)).not.toContain('9199000000');
  });

  it('a row from before the per-member map keeps its counters; members is 0 when the group size was not known', () => {
    const wire = sent({ group_delivery: { delivered_to: 3, billable_count: 2, free_count: 1 } });
    expect(wire.groupDelivery).toMatchObject({ members: 0, deliveredTo: 3, readBy: 0, failed: 0 });
  });

  it('is absent on an inbound message and on a message with no group tally', () => {
    expect(
      toMessageResponse(row({ meta: { group_delivery: { delivered_to: 1 } } }), () => null)
        .groupDelivery,
    ).toBeUndefined();
    expect(sent({}).groupDelivery).toBeUndefined();
  });
});
