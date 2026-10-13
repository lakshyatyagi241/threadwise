import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EmailBounce } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChannelsRepository } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { CONVERSATIONS_MODULE } from './conversation-lifecycle.service';
import { ConversationsRepository } from './conversations.repository';
import { previewOf } from './message-rules';
import { MessagesRepository } from './messages.repository';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

/** The outbox event a recorded bounce raises (the notification consumer tells the sender). */
export const EMAIL_BOUNCED_EVENT = 'email.message_bounced';

/** Sent mail older than this is not searched for the message a bounce is about. */
const LOOKBACK_DAYS = 120;
/** A bounce that names no message id is linked to the newest reply of the thread sent within this many days. */
const THREAD_FALLBACK_DAYS = 14;
const MAX_CANDIDATES = 12;

export interface RecordBounceInput {
  /** The mailbox's own address (to complete an outbound message that carries no `meta.email` block yet). */
  mailboxAddress: string;
  /** Message-IDs (no brackets) the bounce names: the returned original's first, then In-Reply-To / References. */
  messageIds: string[];
  bounce: EmailBounce;
  /** When the bounce arrived. */
  at: Date;
}

export type RecordBounceOutcome =
  | { outcome: 'marked'; conversationUuid: string; messageUuid: string }
  /** This recipient's bounce was already recorded on this message (a redelivery). */
  | { outcome: 'duplicate' }
  /** No sent message of this channel could be found for the bounce. */
  | { outcome: 'unlinked' };

interface Found {
  id: number;
  createdAt: string;
  uuid: string;
  conversationId: number;
  senderUserId: number | null;
  meta: Record<string, unknown>;
}

/**
 * Delivery state of sent email (TW-MAIL-032): the door the email module reports a bounce through. It finds the reply the bounce is about
 * (by the Message-ID the reply carried), writes `meta.email.delivery = 'bounced'` and `meta.email.bounce` on it, adds a system line to the
 * thread, raises the outbox event the sender's notification comes from, and tells the open thread live. A hard bounce also marks the
 * recipient's email identity on the contact as not verified (the least invasive field the contact model has). Idempotent per message and
 * recipient: a redelivered bounce changes nothing.
 *
 * The message's `status` is left alone (the provider did accept it; the bounce came later), so a delivery receipt and a bounce never fight.
 */
