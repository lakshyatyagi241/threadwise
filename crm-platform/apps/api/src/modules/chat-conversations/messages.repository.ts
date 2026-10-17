import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { MessageKind, MessageSenderKind, MessageStatus, SendHold } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { channelOwnerSql } from '../../realtime';
import { STATUS_RANK_SQL, type ReceiptStatusStep } from './message-rules';

/**
 * Every SQL statement on the message stream, the idempotency ledger and the per-message event log. Each method takes the
 * transaction it runs in and names `org_id` itself.
 *
 * `messages` is partitioned by month and its primary key is `(id, created_at)`: a lookup that knows the row's `created_at` (every
 * one that comes through the ledger does) is pruned to one partition. The row time is kept as the database's own text
 * (`created_at::text`, microseconds included) wherever it travels between statements, so it compares equal exactly.
 */

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface MessageRow {
  id: number;
  /** The row time as text (the partition key; see above). */
  createdAtText: string;
  createdAt: Date;
  uuid: string;
  conversationId: number;
  conversationUuid: string;
  seq: number;
  direction: 'in' | 'out';
  kind: MessageKind;
  senderKind: MessageSenderKind;
  senderUserId: number | null;
  senderUserUuid: string | null;
  senderName: string | null;
  body: string | null;
  mediaKey: string | null;
  mediaMime: string | null;
  mediaSize: number | null;
  mediaName: string | null;
  mediaSha256: string | null;
  latitude: number | null;
  longitude: number | null;
  status: MessageStatus;
  failureCode: string | null;
  failureReason: string | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  replyToMessageUuid: string | null;
  reaction: string | null;
  isTranslated: boolean;
  translatedBody: string | null;
  detectedLanguage: string | null;
  starred: boolean;
  pinned: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  templateId: number | null;
  templateUuid: string | null;
  meta: Record<string, unknown>;
  providerTs: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
}

/** The select list, with the row time as text, the thread's uuid and the staff sender's uuid and name. */
const SELECT = sql`
  m.id, m.created_at::text AS created_at_text, m.created_at, m.uuid, m.conversation_id, c.uuid AS conversation_uuid, m.seq,
  m.direction, m.kind, m.sender_kind, m.sender_user_id, u.uuid AS sender_user_uuid, u.full_name AS sender_name, m.body,
  m.media_key, m.media_mime, m.media_size, m.media_name, m.media_sha256, m.latitude, m.longitude, m.status, m.failure_code, m.failure_reason,
  m.client_message_id, m.provider_message_id, m.reply_to_message_uuid, m.reaction, m.is_translated, m.translated_body,
  m.detected_language, m.starred, m.pinned, m.edited_at, m.deleted_at, m.template_id, wt.uuid AS template_uuid, m.meta, m.provider_ts, m.sent_at,
  m.delivered_at, m.read_at`;

const FROM = sql`
  FROM messages m
  JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
  LEFT JOIN users u ON u.org_id = m.org_id AND u.id = m.sender_user_id
  LEFT JOIN wa_templates wt ON wt.org_id = m.org_id AND wt.id = m.template_id`;

const toRow = (r: Raw): MessageRow => ({
  id: Number(r.id),
  createdAtText: r.created_at_text as string,
  createdAt: new Date(r.created_at as string),
  uuid: r.uuid as string,
  conversationId: Number(r.conversation_id),
  conversationUuid: r.conversation_uuid as string,
  seq: Number(r.seq),
  direction: r.direction as 'in' | 'out',
  kind: r.kind as MessageKind,
  senderKind: r.sender_kind as MessageSenderKind,
  senderUserId: num(r.sender_user_id),
  senderUserUuid: (r.sender_user_uuid as string | null) ?? null,
  senderName: (r.sender_name as string | null) ?? null,
  body: (r.body as string | null) ?? null,
  mediaKey: (r.media_key as string | null) ?? null,
  mediaMime: (r.media_mime as string | null) ?? null,
  mediaSize: num(r.media_size),
  mediaName: (r.media_name as string | null) ?? null,
  mediaSha256: (r.media_sha256 as string | null) ?? null,
  latitude: num(r.latitude),
  longitude: num(r.longitude),
  status: r.status as MessageStatus,
  failureCode: (r.failure_code as string | null) ?? null,
  failureReason: (r.failure_reason as string | null) ?? null,
  clientMessageId: (r.client_message_id as string | null) ?? null,
  providerMessageId: (r.provider_message_id as string | null) ?? null,
  replyToMessageUuid: (r.reply_to_message_uuid as string | null) ?? null,
  reaction: (r.reaction as string | null) ?? null,
  isTranslated: r.is_translated === true,
  translatedBody: (r.translated_body as string | null) ?? null,
  detectedLanguage: (r.detected_language as string | null) ?? null,
  starred: r.starred === true,
  pinned: r.pinned === true,
  editedAt: date(r.edited_at),
  deletedAt: date(r.deleted_at),
  templateId: num(r.template_id),
  templateUuid: (r.template_uuid as string | null) ?? null,
  meta: (r.meta as Record<string, unknown>) ?? {},
  providerTs: date(r.provider_ts),
  sentAt: date(r.sent_at),
  deliveredAt: date(r.delivered_at),
  readAt: date(r.read_at),
});

