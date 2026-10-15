import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChannelCapabilities } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
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
import { LINE_API, type LineApiFactory } from '../../infra/providers/channel-line/line.port';
import { ChannelsRepository } from './channels.repository';
import { LineTokenService } from './line-token.service';
import {
  CHANNEL_NOT_CONNECTED,
  LineSenderService,
  type Outcome,
  type ThreadReply,
} from './line-sender.service';

/** No 24 hour rule and no templates: an Official Account may write to any friend at any time (a push is billed by LINE). */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

/** LINE fetches a media message itself, and not necessarily at once, so the link has to outlive the send (a week is the longest a signed link lives). */
const MEDIA_LINK_TTL_S = 7 * 24 * 3600;

/**
 * A LINE channel as an inbox channel (kind `line`, one per channel, its handle the channel's row id; the peer is the LINE user id,
 * case kept). Replies go out through `LineSenderService`, from the account that carried the thread. Inbound does not come through
 * the channel webhook but through the channel's own route (`/v2/line/inbound/:token`), so `verifyInbound` is false and `parseInbound`
 * empty.
 */
@Injectable()
export class LineChannelAdapter implements ChannelAdapter {
  readonly kind = 'line' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly sender: LineSenderService,
    private readonly channels: ChannelsRepository,
    private readonly tokens: LineTokenService,
    @Inject(LINE_API) private readonly line: LineApiFactory,
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
      throw new ChannelError('CHANNEL_DISCONNECTED', 'This channel has no LINE account', false);
    }
    return id;
  }

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    const base = { channelRowId: this.channelRowId(channel), to: envelope.to };
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
          'LINE cannot fetch this file: media storage is not a cloud bucket',
          false,
        );
      }
      reply = {
        ...base,
        text: envelope.media.caption ?? '',
        media: { url: link.url, kind: envelope.media.mediaKind },
      };
    } else {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `LINE cannot send a ${envelope.kind} message`,
        false,
      );
    }
    const outcome: Outcome = await this.sender.reply(channel.orgId, reply);
    if (!outcome.ok) {
      throw new ChannelError(
        outcome.error === CHANNEL_NOT_CONNECTED ? 'CHANNEL_DISCONNECTED' : 'LINE_SEND_REJECTED',
        outcome.error ?? 'LINE rejected the send.',
        // A rate limit is worth another try; anything else LINE refused would be refused again.
        outcome.status === 429,
      );
    }
    return {
      providerMessageId: outcome.providerMessageId ?? `line-${envelope.clientReference}`,
      acceptedAt: new Date(),
    };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `providerMediaId` is LINE's message id; the file is downloaded with the channel's own token, which never leaves this call. */
  async fetchMedia(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const row = await this.db.txAs({ orgId: channel.orgId }, (tx) =>
      this.channels.findById(tx, channel.orgId, this.channelRowId(channel)),
    );
    if (!row) throw new ChannelError('CHANNEL_DISCONNECTED', 'LINE channel not connected', false);
    const token = await this.tokens.accessToken(channel.orgId, row);
    const file = await this.line.forToken(token).getMessageContent(media.providerMediaId);
    if (!file)
      throw new ChannelError('MEDIA_DOWNLOAD_FAILED', 'LINE did not return the file', false);
    return {
      bytes: Buffer.from(file.bytes),
      mime: file.mime === 'application/octet-stream' ? media.mime : file.mime,
    };
  }
}
