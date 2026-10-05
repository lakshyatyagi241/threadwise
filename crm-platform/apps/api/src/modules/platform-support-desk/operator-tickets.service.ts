import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  type AssignTicketRequest,
  type OperatorReplyRequest,
  type OperatorTicketDetail,
  type OperatorTicketListQuery,
  type OperatorTicketListResponse,
  type OperatorTicketRow,
  type SetTicketPriorityRequest,
  type SetTicketStatusRequest,
  type SuppTicketPriority,
  type SuppTicketStatus,
  type TicketAssigneesResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { SlaService } from './sla.service';
import { SupportStore } from './support-store';
import { ASSIGNABLE_ROLE_SQL, TicketActions } from './ticket-actions.service';
import { escapeLike } from './ticket-rules';

interface ListRow {
  id: number;
  uuid: string;
  ticket_number: string;
  subject: string;
  name: string;
  email: string;
  status: SuppTicketStatus;
  priority: SuppTicketPriority;
  created_at: Date;
  created_at_iso: string;
  op_uuid: string | null;
  op_name: string | null;
  op_email: string | null;
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

/**
 * The operator helpdesk (TW-SUPP-007..012, 013). Staff are platform operators (their own identity pool); every
 * statement runs on the SupportStore's privileged door because a ticket's RLS tenant is the customer's organization.
 *
 * Each write locks the ticket row, checks the caller's `rowVersion` (409 when somebody else changed it first), writes
 * the change, an audit row in the TICKET's organization with the operator as actor, and an outbox event, in one
 * transaction.
 */
@Injectable()
export class OperatorTicketsService {
  constructor(
    private readonly store: SupportStore,
    private readonly actions: TicketActions,
    private readonly sla: SlaService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  // --- reads ----------------------------------------------------------------------------------------------------------------------

  async list(query: OperatorTicketListQuery): Promise<OperatorTicketListResponse> {
    const me = this.operatorId();
    const where: SQL[] = [];
    if (query.status) where.push(sql`t.status = ${query.status}`);
    if (query.priority) where.push(sql`t.priority = ${query.priority}`);
    if (query.agent === 'me') where.push(sql`t.assigned_agent_id = ${me}`);
    if (query.agent === 'unassigned') where.push(sql`t.assigned_agent_id IS NULL`);
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(
        sql`(t.subject ILIKE ${like} OR t.name ILIKE ${like} OR t.email ILIKE ${like} OR t.ticket_number ILIKE ${like})`,
      );
    }
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      const bound = sql`${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz`;
      where.push(sql`(t.created_at, t.id) < (${bound}, ${c.id})`);
    }
    const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT t.id, t.uuid, t.ticket_number, t.subject, t.name, t.email, t.status, t.priority, t.created_at,
               to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
               a.uuid AS op_uuid, a.full_name AS op_name, a.email AS op_email
        FROM support_tickets t LEFT JOIN platform_operators a ON a.id = t.assigned_agent_id
        ${whereSql}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${query.limit + 1}
      `);
      const rows = (res.rows as unknown as ListRow[]).map((r) => ({
        ...r,
        createdAt: r.created_at,
        createdAtIso: r.created_at_iso,
      }));
      const { items, page } = buildPage(rows, query.limit);
      const kpi = await tx.execute(sql`
        SELECT count(*) FILTER (WHERE status IN ('open', 'pending', 'in_progress'))::int AS open,
               count(*) FILTER (WHERE assigned_agent_id IS NULL AND status IN ('open', 'pending'))::int AS unassigned,
               count(*) FILTER (WHERE resolved_at > now() - interval '24 hours')::int AS resolved24h,
               count(*)::int AS total
        FROM support_tickets
      `);
      const data: OperatorTicketRow[] = items.map((r) => ({
        id: r.uuid,
        ticketNumber: r.ticket_number,
        subject: r.subject,
        customerName: r.name,
        customerEmail: r.email,
        status: r.status,
        priority: r.priority,
        assignee: r.op_uuid ? { id: r.op_uuid, name: r.op_name!, email: r.op_email! } : null,
        createdAt: new Date(r.created_at).toISOString(),
      }));
      return {
        data,
        page,
        kpis: kpi.rows[0] as unknown as OperatorTicketListResponse['kpis'],
      };
    });
  }

  async assignees(): Promise<TicketAssigneesResponse> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.uuid AS id, o.full_name AS name, o.email::text AS email
        FROM platform_operators o JOIN support_agent_roster r ON r.operator_id = o.id
        WHERE o.status = 'active' AND r.is_active AND o.role IN (${ASSIGNABLE_ROLE_SQL}) ORDER BY o.full_name
      `);
      return { data: res.rows as unknown as TicketAssigneesResponse['data'] };
    });
  }

  async detail(uuid: string): Promise<OperatorTicketDetail> {
    return this.store.tx((tx) => this.detailIn(tx, uuid));
  }

  private async detailIn(tx: Tx, uuid: string): Promise<OperatorTicketDetail> {
    const t = await this.actions.load(tx, uuid, false);
    const org = await tx.execute(
      sql`SELECT uuid, name, slug FROM organizations WHERE id = ${t.org_id}`,
    );
    const op = t.assigned_agent_id
      ? await tx.execute(sql`
          SELECT uuid AS id, full_name AS name, email::text AS email FROM platform_operators WHERE id = ${t.assigned_agent_id}`)
      : null;
    const msgs = await tx.execute(sql`
      SELECT m.uuid, m.author_role, m.body, m.is_internal_note, m.email_status, m.created_at,
             COALESCE(po.full_name, u.full_name) AS author_name
      FROM support_messages m
      LEFT JOIN platform_operators po ON po.id = m.author_operator_id
      LEFT JOIN users u ON u.org_id = m.org_id AND u.id = m.author_user_id
      WHERE m.ticket_id = ${t.id} ORDER BY m.created_at, m.id
    `);
    const o = org.rows[0] as unknown as { uuid: string; name: string; slug: string };
    return {
      id: t.uuid,
      ticketNumber: t.ticket_number,
      subject: t.subject,
      message: t.message,
      reason: t.reason,
      customerName: t.name,
      customerEmail: t.email,
      status: t.status,
      priority: t.priority,
      rowVersion: t.row_version,
      assignee: (op?.rows[0] as TicketAssigneesResponse['data'][number] | undefined) ?? null,
      workspace: { id: o.uuid, name: o.name, slug: o.slug },
      createdAt: iso(t.created_at)!,
      firstResponseAt: iso(t.first_response_at),
      lastReplyAt: iso(t.last_reply_at),
      resolvedAt: iso(t.resolved_at),
      sla: await this.sla.snapshotIn(tx, t),
      messages: (
        msgs.rows as unknown as Array<{
          uuid: string;
          author_role: 'customer' | 'admin' | 'system';
          body: string;
          is_internal_note: boolean;
          email_status: 'sent' | 'failed' | null;
          created_at: Date;
          author_name: string | null;
        }>
      ).map((m) => ({
        id: m.uuid,
        role: m.author_role,
        authorName: m.author_name ?? (m.author_role === 'system' ? 'System' : 'Customer'),
        body: m.body,
        isInternalNote: m.is_internal_note,
        emailStatus: m.email_status,
        createdAt: iso(m.created_at)!,
      })),
    };
  }

  // --- writes ---------------------------------------------------------------------------------------------------------------------

  async setStatus(uuid: string, input: SetTicketStatusRequest): Promise<OperatorTicketDetail> {
    return this.store.tx(async (tx) => {
      const t = await this.actions.lockAt(tx, uuid, input.rowVersion);
      await this.actions.statusIn(tx, t, input.status);
      return this.detailIn(tx, uuid);
    });
  }

  async setPriority(uuid: string, input: SetTicketPriorityRequest): Promise<OperatorTicketDetail> {
    return this.store.tx(async (tx) => {
      const t = await this.actions.lockAt(tx, uuid, input.rowVersion);
      await this.actions.priorityIn(tx, t, input.priority);
      return this.detailIn(tx, uuid);
    });
  }

  async assign(uuid: string, input: AssignTicketRequest): Promise<OperatorTicketDetail> {
    return this.store.tx(async (tx) => {
      const t = await this.actions.lockAt(tx, uuid, input.rowVersion);
      await this.actions.assignIn(tx, t, input.agentId);
      return this.detailIn(tx, uuid);
    });
  }

  /** Stores the reply (or private note) and returns the refreshed ticket; the customer email goes out after commit. */
  async reply(uuid: string, input: OperatorReplyRequest): Promise<OperatorTicketDetail> {
    const operatorId = this.operatorId();
    const saved = await this.store.tx(async (tx) => {
      const t = await this.actions.load(tx, uuid, true);
      const r = await this.actions.replyIn(tx, t, operatorId, input.body, input.isInternalNote);
      return { t, ...r };
    });
    if (!input.isInternalNote) await this.actions.deliverReply(saved.t, saved, input.body);
    return this.store.tx((tx) => this.detailIn(tx, uuid));
  }
}
