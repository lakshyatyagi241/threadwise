import {
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type OutboundEnvelope,
  type SendResult,
} from '../../../src/infra/providers/chat-conversations';

/**
 * A stand-in for the real email adapter (owned by the channel-email module): the capabilities the seam contract fixes for kind `email`
 * (no window, no templates, no media, `sent` receipts only), and a `send` that records the envelope it was given.
 */
export class FakeEmailAdapter implements ChannelAdapter {
  readonly kind = 'email' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields: readonly string[] = [];
  sent: OutboundEnvelope[] = [];

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
      receipts: ['sent' as const],
      typing: false,
    };
  }
  windowInfo(_c: ChannelRuntime, lastInboundAt: Date | null, now: Date) {
    return windowFromLastInbound(null, lastInboundAt, now);
  }
  async send(_c: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    this.sent.push(envelope);
    return { providerMessageId: `fake-email-${this.sent.length}`, acceptedAt: new Date() };
  }
  verifyInbound(): boolean {
    return false;
  }
  parseInbound() {
    return { messages: [], receipts: [] };
  }
}
