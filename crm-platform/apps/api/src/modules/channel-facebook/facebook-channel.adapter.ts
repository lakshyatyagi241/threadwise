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
import { PAGE_NOT_CONNECTED, SenderService, type SendOutcome } from './sender.service';

/** Meta's standard messaging window: a Page may write freely for 24 hours after the person's last message. No templates on Messenger. */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: 24,
  templates: false,
  media: ['image', 'video', 'audio', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

/** Meta fetches the file itself, so the link only has to live long enough for that. */
const MEDIA_LINK_TTL_S = 900;

/**
 * A Facebook Page as an inbox channel (kind `facebook`, one per connected Page, its handle the Page id). Replies go out through
 * `SenderService`, which owns the Graph calls (a Messenger DM, or a public reply under a comment) and flags a Page whose token Meta
 * refused. Inbound does not come through the channel webhook but through the Page webhook (`FacebookPublicController`), so
 * `verifyInbound` is false and `parseInbound` empty.
 */
@Injectable()
export class FacebookChannelAdapter implements ChannelAdapter {
  readonly kind = 'facebook' as const;
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

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    let outcome: SendOutcome;
    if (envelope.kind === 'text') {
      outcome = await this.sender.reply(channel.orgId, {
        rawJid: envelope.to,
        text: envelope.body,
      });
    } else if (envelope.kind === 'media') {
      const link = await this.media?.temporaryPublicLink(
        channel.orgId,
        envelope.media.key,
        MEDIA_LINK_TTL_S,
      );
      if (!link) {
        throw new ChannelError(
          'MEDIA_NOT_REACHABLE',
          'Facebook cannot fetch this file: media storage is not a cloud bucket',
          false,
        );
      }
      outcome = await this.sender.reply(channel.orgId, {
        rawJid: envelope.to,
        text: envelope.media.caption ?? '',
        media: { type: envelope.media.mediaKind, url: link.url },
      });
    } else {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `Facebook cannot send a ${envelope.kind} message`,
        false,
      );
    }
    if (!outcome.ok) {
      const disconnected = outcome.error === PAGE_NOT_CONNECTED;
      throw new ChannelError(
        disconnected ? 'CHANNEL_DISCONNECTED' : 'FACEBOOK_SEND_REJECTED',
        outcome.error ?? 'Facebook rejected the send.',
        false,
      );
    }
    return {
      providerMessageId: outcome.providerMessageId ?? `fb-${envelope.clientReference}`,
      acceptedAt: new Date(),
    };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `providerMediaId` is the address Meta gave for the attachment; the download refuses any host that is not Meta's. */
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
