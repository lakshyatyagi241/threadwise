import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface ThreadRow {
  conversationId: number;
  psid: string;
  title: string;
  lastInboundAt: Date;
}

export interface FbBroadcastRow {
  id: number;
  uuid: string;
  name: string | null;
  pageRowId: number;
  pageUuid: string;
  pageName: string | null;
  templateUuid: string | null;
  /** Encrypted. */
  body: string | null;
  /** The encrypted JSON array, held as a JSON string. */
  buttons: string | null;
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
  psid: string;
  title: string | null;
  conversationId: number | null;
  /** The thread's contact, for the quiet hours and the consent check. */
  contactId: number | null;
  /** The recipient was held for the quiet hours and is being released now (BL-191). */
  wasHeld: boolean;
}

interface Raw {
  id: number | string;
  uuid: string;
  name: string | null;
  facebook_page_id: number | string;
  page_uuid: string;
  page_name: string | null;
  template_uuid: string | null;
  body: string | null;
  buttons: string | null;
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
  SELECT b.id, b.uuid, b.name, b.facebook_page_id, p.uuid AS page_uuid, p.name AS page_name, t.uuid AS template_uuid, b.body,
         b.buttons #>> '{}' AS buttons, b.status, b.total, b.sent, b.failed, b.blocked, b.last_error, b.started_at, b.finished_at,
         b.created_at, b.row_version
  FROM facebook_broadcasts b
  JOIN facebook_pages p ON p.org_id = b.org_id AND p.id = b.facebook_page_id
  LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id`);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));
const toRow = (r: Raw): FbBroadcastRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  pageRowId: Number(r.facebook_page_id),
  pageUuid: r.page_uuid,
  pageName: r.page_name,
  templateUuid: r.template_uuid,
  body: r.body,
  buttons: r.buttons,
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

/** `facebook_broadcasts` and its recipients, always inside the caller's tenant transaction. */
@Injectable()
export class FbBroadcastsRepository {
  /**
   * The Messenger threads of a Page that wrote in since `cutoff`, newest first: its reachable audience. A comment thread
   * (`fb:<page>:post:...`) is not a conversation Meta lets a Page start a message in, so it is left out. Thread keys are stored lower-cased.
   */
  async audience(
    tx: Tx,
    orgId: number,
    pageId: string,
    cutoff: Date,
    limit: number,
  ): Promise<ThreadRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.peer_key AS raw_jid, coalesce(c.peer_name, c.title) AS title, c.last_inbound_at
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'facebook' AND ch.external_id = ${pageId}
        AND c.peer_key NOT LIKE ${`fb:${pageId.toLowerCase()}:post:%`} AND c.last_inbound_at >= ${cutoff}
      ORDER BY c.last_inbound_at DESC, c.id DESC
      LIMIT ${limit}`);
    const out: ThreadRow[] = [];
    for (const r of res.rows as Array<{
      id: number | string;
      raw_jid: string;
      title: string | null;
      last_inbound_at: Date | string;
    }>) {
      const psid = r.raw_jid.split(':')[2] ?? '';
      if (psid === '') continue;
      out.push({
        conversationId: Number(r.id),
        psid,
        title: r.title || psid,
        lastInboundAt: new Date(r.last_inbound_at),
      });
    }
    return out;
  }

  async list(tx: Tx, orgId: number, limit: number): Promise<FbBroadcastRow[]> {
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
      FROM facebook_broadcasts WHERE org_id = ${orgId}`);
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
  ): Promise<FbBroadcastRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF b` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<FbBroadcastRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE b.org_id = ${orgId} AND b.id = ${id}`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      pageRowId: number;
      userId: number | null;
      name: string;
      templateId: number | null;
      body: string;
      buttons: string | null;
      total: number;
    },
  ): Promise<number> {
    // The buttons are ciphertext held as a JSON string, because the column is jsonb.
    const res = await tx.execute(sql`
      INSERT INTO facebook_broadcasts (org_id, facebook_page_id, user_id, name, template_id, body, buttons, status, total)
      VALUES (${orgId}, ${v.pageRowId}, ${v.userId}, ${v.name}, ${v.templateId}, ${v.body},
              ${v.buttons === null ? null : JSON.stringify(v.buttons)}::jsonb, 'draft', ${v.total})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Frozen at creation so a person who wrote in mid-send is never added. In chunks to keep each statement small. */
  async insertRecipients(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    rows: Array<{ psid: string; title: string; conversationId: number }>,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const json = JSON.stringify(
        rows.slice(i, i + 500).map((r) => ({
          psid: r.psid,
          title: r.title.slice(0, 191),
          conversation_id: r.conversationId,
        })),
      );
      await tx.execute(sql`
        INSERT INTO facebook_broadcast_recipients (org_id, facebook_broadcast_id, psid, title, conversation_id, status)
        SELECT ${orgId}, ${broadcastId}, x.psid, x.title, x.conversation_id, 'pending'
        FROM jsonb_to_recordset(${json}::jsonb) AS x(psid text, title text, conversation_id bigint)`);
    }
  }

  async pendingCount(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM facebook_broadcast_recipients
      WHERE org_id = ${orgId} AND facebook_broadcast_id = ${broadcastId} AND status = 'pending'`);
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
      UPDATE facebook_broadcasts SET status = ${status}, last_error = ${o.lastError ?? null},
             started_at = CASE WHEN ${o.markStarted === true} THEN coalesce(started_at, now()) ELSE started_at END,
             finished_at = CASE WHEN ${o.markFinished === true} THEN now() WHEN ${o.clearFinished === true} THEN NULL ELSE finished_at END
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING row_version`);
    return Number((res.rows[0] as { row_version: number }).row_version);
  }

  /** Failed people go back to pending; blocked ones stay blocked (retrying a block is the same refusal). */
  async resetFailed(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE facebook_broadcast_recipients SET status = 'pending', error = NULL
      WHERE org_id = ${orgId} AND facebook_broadcast_id = ${broadcastId} AND status = 'failed'
      RETURNING id`);
    return res.rows.length;
  }

  /** Counters come from the rows, never incremented, so a repeated or interrupted batch cannot drift them. */
  async recompute(tx: Tx, orgId: number, broadcastId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE facebook_broadcasts b SET sent = c.sent, failed = c.failed, blocked = c.blocked
      FROM (
        SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed,
               count(*) FILTER (WHERE status = 'blocked')::int AS blocked
        FROM facebook_broadcast_recipients WHERE org_id = ${orgId} AND facebook_broadcast_id = ${broadcastId}
      ) c
      WHERE b.org_id = ${orgId} AND b.id = ${broadcastId}`);
  }

  /** Claims the next people: no two workers ever hold the same one. */
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
        SELECT id FROM facebook_broadcast_recipients
        WHERE org_id = ${orgId} AND facebook_broadcast_id = ${broadcastId} AND status = 'pending'
          -- A recipient held for the quiet hours (BL-191) is left alone until its hour has come.
          AND (held_until IS NULL OR held_until <= now()) AND id > ${afterId}
        ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE facebook_broadcast_recipients r SET status = 'processing'
        FROM picked
        WHERE r.org_id = ${orgId} AND r.id = picked.id
        RETURNING r.id, r.psid, r.title, r.conversation_id, (r.held_until IS NOT NULL) AS was_held
      )
      SELECT cl.id, cl.psid, cl.title, cl.conversation_id, cl.was_held, c.contact_id
      FROM claimed cl
      LEFT JOIN conversations c ON c.org_id = ${orgId} AND c.id = cl.conversation_id`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        psid: string;
        title: string | null;
        conversation_id: number | string | null;
        was_held: boolean;
        contact_id: number | string | null;
      }>
    )
      .map((r) => ({
        id: Number(r.id),
        psid: r.psid,
        title: r.title,
        conversationId: r.conversation_id === null ? null : Number(r.conversation_id),
        contactId: r.contact_id === null ? null : Number(r.contact_id),
        wasHeld: r.was_held === true,
      }))
      .sort((a, b) => a.id - b.id);
  }

  /** A person claimed by a worker that died goes back to pending. */
  async releaseStale(tx: Tx, orgId: number, broadcastId: number, minutes: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE facebook_broadcast_recipients SET status = 'pending'
      WHERE org_id = ${orgId} AND facebook_broadcast_id = ${broadcastId} AND status = 'processing'
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
      UPDATE facebook_broadcast_recipients SET status = ${v.status}, provider_message_id = ${v.providerMessageId ?? null},
             held_until = NULL, held_reason = NULL,
             error = ${v.error ? v.error.slice(0, 255) : null}, sent_at = CASE WHEN ${v.status === 'sent'} THEN now() ELSE sent_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM facebook_broadcasts WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
