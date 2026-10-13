import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { channelOwnerSql } from '../../realtime';

/**
 * Every SQL statement the conversation side of the message pipelines runs on `conversations` and `conversation_events`. Each method
 * takes the transaction it runs in (tenant scoping is the caller's, through `DatabaseService`) and names `org_id` itself so the
 * planner can use the (org_id, ...) indexes; row-level security is the backstop, not the filter.
 *
 * A thread's counters (`msg_seq`, `unread_count`, `waiting_since`, the activity stamps) are only ever changed by statements that run
 * while this transaction holds the row lock (`findForUpdate`), so concurrent messages on one thread serialise there: the seq stays
 * gap-free and no counter update is lost.
 */

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface ConversationRow {
  id: number;
  uuid: string;
  channelId: number;
  peerKey: string;
  peerName: string | null;
  title: string;
  contactId: number | null;
  needsContact: boolean;
  status: string;
  unreadCount: number;
  msgSeq: number;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  windowExpiresAt: Date | null;
  waitingSince: Date | null;
  firstResponseAt: Date | null;
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  /** The owner of the personal mailbox the thread is on, null for a shared channel: the visibility rule needs it (`ConversationRecord`). */
  channelOwnerUserId: number | null;
  rowVersion: number;
}

const COLUMNS = sql`id, uuid, channel_id, peer_key, peer_name, title, contact_id, needs_contact, status, unread_count, msg_seq,
  last_message_at, last_inbound_at, last_outbound_at, window_expires_at, waiting_since, first_response_at,
  assignee_user_id, assignee_team_id, row_version, ${channelOwnerSql('conversations')} AS channel_owner_user_id`;

export const toConversationRow = (r: Raw): ConversationRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  channelId: Number(r.channel_id),
  peerKey: r.peer_key as string,
  peerName: (r.peer_name as string | null) ?? null,
  title: r.title as string,
  contactId: num(r.contact_id),
  needsContact: r.needs_contact === true,
  status: r.status as string,
  unreadCount: Number(r.unread_count),
  msgSeq: Number(r.msg_seq),
  lastMessageAt: date(r.last_message_at),
  lastInboundAt: date(r.last_inbound_at),
  lastOutboundAt: date(r.last_outbound_at),
  windowExpiresAt: date(r.window_expires_at),
  waitingSince: date(r.waiting_since),
  firstResponseAt: date(r.first_response_at),
  assigneeUserId: num(r.assignee_user_id),
  assigneeTeamId: num(r.assignee_team_id),
  channelOwnerUserId: num(r.channel_owner_user_id),
  rowVersion: Number(r.row_version),
});

/** What an inbound message changes on its thread. */
export interface InboundTouch {
  messageId: number;
  /** The row time of the message (`messages.created_at`), as the database's own text so it round-trips exactly. */
  arrivedAt: string;
  /** When the customer sent it, already clamped to the arrival. */
  customerAt: Date;
  /** The plain-text line for the list; null leaves the previous one (a reaction is not a thread's latest message). */
  preview: string | null;
  /** The channel's window length; null = no window rule. */
  windowHours: number | null;
  /** Counts toward `unread_count`, opens the window, starts the wait, reopens the thread (everything but a reaction). */
  active: boolean;
}

export interface OutboundTouch {
  messageId: number;
  arrivedAt: string;
  preview: string | null;
  /** Set when the message is recorded already sent (another domain sent it): stamps `last_outbound_at`. */
  sentAt?: Date;
  /** A reaction takes a `seq` and nothing else: it is not the thread's latest message and not a preview. */
  reaction?: boolean;
}

