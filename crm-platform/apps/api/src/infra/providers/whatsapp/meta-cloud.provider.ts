import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WabaHttp, type WabaAuth } from '../whatsapp-cloud-api-waba/waba-http';
import type {
  ChannelCredentials,
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
  SendMessageParams,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WhatsAppProvider,
} from './whatsapp.port';
import { OUTBOUND_SEND_GUARD, type OutboundSendGuard } from './send-guard.port';
import { buildTemplateMessage } from './meta-template-payload';

/** The Graph API normally answers in well under a second; a hung connection must not hold a broadcast worker. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * WhatsApp Cloud API adapter, direct to Meta or through Interakt (`credentials.route`). Both speak the same Cloud API
 * paths; `WabaHttp` picks host, version and auth headers. Errors surface as `WabaApiError` carrying Meta's code, so a caller
 * can classify them (`classifySendError`) instead of matching message text.
 *
 * Signature verification and webhook parsing are real, because getting them wrong is a security issue rather than a
 * missing feature.
 */
@Injectable()
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud';
  private readonly logger = new Logger(MetaCloudProvider.name);

  constructor(
    private readonly http: WabaHttp,
    @Inject(OUTBOUND_SEND_GUARD) private readonly guard: OutboundSendGuard,
  ) {}

  private auth(credentials: ChannelCredentials): WabaAuth {
    if (credentials.registry) return credentials.registry;
    if (credentials.route === 'interakt') {
      if (!credentials.authKey || !credentials.businessAccountId) {
        throw new Error('An Interakt number needs its auth key and WABA id. Reconnect the number.');
      }
      return {
        provider: 'interakt',
        authKey: credentials.authKey,
        wabaId: credentials.businessAccountId,
        phoneNumberId: credentials.senderId,
      };
    }
    return { provider: 'meta', accessToken: credentials.accessToken };
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
    // No footer: approved template content cannot be changed after submission.
    const marketing =
      params.category?.toLowerCase() === 'marketing' && credentials.marketingLite === true;
    return this.post(
      credentials,
      buildTemplateMessage(params),
      marketing ? 'marketing_messages' : 'messages',
    );
  }

  async sendText(credentials: ChannelCredentials, params: SendTextParams): Promise<SendResult> {
    await this.guard.beforeSend({
      body: params.body,
      bulk: params.screen?.bulk,
      source: params.screen?.source,
    });
    // After the screen, so a platform footer is never read as the sender's own words.
    const body = await this.guard.withFooter({ body: params.body });
    return this.post(credentials, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to.replace(/\D+/g, ''),
      type: 'text',
      ...(params.replyToProviderMessageId
        ? { context: { message_id: params.replyToProviderMessageId } }
        : {}),
      text: { preview_url: false, body },
    });
  }

  async sendMessage(
    credentials: ChannelCredentials,
    params: SendMessageParams,
  ): Promise<SendResult> {
    await this.guard.beforeSend({
      body: textOf(params),
      bulk: params.screen?.bulk,
      source: params.screen?.source,
    });
    return this.post(credentials, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to.replace(/\D+/g, ''),
      type: params.type,
      ...(params.replyToProviderMessageId
        ? { context: { message_id: params.replyToProviderMessageId } }
        : {}),
      [params.type]: params.body,
    });
  }

  async markRead(
    credentials: ChannelCredentials,
    providerMessageId: string,
    typing = false,
  ): Promise<void> {
    try {
      await this.http.call(this.auth(credentials), {
        method: 'POST',
        path: `/${credentials.senderId}/messages`,
        json: {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: providerMessageId,
          ...(typing ? { typing_indicator: { type: 'text' } } : {}),
        },
        timeoutMs: SEND_TIMEOUT_MS,
      });
    } catch (err) {
      // A missed read receipt is cosmetic; it must never fail the pipeline that called it.
      this.logger.debug({ providerMessageId, err: (err as Error).message }, 'mark read failed');
    }
  }

  /**
   * The one place a message leaves for Meta or Interakt. Everything before it (halt, guardrails, the footer) is real and runs
   * first, so a pipeline cannot reach here unguarded.
   */
  protected async post(
    credentials: ChannelCredentials,
    payload: Record<string, unknown>,
    endpoint: 'messages' | 'marketing_messages' = 'messages',
  ): Promise<SendResult> {
    const json = await this.http.call<{
      messages?: Array<{ id?: string; message_status?: string }>;
    }>(this.auth(credentials), {
      method: 'POST',
      path: `/${credentials.senderId}/${endpoint}`,
      json: payload,
      timeoutMs: SEND_TIMEOUT_MS,
    });
    const first = json.messages?.[0];
    if (!first?.id) throw new Error('WhatsApp accepted the send but returned no message id');
    // A 200 with message_status "failed" is a rejection that the receipt webhook will repeat; fail it now.
    if (first.message_status === 'failed') throw new Error('WhatsApp rejected the message');
    this.logger.debug({ type: payload.type, providerMessageId: first.id }, 'message sent');
    return { providerMessageId: first.id, acceptedAt: new Date() };
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

/** The words a content filter should see: a caption, a body, a list's text. */
function textOf(p: SendMessageParams): string {
  const b = p.body as { caption?: string; body?: { text?: string } | string };
  if (typeof b.caption === 'string') return b.caption;
  if (typeof b.body === 'string') return b.body;
  return b.body?.text ?? '';
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
