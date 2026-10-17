import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { InboxCounts, InboxTab } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { channelOwnerSql, type ConversationViewer } from '../../realtime';
import { visibleToSql } from './visibility-sql';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

/** A conversation as the list and the header read it: the row, its channel, contact, assignee names and the version. */
export interface InboxConversationRow {
  id: number;
  uuid: string;
  channelId: number;
  channelUuid: string;
  channelKind: string;
  channelName: string;
  peerKey: string;
  peerName: string | null;
  title: string;
  preview: string | null;
  status: string;
  priority: string;
  archived: boolean;
  pinnedAt: string | null;
  mutedAt: string | null;
  unreadCount: number;
  needsContact: boolean;
  imported: boolean;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  assigneeUserId: number | null;
  assigneeUserUuid: string | null;
  assigneeUserName: string | null;
  assigneeTeamId: number | null;
  assigneeTeamUuid: string | null;
  assigneeTeamName: string | null;
  assigneeTeamColor: string | null;
  assigneeAgentUuid: string | null;
  assigneeAgentName: string | null;
  /** Who owns the channel (a personal mailbox's owner), for the visibility rule: see `ConversationRecord`. */
  channelOwnerUserId: number | null;
  snoozedUntil: string | null;
  /** Timestamps as text at the database's microsecond precision: they are keyset cursor material and must round-trip exactly. */
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  msgSeq: number;
  windowExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  customerLanguage: string | null;
  waitingSince: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  slaFirstResponseDue: string | null;
  slaResolutionDue: string | null;
  slaBreached: boolean;
  /** Tags on the thread, by name (exposed as `labels` on the wire, its original name). */
  labels: Array<{ id: string; name: string; color: string | null }>;
}

/** What a mutation locks and checks: the columns visibility, state rules and optimistic locking need, nothing joined. */
export interface LockedConversation {
  id: number;
  uuid: string;
  channelId: number;
  status: string;
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  assigneeAgentId: number | null;
  /** Who owns the channel (a personal mailbox's owner), for the visibility rule: see `ConversationRecord`. */
  channelOwnerUserId: number | null;
  resolvedAt: string | null;
  rowVersion: number;
}

export interface ListFilter {
  tab: InboxTab;
  /** `undefined`: the open threads. `'all'`: no filter. */
  status?: string;
  channelId?: number;
  /** Several channels at once: threads on any of them (the Filters window). */
  channelIds?: number[];
  /** Tag uuids: threads that carry any of them. */
  tagIds?: string[];
  /** What `tagIds` is matched against: the thread's own tags (default) or its contact's tags. */
  tagScope?: 'conversation' | 'contact';
  /** Several statuses at once (the Filters window); replaces `status`. */
  statuses?: string[];
  assignment?: 'assigned' | 'unassigned' | 'unattended';
  /** User uuids: threads assigned to any of them. */
  agentIds?: string[];
  /** `old` lists the oldest activity first and ignores pins. */
  sort?: 'recent' | 'old';
  /** `YYYY-MM-DD`: last activity from the start of `from` to the end of `to`. */
  from?: string;
  to?: string;
  q?: string;
  archived: boolean;
  limit: number;
  cursor?: ListCursor;
}

/** Where the previous page ended, in the list's sort order (pinned first, then newest activity). Timestamps keep microseconds. */
export interface ListCursor {
  pinnedAt: string | null;
  lastMessageAt: string;
  id: number;
}

export const encodeListCursor = (c: ListCursor): string =>
  Buffer.from(JSON.stringify([c.pinnedAt, c.lastMessageAt, c.id]), 'utf8').toString('base64url');

export function decodeListCursor(raw: string): ListCursor {
  try {
    const [pinnedAt, lastMessageAt, id] = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as [string | null, string, number];
    const ok =
      (pinnedAt === null || !Number.isNaN(Date.parse(pinnedAt))) &&
      typeof lastMessageAt === 'string' &&
      !Number.isNaN(Date.parse(lastMessageAt)) &&
      Number.isInteger(id);
    if (!ok) throw new Error('malformed');
    return { pinnedAt, lastMessageAt, id };
  } catch {
    throw AppError.validation('Invalid pagination cursor');
  }
}

