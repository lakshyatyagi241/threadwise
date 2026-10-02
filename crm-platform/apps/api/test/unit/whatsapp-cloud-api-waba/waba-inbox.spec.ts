import { describe, expect, it, vi } from 'vitest';
import { toInbound } from '../../../src/modules/whatsapp-cloud-api-waba/inbox/waba-inbox.sink';
import { WabaChannelAdapter } from '../../../src/modules/whatsapp-cloud-api-waba/inbox/waba-channel.adapter';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';

const msg = (raw: Record<string, unknown>) => ({
  providerMessageId: String(raw.id ?? 'wamid.1'),
  from: '+919800000001',
  kind: 'text_message' as const,
  content: raw,
  occurredAt: new Date('2026-10-02T10:00:00Z'),
  raw,
});

describe('a Cloud API message in the inbox shape', () => {
  it('reads text, with the sender name and a quoted message', () => {
    expect(
      toInbound(
        msg({ id: 'w1', type: 'text', text: { body: 'hi' }, context: { id: 'w0' } }),
        'Asha',
      ),
    ).toMatchObject({
      kind: 'text',
      body: 'hi',
      peerKey: '919800000001',
      peerName: 'Asha',
      replyToProviderMessageId: 'w0',
    });
  });
  it('reads a file by its media id, caption and file name', () => {
    expect(
      toInbound(
        msg({
          id: 'w2',
          type: 'document',
          document: { id: 'M1', mime_type: 'application/pdf', filename: 'a.pdf', caption: 'bill' },
        }),
        null,
      ),
    ).toMatchObject({
      kind: 'media',
      body: 'bill',
      media: {
        providerMediaId: 'M1',
        mediaKind: 'document',
        mime: 'application/pdf',
        name: 'a.pdf',
      },
    });
  });
  it('reads a location, a reaction, a button tap and contacts', () => {
    expect(
      toInbound(msg({ type: 'location', location: { latitude: 1, longitude: 2 } }), null),
    ).toMatchObject({ kind: 'location', location: { latitude: 1, longitude: 2 } });
    expect(
      toInbound(msg({ type: 'reaction', reaction: { message_id: 'w0', emoji: '👍' } }), null),
    ).toMatchObject({ kind: 'reaction', reactionEmoji: '👍', replyToProviderMessageId: 'w0' });
    expect(
      toInbound(
        msg({ type: 'interactive', interactive: { button_reply: { title: 'Yes' } } }),
        null,
      ),
    ).toMatchObject({ kind: 'interactive', body: 'Yes' });
    expect(
      toInbound(msg({ type: 'contacts', contacts: [{ name: { formatted_name: 'Ravi' } }] }), null),
    ).toMatchObject({ kind: 'contact', body: 'Ravi' });
  });
  it('keeps a kind it does not know, and a file without an id, as unsupported', () => {
    expect(toInbound(msg({ type: 'order' }), null).kind).toBe('unsupported');
    expect(toInbound(msg({ type: 'image', image: {} }), null).kind).toBe('unsupported');
  });
});

describe('the Cloud adapter turns a Meta refusal into a decision', () => {
  const channel = {
    orgId: 1,
    uuid: 'c',
    kind: 'whatsapp_waba',
    externalId: 'n',
    credentials: {},
  } as never;
  const build = (fail: unknown) => {
    const provider = {
      sendText: vi.fn(async () => {
        throw fail;
      }),
    };
    const numbers = {
      resolveConnection: async () => ({
        conn: { provider: 'meta', wabaId: 'W', phoneNumberId: 'P', accessToken: 't' },
      }),
    };
    const db = { txAs: async (_c: unknown, f: (t: unknown) => unknown) => f({}) };
    return new WabaChannelAdapter(db as never, numbers as never, {} as never, provider as never);
  };
  const text = {
    kind: 'text',
    to: '+919800000001',
    body: 'x',
    clientReference: 'r',
    attempt: 1,
  } as never;
  const err = (code: number, status = 400) =>
    WabaApiError.fromResponse(status, { error: { code, message: 'm' } });

  it('closed window: fails with Meta code, no retry', async () => {
    await expect(build(err(131047)).send(channel, text)).rejects.toMatchObject({
      code: '131047',
      retryable: false,
    });
  });
  it('rate limit: retry later', async () => {
    await expect(build(err(130429, 429)).send(channel, text)).rejects.toMatchObject({
      code: '130429',
      retryable: true,
    });
  });
  it('anything else unknown: retry', async () => {
    await expect(build(new Error('boom')).send(channel, text)).rejects.toMatchObject({
      code: 'WABA_SEND_FAILED',
      retryable: true,
    });
  });
});
