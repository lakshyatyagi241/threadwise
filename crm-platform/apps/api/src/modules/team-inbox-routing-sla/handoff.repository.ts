import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  HandoffCard,
  HandoffTraceLine,
  OwnerMode,
  QueueUnclaimedAction,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const rowsOf = (res: unknown): Raw[] => (res as { rows: Raw[] }).rows;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The workspace's handoff settings as stored (`workspace_settings.handoff_*`, plus the older keep-contact-agent switch). */
/** The waiting queue's timers as stored: the overflow team by internal id, with its uuid for the wire. */
export interface StoredQueueTimers {
  remindMinutes: number | null;
  overflowMinutes: number | null;
  overflowTeamId: number | null;
  overflowTeamUuid: string | null;
  unclaimedMinutes: number | null;
  unclaimedAction: QueueUnclaimedAction;
  unclaimedMessage: string;
}

export interface StoredHandoffSettings {
  queueTimers: StoredQueueTimers;
  autoAssign: boolean;
  claimSetsOwner: boolean;
  ownerMode: OwnerMode;
  continuityDays: number | null;
  promptOwnerOnReassign: boolean;
  notifyQueue: boolean;
  keepContactAgent: boolean;
}

export interface TeamFacts {
  id: number;
  uuid: string;
  name: string;
  strategy: string;
  hours: unknown;
  timezone: string | null;
  defaultAssigneeId: number | null;
  cursor: number | null;
  receives: boolean;
}

export interface HandoffRow {
  id: number;
  uuid: string;
  conversationId: number;
  status: string;
  outcome: string;
  source: string;
  idempotencyKey: string | null;
}

export interface NewHandoff {
  conversationId: number;
  source: string;
  reason: string;
  reasonText: string | null;
  summary: string | null;
  answers: Record<string, string>;
  destinationKind: string;
  destinationTeamId: number | null;
  destinationUserId: number | null;
  priority: string | null;
  idempotencyKey: string | null;
  flowRunId: number | null;
  nodeId: string | null;
  requestedBy: number | null;
}

/** Data access of the handoff model (BL-396): the card and run log, the settings, and the few reads the picking needs. */
@Injectable()
export class HandoffRepository {
  // --- settings --------------------------------------------------------------------------------------------------------------

  async settings(tx: Tx, orgId: number): Promise<StoredHandoffSettings> {
    const res = await tx.execute(sql`
      SELECT s.handoff_auto_assign, s.handoff_claim_sets_owner, s.handoff_owner_mode, s.handoff_continuity_days,
             s.handoff_prompt_owner_on_reassign, s.handoff_notify_queue, s.routing_keep_contact_agent,
             s.handoff_wq_remind_minutes, s.handoff_wq_overflow_minutes, s.handoff_wq_overflow_team_id, ot.uuid AS wq_overflow_team_uuid,
             s.handoff_wq_unclaimed_minutes, s.handoff_wq_unclaimed_action, s.handoff_wq_unclaimed_message
      FROM workspace_settings s
      LEFT JOIN teams ot ON ot.org_id = s.org_id AND ot.id = s.handoff_wq_overflow_team_id
      WHERE s.org_id = ${orgId}`);
    const r = rowsOf(res)[0];
    return {
      queueTimers: {
        remindMinutes: num(r?.handoff_wq_remind_minutes),
        overflowMinutes: num(r?.handoff_wq_overflow_minutes),
        overflowTeamId: num(r?.handoff_wq_overflow_team_id),
        overflowTeamUuid: str(r?.wq_overflow_team_uuid),
        unclaimedMinutes: num(r?.handoff_wq_unclaimed_minutes),
        unclaimedAction: ((r?.handoff_wq_unclaimed_action as QueueUnclaimedAction | undefined) ??
          'keep') as QueueUnclaimedAction,
        unclaimedMessage: str(r?.handoff_wq_unclaimed_message) ?? '',
      },
      autoAssign: r ? r.handoff_auto_assign === true : true,
      claimSetsOwner: r ? r.handoff_claim_sets_owner === true : false,
      ownerMode: ((r?.handoff_owner_mode as OwnerMode | undefined) ?? 'independent') as OwnerMode,
      continuityDays: num(r?.handoff_continuity_days),
      promptOwnerOnReassign: r ? r.handoff_prompt_owner_on_reassign === true : false,
      notifyQueue: r ? r.handoff_notify_queue === true : true,
      keepContactAgent: r ? r.routing_keep_contact_agent === true : false,
    };
  }

