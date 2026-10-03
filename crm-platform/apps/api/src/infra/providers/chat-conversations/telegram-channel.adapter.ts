import type { ChannelCapabilities } from '@crm/contracts';
import {
  ChannelError,
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type OutboundEnvelope,
  type ParsedInbound,
  type SendResult,
  type WindowInfo,
} from './channel.port';

const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  // No 24 hour rule and no templates: a bot may write to a chat that has started it, at any time.
  windowHours: null,
  templates: false,
  media: ['image', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: false,
};

/**
 * A Telegram bot as a channel (its rows are created by the Telegram domain on a bot's first thread, one per bot, `external_id` = the
 * bot's row id).
 *
 * A skeleton for now: it makes those channels listable with their real capabilities. Its inbound side is the bot's own webhook route
 * (`/v2/telegram/inbound/:token`), not the channel webhook, so `verifyInbound` is false and `parseInbound` empty; replies from the
 * inbox are refused until the Telegram sender is bound here, and `live` stays false until then.
 */
export class TelegramChannelAdapter implements ChannelAdapter {
  readonly kind = 'telegram' as const;
  readonly live = false;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return { ...TELEGRAM_CAPABILITIES, media: [...TELEGRAM_CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(TELEGRAM_CAPABILITIES.windowHours, lastInboundAt, now);
  }

  send(_channel: ChannelRuntime, _envelope: OutboundEnvelope): Promise<SendResult> {
    return Promise.reject(
      new ChannelError(
        'CHANNEL_NOT_LIVE',
        'Replying to a Telegram chat from the inbox is not enabled yet',
        false,
      ),
    );
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }
}
