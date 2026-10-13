import { describe, expect, it } from 'vitest';
import { sendMessageSchema } from '@crm/contracts';
import { outboundEnvelopeSchema } from '../../../src/infra/providers/chat-conversations/channel.port';
import {
  envelopeOf,
  messageFieldsOf,
} from '../../../src/modules/chat-conversations/outbound-envelope';

const cid = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const target = '0a5c1d92-1f64-4f9b-8a0e-0e8b6f5a77f1';

const row = (body: string | null) => ({
  kind: 'reaction' as const,
  body,
  mediaKey: null,
  mediaMime: null,
  mediaName: null,
  mediaSha256: null,
  latitude: null,
  longitude: null,
  meta: {},
  clientMessageId: cid,
  uuid: cid,
});

describe('send body: reaction', () => {
  it('takes a target message and an emoji', () => {
    const ok = sendMessageSchema.safeParse({
      kind: 'reaction',
      clientMessageId: cid,
      targetMessageId: target,
      emoji: '👍',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts an empty emoji (remove the reaction) and refuses a missing or non-uuid target', () => {
    const base = { kind: 'reaction', clientMessageId: cid };
    expect(
      sendMessageSchema.safeParse({ ...base, targetMessageId: target, emoji: '' }).success,
    ).toBe(true);
    expect(sendMessageSchema.safeParse({ ...base, emoji: '👍' }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ ...base, targetMessageId: 'nope', emoji: '👍' }).success,
    ).toBe(false);
  });

  it('refuses an emoji field longer than a reaction can be', () => {
    expect(
      sendMessageSchema.safeParse({
        kind: 'reaction',
        clientMessageId: cid,
        targetMessageId: target,
        emoji: 'x'.repeat(17),
      }).success,
    ).toBe(false);
  });
});

describe('a reaction as a stored message', () => {
  it('is a reaction row whose body is the emoji, with no media', () => {
    expect(messageFieldsOf({ kind: 'reaction', emoji: ' 🔥 ' })).toMatchObject({
      kind: 'reaction',
      body: '🔥',
      media: null,
    });
  });

  it('stores a removed reaction with no body', () => {
    expect(messageFieldsOf({ kind: 'reaction', emoji: '' }).body).toBeNull();
  });

  it('becomes a provider envelope that points at the target and passes the channel port schema', () => {
    const envelope = envelopeOf(row('👍'), '919999999999', 'wamid.TARGET', 1);
    const parsed = outboundEnvelopeSchema.parse(envelope);
    expect(parsed).toMatchObject({
      kind: 'reaction',
      reaction: { providerMessageId: 'wamid.TARGET', emoji: '👍' },
    });
  });

  it('sends an empty emoji to remove the reaction', () => {
    const parsed = outboundEnvelopeSchema.parse(
      envelopeOf(row(null), '919999999999', 'wamid.TARGET', 1),
    );
    expect(parsed).toMatchObject({ reaction: { emoji: '' } });
  });

  it('cannot be built without a message the provider knows', () => {
    expect(() => envelopeOf(row('👍'), '919999999999', null, 1)).toThrow();
  });
});
