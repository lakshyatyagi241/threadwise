import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

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

  async teams(tx: Tx, orgId: number, uuids: readonly string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM teams WHERE org_id = ${orgId} AND uuid IN (${uuidList(uuids)})`);
    return new Map(rowsOf(res).map((r) => [r.uuid as string, Number(r.id)]));
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

  async businessHours(tx: Tx, orgId: number): Promise<{ hours: unknown; timezone: string }> {
    const res = await tx.execute(
      sql`SELECT business_hours, timezone FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    const r = rowsOf(res)[0];
    return { hours: r?.business_hours ?? null, timezone: (r?.timezone as string | null) ?? 'UTC' };
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
   * Of these people, the ones who can take a conversation now: active members who are not marked offline or busy (nobody has set a
   * status until the availability screen exists, and no row counts as available, as Reference's routing did), with the open and
   * pending conversations each holds right now.
   */
  async available(
    tx: Tx,
    orgId: number,
    userIds: readonly number[],
  ): Promise<Array<{ id: number; uuid: string; open: number }>> {
    if (userIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT u.id, u.uuid,
             (SELECT count(*)::int FROM conversations c
               WHERE c.org_id = u.org_id AND c.assignee_user_id = u.id AND NOT c.archived
                 AND c.status IN ('open', 'pending')) AS open
      FROM users u
      LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
      WHERE u.org_id = ${orgId} AND u.status = 'active'
        AND u.id IN (${sql.join(
          userIds.map((i) => sql`${i}`),
          sql`, `,
        )})
        AND COALESCE(s.status, 'online') NOT IN ('offline', 'busy')
      ORDER BY u.id`);
    return rowsOf(res).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      open: Number(r.open),
    }));
  }
}
