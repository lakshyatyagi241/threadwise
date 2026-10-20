import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { routingAssignSchema, type ConversationPriority, type RoutingAssign } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { onLeaveOnSql } from '../../common/workspace-calendar';

type Raw = Record<string, unknown>;
export type RuleRow = Raw;

const rowsOf = (res: unknown): Raw[] => (res as { rows: Raw[] }).rows;

/** `a,b` as `uuid IN (...)`; an empty list matches nothing. */
const uuidList = (ids: readonly string[]): SQL =>
  ids.length === 0
    ? sql`NULL::uuid`
    : sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      );

const encode = (sort: number, id: number) =>
  Buffer.from(`${sort}|${id}`, 'utf8').toString('base64url');
function decode(cursor: string): { sort: number; id: number } | null {
  const [s, i] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const sort = Number.parseInt(s ?? '', 10);
  const id = Number.parseInt(i ?? '', 10);
  return Number.isNaN(sort) || Number.isNaN(id) ? null : { sort, id };
}

/** Every `routing_rules` query. Each takes the caller's tenant transaction. `position` is the rule's place in the whole priority order. */
@Injectable()
export class RoutingRulesRepository {
  private readonly ranked = (orgId: number): SQL => sql`
    SELECT r.*, row_number() OVER (ORDER BY r.sort, r.id)::int AS position
    FROM routing_rules r WHERE r.org_id = ${orgId}`;

