import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../../config/env.schema';
import type {
  ChannelCredentials,
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WhatsAppProvider,
} from './whatsapp.port';
import { OUTBOUND_SEND_GUARD, type OutboundSendGuard } from './send-guard.port';

/**
 * Meta WhatsApp Cloud API adapter.
 *
 * Send methods are stubbed until channel credential storage lands; the
 * signature verification and webhook parsing are real, because those are what
 * the inbound path needs first and getting them wrong is a security issue
 * rather than a missing feature.
 */
@Injectable()
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud';
  private readonly logger = new Logger(MetaCloudProvider.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(OUTBOUND_SEND_GUARD) private readonly guard: OutboundSendGuard,
  ) {}

  private baseUrl(credentials: ChannelCredentials): string {
    const version = this.config.get('META_GRAPH_VERSION', { infer: true });
    return `https://graph.facebook.com/${version}/${credentials.senderId}/messages`;
  }

  async sendTemplate(
    credentials: ChannelCredentials,
    params: SendTemplateParams,
  ): Promise<SendResult> {
    await this.guard.beforeSend({
      body: Object.values(params.variables).join(' '),
      bulk: params.screen?.bulk,
      source: params.screen?.source,
    });
    this.logger.warn(
      { to: params.to, template: params.templateName, url: this.baseUrl(credentials) },
      'sendTemplate not implemented yet — broadcast pipeline lands with the Broadcast module',
    );
    throw new Error('MetaCloudProvider.sendTemplate is not implemented');
  }

  async sendText(credentials: ChannelCredentials, params: SendTextParams): Promise<SendResult> {
    await this.guard.beforeSend({
      body: params.body,
      bulk: params.screen?.bulk,
      source: params.screen?.source,
    });
    this.logger.warn(
      { to: params.to, url: this.baseUrl(credentials) },
      'sendText not implemented yet — inbox reply pipeline lands with the Inbox module',
    );
    throw new Error('MetaCloudProvider.sendText is not implemented');
  }

  /**
   * Meta signs the raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`.
   *
   * Two things this gets right that naive implementations get wrong:
   *  1. it hashes the RAW body, not the re-serialised JSON (key order and
   *     whitespace change the digest)
   *  2. it compares in constant time, so the comparison cannot be used as an
   *     oracle to guess the signature byte by byte
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;

    const expected = createHmac('sha256', appSecret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
    } catch {
      return false;
    }

    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  }

  parseWebhook(payload: unknown): {
    deliveryEvents: NormalisedDeliveryEvent[];
    inboundMessages: NormalisedInboundMessage[];
  } {
    const deliveryEvents: NormalisedDeliveryEvent[] = [];
    const inboundMessages: NormalisedInboundMessage[] = [];

    const body = payload as {
      entry?: Array<{ changes?: Array<{ value?: MetaChangeValue }> }>;
    };

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        for (const status of value.statuses ?? []) {
          const event = META_STATUS_MAP[status.status];
          if (!event) continue;
          deliveryEvents.push({
            providerMessageId: status.id,
            event,
            occurredAt: new Date(Number(status.timestamp) * 1000),
            errorCode: status.errors?.[0]?.code?.toString(),
            raw: status,
          });
        }

        for (const message of value.messages ?? []) {
          inboundMessages.push({
            providerMessageId: message.id,
            from: `+${message.from.replace(/^\+/, '')}`,
            kind: META_MESSAGE_KIND_MAP[message.type] ?? 'text_message',
            content: (message as unknown as Record<string, unknown>) ?? {},
            occurredAt: new Date(Number(message.timestamp) * 1000),
            raw: message,
          });
        }
      }
    }

    return { deliveryEvents, inboundMessages };
  }
}

const META_STATUS_MAP: Record<string, NormalisedDeliveryEvent['event'] | undefined> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

const META_MESSAGE_KIND_MAP: Record<string, NormalisedInboundMessage['kind'] | undefined> = {
  text: 'text_message',
  image: 'media',
  video: 'media',
  audio: 'media',
  document: 'media',
  sticker: 'media',
  interactive: 'interactive',
  button: 'interactive',
  location: 'location',
};

interface MetaChangeValue {
  statuses?: Array<{
    id: string;
    status: string;
    timestamp: string;
    errors?: Array<{ code: number; title?: string }>;
  }>;
  messages?: Array<{
    id: string;
    from: string;
    type: string;
    timestamp: string;
  }>;
}
