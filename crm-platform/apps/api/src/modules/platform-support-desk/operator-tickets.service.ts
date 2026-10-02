import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type AssignTicketRequest,
  type OperatorReplyRequest,
  type OperatorTicketDetail,
  type OperatorTicketListQuery,
  type OperatorTicketListResponse,
  type OperatorTicketRow,
  type SetTicketPriorityRequest,
  type SetTicketStatusRequest,
  type SuppTicketPriority,
  type SuppTicketReason,
  type SuppTicketStatus,
  type TicketAssigneesResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { HttpStatus } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SupportMailer } from './support-mailer.service';
import { SupportStore } from './support-store';
import { escapeLike, resolvedAtAfterStatus, staffReplyEffect } from './ticket-rules';

const MODULE_KEY = 'support_tickets';
// A literal list, not a bound array: drizzle expands an array parameter into a row, which `= ANY` cannot take.
const ASSIGNABLE_ROLE_SQL = sql`'super_admin', 'support'`;

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

interface TicketRow {
  org_id: number;
  id: number;
  uuid: string;
  ticket_number: string;
  subject: string;
  message: string;
  reason: SuppTicketReason;
  name: string;
  email: string;
  status: SuppTicketStatus;
  priority: SuppTicketPriority;
  assigned_agent_id: number | null;
  row_version: number;
  created_at: Date;
  first_response_at: Date | null;
  last_reply_at: Date | null;
  resolved_at: Date | null;
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
    private readonly outbox: OutboxService,
    private readonly mailer: SupportMailer,
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
        SELECT uuid AS id, full_name AS name, email::text AS email FROM platform_operators
        WHERE status = 'active' AND role IN (${ASSIGNABLE_ROLE_SQL}) ORDER BY full_name
      `);
      return { data: res.rows as unknown as TicketAssigneesResponse['data'] };
    });
  }

  async detail(uuid: string): Promise<OperatorTicketDetail> {
    return this.store.tx((tx) => this.detailIn(tx, uuid));
  }

  private async detailIn(tx: Tx, uuid: string): Promise<OperatorTicketDetail> {
    const t = await this.load(tx, uuid, false);
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

  private async load(tx: Tx, uuid: string, forUpdate: boolean): Promise<TicketRow> {
    const res = await tx.execute(sql`
      SELECT org_id, id, uuid, ticket_number, subject, message, reason, name, email, status, priority,
             assigned_agent_id, row_version, created_at, first_response_at, last_reply_at, resolved_at
      FROM support_tickets WHERE uuid = ${uuid} LIMIT 1 ${forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    const row = res.rows[0] as unknown as TicketRow | undefined;
    if (!row) throw AppError.notFound('Ticket', uuid);
    return row;
  }

  // --- writes ---------------------------------------------------------------------------------------------------------------------

