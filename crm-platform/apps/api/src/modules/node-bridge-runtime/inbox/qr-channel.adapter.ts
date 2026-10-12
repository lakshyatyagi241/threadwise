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
import {
  mentionToken,
  toGroupJid,
} from '../../../infra/providers/node-bridge-runtime/group-mapping';
import {
  UnsupportedSendError,
  type SendCommand,
  type SendQuote,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';
import {
  groupIdOf,
  isGroupPeer,
  isPersonalGroupSendKind,
  personalGroupSendBlock,
} from '../../../infra/providers/whatsapp/group-peer';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
import { DeviceControlService } from '../runtime/device-control.service';
import { inboxKeys, SENT_MARKER_TTL_S } from './inbox-keys';

/** A vCard 3.0 value: backslash, semicolon, comma and line breaks are escaped so a name can never add a field. */
const vcardText = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/[;,]/g, '\\$&').replace(/\r?\n/g, '\\n');

/** The card of one shared contact; a phone gets `waid` so WhatsApp offers "Message" on it. */
export function vcardOf(c: {
  name: string;
  phones: { phone: string; type?: string | undefined }[];
  emails: string[];
  org?: string | undefined;
}): string {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardText(c.name)}`,
    ...(c.org ? [`ORG:${vcardText(c.org)}`] : []),
    ...c.phones.map((p) => {
      const d = p.phone.replace(/\D+/g, '');
      return `TEL;type=CELL;waid=${d}:${p.phone.replace(/[^\d+]/g, '')}`;
    }),
    ...c.emails.map((e) => `EMAIL:${vcardText(e)}`),
    'END:VCARD',
  ].join('\n');
}

/**
 * What a linked WhatsApp number can do through the inbox. No 24-hour rule and no templates: it is an ordinary WhatsApp account,
 * not the Cloud API. Reactions go out, and edits and deletes are possible on the engine (the inbox does not offer them yet).
 */
const CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: ['image', 'video', 'audio', 'document', 'location', 'contact'],
  reactions: true,
  editDelete: true,
  receipts: ['sent', 'delivered', 'read'],
  typing: false,
};

const digits = (s: string) => s.replace(/\D+/g, '');

/**
 * The body WhatsApp needs to draw a mention: it must contain `@<user part of the member's id>`. The composer may have written the
 * member's name after the `@`; that is swapped for the id's token. A mention with no `@` in the body is still sent (WhatsApp notifies the member).
 */
export function mentionedBody(
  body: string,
  mentions: { jid: string; name?: string | undefined }[],
): string {
  let out = body;
  for (const m of mentions) {
    const token = mentionToken(m.jid);
    if (out.includes(token) || !m.name) continue;
    out = out.split(`@${m.name}`).join(token);
  }
  return out;
}