/** Microsecond-precision text of a timestamptz column (a JS Date keeps milliseconds only, and ties then straddle a page boundary). */
const ts = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const SELECT_COLUMNS = sql.raw(`
  c.id, c.uuid, c.channel_id, ch.uuid AS channel_uuid, ch.kind AS channel_kind, ch.name AS channel_name, c.peer_key, c.peer_name, c.title, c.preview, c.status, c.priority, c.archived,
  ${ts('c.pinned_at')} AS pinned_at, ${ts('c.muted_at')} AS muted_at, c.unread_count, c.needs_contact, c.imported_at IS NOT NULL AS imported,
  c.contact_id, ct.uuid AS contact_uuid, ct.name AS contact_name,
  c.assignee_user_id, au.uuid AS assignee_user_uuid, au.full_name AS assignee_user_name,
  c.assignee_team_id, tm.uuid AS assignee_team_uuid, tm.name AS assignee_team_name, tm.color AS assignee_team_color,
  aa.uuid AS assignee_agent_uuid, aa.name AS assignee_agent_name,
  ${ts('c.snoozed_until')} AS snoozed_until, ${ts('c.last_message_at')} AS last_message_at,
  ${ts('c.last_inbound_at')} AS last_inbound_at, ${ts('c.last_outbound_at')} AS last_outbound_at,
  c.msg_seq, ${ts('c.window_expires_at')} AS window_expires_at,
  ${ts('c.created_at')} AS created_at, ${ts('c.updated_at')} AS updated_at, c.row_version,
  c.customer_language, ${ts('c.waiting_since')} AS waiting_since, ${ts('c.first_response_at')} AS first_response_at,
  ${ts('c.resolved_at')} AS resolved_at, ${ts('c.sla_first_response_due')} AS sla_first_response_due,
  ${ts('c.sla_resolution_due')} AS sla_resolution_due, c.sla_breached,
  COALESCE((SELECT json_agg(json_build_object('id', lt.uuid, 'name', lt.name::text, 'color', lt.color) ORDER BY lt.name)
            FROM conversation_tag lx JOIN tags lt ON lt.org_id = lx.org_id AND lt.id = lx.tag_id
            WHERE lx.org_id = c.org_id AND lx.conversation_id = c.id), '[]'::json) AS labels`);

const SELECT_ROW = sql`${SELECT_COLUMNS}, ${channelOwnerSql('c')} AS channel_owner_user_id`;

const FROM_ROW = sql`
  FROM conversations c
  JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
  LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id
  LEFT JOIN users au ON au.org_id = c.org_id AND au.id = c.assignee_user_id
  LEFT JOIN teams tm ON tm.org_id = c.org_id AND tm.id = c.assignee_team_id
  LEFT JOIN ai_agents aa ON aa.org_id = c.org_id AND aa.id = c.assignee_agent_id`;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: Raw): InboxConversationRow {
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    channelId: Number(r.channel_id),
    channelUuid: r.channel_uuid as string,
    channelKind: r.channel_kind as string,
    channelName: r.channel_name as string,
    peerKey: r.peer_key as string,
    peerName: str(r.peer_name),
    title: r.title as string,
    preview: str(r.preview),
    status: r.status as string,
    priority: r.priority as string,
    archived: r.archived === true,
    pinnedAt: str(r.pinned_at),
    mutedAt: str(r.muted_at),
    unreadCount: Number(r.unread_count),
    needsContact: r.needs_contact === true,
    imported: r.imported === true,
    contactId: int(r.contact_id),
    contactUuid: str(r.contact_uuid),
    contactName: str(r.contact_name),
    assigneeUserId: int(r.assignee_user_id),
    assigneeUserUuid: str(r.assignee_user_uuid),
    assigneeUserName: str(r.assignee_user_name),
    assigneeTeamId: int(r.assignee_team_id),
    assigneeTeamUuid: str(r.assignee_team_uuid),
    assigneeTeamName: str(r.assignee_team_name),
    assigneeTeamColor: str(r.assignee_team_color),
    assigneeAgentUuid: str(r.assignee_agent_uuid),
    assigneeAgentName: str(r.assignee_agent_name),
    channelOwnerUserId: int(r.channel_owner_user_id),
    snoozedUntil: str(r.snoozed_until),
    lastMessageAt: str(r.last_message_at),
    lastInboundAt: str(r.last_inbound_at),
    lastOutboundAt: str(r.last_outbound_at),
    msgSeq: Number(r.msg_seq),
    windowExpiresAt: str(r.window_expires_at),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    rowVersion: Number(r.row_version),
    customerLanguage: str(r.customer_language),
    waitingSince: str(r.waiting_since),
    firstResponseAt: str(r.first_response_at),
    resolvedAt: str(r.resolved_at),
    slaFirstResponseDue: str(r.sla_first_response_due),
    slaResolutionDue: str(r.sla_resolution_due),
    slaBreached: r.sla_breached === true,
    labels: (r.labels as InboxConversationRow['labels'] | null) ?? [],
  };
}

