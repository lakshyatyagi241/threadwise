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

const WEBCHAT_CAPABILITIES: ChannelCapabilities = {
  // A visitor on the page is there now: no 24 hour rule, no templates.
  windowHours: null,
  templates: false,
  media: ['image', 'document'],
  reactions: false,
  editDelete: false,
  receipts: ['sent'],
  typing: true,
};

/**
 * The website chat widget as a channel (its rows are created by the widget domain, one per widget, `external_id` = the widget uuid).
 *
 * A skeleton for now: it makes those channels listable with their real capabilities. Its inbound side is the widget's own public
 * routes, not a provider webhook, so `verifyInbound` is false and `parseInbound` empty; `send` is refused until the widget adapter
 * (plan-inbox-chat.md Phase 2) stores the reply for the visitor's poll, and `live` stays false until then.
 */
export class WebchatChannelAdapter implements ChannelAdapter {
  readonly kind = 'webchat' as const;
  readonly live = false;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return { ...WEBCHAT_CAPABILITIES, media: [...WEBCHAT_CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(WEBCHAT_CAPABILITIES.windowHours, lastInboundAt, now);
  }

  send(_channel: ChannelRuntime, _envelope: OutboundEnvelope): Promise<SendResult> {
    return Promise.reject(
      new ChannelError(
        'CHANNEL_NOT_LIVE',
        'Replying through the web chat widget is not enabled yet',
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
