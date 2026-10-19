import { Injectable, Optional } from '@nestjs/common';
import type { ChannelCapabilities } from '@crm/contracts';
import {
  ChannelError,
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type InboundMedia,
  type OutboundEnvelope,
  type ParsedInbound,
  type SendResult,
  type WindowInfo,
} from '../../infra/providers/chat-conversations/channel.port';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media/chat-media.store';
import {
  ViberMediaDownloadError,
  downloadViberMedia,
} from '../../infra/providers/channel-viber/viber-media-download';
import {
  CHANNEL_NOT_CONNECTED,
  ViberSenderService,
  type ThreadReply,
} from './viber-sender.service';

/** No 24 hour rule and no templates: once a user has subscribed, the account may write to them at any time. */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent', 'delivered', 'read'],
  typing: false,
};

/** Viber fetches the file itself, so the link only has to live long enough for that. */
const MEDIA_LINK_TTL_S = 900;

/**
 * A Viber Public Account as an inbox channel (kind `viber`, one per channel, its handle the channel row id; the peer is the Viber user
 * id). Replies go out through `ViberSenderService`, from the account that carried the thread. Inbound does not come through the channel
 * webhook but through the account's own route (`/v2/viber/inbound/:token`), so `verifyInbound` is false and `parseInbound` empty.
 */
@Injectable()
export class ViberChannelAdapter implements ChannelAdapter {
  readonly kind = 'viber' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly sender: ViberSenderService,
    /** Present where files are handled (the worker sends them). */
    @Optional() private readonly media?: ChatMediaStore,
  ) {}

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return { ...CAPABILITIES, media: [...CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(CAPABILITIES.windowHours, lastInboundAt, now);
  }

  private channelRowId(channel: ChannelRuntime): number {
    const id = Number(channel.externalId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ChannelError('CHANNEL_DISCONNECTED', 'This channel has no Viber account', false);
    }
    return id;
  }

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    const base = { channelRowId: this.channelRowId(channel), userId: envelope.to };
    let reply: ThreadReply;
    if (envelope.kind === 'text') {
      reply = { ...base, text: envelope.body };
    } else if (envelope.kind === 'media') {
      const link = await this.media?.temporaryPublicLink(
        channel.orgId,
        envelope.media.key,
        MEDIA_LINK_TTL_S,
      );
      if (!link) {
        throw new ChannelError(
          'MEDIA_NOT_REACHABLE',
          'Viber cannot fetch this file: media storage is not a cloud bucket',
          false,
        );
      }
      const opened = await this.media?.open(channel.orgId, envelope.media.key);
      opened?.stream.destroy();
      reply = {
        ...base,
        text: envelope.media.caption ?? '',
        media: {
          kind: envelope.media.mediaKind === 'sticker' ? 'image' : envelope.media.mediaKind,
          url: link.url,
          size: opened?.size ?? 1,
          name: envelope.media.name ?? 'file',
        },
      };
    } else {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `Viber cannot send a ${envelope.kind} message`,
        false,
      );
    }
    const outcome = await this.sender.reply(channel.orgId, reply);
    if (!outcome.ok) {
      throw new ChannelError(
        outcome.error === CHANNEL_NOT_CONNECTED ? 'CHANNEL_DISCONNECTED' : 'VIBER_SEND_REJECTED',
        outcome.error ?? 'Viber rejected the send.',
        false,
      );
    }
    return {
      providerMessageId: outcome.providerMessageId ?? `viber-${envelope.clientReference}`,
      acceptedAt: new Date(),
    };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `providerMediaId` is the address Viber gave for the file; the download refuses any host that is not Viber's. */
  async fetchMedia(
    _channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    try {
      return await downloadViberMedia(media.providerMediaId);
    } catch (err) {
      if (err instanceof ViberMediaDownloadError) {
        throw new ChannelError('MEDIA_DOWNLOAD_FAILED', err.message, false);
      }
      throw err;
    }
  }
}
