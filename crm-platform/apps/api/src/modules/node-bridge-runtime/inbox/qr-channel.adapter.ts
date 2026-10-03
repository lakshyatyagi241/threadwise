import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ChannelCapabilities } from '@crm/contracts';
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
import { UnsupportedSendError } from '../../../infra/providers/node-bridge-runtime/outbound.port';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { DeviceControlService } from '../runtime/device-control.service';
import { inboxKeys, SENT_MARKER_TTL_S } from './inbox-keys';

/**
 * What a linked WhatsApp number can do through the inbox. No 24-hour rule and no templates: it is an ordinary WhatsApp account,
 * not the Cloud API. Reactions go out, and edits and deletes are possible on the engine (the inbox does not offer them yet).
 */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document', 'location'],
  reactions: true,
  editDelete: true,
  receipts: ['sent', 'delivered', 'read'],
  typing: false,
};

const digits = (s: string) => s.replace(/\D+/g, '');

/**
 * The unofficial WhatsApp engine as an inbox channel (kind `whatsapp_qr`, plan-inbox-chat.md decision 1): one channel per linked
 * device, its handle the device uuid. Sending goes to the worker that owns the device through `DeviceControlService`; inbound
 * messages and receipts do not come through a webhook but from the runtime itself (`InboxBridge`), so `verifyInbound` is false
 * and `parseInbound` empty.
 */
@Injectable()
export class QrChannelAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp_qr' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly control: DeviceControlService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    const deviceId = await this.deviceOf(channel);
    const to = digits(envelope.to);
    const context = { clientReference: envelope.clientReference, screen: { source: 'inbox' } };
    try {
      let providerMessageId: string | null = null;
      switch (envelope.kind) {
        case 'text':
          providerMessageId = (
            await this.control.sendMessage(
              channel.orgId,
              deviceId,
              { type: 'text', to, body: envelope.body },
              context,
            )
          ).providerMessageId;
          break;
        case 'media': {
          const file = await this.fileOf(channel.orgId, envelope.media.key);
          providerMessageId = (
            await this.control.sendMessage(
              channel.orgId,
              deviceId,
              {
                type: 'media',
                to,
                mediaUrl: '',
                data: file,
                mimeType: envelope.media.mime,
                ...(envelope.media.name ? { fileName: envelope.media.name } : {}),
                ...(envelope.media.caption ? { caption: envelope.media.caption } : {}),
              },
              context,
            )
          ).providerMessageId;
          break;
        }
        case 'location':
          providerMessageId = (
            await this.control.sendMessage(
              channel.orgId,
              deviceId,
              {
                type: 'location',
                to,
                latitude: envelope.location.latitude,
                longitude: envelope.location.longitude,
                ...(envelope.location.name ? { name: envelope.location.name } : {}),
                ...(envelope.location.address ? { address: envelope.location.address } : {}),
              },
              context,
            )
          ).providerMessageId;
          break;
        case 'reaction':
          await this.control.messageAction(channel.orgId, deviceId, {
            type: 'react',
            to,
            messageId: envelope.reaction.providerMessageId,
            // A reaction answers the customer's message; the inbox has no reaction on its own messages yet.
            fromMe: false,
            emoji: envelope.reaction.emoji,
          });
          providerMessageId = `react-${envelope.clientReference}`;
          break;
        case 'template':
          throw new ChannelError(
            'CHANNEL_CAPABILITY_UNSUPPORTED',
            'Templates are a WhatsApp Cloud API feature; this number sends plain messages',
            false,
          );
        case 'contacts':
        case 'interactive':
          throw new ChannelError(
            'CHANNEL_CAPABILITY_UNSUPPORTED',
            'Contact cards and interactive messages are WhatsApp Cloud API features; this number sends plain messages',
            false,
          );
      }
      const id = providerMessageId ?? `qr-${envelope.clientReference}`;
      // So a delivery report for this message finds the channel it belongs to (see InboxBridge).
      await this.redis.set(inboxKeys.sent(id), channel.uuid, 'EX', SENT_MARKER_TTL_S);
      return { providerMessageId: id, acceptedAt: new Date() };
    } catch (err) {
      if (err instanceof ChannelError) throw err;
      if (err instanceof UnsupportedSendError) {
        throw new ChannelError('CHANNEL_CAPABILITY_UNSUPPORTED', err.message, false);
      }
      // A number that is not connected right now may be back in a minute: let the queue try again.
      throw new ChannelError('WA_QR_SEND_FAILED', (err as Error).message, true);
    }
  }

  verifyInbound(): boolean {
    return false;
  }

  parseInbound(): ParsedInbound {
    return { messages: [], receipts: [] };
  }

  async fetchMedia(
    _channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const bytes = await this.redis.getBuffer(inboxKeys.inboundMedia(media.providerMediaId));
    if (!bytes) throw new Error('The file is no longer available from the device');
    return { bytes, mime: media.mime };
  }

  private async deviceOf(channel: ChannelRuntime): Promise<number> {
    if (!channel.externalId)
      throw new ChannelError('WA_QR_NO_DEVICE', 'No device behind this channel', false);
    const id = await this.db.txAs({ orgId: channel.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT id FROM devices WHERE org_id = ${channel.orgId} AND uuid = ${channel.externalId}::uuid`,
      );
      return (res.rows[0] as { id: number | string } | undefined)?.id;
    });
    if (id === undefined) {
      throw new ChannelError(
        'WA_QR_NO_DEVICE',
        'The device behind this channel was removed',
        false,
      );
    }
    return Number(id);
  }

  private async fileOf(orgId: number, key: string): Promise<Buffer> {
    if (!this.media)
      throw new ChannelError('MEDIA_UNAVAILABLE', 'Media storage is not available here', true);
    const opened = await this.media.open(orgId, key);
    if (!opened) throw new ChannelError('MEDIA_NOT_FOUND', 'The file to send is gone', false);
    const chunks: Buffer[] = [];
    for await (const c of opened.stream) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  }
}
