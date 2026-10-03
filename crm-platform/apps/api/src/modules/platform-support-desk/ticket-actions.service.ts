import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type SuppTicketPriority,
  type SuppTicketReason,
  type SuppTicketStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SlaService } from './sla.service';
import { SupportMailer } from './support-mailer.service';
import { SupportStore } from './support-store';
import { resolvedAtAfterStatus, staffReplyEffect } from './ticket-rules';

export const MODULE_KEY = 'support_tickets';
// A literal list, not a bound array: drizzle expands an array parameter into a row, which `= ANY` cannot take.
export const ASSIGNABLE_ROLE_SQL = sql`'super_admin', 'support'`;

export interface TicketRow {
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

/**
 * The ONE place a staff action changes a ticket (WD-SUPP-012 port note: WaDesk had four status writers that disagreed
 * about resolved_at and first_response_at). The operator panel, the kanban board and playbook steps all call these
 * in-transaction methods, so a status move behaves the same wherever it comes from.
 *
 * Each method writes the change, an audit row in the TICKET's organization with the operator as actor, and an outbox
 * event, in the caller's transaction.
 */
@Injectable()
export class TicketActions {
  constructor(
    private readonly outbox: OutboxService,
    private readonly sla: SlaService,
    private readonly mailer: SupportMailer,
    private readonly store: SupportStore,
  ) {}