/** WhatsApp turning a group send down for a standing reason (not in the group any more, only admins may write): never worth retrying. */
function groupRefusal(message: string): { code: string; message: string } | null {
  if (/not-authorized|forbidden|not a participant|item-not-found|not in group/i.test(message)) {
    return {
      code: 'WA_GROUP_LEFT',
      message:
        'WhatsApp refused the message: this number is no longer allowed to write in the group.',
    };
  }
  return null;
}

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
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
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
    // Not retryable: the queue would otherwise keep trying a send the platform has switched off (owner decision 2026-10-05).
    if (!(await this.unofficial.isEnabledFor(channel.orgId))) {
      throw new ChannelError(
        'WA_UNOFFICIAL_DISABLED',
        'The unofficial WhatsApp engine is turned off on this platform. Reply from a WhatsApp Cloud API number.',
        false,
      );
    }
    const deviceId = await this.deviceOf(channel);
    const group = isGroupPeer(envelope.to);
    if (group && !isPersonalGroupSendKind(envelope.kind)) {
      throw new ChannelError(
        'CHANNEL_CAPABILITY_UNSUPPORTED',
        `A WhatsApp group cannot receive a ${envelope.kind} message`,
        false,
      );
    }
    // A group id is opaque text: never reduced to digits (that would address a person).
    const to = group ? groupIdOf(envelope.to) : digits(envelope.to);
    // What the thread is on the number now (left, announce-only) can have changed since the message was queued.
    if (group) await this.assertGroupWritable(channel, deviceId, to);
    const context = { clientReference: envelope.clientReference, screen: { source: 'inbox' } };
    const grp = group ? ({ toGroup: true } as const) : {};
    try {
      const quote =
        group && envelope.kind !== 'reaction'
          ? await this.quoteOf(channel, envelope.to, envelope.replyToProviderMessageId)
          : undefined;
      const withQuote = (c: SendCommand): SendCommand => (quote ? { ...c, quote } : c);
      let providerMessageId: string | null = null;
      switch (envelope.kind) {
        case 'text': {
          const mentions = group ? (envelope.mentions ?? []) : [];
          providerMessageId = (
            await this.control.sendMessage(
              channel.orgId,
              deviceId,
              withQuote(
                mentions.length > 0
                  ? {
                      type: 'group_text',
                      groupJid: to,
                      body: mentionedBody(envelope.body, mentions),
                      mentions: mentions.map((m) => m.jid),
                    }
                  : { type: 'text', to, body: envelope.body, ...grp },
              ),
              context,
            )
          ).providerMessageId;
          break;
        }
        case 'media': {
          const file = await this.fileOf(channel.orgId, envelope.media.key);
          providerMessageId = (
            await this.control.sendMessage(
              channel.orgId,
              deviceId,
              withQuote({
                type: 'media',
                to,
                ...grp,
                mediaUrl: '',
                data: file,
                mimeType: envelope.media.mime,
                ...(envelope.media.name ? { fileName: envelope.media.name } : {}),
                ...(envelope.media.caption ? { caption: envelope.media.caption } : {}),
              }),
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
              withQuote({
                type: 'location',
                to,
                ...grp,
                latitude: envelope.location.latitude,
                longitude: envelope.location.longitude,
                ...(envelope.location.name ? { name: envelope.location.name } : {}),
                ...(envelope.location.address ? { address: envelope.location.address } : {}),
              }),
              context,
            )
          ).providerMessageId;
          break;
        case 'reaction': {
          // In a group the reaction must name who wrote the message it answers; on a person's chat it answers the customer.
          const target = group
            ? await this.quoteOf(channel, envelope.to, envelope.reaction.providerMessageId)
            : undefined;
          await this.control.messageAction(channel.orgId, deviceId, {
            type: 'react',
            to: group ? toGroupJid(to) : to,
            messageId: envelope.reaction.providerMessageId,
            fromMe: target?.fromMe ?? false,
            emoji: envelope.reaction.emoji,
            ...(target?.participant ? { participant: target.participant } : {}),
          });
          providerMessageId = `react-${envelope.clientReference}`;
          break;
        }
        case 'template':
          throw new ChannelError(
            'CHANNEL_CAPABILITY_UNSUPPORTED',
            'Templates are a WhatsApp Cloud API feature; this number sends plain messages',
            false,
          );
        case 'contacts': {
          const cards = envelope.contacts.map((c) => ({ name: c.name, vcard: vcardOf(c) }));
          providerMessageId = (
            await this.control.sendMessage(
              channel.orgId,
              deviceId,
              withQuote({
                type: 'contact',
                to,
                ...grp,
                name: cards[0]!.name,
                phone: envelope.contacts[0]!.phones[0]?.phone ?? '',
                cards,
              }),
              context,
            )
          ).providerMessageId;
          break;
        }
        case 'interactive':
          throw new ChannelError(
            'CHANNEL_CAPABILITY_UNSUPPORTED',
            'Buttons and lists are WhatsApp Cloud API features; this number sends plain messages',
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
      // A number that is not connected right now may be back in a minute: let the queue try again. WhatsApp refusing a group send
      // (we were removed, only admins may write) will not change on a retry.
      const refused = group ? groupRefusal((err as Error).message) : null;
      if (refused) throw new ChannelError(refused.code, refused.message, false);
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

  /** Refuses (not retryable) a group send when the number left the group or may not write there. A group with no row yet is let through. */
  private async assertGroupWritable(
    channel: ChannelRuntime,
    deviceId: number,
    groupId: string,
  ): Promise<void> {
    const row = await this.db.txAs({ orgId: channel.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT left_at, announce, is_admin FROM wa_device_groups
             WHERE org_id = ${channel.orgId} AND device_id = ${deviceId} AND group_jid = ${groupId} LIMIT 1`,
      );
      return res.rows[0] as
        { left_at: Date | string | null; announce: boolean; is_admin: boolean } | undefined;
    });
    const block = personalGroupSendBlock(
      row ? { leftAt: row.left_at, announce: row.announce, isAdmin: row.is_admin } : null,
    );
    if (block) throw new ChannelError(block.code, block.message, false);
  }

  /**
   * The message a group send answers, the way WhatsApp wants it: whether it is ours and, for a member's message, who wrote it (their
   * phone id, else their anonymous id). Read from the thread's own stored message; undefined when we never stored that id.
   */
  private async quoteOf(
    channel: ChannelRuntime,
    peerKey: string,
    providerMessageId: string | undefined,
  ): Promise<SendQuote | undefined> {
    if (!providerMessageId) return undefined;
    const row = await this.db.txAs({ orgId: channel.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT m.direction, m.body, m.kind, m.meta
              FROM messages m
              JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
              JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
             WHERE m.org_id = ${channel.orgId} AND ch.uuid = ${channel.uuid}::uuid
               AND c.peer_key = ${peerKey} AND m.provider_message_id = ${providerMessageId}
             LIMIT 1`,
      );
      return res.rows[0] as
        | { direction: string; body: string | null; kind: string; meta: Record<string, unknown> }
        | undefined;
    });
    if (!row) return undefined;
    const fromMe = row.direction === 'out';
    const author = (row.meta?.group ?? {}) as { participant?: unknown; senderLid?: unknown };
    const phone = typeof author.participant === 'string' ? digits(author.participant) : '';
    const lid = typeof author.senderLid === 'string' ? digits(author.senderLid) : '';
    const participant = fromMe
      ? undefined
      : phone
        ? `${phone}@s.whatsapp.net`
        : lid
          ? `${lid}@lid`
          : undefined;
    return {
      providerMessageId,
      fromMe,
      ...(participant ? { participant } : {}),
      ...(row.kind === 'text' && row.body ? { text: row.body.slice(0, 200) } : {}),
    };
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
