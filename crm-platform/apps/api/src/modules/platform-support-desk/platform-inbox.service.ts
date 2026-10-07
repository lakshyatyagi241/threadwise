import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type FlagWorkspaceRequest,
  type ImpersonateRequest,
  type InboxAuditQuery,
  type InboxAuditResponse,
  type InboxBootstrap,
  type InboxConversation,
  type InboxQueueQuery,
  type InboxQueueResponse,
  type PlatformNoteRequest,
  type StartImpersonationResponse,
  type SuspendWorkspaceRequest,
} from '@crm/contracts';
import { WORKSPACE_FLAGS } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, ImpersonationService, OrgSuspensionService } from '../auth';
import { PlatformRbacService } from '../roles-permissions';
import { SupportStore } from './support-store';

type Flag = (typeof WORKSPACE_FLAGS)[number];
/** WaDesk's Workspace::isSuspended: an active frozen, tos_violation or fraud flag blocks the workspace like a suspension. */
export const BLOCKING_FLAGS: readonly Flag[] = ['frozen', 'tos_violation', 'fraud'];

const OPEN = sql`c.status IN ('open', 'pending')`;
const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

interface QueueRow {
  org_id: number;
  id: number;
  uuid: string;
  org_uuid: string;
  org_name: string;
  title: string;
  preview: string | null;
  status: string;
  priority: string;
  channel_uuid: string | null;
  assignee_name: string | null;
  team_name: string | null;
  team_color: string | null;
  last_message_at: Date | null;
  sla_breached: boolean;
  sla_first_response_due: Date | null;
  sla_resolution_due: Date | null;
  sort_iso: string;
  flags: Flag[] | null;
  peer_name?: string | null;
  created_at?: Date;
}

const toItem = (r: QueueRow) => ({
  id: r.uuid,
  workspaceId: r.org_uuid,
  workspaceName: r.org_name,
  title: r.title || 'Untitled',
  preview: r.preview,
  status: r.status,
  priority: r.priority,
  channelId: r.channel_uuid,
  assigneeName: r.assignee_name,
  teamName: r.team_name,
  teamColor: r.team_color,
  lastMessageAt: iso(r.last_message_at),
  slaBreached: r.sla_breached,
  slaFirstDue: iso(r.sla_first_response_due),
  slaResolutionDue: iso(r.sla_resolution_due),
  isSpam: r.status === 'spam',
  flags: r.flags ?? [],
});

const encodeCursor = (r: { sort_iso: string; org_id: number; id: number }) =>
  Buffer.from(`${r.sort_iso}|${r.org_id}|${r.id}`, 'utf8').toString('base64url');
