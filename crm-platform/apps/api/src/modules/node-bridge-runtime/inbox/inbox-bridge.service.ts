import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import type { NormalisedInbound } from '../../../infra/providers/chat-conversations/channel.port';
import { bareGroupId } from '../../../infra/providers/node-bridge-runtime/group-mapping';
import type { Normalized } from '../../../infra/providers/node-bridge-runtime/inbound-normalizer';
import type { InboundMessage } from '../../../infra/providers/node-bridge-runtime/inbound.port';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import {
  CONVERSATIONS_FACADE,
  ChannelIngestPublisher,
  ChannelRegistryService,
  type ConversationsFacade,
} from '../../chat-conversations';
import {
  InboundRouter,
  ReceiptRouter,
  type DeliveryReport,
  type InboundSink,
} from '../runtime/routers';
import { INBOUND_MEDIA_TTL_S, inboxKeys, SENT_MARKER_TTL_S } from './inbox-keys';

interface DeviceRow {
  uuid: string;
  device_name: string | null;
  country_code: string | null;
  phone_number: string | null;
  status: string;
}

const GROUP_FALLBACK_TITLE = 'WhatsApp group';

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');

/** What the thread shows for a file that did not come with the message. */
const KIND_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
};

/**
 * Where the unofficial engine's traffic goes in the inbox (TW-NODE-017, 018, 020). The runtime reads WhatsApp and hands each
 * message to this sink, which keeps one inbox channel per device and puts the message on the inbox's own ingest queue: the same
 * pipeline a Cloud API webhook feeds, so threads, contacts, unread counts and realtime behave identically.
 *
 * Reference posted these to Laravel's `inbound-message` endpoint; here it is in-process. Registered in the worker only.
 *
 * - A customer's message becomes an inbound job. A file is held in Redis for the job (`fetchMedia` reads it), because it cannot be
 *   downloaded later without the live message; one that was too large or failed arrives as text saying so, never lost.
 * - The business's own message typed on the phone (an echo) is recorded on the thread as outbound, once (the ledger keys on the id).
 * - A group message (personal-number groups, D2/D3) is a message on the group's own thread, keyed `g:<bare group id>` by the ingest:
 *   storage only (no contact per speaker, no flow, keyword reply, AI or routing), the speaker's name and number on the message, the
 *   thread titled with the group's subject from the directory. One typed on the phone or another linked device is mirrored as
 *   outbound, once.
 * - Delivery reports go to the channel that sent the message (a marker the adapter leaves); anything else is not ours.
 */
@Injectable()
export class InboxBridge implements InboundSink, OnModuleInit {
  private readonly logger = new Logger(InboxBridge.name);
  private readonly channels = new Map<string, { uuid: string; at: number }>();
  private readonly subjects = new Map<string, { subject: string; at: number }>();

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly inbound: InboundRouter,
    private readonly receipts: ReceiptRouter,
    private readonly publisher: ChannelIngestPublisher,
    private readonly registry: ChannelRegistryService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  onModuleInit(): void {
    this.inbound.register(this);
    this.receipts.register((r) => this.report(r));
  }

  // --- inbound --------------------------------------------------------------------------------

  async message(
    ctx: { orgId: number; deviceId: number },
    n: Normalized,
    media?: Buffer,
  ): Promise<void> {
    if (n.kind === 'group') return this.groupMessage(ctx, n.message, media);
    const m = n.message;
    const peerKey = digits(m.chat.phone) || digits(m.chat.lid?.split('@')[0]);
    if (!peerKey) return;
    const channelUuid = await this.channelOf(ctx.orgId, ctx.deviceId);
    if (!channelUuid) return;

    if (n.kind === 'echo') {
      await this.system(ctx.orgId, () =>
        this.conversations.recordOutbound({
          channelId: channelUuid,
          peerKey,
          source: 'phone',
          body: this.summary(m),
          providerMessageId: m.providerMessageId,
        }),
      );
      await this.redis.set(
        inboxKeys.sent(m.providerMessageId),
        channelUuid,
        'EX',
        SENT_MARKER_TTL_S,
      );
      return;
    }

    await this.publisher.enqueueInbound(
      ctx.orgId,
      channelUuid,
      await this.normalise(ctx, m, peerKey, media),
    );
  }

