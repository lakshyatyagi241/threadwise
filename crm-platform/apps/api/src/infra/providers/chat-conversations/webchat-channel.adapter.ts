import type { ChannelCapabilities } from '@crm/contracts';
import type { ChatMediaStore } from './media';
import {
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type InboundMedia,
  type OutboundEnvelope,
  type ParsedInbound,
  type SendResult,
  type WindowInfo,
} from './channel.port';

const WEBCHAT_CAPABILITIES: ChannelCapabilities = {
  // A visitor on the page is there now: no 24 hour rule, no templates.
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: true,
};

/**
 * The website chat widget as a channel (its rows are created by the widget domain, one per widget, `external_id` = the widget uuid).
 *
 * Its inbound side is the widget's own public routes, not a provider webhook, so `verifyInbound` is false and `parseInbound` empty.
 * Sending a reply has nothing to hand over to a provider: the dispatcher's caller stores the line on the thread, and the visitor's open
 * widget picks it up on its next poll. So `send` only accepts the message. `live` stays false: an operator cannot connect or
 * disconnect a widget channel by hand, its status follows the widget.
 */
export class WebchatChannelAdapter implements ChannelAdapter {
  readonly kind = 'webchat' as const;
  readonly live = false;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(private readonly store?: ChatMediaStore) {}

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return { ...WEBCHAT_CAPABILITIES, media: [...WEBCHAT_CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(WEBCHAT_CAPABILITIES.windowHours, lastInboundAt, now);
  }

  send(_channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    // The client reference is unique per message, so it doubles as the id the thread's ledger keeps.
    return Promise.resolve({
      providerMessageId: `web:${envelope.clientReference}`,
      acceptedAt: new Date(),
    });
  }

  /**
   * A file the visitor attached: the widget's upload route staged it in the media store (checked there) and names its key; ingest reads
   * the bytes back here and stores the final copy, so the same content check and size limit run again. The staged copy is removed once
   * it has been read.
   */
  async fetchMedia(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const opened = await this.store?.open(channel.orgId, media.providerMediaId);
    if (!opened) throw new Error('The attached file is gone');
    const chunks: Buffer[] = [];
    for await (const c of opened.stream) chunks.push(Buffer.from(c as Buffer));
    await this.store?.remove(channel.orgId, media.providerMediaId).catch(() => undefined);
    return { bytes: Buffer.concat(chunks), mime: media.mime };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }
}