/** The visibility columns of one conversation (`ConversationRecord` plus its id). */
export interface ConversationRecordRow {
  id: number;
  /** The thread's status: a `resolved` or `closed` thread takes no agent reply (see `InboxThreadService.assertCanReply`). */
  status: string;
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  channelOwnerUserId: number | null;
}

const toRecord = (r: Raw): ConversationRecordRow => ({
  id: Number(r.id),
  status: String(r.status),
  assigneeUserId: int(r.assignee_user_id),
  assigneeTeamId: int(r.assignee_team_id),
  channelOwnerUserId: int(r.channel_owner_user_id),
});

/** Escapes the three characters that mean something to LIKE, so a search for `50%` looks for 50 followed by a percent sign. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Data access for the inbox's conversation read model and the few writes the inbox makes on the thread's own lifecycle (status).
 * Every method takes the transaction it runs in; `org_id` is named in every statement for the planner, row-level security is the
 * backstop. Writes to the assignee columns are NOT here: only the assignment service writes those.
 *
 * A conversation without a message is not an inbox item (it has nothing to answer): the list and the counts skip rows whose
 * `last_message_at` is null, which also keeps the keyset order total.
 */
@Injectable()
export class ConversationsRepository {
  /** One page, `limit + 1` rows (the extra one answers `hasMore`), in the list's order: pinned first, newest activity first. */
  async list(
    tx: Tx,
    orgId: number,
    viewer: ConversationViewer,
    f: ListFilter,
  ): Promise<InboxConversationRow[]> {
    const where: SQL[] = [
      sql`c.org_id = ${orgId}`,
      sql`c.last_message_at IS NOT NULL`,
      visibleToSql(viewer),
      sql`c.archived = ${f.archived}`,
    ];

    // The archive view shows everything archived whatever the tab or status (Reference rule); otherwise the tab and status narrow it.
    if (!f.archived) {
      if (f.statuses && f.statuses.length > 0) {
        // Resolved and closed are one thing to an agent, so choosing Resolved lists both.
        const all = new Set(
          f.statuses.flatMap((s) => (s === 'resolved' ? ['resolved', 'closed'] : [s])),
        );
        where.push(
          sql`c.status IN (${sql.join(
            [...all].map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      } else if (f.status === undefined) where.push(sql`c.status = 'open'`);
      // Resolved and closed are one thing to an agent (the same Resolve button, the same reopen), so the Resolved view lists both.
      else if (f.status === 'resolved') where.push(sql`c.status IN ('resolved', 'closed')`);
      else if (f.status !== 'all') where.push(sql`c.status = ${f.status}`);
      const tab = this.tabCondition(f.tab, viewer.userId);
      if (tab) where.push(tab);
    }
    if (f.channelId !== undefined) where.push(sql`c.channel_id = ${f.channelId}`);
    if (f.channelIds && f.channelIds.length > 0)
      where.push(
        sql`c.channel_id IN (${sql.join(
          f.channelIds.map((n) => sql`${n}`),
          sql`, `,
        )})`,
      );
    if (f.tagIds && f.tagIds.length > 0) {
      const ids = sql.join(
        f.tagIds.map((u) => sql`${u}::uuid`),
        sql`, `,
      );
      // The contact's tags are `contact_tags` (indexed on org_id + contact_id); the thread's own are `conversation_tag`. Both joins
      // carry org_id, so the row-level security of the surrounding transaction and the explicit tenant match agree.
      where.push(
        f.tagScope === 'contact'
          ? sql`EXISTS (SELECT 1 FROM contact_tags fx JOIN tags ft ON ft.org_id = fx.org_id AND ft.id = fx.tag_id
        WHERE fx.org_id = c.org_id AND fx.contact_id = c.contact_id AND ft.uuid IN (${ids}))`
          : sql`EXISTS (SELECT 1 FROM conversation_tag fx JOIN tags ft ON ft.org_id = fx.org_id AND ft.id = fx.tag_id
        WHERE fx.org_id = c.org_id AND fx.conversation_id = c.id AND ft.uuid IN (${ids}))`,
      );
    }
    if (f.assignment === 'assigned') where.push(sql`c.assignee_user_id IS NOT NULL`);
    else if (f.assignment === 'unassigned') where.push(sql`c.assignee_user_id IS NULL`);
    else if (f.assignment === 'unattended') where.push(sql`c.unread_count > 0`);
    if (f.agentIds && f.agentIds.length > 0) {
      const ids = sql.join(
        f.agentIds.map((u) => sql`${u}::uuid`),
        sql`, `,
      );
      where.push(
        sql`c.assignee_user_id IN (SELECT fu.id FROM users fu WHERE fu.org_id = c.org_id AND fu.uuid IN (${ids}))`,
      );
    }
    if (f.from) where.push(sql`c.last_message_at >= ${f.from}::date`);
    if (f.to) where.push(sql`c.last_message_at < (${f.to}::date + 1)`);
    if (f.q) where.push(this.searchCondition(f.q));
    const oldest = f.sort === 'old';
    if (f.cursor) where.push(this.cursorCondition(f.cursor, oldest));

    const res = await tx.execute(sql`
      SELECT ${SELECT_ROW} ${FROM_ROW}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${
        oldest
          ? sql`c.last_message_at ASC, c.id ASC`
          : sql`c.pinned_at DESC NULLS LAST, c.last_message_at DESC, c.id DESC`
      }
      LIMIT ${f.limit + 1}`);
    return rowsOf(res).map(toRow);
  }

  /** The tab badges, over the same visible set as the list, narrowed by channel only. One aggregate, so a badge equals what the list shows. */
  async counts(
    tx: Tx,
    orgId: number,
    viewer: ConversationViewer,
    channelId?: number,
  ): Promise<InboxCounts> {
    const channel = channelId === undefined ? sql`TRUE` : sql`c.channel_id = ${channelId}`;
    const active = sql`c.archived = FALSE AND c.status = 'open'`;
    const res = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${active})::int AS "all",
        count(*) FILTER (WHERE ${active} AND c.assignee_user_id = ${viewer.userId})::int AS mine,
        count(*) FILTER (WHERE ${active} AND c.assignee_user_id IS NULL)::int AS unassigned,
        count(*) FILTER (WHERE ${active} AND c.unread_count > 0)::int AS unread,
        count(*) FILTER (WHERE c.archived)::int AS archived
      FROM conversations c
      WHERE c.org_id = ${orgId} AND c.last_message_at IS NOT NULL AND ${visibleToSql(viewer)} AND ${channel}`);
    const r = rowsOf(res)[0] ?? {};
    return {
      all: Number(r.all ?? 0),
      mine: Number(r.mine ?? 0),
      unassigned: Number(r.unassigned ?? 0),
      unread: Number(r.unread ?? 0),
      archived: Number(r.archived ?? 0),
    };
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<InboxConversationRow | null> {
    const res = await tx.execute(
      sql`SELECT ${SELECT_ROW} ${FROM_ROW} WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}`,
    );
    const row = rowsOf(res)[0];
    return row ? toRow(row) : null;
  }

  /**
   * Takes the row lock and returns what a mutation checks. Two writers on one thread (an agent, an inbound message, a sweep)
   * serialise here, and the version the caller read is compared against the locked row, not a stale copy.
   */
  async lockByUuid(tx: Tx, orgId: number, uuid: string): Promise<LockedConversation | null> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.channel_id, c.status, c.assignee_user_id, c.assignee_team_id, c.assignee_agent_id,
             ${channelOwnerSql('c')} AS channel_owner_user_id,
             ${sql.raw(ts('c.resolved_at'))} AS resolved_at, c.row_version
      FROM conversations c WHERE c.org_id = ${orgId} AND c.uuid = ${uuid} FOR UPDATE OF c`);
    const r = rowsOf(res)[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      channelId: Number(r.channel_id),
      status: r.status as string,
      assigneeUserId: int(r.assignee_user_id),
      assigneeTeamId: int(r.assignee_team_id),
      assigneeAgentId: int(r.assignee_agent_id),
      channelOwnerUserId: int(r.channel_owner_user_id),
      resolvedAt: str(r.resolved_at),
      rowVersion: Number(r.row_version),
    };
  }

  /** The visibility columns of a conversation by uuid, without a lock (the cheap "may this person see it" check for reads). */
  async recordByUuid(tx: Tx, orgId: number, uuid: string): Promise<ConversationRecordRow | null> {
    const res = await tx.execute(
      sql`SELECT c.id, c.status, c.assignee_user_id, c.assignee_team_id, ${channelOwnerSql('c')} AS channel_owner_user_id
          FROM conversations c WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}`,
    );
    const r = rowsOf(res)[0];
    return r ? toRecord(r) : null;
  }

  /**
   * The conversation a message belongs to, for the visibility check of a route that names a message (retry). The only read of `messages`
   * this domain makes: the message pipeline itself is the conversation core's.
   */
  async recordByMessageUuid(
    tx: Tx,
    orgId: number,
    messageUuid: string,
  ): Promise<ConversationRecordRow | null> {
    const res = await tx.execute(sql`
      SELECT c.id, c.status, c.assignee_user_id, c.assignee_team_id, ${channelOwnerSql('c')} AS channel_owner_user_id
      FROM conversations c
      WHERE c.org_id = ${orgId}
        AND c.id = (SELECT m.conversation_id FROM messages m WHERE m.org_id = ${orgId} AND m.uuid = ${messageUuid} LIMIT 1)`);
    const r = rowsOf(res)[0];
    return r ? toRecord(r) : null;
  }

  /** The wire id of a staff user: events and outbox payloads carry uuids, never the internal id. */
  async userUuid(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return (rowsOf(res)[0]?.uuid as string | undefined) ?? null;
  }

  /** The lifecycle columns a status change writes. The `touch_row` trigger moves `row_version`. */
  async setStatus(
    tx: Tx,
    orgId: number,
    id: number,
    patch: {
      status: string;
      resolvedAt: 'now' | null | 'keep';
      resolvedBy: number | null | 'keep';
      clearSnooze: boolean;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET
        status = ${patch.status},
        resolved_at = ${patch.resolvedAt === 'keep' ? sql`resolved_at` : patch.resolvedAt === 'now' ? sql`now()` : sql`NULL`},
        resolved_by = ${patch.resolvedBy === 'keep' ? sql`resolved_by` : patch.resolvedBy},
        resolved_by_agent_id = ${patch.resolvedAt === null ? sql`NULL` : sql`resolved_by_agent_id`},
        snoozed_until = ${patch.clearSnooze ? sql`NULL` : sql`snoozed_until`}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * What a bulk request needs to know about each named conversation, no visibility applied (the single-conversation call that follows
   * applies it): the version to send, the newest message seq, and the unread counter. A uuid that is not in the workspace is absent.
   */
  async bulkProbe(
    tx: Tx,
    orgId: number,
    uuids: string[],
  ): Promise<Map<string, { rowVersion: number; msgSeq: number; unreadCount: number }>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, row_version, msg_seq, unread_count FROM conversations
      WHERE org_id = ${orgId} AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    return new Map(
      rowsOf(res).map((r) => [
        r.uuid as string,
        {
          rowVersion: Number(r.row_version),
          msgSeq: Number(r.msg_seq),
          unreadCount: Number(r.unread_count),
        },
      ]),
    );
  }

  /** The priority column. The `touch_row` trigger moves `row_version`. */
  async setPriority(tx: Tx, orgId: number, id: number, priority: string): Promise<void> {
    await tx.execute(
      sql`UPDATE conversations SET priority = ${priority} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Park the thread until `until`: status `snoozed`, wake time set. The partial index `idx_conversations_snooze_due` serves the sweep. */
  async snooze(tx: Tx, orgId: number, id: number, until: Date): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET status = 'snoozed', snoozed_until = ${until.toISOString()}::timestamptz
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Snoozed threads whose wake time has passed, across every workspace (privileged transaction), oldest first. Locks the rows it
   * returns and skips ones another sweep holds, so two workers never wake the same thread twice.
   */
  async lockDueSnoozed(
    tx: Tx,
    limit: number,
  ): Promise<
    Array<{
      id: number;
      orgId: number;
      uuid: string;
      rowVersion: number;
      assigneeUserId: number | null;
      assigneeTeamId: number | null;
      channelOwnerUserId: number | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT c.id, c.org_id, c.uuid, c.row_version, c.assignee_user_id, c.assignee_team_id,
             ${channelOwnerSql('c')} AS channel_owner_user_id
      FROM conversations c
      WHERE c.status = 'snoozed' AND c.snoozed_until IS NOT NULL AND c.snoozed_until <= now()
      ORDER BY c.snoozed_until, c.id LIMIT ${limit} FOR UPDATE OF c SKIP LOCKED`);
    return rowsOf(res).map((r) => ({
      id: Number(r.id),
      orgId: Number(r.org_id),
      uuid: r.uuid as string,
      rowVersion: Number(r.row_version),
      assigneeUserId: int(r.assignee_user_id),
      assigneeTeamId: int(r.assignee_team_id),
      channelOwnerUserId: int(r.channel_owner_user_id),
    }));
  }

  /** Mark a thread as spam: the status moves, the wake time is dropped (a spam thread has nothing to wake for). */
  async markSpam(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET status = 'spam', snoozed_until = NULL
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Wake a snoozed thread: open again, wake time cleared. */
  async wake(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET status = 'open', snoozed_until = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'snoozed'`);
  }

  /** Other threads with the same contact, newest first, inside the caller's visibility. */
  async pastConversations(
    tx: Tx,
    orgId: number,
    viewer: ConversationViewer,
    contactId: number,
    exceptId: number,
    limit = 20,
  ): Promise<InboxConversationRow[]> {
    const res = await tx.execute(sql`
      SELECT ${SELECT_ROW} ${FROM_ROW}
      WHERE c.org_id = ${orgId} AND c.contact_id = ${contactId} AND c.id <> ${exceptId}
        AND c.last_message_at IS NOT NULL AND ${visibleToSql(viewer)}
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT ${limit}`);
    return rowsOf(res).map(toRow);
  }

  private tabCondition(tab: InboxTab, userId: number): SQL | null {
    switch (tab) {
      case 'mine':
        return sql`c.assignee_user_id = ${userId}`;
      // A thread held by an AI agent has no human assignee, so it counts as unassigned (Reference).
      case 'unassigned':
        return sql`c.assignee_user_id IS NULL`;
      case 'unread':
        return sql`c.unread_count > 0`;
      case 'all':
        return null;
    }
  }

  /** Name, number or last message, as typed: the contact's name too, since a thread's own title can be older than a rename. */
  private searchCondition(q: string): SQL {
    const like = likePattern(q);
    const parts = [
      sql`c.title ILIKE ${like}`,
      sql`c.peer_name ILIKE ${like}`,
      sql`c.peer_key ILIKE ${like}`,
      sql`c.preview ILIKE ${like}`,
      sql`ct.name ILIKE ${like}`,
    ];
    // "+91 98765-43210" must find 919876543210: compare the digits of the query with the digits stored as the peer key.
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3 && /^[\d\s+()\-.]+$/.test(q)) {
      parts.push(sql`c.peer_key LIKE ${`%${digits}%`}`);
    }
    return sql`(${sql.join(parts, sql` OR `)})`;
  }

  /** Strictly after the cursor row in the list order. Pinned rows come first; inside each group newest activity first, id last. */
  private cursorCondition(cur: ListCursor, oldest = false): SQL {
    if (oldest)
      return sql`(c.last_message_at, c.id) > (${cur.lastMessageAt}::timestamptz, ${cur.id})`;
    if (cur.pinnedAt !== null) {
      return sql`(
        (c.pinned_at IS NOT NULL AND (c.pinned_at, c.last_message_at, c.id) < (${cur.pinnedAt}::timestamptz, ${cur.lastMessageAt}::timestamptz, ${cur.id}))
        OR c.pinned_at IS NULL)`;
    }
    return sql`(c.pinned_at IS NULL AND (c.last_message_at, c.id) < (${cur.lastMessageAt}::timestamptz, ${cur.id}))`;
  }
}