  async list(
    tx: Tx,
    orgId: number,
    q: { q?: string; limit: number; cursor?: string },
  ): Promise<{ rows: Raw[]; nextCursor: string | null }> {
    const cur = q.cursor ? decode(q.cursor) : null;
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const res = await tx.execute(sql`
      WITH ranked AS (${this.ranked(orgId)})
      SELECT * FROM ranked
      WHERE TRUE
        ${like ? sql`AND name ILIKE ${like}` : sql``}
        ${cur ? sql`AND (sort, id) > (${cur.sort}, ${cur.id})` : sql``}
      ORDER BY sort, id
      LIMIT ${q.limit + 1}`);
    const rows = rowsOf(res);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: rows.length > q.limit && last ? encode(Number(last.sort), Number(last.id)) : null,
    };
  }

  async byUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<RuleRow | null> {
    const res = await tx.execute(sql`
      WITH ranked AS (${this.ranked(orgId)})
      SELECT * FROM ranked WHERE uuid = ${uuid}::uuid`);
    const row = rowsOf(res)[0] ?? null;
    if (row && lock) {
      await tx.execute(
        sql`SELECT 1 FROM routing_rules WHERE org_id = ${orgId} AND id = ${row.id as number} FOR UPDATE`,
      );
    }
    return row;
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM routing_rules WHERE org_id = ${orgId}`,
    );
    return Number(rowsOf(res)[0]!.n);
  }

  async nextSort(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT COALESCE(max(sort), 0)::int + 1 AS n FROM routing_rules WHERE org_id = ${orgId}`,
    );
    return Number(rowsOf(res)[0]!.n);
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      conditions: unknown;
      actions: unknown;
      stopOnMatch: boolean;
      isActive: boolean;
      isFallback: boolean;
      sort: number;
    },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO routing_rules (org_id, name, conditions, actions, stop_on_match, is_active, is_fallback, sort)
      VALUES (${orgId}, ${v.name}, ${JSON.stringify(v.conditions)}::jsonb, ${JSON.stringify(v.actions)}::jsonb,
              ${v.stopOnMatch}, ${v.isActive}, ${v.isFallback}, ${v.sort})
      RETURNING id, uuid`);
    const r = rowsOf(res)[0]!;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  /** Writes the fields given, only if the row is still at `rowVersion`. Returns false when it moved (the caller answers 409). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: {
      name?: string;
      conditions?: unknown;
      actions?: unknown;
      stopOnMatch?: boolean;
      isActive?: boolean;
      isFallback?: boolean;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE routing_rules SET
        name = COALESCE(${v.name ?? null}, name),
        conditions = COALESCE(${v.conditions === undefined ? null : JSON.stringify(v.conditions)}::jsonb, conditions),
        actions = COALESCE(${v.actions === undefined ? null : JSON.stringify(v.actions)}::jsonb, actions),
        stop_on_match = COALESCE(${v.stopOnMatch ?? null}::boolean, stop_on_match),
        is_active = COALESCE(${v.isActive ?? null}::boolean, is_active),
        is_fallback = COALESCE(${v.isFallback ?? null}::boolean, is_fallback)
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** At most one fallback: the others lose the flag (the rule being saved keeps it). */
  async clearOtherFallbacks(tx: Tx, orgId: number, keepId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE routing_rules SET is_fallback = FALSE WHERE org_id = ${orgId} AND is_fallback AND id <> ${keepId}`,
    );
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM routing_rules WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The listed rules (by uuid) with the slots they hold, locked, in current priority order. Missing ones are simply absent. */
  async lockSlots(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
  ): Promise<Array<{ id: number; uuid: string; sort: number }>> {
    const res = await tx.execute(sql`
      SELECT id, uuid, sort FROM routing_rules
      WHERE org_id = ${orgId} AND uuid IN (${uuidList(uuids)})
      ORDER BY sort, id FOR UPDATE`);
    return rowsOf(res).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      sort: Number(r.sort),
    }));
  }

  async setSort(tx: Tx, orgId: number, id: number, sort: number): Promise<void> {
    await tx.execute(
      sql`UPDATE routing_rules SET sort = ${sort} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  // --- what a rule points at ---------------------------------------------------------------------------------------------------

  /** Active members among these uuids, as internal id by uuid. */
  async activeUsers(tx: Tx, orgId: number, uuids: readonly string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM users
      WHERE org_id = ${orgId} AND status = 'active' AND uuid IN (${uuidList(uuids)})`);
    return new Map(rowsOf(res).map((r) => [r.uuid as string, Number(r.id)]));
  }

  /**
   * Teams by uuid. `receivingOnly` keeps out the teams switched to "does not receive conversations" (Teams v2): the engine and
   * the save check use it, so such a team is neither chosen nor given work; the rules list does not, so it can still count a
   * rule that points at one.
   */
  async teams(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
    opts: { receivingOnly?: boolean } = {},
  ): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM teams WHERE org_id = ${orgId} AND uuid IN (${uuidList(uuids)})
        ${opts.receivingOnly ? sql`AND receives_conversations` : sql``}`);
    return new Map(rowsOf(res).map((r) => [r.uuid as string, Number(r.id)]));
  }

  /** The flows a rule can start, by uuid: the name to show and whether the flow is switched on. A deleted flow is not in the map. */
  async flowsByUuid(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
  ): Promise<Map<string, { name: string; isActive: boolean }>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, flow_name, is_active FROM flows WHERE org_id = ${orgId} AND uuid IN (${uuidList(uuids)})`);
    return new Map(
      rowsOf(res).map((r) => [
        r.uuid as string,
        { name: r.flow_name as string, isActive: r.is_active === true },
      ]),
    );
  }

  // --- settings ------------------------------------------------------------------------------------------------------------------

  async keepContactAgent(tx: Tx, orgId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT routing_keep_contact_agent AS v FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    return rowsOf(res)[0]?.v === true;
  }

  /** A workspace has no settings row until something writes one: upsert (every other column has a default). */
  async setKeepContactAgent(tx: Tx, orgId: number, value: boolean): Promise<void> {
    await tx.execute(sql`
      INSERT INTO workspace_settings (org_id, routing_keep_contact_agent) VALUES (${orgId}, ${value})
      ON CONFLICT (org_id) DO UPDATE SET routing_keep_contact_agent = EXCLUDED.routing_keep_contact_agent`);
  }

  // --- the engine's reads --------------------------------------------------------------------------------------------------------

  /** Active rules in the order they are tried (priority, then id), with the row version the engine reads them at. */
  async activeRules(tx: Tx, orgId: number): Promise<RuleRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, conditions, actions, stop_on_match, is_fallback, row_version
      FROM routing_rules WHERE org_id = ${orgId} AND is_active ORDER BY sort, id`);
    return rowsOf(res);
  }

  /** Locks one rule and returns its current actions (the cursor another conversation may have just moved). */
  async lockActions(tx: Tx, orgId: number, id: number): Promise<unknown | null> {
    const res = await tx.execute(
      sql`SELECT actions FROM routing_rules WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`,
    );
    return rowsOf(res)[0]?.actions ?? null;
  }

  async markFired(tx: Tx, orgId: number, id: number, actions: unknown): Promise<void> {
    await tx.execute(sql`
      UPDATE routing_rules SET fired_count = fired_count + 1, last_fired_at = now(), actions = ${JSON.stringify(actions)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** What the engine needs of the conversation besides the locked columns. */
  async conversationFacts(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{
    contactId: number | null;
    language: string | null;
    archived: boolean;
    channelKind: string;
    routedMessage: string | null;
  } | null> {
    const res = await tx.execute(sql`
      SELECT c.contact_id, c.customer_language, c.archived, ch.kind AS channel_kind,
             c.routing_meta ->> 'routedMessage' AS routed_message
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${id}`);
    const r = rowsOf(res)[0];
    if (!r) return null;
    return {
      contactId: r.contact_id === null ? null : Number(r.contact_id),
      language: (r.customer_language as string | null) ?? null,
      archived: r.archived === true,
      channelKind: r.channel_kind as string,
      routedMessage: (r.routed_message as string | null) ?? null,
    };
  }

  /** Remembers which message this conversation was routed for: a second delivery of the same message does nothing. */
  async stampRouted(tx: Tx, orgId: number, id: number, messageUuid: string): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations
      SET routing_meta = COALESCE(routing_meta, '{}'::jsonb) || ${JSON.stringify({ routedMessage: messageUuid, routedAt: new Date().toISOString() })}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * The schedule (`workspace_settings.business_hours`, JSON text, null when never saved) and the zone the owner set on the workspace
   * (`organizations.settings.timezone`, the one the profile and every other screen read; `workspace_settings.timezone` is never written).
   */
  async businessHours(tx: Tx, orgId: number): Promise<{ hours: unknown; timezone: string }> {
    const res = await tx.execute(sql`
      SELECT ws.business_hours, COALESCE(o.settings ->> 'timezone', 'UTC') AS timezone
      FROM organizations o
      LEFT JOIN workspace_settings ws ON ws.org_id = o.id
      WHERE o.id = ${orgId}`);
    const r = rowsOf(res)[0];
    return { hours: r?.business_hours ?? null, timezone: (r?.timezone as string | null) ?? 'UTC' };
  }

  /** Who the workspace owner is (the uuid the org settings name), null when the workspace names none. */
  async ownerUuid(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT settings ->> 'ownerUserId' AS owner FROM organizations WHERE id = ${orgId}`,
    );
    return (rowsOf(res)[0]?.owner as string | null | undefined) ?? null;
  }

  async userUuid(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid::text AS uuid FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return (rowsOf(res)[0]?.uuid as string | undefined) ?? null;
  }

  async setBusinessHours(tx: Tx, orgId: number, hours: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO workspace_settings (org_id, business_hours) VALUES (${orgId}, ${hours})
      ON CONFLICT (org_id) DO UPDATE SET business_hours = EXCLUDED.business_hours`);
  }

  async setOrgTimezone(tx: Tx, orgId: number, zone: string): Promise<void> {
    await tx.execute(sql`
      UPDATE organizations SET settings = settings || jsonb_build_object('timezone', ${zone}::text)
      WHERE id = ${orgId}`);
  }

  /** The contact matches the compiled segment rules (a condition over `contacts`). */
  async contactMatches(tx: Tx, orgId: number, contactId: number, where: SQL): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 AS ok FROM contacts WHERE org_id = ${orgId} AND id = ${contactId} AND (${where}) LIMIT 1`,
    );
    return rowsOf(res).length > 0;
  }

  async contactOwner(tx: Tx, orgId: number, contactId: number): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT owner_id FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    const v = rowsOf(res)[0]?.owner_id;
    return v === null || v === undefined ? null : Number(v);
  }

  /** The person who held this contact's most recent other conversation. */
  async lastAgentOf(
    tx: Tx,
    orgId: number,
    contactId: number,
    exceptConversationId: number,
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      SELECT assignee_user_id FROM conversations
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND id <> ${exceptConversationId}
        AND assignee_user_id IS NOT NULL
      ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC LIMIT 1`);
    const v = rowsOf(res)[0]?.assignee_user_id;
    return v === null || v === undefined ? null : Number(v);
  }

  /** A user who may take a conversation by being the contact's agent: an active member (the caller checks the inbox right). */
  async activeUserById(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid FROM users WHERE org_id = ${orgId} AND id = ${userId} AND status = 'active'`,
    );
    const r = rowsOf(res)[0];
    return r ? { id: Number(r.id), uuid: r.uuid as string } : null;
  }

  /** Uuids of these people (internal id to uuid). */
  async userUuids(tx: Tx, orgId: number, ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT id, uuid FROM users WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    return new Map(rowsOf(res).map((r) => [Number(r.id), r.uuid as string]));
  }

  /** The delegate each of these people named, as internal ids (people without one are absent). */
  async delegatesOf(
    tx: Tx,
    orgId: number,
    userIds: readonly number[],
  ): Promise<Map<number, { id: number; uuid: string }>> {
    if (userIds.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT d.user_id, d.delegate_user_id, du.uuid
      FROM member_delegates d JOIN users du ON du.org_id = d.org_id AND du.id = d.delegate_user_id
      WHERE d.org_id = ${orgId} AND du.status = 'active' AND d.user_id IN (${sql.join(
        userIds.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    return new Map(
      rowsOf(res).map((r) => [
        Number(r.user_id),
        { id: Number(r.delegate_user_id), uuid: r.uuid as string },
      ]),
    );
  }

  /** (team, person) pairs of these teams, for expanding a rule's teams into people. */
  async teamMembers(
    tx: Tx,
    orgId: number,
    teamIds: readonly number[],
  ): Promise<Array<{ teamId: number; userId: number }>> {
    if (teamIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT team_id, user_id FROM team_members
      WHERE org_id = ${orgId} AND team_id IN (${sql.join(
        teamIds.map((t) => sql`${t}`),
        sql`, `,
      )})`);
    return rowsOf(res).map((r) => ({ teamId: Number(r.team_id), userId: Number(r.user_id) }));
  }

  /**
   * Of these people, the ones who can take a conversation now: active members who are not marked offline or busy (nobody who never
   * switched their status counts as available, as Reference's routing did), who are not on leave, and who have not reached their
   * own chat limit (`user_profiles.chat_limit`, the Concurrent Chat setting; no limit when empty), with the open conversations each
   * holds right now. An agent already holding that many open conversations is left out of every strategy, so round robin and least
   * busy both skip them.
   */
  async available(
    tx: Tx,
    orgId: number,
    userIds: readonly number[],
    today: string,
  ): Promise<Array<{ id: number; uuid: string; open: number }>> {
    if (userIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT m.id, m.uuid, m.open FROM (
        SELECT u.id, u.uuid, p.chat_limit,
               (SELECT count(*)::int FROM conversations c
                 WHERE c.org_id = u.org_id AND c.assignee_user_id = u.id AND NOT c.archived
                   AND c.status = 'open') AS open
        FROM users u
        LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
        LEFT JOIN user_profiles p ON p.org_id = u.org_id AND p.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.status = 'active'
          AND u.id IN (${sql.join(
            userIds.map((i) => sql`${i}`),
            sql`, `,
          )})
          AND COALESCE(s.status, 'online') NOT IN ('offline', 'busy')
          -- on leave today (the workspace's calendar): never picked by routing (BL-112)
          AND NOT ${onLeaveOnSql('u', today)}
      ) m
      WHERE m.chat_limit IS NULL OR m.open < m.chat_limit
      ORDER BY m.id`);
    return rowsOf(res).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      open: Number(r.open),
    }));
  }

  /**
   * The workspace tag with this name (case-insensitive, as the tag library is), created when it does not exist. Returns its id.
   * Reference's add_tag does the same (firstOrCreate by slug).
   */
  async findOrCreateTag(
    tx: Tx,
    orgId: number,
    name: string,
    color: string | null,
  ): Promise<number> {
    const created = rowsOf(
      await tx.execute(sql`
        INSERT INTO tags (org_id, uuid, name, color)
        VALUES (${orgId}, gen_random_uuid(), ${name}, ${color ?? '#075E54'})
        ON CONFLICT (org_id, name) DO NOTHING
        RETURNING id`),
    );
    if (created[0]) return Number(created[0].id);
    const found = rowsOf(
      await tx.execute(sql`SELECT id FROM tags WHERE org_id = ${orgId} AND name = ${name}`),
    );
    return Number(found[0]!.id);
  }

  /** True when the tag was put on the conversation now, false when it already had it. */
  async attachTag(tx: Tx, orgId: number, conversationId: number, tagId: number): Promise<boolean> {
    const res = rowsOf(
      await tx.execute(sql`
        INSERT INTO conversation_tag (org_id, conversation_id, tag_id, added_by)
        VALUES (${orgId}, ${conversationId}, ${tagId}, NULL)
        ON CONFLICT (org_id, conversation_id, tag_id) DO NOTHING
        RETURNING id`),
    );
    return res.length > 0;
  }

  /** Schedules the deferred action (Reference's escalation): it runs at `dueAt` unless the thread gets a reply first. */
  async setEscalation(
    tx: Tx,
    orgId: number,
    conversationId: number,
    dueAt: Date,
    action: { ruleId: string; ruleName: string; priority: string | null; assign: unknown },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET escalation_due_at = ${dueAt.toISOString()}::timestamptz,
        escalation_action = ${JSON.stringify(action)}::jsonb
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
  }

  async clearEscalation(tx: Tx, orgId: number, conversationId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET escalation_due_at = NULL, escalation_action = NULL
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
  }

  /**
   * The deferred action of this conversation, when it is due and still applies: the thread is open and nobody from us has replied
   * (`first_response_at` is empty). Null otherwise. The caller holds the row lock.
   */
  async dueEscalation(
    tx: Tx,
    orgId: number,
    conversationId: number,
    now: Date,
  ): Promise<{
    ruleId: string;
    ruleName: string;
    priority: ConversationPriority | null;
    assign: RoutingAssign | null;
  } | null> {
    const res = rowsOf(
      await tx.execute(sql`
        SELECT escalation_action FROM conversations
        WHERE org_id = ${orgId} AND id = ${conversationId}
          AND escalation_due_at IS NOT NULL AND escalation_due_at <= ${now.toISOString()}::timestamptz
          AND status = 'open' AND first_response_at IS NULL`),
    );
    const raw = res[0]?.escalation_action as Raw | null | undefined;
    if (!raw || typeof raw.ruleId !== 'string') return null;
    const assign = routingAssignSchema.nullable().safeParse(raw.assign ?? null);
    const priority =
      raw.priority === 'low' ||
      raw.priority === 'normal' ||
      raw.priority === 'high' ||
      raw.priority === 'urgent'
        ? raw.priority
        : null;
    return {
      ruleId: raw.ruleId,
      ruleName: typeof raw.ruleName === 'string' ? raw.ruleName : '',
      priority,
      assign: assign.success ? assign.data : null,
    };
  }

  /** Conversations whose deferred action is due (every workspace; the sweep applies each one in its own workspace's scope). */
  async dueEscalations(tx: Tx, limit: number): Promise<Array<{ orgId: number; uuid: string }>> {
    const res = rowsOf(
      await tx.execute(sql`
        SELECT org_id, uuid FROM conversations
        WHERE escalation_due_at IS NOT NULL AND escalation_due_at <= now()
          AND status = 'open' AND first_response_at IS NULL
        ORDER BY escalation_due_at, id
        LIMIT ${limit}`),
    );
    return res.map((r) => ({ orgId: Number(r.org_id), uuid: r.uuid as string }));
  }

  /** Moves the conversation's row version (the touch trigger) so a client holding the old row sees the change. */
  async touchConversation(tx: Tx, orgId: number, conversationId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE conversations SET updated_at = now() WHERE org_id = ${orgId} AND id = ${conversationId}`,
    );
  }

  /** The conversation's priority column; the touch trigger moves its row version. */
  async setPriority(
    tx: Tx,
    orgId: number,
    conversationId: number,
    priority: string,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE conversations SET priority = ${priority} WHERE org_id = ${orgId} AND id = ${conversationId}`,
    );
  }
}
