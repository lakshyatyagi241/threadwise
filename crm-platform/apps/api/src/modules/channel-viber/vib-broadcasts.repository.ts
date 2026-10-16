import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface UserRow {
  conversationId: number;
  userId: string;
  title: string;
  lastMessageAt: Date | null;
}

export interface VibBroadcastRow {
  id: number;
  uuid: string;
  name: string | null;
  channelRowId: number;
  channelUuid: string;
  channelName: string | null;
  templateUuid: string | null;
  /** Encrypted. */
  body: string | null;
  /** Encrypted JSON array, kept as a JSON string. */
  buttons: string | null;
  mediaPath: string | null;
  mediaKind: string | null;
  mediaSize: number | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  delivered: number;
  seen: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

export interface RecipientRow {
  id: number;
  userId: string;
  title: string | null;
  conversationId: number | null;
  /** The user's contact, for the quiet hours and the consent check. */
  contactId: number | null;
  /** The recipient was held for the quiet hours and is being released now (BL-191). */
  wasHeld: boolean;
}

interface Raw {
  id: number | string;
  uuid: string;
  name: string | null;
  viber_channel_id: number | string;
  channel_uuid: string;
  channel_name: string | null;
  template_uuid: string | null;
  body: string | null;
  buttons: string | null;
  media_path: string | null;
  media_kind: string | null;
  media_size: number | string | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  delivered: number;
  seen: number;
  last_error: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  row_version: number;
}

const SELECT = sql.raw(`
  SELECT b.id, b.uuid, b.name, b.viber_channel_id, ch.uuid AS channel_uuid, ch.bot_name AS channel_name, t.uuid AS template_uuid,
         b.body, b.buttons, b.media_path, b.media_kind, b.media_size, b.status, b.total, b.sent, b.failed, b.delivered, b.seen,
         b.last_error, b.started_at, b.finished_at, b.created_at, b.row_version
  FROM viber_broadcasts b
  JOIN viber_channels ch ON ch.org_id = b.org_id AND ch.id = b.viber_channel_id
  LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id`);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));
const toRow = (r: Raw): VibBroadcastRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  channelRowId: Number(r.viber_channel_id),
  channelUuid: r.channel_uuid,
  channelName: r.channel_name,
  templateUuid: r.template_uuid,
  body: r.body,
  buttons: r.buttons,
  mediaPath: r.media_path,
  mediaKind: r.media_kind,
  mediaSize: r.media_size === null ? null : Number(r.media_size),
  status: r.status,
  total: r.total,
  sent: r.sent,
  failed: r.failed,
  delivered: r.delivered,
  seen: r.seen,
  lastError: r.last_error,
  startedAt: date(r.started_at),
  finishedAt: date(r.finished_at),
  createdAt: new Date(r.created_at),
  rowVersion: r.row_version,
});