export type LedgerKind = 'provider_id' | 'client_id';

export interface LedgerEntry {
  messageId: number;
  messageCreatedAt: string;
  conversationId: number;
}

export interface NewMessage {
  id: number;
  /** The id and time were allocated first (the ledger row needed them): see `allocate`. */
  createdAt: string;
  conversationId: number;
  seq: number;
  direction: 'in' | 'out';
  kind: MessageKind;
  senderKind: MessageSenderKind;
  senderUserId?: number | null;
  senderAgentId?: number | null;
  body?: string | null;
  media?: { key: string; mime: string; size: number; name: string; sha256: string } | null;
  latitude?: number | null;
  longitude?: number | null;
  status: MessageStatus;
  clientMessageId?: string | null;
  providerMessageId?: string | null;
  replyToMessageUuid?: string | null;
  reaction?: string | null;
  templateId?: number | null;
  meta?: Record<string, unknown>;
  providerTs?: Date | null;
  sentAt?: Date | null;
}

export type ReceiptOutcome = 'advanced' | 'ignored' | 'missing';

@Injectable()
export class MessagesRepository {
  /**
   * A message id and row time, taken BEFORE the message exists: the ledger row that guards it has to carry both. The time is the
   * statement time as text, so what the ledger stores and what the message is inserted with are the same value to the microsecond.
   */
  async allocate(tx: Tx): Promise<{ id: number; createdAt: string }> {
    const res = await tx.execute(
      sql`SELECT nextval('messages_id_seq')::bigint AS id, statement_timestamp()::text AS ts`,
    );
    const r = rowsOf(res)[0]!;
    return { id: Number(r.id), createdAt: r.ts as string };
  }

