import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ContactMessageStats } from '@crm/contracts';

/** Counts of a contact's WhatsApp messages, in one pass over the messages of its WhatsApp conversations. */
@Injectable()
export class ContactMessageStatsRepository {
  async whatsapp(tx: Tx, orgId: number, contactId: number): Promise<ContactMessageStats> {
    // `lead()` reads the next message of the same thread: a sent message whose next one is the contact's was answered. System
    // notices (a transfer, "Connected to ...") are not messages the contact sent or was sent, so they are left out first.
    const res = await tx.execute(sql`
      WITH thread AS (
        SELECT c.id
        FROM conversations c
        JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE c.org_id = ${orgId} AND c.contact_id = ${contactId} AND ch.kind LIKE 'whatsapp%'
      ), m AS (
        SELECT msg.direction, msg.status, msg.delivered_at, msg.read_at,
               lead(msg.direction) OVER (PARTITION BY msg.conversation_id ORDER BY msg.seq) AS next_direction
        FROM messages msg
        WHERE msg.org_id = ${orgId}
          AND msg.conversation_id IN (SELECT id FROM thread)
          AND msg.deleted_at IS NULL
          AND msg.sender_kind <> 'system'
      )
      SELECT
        count(*) FILTER (WHERE direction = 'out')::int AS sent,
        count(*) FILTER (WHERE direction = 'out' AND status <> 'failed'
                           AND (status IN ('delivered', 'read') OR delivered_at IS NOT NULL OR read_at IS NOT NULL))::int AS delivered,
        count(*) FILTER (WHERE direction = 'out' AND status <> 'failed' AND (status = 'read' OR read_at IS NOT NULL))::int AS seen,
        count(*) FILTER (WHERE direction = 'in')::int AS received,
        count(*) FILTER (WHERE direction = 'out' AND status = 'failed')::int AS failed,
        count(*) FILTER (WHERE direction = 'out' AND status <> 'failed' AND next_direction = 'in')::int AS replied
      FROM m
    `);
    const r = res.rows[0] as Record<keyof ContactMessageStats, number> | undefined;
    return {
      sent: Number(r?.sent ?? 0),
      delivered: Number(r?.delivered ?? 0),
      seen: Number(r?.seen ?? 0),
      received: Number(r?.received ?? 0),
      failed: Number(r?.failed ?? 0),
      replied: Number(r?.replied ?? 0),
    };
  }
}
