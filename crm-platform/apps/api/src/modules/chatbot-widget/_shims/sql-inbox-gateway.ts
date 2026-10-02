import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  AI_SOURCE,
  phoneDigits,
  PREVIEW_LENGTH,
  truncate,
  visitorDisplayName,
} from '../widget-rules';
import type {
  ConversationStub,
  InboxGateway,
  InboxLine,
  VisitorForInbox,
  WidgetForInbox,
} from './tokens';

/**
 * A widget is a channel of kind `webchat` (one per widget, keyed by the widget's uuid), and each visitor is the peer of one
 * perpetual thread on it, like a WhatsApp number on a WhatsApp channel.
 */
const CHANNEL_KIND = 'webchat';

interface LineRow {
  id: number | string;
  direction: string;
  body: string | null;
  agent_id: number | string | null;
  sent_at: Date | string | null;
}

const toLine = (r: LineRow): InboxLine => ({
  id: Number(r.id),
  direction: r.direction,
  body: r.body,
  agentId: r.agent_id === null ? null : Number(r.agent_id),
  sentAt: r.sent_at ? new Date(r.sent_at) : null,
});

/**
 * Writes the visitor's thread into `channels`, `conversations`, `messages` and `contacts` directly, until the conversations and
 * contacts domains export services for it. Every method runs in the caller's tenant transaction. A message takes the next
 * `msg_seq` of its thread, which also takes the thread's row lock, so two writers on one thread never interleave.
 */
@Injectable()
export class SqlInboxGateway implements InboxGateway {
  private readonly logger = new Logger(SqlInboxGateway.name);

  async ensureConversation(
    tx: Tx,
    orgId: number,
    widget: WidgetForInbox,
    visitor: VisitorForInbox,
  ): Promise<ConversationStub> {
    if (visitor.conversationId !== null) {
      const existing = await tx.execute(sql`
        SELECT id FROM conversations WHERE org_id = ${orgId} AND id = ${visitor.conversationId}`);
      const row = existing.rows[0] as { id: number | string } | undefined;
      // A deleted thread is replaced by a new one and the visitor is pointed at it (TW-WGT-015 rule 1).
      if (row) return { id: Number(row.id), created: false };
    }

    const channelId = await this.ensureChannel(tx, orgId, widget);
    const routingMeta = {
      widget_id: widget.uuid,
      widget_name: widget.name,
      visitor_uuid: visitor.visitorUuid,
      visitor_name: visitor.name,
      assistant_id: widget.assistantUuid,
    };
    // One thread per (channel, visitor): the conflict arm makes two first messages arriving together share one thread.
    const created = await tx.execute(sql`
      INSERT INTO conversations (org_id, channel_id, peer_key, peer_name, title, preview, status, last_message_at, routing_meta)
      VALUES (${orgId}, ${channelId}, ${visitor.visitorUuid}, ${visitor.name}, ${visitorDisplayName(visitor)},
              ${widget.welcomeMessage ? truncate(widget.welcomeMessage, PREVIEW_LENGTH) : ''},
              'open', now(), ${JSON.stringify(routingMeta)}::jsonb)
      ON CONFLICT (org_id, channel_id, peer_key) DO UPDATE SET updated_at = now()
      RETURNING id, (xmax = 0) AS inserted`);
    const conv = created.rows[0] as { id: number | string; inserted: boolean };
    const conversationId = Number(conv.id);
    await tx.execute(sql`
      UPDATE chatbot_widget_visitors SET conversation_id = ${conversationId}
      WHERE org_id = ${orgId} AND id = ${visitor.id}`);
    if (!conv.inserted) return { id: conversationId, created: false };

    await this.linkContact(tx, orgId, widget, visitor, conversationId);

    // The opening line is a message of the thread, so agents see it as the first bubble and a reload repaints it.
    if (widget.welcomeMessage) {
      await this.append(tx, orgId, conversationId, {
        direction: 'out',
        senderKind: 'bot',
        status: 'sent',
        body: widget.welcomeMessage,
        meta: { widget_id: widget.uuid, source: 'welcome', channel: 'chatbot_widget' },
      });
    }
    return { id: conversationId, created: true };
  }

