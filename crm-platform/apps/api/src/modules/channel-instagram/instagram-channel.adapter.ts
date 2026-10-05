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
  SocialMediaDownloadError,
  downloadSocialMedia,
} from '../../infra/providers/social-media/guarded-download';
import { SenderService, type SendOutcome } from './sender.service';

/**
 * No window rule here: Instagram's own 24 hour rule is enforced by the engine and shown as its error (Reference behaviour), so the inbox
 * does not refuse a reply the engine might still accept. No templates: a reply is text or one file.
 */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

/** The engine fetches the file itself, so the link only has to live long enough for that. */
const MEDIA_LINK_TTL_S = 900;

/**
 * An Instagram account as an inbox channel (kind `instagram`, one per linked account, its handle the engine's account id). Replies go
 * out through `SenderService` to the engine bridge. Inbound does not come through the channel webhook but through the Instaflow push
 * and the pull sweep, so `verifyInbound` is false and `parseInbound` empty.
 */
@Injectable()
export class InstagramChannelAdapter implements ChannelAdapter {
  readonly kind = 'instagram' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly sender: SenderService,
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

  async send(_channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    let outcome: SendOutcome;
    if (envelope.kind === 'text') {
      outcome = await this.sender.reply({ rawJid: envelope.to, text: envelope.body });
    } else if (envelope.kind === 'media') {
      const link = await this.media?.temporaryPublicLink(
        _channel.orgId,
        envelope.media.key,
        MEDIA_LINK_TTL_S,
      );
      if (!link) {
        throw new ChannelError(
          'MEDIA_NOT_REACHABLE',
          'Instagram cannot fetch this file: media storage is not a cloud bucket',
          false,
        );
      }
      outcome = await this.sender.reply({
        rawJid: envelope.to,
        text: envelope.media.caption ?? '',
        media: { type: envelope.media.mediaKind, url: link.url },
      });
    } else {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `Instagram cannot send a ${envelope.kind} message`,
        false,
      );
    }
    if (!outcome.ok) {
      throw new ChannelError(
        'INSTAGRAM_SEND_REJECTED',
        outcome.error ?? 'Instagram rejected the send.',
        false,
      );
    }
    return {
      providerMessageId: outcome.providerMessageId ?? `ig-${envelope.clientReference}`,
      acceptedAt: new Date(),
    };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `providerMediaId` is the address the engine gave for the attachment; the download refuses any host that is not Meta's. */
  async fetchMedia(
    _channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    try {
      return await downloadSocialMedia(media.providerMediaId);
    } catch (err) {
      if (err instanceof SocialMediaDownloadError) {
        throw new ChannelError('MEDIA_DOWNLOAD_FAILED', err.message, false);
      }
      throw err;
    }
  }
}
