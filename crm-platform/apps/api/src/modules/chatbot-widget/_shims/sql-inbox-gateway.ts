import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  AI_SOURCE,
  botSender,
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
 * The conversation engine stamped on a widget thread. WaDesk used the workspace's primary WhatsApp engine; until the
 * WhatsApp domains export that, a widget thread carries the engine WaDesk falls back to. The team inbox shows widget
 * threads whatever this says (channel `chatbot_widget` is exempt from the engine filter).
 */
const DEFAULT_ENGINE = 'baileys';

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
 * Writes the visitor's thread into `conversations`, `inbox_messages` and `contacts` directly, until the team inbox and
 * contacts domains export services for it. Every method runs in the caller's tenant transaction.
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
        SELECT id, provider FROM conversations WHERE org_id = ${orgId} AND id = ${visitor.conversationId}`);
      const row = existing.rows[0] as { id: number | string; provider: string | null } | undefined;
      // A deleted thread is replaced by a new one and the visitor is pointed at it (WD-WGT-015 rule 1).
      if (row) return { id: Number(row.id), provider: row.provider, created: false };
    }

    const routingMeta = {
      widget_id: widget.uuid,
      widget_name: widget.name,
      visitor_uuid: visitor.visitorUuid,
      visitor_name: visitor.name,
      assistant_id: widget.assistantUuid,
    };
    const created = await tx.execute(sql`
      INSERT INTO conversations (org_id, user_id, raw_jid, title, preview, status, platform, provider, origin, channel,
                                 inbox_status, last_message_at, routing_meta)
      VALUES (${orgId}, ${widget.userId}, ${`widget-${widget.uuid}-${visitor.visitorUuid}`},
              ${visitorDisplayName(visitor)},
              ${widget.welcomeMessage ? truncate(widget.welcomeMessage, PREVIEW_LENGTH) : ''},
              'open', 'WIDGET', ${DEFAULT_ENGINE}, 'web', 'chatbot_widget', 'open', now(),
              ${JSON.stringify(routingMeta)}::jsonb)
      RETURNING id, provider`);
    const conv = created.rows[0] as { id: number | string; provider: string | null };
    const conversationId = Number(conv.id);
    await tx.execute(sql`
      UPDATE chatbot_widget_visitors SET conversation_id = ${conversationId}
      WHERE org_id = ${orgId} AND id = ${visitor.id}`);

    await this.linkContact(tx, orgId, widget, visitor, conversationId);

    // The opening line is a message of the thread, so agents see it as the first bubble and a reload repaints it.
    if (widget.welcomeMessage) {
      await tx.execute(sql`
        INSERT INTO inbox_messages (org_id, conversation_id, user_id, direction, from_number, to_number, body, status,
                                    meta, sent_at, provider)
        VALUES (${orgId}, ${conversationId}, ${widget.userId}, 'out', ${botSender(widget.uuid)},
                ${visitor.visitorUuid}, ${widget.welcomeMessage}, 'sent',
                ${JSON.stringify({ widget_id: widget.uuid, source: 'welcome', channel: 'chatbot_widget' })}::jsonb,
                now(), ${conv.provider})`);
    }
    return { id: conversationId, provider: conv.provider, created: true };
  }

  /**
   * One contact per visitor so the name, email and phone show in the inbox contact panel and in Contacts: an existing
   * contact whose phone matches, else a stable per-visitor row keyed by the widget channel. Only empty fields are filled.
   * Any failure is logged and leaves the thread without a contact; it never fails the message (WD-WGT-015 rule 2).
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
    const res = await tx.execute(sql`
      INSERT INTO inbox_messages (org_id, conversation_id, user_id, direction, from_number, to_number, body, status,
                                  meta, sent_at, provider)
      VALUES (${orgId}, ${conversation.id}, ${widget.userId}, 'in', ${visitorUuid}, ${botSender(widget.uuid)}, ${body},
              'delivered', ${JSON.stringify(meta)}::jsonb, now(), ${conversation.provider})
      RETURNING id, sent_at`);
    // `inbox_status` is deliberately untouched: WaDesk never reopened a resolved or snoozed widget thread (WD-WGT-014 #3).
    await tx.execute(sql`
      UPDATE conversations SET preview = ${truncate(body, PREVIEW_LENGTH)}, last_message_at = now(),
                               last_inbound_at = now(), unread_count = unread_count + 1
      WHERE org_id = ${orgId} AND id = ${conversation.id}`);
    const row = res.rows[0] as { id: number | string; sent_at: Date | string };
    return { id: Number(row.id), sentAt: new Date(row.sent_at) };
  }

  async insertAssistantReply(
    tx: Tx,
    orgId: number,
    conversation: ConversationStub,
    widget: WidgetForInbox,
    assistantUuid: string | null,
    visitorUuid: string,
    body: string,
  ): Promise<{ id: number; sentAt: Date }> {
    const meta = {
      widget_id: widget.uuid,
      assistant_id: assistantUuid,
      source: AI_SOURCE,
      channel: 'chatbot_widget',
    };
    const res = await tx.execute(sql`
      INSERT INTO inbox_messages (org_id, conversation_id, user_id, direction, from_number, to_number, body, status,
                                  meta, sent_at, provider)
      VALUES (${orgId}, ${conversation.id}, ${widget.userId}, 'out', ${botSender(widget.uuid)}, ${visitorUuid}, ${body},
              'sent', ${JSON.stringify(meta)}::jsonb, now(), ${conversation.provider})
      RETURNING id, sent_at`);
    await tx.execute(sql`
      UPDATE conversations SET preview = ${truncate(body, PREVIEW_LENGTH)}, last_message_at = now(),
                               last_outbound_at = now()
      WHERE org_id = ${orgId} AND id = ${conversation.id}`);
    const row = res.rows[0] as { id: number | string; sent_at: Date | string };
    return { id: Number(row.id), sentAt: new Date(row.sent_at) };
  }

  async humanHasTakenOver(
    tx: Tx,
    orgId: number,
    conversationId: number,
    sender: string,
  ): Promise<boolean> {
    // The widget's own lines always carry the bot sender; an operator's reply carries the business number or none.
    // The column is plain text here, so the comparison means what it says.
    const res = await tx.execute(sql`
      SELECT 1 FROM inbox_messages
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND direction = 'out'
        AND (from_number IS NULL OR from_number <> ${sender})
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async recent(tx: Tx, orgId: number, conversationId: number, limit: number): Promise<InboxLine[]> {
    const res = await tx.execute(sql`
      SELECT id, direction, body, agent_id, sent_at FROM (
        SELECT id, direction, body, agent_id, sent_at FROM inbox_messages
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
      SELECT id, direction, body, agent_id, sent_at FROM inbox_messages
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND direction = 'out' AND id > ${since}
      ORDER BY id`);
    return (res.rows as unknown as LineRow[]).map(toLine);
  }
}