@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly outbox: OutboxService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  async recordBounce(
    orgId: number,
    channelUuid: string,
    input: RecordBounceInput,
  ): Promise<RecordBounceOutcome> {
    const done = await this.db.txAs({ orgId }, async (tx) => {
      const channel = await this.channels.byUuid(tx, orgId, channelUuid);
      if (!channel) return { outcome: 'unlinked' as const };
      const found = await this.find(tx, orgId, channel.id, input);
      if (!found) return { outcome: 'unlinked' as const };

      // The thread's lock first (the order every writer takes).
      const conv = await this.conversations.byId(tx, orgId, found.conversationId, true);
      if (!conv) return { outcome: 'unlinked' as const };

      const recipient = input.bounce.failedRecipient.toLowerCase();
      const alloc = await this.messages.allocate(tx);
      const fresh = await this.messages.ledgerInsert(
        tx,
        orgId,
        channel.id,
        'provider_id',
        `bounce:${found.uuid}:${recipient}:${input.bounce.kind}`.slice(0, 250),
        { messageId: alloc.id, messageCreatedAt: alloc.createdAt, conversationId: conv.id },
      );
      if (!fresh) return { outcome: 'duplicate' as const };

      await this.markMessage(tx, orgId, found, conv.peerKey, input);

      const body =
        input.bounce.kind === 'hard'
          ? `Not delivered to ${input.bounce.failedRecipient}: ${input.bounce.reason}`
          : `Delivery to ${input.bounce.failedRecipient} is delayed: ${input.bounce.reason}`;
      const after = await this.conversations.applyOutboundQueued(tx, orgId, conv.id, {
        messageId: alloc.id,
        arrivedAt: alloc.createdAt,
        preview: previewOf({ kind: 'text', body }),
      });
      await this.messages.insert(tx, orgId, {
        id: alloc.id,
        createdAt: alloc.createdAt,
        conversationId: conv.id,
        seq: after.msgSeq,
        direction: 'out',
        kind: 'system',
        senderKind: 'system',
        body: body.slice(0, 1000),
        status: 'sent',
        meta: {
          source: 'email_bounce',
          event: 'email_bounce',
          bounce: input.bounce,
          messageUuid: found.uuid,
        },
        providerTs: input.at,
      });

      if (input.bounce.kind === 'hard') {
        await tx.execute(sql`
          UPDATE contact_identities SET verified = false
          WHERE org_id = ${orgId} AND kind = 'email' AND value = ${recipient}`);
      }
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: CONVERSATIONS_MODULE,
        aggregateId: conv.id,
        eventType: EMAIL_BOUNCED_EVENT,
        payload: {
          conversationId: conv.uuid,
          messageId: found.uuid,
          senderUserId: found.senderUserId,
          failedRecipient: input.bounce.failedRecipient,
          kind: input.bounce.kind,
          reason: input.bounce.reason,
        },
      });

      const original = (await this.messages.byId(tx, orgId, found.id, found.createdAt))!;
      const line = (await this.messages.byId(tx, orgId, alloc.id, alloc.createdAt))!;
      return { outcome: 'marked' as const, conv: after, original, line };
    });

    if (done.outcome !== 'marked') return done;
    // After the commit: the open thread gets the changed message (its delivery state) and the new system line.
    await this.realtime.messageUpdated(orgId, done.conv, done.original, ['bounce']);
    await this.realtime.messageStored(orgId, done.conv, done.line, ['lastMessage']);
    this.logger.log(
      { orgId, message: done.original.uuid, kind: input.bounce.kind },
      'a sent email bounced',
    );
    return {
      outcome: 'marked',
      conversationUuid: done.conv.uuid,
      messageUuid: done.original.uuid,
    };
  }

  /** The sent message a bounce is about, inside this channel. */
  private async find(
    tx: Tx,
    orgId: number,
    channelId: number,
    input: RecordBounceInput,
  ): Promise<Found | null> {
    const ids = input.messageIds.filter((i) => i !== '').slice(0, MAX_CANDIDATES);
    for (const id of ids) {
      // 1. The Message-ID the reply was recorded with (`meta.email.messageId`).
      const byMeta = await tx.execute(sql`
        SELECT m.id, m.created_at::text AS created_at, m.uuid, m.conversation_id, m.sender_user_id, m.meta
        FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE m.org_id = ${orgId} AND c.channel_id = ${channelId} AND m.direction = 'out'
          AND m.created_at > now() - make_interval(days => ${LOOKBACK_DAYS})
          AND m.meta -> 'email' ->> 'messageId' = ${id}
        ORDER BY m.created_at DESC LIMIT 1`);
      const hit = rowsOf(byMeta)[0];
      if (hit) return toFound(hit);

      // 2. A reply's Message-ID is `tw.<its idempotency key>@<domain>`: the key is the message's client id (or its uuid).
      const m = /^tw\.(.+)@[^@]+$/.exec(id);
      if (m) {
        const key = m[1]!;
        const ledger = await this.messages.ledgerFind(tx, orgId, channelId, 'client_id', key);
        const byKey = await tx.execute(
          ledger
            ? sql`SELECT m.id, m.created_at::text AS created_at, m.uuid, m.conversation_id, m.sender_user_id, m.meta
                  FROM messages m WHERE m.org_id = ${orgId} AND m.id = ${ledger.messageId}
                    AND m.created_at = ${ledger.messageCreatedAt}::timestamptz AND m.direction = 'out'`
            : sql`SELECT m.id, m.created_at::text AS created_at, m.uuid, m.conversation_id, m.sender_user_id, m.meta
                  FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
                  WHERE m.org_id = ${orgId} AND c.channel_id = ${channelId} AND m.direction = 'out'
                    AND m.created_at > now() - make_interval(days => ${LOOKBACK_DAYS})
                    AND left(regexp_replace(COALESCE(m.client_message_id, m.uuid::text), '[^A-Za-z0-9._-]', '-', 'g'), 100) = ${key}
                  ORDER BY m.created_at DESC LIMIT 1`,
        );
        const row = rowsOf(byKey)[0];
        if (row) return toFound(row);
      }
    }

    // 3. The bounce only quotes the customer's mail it answered: the newest reply of that thread.
    for (const id of ids) {
      const res = await tx.execute(sql`
        SELECT o.id, o.created_at::text AS created_at, o.uuid, o.conversation_id, o.sender_user_id, o.meta
        FROM messages i
        JOIN conversations c ON c.org_id = i.org_id AND c.id = i.conversation_id
        JOIN messages o ON o.org_id = i.org_id AND o.conversation_id = i.conversation_id
        WHERE i.org_id = ${orgId} AND c.channel_id = ${channelId} AND i.direction = 'in'
          AND i.created_at > now() - make_interval(days => ${LOOKBACK_DAYS})
          AND i.meta -> 'email' ->> 'messageId' = ${id}
          AND o.direction = 'out' AND o.kind <> 'system' AND o.status IN ('sent', 'delivered', 'read')
          AND o.created_at > now() - make_interval(days => ${THREAD_FALLBACK_DAYS})
        ORDER BY o.created_at DESC LIMIT 1`);
      const row = rowsOf(res)[0];
      if (row) return toFound(row);
    }
    return null;
  }

  /** Writes the delivery state into `meta.email`, completing the block when the reply was stored without one. */
  private async markMessage(
    tx: Tx,
    orgId: number,
    found: Found,
    peerKey: string,
    input: RecordBounceInput,
  ): Promise<void> {
    const existing = (found.meta.email ?? {}) as Record<string, unknown>;
    const base = {
      subject: '',
      from: { name: null, address: input.mailboxAddress },
      to: [{ name: null, address: input.bounce.failedRecipient }],
      cc: [],
      bcc: [],
      messageId: input.messageIds[0] ?? '',
      inReplyTo: null,
      references: [],
      html: null,
      htmlTruncated: false,
      threadId: peerKey.startsWith('t:') ? peerKey.slice(2) : peerKey,
      attachments: [],
      automated: false,
    };
    // A hard bounce is never downgraded by a later soft report of another recipient.
    const prior = existing.bounce as { kind?: string } | undefined;
    const keep = prior?.kind === 'hard' && input.bounce.kind === 'soft';
    const patch = keep ? {} : { delivery: 'bounced', bounce: input.bounce };
    const email = { ...base, ...existing, ...patch };
    await tx.execute(sql`
      UPDATE messages SET meta = jsonb_set(meta, '{email}', ${JSON.stringify(email)}::jsonb)
      WHERE org_id = ${orgId} AND id = ${found.id} AND created_at = ${found.createdAt}::timestamptz`);
  }
}

const toFound = (r: Raw): Found => ({
  id: Number(r.id),
  createdAt: r.created_at as string,
  uuid: r.uuid as string,
  conversationId: Number(r.conversation_id),
  senderUserId: r.sender_user_id === null ? null : Number(r.sender_user_id),
  meta: (r.meta as Record<string, unknown>) ?? {},
});