  /**
   * The idempotency authority: true when the key is new, false when another delivery (or retry) already holds it. A concurrent
   * duplicate waits on the unique index until the first transaction commits, then reports false.
   */
  async ledgerInsert(
    tx: Tx,
    orgId: number,
    channelId: number,
    kind: LedgerKind,
    key: string,
    entry: LedgerEntry,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
      VALUES (${orgId}, ${channelId}, ${kind}, ${key}, ${entry.messageId}, ${entry.messageCreatedAt}::timestamptz, ${entry.conversationId})
      ON CONFLICT (org_id, channel_id, kind, key) DO NOTHING
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  async ledgerFind(
    tx: Tx,
    orgId: number,
    channelId: number,
    kind: LedgerKind,
    key: string,
  ): Promise<LedgerEntry | null> {
    const res = await tx.execute(sql`
      SELECT message_id, message_created_at::text AS message_created_at, conversation_id FROM message_ledger
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND kind = ${kind} AND key = ${key}`);
    const r = rowsOf(res)[0];
    return r
      ? {
          messageId: Number(r.message_id),
          messageCreatedAt: r.message_created_at as string,
          conversationId: Number(r.conversation_id),
        }
      : null;
  }

  async insert(tx: Tx, orgId: number, m: NewMessage): Promise<void> {
    await tx.execute(sql`
      INSERT INTO messages (id, org_id, created_at, conversation_id, seq, direction, kind, sender_kind, sender_user_id,
        sender_agent_id, body, media_key, media_mime, media_size, media_name, media_sha256, latitude, longitude, status,
        client_message_id, provider_message_id, reply_to_message_uuid, reaction, template_id, meta, provider_ts, sent_at)
      VALUES (${m.id}, ${orgId}, ${m.createdAt}::timestamptz, ${m.conversationId}, ${m.seq}, ${m.direction}, ${m.kind},
        ${m.senderKind}, ${m.senderUserId ?? null}, ${m.senderAgentId ?? null}, ${m.body ?? null},
        ${m.media?.key ?? null}, ${m.media?.mime ?? null}, ${m.media?.size ?? null}, ${m.media?.name ?? null},
        ${m.media?.sha256 ?? null}, ${m.latitude ?? null}, ${m.longitude ?? null}, ${m.status},
        ${m.clientMessageId ?? null}, ${m.providerMessageId ?? null}, ${m.replyToMessageUuid ?? null},
        ${m.reaction ?? null}, ${m.templateId ?? null}, ${JSON.stringify(m.meta ?? {})}::jsonb,
        ${m.providerTs ?? null}, ${m.sentAt ?? null})`);
  }

  async byLedger(tx: Tx, orgId: number, entry: LedgerEntry): Promise<MessageRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} ${FROM}
      WHERE m.org_id = ${orgId} AND m.id = ${entry.messageId} AND m.created_at = ${entry.messageCreatedAt}::timestamptz`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<MessageRow | null> {
    const res = await tx.execute(
      sql`SELECT ${SELECT} ${FROM} WHERE m.org_id = ${orgId} AND m.uuid = ${uuid} LIMIT 1`,
    );
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /**
   * The `meta.email` block of the thread's newest inbound mail to answer: a person's mail is preferred over an automated one (a bounce
   * or an out-of-office is not who a reply goes to), and within each the newest by `seq`. Null when the thread holds no email message.
   */
  async latestInboundEmailMeta(
    tx: Tx,
    orgId: number,
    conversationId: number,
  ): Promise<Record<string, unknown> | null> {
    const res = await tx.execute(sql`
      SELECT m.meta -> 'email' AS email
      FROM messages m
      WHERE m.org_id = ${orgId} AND m.conversation_id = ${conversationId} AND m.direction = 'in'
        AND m.meta -> 'email' IS NOT NULL
      ORDER BY COALESCE((m.meta -> 'email' ->> 'automated')::boolean, false) ASC, m.seq DESC
      LIMIT 1`);
    const email = rowsOf(res)[0]?.email;
    return email && typeof email === 'object' ? (email as Record<string, unknown>) : null;
  }

  async byId(tx: Tx, orgId: number, id: number, createdAtText: string): Promise<MessageRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} ${FROM}
      WHERE m.org_id = ${orgId} AND m.id = ${id} AND m.created_at = ${createdAtText}::timestamptz`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /** The message that holds a media key, for the access check on the media route (any message: the key is unique per upload). */
  async conversationOfMedia(
    tx: Tx,
    orgId: number,
    key: string,
  ): Promise<{
    assigneeUserId: number | null;
    assigneeTeamId: number | null;
    channelOwnerUserId: number | null;
  } | null> {
    const res = await tx.execute(sql`
      SELECT c.assignee_user_id, c.assignee_team_id, ${channelOwnerSql('c')} AS channel_owner_user_id
      FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      WHERE m.org_id = ${orgId} AND m.media_key = ${key} LIMIT 1`);
    const r = rowsOf(res)[0];
    return r
      ? {
          assigneeUserId: num(r.assignee_user_id),
          assigneeTeamId: num(r.assignee_team_id),
          channelOwnerUserId: num(r.channel_owner_user_id),
        }
      : null;
  }

  /**
   * A page of a thread by `seq`. Without a cursor: the newest `limit`. `before`: older than that seq. `afterSeq`: newer than that
   * seq, oldest first. Returns ascending by seq with one extra row asked for, so the caller can tell whether more exist.
   */
  async thread(
    tx: Tx,
    orgId: number,
    conversationId: number,
    q: { limit: number; before?: number; afterSeq?: number },
  ): Promise<{ rows: MessageRow[]; hasMore: boolean }> {
    const ascending = q.afterSeq !== undefined;
    const bound: SQL =
      q.afterSeq !== undefined
        ? sql`AND m.seq > ${q.afterSeq}`
        : q.before !== undefined
          ? sql`AND m.seq < ${q.before}`
          : sql``;
    const res = await tx.execute(sql`
      SELECT ${SELECT} ${FROM}
      WHERE m.org_id = ${orgId} AND m.conversation_id = ${conversationId} ${bound}
      ORDER BY m.seq ${ascending ? sql`ASC` : sql`DESC`}
      LIMIT ${q.limit + 1}`);
    const all = rowsOf(res).map(toRow);
    const hasMore = all.length > q.limit;
    const page = all.slice(0, q.limit);
    return { rows: ascending ? page : page.reverse(), hasMore };
  }

