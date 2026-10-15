import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import type { NormalisedInbound } from '../../../infra/providers/chat-conversations';
import {
  CONVERSATIONS_FACADE,
  ChannelIngestPublisher,
  ExternalChannelIngest,
  type ConversationsFacade,
  type ExternalAccount,
} from '../../chat-conversations';
import {
  PLACEHOLDER_NAME,
  type InboundBody,
  type InboundViberMessage,
  type ViberUserInfo,
} from '../event-rules';
import type { InboundRecorded, InboxIngest, ReceiptInput } from './tokens';

/** The channel kind a Viber account's threads live on. */
export const VIBER_KIND = 'viber';

const NOT_STORED: InboundRecorded = {
  stored: false,
  conversationId: 0,
  contactId: null,
  newThread: false,
};

interface ChannelNames {
  id: number;
  name: string | null;
  uri: string | null;
}

/**
 * The Viber side of the inbox, over chat-conversations. A Viber account is one `viber` channel (its handle the channel row id); each
 * Viber user is the peer of one perpetual thread on it (the user id, case kept). A message goes through the shared pipeline (ledger
 * dedup on Viber's message token, gap-free sequence, unread, reopen, realtime); a file is copied by the channel adapter. Still ours,
 * because the inbox cannot know it: the sender becomes a contact keyed by the Viber user id (no phone), as Reference's
 * `Contact::forSocialSender` did.
 */