  /** A message in a group the number belongs to (never an automation trigger: the ingest skips every listener for a `g:` thread). */
  private async groupMessage(
    ctx: { orgId: number; deviceId: number },
    m: InboundMessage,
    media?: Buffer,
  ): Promise<void> {
    const groupId = bareGroupId(m.chat.jid);
    if (!groupId) return;
    const channelUuid = await this.channelOf(ctx.orgId, ctx.deviceId);
    if (!channelUuid) return;
    const title = await this.groupTitle(ctx, groupId);

    if (m.fromMe) {
      // Typed on the phone or on another linked device. A reaction of ours is not a bubble. A message our own send just made is already
      // on the thread (the adapter leaves its id in the sent marker, and the ledger keys on it): never a second bubble.
      if (m.reaction) return;
      if (await this.redis.get(inboxKeys.sent(m.providerMessageId))) return;
      await this.system(ctx.orgId, () =>
        this.conversations.recordOutbound({
          channelId: channelUuid,
          peerKey: `g:${groupId}`,
          source: 'phone',
          body: this.summary(m),
          providerMessageId: m.providerMessageId,
          threadTitle: title,
        }),
      );
      await this.redis.set(
        inboxKeys.sent(m.providerMessageId),
        channelUuid,
        'EX',
        SENT_MARKER_TTL_S,
      );
      return;
    }

    const who = m.participant;
    // The speaker is named on the message, never on the thread: the thread has no peer name and no contact.
    const { peerName: _speaker, ...normalised } = await this.normalise(ctx, m, groupId, media);
    await this.publisher.enqueueInbound(ctx.orgId, channelUuid, {
      ...normalised,
      group: {
        title,
        // A speaker WhatsApp knows only by an anonymous id has no phone: the number is empty and the id travels separately.
        participant: who?.phone ?? '',
        ...(m.pushName || who?.name ? { participantName: (m.pushName ?? who?.name)! } : {}),
        ...(who?.lid ? { participantLid: who.lid } : {}),
      },
    });
  }

