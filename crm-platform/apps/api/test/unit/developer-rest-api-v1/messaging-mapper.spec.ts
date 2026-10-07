import { describe, expect, it } from 'vitest';
import {
  channelCode,
  publicErrorCode,
  publicStatus,
  publicType,
  recipientOf,
  threadSendStatus,
  toV1Connection,
  toV1Conversation,
  toV1Device,
  toV1Message,
  type MessageReadRow,
} from '../../../src/modules/developer-rest-api-v1/resources/messaging/messaging.mapper';

const row = (over: Partial<MessageReadRow> = {}): MessageReadRow => ({
  uuid: '11111111-1111-4111-8111-111111111111',
  direction: 'out',
  kind: 'text',
  body: 'hello',
  mediaKey: null,
  mediaMime: null,
  mediaName: null,
  status: 'sent',
  failureCode: null,
  failureReason: null,
  createdAt: new Date('2026-10-06T10:15:30.123Z'),
  peerKey: '919812345678',
  channelAddress: '+91 99999 00000',
  ...over,
});

describe('public message shape and status vocabulary (TW-API-120)', () => {
  it("maps our statuses onto Reference's: queued is pending, the rest are shared", () => {
    expect(publicStatus('queued')).toBe('pending');
    for (const s of ['sent', 'delivered', 'read', 'failed', 'received'])
      expect(publicStatus(s)).toBe(s);
    expect(publicStatus('whatever')).toBe('pending');
  });

  it('types a message by its file or location kind, text for everything that is words', () => {
    for (const k of [
      'image',
      'video',
      'audio',
      'document',
      'location',
      'sticker',
      'voice',
      'contact',
    ])
      expect(publicType(k)).toBe(k);
    for (const k of ['text', 'template', 'interactive', 'reaction'])
      expect(publicType(k)).toBe('text');
  });

  it("gives Meta's typed code as a number and a platform code as text", () => {
    expect(publicErrorCode('131047')).toBe(131047);
    expect(publicErrorCode('AUTH_SEND_HALTED')).toBe('AUTH_SEND_HALTED');
    expect(publicErrorCode(null)).toBeNull();
    expect(publicErrorCode('')).toBeNull();
  });

  it("shows the recipient for ours and the business number for a customer's message", () => {
    expect(recipientOf(row())).toBe('919812345678');
    expect(recipientOf(row({ direction: 'in' }))).toBe('919999900000');
    expect(recipientOf(row({ direction: 'in', channelAddress: null }))).toBeNull();
  });

  it('builds the nine fields, ISO-8601 in UTC, with the file link only when there is a file', () => {
    const plain = toV1Message(row(), () => 'never');
    expect(plain).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      to: '919812345678',
      type: 'text',
      status: 'sent',
      failure_reason: null,
      error_code: null,
      body: 'hello',
      media_url: null,
      created_at: '2026-10-06T10:15:30.123Z',
    });
    const image = toV1Message(
      row({ kind: 'image', mediaKey: 'chat/1/2026/10/a.png' }),
      (r) => `link:${r.mediaKey}`,
    );
    expect(image.type).toBe('image');
    expect(image.media_url).toBe('link:chat/1/2026/10/a.png');
  });

  it("carries a failed message's reason and Meta code", () => {
    const failed = toV1Message(
      row({ status: 'failed', failureCode: '131047', failureReason: 'Re-engagement message' }),
      () => null,
    );
    expect(failed).toMatchObject({
      status: 'failed',
      failure_reason: 'Re-engagement message',
      error_code: 131047,
    });
  });
});

describe('conversation shape (TW-API-114)', () => {
  const conv = {
    uuid: '22222222-2222-4222-8222-222222222222',
    peerKey: '919812345678',
    title: 'Asha',
    preview: 'see you',
    lastMessageAt: new Date('2026-10-06T10:00:00.000Z'),
    unreadCount: 3,
    channelKind: 'whatsapp_cloud',
    lastOutboundStatus: 'sent',
  };

  it("answers the contact's digits, the preview, the unread count and the engine code", () => {
    expect(toV1Conversation(conv)).toEqual({
      id: conv.uuid,
      contact: '919812345678',
      name: 'Asha',
      last_message: 'see you',
      last_message_at: '2026-10-06T10:00:00.000Z',
      unread: 3,
      status: 'sent',
      channel: 'WB',
    });
  });

  it('flattens a jid to its digits and has none for a non-phone thread', () => {
    expect(toV1Conversation({ ...conv, peerKey: '919812345678@s.whatsapp.net' }).contact).toBe(
      '919812345678',
    );
    expect(toV1Conversation({ ...conv, peerKey: 'visitor-abc' }).contact).toBeNull();
    expect(toV1Conversation({ ...conv, lastMessageAt: null }).last_message_at).toBeNull();
  });

  it("keeps Reference's engine codes and shows any other channel by its kind", () => {
    expect(channelCode('whatsapp_qr')).toBe('W');
    expect(channelCode('whatsapp_cloud')).toBe('WB');
    expect(channelCode('telegram')).toBe('telegram');
  });

  it('reports the send state of the thread: pending until something went out, failed after a failed send', () => {
    expect(threadSendStatus(null)).toBe('pending');
    expect(threadSendStatus('queued')).toBe('pending');
    expect(threadSendStatus('sent')).toBe('sent');
    expect(threadSendStatus('read')).toBe('sent');
    expect(threadSendStatus('failed')).toBe('failed');
  });
});

describe('device shapes (TW-API-116, 117)', () => {
  it('an unofficial number: plain name, digits of country code and number, the engine never the library', () => {
    expect(
      toV1Device({
        uuid: 'u',
        name: 'Shop phone',
        countryCode: '+91',
        phone: '98123 45678',
        status: 'needs_pair',
        active: false,
        lastSeenAt: null,
      }),
    ).toEqual({
      id: 'u',
      name: 'Shop phone',
      phone: '919812345678',
      engine: 'unofficial',
      status: 'needs_pair',
      active: false,
      last_seen_at: null,
    });
    expect(
      toV1Device({
        uuid: 'u',
        name: null,
        countryCode: null,
        phone: null,
        status: 'connected',
        active: true,
        lastSeenAt: null,
      }),
    ).toMatchObject({
      name: '',
      phone: '',
    });
  });

  it('a connection: label, else the verified name, else the capitalised provider; connected or not', () => {
    const base = {
      uuid: 'c',
      phone: '+91 98123 45678',
      connectedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    expect(
      toV1Connection({
        ...base,
        provider: 'waba',
        displayLabel: 'Support',
        verifiedName: 'Acme',
        status: 'connected',
      }),
    ).toMatchObject({
      name: 'Support',
      phone: '919812345678',
      engine: 'whatsapp_cloud',
      status: 'connected',
      active: true,
      last_seen_at: '2026-10-01T00:00:00.000Z',
    });
    expect(
      toV1Connection({
        ...base,
        provider: 'waba',
        displayLabel: null,
        verifiedName: 'Acme',
        status: 'connected',
      }).name,
    ).toBe('Acme');
    const twilio = toV1Connection({
      ...base,
      provider: 'twilio',
      displayLabel: null,
      verifiedName: null,
      phone: null,
      status: 'pending',
      connectedAt: null,
    });
    expect(twilio).toMatchObject({
      name: 'Twilio',
      phone: null,
      engine: 'twilio',
      status: 'disconnected',
      active: false,
      last_seen_at: null,
    });
  });
});
