import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  CONTACT_LABEL,
  CONTACT_SOURCE,
  contactNameOf,
  isGenuineInbound,
  isPlaceholderTitle,
  type Normalized,
} from '../ingest-rules';
import type { InstagramInboxIngest, IngestOutcome } from './tokens';

const compact = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );

/**
 * Writes `conversations`, `messages` and `contacts` directly until the team-inbox domain exports its own inbound service. One
 * thread per (organization, thread key): the work is serialised on that key so two events at once cannot make two threads, and
 * a message delivered twice (by the push and by the pull) is stored once.
 */
@Injectable()
export class SqlInstagramIngest implements InstagramInboxIngest {
  async record(tx: Tx, orgId: number, n: Normalized): Promise<IngestOutcome> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ig-thread:${orgId}:${n.rawJid}`}, 0))`,
    );

    const found = await tx.execute(sql`
      SELECT id, title, contact_id FROM conversations
      WHERE org_id = ${orgId} AND channel = 'instagram' AND raw_jid = ${n.rawJid} ORDER BY id LIMIT 1`);
    let conv = found.rows[0] as
      { id: number | string; title: string | null; contact_id: number | string | null } | undefined;
    const newThread = !conv;
    if (!conv) {
      const made = await tx.execute(sql`
        INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_message_at)
        VALUES (${orgId}, ${n.title}, 'instagram', 'instagram', 'instagram', 'pending', 'open', ${n.rawJid}, now())
        RETURNING id, title, contact_id`);
      conv = made.rows[0] as {
        id: number | string;
        title: string | null;
        contact_id: number | string | null;
      };
    } else if (n.resolvedHuman && isPlaceholderTitle(conv.title ?? '') && conv.title !== n.title) {
      // The first message often carries only the sender's numeric id. A real name replaces that placeholder, never a title an
      // operator typed.
      await tx.execute(
        sql`UPDATE conversations SET title = ${n.title} WHERE org_id = ${orgId} AND id = ${Number(conv.id)}`,
      );
    }
    const conversationId = Number(conv.id);
    let contactId = conv.contact_id === null ? null : Number(conv.contact_id);

    if (n.providerMid !== '') {
      // Our own sends carry the engine's id at `wa_message_id`, so pulling them back never duplicates them.
      const dup = await tx.execute(sql`
        SELECT id, meta FROM messages
        WHERE org_id = ${orgId} AND conversation_id = ${conversationId}
          AND (meta -> 'instagram' ->> 'message_id' = ${n.providerMid} OR meta ->> 'wa_message_id' = ${n.providerMid})
        ORDER BY id LIMIT 1`);
      const existing = dup.rows[0] as
        { id: number | string; meta: Record<string, unknown> | null } | undefined;
      if (existing) {
        // A row stored before its buttons were known (or one of our own sends) shows as plain text; give it the card.
        const meta = existing.meta ?? {};
        if (n.buttons && !(Array.isArray(meta.buttons) && meta.buttons.length > 0)) {
          await tx.execute(sql`
            UPDATE messages SET meta = ${JSON.stringify({ ...meta, buttons: n.buttons })}::jsonb
            WHERE org_id = ${orgId} AND id = ${Number(existing.id)}`);
        }
        return {
          stored: false,
          conversationId,
          messageId: Number(existing.id),
          contactId,
          newThread,
        };
      }
    }

    const meta = compact({
      buttons: n.buttons,
      instagram: compact({
        conversation_id: n.convId,
        message_id: n.providerMid,
        account: n.accountUsername,
        account_id: n.accountId,
        handle: n.handle,
        avatar: n.avatar,
        media_url: n.mediaUrl,
        is_test: n.isTest ? true : null,
        trace_id: n.traceId,
      }),
    });
    const inbound = n.direction === 'in';
    const msg = await tx.execute(sql`
      INSERT INTO messages (org_id, conversation_id, direction, body, media_path, media_type, status, provider, meta, sent_at, delivered_at)
      VALUES (${orgId}, ${conversationId}, ${n.direction}, ${n.text}, ${n.mediaUrl || null},
              ${n.type !== 'text' ? n.type : null}, ${inbound ? 'received' : 'sent'}, 'instagram',
              ${JSON.stringify(meta)}::jsonb, ${n.sentAt}, ${n.sentAt})
      RETURNING id`);
    const messageId = Number((msg.rows[0] as { id: number | string }).id);

    // GREATEST: an old message must not drag a thread's clock back past a live one. The window runs from the last inbound.
    await tx.execute(sql`
      UPDATE conversations SET
             last_message_at = greatest(coalesce(last_message_at, ${n.sentAt}), ${n.sentAt}),
             ${
               inbound
                 ? sql`last_inbound_at = greatest(coalesce(last_inbound_at, ${n.sentAt}), ${n.sentAt}), unread_count = unread_count + 1,`
                 : sql`last_outbound_at = greatest(coalesce(last_outbound_at, ${n.sentAt}), ${n.sentAt}),`
             }
             preview = ${n.preview}
      WHERE org_id = ${orgId} AND id = ${conversationId}`);

    // The sender becomes a lead, keyed by the sender id (no phone). A test ping, a history message and our own send never do.
    if (isGenuineInbound(n) && n.igsid !== '') {
      const c = await tx.execute(sql`
        INSERT INTO contacts (org_id, name, channel, channel_uid, message, image_url)
        VALUES (${orgId}, ${contactNameOf(n) ?? CONTACT_LABEL}, 'instagram', ${n.igsid}, ${CONTACT_SOURCE}, ${n.avatar || null})
        ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
        DO UPDATE SET name = coalesce(nullif(contacts.name, ''), EXCLUDED.name),
                      image_url = coalesce(nullif(contacts.image_url, ''), EXCLUDED.image_url)
        RETURNING id`);
      const id = Number((c.rows[0] as { id: number | string }).id);
      if (contactId === null) {
        contactId = id;
        await tx.execute(
          sql`UPDATE conversations SET contact_id = ${id} WHERE org_id = ${orgId} AND id = ${conversationId}`,
        );
      }
    }

    return { stored: true, conversationId, messageId, contactId, newThread };
  }

  async threadClock(tx: Tx, orgId: number): Promise<Map<string, Date | null>> {
    const res = await tx.execute(sql`
      SELECT raw_jid, last_message_at FROM conversations WHERE org_id = ${orgId} AND channel = 'instagram'`);
    return new Map(
      (res.rows as Array<{ raw_jid: string; last_message_at: Date | string | null }>).map((r) => [
        r.raw_jid,
        r.last_message_at ? new Date(r.last_message_at) : null,
      ]),
    );
  }
}