  /** A workspace has no settings row until something writes one: upsert, every other column has a default. */
  async updateSettings(
    tx: Tx,
    orgId: number,
    v: Partial<Omit<StoredHandoffSettings, 'keepContactAgent' | 'queueTimers'>> & {
      queueTimers?: Partial<Omit<StoredQueueTimers, 'overflowTeamUuid'>>;
    },
  ): Promise<void> {
    const q = v.queueTimers ?? {};
    await tx.execute(
      sql`INSERT INTO workspace_settings (org_id) VALUES (${orgId}) ON CONFLICT (org_id) DO NOTHING`,
    );
    const sets = [
      v.autoAssign !== undefined ? sql`handoff_auto_assign = ${v.autoAssign}` : null,
      v.claimSetsOwner !== undefined ? sql`handoff_claim_sets_owner = ${v.claimSetsOwner}` : null,
      v.ownerMode !== undefined ? sql`handoff_owner_mode = ${v.ownerMode}` : null,
      v.continuityDays !== undefined ? sql`handoff_continuity_days = ${v.continuityDays}` : null,
      v.promptOwnerOnReassign !== undefined
        ? sql`handoff_prompt_owner_on_reassign = ${v.promptOwnerOnReassign}`
        : null,
      v.notifyQueue !== undefined ? sql`handoff_notify_queue = ${v.notifyQueue}` : null,
      q.remindMinutes !== undefined ? sql`handoff_wq_remind_minutes = ${q.remindMinutes}` : null,
      q.overflowMinutes !== undefined
        ? sql`handoff_wq_overflow_minutes = ${q.overflowMinutes}`
        : null,
      q.overflowTeamId !== undefined ? sql`handoff_wq_overflow_team_id = ${q.overflowTeamId}` : null,
      q.unclaimedMinutes !== undefined
        ? sql`handoff_wq_unclaimed_minutes = ${q.unclaimedMinutes}`
        : null,
      q.unclaimedAction !== undefined
        ? sql`handoff_wq_unclaimed_action = ${q.unclaimedAction}`
        : null,
      q.unclaimedMessage !== undefined
        ? sql`handoff_wq_unclaimed_message = ${q.unclaimedMessage === '' ? null : q.unclaimedMessage}`
        : null,
    ].filter((x): x is ReturnType<typeof sql> => x !== null);
    if (sets.length === 0) return;
    await tx.execute(
      sql`UPDATE workspace_settings SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId}`,
    );
  }

  // --- teams -----------------------------------------------------------------------------------------------------------------

