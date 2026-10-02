import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChannelCapabilities } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
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
} from '../../../infra/providers/chat-conversations/channel.port';
import { ChatMediaStore } from '../../../infra/providers/chat-conversations/media/chat-media.store';
import { WabaApiError, classifySendError } from '../../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import {
  WabaHttp,
  type WabaAuth,
} from '../../../infra/providers/whatsapp-cloud-api-waba/waba-http';
import type { WabaConnection } from '../../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WHATSAPP_PROVIDER,
  type ChannelCredentials,
  type SendResult as ProviderSendResult,
  type WhatsAppProvider,
} from '../../../infra/providers/whatsapp/whatsapp.port';
import { WabaConnectService } from '../waba-connect.service';

/** The 24-hour customer-service window applies, templates are allowed, and Meta reports sent, delivered and read. */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: 24,
  templates: true,
  media: ['image', 'video', 'audio', 'document', 'sticker', 'location'],
  reactions: true,
  editDelete: false,
  receipts: ['sent', 'delivered', 'read'],
  typing: false,
};

/** WhatsApp's own ceiling for a document; a hostile or broken media URL must not fill the worker's memory. */
const INBOUND_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const authOf = (c: WabaConnection): WabaAuth =>
  c.provider === 'interakt'
    ? {
        provider: 'interakt',
        authKey: c.authKey ?? '',
        wabaId: c.wabaId,
        phoneNumberId: c.phoneNumberId,
      }
    : { provider: 'meta', accessToken: c.accessToken ?? '' };

const credentialsOf = (c: WabaConnection): ChannelCredentials => ({
  senderId: c.phoneNumberId,
  accessToken: c.accessToken ?? '',
  route: c.provider,
  ...(c.provider === 'interakt' ? { authKey: c.authKey ?? '' } : {}),
  businessAccountId: c.wabaId,
});

/**
 * The WhatsApp Cloud API as an inbox channel (kind `whatsapp_waba`, TW-WABA-049): one channel per number the WABA domain connected,
 * its handle the number's uuid. The WABA domain keeps the credentials; this adapter reads them when it sends, so there is one copy
 * to renew and nothing sealed twice. Replies go out through the shared provider (`POST /{phone_number_id}/messages`, Meta or Interakt
 * route), so the pre-send guard and the branding footer run exactly once, and Meta's error codes are translated into what the
 * inbox needs to know (retry later, or fail with a reason).
 *
 * Inbound messages do not come through `parseInbound`: the WABA webhook already authenticated, routed and de-duplicated them, and
 * hands them to the inbox through `WabaInboxSink`. A customer's file is fetched here, by Meta's media id, when the ingest job asks.
 */