  /** Audit row in the ticket's own organization, actor = the operator (AuditService is bound to the request's tenant). */
  private async audit(
    tx: Tx,
    t: TicketRow,
    action: 'insert' | 'update',
    delta?: Record<string, { old: unknown; new: unknown }>,
  ) {
    const ctx = RequestContextStore.require();
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${t.org_id}, ${ctx.actorId}, 'platform_operator', ${MODULE_KEY}, ${t.id}, ${action},
              ${delta ? JSON.stringify(delta) : null}::jsonb, ${ctx.requestId})
    `);
  }

  private emit(tx: Tx, t: TicketRow, eventType: string, payload: Record<string, unknown>) {
    return this.outbox.emit(tx, {
      orgId: t.org_id,
      aggregateModule: MODULE_KEY,
      aggregateId: t.id,
      eventType,
      payload: { ticketId: t.uuid, ticketNumber: t.ticket_number, ...payload },
    });
  }

  /** Locks the ticket and refuses a stale `rowVersion`. */
  private async lockAt(tx: Tx, uuid: string, rowVersion: number): Promise<TicketRow> {
    const t = await this.load(tx, uuid, true);
    if (t.row_version !== rowVersion) throw AppError.rowVersionConflict('Ticket');
    return t;
  }

  async setStatus(uuid: string, input: SetTicketStatusRequest): Promise<OperatorTicketDetail> {
    return this.store.tx(async (tx) => {
      const t = await this.lockAt(tx, uuid, input.rowVersion);
      const resolvedAt = resolvedAtAfterStatus(
        input.status,
        t.resolved_at ? new Date(t.resolved_at) : null,
        new Date(),
      );
      await tx.execute(sql`
        UPDATE support_tickets SET status = ${input.status}, resolved_at = ${resolvedAt}
        WHERE org_id = ${t.org_id} AND id = ${t.id}
      `);
      await this.audit(tx, t, 'update', { status: { old: t.status, new: input.status } });
      await this.emit(tx, t, 'support.ticket.status_changed', { from: t.status, to: input.status });
      return this.detailIn(tx, uuid);
    });
  }

  async setPriority(uuid: string, input: SetTicketPriorityRequest): Promise<OperatorTicketDetail> {
    return this.store.tx(async (tx) => {
      const t = await this.lockAt(tx, uuid, input.rowVersion);
      await tx.execute(sql`
        UPDATE support_tickets SET priority = ${input.priority} WHERE org_id = ${t.org_id} AND id = ${t.id}
      `);
      await this.audit(tx, t, 'update', { priority: { old: t.priority, new: input.priority } });
      await this.emit(tx, t, 'support.ticket.priority_changed', {
        from: t.priority,
        to: input.priority,
      });
      return this.detailIn(tx, uuid);
    });
  }

  async assign(uuid: string, input: AssignTicketRequest): Promise<OperatorTicketDetail> {
    return this.store.tx(async (tx) => {
      const t = await this.lockAt(tx, uuid, input.rowVersion);
      let agentId: number | null = null;
      if (input.agentId) {
        // DEVIATION from Reference (any existing user id was accepted): only an active operator who can work tickets.
        const res = await tx.execute(sql`
          SELECT id FROM platform_operators
          WHERE uuid = ${input.agentId} AND status = 'active' AND role IN (${ASSIGNABLE_ROLE_SQL})
        `);
        const row = res.rows[0] as unknown as { id: number } | undefined;
        if (!row) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            'That operator cannot be assigned tickets.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        agentId = row.id;
      }
      await tx.execute(sql`
        UPDATE support_tickets SET assigned_agent_id = ${agentId} WHERE org_id = ${t.org_id} AND id = ${t.id}
      `);
      await this.audit(tx, t, 'update', {
        assignedAgent: { old: t.assigned_agent_id ? 'assigned' : null, new: input.agentId },
      });
      await this.emit(tx, t, 'support.ticket.assigned', { agentId: input.agentId });
      return this.detailIn(tx, uuid);
    });
  }

  /** Stores the reply (or private note) and returns the refreshed ticket; the customer email goes out after commit. */
  async reply(uuid: string, input: OperatorReplyRequest): Promise<OperatorTicketDetail> {
    const operatorId = this.operatorId();
    const saved = await this.store.tx(async (tx) => {
      const t = await this.load(tx, uuid, true);
      const effect = staffReplyEffect(
        { status: t.status, firstResponseAt: t.first_response_at },
        input.isInternalNote,
      );
      const ins = await tx.execute(sql`
        INSERT INTO support_messages (org_id, ticket_id, author_operator_id, author_role, body, is_internal_note)
        VALUES (${t.org_id}, ${t.id}, ${operatorId}, 'admin', ${input.body}, ${input.isInternalNote})
        RETURNING id
      `);
      if (effect.touchLastReply) {
        await tx.execute(sql`
          UPDATE support_tickets
          SET last_reply_at = now(),
              first_response_at = CASE WHEN ${effect.stampFirstResponse} THEN now() ELSE first_response_at END,
              status = ${effect.status ?? t.status}
          WHERE org_id = ${t.org_id} AND id = ${t.id}
        `);
      }
      await this.audit(tx, t, 'update', {
        reply: { old: null, new: input.isInternalNote ? 'internal_note' : 'reply' },
      });
      const messageId = (ins.rows[0] as unknown as { id: number }).id;
      await this.emit(
        tx,
        t,
        input.isInternalNote ? 'support.ticket.note_added' : 'support.ticket.replied',
        { messageId },
      );
      return { t, messageId, status: effect.status ?? t.status };
    });

    if (!input.isInternalNote) {
      const result = await this.mailer.sendReply({
        to: saved.t.email,
        customerName: saved.t.name,
        ticketNumber: saved.t.ticket_number,
        ticketUuid: saved.t.uuid,
        subject: saved.t.subject,
        status: saved.status,
        body: input.body,
      });
      await this.store.tx((tx) =>
        tx.execute(sql`
          UPDATE support_messages SET email_status = ${result}
          WHERE org_id = ${saved.t.org_id} AND id = ${saved.messageId}
        `),
      );
    }
    return this.store.tx((tx) => this.detailIn(tx, uuid));
  }
}