  /** The webchat channel of a widget, created on its first thread and renamed with the widget. */
  private async ensureChannel(tx: Tx, orgId: number, widget: WidgetForInbox): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO channels (org_id, kind, name, status, external_id, created_by)
      VALUES (${orgId}, ${CHANNEL_KIND}, ${widget.name}, 'connected', ${widget.uuid}, ${widget.userId})
      ON CONFLICT (org_id, kind, external_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /**
   * Adds one message to a thread: takes the next `seq` (and the row lock) and stamps the thread's pointer to its latest message.
   * Preview, unread and activity stamps stay with the callers, which know the direction.
   */
  private async append(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: {
      direction: 'in' | 'out';
      senderKind: 'customer' | 'bot';
      status: 'received' | 'sent';
      body: string;
      meta: Record<string, unknown>;
    },
  ): Promise<{ id: number; sentAt: Date }> {
    const ids = await tx.execute(sql`SELECT nextval('messages_id_seq') AS id`);
    const id = Number((ids.rows[0] as { id: number | string }).id);
    const seq = await tx.execute(sql`
      UPDATE conversations SET msg_seq = msg_seq + 1, last_message_id = ${id}
      WHERE org_id = ${orgId} AND id = ${conversationId} RETURNING msg_seq`);
    const res = await tx.execute(sql`
      INSERT INTO messages (id, org_id, conversation_id, seq, direction, kind, sender_kind, body, status, meta, provider_ts, sent_at)
      VALUES (${id}, ${orgId}, ${conversationId}, ${Number((seq.rows[0] as { msg_seq: number | string }).msg_seq)},
              ${m.direction}, 'text', ${m.senderKind}, ${m.body}, ${m.status}, ${JSON.stringify(m.meta)}::jsonb, now(),
              ${m.direction === 'out' ? sql`now()` : null})
      RETURNING provider_ts`);
    return { id, sentAt: new Date((res.rows[0] as { provider_ts: Date | string }).provider_ts) };
  }
  /**
   * One contact per visitor so the name, email and phone show in the inbox contact panel and in Contacts: an existing
   * contact whose phone matches, else a stable per-visitor row keyed by the widget channel. Only empty fields are filled.
   * Any failure is logged and leaves the thread without a contact; it never fails the message (TW-WGT-015 rule 2).
   */
  private async linkContact(
    tx: Tx,
    orgId: number,
    widget: WidgetForInbox,
    visitor: VisitorForInbox,
    conversationId: number,
  ): Promise<void> {
    try {
      await tx.transaction(async (sp) => {
        const digits = phoneDigits(visitor.phone);
        let contactId: number | null = null;
        if (digits !== '') {
          const hit = await sp.execute(sql`
            SELECT id FROM contacts
            WHERE org_id = ${orgId} AND regexp_replace(coalesce(normalized_phone, ''), '[^0-9]', '', 'g') = ${digits}
            ORDER BY id LIMIT 1`);
          if (hit.rows[0]) contactId = Number((hit.rows[0] as { id: number | string }).id);
        }
        if (contactId === null) {
          const keyed = await sp.execute(sql`
            SELECT id FROM contacts
            WHERE org_id = ${orgId} AND channel = 'chatbot_widget' AND channel_uid = ${visitor.visitorUuid}`);
          if (keyed.rows[0]) contactId = Number((keyed.rows[0] as { id: number | string }).id);
        }
        const phone = digits === '' ? null : `+${digits}`;
        if (contactId === null) {
          const inserted = await sp.execute(sql`
            INSERT INTO contacts (org_id, name, first_name, email, phone, owner_id, channel, channel_uid, source)
            VALUES (${orgId}, ${visitor.name}, ${visitor.name}, ${visitor.email}, ${phone}, ${widget.userId},
                    'chatbot_widget', ${visitor.visitorUuid}, 'chatbot_widget')
            RETURNING id`);
          contactId = Number((inserted.rows[0] as { id: number | string }).id);
        } else {
          await sp.execute(sql`
            UPDATE contacts SET
              name = COALESCE(name, ${visitor.name}),
              first_name = COALESCE(first_name, ${visitor.name}),
              email = COALESCE(email, ${visitor.email}),
              phone = COALESCE(phone, ${phone}),
              owner_id = COALESCE(owner_id, ${widget.userId})
            WHERE org_id = ${orgId} AND id = ${contactId}`);
        }
        await sp.execute(sql`
          UPDATE conversations SET contact_id = ${contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`);
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[WGT] contact upsert failed');
    }
  }

  async insertInbound(
    tx: Tx,
    orgId: number,
    conversation: ConversationStub,
    widget: WidgetForInbox,
    visitorUuid: string,
    body: string,
  ): Promise<{ id: number; sentAt: Date }> {
    const meta = { widget_id: widget.uuid, visitor_uuid: visitorUuid, channel: 'chatbot_widget' };
    const msg = await this.append(tx, orgId, conversation.id, {
      direction: 'in',
      senderKind: 'customer',
      status: 'received',
      body,
      meta,
    });
    // `status` is deliberately untouched: Reference never reopened a resolved or snoozed widget thread (TW-WGT-014 #3).
    await tx.execute(sql`
      UPDATE conversations SET preview = ${truncate(body, PREVIEW_LENGTH)}, last_message_at = now(),
                               last_inbound_at = now(), unread_count = unread_count + 1,
                               waiting_since = COALESCE(waiting_since, now())
      WHERE org_id = ${orgId} AND id = ${conversation.id}`);
    return msg;
  }

  async insertAssistantReply(
    tx: Tx,
    orgId: number,
    conversation: ConversationStub,
    widget: WidgetForInbox,
    assistantUuid: string | null,
    body: string,
  ): Promise<{ id: number; sentAt: Date }> {
    const meta = {
      widget_id: widget.uuid,
      assistant_id: assistantUuid,
      source: AI_SOURCE,
      channel: 'chatbot_widget',
    };
    const msg = await this.append(tx, orgId, conversation.id, {
      direction: 'out',
      senderKind: 'bot',
      status: 'sent',
      body,
      meta,
    });
    await tx.execute(sql`
      UPDATE conversations SET preview = ${truncate(body, PREVIEW_LENGTH)}, last_message_at = now(),
                               last_outbound_at = now()
      WHERE org_id = ${orgId} AND id = ${conversation.id}`);
    return msg;
  }

  async humanHasTakenOver(tx: Tx, orgId: number, conversationId: number): Promise<boolean> {
    // The widget's own lines are written by the bot; an operator's reply from the inbox carries `sender_kind = 'agent'`.
    const res = await tx.execute(sql`
      SELECT 1 FROM messages
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND direction = 'out' AND sender_kind = 'agent'
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async recent(tx: Tx, orgId: number, conversationId: number, limit: number): Promise<InboxLine[]> {
    const res = await tx.execute(sql`
      SELECT id, direction, body, agent_id, sent_at FROM (
        SELECT id, direction, body, sender_agent_id AS agent_id, COALESCE(sent_at, provider_ts, created_at) AS sent_at
        FROM messages
        WHERE org_id = ${orgId} AND conversation_id = ${conversationId}
        ORDER BY id DESC LIMIT ${limit}
      ) t ORDER BY id`);
    return (res.rows as unknown as LineRow[]).map(toLine);
  }

  async outboundSince(
    tx: Tx,
    orgId: number,
    conversationId: number,
    since: number,
  ): Promise<InboxLine[]> {
    const res = await tx.execute(sql`
      SELECT id, direction, body, sender_agent_id AS agent_id, COALESCE(sent_at, provider_ts, created_at) AS sent_at
      FROM messages
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND direction = 'out' AND id > ${since}
      ORDER BY id`);
    return (res.rows as unknown as LineRow[]).map(toLine);
  }
}