@Injectable()
export class ConversationsRepository {
  /**
   * Serialises everything that finds-or-creates one thread (`UNIQUE (org_id, channel_id, peer_key)`), so two messages from a new
   * sender cannot both create it, or both create its contact.
   */
  async lockPeer(tx: Tx, orgId: number, channelId: number, peerKey: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`conv:${orgId}:${channelId}:${peerKey}`}, 0))`,
    );
  }

  async findForUpdate(
    tx: Tx,
    orgId: number,
    channelId: number,
    peerKey: string,
  ): Promise<ConversationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM conversations
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND peer_key = ${peerKey}
      FOR UPDATE`);
    const r = rowsOf(res)[0];
    return r ? toConversationRow(r) : null;
  }

  async byPeer(
    tx: Tx,
    orgId: number,
    channelId: number,
    peerKey: string,
  ): Promise<ConversationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM conversations
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND peer_key = ${peerKey}`);
    const r = rowsOf(res)[0];
    return r ? toConversationRow(r) : null;
  }

  async byUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<ConversationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM conversations WHERE org_id = ${orgId} AND uuid = ${uuid}
      ${lock ? sql`FOR UPDATE` : sql``}`);
    const r = rowsOf(res)[0];
    return r ? toConversationRow(r) : null;
  }

  async byId(tx: Tx, orgId: number, id: number, lock = false): Promise<ConversationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM conversations WHERE org_id = ${orgId} AND id = ${id}
      ${lock ? sql`FOR UPDATE` : sql``}`);
    const r = rowsOf(res)[0];
    return r ? toConversationRow(r) : null;
  }

  async byContactAndChannel(
    tx: Tx,
    orgId: number,
    channelId: number,
    contactId: number,
  ): Promise<ConversationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM conversations
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND contact_id = ${contactId}
      ORDER BY id LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? toConversationRow(r) : null;
  }

  async insert(
    tx: Tx,
    orgId: number,
    c: {
      channelId: number;
      peerKey: string;
      peerName: string | null;
      title: string;
      contactId: number | null;
      needsContact: boolean;
    },
  ): Promise<ConversationRow> {
    const res = await tx.execute(sql`
      INSERT INTO conversations (org_id, channel_id, peer_key, peer_name, title, contact_id, needs_contact, status)
      VALUES (${orgId}, ${c.channelId}, ${c.peerKey}, ${c.peerName}, ${c.title}, ${c.contactId}, ${c.needsContact}, 'open')
      RETURNING ${COLUMNS}`);
    return toConversationRow(rowsOf(res)[0]!);
  }

  /** The sender's profile name moved on, or a contact was linked (or lost): a thread keeps the latest of each. */
  async syncPeer(
    tx: Tx,
    orgId: number,
    id: number,
    p: { peerName?: string | null; contactId?: number | null; needsContact?: boolean },
  ): Promise<void> {
    const sets = [];
    if (p.peerName !== undefined) sets.push(sql`peer_name = ${p.peerName}`);
    if (p.contactId !== undefined) sets.push(sql`contact_id = ${p.contactId}`);
    if (p.needsContact !== undefined) sets.push(sql`needs_contact = ${p.needsContact}`);
    if (sets.length === 0) return;
    await tx.execute(
      sql`UPDATE conversations SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /**
   * The contact on a thread was just heard from, or answered by a person: stamps `contacts.last_activity_at` (the list's "Last Activity"
   * column, the segment filter and the lead scorer's recency fact). Raw SQL on purpose: it is a stamp, not an edit, so it emits no
   * `contact.updated` (which would queue a score per message) and the contacts touch trigger leaves `row_version` alone for it. Moves
   * forward only, and at most once a minute per contact, so a burst of messages is one write on the contact row.
   */
  async touchContactActivity(
    tx: Tx,
    orgId: number,
    contactId: number | null,
    at: Date | string,
  ): Promise<void> {
    if (contactId === null) return;
    await tx.execute(sql`
      UPDATE contacts SET last_activity_at = ${at}::timestamptz
      WHERE org_id = ${orgId} AND id = ${contactId}
        AND (last_activity_at IS NULL OR last_activity_at < ${at}::timestamptz - interval '1 minute')`);
  }

  /**
   * An inbound message lands on its thread: the next `seq`, the latest-message pointers, the activity stamps, one more unread, the
   * window and the wait. The caller holds the row lock. Returns the row as it is after, and whether it was reopened (and from what).
   *
   *   - `last_inbound_at` only moves forward, so a late (older) delivery never shortens the window it already opened.
   *   - `window_expires_at` is that time plus the channel's window; the SLA anchor `waiting_since` is set only when nobody is
   *     already waiting, so it measures the oldest unanswered message.
   *   - A resolved, closed or snoozed thread is reopened by a customer message (Reference: a reply reopens). A pending one ("waiting on
   *     the customer") goes back to open. Spam stays spam.
   */
  async applyInbound(
    tx: Tx,
    orgId: number,
    id: number,
    t: InboundTouch,
  ): Promise<{ row: ConversationRow; reopenedFrom: string | null }> {
    const before = rowsOf(
      await tx.execute(
        sql`SELECT status FROM conversations WHERE org_id = ${orgId} AND id = ${id}`,
      ),
    )[0];
    const previous = (before?.status as string | undefined) ?? 'open';

    const res = t.active
      ? await tx.execute(sql`
          UPDATE conversations SET
            msg_seq = msg_seq + 1,
            last_message_id = ${t.messageId},
            last_message_at = ${t.arrivedAt}::timestamptz,
            last_inbound_at = GREATEST(last_inbound_at, ${t.customerAt}::timestamptz),
            window_expires_at = ${
              t.windowHours === null
                ? sql`NULL`
                : sql`GREATEST(last_inbound_at, ${t.customerAt}::timestamptz) + make_interval(hours => ${t.windowHours})`
            },
            unread_count = unread_count + 1,
            waiting_since = COALESCE(waiting_since, ${t.arrivedAt}::timestamptz),
            preview = COALESCE(${t.preview}, preview),
            status = CASE WHEN status IN ('resolved', 'closed', 'snoozed', 'pending') THEN 'open' ELSE status END,
            resolved_at = CASE WHEN status IN ('resolved', 'closed') THEN NULL ELSE resolved_at END,
            resolved_by = CASE WHEN status IN ('resolved', 'closed') THEN NULL ELSE resolved_by END,
            resolved_by_agent_id = CASE WHEN status IN ('resolved', 'closed') THEN NULL ELSE resolved_by_agent_id END,
            snoozed_until = CASE WHEN status = 'snoozed' THEN NULL ELSE snoozed_until END
          WHERE org_id = ${orgId} AND id = ${id}
          RETURNING ${COLUMNS}`)
      : await tx.execute(sql`
          UPDATE conversations SET msg_seq = msg_seq + 1, last_message_id = ${t.messageId}
          WHERE org_id = ${orgId} AND id = ${id}
          RETURNING ${COLUMNS}`);
    const row = toConversationRow(rowsOf(res)[0]!);
    if (t.active) await this.touchContactActivity(tx, orgId, row.contactId, t.arrivedAt);
    const reopened = t.active && ['resolved', 'closed', 'snoozed'].includes(previous);
    return { row, reopenedFrom: reopened ? previous : null };
  }

  /**
   * An imported history message lands on its thread (coexistence). Takes the next `seq`; the latest-message pointers and the
   * preview move only when the message is newer than what the thread already shows (a live message always wins); an inbound one
   * moves `last_inbound_at` forward so the 24 hour window is right. No unread, no wait, no reopening.
   */
  async applyHistory(
    tx: Tx,
    orgId: number,
    id: number,
    t: {
      messageId: number;
      at: string;
      inbound: boolean;
      windowHours: number | null;
      preview: string | null;
    },
  ): Promise<ConversationRow> {
    const newer = sql`(last_message_at IS NULL OR last_message_at <= ${t.at}::timestamptz)`;
    const res = await tx.execute(sql`
      UPDATE conversations SET
        msg_seq = msg_seq + 1,
        last_message_id = CASE WHEN ${newer} THEN ${t.messageId} ELSE last_message_id END,
        last_message_at = CASE WHEN ${newer} THEN ${t.at}::timestamptz ELSE last_message_at END,
        preview = CASE WHEN ${newer} THEN COALESCE(${t.preview}, preview) ELSE preview END
        ${
          t.inbound
            ? sql`, last_inbound_at = GREATEST(last_inbound_at, ${t.at}::timestamptz),
        window_expires_at = ${
          t.windowHours === null
            ? sql`NULL`
            : sql`GREATEST(last_inbound_at, ${t.at}::timestamptz) + make_interval(hours => ${t.windowHours})`
        }`
            : sql`, last_outbound_at = GREATEST(last_outbound_at, ${t.at}::timestamptz)`
        }
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toConversationRow(rowsOf(res)[0]!);
  }

  /** An outbound message is queued on its thread: the next `seq`, the latest-message pointers and the list preview. */
  async applyOutboundQueued(
    tx: Tx,
    orgId: number,
    id: number,
    t: OutboundTouch,
  ): Promise<ConversationRow> {
    const res = await tx.execute(sql`
      UPDATE conversations SET
        msg_seq = msg_seq + 1,
        last_message_id = ${t.reaction ? sql`last_message_id` : sql`${t.messageId}`},
        last_message_at = ${t.reaction ? sql`last_message_at` : sql`${t.arrivedAt}::timestamptz`},
        last_outbound_at = ${t.sentAt ? sql`GREATEST(last_outbound_at, ${t.sentAt}::timestamptz)` : sql`last_outbound_at`},
        preview = COALESCE(${t.preview}, preview)
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    return toConversationRow(rowsOf(res)[0]!);
  }

  /**
   * The provider accepted an outbound message. Only now does a human answer count: the wait ends (`waiting_since` cleared) and,
   * for a staff reply, the first response is stamped (once) with the time the provider accepted it. Reference stamped it when the agent
   * pressed send, even when the send then failed.
   */
  async applyOutboundSent(
    tx: Tx,
    orgId: number,
    id: number,
    t: { at: Date; humanReply: boolean },
  ): Promise<{ row: ConversationRow; firstResponse: boolean }> {
    const before = rowsOf(
      await tx.execute(
        sql`SELECT first_response_at FROM conversations WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`,
      ),
    )[0];
    const firstResponse = t.humanReply && before !== undefined && before.first_response_at === null;
    const res = await tx.execute(sql`
      UPDATE conversations SET
        last_outbound_at = GREATEST(last_outbound_at, ${t.at}::timestamptz),
        waiting_since = ${t.humanReply ? sql`NULL` : sql`waiting_since`},
        first_response_at = ${
          t.humanReply
            ? sql`COALESCE(first_response_at, ${t.at}::timestamptz)`
            : sql`first_response_at`
        }
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING ${COLUMNS}`);
    const row = toConversationRow(rowsOf(res)[0]!);
    if (t.humanReply) await this.touchContactActivity(tx, orgId, row.contactId, t.at);
    return { row, firstResponse };
  }

  /** Unread becomes the number of customer messages after `seq` (so a message that arrived while the agent read stays unread). */
  async setUnreadAfter(tx: Tx, orgId: number, id: number, seq: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE conversations c SET unread_count = LEAST(c.unread_count, (
        SELECT count(*)::int FROM messages m
        WHERE m.org_id = ${orgId} AND m.conversation_id = ${id} AND m.direction = 'in' AND m.seq > ${seq}
          AND m.kind <> 'reaction'))
      WHERE c.org_id = ${orgId} AND c.id = ${id}
      RETURNING c.unread_count`);
    return Number(rowsOf(res)[0]?.unread_count ?? 0);
  }

  async insertEvent(
    tx: Tx,
    orgId: number,
    conversationId: number,
    e: {
      type: string;
      /** The timeline knows `user`, `system`, `bot`, `flow`, `ai` (a CHECK on the column): a customer's doing is `system`, with `by` in the payload. */
      actorType: 'system' | 'user';
      actorUserId?: number | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO conversation_events (org_id, conversation_id, actor_user_id, actor_type, type, payload)
      VALUES (${orgId}, ${conversationId}, ${e.actorUserId ?? null}, ${e.actorType}, ${e.type},
              ${e.payload ? JSON.stringify(e.payload) : null}::jsonb)`);
  }

  /** The channel saw traffic (bookkeeping for the channel list). */
  async touchChannel(tx: Tx, orgId: number, channelId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE channels SET last_event_at = now() WHERE org_id = ${orgId} AND id = ${channelId}`,
    );
  }

  async contactUuid(tx: Tx, orgId: number, contactId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    return (rowsOf(res)[0]?.uuid as string | undefined) ?? null;
  }

  async contactIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    const id = rowsOf(res)[0]?.id;
    return id === undefined ? null : Number(id);
  }

  async contactPhone(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{ phone: string | null; name: string | null } | null> {
    const res = await tx.execute(
      sql`SELECT phone, name FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    const r = rowsOf(res)[0];
    return r
      ? { phone: (r.phone as string | null) ?? null, name: (r.name as string | null) ?? null }
      : null;
  }
}