  async teamByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<TeamFacts | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, assignment_strategy, business_hours, timezone, default_assignee_id, assignment_cursor, receives_conversations
      FROM teams WHERE org_id = ${orgId} AND uuid = ${uuid}
      ${lock ? sql`FOR UPDATE` : sql``}`);
    const r = rowsOf(res)[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      name: String(r.name),
      strategy: String(r.assignment_strategy ?? 'manual'),
      hours: r.business_hours ?? null,
      timezone: str(r.timezone),
      defaultAssigneeId: num(r.default_assignee_id),
      cursor: num(r.assignment_cursor),
      receives: r.receives_conversations !== false,
    };
  }

  async teamById(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ uuid: string; name: string } | null> {
    const res = await tx.execute(
      sql`SELECT uuid, name FROM teams WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = rowsOf(res)[0];
    return r ? { uuid: String(r.uuid), name: String(r.name) } : null;
  }

  async setTeamCursor(tx: Tx, orgId: number, teamId: number, userId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE teams SET assignment_cursor = ${userId} WHERE org_id = ${orgId} AND id = ${teamId}`,
    );
  }

  async memberIdsOfTeams(tx: Tx, orgId: number, teamIds: readonly number[]): Promise<number[]> {
    if (teamIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT DISTINCT tm.user_id FROM team_members tm JOIN users u ON u.org_id = tm.org_id AND u.id = tm.user_id AND u.status = 'active'
      WHERE tm.org_id = ${orgId} AND tm.team_id IN (${sql.join(
        teamIds.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    return rowsOf(res).map((r) => Number(r.user_id));
  }

  async isMemberOfTeam(tx: Tx, orgId: number, teamId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 AS ok FROM team_members WHERE org_id = ${orgId} AND team_id = ${teamId} AND user_id = ${userId}`,
    );
    return rowsOf(res).length > 0;
  }

  /** Open conversations and the chat limit of these people (the capacity that already exists on the profile). */
  async capacity(
    tx: Tx,
    orgId: number,
    userIds: readonly number[],
  ): Promise<Map<number, { open: number; limit: number | null }>> {
    if (userIds.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT u.id, p.chat_limit,
             (SELECT count(*)::int FROM conversations c
               WHERE c.org_id = u.org_id AND c.assignee_user_id = u.id AND NOT c.archived AND c.status = 'open') AS open
      FROM users u LEFT JOIN user_profiles p ON p.org_id = u.org_id AND p.user_id = u.id
      WHERE u.org_id = ${orgId} AND u.id IN (${sql.join(
        userIds.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    return new Map(
      rowsOf(res).map((r) => [Number(r.id), { open: Number(r.open), limit: num(r.chat_limit) }]),
    );
  }

  // --- contact owner ---------------------------------------------------------------------------------------------------------

  /** The contact's owner and whether anybody ever decided it (`owner_changed_at`): the guard shared with the record assignment engine. */
  async contactOwnerHead(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{ ownerId: number | null; decided: boolean } | null> {
    const res = await tx.execute(
      sql`SELECT owner_id, owner_changed_at FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    const r = rowsOf(res)[0];
    return r ? { ownerId: num(r.owner_id), decided: r.owner_changed_at !== null } : null;
  }

  /**
   * First-touch owner: writes the owner only where nobody ever decided it, with the SAME guard the record assignment engine uses
   * (`owner_id IS NULL AND owner_changed_at IS NULL`). Under the row lock exactly one of the two wins; the loser matches no row. The
   * database trigger stamps `owner_changed_at`, so afterwards the engine reads this as a person's decision and never moves it.
   */
  async setOwnerIfUndecided(
    tx: Tx,
    orgId: number,
    contactId: number,
    userId: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE contacts SET owner_id = ${userId}
      WHERE org_id = ${orgId} AND id = ${contactId} AND owner_id IS NULL AND owner_changed_at IS NULL
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The person who held the contact's latest other conversation, optionally only if that conversation was active in the last N days. */
  async lastHandlerWithin(
    tx: Tx,
    orgId: number,
    contactId: number,
    exceptConversationId: number,
    days: number | null,
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      SELECT assignee_user_id FROM conversations
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND id <> ${exceptConversationId}
        AND assignee_user_id IS NOT NULL
        ${days === null ? sql`` : sql`AND COALESCE(last_message_at, created_at) >= now() - (${days} * interval '1 day')`}
      ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC LIMIT 1`);
    return num(rowsOf(res)[0]?.assignee_user_id);
  }

  /** The contact's open conversations that an automatic source assigned (or nobody did): what the owner sync may move. */
  async syncableConversations(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<Array<{ uuid: string; assigneeUserId: number | null }>> {
    const res = await tx.execute(sql`
      SELECT uuid, assignee_user_id FROM conversations
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND NOT archived AND status = 'open'
        AND (assignee_user_id IS NULL OR assigned_source IN ('rule', 'owner', 'sticky', 'sync', 'system'))
      ORDER BY id`);
    return rowsOf(res).map((r) => ({
      uuid: String(r.uuid),
      assigneeUserId: num(r.assignee_user_id),
    }));
  }

  // --- the card and the run log ----------------------------------------------------------------------------------------------

  async byIdempotencyKey(tx: Tx, orgId: number, key: string): Promise<HandoffRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, conversation_id, status, outcome, source, idempotency_key
      FROM conversation_handoffs WHERE org_id = ${orgId} AND idempotency_key = ${key}`);
    return this.head(rowsOf(res)[0]);
  }

  async liveFor(tx: Tx, orgId: number, conversationId: number): Promise<HandoffRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, conversation_id, status, outcome, source, idempotency_key
      FROM conversation_handoffs
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND status IN ('waiting', 'assigned')`);
    return this.head(rowsOf(res)[0]);
  }

  private head(r: Raw | undefined): HandoffRow | null {
    return r
      ? {
          id: Number(r.id),
          uuid: String(r.uuid),
          conversationId: Number(r.conversation_id),
          status: String(r.status),
          outcome: String(r.outcome),
          source: String(r.source),
          idempotencyKey: str(r.idempotency_key),
        }
      : null;
  }

  async insert(tx: Tx, orgId: number, h: NewHandoff): Promise<HandoffRow> {
    const res = await tx.execute(sql`
      INSERT INTO conversation_handoffs
        (org_id, conversation_id, source, reason, reason_text, summary, answers, destination_kind, destination_team_id,
         destination_user_id, priority, idempotency_key, flow_run_id, node_id, requested_by)
      VALUES (${orgId}, ${h.conversationId}, ${h.source}, ${h.reason}, ${h.reasonText}, ${h.summary},
              ${JSON.stringify(h.answers)}::jsonb, ${h.destinationKind}, ${h.destinationTeamId}, ${h.destinationUserId},
              ${h.priority}, ${h.idempotencyKey}, ${h.flowRunId}, ${h.nodeId}, ${h.requestedBy})
      RETURNING id, uuid, conversation_id, status, outcome, source, idempotency_key`);
    return this.head(rowsOf(res)[0])!;
  }

  /** Re-requested while still waiting: the same card gets the new destination and a longer trace. */
  async retarget(tx: Tx, orgId: number, id: number, h: Partial<NewHandoff>): Promise<void> {
    await tx.execute(sql`
      UPDATE conversation_handoffs SET
        reason = COALESCE(${h.reason ?? null}, reason),
        reason_text = COALESCE(${h.reasonText ?? null}, reason_text),
        summary = COALESCE(${h.summary ?? null}, summary),
        destination_kind = COALESCE(${h.destinationKind ?? null}, destination_kind),
        destination_team_id = ${h.destinationTeamId ?? null},
        destination_user_id = ${h.destinationUserId ?? null}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: 'waiting' | 'assigned';
      outcome: 'assigned' | 'waiting' | 'unavailable';
      assignedUserId: number | null;
      assignedTeamId: number | null;
      trace: HandoffTraceLine[];
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE conversation_handoffs SET status = ${v.status}, outcome = ${v.outcome},
        assigned_user_id = ${v.assignedUserId}, assigned_team_id = ${v.assignedTeamId},
        trace = trace || ${JSON.stringify(v.trace)}::jsonb,
        completed_at = ${v.status === 'assigned' ? sql`now()` : null}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async appendTrace(tx: Tx, orgId: number, id: number, lines: HandoffTraceLine[]): Promise<void> {
    await tx.execute(sql`
      UPDATE conversation_handoffs SET trace = trace || ${JSON.stringify(lines)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async markReturned(tx: Tx, orgId: number, conversationId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE conversation_handoffs SET status = 'returned', completed_at = now()
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND status IN ('waiting', 'assigned')`);
  }

  /**
   * The live handoff's link to the flow that made it, for Return to bot: the flow run and the Human handoff node. Null when the thread
   * has no live handoff; `flowRunId`/`nodeId` are null for a handoff no flow made (a person's "send to queue", the AI marker, a keyword).
   */
  async liveFlowRef(
    tx: Tx,
    orgId: number,
    conversationId: number,
  ): Promise<{ uuid: string; flowRunId: number | null; nodeId: string | null } | null> {
    const res = await tx.execute(sql`
      SELECT uuid, flow_run_id, node_id FROM conversation_handoffs
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND status IN ('waiting', 'assigned')`);
    const r = rowsOf(res)[0];
    return r
      ? { uuid: String(r.uuid), flowRunId: num(r.flow_run_id), nodeId: str(r.node_id) }
      : null;
  }

  /** The flow a run belonged to, as Return to bot needs it. `run: false` = the run row is gone (retention); `flow: null` = the flow is gone. */
  async flowOfRun(
    tx: Tx,
    orgId: number,
    runId: number,
  ): Promise<{
    run: boolean;
    flow: { id: number; uuid: string; live: boolean; data: unknown } | null;
  }> {
    const run = await tx.execute(
      sql`SELECT flow_id FROM flow_runs WHERE org_id = ${orgId} AND id = ${runId}`,
    );
    const r = rowsOf(run)[0];
    if (!r) return { run: false, flow: null };
    const res = await tx.execute(sql`
      SELECT id, uuid, is_active, is_published, flow_data FROM flows
      WHERE org_id = ${orgId} AND id = ${Number(r.flow_id)}`);
    const f = rowsOf(res)[0];
    return {
      run: true,
      flow: f
        ? {
            id: Number(f.id),
            uuid: String(f.uuid),
            live: f.is_active === true && f.is_published === true,
            data: f.flow_data,
          }
        : null,
    };
  }

  /** The (channel, customer) a conversation is: what the conversation core needs to write a line into its thread. */
  async threadKey(
    tx: Tx,
    orgId: number,
    conversationId: number,
  ): Promise<{ channelUuid: string; peerKey: string } | null> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.peer_key FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${conversationId}`);
    const r = rowsOf(res)[0];
    return r ? { channelUuid: String(r.channel_uuid), peerKey: String(r.peer_key) } : null;
  }

  /** Whether a flow run is still alive for this customer on this channel (it would answer their next message). */
  async hasLiveRun(tx: Tx, orgId: number, conversationId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM flow_runs r JOIN conversations c ON c.org_id = r.org_id AND c.channel_id = r.channel_id AND c.peer_key = r.peer_key
      WHERE r.org_id = ${orgId} AND c.id = ${conversationId} AND r.status IN ('running', 'waiting', 'sleeping', 'halted') LIMIT 1`);
    return rowsOf(res).length > 0;
  }

  /** Sets the handling columns without an assignment change (a repeat that changes nothing else). */
  async setHandling(
    tx: Tx,
    orgId: number,
    conversationId: number,
    handling: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET handling = ${handling},
        handling_since = CASE WHEN handling IS DISTINCT FROM ${handling} THEN ${handling === null ? null : sql`now()`} ELSE handling_since END
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
  }

  /** The newest handoff of a thread, live first, as the card the agent reads. Null when the thread never had one. */
  async cardFor(tx: Tx, orgId: number, conversationId: number): Promise<HandoffCard | null> {
    const res = await tx.execute(sql`
      SELECT h.uuid, cv.uuid AS conversation_uuid, h.source, h.reason, h.reason_text, h.summary, h.answers, h.destination_kind,
             dt.uuid AS dt_uuid, dt.name AS dt_name, du.uuid AS du_uuid, du.full_name AS du_name,
             h.priority, h.status, h.outcome, au.uuid AS au_uuid, au.full_name AS au_name, at.uuid AS at_uuid, at.name AS at_name,
             h.trace, h.created_at, h.completed_at, h.reminded_at, h.offered_at, h.final_at, h.final_action,
             ot.uuid AS ot_uuid, ot.name AS ot_name
      FROM conversation_handoffs h
      JOIN conversations cv ON cv.org_id = h.org_id AND cv.id = h.conversation_id
      LEFT JOIN teams dt ON dt.org_id = h.org_id AND dt.id = h.destination_team_id
      LEFT JOIN users du ON du.org_id = h.org_id AND du.id = h.destination_user_id
      LEFT JOIN users au ON au.org_id = h.org_id AND au.id = h.assigned_user_id
      LEFT JOIN teams at ON at.org_id = h.org_id AND at.id = h.assigned_team_id
      LEFT JOIN teams ot ON ot.org_id = h.org_id AND ot.id = h.offered_from_team_id
      WHERE h.org_id = ${orgId} AND h.conversation_id = ${conversationId}
      ORDER BY (h.status IN ('waiting', 'assigned')) DESC, h.created_at DESC, h.id DESC LIMIT 1`);
    const r = rowsOf(res)[0];
    if (!r) return null;
    const iso = (v: unknown): string => new Date(v as string | Date).toISOString();
    return {
      id: String(r.uuid),
      conversationId: String(r.conversation_uuid),
      source: r.source as HandoffCard['source'],
      reason: r.reason as HandoffCard['reason'],
      reasonText: str(r.reason_text),
      summary: str(r.summary),
      answers: (r.answers as Record<string, string> | null) ?? {},
      destination: {
        kind: r.destination_kind as 'person' | 'team' | 'rules',
        user: r.du_uuid ? { id: String(r.du_uuid), name: str(r.du_name) } : null,
        team: r.dt_uuid ? { id: String(r.dt_uuid), name: String(r.dt_name) } : null,
      },
      priority: (str(r.priority) as HandoffCard['priority']) ?? null,
      status: r.status as HandoffCard['status'],
      outcome: r.outcome as HandoffCard['outcome'],
      assignedTo: {
        user: r.au_uuid ? { id: String(r.au_uuid), name: str(r.au_name) } : null,
        team: r.at_uuid ? { id: String(r.at_uuid), name: String(r.at_name) } : null,
      },
      trace: (r.trace as HandoffTraceLine[] | null) ?? [],
      timers: {
        remindedAt: r.reminded_at ? iso(r.reminded_at) : null,
        offeredAt: r.offered_at ? iso(r.offered_at) : null,
        offeredFrom: r.ot_uuid ? { id: String(r.ot_uuid), name: String(r.ot_name) } : null,
        finalAt: r.final_at ? iso(r.final_at) : null,
        finalAction: (str(r.final_action) as 'message' | 'bot' | null) ?? null,
      },
      createdAt: iso(r.created_at),
      completedAt: r.completed_at ? iso(r.completed_at) : null,
    };
  }

  /** What the rules and the sticky stage read of the conversation. */
  async facts(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{
    contactId: number | null;
    language: string | null;
    archived: boolean;
    channelKind: string;
    status: string;
  } | null> {
    const res = await tx.execute(sql`
      SELECT c.contact_id, c.customer_language, c.archived, c.status, ch.kind AS channel_kind
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${id}`);
    const r = rowsOf(res)[0];
    return r
      ? {
          contactId: num(r.contact_id),
          language: str(r.customer_language),
          archived: r.archived === true,
          channelKind: String(r.channel_kind),
          status: String(r.status),
        }
      : null;
  }

  async activeUserUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; uuid: string; name: string | null } | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid} AND status = 'active'`,
    );
    const r = rowsOf(res)[0];
    return r ? { id: Number(r.id), uuid: String(r.uuid), name: str(r.full_name) } : null;
  }

  async userBrief(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ uuid: string; name: string | null } | null> {
    const res = await tx.execute(
      sql`SELECT uuid, full_name FROM users WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = rowsOf(res)[0];
    return r ? { uuid: String(r.uuid), name: str(r.full_name) } : null;
  }
}
