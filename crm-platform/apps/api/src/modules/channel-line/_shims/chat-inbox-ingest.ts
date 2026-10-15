import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import type { InboundMedia, NormalisedInbound } from '../../../infra/providers/chat-conversations';
import {
  CONVERSATIONS_FACADE,
  ExternalChannelIngest,
  type ConversationsFacade,
  type ExternalAccount,
} from '../../chat-conversations';
import type { InboundMessageInput, InboundRecorded, InboxIngest } from './tokens';

/** The channel kind a LINE channel's threads live on. */
export const LINE_KIND = 'line';
/** What a 1:1 thread is called while LINE has not told the sender's name. */
export const DEFAULT_NAME = 'LINE user';

const NOT_STORED: InboundRecorded = {
  stored: false,
  conversationId: 0,
  contactId: null,
  newContact: false,
  newThread: false,
};

const MEDIA_DEFAULT_MIME: Record<NonNullable<InboundMessageInput['mediaType']>, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mp4',
  document: 'application/octet-stream',
};

/** What the inbox channel of a LINE channel row shows. */
export interface ChannelIdentity {
  id: number;
  displayName: string | null;
  basicId: string | null;
}

/**
 * The LINE side of the inbox, over chat-conversations. A LINE channel is one `line` inbox channel (its handle the channel's row id);
 * each LINE user (or group, or room) is the peer of one perpetual thread on it. A message goes through the shared pipeline (ledger
 * dedup on LINE's message id, gap-free sequence, unread, reopen, realtime); the file is downloaded by the channel adapter with the
 * channel's own token. Still ours, because the inbox cannot know it: a 1:1 sender becomes a contact keyed by the LINE user id.
 */
@Injectable()
export class ChatInboxIngest implements InboxIngest {
  constructor(
    private readonly db: DatabaseService,
    private readonly external: ExternalChannelIngest,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  private account(channel: ChannelIdentity): ExternalAccount {
    return {
      kind: LINE_KIND,
      externalId: String(channel.id),
      name: (channel.displayName || 'LINE').slice(0, 120),
      displayAddress: channel.basicId || null,
    };
  }

  /** Keeps a channel's inbox channel in step with the channel (connected, paused or gone). */
  syncChannel(orgId: number, channel: ChannelIdentity, connected: boolean): Promise<string> {
    return this.external.sync(orgId, this.account(channel), connected);
  }

  async recordInbound(
    orgId: number,
    channelRowId: number,
    m: InboundMessageInput,
  ): Promise<InboundRecorded> {
    const channel = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT display_name, basic_id FROM line_channels WHERE org_id = ${orgId} AND id = ${channelRowId}`,
      );
      const r = res.rows[0] as { display_name: string | null; basic_id: string | null } | undefined;
      return {
        id: channelRowId,
        displayName: r?.display_name ?? null,
        basicId: r?.basic_id ?? null,
      };
    });

    const direct = m.sourceType === 'user';
    const message: NormalisedInbound = {
      providerMessageId: m.providerMessageId,
      peerKey: m.sourceId,
      // A 1:1 thread is named after the person; a group or room keeps LINE's own label (Reference).
      peerName: direct ? m.title : 'LINE',
      kind: m.mediaType && m.mediaMessageId ? 'media' : 'text',
      ...(m.text !== '' ? { body: m.text } : {}),
      ...(m.mediaType && m.mediaMessageId
        ? {
            media: {
              // LINE's message id; the adapter downloads it with the channel's token.
              providerMediaId: m.mediaMessageId,
              mediaKind: m.mediaType as InboundMedia['mediaKind'],
              mime: MEDIA_DEFAULT_MIME[m.mediaType],
              ...(m.fileName ? { name: m.fileName } : {}),
            },
          }
        : {}),
      meta: {
        line: Object.fromEntries(
          Object.entries({
            source_type: m.sourceType,
            source_id: m.sourceId,
            message_id: m.messageId,
            // The reply token powers the free reply path (about a minute); the sender uses it while it is fresh, else pushes.
            reply_token: m.replyToken,
            reply_token_at: m.replyToken ? Math.floor(Date.now() / 1000) : null,
            webhook_event_id: m.webhookEventId,
          }).filter(([, v]) => v !== null && v !== ''),
        ),
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

      // Only a person (not a group or a room) is a contact, keyed by the LINE user id (no phone number).
      let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
      let newContact = false;
      if (direct) {
        const c = await tx.execute(sql`
          INSERT INTO contacts (org_id, name, channel, channel_uid, message, image_url)
          VALUES (${orgId}, ${m.title}, ${LINE_KIND}, ${m.sourceId}, 'Source: LINE', ${m.pictureUrl})
          ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
          DO UPDATE SET name = coalesce(nullif(contacts.name, ''), EXCLUDED.name),
                        image_url = coalesce(nullif(contacts.image_url, ''), EXCLUDED.image_url)
          RETURNING id, name, (xmax = 0) AS inserted`);
        const row = c.rows[0] as { id: number | string; name: string | null; inserted: boolean };
        newContact = row.inserted;
        if (contactId === null) {
          contactId = Number(row.id);
          // The thread is named after the person once, when the contact is first linked (Reference).
          const name = row.name || m.title;
          await tx.execute(sql`
            UPDATE conversations SET contact_id = ${contactId}, title = ${name}, peer_name = ${name}
            WHERE org_id = ${orgId} AND id = ${conversationId}`);
        }
      }
      return {
        stored: true,
        conversationId,
        contactId,
        newContact,
        newThread: out.createdConversation,
      };
    });
  }

  /** A broadcast copy in the thread, shown as outbound from the broadcast. Leaves unread alone. */
  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; broadcastUuid: string },
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.peer_key
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${conversationId}`);
    const row = res.rows[0] as { channel_uuid: string; peer_key: string } | undefined;
    if (!row) return;
    await RequestContextStore.run(
      {
        requestId: `line-broadcast-${randomUUID()}`,
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
          ...(m.providerMessageId ? { providerMessageId: m.providerMessageId } : {}),
        }),
    );
  }
}
