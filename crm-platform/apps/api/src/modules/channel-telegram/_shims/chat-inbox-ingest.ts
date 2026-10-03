import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
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

/** The channel kind a bot's threads live on. */
export const TELEGRAM_KIND = 'telegram';

const NOT_STORED: InboundRecorded = {
  stored: false,
  conversationId: 0,
  contactId: null,
  newContact: false,
  newThread: false,
};

const MEDIA_KINDS: Record<string, InboundMedia['mediaKind']> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'audio',
  document: 'document',
  animation: 'video',
};
const MEDIA_DEFAULT_MIME: Record<InboundMedia['mediaKind'], string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/ogg',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};
const mediaKindOf = (t: string | null): InboundMedia['mediaKind'] =>
  (t ? MEDIA_KINDS[t] : undefined) ?? 'document';

/**
 * The Telegram side of the inbox, over chat-conversations. A bot is one `telegram` channel (its handle the bot's row id); each
 * Telegram chat is the peer of one perpetual thread on it. A message goes through the shared pipeline (ledger dedup on
 * `<chat>:<message id>`, gap-free sequence, unread, reopen, realtime); the file is copied by the channel adapter, with the bot's own
 * token. Still ours, because the inbox cannot know it: the sender becomes a contact keyed by the Telegram user id (no phone).
 */
@Injectable()
export class ChatInboxIngest implements InboxIngest {
  constructor(
    private readonly db: DatabaseService,
    private readonly external: ExternalChannelIngest,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  private account(bot: {
    id: number;
    name: string | null;
    username: string | null;
  }): ExternalAccount {
    return {
      kind: TELEGRAM_KIND,
      externalId: String(bot.id),
      name: (bot.name || bot.username || 'Telegram bot').slice(0, 120),
      displayAddress: bot.username ? `@${bot.username}` : null,
    };
  }

  /** Keeps a bot's inbox channel in step with the bot (connected, paused or gone). */
  syncBot(
    orgId: number,
    bot: { id: number; name: string | null; username: string | null },
    connected: boolean,
  ): Promise<string> {
    return this.external.sync(orgId, this.account(bot), connected);
  }

  async recordInbound(
    orgId: number,
    botRowId: number,
    m: InboundMessageInput,
  ): Promise<InboundRecorded> {
    const bot = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT bot_name, bot_username FROM telegram_bots WHERE org_id = ${orgId} AND id = ${botRowId}`,
      );
      const r = res.rows[0] as { bot_name: string | null; bot_username: string | null } | undefined;
      return { id: botRowId, name: r?.bot_name ?? null, username: r?.bot_username ?? null };
    });

    const kind = mediaKindOf(m.mediaType);
    const message: NormalisedInbound = {
      // A Telegram message id is unique only inside its chat.
      providerMessageId: m.messageId !== null ? `${m.chatId}:${m.messageId}` : `tg-${randomUUID()}`,
      peerKey: m.chatId,
      peerName: m.title,
      kind: m.fileId ? 'media' : 'text',
      ...(m.text !== '' ? { body: m.text } : {}),
      ...(m.fileId
        ? {
            media: {
              // Telegram's file id; the adapter downloads it with the bot's token.
              providerMediaId: m.fileId,
              mediaKind: kind,
              mime: MEDIA_DEFAULT_MIME[kind],
              ...(m.mediaType === 'voice' ? { voice: true } : {}),
            },
          }
        : {}),
      meta: {
        telegram: Object.fromEntries(
          Object.entries({
            chat_id: m.chatId,
            message_id: m.messageId,
            chat_type: m.chatType,
            chat_title: m.title === 'Telegram' ? null : m.title,
            from_id: m.fromId,
            username: m.username,
            first_name: m.firstName,
            last_name: m.lastName,
            file_id: m.fileId,
            event: m.event,
          }).filter(([, v]) => v !== null && v !== ''),
        ),
        ...(m.payment ? { payment: m.payment } : {}),
      },
      providerTimestamp: new Date(),
    };
    const out = await this.external.inbound(orgId, this.account(bot), message);
    if (out.outcome !== 'stored') return NOT_STORED;

    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${out.conversationUuid}::uuid`,
      );
      const conv = res.rows[0] as
        { id: number | string; contact_id: number | string | null } | undefined;
      if (!conv) return NOT_STORED;
      const conversationId = Number(conv.id);

      // A payment keeps the thread title; a message renames it.
      await tx.execute(sql`
        UPDATE conversations SET
               title = CASE WHEN ${m.event !== null} THEN title ELSE ${m.title} END,
               peer_name = ${m.title}
        WHERE org_id = ${orgId} AND id = ${conversationId}`);

      // The sender is one contact per organization, keyed by the Telegram user id (no phone number).
      let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
      let newContact = false;
      if (m.uid !== '') {
        const c = await tx.execute(sql`
          INSERT INTO contacts (org_id, name, channel, channel_uid, message)
          VALUES (${orgId}, ${m.title}, ${TELEGRAM_KIND}, ${m.uid}, 'Source: Telegram DM')
          ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
          DO UPDATE SET name = coalesce(nullif(contacts.name, ''), EXCLUDED.name)
          RETURNING id, (xmax = 0) AS inserted`);
        const row = c.rows[0] as { id: number | string; inserted: boolean };
        newContact = row.inserted;
        if (contactId === null) {
          contactId = Number(row.id);
          await tx.execute(
            sql`UPDATE conversations SET contact_id = ${contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`,
          );
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

  async setContactImage(tx: Tx, orgId: number, contactId: number, url: string): Promise<void> {
    await tx.execute(sql`
      UPDATE contacts SET image_url = ${url}
      WHERE org_id = ${orgId} AND id = ${contactId} AND coalesce(image_url, '') = ''`);
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
        requestId: `tg-broadcast-${randomUUID()}`,
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
          ...(m.providerMessageId
            ? { providerMessageId: `${row.peer_key}:${m.providerMessageId}` }
            : {}),
        }),
    );
  }
}
