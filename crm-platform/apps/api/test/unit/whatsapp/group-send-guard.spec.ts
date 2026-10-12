import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  ChannelError,
  outboundEnvelopeSchema,
} from '../../../src/infra/providers/chat-conversations/channel.port';
import {
  assertNotGroupPeer,
  GROUP_SEND_UNAVAILABLE,
  isGroupPeer,
} from '../../../src/infra/providers/whatsapp/group-peer';
import { MetaCloudProvider } from '../../../src/infra/providers/whatsapp/meta-cloud.provider';
import {
  buildMessageBody,
  metaRecipient,
} from '../../../src/infra/providers/whatsapp/meta-outbound';
import { buildTemplateMessage } from '../../../src/infra/providers/whatsapp/meta-template-payload';

/**
 * WABA_GROUP_SEND_UNAVAILABLE (docs/specs/waba-groups-management.md 4.3, 12.1). A group thread is keyed `g:<group id>`; the old path
 * stripped every non-digit from it and sent the message as an individual to an unrelated number. None of that may happen any more.
 */

// A Cloud API group id is long base64-looking text with digits inside: 4 to 20 of them used to survive the strip.
const GROUP_KEYS = [
  'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2',
  'g:120363025246125486',
  'g:G2',
  'g:1234',
  '  g:abc123def456',
];

const refuses = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ChannelError);
    const err = e as ChannelError;
    expect(err.code).toBe('WABA_GROUP_SEND_UNAVAILABLE');
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/not available yet/i);
    return;
  }
  throw new Error('expected a refusal');
};

describe('the typed error', () => {
  it('is one registry code, the same text the providers layer throws', () => {
    expect(ERROR_CODES.WABA_GROUP_SEND_UNAVAILABLE).toBe('WABA_GROUP_SEND_UNAVAILABLE');
    expect(GROUP_SEND_UNAVAILABLE).toBe(ERROR_CODES.WABA_GROUP_SEND_UNAVAILABLE);
  });
});

describe('isGroupPeer / assertNotGroupPeer', () => {
  it('recognises a group key and nothing that looks like a phone number', () => {
    for (const k of GROUP_KEYS) expect(isGroupPeer(k)).toBe(true);
    for (const k of ['919876543210', '+91 98765 43210', '14155550123', 'tg-chat-1', ''])
      expect(isGroupPeer(k)).toBe(false);
  });
  it('throws a non-retryable ChannelError for a group key only', () => {
    for (const k of GROUP_KEYS) refuses(() => assertNotGroupPeer(k));
    expect(() => assertNotGroupPeer('919876543210')).not.toThrow();
  });
});

describe('metaRecipient: a g: peer never becomes a number', () => {
  it('refuses every group key, including ones whose digits would pass the 4 to 20 digit check', () => {
    for (const k of GROUP_KEYS) refuses(() => metaRecipient(k));
  });
});

