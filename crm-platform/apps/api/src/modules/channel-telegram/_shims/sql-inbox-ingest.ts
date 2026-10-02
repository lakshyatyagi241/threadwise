import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { preview, threadKey } from '../update-rules';
import type { InboundMessageInput, InboundRecorded, InboxIngest } from './tokens';

/**
 * Writes `conversations`, `messages` and `contacts` directly until the team-inbox domain exports its own inbound service.
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
    const jid = threadKey(botRowId, m.chatId);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tg-thread:${orgId}:${jid}`}, 0))`,
    );

    const found = await tx.execute(sql`
      SELECT id, contact_id FROM conversations
      WHERE org_id = ${orgId} AND channel = 'telegram' AND raw_jid = ${jid} ORDER BY id LIMIT 1`);
    let conv = found.rows[0] as
      { id: number | string; contact_id: number | string | null } | undefined;
    const newThread = !conv;
    if (!conv) {
      const made = await tx.execute(sql`
        INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_message_at)
        VALUES (${orgId}, ${m.title}, 'telegram', 'telegram', 'telegram', 'pending', 'open', ${jid}, now())
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
    await tx.execute(sql`
      INSERT INTO messages (org_id, conversation_id, contact_id, direction, from_number, body, media_path, media_type, status,
                            provider, meta, sent_at, delivered_at)
      VALUES (${orgId}, ${conversationId}, ${contactId}, 'in', ${m.fromId}, ${m.text}, ${m.mediaPath},
              ${m.mediaPath ? m.mediaType : null}, 'received', 'telegram', ${JSON.stringify(meta)}::jsonb, now(), now())`);

    // A payment keeps the thread title; a message renames it. A resolved thread reopens.
    await tx.execute(sql`
      UPDATE conversations SET last_message_at = now(), last_inbound_at = now(), provider = 'telegram',
             title = CASE WHEN ${m.event !== null} THEN title ELSE ${m.title} END,
             preview = ${preview(m.text)}, unread_count = unread_count + 1,
             inbox_status = CASE WHEN inbox_status = 'resolved' THEN 'open' ELSE inbox_status END
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
    await tx.execute(sql`
      INSERT INTO messages (org_id, conversation_id, direction, body, status, provider, meta, sent_at)
      VALUES (${orgId}, ${conversationId}, 'out', ${m.body}, 'sent', 'telegram', ${JSON.stringify(meta)}::jsonb, now())`);
    // Outbound is not unread: only the customer's messages are.
    await tx.execute(sql`
      UPDATE conversations SET last_message_at = now(), last_outbound_at = now()
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
  }
}
