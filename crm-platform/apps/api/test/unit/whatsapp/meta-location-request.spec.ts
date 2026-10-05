import { describe, expect, it } from 'vitest';
import { outboundEnvelopeSchema } from '../../../src/infra/providers/chat-conversations/channel.port';
import { buildMessageBody } from '../../../src/infra/providers/whatsapp/meta-outbound';

/** The WhatsApp "send location" request the Ask for location node sends on the Cloud API (TW-FLB-095). */
describe('location request message', () => {
  const envelope = outboundEnvelopeSchema.parse({
    to: '919800000001',
    clientReference: 'flow:x:1:0',
    kind: 'interactive',
    interactive: { type: 'location_request', body: 'Where are you?' },
  });

  it('is accepted by the outbound envelope schema', () => {
    expect(envelope.kind).toBe('interactive');
  });

  it('an empty or over-long body is refused', () => {
    const bad = (body: string) =>
      outboundEnvelopeSchema.safeParse({
        to: '919800000001',
        clientReference: 'r',
        kind: 'interactive',
        interactive: { type: 'location_request', body },
      }).success;
    expect(bad('')).toBe(false);
    expect(bad('x'.repeat(1025))).toBe(false);
    expect(bad('x'.repeat(1024))).toBe(true);
  });

  it("becomes Meta's location_request_message with the send_location action", () => {
    expect(buildMessageBody(envelope)).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: 'Where are you?' },
        action: { name: 'send_location' },
      },
    });
  });
});
