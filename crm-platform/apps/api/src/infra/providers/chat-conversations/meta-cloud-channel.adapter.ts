import {
  whatsappCloudCredentialsSchema,
  type ChannelCapabilities,
  type WhatsappCloudCredentials,
} from '@crm/contracts';
import { MetaCloudProvider } from '../whatsapp/meta-cloud.provider';
import {
  ChannelError,
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type NormalisedInbound,
  type NormalisedReceipt,
  type OutboundEnvelope,
  type ParsedInbound,
  type SendResult,
  type WindowInfo,
} from './channel.port';

const META_CAPABILITIES: ChannelCapabilities = {
  windowHours: 24,
  templates: true,
  media: ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact'],
  reactions: true,
  editDelete: false,
  receipts: ['sent', 'delivered', 'read'],
  typing: false,
};

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

interface MetaMessage {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
  context?: { id?: string };
  reaction?: { message_id?: string; emoji?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  [media: string]: unknown;
}

/**
 * WhatsApp Cloud API as a channel adapter: the shape Phase 2 fills in.
 *
 * What is real now: capabilities, the 24 hour rule, signature verification (delegated to `MetaCloudProvider`, which verifies the raw
 * body in constant time) and normalising the webhook payload. What is not: `send`. It throws a permanent `ChannelError` and
 * `live` is false, so a Cloud channel can be stored with its credentials sealed but is never marked connected and the dispatcher
 * never reaches this method. The old `WhatsAppProvider` port keeps serving broadcasts until they move to the dispatcher.
 */
export class MetaCloudChannelAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp_cloud' as const;
  readonly live = false;
  readonly publicWebhook = true;
  readonly credentialsSchema = whatsappCloudCredentialsSchema;
  readonly secretFields = ['accessToken', 'appSecret'] as const;

  constructor(private readonly meta: MetaCloudProvider) {}

  externalIdOf(credentials: Readonly<Record<string, string | undefined>>): string | null {
    return (credentials as Partial<WhatsappCloudCredentials>).phoneNumberId ?? null;
  }

  capabilities(): ChannelCapabilities {
    return { ...META_CAPABILITIES, media: [...META_CAPABILITIES.media] };
  }

  windowInfo(_channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    return windowFromLastInbound(META_CAPABILITIES.windowHours, lastInboundAt, now);
  }

  send(_channel: ChannelRuntime, _envelope: OutboundEnvelope): Promise<SendResult> {
    return Promise.reject(
      new ChannelError(
        'CHANNEL_NOT_LIVE',
        'Sending through WhatsApp Cloud is not enabled yet in this release',
        false,
      ),
    );
  }

  verifyInbound(
    channel: ChannelRuntime,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): boolean {
    const secret = channel.credentials.appSecret;
    const signature = headers['x-hub-signature-256'];
    if (!secret || !signature) return false;
    return this.meta.verifyWebhookSignature(rawBody, signature, secret);
  }

  parseInbound(_channel: ChannelRuntime, payload: unknown): ParsedInbound {
    const names = new Map<string, string>();
    const messages: NormalisedInbound[] = [];
    const receipts: NormalisedReceipt[] = [];
    const entries = (payload as { entry?: unknown } | null)?.entry;
    if (!Array.isArray(entries)) return { messages, receipts };

    for (const entry of entries as Array<{ changes?: Array<{ value?: unknown }> }>) {
      for (const change of entry.changes ?? []) {
        const value = change.value as
          | {
              contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
              messages?: MetaMessage[];
              statuses?: Array<{
                id: string;
                status: string;
                timestamp: string;
                errors?: Array<{ code: number; title?: string }>;
              }>;
            }
          | undefined;
        if (!value) continue;
        for (const c of value.contacts ?? []) {
          if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
        }
        for (const s of value.statuses ?? []) {
          if (
            s.status !== 'sent' &&
            s.status !== 'delivered' &&
            s.status !== 'read' &&
            s.status !== 'failed'
          )
            continue;
          receipts.push({
            providerMessageId: s.id,
            status: s.status,
            at: new Date(Number(s.timestamp) * 1000),
            errorCode: s.errors?.[0]?.code?.toString(),
            errorMessage: s.errors?.[0]?.title,
          });
        }
        for (const m of value.messages ?? []) messages.push(this.message(m, names));
      }
    }
    return { messages, receipts };
  }

  private message(m: MetaMessage, names: Map<string, string>): NormalisedInbound {
    const peerKey = m.from.replace(/^\+/, '');
    const base = {
      providerMessageId: m.id,
      peerKey,
      peerName: names.get(peerKey),
      providerTimestamp: new Date(Number(m.timestamp) * 1000),
      replyToProviderMessageId: m.context?.id,
    };
    if (m.type === 'text') return { ...base, kind: 'text', body: m.text?.body };
    if (m.type === 'location' && m.location)
      return { ...base, kind: 'location', location: m.location };
    if (m.type === 'reaction') {
      return {
        ...base,
        kind: 'reaction',
        replyToProviderMessageId: m.reaction?.message_id,
        reactionEmoji: m.reaction?.emoji,
      };
    }
    if (MEDIA_TYPES.has(m.type)) {
      const file = m[m.type] as
        { id?: string; mime_type?: string; filename?: string; caption?: string } | undefined;
      if (file?.id) {
        return {
          ...base,
          kind: 'media',
          body: file.caption,
          media: {
            providerMediaId: file.id,
            mediaKind: m.type as 'image' | 'video' | 'audio' | 'document' | 'sticker',
            mime: file.mime_type ?? 'application/octet-stream',
            name: file.filename,
          },
        };
      }
    }
    if (m.type === 'interactive' || m.type === 'button') return { ...base, kind: 'interactive' };
    if (m.type === 'contacts') return { ...base, kind: 'contact' };
    return { ...base, kind: 'unsupported' };
  }
}
