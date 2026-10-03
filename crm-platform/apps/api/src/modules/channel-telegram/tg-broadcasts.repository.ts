import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface ChatRow {
  conversationId: number;
  chatId: string;
  title: string;
  seenTypes: string[];
  anySender: boolean;
  lastMessageAt: Date | null;
  unread: number;
}

export interface TgBroadcastRow {
  id: number;
  uuid: string;
  name: string | null;
  botRowId: number;
  botUuid: string;
  botUsername: string | null;
  templateUuid: string | null;
  /** Encrypted. */
  body: string | null;
  /** Encrypted JSON array. */
  buttons: string | null;
  mediaPath: string | null;
  mediaKind: string | null;
  mediaFileId: string | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  blocked: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

export interface RecipientRow {
  id: number;
  chatId: string;
  title: string | null;
  conversationId: number | null;
}

interface Raw {
  id: number | string;
  uuid: string;
  name: string | null;
  telegram_bot_id: number | string;
  bot_uuid: string;
  bot_username: string | null;
  template_uuid: string | null;
  body: string | null;
  buttons: string | null;
  media_path: string | null;
  media_kind: string | null;
  media_file_id: string | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  blocked: number;
  last_error: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  row_version: number;
}

const SELECT = sql.raw(`
  SELECT b.id, b.uuid, b.name, b.telegram_bot_id, bot.uuid AS bot_uuid, bot.bot_username, t.uuid AS template_uuid, b.body,
         b.buttons, b.media_path, b.media_kind, b.media_file_id, b.status, b.total, b.sent, b.failed, b.blocked, b.last_error,
         b.started_at, b.finished_at, b.created_at, b.row_version
  FROM telegram_broadcasts b
  JOIN telegram_bots bot ON bot.org_id = b.org_id AND bot.id = b.telegram_bot_id
  LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id`);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));
const toRow = (r: Raw): TgBroadcastRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  botRowId: Number(r.telegram_bot_id),
  botUuid: r.bot_uuid,
  botUsername: r.bot_username,
  templateUuid: r.template_uuid,
  body: r.body,
  buttons: r.buttons,
  mediaPath: r.media_path,
  mediaKind: r.media_kind,
  mediaFileId: r.media_file_id,
  status: r.status,
  total: r.total,
  sent: r.sent,
  failed: r.failed,
  blocked: r.blocked,
  lastError: r.last_error,
  startedAt: date(r.started_at),
  finishedAt: date(r.finished_at),
  createdAt: new Date(r.created_at),
  rowVersion: r.row_version,
});