describe('buildMessageBody: a g: peer is addressed as a group, never as a phone number', () => {
  const common = { to: GROUP_KEYS[0]!, clientReference: 'ref-1', attempt: 1 };
  const prepared = {
    kind: 'image',
    mime: 'image/jpeg',
    voice: false,
    via: 'id',
    mediaId: 'M1',
    cached: false,
  } as never;

  it('text goes to the group id verbatim with recipient_type group', () => {
    const body = buildMessageBody(outboundEnvelopeSchema.parse({ ...common, kind: 'text', body: 'hello' }));
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'group',
      to: 'Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2',
      type: 'text',
    });
  });
  it('keeps every character of the id: digits, case, padding and a leading space on the key', () => {
    for (const k of GROUP_KEYS) {
      const body = buildMessageBody(
        outboundEnvelopeSchema.parse({ ...common, to: k, kind: 'text', body: 'x' }),
      );
      expect(body.recipient_type).toBe('group');
      expect(body.to).toBe(k.trimStart().slice(2));
    }
  });
  it('media and template are allowed', () => {
    const media = buildMessageBody(
      outboundEnvelopeSchema.parse({
        ...common,
        kind: 'media',
        media: { key: 'k', mediaKind: 'image', mime: 'image/jpeg', caption: 'c' },
      }),
      prepared,
    );
    expect(media).toMatchObject({ recipient_type: 'group', type: 'image' });
    const tpl = buildMessageBody(
      outboundEnvelopeSchema.parse({
        ...common,
        kind: 'template',
        template: { name: 'hello', language: 'en', variables: {} },
      }),
    );
    expect(tpl).toMatchObject({ recipient_type: 'group', type: 'template' });
  });
  it.each([
    ['reaction', { reaction: { providerMessageId: 'wamid.1', emoji: '👍' } }],
    ['interactive', { interactive: { type: 'location_request', body: 'Where are you?' } }],
  ])('%s is refused: Meta does not take it on a group', (kind, extra) => {
    const envelope = outboundEnvelopeSchema.parse({ ...common, kind, ...extra });
    try {
      buildMessageBody(envelope);
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(ChannelError);
      expect((e as ChannelError).code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
      expect((e as ChannelError).retryable).toBe(false);
    }
  });
});

describe('normal phone peers are unchanged (regression, real-looking numbers)', () => {
  it.each([
    ['919876543210', '919876543210'],
    ['+91 98765-43210', '919876543210'],
    ['14155550123', '14155550123'],
    ['+44 7911 123456', '447911123456'],
    ['971501234567', '971501234567'],
  ])('%s is sent to %s as an individual', (to, digits) => {
    expect(metaRecipient(to)).toBe(digits);
    const body = buildMessageBody(
      outboundEnvelopeSchema.parse({
        to,
        clientReference: 'ref-2',
        attempt: 1,
        kind: 'text',
        body: 'hi',
      }),
    );
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digits,
      type: 'text',
      text: { preview_url: false, body: 'hi' },
    });
  });
  it('still refuses a too-short or too-long non-group value with the existing code', () => {
    for (const bad of ['123', '1'.repeat(21)]) {
      try {
        metaRecipient(bad);
        throw new Error('should refuse');
      } catch (e) {
        expect((e as ChannelError).code).toBe('RECIPIENT_NOT_ALLOWED');
      }
    }
  });
  it('the template builder keeps the digits of a phone number', () => {
    expect(
      buildTemplateMessage({
        to: '+91 98765-43210',
        templateName: 'hello',
        language: 'en',
        variables: { '1': 'Ana' },
      } as never),
    ).toMatchObject({ to: '919876543210', type: 'template' });
  });
});

describe('the other Meta builders refuse a group key too', () => {
  it('the template builder (both forms)', () => {
    refuses(() =>
      buildTemplateMessage({
        to: GROUP_KEYS[1]!,
        templateName: 't',
        language: 'en',
        variables: {},
      } as never),
    );
    refuses(() =>
      buildTemplateMessage({
        to: GROUP_KEYS[1]!,
        templateName: 't',
        language: 'en',
        variables: {},
        components: [],
      } as never),
    );
  });
  it('MetaCloudProvider.sendText and sendMessage reject before any Graph call', async () => {
    const guard = { beforeSend: vi.fn(async () => undefined), withFooter: vi.fn(async () => 'hi') };
    const http = { call: vi.fn() };
    const provider = new MetaCloudProvider(http as never, guard as never);
    const creds = { route: 'meta', accessToken: 't', phoneNumberId: 'p' } as never;
    await expect(
      provider.sendText(creds, { to: GROUP_KEYS[0]!, body: 'hi' } as never),
    ).rejects.toMatchObject({
      code: 'WABA_GROUP_SEND_UNAVAILABLE',
    });
    await expect(
      provider.sendMessage(creds, { to: GROUP_KEYS[0]!, type: 'image', body: {} } as never),
    ).rejects.toMatchObject({ code: 'WABA_GROUP_SEND_UNAVAILABLE' });
    expect(http.call).not.toHaveBeenCalled();
  });
});
