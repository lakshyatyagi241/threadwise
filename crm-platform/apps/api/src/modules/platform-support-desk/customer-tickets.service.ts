import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type CreateSupportTicketRequest,
  type CustomerTicketDetail,
  type CustomerTicketItem,
  type CustomerTicketListResponse,
  type SuppTicketReason,
  type SuppTicketStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  customerReplyEffect,
  excerpt,
  fallbackTicketNumber,
  isCustomerOpen,
  ticketNumber,
} from './ticket-rules';

const MODULE_KEY = 'support_tickets';
const NUMBER_ATTEMPTS = 5;

interface CustomerTicketRow {
  id: number;
  uuid: string;
  ticket_number: string;
  subject: string;
  message: string;
  reason: SuppTicketReason;
  status: SuppTicketStatus;
  created_at: Date;
  resolved_at: Date | null;
}

const iso = (d: Date | string): string => new Date(d).toISOString();

const toItem = (r: CustomerTicketRow): CustomerTicketItem => ({
  id: r.uuid,
  ticketNumber: r.ticket_number,
  subject: r.subject,
  excerpt: excerpt(r.message),
  status: r.status,
  createdAt: iso(r.created_at),
  resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
});

const COLUMNS = sql`id, uuid, ticket_number, subject, message, reason, status, created_at, resolved_at`;

/**
 * The customer side of the helpdesk (TW-SUPP-001..005): any signed-in user files tickets and follows their own.
 * Every statement runs in the caller's tenant transaction AND filters on `user_id`, so teammates in the same
 * workspace never see each other's tickets and another user's ticket is a 404, not a 403 (the query is scoped,
 * there is no post-load check to forget).
 */
@Injectable()
export class CustomerTicketsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private actor() {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async create(input: CreateSupportTicketRequest): Promise<CustomerTicketItem> {
    const { orgId, userId } = this.actor();
    return this.db.tx(async (tx) => {
      const row = await this.insertWithFreshNumber(tx, orgId, userId, input);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'support.ticket.created',
        payload: { ticketId: row.uuid, ticketNumber: row.ticket_number, reason: row.reason },
      });
      return toItem(row);
    });
  }

  /**
   * The number is random, so a collision is rare; the unique index decides. ON CONFLICT DO NOTHING keeps the
   * transaction alive on a collision (a plain duplicate-key error would abort it), then a new candidate is tried.
   */
  private async insertWithFreshNumber(
    tx: Tx,
    orgId: number,
    userId: number,
    input: CreateSupportTicketRequest,
  ): Promise<CustomerTicketRow> {
    for (let attempt = 0; attempt <= NUMBER_ATTEMPTS; attempt++) {
      const number = attempt < NUMBER_ATTEMPTS ? ticketNumber() : fallbackTicketNumber(Date.now());
      const res = await tx.execute(sql`
        INSERT INTO support_tickets (org_id, user_id, ticket_number, reason, name, email, subject, message)
        VALUES (${orgId}, ${userId}, ${number}, ${input.reason}, ${input.name}, ${input.email}, ${input.subject}, ${input.message})
        ON CONFLICT (ticket_number) DO NOTHING
        RETURNING ${COLUMNS}
      `);
      if (res.rows[0]) return res.rows[0] as unknown as CustomerTicketRow;
    }
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Could not allocate a ticket number, please try again.',
      HttpStatus.CONFLICT,
    );
  }

  async list(limit: number): Promise<CustomerTicketListResponse> {
    const { userId } = this.actor();
    return this.db.tx(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT ${COLUMNS} FROM support_tickets WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}
      `);
      const counts = await tx.execute(sql`
        SELECT status, count(*)::int AS n FROM support_tickets WHERE user_id = ${userId} GROUP BY status
      `);
      const byStatus = counts.rows as unknown as Array<{ status: SuppTicketStatus; n: number }>;
      return {
        data: (rows.rows as unknown as CustomerTicketRow[]).map(toItem),
        summary: {
          total: byStatus.reduce((a, r) => a + r.n, 0),
          open: byStatus.filter((r) => isCustomerOpen(r.status)).reduce((a, r) => a + r.n, 0),
          resolved: byStatus.find((r) => r.status === 'resolved')?.n ?? 0,
        },
      };
    });
  }

  /** The owner's own row, locked when a write follows. */
  private async owned(tx: Tx, userId: number, uuid: string, forUpdate: boolean) {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, last_reply_at FROM support_tickets
      WHERE uuid = ${uuid} AND user_id = ${userId} ${forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    const row = res.rows[0] as unknown as CustomerTicketRow | undefined;
    if (!row) throw AppError.notFound('Ticket', uuid);
    return row;
  }

  async detail(uuid: string): Promise<CustomerTicketDetail> {
    const { userId } = this.actor();
    return this.db.tx(async (tx) => {
      const t = await this.owned(tx, userId, uuid, false);
      return this.thread(tx, t);
    });
  }

  private async thread(tx: Tx, t: CustomerTicketRow): Promise<CustomerTicketDetail> {
    // Internal notes are filtered here, in SQL: they never reach the customer's process, let alone the screen.
    const msgs = await tx.execute(sql`
      SELECT uuid, author_role, body, created_at FROM support_messages
      WHERE ticket_id = ${t.id} AND is_internal_note = false ORDER BY created_at, id
    `);
    const rows = msgs.rows as unknown as Array<{
      uuid: string;
      author_role: 'customer' | 'admin' | 'system';
      body: string;
      created_at: Date;
    }>;
    return {
      ...toItem(t),
      reason: t.reason,
      messages: [
        { id: null, role: 'initial', body: t.message, createdAt: iso(t.created_at) },
        ...rows.map((m) => ({
          id: m.uuid,
          role: m.author_role === 'customer' ? ('customer' as const) : ('support' as const),
          body: m.body,
          createdAt: iso(m.created_at),
        })),
      ],
    };
  }

  async reply(uuid: string, body: string): Promise<CustomerTicketDetail> {
    const { orgId, userId } = this.actor();
    return this.db.tx(async (tx) => {
      const t = await this.owned(tx, userId, uuid, true);
      const effect = customerReplyEffect(t.status);
      if (!effect.allowed) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'This ticket is closed. Open a new ticket to continue.',
          HttpStatus.CONFLICT,
        );
      }
      const inserted = await tx.execute(sql`
        INSERT INTO support_messages (org_id, ticket_id, author_user_id, author_role, body, is_internal_note)
        VALUES (${orgId}, ${t.id}, ${userId}, 'customer', ${body}, false) RETURNING id
      `);
      const messageId = (inserted.rows[0] as unknown as { id: number }).id;
      const updated = await tx.execute(sql`
        UPDATE support_tickets
        SET last_reply_at = now(),
            status = ${effect.status ?? t.status},
            resolved_at = CASE WHEN ${effect.allowed && effect.reopen} THEN NULL ELSE resolved_at END
        WHERE org_id = ${orgId} AND id = ${t.id}
        RETURNING ${COLUMNS}
      `);
      const after = updated.rows[0] as unknown as CustomerTicketRow;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: t.id,
        action: 'update',
        delta: effect.reopen ? { status: { old: t.status, new: after.status } } : undefined,
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: t.id,
        eventType: 'support.ticket.customer_replied',
        payload: { ticketId: t.uuid, messageId, reopened: effect.reopen },
      });
      return this.thread(tx, after);
    });
  }
}
