import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChannelCapabilities } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
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
  TELEGRAM_API,
  type MediaKind,
  type TelegramApiFactory,
} from '../../infra/providers/channel-telegram/telegram.port';
import { BotsRepository } from './bots.repository';
import {
  BOT_NOT_CONNECTED,
  TelegramSenderService,
  type ThreadReply,
} from './telegram-sender.service';
import type { Outcome } from './chat-send';

/** No 24 hour rule and no templates: a bot may write to a chat that has started it, at any time. */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
};

const KIND_OF: Record<'image' | 'video' | 'audio' | 'document' | 'sticker', MediaKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
};

/** Telegram accepts up to 50 MB through the bot API; a larger stored file is refused here rather than read into memory. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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

/**
 * A Telegram bot as an inbox channel (kind `telegram`, one per bot, its handle the bot's row id; the peer is the chat id). Replies go
 * out through `TelegramSenderService`, from the bot that carried the thread. Inbound does not come through the channel webhook but
 * through the bot's own route (`/v2/telegram/inbound/:token`), so `verifyInbound` is false and `parseInbound` empty. It replaces the
 * chat-conversations skeleton of the same kind, which refused every send.
 */
@Injectable()
export class TelegramChannelAdapter implements ChannelAdapter {
  readonly kind = 'telegram' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly sender: TelegramSenderService,
    private readonly bots: BotsRepository,
    private readonly crypto: CryptoService,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApiFactory,
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

  private botRowId(channel: ChannelRuntime): number {
    const id = Number(channel.externalId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ChannelError('CHANNEL_DISCONNECTED', 'This channel has no Telegram bot', false);
    }
    return id;
  }

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    const base = { botRowId: this.botRowId(channel), chatId: envelope.to };
    let reply: ThreadReply;
    if (envelope.kind === 'text') {
      reply = { ...base, text: envelope.body };
    } else if (envelope.kind === 'media') {
      const opened = await this.media?.open(channel.orgId, envelope.media.key);
      const bytes = opened ? await readAll(opened.stream, MAX_UPLOAD_BYTES) : null;
      if (!bytes) {
        throw new ChannelError(
          'MEDIA_NOT_REACHABLE',
          'The file could not be read, or it is larger than Telegram accepts',
          false,
        );
      }
      reply = {
        ...base,
        text: envelope.media.caption ?? '',
        media: {
          kind: KIND_OF[envelope.media.mediaKind],
          source: { bytes, filename: envelope.media.name ?? 'file' },
        },
      };
    } else {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `Telegram cannot send a ${envelope.kind} message`,
        false,
      );
    }
    const outcome: Outcome = await this.sender.reply(channel.orgId, reply);
    if (!outcome.ok) {
      throw new ChannelError(
        outcome.error === BOT_NOT_CONNECTED ? 'CHANNEL_DISCONNECTED' : 'TELEGRAM_SEND_REJECTED',
        outcome.error ?? 'Telegram rejected the send.',
        false,
      );
    }
    return {
      providerMessageId: `${envelope.to}:${outcome.providerMessageId ?? envelope.clientReference}`,
      acceptedAt: new Date(),
    };
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `providerMediaId` is Telegram's file id; it is downloaded with the bot's own token, which never leaves this call. */
  async fetchMedia(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const bot = await this.db.txAs({ orgId: channel.orgId }, (tx) =>
      this.bots.findById(tx, channel.orgId, this.botRowId(channel)),
    );
    if (!bot) throw new ChannelError('CHANNEL_DISCONNECTED', 'Telegram bot not connected', false);
    const file = await this.telegram
      .forToken(this.crypto.decrypt(bot.botToken))
      .downloadFile(media.providerMediaId);
    if (!file)
      throw new ChannelError('MEDIA_DOWNLOAD_FAILED', 'Telegram did not return the file', false);
    return {
      bytes: Buffer.from(file.bytes),
      mime: MIME_BY_EXTENSION[file.extension.toLowerCase()] ?? media.mime,
    };
  }
}