@Injectable()
export class ChatInboxIngest implements InboxIngest {
  constructor(
    private readonly db: DatabaseService,
    private readonly external: ExternalChannelIngest,
    private readonly receipts: ChannelIngestPublisher,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  private account(c: ChannelNames): ExternalAccount {
    return {
      kind: VIBER_KIND,
      externalId: String(c.id),
      name: (c.name || 'Viber').slice(0, 120),
      displayAddress: c.uri ? `viber.com/${c.uri}` : null,
    };
  }

  /** Keeps a channel's inbox channel in step with the Viber account (connected, paused or gone). */
  syncChannel(orgId: number, c: ChannelNames, connected: boolean): Promise<string> {
    return this.external.sync(orgId, this.account(c), connected);
  }

  private channelNames(orgId: number, channelRowId: number): Promise<ChannelNames> {
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT bot_name, bot_uri FROM viber_channels WHERE org_id = ${orgId} AND id = ${channelRowId}`,
      );
      const r = res.rows[0] as { bot_name: string | null; bot_uri: string | null } | undefined;
      return { id: channelRowId, name: r?.bot_name ?? null, uri: r?.bot_uri ?? null };
    });
  }

  async recordInbound(
    orgId: number,
    channelRowId: number,
    m: InboundViberMessage,
  ): Promise<InboundRecorded> {
    const channel = await this.channelNames(orgId, channelRowId);
    const body = m.body;
    const message: NormalisedInbound = {
      providerMessageId: m.token ?? `vib-${randomUUID()}`,
      peerKey: m.user.id,
      ...(m.user.name ? { peerName: m.user.name } : {}),
      ...normalise(body),
      meta: {
        viber: Object.fromEntries(
          Object.entries({
            user_id: m.user.id,
            message_token: m.token,
            msg_type: m.msgType,
            sticker_id: m.stickerId,
          }).filter(([, v]) => v !== null && v !== ''),
        ),
        ...(body.kind === 'contact'
          ? { contacts: [{ name: body.name, phones: body.phone ? [body.phone] : [], emails: [] }] }
          : {}),
      },
      providerTimestamp: new Date(),
    };
    const out = await this.external.inbound(orgId, this.account(channel), message);
    if (out.outcome !== 'stored') return NOT_STORED;

    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${out.conversationUuid}::uuid`,
      );
      const conv = res.rows[0] as
        { id: number | string; contact_id: number | string | null } | undefined;
      if (!conv) return NOT_STORED;
      const conversationId = Number(conv.id);
      const contactId = await this.linkContact(tx, orgId, conversationId, conv.contact_id, m.user);
      return { stored: true, conversationId, contactId, newThread: out.createdConversation };
    });
  }

  /**
   * The sender is one contact per organization, keyed by the Viber user id. A name Viber gives later replaces the placeholder title
   * a thread started with, and the avatar is kept while the contact has none.
   */
  private async linkContact(
    tx: Tx,
    orgId: number,
    conversationId: number,
    current: number | string | null,
    user: ViberUserInfo,
  ): Promise<number | null> {
    if (user.name) {
      await tx.execute(sql`
        UPDATE conversations SET
               title = CASE WHEN title IS NULL OR title IN ('', ${PLACEHOLDER_NAME}) OR title = peer_key THEN ${user.name} ELSE title END,
               peer_name = ${user.name}
        WHERE org_id = ${orgId} AND id = ${conversationId}`);
    }
    const c = await tx.execute(sql`
      INSERT INTO contacts (org_id, name, channel, channel_uid, message, image_url)
      VALUES (${orgId}, ${user.name ?? PLACEHOLDER_NAME}, ${VIBER_KIND}, ${user.id}, 'Source: Viber', ${user.avatar})
      ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
      DO UPDATE SET name = CASE WHEN coalesce(contacts.name, '') IN ('', ${PLACEHOLDER_NAME}) THEN EXCLUDED.name ELSE contacts.name END,
                    image_url = coalesce(nullif(contacts.image_url, ''), EXCLUDED.image_url)
      RETURNING id`);
    const contactId = Number((c.rows[0] as { id: number | string }).id);
    if (current === null) {
      await tx.execute(
        sql`UPDATE conversations SET contact_id = ${contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`,
      );
      return contactId;
    }
    return Number(current);
  }

  async ensureThread(orgId: number, channelRowId: number, user: ViberUserInfo): Promise<void> {
    const channel = await this.channelNames(orgId, channelRowId);
    const channelUuid = await this.syncChannel(orgId, channel, true);
    await RequestContextStore.run(
      {
        requestId: `viber-subscribe-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        let thread = await this.conversations.findThread(channelUuid, user.id);
        if (!thread) {
          // The inbox holds no empty thread, so a user who only subscribed gets one small system line; it makes them reachable.
          await this.conversations.recordOutbound({
            channelId: channelUuid,
            peerKey: user.id,
            threadTitle: user.name ?? PLACEHOLDER_NAME,
            source: 'viber_subscribe',
            kind: 'system',
            direction: 'in',
            body: 'Subscribed to the Viber account',
            providerMessageId: `viber-subscribed-${user.id}`,
          });
          thread = await this.conversations.findThread(channelUuid, user.id);
        }
        if (!thread) return;
        await this.db.txAs({ orgId }, async (tx) => {
          const res = await tx.execute(sql`
            SELECT c.id, c.contact_id FROM conversations c
            WHERE c.org_id = ${orgId} AND c.uuid = ${thread.id}::uuid`);
          const conv = res.rows[0] as
            { id: number | string; contact_id: number | string | null } | undefined;
          if (conv) await this.linkContact(tx, orgId, Number(conv.id), conv.contact_id, user);
        });
      },
    );
  }

  /** A broadcast copy in the thread, shown as outbound from the broadcast. Leaves unread alone. */
  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string; broadcastUuid: string },
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.peer_key
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${conversationId}`);
    const row = res.rows[0] as { channel_uuid: string; peer_key: string } | undefined;
    if (!row) return;
    await RequestContextStore.run(
      {
        requestId: `viber-broadcast-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.conversations.recordOutbound({
          channelId: row.channel_uuid,
          peerKey: row.peer_key,
          source: 'broadcast',
          body: m.body,
          providerMessageId: m.providerMessageId,
        }),
    );
  }

  async recordReceipt(orgId: number, channelRowId: number, r: ReceiptInput): Promise<void> {
    const channelUuid = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid FROM channels
        WHERE org_id = ${orgId} AND kind = ${VIBER_KIND} AND external_id = ${String(channelRowId)}`);
      return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
    });
    if (!channelUuid) return;
    await this.receipts.enqueueReceipt(orgId, channelUuid, {
      providerMessageId: r.providerMessageId,
      status: r.status,
      at: r.at,
      ...(r.reason ? { errorMessage: r.reason.slice(0, 255) } : {}),
    });
  }
}

/** The message kind, body and file of a Viber message in the inbox's own vocabulary. */
function normalise(
  b: InboundBody,
): Pick<NormalisedInbound, 'kind' | 'body' | 'media' | 'location'> {
  switch (b.kind) {
    case 'text':
      return { kind: 'text', body: b.text };
    case 'media':
      return {
        kind: 'media',
        ...(b.text !== '' ? { body: b.text } : {}),
        media: {
          // The file's public address (it lives about an hour); the adapter downloads it, guarded to Viber's own hosts.
          providerMediaId: b.url,
          mediaKind: b.mediaKind,
          mime: MIME[b.mediaKind],
          ...(b.name ? { name: b.name } : {}),
        },
      };
    case 'location':
      return {
        kind: 'location',
        body: '[location]',
        location: { latitude: b.latitude, longitude: b.longitude },
      };
    case 'contact':
      return { kind: 'contact', body: `${b.name} ${b.phone}`.trim() || '[contact]' };
    case 'unsupported':
      return { kind: 'unsupported', body: b.label };
  }
}

const MIME = {
  image: 'image/jpeg',
  video: 'video/mp4',
  document: 'application/octet-stream',
} as const;
