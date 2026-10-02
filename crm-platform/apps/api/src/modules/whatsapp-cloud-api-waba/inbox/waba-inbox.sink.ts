import { Injectable } from '@nestjs/common';
import type { NormalisedInbound } from '../../../infra/providers/chat-conversations/channel.port';
import type {
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
} from '../../../infra/providers/whatsapp/whatsapp.port';
import { ChannelIngestPublisher } from '../../chat-conversations';
import type { InboundContext, WabaInboundSink } from '../waba-inbound-sink';
import { WabaChannelSync } from './waba-channel-sync.service';

interface MetaMessage {
  type?: string;
  text?: { body?: string };
  context?: { id?: string };
  reaction?: { message_id?: string; emoji?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string; description?: string };
  };
  button?: { text?: string };
  [media: string]: unknown;
}

const MEDIA = new Set(['image', 'video', 'audio', 'document', 'sticker']);

/**
 * Maps one Cloud API message (the raw object Meta sent) to the inbox's normalised message. Pure: no database, no network.
 * A kind the inbox does not show yet arrives as `unsupported` (it is stored as a placeholder, never dropped).
 */
export function toInbound(
  message: NormalisedInboundMessage,
  contactName: string | null,
): NormalisedInbound {
  const m = (message.raw ?? message.content) as MetaMessage;
  const base = {
    providerMessageId: message.providerMessageId,
    peerKey: message.from.replace(/\D+/g, ''),
    ...(contactName ? { peerName: contactName } : {}),
    providerTimestamp: message.occurredAt,
    ...(m.context?.id ? { replyToProviderMessageId: m.context.id } : {}),
  };
  const type = m.type ?? '';
  if (type === 'text') return { ...base, kind: 'text', body: m.text?.body ?? '' };
  if (MEDIA.has(type)) {
    const file = m[type] as
      | { id?: string; mime_type?: string; filename?: string; caption?: string }
      | undefined;
    if (file?.id) {
      return {
        ...base,
        kind: 'media',
        ...(file.caption ? { body: file.caption } : {}),
        media: {
          providerMediaId: file.id,
          mediaKind: type as 'image' | 'video' | 'audio' | 'document' | 'sticker',
          mime: file.mime_type ?? 'application/octet-stream',
          ...(file.filename ? { name: file.filename } : {}),
        },
      };
    }
  }
  if (type === 'location' && m.location) {
    const { latitude, longitude, name, address } = m.location;
    return {
      ...base,
      kind: 'location',
      location: { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) },
    };
  }
  if (type === 'reaction') {
    return {
      ...base,
      kind: 'reaction',
      reactionEmoji: m.reaction?.emoji ?? '',
      ...(m.reaction?.message_id ? { replyToProviderMessageId: m.reaction.message_id } : {}),
    };
  }
  if (type === 'interactive' || type === 'button') {
    const title =
      m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.button?.text;
    return { ...base, kind: 'interactive', ...(title ? { body: title } : {}) };
  }
  if (type === 'contacts') {
    const names = (m.contacts ?? []).map((c) => c.name?.formatted_name).filter(Boolean);
    return { ...base, kind: 'contact', ...(names.length ? { body: names.join(', ') } : {}) };
  }
  return { ...base, kind: 'unsupported' };
}

/**
 * The inbox is where inbound WhatsApp Cloud API traffic lands (TW-WABA-034, 037): a customer message becomes a thread, a contact
 * and a stored message through the inbox's own ingest queue, and a delivery report the broadcasts did not claim advances the
 * inbox message it belongs to. Bound to `WABA_INBOUND_SINK` in place of the logging default.
 */
@Injectable()
export class WabaInboxSink implements WabaInboundSink {
  constructor(
    private readonly channels: WabaChannelSync,
    private readonly publisher: ChannelIngestPublisher,
  ) {}

  async onMessage(ctx: InboundContext, message: NormalisedInboundMessage): Promise<void> {
    const channel = await this.channels.ensure(ctx.orgId, ctx.configUuid);
    // A number that is not ours to show (removed between the webhook and now) has nowhere to put the message.
    if (!channel) return;
    await this.publisher.enqueueInbound(
      ctx.orgId,
      channel,
      toInbound(message, ctx.contactName),
    );
  }

  async onStatus(ctx: InboundContext, event: NormalisedDeliveryEvent): Promise<void> {
    const channel = await this.channels.ensure(ctx.orgId, ctx.configUuid);
    if (!channel || event.event === 'clicked') return;
    const first = (
      event.raw as {
        errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
      }
    ).errors?.[0];
    await this.publisher.enqueueReceipt(ctx.orgId, channel, {
      providerMessageId: event.providerMessageId,
      status: event.event,
      at: event.occurredAt,
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...(first ? { errorMessage: first.error_data?.details ?? first.message ?? first.title } : {}),
    });
  }
}
