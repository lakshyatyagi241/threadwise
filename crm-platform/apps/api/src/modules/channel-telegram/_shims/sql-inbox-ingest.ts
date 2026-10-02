import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { preview } from '../update-rules';
import type { InboundMessageInput, InboundRecorded, InboxIngest } from './tokens';

const MEDIA_KINDS: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  document: 'document',
  animation: 'video',
};
const mediaKindOf = (t: string | null): string => (t ? (MEDIA_KINDS[t] ?? 'document') : 'document');

/**
 * Writes `channels`, `conversations`, `messages` and `contacts` directly until the team-inbox domain exports its own inbound service.
 * One thread per (organization, bot, chat): the work is serialised on that key so two updates at once cannot make two threads.
 */
@Injectable()
export class SqlInboxIngest implements InboxIngest {
  async recordInbound(
    tx: Tx,
    orgId: number,
    botRowId: number,
    m: InboundMessageInput,
  ): Promise<InboundRecorded> {
    // A bot is a channel of kind `telegram` (one per bot, keyed by the bot's row id), and each Telegram chat is the peer of one
    // perpetual thread on it, like a WhatsApp number on a WhatsApp channel. The work is serialised per thread so two updates at
    // once cannot make two threads.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tg-thread:${orgId}:${botRowId}:${m.chatId}`}, 0))`,
    );
    const channelId = await this.ensureChannel(tx, orgId, botRowId);

    const found = await tx.execute(sql`
      SELECT id, contact_id FROM conversations
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND peer_key = ${m.chatId} LIMIT 1`);
    let conv = found.rows[0] as
      { id: number | string; contact_id: number | string | null } | undefined;
    const newThread = !conv;
    if (!conv) {
      const made = await tx.execute(sql`
        INSERT INTO conversations (org_id, channel_id, peer_key, peer_name, title, status, last_message_at)
        VALUES (${orgId}, ${channelId}, ${m.chatId}, ${m.title}, ${m.title}, 'open', now())
        RETURNING id, contact_id`);
      conv = made.rows[0] as { id: number | string; contact_id: number | string | null };
    }
    const conversationId = Number(conv.id);

    // The sender is one contact per organization, keyed by the Telegram user id (no phone number).
    let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
    let newContact = false;
    if (m.uid !== '') {
      const c = await tx.execute(sql`
        INSERT INTO contacts (org_id, name, channel, channel_uid, message)
        VALUES (${orgId}, ${m.title}, 'telegram', ${m.uid}, 'Source: Telegram DM')
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

    const meta = {
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
    };
    await this.append(tx, orgId, conversationId, {
      direction: 'in',
      senderKind: 'customer',
      status: 'received',
      kind: m.mediaPath ? mediaKindOf(m.mediaType) : 'text',
      body: m.text,
      mediaKey: m.mediaPath,
      meta,
      providerMessageId: m.messageId,
    });

    // A payment keeps the thread title; a message renames it. A resolved, closed or snoozed thread reopens.
    await tx.execute(sql`
      UPDATE conversations SET last_message_at = now(), last_inbound_at = now(),
             title = CASE WHEN ${m.event !== null} THEN title ELSE ${m.title} END,
             peer_name = ${m.title},
             preview = ${preview(m.text)}, unread_count = unread_count + 1,
             waiting_since = coalesce(waiting_since, now()),
             status = CASE WHEN status IN ('resolved', 'closed', 'snoozed') THEN 'open' ELSE status END
      WHERE org_id = ${orgId} AND id = ${conversationId}`);

    return { conversationId, contactId, newContact, newThread };
  }

  async setContactImage(tx: Tx, orgId: number, contactId: number, url: string): Promise<void> {
    await tx.execute(sql`
      UPDATE contacts SET image_url = ${url}
      WHERE org_id = ${orgId} AND id = ${contactId} AND coalesce(image_url, '') = ''`);
  }

  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; broadcastUuid: string },
  ): Promise<void> {
    const meta = {
      source: 'telegram_broadcast',
      broadcast_id: m.broadcastUuid,
      ...(m.providerMessageId ? { wa_message_id: m.providerMessageId } : {}),
    };
    await this.append(tx, orgId, conversationId, {
      direction: 'out',
      senderKind: 'broadcast',
      status: 'sent',
      kind: 'text',
      body: m.body,
      mediaKey: null,
      meta,
      providerMessageId: m.providerMessageId,
    });
    // Outbound is not unread: only the customer's messages are.
    await tx.execute(sql`
      UPDATE conversations SET last_message_at = now(), last_outbound_at = now()
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
  }

  /** The `telegram` channel of a bot, created on its first thread and renamed with the bot. */
  private async ensureChannel(tx: Tx, orgId: number, botRowId: number): Promise<number> {
    const bot = await tx.execute(
      sql`SELECT bot_name, bot_username, active FROM telegram_bots WHERE org_id = ${orgId} AND id = ${botRowId}`,
    );
    const b = bot.rows[0] as
      { bot_name: string | null; bot_username: string | null; active: boolean } | undefined;
    const name = (b?.bot_name || b?.bot_username || 'Telegram bot').slice(0, 120);
    const res = await tx.execute(sql`
      INSERT INTO channels (org_id, kind, name, status, external_id, display_address)
      VALUES (${orgId}, 'telegram', ${name}, ${b?.active === false ? 'disconnected' : 'connected'}, ${String(botRowId)},
              ${b?.bot_username ? `@${b.bot_username}` : null})
      ON CONFLICT (org_id, kind, external_id) DO UPDATE SET name = EXCLUDED.name, display_address = EXCLUDED.display_address
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /**
   * Adds one message to a thread: takes the next `msg_seq` (and so the thread's row lock) and stamps the thread's pointer to its
   * latest message. Preview, unread and activity stamps stay with the callers, which know the direction.
   */
  private async append(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: {
      direction: 'in' | 'out';
      senderKind: 'customer' | 'broadcast';
      status: 'received' | 'sent';
      kind: string;
      body: string;
      mediaKey: string | null;
      meta: Record<string, unknown>;
      providerMessageId: string | null;
    },
  ): Promise<void> {
    const ids = await tx.execute(sql`SELECT nextval('messages_id_seq') AS id`);
    const id = Number((ids.rows[0] as { id: number | string }).id);
    const seq = await tx.execute(sql`
      UPDATE conversations SET msg_seq = msg_seq + 1, last_message_id = ${id}
      WHERE org_id = ${orgId} AND id = ${conversationId} RETURNING msg_seq`);
    await tx.execute(sql`
      INSERT INTO messages (id, org_id, conversation_id, seq, direction, kind, sender_kind, body, media_key, status, meta,
                            provider_message_id, provider_ts, sent_at, delivered_at)
      VALUES (${id}, ${orgId}, ${conversationId}, ${Number((seq.rows[0] as { msg_seq: number | string }).msg_seq)},
              ${m.direction}, ${m.kind}, ${m.senderKind}, ${m.body}, ${m.mediaKey}, ${m.status},
              ${JSON.stringify(m.meta)}::jsonb, ${m.providerMessageId}, now(), now(),
              ${m.direction === 'in' ? sql`now()` : null})`);
  }
}
