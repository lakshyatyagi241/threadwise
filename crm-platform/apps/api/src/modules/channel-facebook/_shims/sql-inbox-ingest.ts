import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { preview } from '../page-rules';
import type { InboundInput, InboundRecorded, InboxIngest } from './tokens';

/** The placeholder a thread and a contact carry until Meta tells us a real name. */
export const PLACEHOLDER_NAME = 'Facebook user';

/**
 * Writes `conversations`, `messages` and `contacts` directly until the team-inbox domain exports its own inbound service.
 * One thread per (organization, thread key): the work is serialised on that key so two events at once cannot make two threads.
 */
@Injectable()
export class SqlInboxIngest implements InboxIngest {
  async alreadyStored(tx: Tx, orgId: number, dedup: string): Promise<boolean> {
    if (dedup === '') return false;
    const res = await tx.execute(sql`
      SELECT 1 FROM messages
      WHERE org_id = ${orgId} AND meta -> 'facebook' ->> 'message_id' = ${dedup}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async recordInbound(tx: Tx, orgId: number, m: InboundInput): Promise<InboundRecorded> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fb-thread:${orgId}:${m.rawJid}`}, 0))`,
    );
    // Checked under the lock, so a redelivery racing the first delivery cannot store the message twice.
    if (await this.alreadyStored(tx, orgId, m.dedup)) {
      const found = await tx.execute(sql`
        SELECT id, contact_id FROM conversations
        WHERE org_id = ${orgId} AND channel = 'facebook' AND raw_jid = ${m.rawJid} ORDER BY id LIMIT 1`);
      const c = found.rows[0] as
        { id: number | string; contact_id: number | string | null } | undefined;
      return {
        stored: false,
        conversationId: c ? Number(c.id) : 0,
        contactId: c?.contact_id == null ? null : Number(c.contact_id),
        newThread: false,
      };
    }

    const found = await tx.execute(sql`
      SELECT id, contact_id FROM conversations
      WHERE org_id = ${orgId} AND channel = 'facebook' AND raw_jid = ${m.rawJid} ORDER BY id LIMIT 1`);
    let conv = found.rows[0] as
      { id: number | string; contact_id: number | string | null } | undefined;
    const newThread = !conv;
    if (!conv) {
      const made = await tx.execute(sql`
        INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_message_at)
        VALUES (${orgId}, ${m.title}, 'facebook', 'facebook', 'facebook', 'pending', 'open', ${m.rawJid}, now())
        RETURNING id, contact_id`);
      conv = made.rows[0] as { id: number | string; contact_id: number | string | null };
    }
    const conversationId = Number(conv.id);

    // Only a DM sender is a lead; comment authors are not turned into contacts (WD-FB-009 rule 6).
    let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
    if (m.kind === 'dm' && m.senderId !== '') {
      const c = await tx.execute(sql`
        INSERT INTO contacts (org_id, name, channel, channel_uid, message)
        VALUES (${orgId}, ${m.title}, 'facebook', ${m.senderId}, 'Source: Facebook DM')
        ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
        DO UPDATE SET name = coalesce(nullif(contacts.name, ''), EXCLUDED.name)
        RETURNING id`);
      const row = c.rows[0] as { id: number | string };
      if (contactId === null) {
        contactId = Number(row.id);
        await tx.execute(
          sql`UPDATE conversations SET contact_id = ${contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`,
        );
      }
    }

    const at = m.at ?? new Date();
    const meta = { facebook: { ...m.meta, message_id: m.dedup } };
    await tx.execute(sql`
      INSERT INTO messages (org_id, conversation_id, contact_id, direction, from_number, body, media_path, media_type, status,
                            provider, meta, sent_at, delivered_at)
      VALUES (${orgId}, ${conversationId}, ${contactId}, 'in', ${m.senderId || null}, ${m.body}, ${m.mediaUrl},
              ${m.mediaUrl ? m.mediaType : null}, 'received', 'facebook', ${JSON.stringify(meta)}::jsonb, ${at}, ${at})`);

    // GREATEST: an imported old message must not drag a thread's clock back past a live one.
    await tx.execute(sql`
      UPDATE conversations SET
             last_message_at = greatest(coalesce(last_message_at, ${at}), ${at}),
             last_inbound_at = greatest(coalesce(last_inbound_at, ${at}), ${at}),
             preview = ${preview(m.body)}, unread_count = unread_count + 1,
             inbox_status = CASE WHEN inbox_status = 'resolved' THEN 'open' ELSE inbox_status END
      WHERE org_id = ${orgId} AND id = ${conversationId}`);

    return { stored: true, conversationId, contactId, newThread };
  }

  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; broadcastUuid: string },
  ): Promise<void> {
    const meta = {
      source: 'facebook_broadcast',
      broadcast_id: m.broadcastUuid,
      ...(m.providerMessageId ? { wa_message_id: m.providerMessageId } : {}),
    };
    await tx.execute(sql`
      INSERT INTO messages (org_id, conversation_id, direction, body, status, provider, meta, sent_at)
      VALUES (${orgId}, ${conversationId}, 'out', ${m.body}, 'sent', 'facebook', ${JSON.stringify(meta)}::jsonb, now())`);
    // Outbound is not unread: only the customer's messages are.
    await tx.execute(sql`
      UPDATE conversations SET last_message_at = now(), last_outbound_at = now()
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
  }

  async lastInboundAt(tx: Tx, orgId: number, conversationId: number): Promise<Date | null> {
    const res = await tx.execute(
      sql`SELECT last_inbound_at FROM conversations WHERE org_id = ${orgId} AND id = ${conversationId}`,
    );
    const v = (res.rows[0] as { last_inbound_at: Date | string | null } | undefined)
      ?.last_inbound_at;
    return v ? new Date(v) : null;
  }

  async applyProfile(
    tx: Tx,
    orgId: number,
    conversationId: number,
    contactId: number | null,
    p: { name: string; avatarUrl: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET title = ${p.name},
             routing_meta = coalesce(routing_meta, '{}'::jsonb) || ${JSON.stringify({ fb_avatar: p.avatarUrl ?? '' })}::jsonb
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
    if (contactId !== null) {
      await tx.execute(sql`
        UPDATE contacts SET name = ${p.name}, image_url = coalesce(nullif(image_url, ''), ${p.avatarUrl})
        WHERE org_id = ${orgId} AND id = ${contactId} AND coalesce(name, '') IN ('', ${PLACEHOLDER_NAME})`);
    }
  }
}
