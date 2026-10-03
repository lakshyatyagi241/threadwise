import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MetaCloudChannelAdapter,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations';
import { MetaCloudProvider } from '../../../src/infra/providers/whatsapp/meta-cloud.provider';

const adapter = new MetaCloudChannelAdapter(new MetaCloudProvider({} as never, {} as never));

const channel = (
  credentials: Record<string, string | undefined> = { appSecret: 'app-secret-123' },
): ChannelRuntime => ({
  orgId: 1,
  uuid: '22222222-2222-4222-8222-222222222222',
  kind: 'whatsapp_cloud',
  status: 'connected',
  externalId: '1234567890',
  displayAddress: null,
  settings: { metered: true },
  capabilityOverrides: {},
  credentials,
});

const sign = (body: Buffer, secret = 'app-secret-123') =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('MetaCloudChannelAdapter: the skeleton', () => {
  it('is not live: its send is a permanent refusal, so a Cloud channel can never be marked connected', async () => {
    expect(adapter.live).toBe(false);
    await expect(
      adapter.send(channel(), {
        kind: 'text',
        to: '1',
        clientReference: 'r',
        attempt: 1,
        body: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_LIVE', retryable: false });
  });

  it('reports the Cloud capabilities: 24 hour window, templates, all media', () => {
    expect(adapter.capabilities()).toMatchObject({
      windowHours: 24,
      templates: true,
      reactions: true,
      typing: false,
    });
    expect(adapter.capabilities().media).toContain('document');
  });

  it('takes the phone number id from the credentials as the external id', () => {
    expect(adapter.externalIdOf({ phoneNumberId: '1234567890' })).toBe('1234567890');
    expect(adapter.externalIdOf({})).toBeNull();
  });

  it('validates credentials strictly: digits for the number id, no unknown keys', () => {
    const schema = adapter.credentialsSchema;
    expect(
      schema.safeParse({
        phoneNumberId: '1234567890',
        accessToken: 'EAAB-token-12345',
        appSecret: 'sekret-12345',
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        phoneNumberId: 'abc',
        accessToken: 'EAAB-token-12345',
        appSecret: 'sekret-12345',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        phoneNumberId: '1234567890',
        accessToken: 'EAAB-token-12345',
        appSecret: 'sekret-12345',
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe('MetaCloudChannelAdapter.verifyInbound: the signature is the only authentication', () => {
  const body = Buffer.from(JSON.stringify({ entry: [] }));

  it('accepts the signature of the raw body made with the channel app secret', () => {
    expect(adapter.verifyInbound(channel(), body, { 'x-hub-signature-256': sign(body) })).toBe(
      true,
    );
  });

  it('rejects a wrong secret, a changed body, a missing or malformed header, and a channel with no app secret', () => {
    expect(
      adapter.verifyInbound(channel(), body, { 'x-hub-signature-256': sign(body, 'other') }),
    ).toBe(false);
    expect(
      adapter.verifyInbound(channel(), Buffer.from('{"entry":[1]}'), {
        'x-hub-signature-256': sign(body),
      }),
    ).toBe(false);
    expect(adapter.verifyInbound(channel(), body, {})).toBe(false);
    expect(adapter.verifyInbound(channel(), body, { 'x-hub-signature-256': 'sha256=zz' })).toBe(
      false,
    );
    expect(adapter.verifyInbound(channel(), body, { 'x-hub-signature-256': 'md5=abc' })).toBe(
      false,
    );
    expect(adapter.verifyInbound(channel({}), body, { 'x-hub-signature-256': sign(body) })).toBe(
      false,
    );
  });
});

describe('MetaCloudChannelAdapter.parseInbound: recorded-shape payloads', () => {
  const payload = (value: unknown) => ({ entry: [{ changes: [{ value }] }] });

  it('normalises a text message with the sender profile name and a reply context', () => {
    const parsed = adapter.parseInbound(
      channel(),
      payload({
        contacts: [{ wa_id: '919876543210', profile: { name: 'Asha' } }],
        messages: [
          {
            id: 'wamid.1',
            from: '919876543210',
            type: 'text',
            timestamp: '1760000000',
            text: { body: 'hi' },
            context: { id: 'wamid.0' },
          },
        ],
      }),
    );
    expect(parsed.messages).toEqual([
      {
        providerMessageId: 'wamid.1',
        peerKey: '919876543210',
        peerName: 'Asha',
        providerTimestamp: new Date(1760000000 * 1000),
        replyToProviderMessageId: 'wamid.0',
        kind: 'text',
        body: 'hi',
      },
    ]);
  });

  it('normalises media with its provider media id, mime and caption; location; reaction', () => {
    const parsed = adapter.parseInbound(
      channel(),
      payload({
        messages: [
          {
            id: 'm1',
            from: '9198',
            type: 'image',
            timestamp: '1',
            image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'look' },
          },
          {
            id: 'm2',
            from: '9198',
            type: 'location',
            timestamp: '1',
            location: { latitude: 1.5, longitude: 2.5, name: 'Here' },
          },
          {
            id: 'm3',
            from: '9198',
            type: 'reaction',
            timestamp: '1',
            reaction: { message_id: 'wamid.9', emoji: '👍' },
          },
          { id: 'm4', from: '9198', type: 'order', timestamp: '1' },
        ],
      }),
    );
    expect(parsed.messages[0]).toMatchObject({
      kind: 'media',
      body: 'look',
      media: { providerMediaId: 'MEDIA1', mediaKind: 'image', mime: 'image/jpeg' },
    });
    expect(parsed.messages[1]).toMatchObject({
      kind: 'location',
      location: { latitude: 1.5, longitude: 2.5 },
    });
    expect(parsed.messages[2]).toMatchObject({
      kind: 'reaction',
      replyToProviderMessageId: 'wamid.9',
      reactionEmoji: '👍',
    });
    expect(parsed.messages[3]).toMatchObject({ kind: 'unsupported' });
  });

  it('normalises delivery receipts, keeps the error code of a failure and ignores other statuses', () => {
    const parsed = adapter.parseInbound(
      channel(),
      payload({
        statuses: [
          { id: 'w1', status: 'delivered', timestamp: '1760000100' },
          {
            id: 'w2',
            status: 'failed',
            timestamp: '1760000200',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'w3', status: 'deleted', timestamp: '1760000300' },
        ],
      }),
    );
    expect(parsed.receipts).toEqual([
      {
        providerMessageId: 'w1',
        status: 'delivered',
        at: new Date(1760000100 * 1000),
        errorCode: undefined,
        errorMessage: undefined,
      },
      {
        providerMessageId: 'w2',
        status: 'failed',
        at: new Date(1760000200 * 1000),
        errorCode: '131047',
        errorMessage: 'Re-engagement message',
      },
    ]);
  });

  it('a payload of no recognisable shape is empty, never an exception', () => {
    for (const bad of [
      null,
      'x',
      {},
      { entry: 'no' },
      { entry: [{}] },
      { entry: [{ changes: [{}] }] },
    ]) {
      expect(adapter.parseInbound(channel(), bad)).toEqual({ messages: [], receipts: [] });
    }
  });
});