function decodeCursor(raw: string): { at: string; org: number; id: number } {
  const [at, org, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (
    !at ||
    Number.isNaN(Date.parse(at)) ||
    !Number.isInteger(Number(org)) ||
    !Number.isInteger(Number(id))
  ) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid pagination cursor',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { at, org: Number(org), id: Number(id) };
}

const SELECT_ITEM = sql`
  SELECT c.org_id, c.id, c.uuid, o.uuid AS org_uuid, o.name AS org_name, c.title, c.preview, c.status, c.priority,
         ch.uuid AS channel_uuid, u.full_name AS assignee_name, tm.name AS team_name, tm.color AS team_color,
         c.last_message_at, c.sla_breached, c.sla_first_response_due, c.sla_resolution_due,
         to_char(COALESCE(c.last_message_at, c.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_iso,
         c.peer_name, c.created_at,
         (SELECT array_agg(f.flag ORDER BY f.flag) FROM workspace_flags f
            WHERE f.org_id = c.org_id AND f.cleared_at IS NULL) AS flags
  FROM conversations c
  JOIN organizations o ON o.id = c.org_id
  LEFT JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
  LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.assignee_user_id
  LEFT JOIN teams tm ON tm.org_id = c.org_id AND tm.id = c.assignee_team_id`;

/**
 * The platform inbox (WD-SUPP-037..046): a cross-workspace oversight view of workspace conversations for SLA-breach, spam
 * and unassigned triage, with platform-only notes, spam flagging, workspace flags and suspension.
 *
 * Staff never reply here (replies belong to workspace members). Reads and writes cross tenants, so they run on the
 * SupportStore door; every write also records a `platform.inbox.*` security event naming the workspace, in its transaction.
 * Permissions are the 16 platform.* keys, checked by PlatformPermissionGuard on the controller.
 */
@Injectable()
export class PlatformInboxService {
  constructor(
    private readonly store: SupportStore,
    private readonly audit: AuthAuditService,
    private readonly rbac: PlatformRbacService,
  ) {}

  @Inject(OrgSuspensionService) @Optional() private readonly suspension?: OrgSuspensionService;
  @Inject(ImpersonationService) @Optional() private readonly impersonation?: ImpersonationService;

  private actor(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  private event(
    tx: Tx,
    event: string,
    orgId: number | null,
    payload: Record<string, unknown> = {},
  ) {
    return this.audit.record(tx, {
      event: `platform.inbox.${event}`,
      status: 'success',
      orgId,
      payload,
    });
  }

  // --- WD-SUPP-037 ----------------------------------------------------------------------------------------------------------------

  async bootstrap(): Promise<InboxBootstrap> {
    const me = await this.rbac.myPermissions(this.actor());
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.uuid, o.name, o.slug, o.plan, o.status, ws.last_active_at,
          (SELECT count(*) FROM conversations c WHERE c.org_id = o.id AND ${OPEN})::int AS open_count,
          (SELECT count(*) FROM conversations c WHERE c.org_id = o.id AND ${OPEN} AND c.sla_breached)::int AS breach_count,
          COALESCE((SELECT json_agg(json_build_object('id', f.uuid, 'flag', f.flag, 'reason', f.reason) ORDER BY f.id)
             FROM workspace_flags f WHERE f.org_id = o.id AND f.cleared_at IS NULL), '[]'::json) AS flags
        FROM organizations o LEFT JOIN workspace_settings ws ON ws.org_id = o.id
        ORDER BY ws.last_active_at DESC NULLS LAST, o.id DESC LIMIT 200
      `);
      const agg = await tx.execute(sql`
        SELECT (SELECT count(*) FROM organizations WHERE status = 'active')::int AS workspaces,
               count(*) FILTER (WHERE ${OPEN})::int AS open_total,
               count(*) FILTER (WHERE ${OPEN} AND c.sla_breached)::int AS breach_total
        FROM conversations c
      `);
      const a = agg.rows[0] as unknown as {
        workspaces: number;
        open_total: number;
        breach_total: number;
      };
      return {
        permissions: me.permissions,
        workspaces: (
          res.rows as unknown as Array<{
            uuid: string;
            name: string;
            slug: string;
            plan: string;
            status: string;
            last_active_at: Date | null;
            open_count: number;
            breach_count: number;
            flags: InboxBootstrap['workspaces'][number]['flags'];
          }>
        ).map((w) => ({
          id: w.uuid,
          name: w.name,
          slug: w.slug,
          plan: w.plan,
          status: w.status,
          openCount: w.open_count,
          breachCount: w.breach_count,
          lastActiveAt: iso(w.last_active_at),
          flags: w.flags,
        })),
        kpis: { workspaces: a.workspaces, breachTotal: a.breach_total, openTotal: a.open_total },
      };
    });
  }

  // --- WD-SUPP-038 ----------------------------------------------------------------------------------------------------------------

  /**
   * One page of the queue. Tabs: sla_breach (open and breached), unassigned (open, no assignee), spam, all (open). Unlike
   * WaDesk, the spam tab honours the workspace filter and paging is real keyset paging with a true total.
   */
  async queue(q: InboxQueueQuery): Promise<InboxQueueResponse> {
    const where = [
      q.tab === 'spam' ? sql`c.status = 'spam'` : OPEN,
      ...(q.tab === 'sla_breach' ? [sql`c.sla_breached`] : []),
      ...(q.tab === 'unassigned' ? [sql`c.assignee_user_id IS NULL`] : []),
      ...(q.workspaceId ? [sql`o.uuid = ${q.workspaceId}`] : []),
    ];
    const base = sql.join(where, sql` AND `);
    const key = sql`COALESCE(c.last_message_at, c.created_at)`;
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        ${SELECT_ITEM}
        WHERE ${base}
          ${cur ? sql`AND (${key}, c.org_id, c.id) < (${cur.at}::timestamptz, ${cur.org}, ${cur.id})` : sql``}
        ORDER BY ${key} DESC, c.org_id DESC, c.id DESC LIMIT ${q.limit + 1}
      `);
      const rows = res.rows as unknown as QueueRow[];
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      const last = items[items.length - 1];
      const total = await tx.execute(sql`
        SELECT count(*)::int AS n FROM conversations c JOIN organizations o ON o.id = c.org_id WHERE ${base}
      `);
      return {
        data: items.map(toItem),
        page: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore, limit: q.limit },
        total: (total.rows[0] as unknown as { n: number }).n,
      };
    });
  }

  // --- WD-SUPP-039 ----------------------------------------------------------------------------------------------------------------

  private async conversationRef(tx: Tx, uuid: string): Promise<{ org_id: number; id: number }> {
    const r = await tx.execute(sql`SELECT org_id, id FROM conversations WHERE uuid = ${uuid}`);
    const row = r.rows[0] as unknown as { org_id: number; id: number } | undefined;
    if (!row) throw AppError.notFound('Conversation', uuid);
    return row;
  }

  /** The drawer: newest 80 of each list, a narrowed DTO, and an audit row (at most one per operator, conversation and 10 minutes). */
  async conversation(uuid: string): Promise<InboxConversation> {
    const me = this.actor();
    return this.store.tx(async (tx) => {
      const ref = await this.conversationRef(tx, uuid);
      const head = await tx.execute(
        sql`${SELECT_ITEM} WHERE c.org_id = ${ref.org_id} AND c.id = ${ref.id}`,
      );
      const h = head.rows[0] as unknown as QueueRow;
      const msgs = await tx.execute(sql`
        SELECT uuid, direction, kind, body, status, media_mime, created_at FROM (
          SELECT uuid, direction, kind, body, status, media_mime, created_at, seq FROM messages
          WHERE org_id = ${ref.org_id} AND conversation_id = ${ref.id} AND deleted_at IS NULL
          ORDER BY seq DESC LIMIT 80) m ORDER BY seq
      `);
      const notes = await tx.execute(sql`
        SELECT n.uuid, n.body, u.full_name AS author_name, n.created_at FROM conversation_notes n
        LEFT JOIN users u ON u.org_id = n.org_id AND u.id = n.user_id
        WHERE n.org_id = ${ref.org_id} AND n.conversation_id = ${ref.id} ORDER BY n.created_at DESC LIMIT 80
      `);
      const events = await tx.execute(sql`
        SELECT type, actor_type, created_at FROM conversation_events
        WHERE org_id = ${ref.org_id} AND conversation_id = ${ref.id} ORDER BY created_at DESC, id DESC LIMIT 80
      `);
      const pnotes = await tx.execute(sql`
        SELECT p.uuid, p.body, p.severity, po.full_name AS admin_name, p.created_at FROM platform_notes p
        LEFT JOIN platform_operators po ON po.id = p.admin_operator_id
        WHERE p.org_id = ${ref.org_id} AND p.conversation_id = ${ref.id} ORDER BY p.created_at DESC LIMIT 80
      `);
      const seen = await tx.execute(sql`
        SELECT 1 FROM security_events WHERE event = 'platform.inbox.conversation_viewed' AND actor_id = ${me}
          AND payload->>'conversation' = ${uuid} AND at > now() - interval '10 minutes' LIMIT 1
      `);
      if (!seen.rows[0])
        await this.event(tx, 'conversation_viewed', ref.org_id, { conversation: uuid });
      return {
        conversation: {
          ...toItem(h),
          peerName: h.peer_name ?? null,
          createdAt: iso(h.created_at!)!,
        },
        messages: (
          msgs.rows as unknown as Array<{
            uuid: string;
            direction: 'in' | 'out';
            kind: string;
            body: string | null;
            status: string;
            media_mime: string | null;
            created_at: Date;
          }>
        ).map((m) => ({
          id: m.uuid,
          direction: m.direction,
          kind: m.kind,
          body: m.body,
          status: m.status,
          mediaMime: m.media_mime,
          createdAt: iso(m.created_at)!,
        })),
        notes: (
          notes.rows as unknown as Array<{
            uuid: string;
            body: string;
            author_name: string | null;
            created_at: Date;
          }>
        ).map((n) => ({
          id: n.uuid,
          body: n.body,
          authorName: n.author_name,
          createdAt: iso(n.created_at)!,
        })),
        events: (
          events.rows as unknown as Array<{ type: string; actor_type: string; created_at: Date }>
        ).map((e) => ({ type: e.type, actorType: e.actor_type, createdAt: iso(e.created_at)! })),
        platformNotes: (
          pnotes.rows as unknown as Array<{
            uuid: string;
            body: string;
            severity: 'info' | 'warn' | 'critical';
            admin_name: string | null;
            created_at: Date;
          }>
        ).map((n) => ({
          id: n.uuid,
          body: n.body,
          severity: n.severity,
          adminName: n.admin_name,
          createdAt: iso(n.created_at)!,
        })),
      };
    });
  }

  // --- WD-SUPP-040, 041 -----------------------------------------------------------------------------------------------------------

  async addNote(uuid: string, input: PlatformNoteRequest): Promise<{ ok: true; id: string }> {
    const me = this.actor();
    return this.store.tx(async (tx) => {
      const ref = await this.conversationRef(tx, uuid);
      const ins = await tx.execute(sql`
        INSERT INTO platform_notes (org_id, conversation_id, admin_operator_id, body, severity)
        VALUES (${ref.org_id}, ${ref.id}, ${me}, ${input.body}, ${input.severity}) RETURNING uuid
      `);
      await this.event(tx, 'note_added', ref.org_id, {
        conversation: uuid,
        severity: input.severity,
      });
      return { ok: true as const, id: (ins.rows[0] as unknown as { uuid: string }).uuid };
    });
  }

  /**
   * Marks a conversation as spam (event actor type is `system` with `by: platform_admin` in the payload: the chat table's
   * actor_type check has no platform value, and widening another domain's constraint is not this domain's call). The previous status is kept in the event so it can be restored (WaDesk lost it); marking
   * an already-spam conversation changes nothing and adds no second event.
   */
  async flagSpam(uuid: string): Promise<{ ok: true }> {
    return this.store.tx(async (tx) => {
      const ref = await this.conversationRef(tx, uuid);
      const cur = await tx.execute(
        sql`SELECT status FROM conversations WHERE org_id = ${ref.org_id} AND id = ${ref.id} FOR UPDATE`,
      );
      const from = (cur.rows[0] as unknown as { status: string }).status;
      if (from !== 'spam') {
        await tx.execute(
          sql`UPDATE conversations SET status = 'spam' WHERE org_id = ${ref.org_id} AND id = ${ref.id}`,
        );
        await tx.execute(sql`
          INSERT INTO conversation_events (org_id, conversation_id, actor_type, type, payload)
          VALUES (${ref.org_id}, ${ref.id}, 'system', 'spam_flagged', ${JSON.stringify({ from, by: 'platform_admin' })}::jsonb)
        `);
        await this.event(tx, 'spam_flagged', ref.org_id, { conversation: uuid, from });
      }
      return { ok: true as const };
    });
  }

  // --- WD-SUPP-042, 043 -----------------------------------------------------------------------------------------------------------

  private async org(tx: Tx, uuid: string): Promise<{ id: number; status: string }> {
    const r = await tx.execute(
      sql`SELECT id, status FROM organizations WHERE uuid = ${uuid} FOR UPDATE`,
    );
    const row = r.rows[0] as unknown as { id: number; status: string } | undefined;
    if (!row) throw AppError.notFound('Workspace', uuid);
    return row;
  }

  /** A workspace is suspended exactly while an active frozen, tos_violation or fraud flag exists. */
  private async syncStatus(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE organizations o SET status = CASE WHEN EXISTS (
          SELECT 1 FROM workspace_flags f WHERE f.org_id = o.id AND f.cleared_at IS NULL
            AND f.flag IN ('frozen', 'tos_violation', 'fraud')) THEN 'suspended' ELSE 'active' END
      WHERE o.id = ${orgId} AND o.status IN ('active', 'suspended')
    `);
    await this.suspension?.invalidate(orgId); // enforcement caches the status for a few seconds (ADR-0019)
  }

  private async setFlag(
    tx: Tx,
    orgId: number,
    flag: Flag,
    reason: string | undefined,
  ): Promise<string> {
    const ins = await tx.execute(sql`
      INSERT INTO workspace_flags (org_id, flag, reason, flagged_by_operator_id)
      VALUES (${orgId}, ${flag}, ${reason ?? null}, ${this.actor()})
      ON CONFLICT (org_id, flag) WHERE cleared_at IS NULL DO NOTHING RETURNING uuid
    `);
    if (ins.rows[0]) return (ins.rows[0] as unknown as { uuid: string }).uuid;
    const ex = await tx.execute(
      sql`SELECT uuid FROM workspace_flags WHERE org_id = ${orgId} AND flag = ${flag} AND cleared_at IS NULL`,
    );
    return (ex.rows[0] as unknown as { uuid: string }).uuid;
  }

  async flagWorkspace(
    orgUuid: string,
    input: FlagWorkspaceRequest,
  ): Promise<{ ok: true; id: string }> {
    return this.store.tx(async (tx) => {
      const org = await this.org(tx, orgUuid);
      const id = await this.setFlag(tx, org.id, input.flag, input.reason);
      await this.syncStatus(tx, org.id);
      await this.event(tx, 'workspace_flagged', org.id, {
        flag: input.flag,
        reason: input.reason ?? null,
      });
      return { ok: true as const, id };
    });
  }

  async clearFlag(flagUuid: string): Promise<{ ok: true }> {
    const me = this.actor();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE workspace_flags SET cleared_at = now(), cleared_by_operator_id = ${me}
        WHERE uuid = ${flagUuid} AND cleared_at IS NULL RETURNING org_id, flag
      `);
      let row = res.rows[0] as unknown as { org_id: number; flag: string } | undefined;
      if (!row) {
        // Already cleared is fine (idempotent); a flag that never existed is a 404.
        const ex = await tx.execute(
          sql`SELECT org_id, flag FROM workspace_flags WHERE uuid = ${flagUuid}`,
        );
        row = ex.rows[0] as unknown as { org_id: number; flag: string } | undefined;
        if (!row) throw AppError.notFound('Flag', flagUuid);
        return { ok: true as const };
      }
      await this.syncStatus(tx, row.org_id);
      await this.event(tx, 'workspace_unflagged', row.org_id, { flag: row.flag });
      return { ok: true as const };
    });
  }

  async suspend(orgUuid: string, input: SuspendWorkspaceRequest): Promise<{ ok: true }> {
    return this.store.tx(async (tx) => {
      const org = await this.org(tx, orgUuid);
      await this.setFlag(tx, org.id, 'frozen', input.reason);
      await this.syncStatus(tx, org.id);
      await this.event(tx, 'workspace_suspended', org.id, { reason: input.reason ?? null });
      return { ok: true as const };
    });
  }

  /** Clears the frozen flags only: a fraud or tos_violation flag keeps the workspace blocked until it is cleared too. */
  async unsuspend(orgUuid: string): Promise<{ ok: true }> {
    const me = this.actor();
    return this.store.tx(async (tx) => {
      const org = await this.org(tx, orgUuid);
      await tx.execute(sql`
        UPDATE workspace_flags SET cleared_at = now(), cleared_by_operator_id = ${me}
        WHERE org_id = ${org.id} AND flag = 'frozen' AND cleared_at IS NULL
      `);
      await this.syncStatus(tx, org.id);
      await this.event(tx, 'workspace_unsuspended', org.id);
      return { ok: true as const };
    });
  }

  // --- WD-SUPP-044 ----------------------------------------------------------------------------------------------------------------

  async auditFeed(q: InboxAuditQuery): Promise<InboxAuditResponse> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT e.id, e.event, e.at, o.uuid AS org_uuid, o.name AS org_name, po.full_name AS actor_name
        FROM security_events e
        LEFT JOIN organizations o ON o.id = e.subject_org_id
        LEFT JOIN platform_operators po ON e.actor_type = 'platform_operator' AND po.id = e.actor_id
        WHERE (e.event LIKE 'platform.inbox.%' OR e.event LIKE 'platform.support.%')
          ${q.workspaceId ? sql`AND o.uuid = ${q.workspaceId}` : sql``}
        ORDER BY e.at DESC, e.id DESC LIMIT ${q.limit}
      `);
      return {
        data: (
          res.rows as unknown as Array<{
            id: string | number;
            event: string;
            at: Date;
            org_uuid: string | null;
            org_name: string | null;
            actor_name: string | null;
          }>
        ).map((r) => ({
          id: String(r.id),
          action: r.event.replace(/^platform\./, ''),
          workspaceId: r.org_uuid,
          workspaceName: r.org_name,
          actorName: r.actor_name,
          at: iso(r.at)!,
        })),
      };
    });
  }

  // --- WD-SUPP-045 ----------------------------------------------------------------------------------------------------------------

  /**
   * The launcher's endpoint (WD-SUPP-045): the same act-as session as the Workspaces hub's "Login as owner" (WD-WSP-032), started
   * by the auth domain's ImpersonationService. The answer is the handoff URL the launcher opens.
   */
  async impersonate(
    orgUuid: string,
    input: ImpersonateRequest,
  ): Promise<StartImpersonationResponse> {
    if (!this.impersonation) {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        'Impersonation is not available.',
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    return this.impersonation.start(orgUuid, { reason: input.reason, readOnly: false });
  }
}