@Injectable()
export class WabaChannelAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp_waba' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly numbers: WabaConnectService,
    private readonly http: WabaHttp,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    /** Present in the worker (which sends); the HTTP app only reads capabilities. */
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
    const conn = await this.connectionOf(channel);
    const creds = credentialsOf(conn);
    const to = envelope.to.replace(/\D+/g, '');
    const screen = { source: 'inbox' };
    const reply = envelope.replyToProviderMessageId
      ? { replyToProviderMessageId: envelope.replyToProviderMessageId }
      : {};
    try {
      let res: ProviderSendResult;
      switch (envelope.kind) {
        case 'text':
          res = await this.provider.sendText(creds, {
            to,
            body: envelope.body,
            clientReference: envelope.clientReference,
            ...reply,
            screen,
          });
          break;
        case 'media': {
          const id = await this.upload(conn, channel.orgId, envelope.media);
          res = await this.provider.sendMessage(creds, {
            to,
            type: envelope.media.mediaKind,
            body: {
              id,
              // A caption is not allowed on audio or a sticker.
              ...(envelope.media.caption && !['audio', 'sticker'].includes(envelope.media.mediaKind)
                ? { caption: envelope.media.caption }
                : {}),
              ...(envelope.media.mediaKind === 'document' && envelope.media.name
                ? { filename: envelope.media.name }
                : {}),
            },
            clientReference: envelope.clientReference,
            ...reply,
            screen,
          });
          break;
        }
        case 'template':
          res = await this.provider.sendTemplate(creds, {
            to,
            templateName: envelope.template.name,
            language: envelope.template.language,
            variables: envelope.template.variables,
            clientReference: envelope.clientReference,
            screen,
          });
          break;
        case 'location':
          res = await this.provider.sendMessage(creds, {
            to,
            type: 'location',
            body: { ...envelope.location },
            clientReference: envelope.clientReference,
            ...reply,
            screen,
          });
          break;
        case 'reaction':
          res = await this.provider.sendMessage(creds, {
            to,
            type: 'reaction',
            body: {
              message_id: envelope.reaction.providerMessageId,
              emoji: envelope.reaction.emoji,
            },
            clientReference: envelope.clientReference,
            screen,
          });
          break;
      }
      return { providerMessageId: res.providerMessageId, acceptedAt: res.acceptedAt };
    } catch (err) {
      throw this.translate(err);
    }
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  /** `GET /{media-id}` answers with a short-lived URL that only the number's own credentials can read. */
  async fetchMedia(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const conn = await this.connectionOf(channel);
    const auth = authOf(conn);
    const info = await this.http.call<{ url?: string; mime_type?: string }>(auth, {
      method: 'GET',
      path: `/${media.providerMediaId}`,
    });
    if (!info.url) throw new Error('Meta gave no download address for this file');
    const file = await this.http.download(auth, info.url, INBOUND_MEDIA_MAX_BYTES);
    return { bytes: file.bytes, mime: info.mime_type ?? file.mime ?? media.mime };
  }

  // --- internals ---------------------------------------------------------------------------------

  private async connectionOf(channel: ChannelRuntime): Promise<WabaConnection> {
    if (!channel.externalId) {
      throw new ChannelError('WABA_NO_NUMBER', 'No WhatsApp number behind this channel', false);
    }
    const resolved = await this.db.txAs({ orgId: channel.orgId, userId: null }, (tx) =>
      this.numbers.resolveConnection(tx, channel.orgId, { uuid: channel.externalId! }),
    );
    if (!resolved) {
      throw new ChannelError('WABA_NO_NUMBER', 'The WhatsApp number behind this channel was removed', false);
    }
    if (!resolved.conn) {
      throw new ChannelError(
        'WABA_NO_CREDENTIALS',
        'This WhatsApp number has no usable token. Reconnect or renew it.',
        false,
      );
    }
    return resolved.conn;
  }

  /** The inbox keeps a file by key in its own store; Meta needs the bytes, so they are uploaded and sent by media id. */
  private async upload(
    conn: WabaConnection,
    orgId: number,
    media: { key: string; mime: string; name?: string },
  ): Promise<string> {
    if (!this.media) {
      throw new ChannelError('MEDIA_UNAVAILABLE', 'Media storage is not available here', true);
    }
    const opened = await this.media.open(orgId, media.key);
    if (!opened) throw new ChannelError('MEDIA_NOT_FOUND', 'The file to send is gone', false);
    const chunks: Buffer[] = [];
    for await (const c of opened.stream) chunks.push(Buffer.from(c as Buffer));
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', media.mime);
    form.set('file', new Blob([Buffer.concat(chunks)], { type: media.mime }), media.name ?? 'file');
    const res = await this.http.call<{ id?: string }>(authOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/media`,
      form,
    });
    if (!res.id) throw new Error('Meta accepted the file but returned no media id');
    return res.id;
  }

  /** Meta's code decides whether the queue should try again (rate limits, a hiccup) or the agent sees a reason. */
  private translate(err: unknown): unknown {
    if (err instanceof ChannelError || err instanceof AppError) return err;
    if (err instanceof WabaApiError) {
      const kind = classifySendError(err);
      const retryable = kind === 'rate_limited' || kind === 'transient';
      return new ChannelError(String(err.code ?? 'WABA_SEND_FAILED'), err.message, retryable);
    }
    return new ChannelError('WABA_SEND_FAILED', (err as Error).message, true);
  }
}