/** `telegram_broadcasts` and its recipients, always inside the caller's tenant transaction. */
@Injectable()
export class TgBroadcastsRepository {
  /**
   * The chats a bot carries (its inbox threads), newest first. A chat's type comes from the latest inbound messages that named
   * one; `anySender` says whether any inbound message had a sender (a room with a sender is a group, one without a channel).
   */
  async chats(tx: Tx, orgId: number, botRowId: number, limit: number): Promise<ChatRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.title, c.peer_key, c.last_message_at, c.unread_count,
             coalesce(s.types, ARRAY[]::text[]) AS types, coalesce(s.any_sender, false) AS any_sender
      FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      LEFT JOIN LATERAL (
        SELECT array_agg(m.meta -> 'telegram' ->> 'chat_type' ORDER BY m.id DESC)
                 FILTER (WHERE m.meta -> 'telegram' ->> 'chat_type' IS NOT NULL) AS types,
               bool_or(m.meta -> 'telegram' ->> 'from_id' IS NOT NULL) AS any_sender
        FROM (
          SELECT id, meta FROM messages
          WHERE org_id = c.org_id AND conversation_id = c.id AND direction = 'in' AND meta IS NOT NULL
          ORDER BY id DESC LIMIT 25
        ) m
      ) s ON true
      WHERE c.org_id = ${orgId} AND ch.kind = 'telegram' AND ch.external_id = ${String(botRowId)}
      ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
      LIMIT ${limit}`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        title: string | null;
        peer_key: string;
        last_message_at: Date | string | null;
        unread_count: number;
        types: string[];
        any_sender: boolean;
      }>
    ).map((r) => ({
      conversationId: Number(r.id),
      chatId: r.peer_key,
      title: r.title || 'Telegram chat',
      seenTypes: r.types,
      anySender: r.any_sender,
      lastMessageAt: date(r.last_message_at),
      unread: Number(r.unread_count ?? 0),
    }));
  }

  async list(tx: Tx, orgId: number, limit: number): Promise<TgBroadcastRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} ORDER BY b.id DESC LIMIT ${limit}`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async stats(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS total, coalesce(sum(sent), 0)::int AS sent, coalesce(sum(failed), 0)::int AS failed,
             coalesce(sum(blocked), 0)::int AS blocked, coalesce(sum(total), 0)::int AS audience,
             count(*) FILTER (WHERE status = 'sending')::int AS sending
      FROM telegram_broadcasts WHERE org_id = ${orgId}`);
    return res.rows[0] as {
      total: number;
      sent: number;
      failed: number;
      blocked: number;
      audience: number;
      sending: number;
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<TgBroadcastRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF b` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<TgBroadcastRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE b.org_id = ${orgId} AND b.id = ${id}`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      botRowId: number;
      userId: number | null;
      name: string;
      templateId: number | null;
      body: string | null;
      buttons: string | null;
      mediaPath: string | null;
      mediaKind: string | null;
      total: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO telegram_broadcasts (org_id, telegram_bot_id, user_id, name, template_id, body, buttons, media_path, media_kind,
                                       status, total)
      VALUES (${orgId}, ${v.botRowId}, ${v.userId}, ${v.name}, ${v.templateId}, ${v.body}, ${v.buttons}, ${v.mediaPath},
              ${v.mediaKind}, 'draft', ${v.total})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Frozen at creation so a chat that wrote in mid-send is never added. In chunks to keep each statement small. */
  async insertRecipients(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    rows: Array<{ chatId: string; title: string; kind: string; conversationId: number }>,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const json = JSON.stringify(
        chunk.map((r) => ({
          chat_id: r.chatId,
          title: r.title.slice(0, 191),
          kind: r.kind,
          conversation_id: r.conversationId,
        })),
      );
      await tx.execute(sql`
        INSERT INTO telegram_broadcast_recipients (org_id, telegram_broadcast_id, chat_id, title, kind, conversation_id, status)
        SELECT ${orgId}, ${broadcastId}, x.chat_id, x.title, x.kind, x.conversation_id, 'pending'
        FROM jsonb_to_recordset(${json}::jsonb)
          AS x(chat_id text, title text, kind text, conversation_id bigint)`);
    }
  }

  async pendingCount(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM telegram_broadcast_recipients
      WHERE org_id = ${orgId} AND telegram_broadcast_id = ${broadcastId} AND status = 'pending'`);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** The status and, for a run starting, the first start time. Returns the new row version (it names the queue job). */
  async setStatus(
    tx: Tx,
    orgId: number,
    id: number,
    status: string,
    o: {
      lastError?: string | null;
      markStarted?: boolean;
      markFinished?: boolean;
      clearFinished?: boolean;
    } = {},
  ): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE telegram_broadcasts SET status = ${status}, last_error = ${o.lastError ?? null},
             started_at = CASE WHEN ${o.markStarted === true} THEN coalesce(started_at, now()) ELSE started_at END,
             finished_at = CASE WHEN ${o.markFinished === true} THEN now() WHEN ${o.clearFinished === true} THEN NULL ELSE finished_at END
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING row_version`);
    return Number((res.rows[0] as { row_version: number }).row_version);
  }

  /** Failed chats go back to pending; blocked ones stay blocked (retrying a block is the same refusal). */
  async resetFailed(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE telegram_broadcast_recipients SET status = 'pending', error = NULL
      WHERE org_id = ${orgId} AND telegram_broadcast_id = ${broadcastId} AND status = 'failed'
      RETURNING id`);
    return res.rows.length;
  }

  /** Counters come from the rows, never incremented, so a repeated or interrupted batch cannot drift them. */
  async recompute(tx: Tx, orgId: number, broadcastId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE telegram_broadcasts b SET
        sent = c.sent, failed = c.failed, blocked = c.blocked
      FROM (
        SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed,
               count(*) FILTER (WHERE status = 'blocked')::int AS blocked
        FROM telegram_broadcast_recipients WHERE org_id = ${orgId} AND telegram_broadcast_id = ${broadcastId}
      ) c
      WHERE b.org_id = ${orgId} AND b.id = ${broadcastId}`);
  }

  /** Claims the next chats: no two workers ever hold the same one. */
  async claim(tx: Tx, orgId: number, broadcastId: number, limit: number): Promise<RecipientRow[]> {
    // A materialized CTE: a subquery inside `IN (...)` may be re-run by the planner and claim more than `limit` rows.
    const res = await tx.execute(sql`
      WITH picked AS MATERIALIZED (
        SELECT id FROM telegram_broadcast_recipients
        WHERE org_id = ${orgId} AND telegram_broadcast_id = ${broadcastId} AND status = 'pending'
        ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE telegram_broadcast_recipients r SET status = 'processing'
      FROM picked
      WHERE r.org_id = ${orgId} AND r.id = picked.id
      RETURNING r.id, r.chat_id, r.title, r.conversation_id`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        chat_id: string;
        title: string | null;
        conversation_id: number | string | null;
      }>
    )
      .map((r) => ({
        id: Number(r.id),
        chatId: r.chat_id,
        title: r.title,
        conversationId: r.conversation_id === null ? null : Number(r.conversation_id),
      }))
      .sort((a, b) => a.id - b.id);
  }

  /** A chat claimed by a worker that died goes back to pending. */
  async releaseStale(tx: Tx, orgId: number, broadcastId: number, minutes: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE telegram_broadcast_recipients SET status = 'pending'
      WHERE org_id = ${orgId} AND telegram_broadcast_id = ${broadcastId} AND status = 'processing'
        AND updated_at < now() - ${`${minutes} minutes`}::interval
      RETURNING id`);
    return res.rows.length;
  }

  async markRecipient(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: 'sent' | 'failed' | 'blocked';
      providerMessageId?: string | null;
      error?: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE telegram_broadcast_recipients SET status = ${v.status}, provider_message_id = ${v.providerMessageId ?? null},
             error = ${v.error ? v.error.slice(0, 255) : null}, sent_at = CASE WHEN ${v.status === 'sent'} THEN now() ELSE sent_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setMediaFileId(tx: Tx, orgId: number, id: number, fileId: string): Promise<void> {
    await tx.execute(
      sql`UPDATE telegram_broadcasts SET media_file_id = ${fileId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM telegram_broadcasts WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