  async load(tx: Tx, uuid: string, forUpdate: boolean): Promise<TicketRow> {
    const res = await tx.execute(sql`
      SELECT org_id, id, uuid, ticket_number, subject, message, reason, name, email, status, priority,
             assigned_agent_id, row_version, created_at, first_response_at, last_reply_at, resolved_at
      FROM support_tickets WHERE uuid = ${uuid} LIMIT 1 ${forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    const row = res.rows[0] as unknown as TicketRow | undefined;
    if (!row) throw AppError.notFound('Ticket', uuid);
    return row;
  }

  /** Locks the ticket and refuses a stale `rowVersion`. */
  async lockAt(tx: Tx, uuid: string, rowVersion: number): Promise<TicketRow> {
    const t = await this.load(tx, uuid, true);
    if (t.row_version !== rowVersion) throw AppError.rowVersionConflict('Ticket');
    return t;
  }

  async audit(
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

  emit(tx: Tx, t: TicketRow, eventType: string, payload: Record<string, unknown>) {
    return this.outbox.emit(tx, {
      orgId: t.org_id,
      aggregateModule: MODULE_KEY,
      aggregateId: t.id,
      eventType,
      payload: { ticketId: t.uuid, ticketNumber: t.ticket_number, ...payload },
    });
  }

  async statusIn(tx: Tx, t: TicketRow, status: SuppTicketStatus): Promise<TicketRow> {
    const resolvedAt = resolvedAtAfterStatus(
      status,
      t.resolved_at ? new Date(t.resolved_at) : null,
      new Date(),
    );
    await tx.execute(sql`
      UPDATE support_tickets SET status = ${status}, resolved_at = ${resolvedAt}
      WHERE org_id = ${t.org_id} AND id = ${t.id}
    `);
    await this.audit(tx, t, 'update', { status: { old: t.status, new: status } });
    await this.emit(tx, t, 'support.ticket.status_changed', { from: t.status, to: status });
    // A late resolution is a breach even if no scan ran before it.
    if (resolvedAt) await this.sla.recordBreachesIn(tx, { ...t, resolved_at: resolvedAt });
    return { ...t, status, resolved_at: resolvedAt };
  }

  async priorityIn(tx: Tx, t: TicketRow, priority: SuppTicketPriority): Promise<TicketRow> {
    await tx.execute(sql`
      UPDATE support_tickets SET priority = ${priority} WHERE org_id = ${t.org_id} AND id = ${t.id}
    `);
    await this.audit(tx, t, 'update', { priority: { old: t.priority, new: priority } });
    await this.emit(tx, t, 'support.ticket.priority_changed', { from: t.priority, to: priority });
    return { ...t, priority };
  }

  /** Active roster agents only: the operator must be on the roster, active, and a super admin or support operator. */
  async resolveAgent(tx: Tx, agentUuid: string): Promise<number | null> {
    const res = await tx.execute(sql`
      SELECT o.id FROM platform_operators o JOIN support_agent_roster r ON r.operator_id = o.id
      WHERE o.uuid = ${agentUuid} AND o.status = 'active' AND r.is_active AND o.role IN (${ASSIGNABLE_ROLE_SQL})
    `);
    return (res.rows[0] as unknown as { id: number } | undefined)?.id ?? null;
  }

  async assignIn(tx: Tx, t: TicketRow, agentUuid: string | null): Promise<TicketRow> {
    let agentId: number | null = null;
    if (agentUuid) {
      agentId = await this.resolveAgent(tx, agentUuid);
      if (agentId === null) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'That operator cannot be assigned tickets.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    await tx.execute(sql`
      UPDATE support_tickets SET assigned_agent_id = ${agentId} WHERE org_id = ${t.org_id} AND id = ${t.id}
    `);
    await this.audit(tx, t, 'update', {
      assignedAgent: { old: t.assigned_agent_id ? 'assigned' : null, new: agentUuid },
    });
    await this.emit(tx, t, 'support.ticket.assigned', { agentId: agentUuid });
    return { ...t, assigned_agent_id: agentId };
  }

  async addTagIn(tx: Tx, t: TicketRow, tag: string): Promise<void> {
    await tx.execute(sql`
      UPDATE support_tickets
      SET tags = CASE WHEN COALESCE(tags, '[]'::jsonb) ? ${tag} THEN COALESCE(tags, '[]'::jsonb)
                      ELSE COALESCE(tags, '[]'::jsonb) || to_jsonb(${tag}::text) END
      WHERE org_id = ${t.org_id} AND id = ${t.id}
    `);
    await this.audit(tx, t, 'update', { tag: { old: null, new: tag } });
  }

  /** Stores a reply or private note; returns what the caller needs to email the customer after commit. */
  async replyIn(
    tx: Tx,
    t: TicketRow,
    operatorId: number,
    body: string,
    isInternalNote: boolean,
  ): Promise<{ messageId: number; status: SuppTicketStatus }> {
    const effect = staffReplyEffect(
      { status: t.status, firstResponseAt: t.first_response_at },
      isInternalNote,
    );
    const ins = await tx.execute(sql`
      INSERT INTO support_messages (org_id, ticket_id, author_operator_id, author_role, body, is_internal_note)
      VALUES (${t.org_id}, ${t.id}, ${operatorId}, 'admin', ${body}, ${isInternalNote})
      RETURNING id
    `);
    if (effect.touchLastReply) {
      const upd = await tx.execute(sql`
        UPDATE support_tickets
        SET last_reply_at = now(),
            first_response_at = CASE WHEN ${effect.stampFirstResponse} THEN now() ELSE first_response_at END,
            status = ${effect.status ?? t.status}
        WHERE org_id = ${t.org_id} AND id = ${t.id}
        RETURNING first_response_at
      `);
      if (effect.stampFirstResponse) {
        const firstAt = (upd.rows[0] as unknown as { first_response_at: Date }).first_response_at;
        await this.sla.recordBreachesIn(tx, { ...t, first_response_at: firstAt });
      }
    }
    await this.audit(tx, t, 'update', {
      reply: { old: null, new: isInternalNote ? 'internal_note' : 'reply' },
    });
    const messageId = (ins.rows[0] as unknown as { id: number }).id;
    await this.emit(
      tx,
      t,
      isInternalNote ? 'support.ticket.note_added' : 'support.ticket.replied',
      {
        messageId,
      },
    );
    return { messageId, status: effect.status ?? t.status };
  }

  /**
   * After the reply committed: emails the customer and records the outcome on the message (sent / failed). Never throws, so
   * a broken mail setup cannot undo a stored reply.
   */
  async deliverReply(
    t: TicketRow,
    saved: { messageId: number; status: SuppTicketStatus },
    body: string,
  ): Promise<void> {
    const result = await this.mailer.sendReply({
      to: t.email,
      customerName: t.name,
      ticketNumber: t.ticket_number,
      ticketUuid: t.uuid,
      subject: t.subject,
      status: saved.status,
      body,
    });
    await this.store.tx((tx) =>
      tx.execute(sql`
        UPDATE support_messages SET email_status = ${result}
        WHERE org_id = ${t.org_id} AND id = ${saved.messageId}
      `),
    );
  }
}
