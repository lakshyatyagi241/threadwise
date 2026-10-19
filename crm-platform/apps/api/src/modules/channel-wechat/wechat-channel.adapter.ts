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
import {
  WECHAT_API,
  WECHAT_TEXT_LIMIT,
  type WechatApi,
  type WechatMessage,
  type WechatResult,
  type WechatUploadType,
} from '../../infra/providers/channel-wechat/wechat.port';
import { ChannelsRepository } from './channels.repository';
import { WechatAvailabilityService } from './wechat-availability.service';
import { WechatTokenService } from './wechat-token.service';
import { WINDOW_HOURS, clipText } from './wechat-rules';

/** A customer-service message is allowed for 48 hours after the follower's last message; a Template Message is the one way outside it. */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: WINDOW_HOURS,
  templates: true,
  media: ['image', 'audio', 'video'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

/** WeChat takes up to 10 MB of temporary image or video; a larger stored file is refused here rather than read into memory. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UPLOAD_TYPE: Record<'image' | 'audio' | 'video', WechatUploadType> = {
  image: 'image',
  audio: 'voice',
  video: 'video',
};

async function readAll(stream: AsyncIterable<unknown>, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** WeChat's refusals, in our vocabulary. -1 is "system busy": the only one worth another try. */
function refusal(res: WechatResult<unknown>): ChannelError {
  const message = res.error ?? 'WeChat rejected the send.';
  if (res.errcode === 45015 || res.errcode === 45047) {
    return new ChannelError('WECHAT_WINDOW_CLOSED', message, false, {
      providerCode: String(res.errcode),
    });
  }
  if (res.errcode === 43004 || res.errcode === 40003) {
    return new ChannelError('WECHAT_NOT_FOLLOWING', message, false, {
      providerCode: String(res.errcode),
    });
  }
  return new ChannelError('WECHAT_SEND_REJECTED', message, res.errcode === -1, {
    providerCode: res.errcode === null ? null : String(res.errcode),
  });
}

/**
 * An Official Account as an inbox channel (kind `wechat`, one per channel, its handle the channel's row id; the peer is the follower's
 * OpenID). A reply typed in the inbox goes out as a customer-service message from the account that carried the thread, within the 48
 * hour window; outside it only a template message is allowed (the dispatcher refuses everything else before it reaches this class).
 * Inbound does not come through the channel webhook but through the account's own route (`/v2/wechat/inbound/:token`), so `verifyInbound`
 * is false and `parseInbound` empty.
 */
@Injectable()
export class WechatChannelAdapter implements ChannelAdapter {
  readonly kind = 'wechat' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelsRepository,
    private readonly tokens: WechatTokenService,
    private readonly availability: WechatAvailabilityService,
    @Inject(WECHAT_API) private readonly wechat: WechatApi,
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

  private rowId(channel: ChannelRuntime): number {
    const id = Number(channel.externalId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ChannelError('CHANNEL_DISCONNECTED', 'This channel has no WeChat account', false);
    }
    return id;
  }

  /** The account that carried the thread must still be connected and switched on. */
  private async connectedRow(channel: ChannelRuntime): Promise<number> {
    const id = this.rowId(channel);
    const { row, availability } = await this.db.txAs({ orgId: channel.orgId }, async (tx) => ({
      row: await this.channels.findById(tx, channel.orgId, id),
      availability: await this.availability.forOrg(tx, channel.orgId),
    }));
    if (!row?.active) {
      throw new ChannelError('CHANNEL_DISCONNECTED', 'WeChat channel not connected', false);
    }
    // A workspace in a blocked country sends nothing, even on a channel that was connected before the rule.
    if (!availability.available) {
      throw new ChannelError(
        'CHANNEL_UNAVAILABLE',
        'WeChat is not available in your country',
        false,
      );
    }
    return id;
  }

  private async push(
    channel: ChannelRuntime,
    id: number,
    openid: string,
    message: WechatMessage,
  ): Promise<void> {
    const res = await this.tokens.call(channel.orgId, id, (token) =>
      this.wechat.sendCustomMessage(token, openid, message),
    );
    if (!res.ok) throw refusal(res);
  }

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    const id = await this.connectedRow(channel);
    const to = envelope.to;

    if (envelope.kind === 'text') {
      await this.push(channel, id, to, {
        msgtype: 'text',
        text: { content: clipText(envelope.body, WECHAT_TEXT_LIMIT) },
      });
    } else if (envelope.kind === 'media') {
      const kind = envelope.media.mediaKind;
      if (kind !== 'image' && kind !== 'audio' && kind !== 'video') {
        throw new ChannelError(
          'CHANNEL_CAPABILITY_UNSUPPORTED',
          `WeChat cannot send a ${kind} file`,
          false,
        );
      }
      const opened = await this.media?.open(channel.orgId, envelope.media.key);
      const bytes = opened ? await readAll(opened.stream, MAX_UPLOAD_BYTES) : null;
      if (!bytes) {
        throw new ChannelError(
          'MEDIA_NOT_REACHABLE',
          'The file could not be read, or it is larger than WeChat accepts',
          false,
        );
      }
      const up = await this.tokens.call(channel.orgId, id, (token) =>
        this.wechat.uploadMedia(token, UPLOAD_TYPE[kind], bytes, envelope.media.name ?? 'file'),
      );
      const mediaId = up.ok ? up.data.media_id : undefined;
      if (!mediaId) throw refusal(up);
      // A WeChat media message carries no caption: it goes first as its own text message (Reference).
      const caption = envelope.media.caption?.trim();
      if (caption) {
        await this.push(channel, id, to, {
          msgtype: 'text',
          text: { content: clipText(caption, WECHAT_TEXT_LIMIT) },
        });
      }
      await this.push(
        channel,
        id,
        to,
        kind === 'image'
          ? { msgtype: 'image', image: { media_id: mediaId } }
          : kind === 'audio'
            ? { msgtype: 'voice', voice: { media_id: mediaId } }
            : { msgtype: 'video', video: { media_id: mediaId, thumb_media_id: mediaId } },
      );
    } else if (envelope.kind === 'template') {
      // WeChat's template message: `name` is the account's template id, each variable one keyword of it (`url` is the link).
      const { url, ...keywords } = envelope.template.variables;
      const data = Object.fromEntries(Object.entries(keywords).map(([k, v]) => [k, { value: v }]));
      const res = await this.tokens.call(channel.orgId, id, (token) =>
        this.wechat.sendTemplate(token, to, envelope.template.name, data, url),
      );
      if (!res.ok) throw refusal(res);
    } else {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `WeChat cannot send a ${envelope.kind} message`,
        false,
      );
    }
    return { providerMessageId: `wx:${envelope.clientReference}`, acceptedAt: new Date() };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `providerMediaId` is WeChat's media id; it is downloaded with the account's own access token, which never leaves this call. */
  async fetchMedia(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const id = this.rowId(channel);
    const token = await this.tokens.activeToken(channel.orgId, id);
    if (!token) {
      throw new ChannelError('CHANNEL_DISCONNECTED', 'WeChat channel not connected', false);
    }
    const file = await this.wechat.getMedia(token, media.providerMediaId);
    if (!file) {
      throw new ChannelError('MEDIA_DOWNLOAD_FAILED', 'WeChat did not return the file', false);
    }
    return { bytes: Buffer.from(file.bytes), mime: file.mime || media.mime };
  }
}