  /** Whether any message with `seq` below the given one exists (is there an older page?). */
  async hasOlder(tx: Tx, orgId: number, conversationId: number, seq: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM messages WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND seq < ${seq} LIMIT 1`);
    return rowsOf(res).length > 0;
  }

  async hasNewer(tx: Tx, orgId: number, conversationId: number, seq: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM messages WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND seq > ${seq} LIMIT 1`);
    return rowsOf(res).length > 0;
  }

  /** An inbound reaction decorates the message it answers (an empty emoji removes it). */
  async setReaction(tx: Tx, orgId: number, ref: LedgerEntry, emoji: string | null): Promise<void> {
    await tx.execute(sql`
      UPDATE messages SET reaction = ${emoji}
      WHERE org_id = ${orgId} AND id = ${ref.messageId} AND created_at = ${ref.messageCreatedAt}::timestamptz`);
  }

  // --- receipts and send outcomes ---------------------------------------------------------------------------------------------

  /**
   * Applies a delivery receipt under the rank rule, in one conditional UPDATE:
   *
   *   sent / delivered / read   only when the message's current rank is lower (queued < sent < delivered < read);
   *   failed                    only from queued or sent, never over delivered or read.
   *
   * A receipt the rule refuses still fills the time column it reports when that column is empty (a `delivered` that arrives after
   * `read` tells us when it was delivered), and still gets its row in `message_events` (the caller's job). `read` implies the
   * earlier steps happened, so their times are filled too.
   */
  async applyReceipt(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    r: {
      status: ReceiptStatusStep;
      at: Date;
      errorCode?: string;
      errorMessage?: string;
      /** The provider id the receipt is about. A message the agent retried has a new one; a late receipt of the old one must not touch it. */
      providerMessageId?: string;
    },
  ): Promise<ReceiptOutcome> {
    const where = sql`org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz AND direction = 'out'`;

    const exists = await tx.execute(
      sql`SELECT status, provider_message_id FROM messages WHERE ${where}`,
    );
    const current = rowsOf(exists)[0];
    if (!current) return 'missing';
    if (
      r.providerMessageId !== undefined &&
      current.provider_message_id !== null &&
      current.provider_message_id !== r.providerMessageId
    ) {
      return 'ignored';
    }

    let advanced: Raw[];
    if (r.status === 'failed') {
      advanced = rowsOf(
        await tx.execute(sql`
          UPDATE messages SET status = 'failed', failure_code = ${r.errorCode ?? null},
            failure_reason = ${r.errorMessage ?? null}
          WHERE ${where} AND status IN ('queued', 'sent') RETURNING id`),
      );
    } else {
      const rank = r.status === 'sent' ? 1 : r.status === 'delivered' ? 2 : 3;
      advanced = rowsOf(
        await tx.execute(sql`
          UPDATE messages SET status = ${r.status},
            sent_at = COALESCE(sent_at, ${r.at}::timestamptz),
            delivered_at = ${rank >= 2 ? sql`COALESCE(delivered_at, ${r.at}::timestamptz)` : sql`delivered_at`},
            read_at = ${rank >= 3 ? sql`COALESCE(read_at, ${r.at}::timestamptz)` : sql`read_at`}
          WHERE ${where} AND ${sql.raw(STATUS_RANK_SQL)} < ${rank} RETURNING id`),
      );
    }
    if (advanced.length > 0) return 'advanced';

    // Refused by the rule: keep the time, leave the status alone.
    if (r.status === 'delivered') {
      await tx.execute(
        sql`UPDATE messages SET delivered_at = COALESCE(delivered_at, ${r.at}::timestamptz) WHERE ${where} AND status <> 'failed'`,
      );
    } else if (r.status === 'sent') {
      await tx.execute(
        sql`UPDATE messages SET sent_at = COALESCE(sent_at, ${r.at}::timestamptz) WHERE ${where} AND status <> 'failed'`,
      );
    }
    return 'ignored';
  }

  /**
   * The worker's send succeeded: queued -> sent, with the provider's id and times. Conditional on the message still being queued,
   * so a repeated call (a retried job) changes nothing. False when the message was no longer queued.
   */
  async markSent(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    s: { providerMessageId: string; acceptedAt: Date; meta?: Record<string, unknown> },
  ): Promise<boolean> {
    // `meta` is what the adapter says really went out (an email's html and attachments): merged over the queued message's own keys.
    const res = await tx.execute(sql`
      UPDATE messages SET status = 'sent', provider_message_id = ${s.providerMessageId}, provider_ts = ${s.acceptedAt}::timestamptz,
        sent_at = ${s.acceptedAt}::timestamptz, failure_code = NULL, failure_reason = NULL
        ${s.meta ? sql`, meta = meta || ${JSON.stringify(s.meta)}::jsonb` : sql``}
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'out' AND status = 'queued'
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** queued -> failed with the reason. False when the message had already moved on (a receipt got there first). */
  async markFailed(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    f: { code: string; reason: string },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE messages SET status = 'failed', failure_code = ${f.code}, failure_reason = ${f.reason}
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'out' AND status = 'queued'
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The internal id of a template by its uuid, inside this workspace; null when there is none (a deleted or foreign template). */
  async templateIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM wa_templates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const id = rowsOf(res)[0]?.id;
    return id === undefined || id === null ? null : Number(id);
  }

  /** The category a template is billed under (Meta's pricing category, else the template's own); null without a template. */
  async templateCategory(tx: Tx, orgId: number, templateId: number | null): Promise<string | null> {
    if (templateId === null) return null;
    const res = await tx.execute(
      sql`SELECT coalesce(meta_category, category) AS category FROM wa_templates WHERE org_id = ${orgId} AND id = ${templateId}`,
    );
    return (rowsOf(res)[0]?.category as string | null | undefined) ?? null;
  }

  /** The agent's Retry: failed -> queued again, with a fresh dispatch generation. False when the message was not failed. */
  async requeue(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
  ): Promise<{ generation: number } | null> {
    const res = await tx.execute(sql`
      UPDATE messages SET status = 'queued', failure_code = NULL, failure_reason = NULL,
        meta = jsonb_set(meta, '{dispatchGeneration}', to_jsonb(COALESCE((meta ->> 'dispatchGeneration')::int, 1) + 1))
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'out' AND status = 'failed'
      RETURNING (meta ->> 'dispatchGeneration')::int AS generation`);
    const r = rowsOf(res)[0];
    return r ? { generation: Number(r.generation) } : null;
  }

  // --- inbound files copied in the background ----------------------------------------------------------------------------------
  //
  // State lives in `meta` (no column): `mediaStatus` is 'pending' while the `media-fetch` job has not stored the file and 'failed' after
  // it gave up; `mediaFetch` holds what the job needs to ask the provider again; `mediaGen` is the generation of the current job (a
  // Retry makes a new one, so a late job of an earlier generation does nothing); `mediaFailure` is the reason shown to the agent.
  // Every transition is one conditional UPDATE, so two workers on one message cannot both win.

  /** pending -> ready: the file is stored. False when another worker finished first (the caller removes its own copy). */
  async markMediaStored(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    media: { key: string; mime: string; size: number; name: string; sha256: string },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE messages SET media_key = ${media.key}, media_mime = ${media.mime}, media_size = ${media.size},
        media_name = ${media.name}, media_sha256 = ${media.sha256},
        meta = meta - 'mediaStatus' - 'mediaFetch' - 'mediaFailure' - 'mediaGen' - 'mediaError' - 'mediaName'
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'in' AND media_key IS NULL AND meta ->> 'mediaStatus' = 'pending'
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** pending -> failed with the reason (the request to fetch stays on the row, for a Retry). False when it was not pending. */
  async markMediaFailed(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    f: { code: string; reason: string; attempts: number },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE messages SET meta = meta || jsonb_build_object('mediaStatus', 'failed',
        'mediaFailure', jsonb_build_object('code', ${f.code}::text, 'reason', ${f.reason}::text, 'attempts', ${f.attempts}::int, 'at', now()))
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'in' AND media_key IS NULL AND meta ->> 'mediaStatus' = 'pending'
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The agent's Retry of a file that failed: failed -> pending with a new generation. Null when the message has no failed file. */
  async requeueMedia(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
  ): Promise<{ generation: number } | null> {
    const res = await tx.execute(sql`
      UPDATE messages SET meta = (meta - 'mediaFailure') || jsonb_build_object('mediaStatus', 'pending',
        'mediaGen', COALESCE((meta ->> 'mediaGen')::int, 1) + 1)
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'in' AND media_key IS NULL AND meta ->> 'mediaStatus' = 'failed' AND meta ? 'mediaFetch'
      RETURNING (meta ->> 'mediaGen')::int AS generation`);
    const r = rowsOf(res)[0];
    return r ? { generation: Number(r.generation) } : null;
  }

  /** Files still pending after `olderThanSeconds` (a job lost with the process that held it, or never enqueued): the recovery sweep's list. */
  async stalePendingMedia(
    tx: Tx,
    olderThanSeconds: number,
    maxAgeHours: number,
    limit: number,
  ): Promise<Array<{ orgId: number; uuid: string; generation: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid, COALESCE((meta ->> 'mediaGen')::int, 1) AS generation
      FROM messages
      WHERE meta ->> 'mediaStatus' = 'pending' AND direction = 'in'
        AND created_at < now() - make_interval(secs => ${olderThanSeconds})
        AND created_at > now() - make_interval(hours => ${maxAgeHours})
      ORDER BY created_at LIMIT ${limit}`);
    return rowsOf(res).map((r) => ({
      orgId: Number(r.org_id),
      uuid: r.uuid as string,
      generation: Number(r.generation),
    }));
  }

  /**
   * A queued marketing message waits for the end of the quiet hours (BL-177): the reason and the instant go on its `meta.hold` so the
   * thread can say so. The message stays `queued`. False when it had already moved on.
   */
  async setHold(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    hold: SendHold,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE messages SET meta = meta || jsonb_build_object('hold', ${JSON.stringify(hold)}::jsonb)
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt}::timestamptz
        AND direction = 'out' AND status = 'queued'
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  // --- the event log -----------------------------------------------------------------------------------------------------------

  async insertEvent(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
    event: 'queued' | 'attempt' | 'retry' | 'held' | 'sent' | 'delivered' | 'read' | 'failed',
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO message_events (org_id, message_id, message_created_at, event, detail)
      VALUES (${orgId}, ${ref.id}, ${ref.createdAt}::timestamptz, ${event}, ${JSON.stringify(detail)}::jsonb)`);
  }

  async events(
    tx: Tx,
    orgId: number,
    ref: { id: number; createdAt: string },
  ): Promise<Array<{ event: string; detail: Record<string, unknown>; at: Date }>> {
    const res = await tx.execute(sql`
      SELECT event, detail, created_at FROM message_events
      WHERE org_id = ${orgId} AND message_id = ${ref.id} AND message_created_at = ${ref.createdAt}::timestamptz
      ORDER BY id`);
    return rowsOf(res).map((r) => ({
      event: r.event as string,
      detail: (r.detail as Record<string, unknown>) ?? {},
      at: new Date(r.created_at as string),
    }));
  }

  // --- plan metering and recovery ------------------------------------------------------------------------------------------------

  /**
   * Outbound messages of metered channels this month that count against the plan (everything but a failed one). Pruned to the
   * month's partitions by `created_at`; only called for a workspace whose plan has a cap.
   */
  async monthlyMeteredOutbound(tx: Tx, orgId: number, monthStart: Date): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE m.org_id = ${orgId} AND m.created_at >= ${monthStart} AND m.direction = 'out' AND m.status <> 'failed' AND m.kind <> 'reaction'
        AND COALESCE((ch.settings ->> 'metered')::boolean, true)`);
    return Number(rowsOf(res)[0]?.n ?? 0);
  }

  /**
   * Outbound messages still `queued` after `olderThanSeconds` (a crash between the commit and the enqueue, a lost Redis). Runs
   * privileged across workspaces from the recovery sweep; bounded by `limit` and by an age ceiling so an old stuck row is not
   * re-sent days later.
   */
  async staleQueued(
    tx: Tx,
    olderThanSeconds: number,
    maxAgeHours: number,
    limit: number,
  ): Promise<Array<{ orgId: number; uuid: string; generation: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid, COALESCE((meta ->> 'dispatchGeneration')::int, 1) AS generation
      FROM messages
      WHERE status = 'queued' AND direction = 'out'
        AND created_at < now() - make_interval(secs => ${olderThanSeconds})
        -- A message held for the quiet hours waits on purpose (a delayed job): it is overdue only once its hold has passed.
        AND NOT (meta ? 'hold' AND (meta -> 'hold' ->> 'until')::timestamptz > now())
        AND created_at > now() - make_interval(hours => ${maxAgeHours})
      ORDER BY created_at LIMIT ${limit}`);
    return rowsOf(res).map((r) => ({
      orgId: Number(r.org_id),
      uuid: r.uuid as string,
      generation: Number(r.generation),
    }));
  }
}