/** `viber_broadcasts` and its recipients, always inside the caller's tenant transaction. */
@Injectable()
export class VibBroadcastsRepository {
  /** The users a channel carries (its inbox threads), newest first: who it can message. */
  async users(tx: Tx, orgId: number, channelRowId: number, limit: number): Promise<UserRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.title, c.peer_key, c.last_message_at
      FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'viber' AND ch.external_id = ${String(channelRowId)}
      ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
      LIMIT ${limit}`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        title: string | null;
        peer_key: string;
        last_message_at: Date | string | null;
      }>
    ).map((r) => ({
      conversationId: Number(r.id),
      userId: r.peer_key,
      title: r.title || 'Viber user',
      lastMessageAt: date(r.last_message_at),
    }));
  }

  async list(tx: Tx, orgId: number, limit: number): Promise<VibBroadcastRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} ORDER BY b.id DESC LIMIT ${limit}`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async stats(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS total, coalesce(sum(sent), 0)::int AS sent, coalesce(sum(failed), 0)::int AS failed,
             coalesce(sum(delivered), 0)::int AS delivered, coalesce(sum(seen), 0)::int AS seen,
             coalesce(sum(total), 0)::int AS audience, count(*) FILTER (WHERE status = 'sending')::int AS sending
      FROM viber_broadcasts WHERE org_id = ${orgId}`);
    return res.rows[0] as {
      total: number;
      sent: number;
      failed: number;
      delivered: number;
      seen: number;
      audience: number;
      sending: number;
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<VibBroadcastRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF b` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<VibBroadcastRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE b.org_id = ${orgId} AND b.id = ${id}`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      channelRowId: number;
      userId: number | null;
      name: string;
      templateId: number | null;
      body: string | null;
      buttons: string | null;
      mediaPath: string | null;
      mediaKind: string | null;
      mediaSize: number | null;
      total: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO viber_broadcasts (org_id, viber_channel_id, user_id, name, template_id, body, buttons, media_path, media_kind,
                                    media_size, status, total)
      VALUES (${orgId}, ${v.channelRowId}, ${v.userId}, ${v.name}, ${v.templateId}, ${v.body},
              ${v.buttons === null ? null : JSON.stringify(v.buttons)}::jsonb, ${v.mediaPath}, ${v.mediaKind}, ${v.mediaSize},
              'draft', ${v.total})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Frozen at creation so a user who wrote in mid-send is never added. In chunks to keep each statement small. */
  async insertRecipients(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    rows: Array<{ userId: string; title: string; conversationId: number }>,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const json = JSON.stringify(
        chunk.map((r) => ({
          viber_user_id: r.userId,
          title: r.title.slice(0, 191),
          conversation_id: r.conversationId,
        })),
      );
      await tx.execute(sql`
        INSERT INTO viber_broadcast_recipients (org_id, viber_broadcast_id, viber_user_id, title, conversation_id, status)
        SELECT ${orgId}, ${broadcastId}, x.viber_user_id, x.title, x.conversation_id, 'pending'
        FROM jsonb_to_recordset(${json}::jsonb)
          AS x(viber_user_id text, title text, conversation_id bigint)`);
    }
  }

  async pendingCount(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM viber_broadcast_recipients
      WHERE org_id = ${orgId} AND viber_broadcast_id = ${broadcastId} AND status = 'pending'`);
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
      UPDATE viber_broadcasts SET status = ${status}, last_error = ${o.lastError ?? null},
             started_at = CASE WHEN ${o.markStarted === true} THEN coalesce(started_at, now()) ELSE started_at END,
             finished_at = CASE WHEN ${o.markFinished === true} THEN now() WHEN ${o.clearFinished === true} THEN NULL ELSE finished_at END
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING row_version`);
    return Number((res.rows[0] as { row_version: number }).row_version);
  }

  /** Failed users go back to pending (their old token and receipts are forgotten, they are sent again). */
  async resetFailed(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE viber_broadcast_recipients
      SET status = 'pending', error = NULL, message_token = NULL, delivered_at = NULL, seen_at = NULL
      WHERE org_id = ${orgId} AND viber_broadcast_id = ${broadcastId} AND status = 'failed'
      RETURNING id`);
    return res.rows.length;
  }

  /** Counters come from the rows, never incremented, so a repeated or interrupted batch cannot drift them. */
  async recompute(tx: Tx, orgId: number, broadcastId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE viber_broadcasts b SET
        sent = c.sent, failed = c.failed, delivered = c.delivered, seen = c.seen
      FROM (
        SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed,
               count(*) FILTER (WHERE status = 'sent' AND delivered_at IS NOT NULL)::int AS delivered,
               count(*) FILTER (WHERE status = 'sent' AND seen_at IS NOT NULL)::int AS seen
        FROM viber_broadcast_recipients WHERE org_id = ${orgId} AND viber_broadcast_id = ${broadcastId}
      ) c
      WHERE b.org_id = ${orgId} AND b.id = ${broadcastId}`);
  }

  /** Claims the next users: no two workers ever hold the same one. */
  async claim(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    limit: number,
    /** Only recipients after this id: a run visits each recipient once, so one it held for the quiet hours is not claimed again by the same run. */
    afterId = 0,
  ): Promise<RecipientRow[]> {
    // A materialized CTE: a subquery inside `IN (...)` may be re-run by the planner and claim more than `limit` rows.
    const res = await tx.execute(sql`
      WITH picked AS MATERIALIZED (
        SELECT id FROM viber_broadcast_recipients
        WHERE org_id = ${orgId} AND viber_broadcast_id = ${broadcastId} AND status = 'pending'
          -- A recipient held for the quiet hours (BL-191) is left alone until its hour has come.
          AND (held_until IS NULL OR held_until <= now()) AND id > ${afterId}
        ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE viber_broadcast_recipients r SET status = 'processing'
        FROM picked
        WHERE r.org_id = ${orgId} AND r.id = picked.id
        RETURNING r.id, r.viber_user_id, r.title, r.conversation_id, (r.held_until IS NOT NULL) AS was_held
      )
      SELECT cl.id, cl.viber_user_id, cl.title, cl.conversation_id, cl.was_held, c.contact_id
      FROM claimed cl
      LEFT JOIN conversations c ON c.org_id = ${orgId} AND c.id = cl.conversation_id`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        viber_user_id: string;
        title: string | null;
        conversation_id: number | string | null;
        was_held: boolean;
        contact_id: number | string | null;
      }>
    )
      .map((r) => ({
        id: Number(r.id),
        userId: r.viber_user_id,
        title: r.title,
        conversationId: r.conversation_id === null ? null : Number(r.conversation_id),
        contactId: r.contact_id === null ? null : Number(r.contact_id),
        wasHeld: r.was_held === true,
      }))
      .sort((a, b) => a.id - b.id);
  }

  /** Users claimed by a worker that died go back to pending. */
  async releaseStale(tx: Tx, orgId: number, broadcastId: number, minutes: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE viber_broadcast_recipients SET status = 'pending'
      WHERE org_id = ${orgId} AND viber_broadcast_id = ${broadcastId} AND status = 'processing'
        AND updated_at < now() - ${`${minutes} minutes`}::interval
      RETURNING id`);
    return res.rows.length;
  }

  /** One recipient's outcome. The batch's token is kept so Viber's later `delivered` and `seen` can find the row. */
  async markRecipient(
    tx: Tx,
    orgId: number,
    id: number,
    v: { status: 'sent' | 'failed'; messageToken?: string | null; error?: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE viber_broadcast_recipients SET status = ${v.status}, message_token = ${v.messageToken ?? null},
             held_until = NULL, held_reason = NULL,
             error = ${v.error ? v.error.slice(0, 255) : null}, sent_at = CASE WHEN ${v.status === 'sent'} THEN now() ELSE sent_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * A Viber receipt for a broadcast recipient: matched on the batch's token AND the user. Returns whether a recipient was found.
   * `delivered` and `seen` stamp the row (a seen user was also delivered); `failed` turns the row failed with Viber's reason so a retry
   * sends it again. The broadcast's counters are recomputed from the rows.
   */
  async applyReceipt(
    tx: Tx,
    orgId: number,
    token: string,
    userId: string,
    status: 'delivered' | 'read' | 'failed',
    at: Date,
    desc: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE viber_broadcast_recipients SET
        delivered_at = CASE WHEN ${status} IN ('delivered', 'read') THEN coalesce(delivered_at, ${at.toISOString()}::timestamptz) ELSE delivered_at END,
        seen_at = CASE WHEN ${status} = 'read' THEN coalesce(seen_at, ${at.toISOString()}::timestamptz) ELSE seen_at END,
        status = CASE WHEN ${status} = 'failed' THEN 'failed' ELSE status END,
        error = CASE WHEN ${status} = 'failed' THEN ${(desc || 'Viber delivery failed').slice(0, 255)} ELSE error END
      WHERE org_id = ${orgId} AND message_token = ${token} AND viber_user_id = ${userId}
      RETURNING viber_broadcast_id`);
    const first = res.rows[0] as { viber_broadcast_id: number | string } | undefined;
    if (!first) return false;
    await this.recompute(tx, orgId, Number(first.viber_broadcast_id));
    return true;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM viber_broadcasts WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
