import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface ChatRow {
  conversationId: number;
  openid: string;
  title: string;
  lastMessageAt: Date | null;
}

export interface BroadcastRow {
  id: number;
  uuid: string;
  name: string | null;
  channelRowId: number;
  channelUuid: string;
  channelName: string | null;
  templateUuid: string | null;
  /** Encrypted. */
  body: string | null;
  audience: 'all' | 'tag' | 'list';
  tagId: string | null;
  massMsgId: string | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** BL-191: the whole mass send waits for the workspace's quiet hours until this instant. Null = not held. */
  heldUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

export interface RecipientRow {
  id: number;
  openid: string;
  conversationId: number | null;
  /** The thread's contact, for the consent check (BL-141). Null = the follower never became a contact. */
  contactId: number | null;
}

interface Raw {
  id: number | string;
  uuid: string;
  name: string | null;
  wechat_channel_id: number | string;
  channel_uuid: string;
  channel_name: string | null;
  template_uuid: string | null;
  body: string | null;
  audience: string;
  tag_id: string | null;
  mass_msg_id: string | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
  last_error: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  held_until: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  row_version: number;
}

const SELECT = sql.raw(`
  SELECT b.id, b.uuid, b.name, b.wechat_channel_id, c.uuid AS channel_uuid, c.account_name AS channel_name, t.uuid AS template_uuid,
         b.body, b.audience, b.tag_id, b.mass_msg_id, b.status, b.total, b.sent, b.failed, b.last_error, b.started_at, b.finished_at,
         b.held_until, b.created_at, b.updated_at, b.row_version
  FROM wechat_broadcasts b
  JOIN wechat_channels c ON c.org_id = b.org_id AND c.id = b.wechat_channel_id
  LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id`);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));
const toRow = (r: Raw): BroadcastRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  channelRowId: Number(r.wechat_channel_id),
  channelUuid: r.channel_uuid,
  channelName: r.channel_name,
  templateUuid: r.template_uuid,
  body: r.body,
  audience: r.audience === 'all' || r.audience === 'tag' ? r.audience : 'list',
  tagId: r.tag_id,
  massMsgId: r.mass_msg_id,
  status: r.status,
  total: r.total,
  sent: r.sent,
  failed: r.failed,
  lastError: r.last_error,
  startedAt: date(r.started_at),
  finishedAt: date(r.finished_at),
  heldUntil: date(r.held_until),
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
  rowVersion: r.row_version,
});