  /** The group's subject from the directory (kept in sync by the groups API), or the generic title until the first sync. */
  private async groupTitle(
    ctx: { orgId: number; deviceId: number },
    groupId: string,
  ): Promise<string> {
    const key = `${ctx.orgId}:${ctx.deviceId}:${groupId}`;
    const hit = this.subjects.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.subject;
    const subject = await this.db.txAs({ orgId: ctx.orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT subject FROM wa_device_groups
             WHERE org_id = ${ctx.orgId} AND device_id = ${ctx.deviceId} AND group_jid = ${groupId} LIMIT 1`,
      );
      return ((res.rows[0] as { subject: string | null } | undefined)?.subject ?? '').trim();
    });
    const title = subject || GROUP_FALLBACK_TITLE;
    if (this.subjects.size > 2000) this.subjects.clear();
    this.subjects.set(key, { subject: title, at: Date.now() });
    return title;
  }

  async deviceStatus(
    ctx: { orgId: number; deviceId: number },
    state: { connected: boolean },
  ): Promise<void> {
    const dev = await this.device(ctx.orgId, ctx.deviceId);
    if (!dev) return;
    const { uuid } = await this.system(ctx.orgId, () =>
      this.registry.syncDeviceChannel(ctx.orgId, this.view(dev, state.connected)),
    );
    this.channels.set(`${ctx.orgId}:${ctx.deviceId}`, { uuid, at: Date.now() });
  }

  // --- receipts -------------------------------------------------------------------------------

  /** Takes a delivery report for a message the inbox sent through a device. False for anything else, so the next consumer looks. */
  private async report(r: DeliveryReport): Promise<boolean> {
    const channelUuid = await this.redis.get(inboxKeys.sent(r.providerMessageId));
    if (!channelUuid) return false;
    await this.publisher.enqueueReceipt(r.orgId, channelUuid, {
      providerMessageId: r.providerMessageId,
      status: r.status,
      at: r.occurredAt,
    });
    return true;
  }

  // --- helpers --------------------------------------------------------------------------------

  private async normalise(
    ctx: { orgId: number; deviceId: number },
    m: InboundMessage,
    peerKey: string,
    bytes?: Buffer,
  ): Promise<NormalisedInbound> {
    const base = {
      providerMessageId: m.providerMessageId,
      peerKey,
      ...(m.pushName ? { peerName: m.pushName } : {}),
      providerTimestamp: m.timestamp,
      ...(m.replyToProviderMessageId
        ? { replyToProviderMessageId: m.replyToProviderMessageId }
        : {}),
      ...(m.forwarded || m.mentionedJids?.length
        ? {
            meta: {
              ...(m.forwarded ? { forwarded: true } : {}),
              ...(m.mentionedJids?.length
                ? { mentions: m.mentionedJids.slice(0, 50).map((jid) => ({ jid })) }
                : {}),
            },
          }
        : {}),
    };
    if (m.reaction) {
      return {
        ...base,
        kind: 'reaction',
        reactionEmoji: m.reaction.emoji,
        replyToProviderMessageId: m.reaction.targetMessageId,
      };
    }
    if (m.media) {
      if (bytes) {
        const id = `${ctx.orgId}:${ctx.deviceId}:${m.providerMessageId}:${randomUUID().slice(0, 8)}`;
        await this.redis.set(inboxKeys.inboundMedia(id), bytes, 'EX', INBOUND_MEDIA_TTL_S);
        return {
          ...base,
          kind: 'media',
          ...(m.text ? { body: m.text } : {}),
          media: {
            providerMediaId: id,
            mediaKind: m.media.kind,
            mime: m.media.mimeType ?? 'application/octet-stream',
            ...(m.media.fileName ? { name: m.media.fileName } : {}),
            ...(m.media.sizeBytes !== null ? { sizeBytes: m.media.sizeBytes } : {}),
          },
        };
      }
      // The file was too large or could not be downloaded: keep the message and say so.
      return {
        ...base,
        kind: 'text',
        body: [`[${KIND_LABEL[m.media.kind] ?? 'File'} not available]`, m.text]
          .filter(Boolean)
          .join('\n'),
      };
    }
    if (m.location) {
      return {
        ...base,
        kind: 'location',
        location: {
          latitude: m.location.latitude,
          longitude: m.location.longitude,
          ...(m.location.name ? { name: m.location.name } : {}),
          ...(m.location.address ? { address: m.location.address } : {}),
        },
      };
    }
    if (m.contact) {
      return {
        ...base,
        kind: 'contact',
        body: m.contacts?.length
          ? (m.contacts.find((c) => c.name)?.name ?? m.contact.name)
          : [m.contact.name, m.contact.phone].filter(Boolean).join(' · '),
        ...(m.contacts?.length
          ? { meta: { ...(m.forwarded ? { forwarded: true } : {}), contacts: m.contacts } }
          : {}),
      };
    }
    if (m.unsupported) {
      return {
        ...base,
        kind: 'unsupported',
        body: `[${m.unsupported.label} message]`,
        meta: { ...(m.forwarded ? { forwarded: true } : {}), rawType: m.unsupported.rawType },
      };
    }
    return { ...base, kind: 'text', body: m.text ?? '' };
  }

  /** The words an echo shows on the thread (a file or place sent from the phone is described, its bytes are not copied). */
  private summary(m: InboundMessage): string {
    if (m.media)
      return [`[${KIND_LABEL[m.media.kind] ?? 'File'}]`, m.text].filter(Boolean).join(' ');
    if (m.location) return `[Location] ${m.location.name ?? ''}`.trim();
    if (m.contact) return `[Contact] ${m.contact.name}`;
    if (m.unsupported) return `[${m.unsupported.label}]`;
    return m.text ?? '';
  }

  /** The inbox channel of a device, created on first use. Cached for a minute: a device's channel does not change under a running worker. */
  private async channelOf(orgId: number, deviceId: number): Promise<string | null> {
    const key = `${orgId}:${deviceId}`;
    const hit = this.channels.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.uuid;
    const dev = await this.device(orgId, deviceId);
    if (!dev) return null;
    const { uuid } = await this.system(orgId, () =>
      this.registry.syncDeviceChannel(orgId, this.view(dev, dev.status === 'connected')),
    );
    this.channels.set(key, { uuid, at: Date.now() });
    return uuid;
  }

  private view(dev: DeviceRow, connected: boolean) {
    const number = digits(dev.phone_number);
    return {
      uuid: dev.uuid,
      name: (dev.device_name ?? '').trim() || number || 'WhatsApp',
      displayAddress: number ? `+${digits(dev.country_code)}${number}` : null,
      connected,
    };
  }

  private async device(orgId: number, deviceId: number): Promise<DeviceRow | null> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, device_name, country_code, phone_number, status
          FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`);
      return (res.rows[0] as unknown as DeviceRow | undefined) ?? null;
    });
  }

  private system<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    return RequestContextStore.run(
      {
        requestId: `node-inbox-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
