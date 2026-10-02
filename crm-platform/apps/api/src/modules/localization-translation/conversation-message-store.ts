import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import type { InboundOutcome, OutboundOutcome } from './conversation-outcomes';

/** What the translation steps need to know about one inbox message. */
export interface StoredMessage {
  id: number;
  direction: 'in' | 'out';
  /** Inbound: what the customer wrote. Outbound: what the agent typed. */
  body: string | null;
  isTranslated: boolean;
  conversationId: number;
  /** The language pinned on the conversation, if any. */
  customerLanguage: string | null;
  /** A template send keeps the language it was approved in. */
  isTemplate: boolean;
  isForwarded: boolean;
}

/**
 * Where conversation translation reads a message and writes its outcome. The inbox domain owns `messages` and
 * `conversations`; until it exposes its own repository this port is satisfied by `PgConversationMessageStore`.
 */
export interface ConversationMessageStore {
  load(orgId: number, messageId: number): Promise<StoredMessage | null>;
  /** Stores the reading on the message and pins the conversation's language when it has none yet. */
  saveInbound(orgId: number, message: StoredMessage, outcome: InboundOutcome): Promise<void>;
  /** Stores the agent's original and the delivered language on a translated reply. */
  saveOutbound(orgId: number, message: StoredMessage, outcome: OutboundOutcome): Promise<void>;
}

export const CONVERSATION_MESSAGE_STORE = Symbol('CONVERSATION_MESSAGE_STORE');

interface Row {
  id: string | number;
  direction: string;
  body: string | null;
  is_translated: boolean;
  conversation_id: string | number;
  customer_language: string | null;
  is_template: boolean;
  is_forwarded: boolean;
}

/**
 * Shim over the inbox tables, kept inside this domain's zone. It runs in the message's own workspace (forced RLS) and
 * writes only the translation columns and `conversations.customer_language`. Delete it when INBOX ships its
 * repository.
 */
@Injectable()
export class PgConversationMessageStore implements ConversationMessageStore {
  constructor(private readonly db: DatabaseService) {}

  async load(orgId: number, messageId: number): Promise<StoredMessage | null> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        SELECT m.id, m.direction, m.body, m.is_translated, m.conversation_id, c.customer_language,
               COALESCE(m.template_id IS NOT NULL
                  OR m.kind = 'template'
                  OR m.meta ->> 'template_id' IS NOT NULL
                  OR m.meta ->> 'template_name' IS NOT NULL
                  OR m.meta ->> 'type' = 'template', false) AS is_template,
               COALESCE(m.meta ->> 'forwarded', 'false') NOT IN ('false', '0', '') AS is_forwarded
        FROM messages m
        LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE m.org_id = ${orgId} AND m.id = ${messageId}
        ORDER BY m.created_at DESC LIMIT 1
      `),
    );
    const r = res.rows[0] as unknown as Row | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      direction: r.direction === 'in' ? 'in' : 'out',
      body: r.body,
      isTranslated: r.is_translated,
      conversationId: Number(r.conversation_id),
      customerLanguage: r.customer_language || null,
      isTemplate: r.is_template,
      isForwarded: r.is_forwarded,
    };
  }

  async saveInbound(orgId: number, m: StoredMessage, o: InboundOutcome): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await tx.execute(sql`
        UPDATE messages
        SET detected_language = ${o.detectedLanguage}, translated_body = ${o.translatedBody},
            is_translated = ${o.isTranslated}
        WHERE org_id = ${orgId} AND id = ${m.id}
      `);
      if (o.pinLanguage) {
        // Pinned once: a later message in another language never moves it.
        await tx.execute(sql`
          UPDATE conversations SET customer_language = ${o.pinLanguage}
          WHERE org_id = ${orgId} AND id = ${m.conversationId}
            AND (customer_language IS NULL OR customer_language = '')
        `);
      }
    });
  }

  async saveOutbound(orgId: number, m: StoredMessage, o: OutboundOutcome): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        UPDATE messages
        SET translated_body = ${o.original}, detected_language = ${o.language}, is_translated = true
        WHERE org_id = ${orgId} AND id = ${m.id}
      `),
    );
  }
}