/** `wechat_broadcasts` and its recipients, always inside the caller's tenant transaction. */
@Injectable()
export class BroadcastsRepository {
  /** The followers a channel can message: its inbox threads, newest first. The peer key is the OpenID (case kept). */
  async chats(tx: Tx, orgId: number, channelRowId: number, limit: number): Promise<ChatRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.title, c.peer_key, c.last_message_at
      FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'wechat' AND ch.external_id = ${String(channelRowId)}
      ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
      LIMIT ${limit}`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        title: string | null;
        peer_key: string;
        last_message_at: Date | string | null;
      }>
    )
      .filter((r) => r.peer_key !== '')
      .map((r) => ({
        conversationId: Number(r.id),
        openid: r.peer_key,
        title: r.title || 'WeChat user',
        lastMessageAt: date(r.last_message_at),
      }));
  }

  /** WeChat templates of the workspace (a row of `wa_templates` whose channel is wechat), for the compose page's prefill. */
  async templates(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, template_body FROM wa_templates
      WHERE org_id = ${orgId} AND channel = 'wechat' ORDER BY id DESC`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        uuid: string;
        template_name: string;
        template_body: string;
      }>
    ).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid,
      name: r.template_name,
      body: r.template_body,
    }));
  }

  async list(tx: Tx, orgId: number, limit: number): Promise<BroadcastRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} ORDER BY b.id DESC LIMIT ${limit}`,
    );
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<BroadcastRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF b` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<BroadcastRow | undefined> {
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
      body: string;
      audience: string;
      tagId: string | null;
      total: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO wechat_broadcasts (org_id, wechat_channel_id, user_id, name, template_id, body, audience, tag_id, status, total)
      VALUES (${orgId}, ${v.channelRowId}, ${v.userId}, ${v.name}, ${v.templateId}, ${v.body}, ${v.audience}, ${v.tagId}, 'draft',
              ${v.total})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Frozen at creation. In chunks to keep each statement small. */
  async insertRecipients(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    rows: Array<{ openid: string; title: string; conversationId: number }>,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const json = JSON.stringify(
        rows.slice(i, i + 500).map((r) => ({
          openid: r.openid,
          title: r.title.slice(0, 191),
          conversation_id: r.conversationId,
        })),
      );
      await tx.execute(sql`
        INSERT INTO wechat_broadcast_recipients (org_id, wechat_broadcast_id, openid, title, conversation_id, status)
        SELECT ${orgId}, ${broadcastId}, x.openid, x.title, x.conversation_id, 'pending'
        FROM jsonb_to_recordset(${json}::jsonb) AS x(openid text, title text, conversation_id bigint)`);
    }
  }

  async recipients(tx: Tx, orgId: number, broadcastId: number): Promise<RecipientRow[]> {
    const res = await tx.execute(sql`
      SELECT r.id, r.openid, r.conversation_id, c.contact_id
      FROM wechat_broadcast_recipients r
      LEFT JOIN conversations c ON c.org_id = r.org_id AND c.id = r.conversation_id
      WHERE r.org_id = ${orgId} AND r.wechat_broadcast_id = ${broadcastId} ORDER BY r.id`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        openid: string;
        conversation_id: number | string | null;
        contact_id: number | string | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      openid: r.openid,
      conversationId: r.conversation_id === null ? null : Number(r.conversation_id),
      contactId: r.contact_id === null ? null : Number(r.contact_id),
    }));
  }

  /**
   * The contacts behind the followers this account already carries as inbox threads (BL-141): who a send to ALL followers or to a TAG
   * would reach among the people we know. WeChat resolves those audiences itself, so this is the part of it that can be checked.
   */
  async knownContactIds(tx: Tx, orgId: number, channelRowId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT c.contact_id
      FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'wechat' AND ch.external_id = ${String(channelRowId)}
        AND c.contact_id IS NOT NULL`);
    return (res.rows as unknown as Array<{ contact_id: number | string }>).map((r) =>
      Number(r.contact_id),
    );
  }

  /** Recipients the consent check refused (BL-141): never messaged, kept with the gate's reason. */
  async markBlocked(
    tx: Tx,
    orgId: number,
    items: ReadonlyArray<{ id: number; note: string }>,
  ): Promise<void> {
    for (const i of items) {
      await tx.execute(sql`
        UPDATE wechat_broadcast_recipients SET status = 'blocked', error = ${i.note.slice(0, 255)}, sent_at = NULL
        WHERE org_id = ${orgId} AND id = ${i.id}`);
    }
  }

  /** `sending` for a send being queued (the start time is now), `failed` with the reason when WeChat refused it. Returns the new row version (it names the queue job). */
  async setStatus(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'draft' | 'sending' | 'failed',
    o: { lastError?: string | null; markStarted?: boolean } = {},
  ): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE wechat_broadcasts SET status = ${status}, last_error = ${o.lastError ?? null},
             started_at = CASE WHEN ${o.markStarted === true} THEN now() ELSE started_at END,
             finished_at = CASE WHEN ${o.markStarted === true} THEN NULL ELSE finished_at END
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING row_version`);
    return Number((res.rows[0] as { row_version: number }).row_version);
  }

  /** WeChat took the mass send: done, with its id; the picked recipients are sent. */
  /** The mass send waits for the quiet hours (BL-191): still `sending`, with the instant it may go. `null` clears the hold. */
  async setHeld(
    tx: Tx,
    orgId: number,
    id: number,
    hold: { until: string; reason: string } | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wechat_broadcasts SET held_until = ${hold?.until ?? null}::timestamptz, held_reason = ${hold?.reason ?? null}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Done. `sentIds` names the picked recipients the call reached (a list send leaves out whoever the consent check refused, BL-141);
   * without it every recipient counts as sent, which is the case of a send to all followers or a tag (no recipient rows).
   */
  async markDone(
    tx: Tx,
    orgId: number,
    id: number,
    massMsgId: string | null,
    sentIds?: readonly number[],
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wechat_broadcasts SET status = 'done', mass_msg_id = ${massMsgId},
             sent = ${sentIds === undefined ? sql`total` : sql`${sentIds.length}`}, failed = 0, last_error = NULL,
             held_until = NULL, held_reason = NULL, finished_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
    await tx.execute(sql`
      UPDATE wechat_broadcast_recipients SET status = 'sent', error = NULL, sent_at = now()
      WHERE org_id = ${orgId} AND wechat_broadcast_id = ${id}
        ${
          sentIds === undefined
            ? sql``
            : sentIds.length === 0
              ? sql`AND false`
              : sql`AND id IN (${sql.join(
                  sentIds.map((n) => sql`${n}::bigint`),
                  sql`, `,
                )})`
        }`);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wechat_broadcasts WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
