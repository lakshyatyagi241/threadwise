import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  CustomerDetailResponse,
  CustomersQuery,
  CustomersResponse,
  SuppTicketPriority,
  SuppTicketStatus,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { escapeLike } from './ticket-rules';
import { SupportStore } from './support-store';

/** Workspaces ranked by support load, and one workspace's ticket history (WD-SUPP-020, 021). */
@Injectable()
export class CustomersService {
  constructor(private readonly store: SupportStore) {}

  async list(query: CustomersQuery): Promise<CustomersResponse> {
    const like = query.q ? `%${escapeLike(query.q)}%` : null;
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.uuid, o.name, o.slug,
               count(*)::int AS total_tickets,
               count(*) FILTER (WHERE t.status IN ('open', 'in_progress', 'pending'))::int AS open_tickets,
               max(t.created_at) AS last_ticket_at,
               avg(extract(epoch FROM (t.resolved_at - t.created_at)) / 60)
                 FILTER (WHERE t.resolved_at IS NOT NULL) AS avg_res
        FROM support_tickets t JOIN organizations o ON o.id = t.org_id
        WHERE ${like ? sql`(o.name ILIKE ${like} OR o.slug ILIKE ${like})` : sql`true`}
        GROUP BY o.id ORDER BY open_tickets DESC, total_tickets DESC, o.name
      `);
      const rows = (
        res.rows as unknown as Array<{
          uuid: string;
          name: string;
          slug: string;
          total_tickets: number;
          open_tickets: number;
          last_ticket_at: Date | null;
          avg_res: string | null;
        }>
      ).map((r) => ({
        workspaceId: r.uuid,
        name: r.name,
        slug: r.slug,
        openTickets: r.open_tickets,
        totalTickets: r.total_tickets,
        avgResolutionMinutes: r.avg_res === null ? null : Math.round(Number(r.avg_res)),
        lastTicketAt: r.last_ticket_at ? new Date(r.last_ticket_at).toISOString() : null,
      }));
      return {
        data: rows,
        kpis: {
          customers: rows.length,
          total: rows.reduce((a, r) => a + r.totalTickets, 0),
          open: rows.reduce((a, r) => a + r.openTickets, 0),
          top: rows[0]?.openTickets ?? 0,
        },
      };
    });
  }

  async detail(workspaceUuid: string): Promise<CustomerDetailResponse> {
    return this.store.tx(async (tx) => {
      const org = await tx.execute(
        sql`SELECT id, uuid, name, slug FROM organizations WHERE uuid = ${workspaceUuid}`,
      );
      const o = org.rows[0] as unknown as
        { id: number; uuid: string; name: string; slug: string } | undefined;
      if (!o) throw AppError.notFound('Workspace', workspaceUuid);
      const res = await tx.execute(sql`
        SELECT t.uuid, t.ticket_number, t.subject, t.name, t.status, t.priority, t.created_at,
               t.first_response_at, t.resolved_at, po.full_name AS assignee, u.full_name AS opener
        FROM support_tickets t
        LEFT JOIN platform_operators po ON po.id = t.assigned_agent_id
        LEFT JOIN users u ON u.org_id = t.org_id AND u.id = t.user_id
        WHERE t.org_id = ${o.id} ORDER BY t.created_at DESC, t.id DESC LIMIT 200
      `);
      const rows = res.rows as unknown as Array<{
        uuid: string;
        ticket_number: string;
        subject: string;
        name: string;
        status: SuppTicketStatus;
        priority: SuppTicketPriority;
        created_at: Date;
        first_response_at: Date | null;
        resolved_at: Date | null;
        assignee: string | null;
        opener: string | null;
      }>;
      const mins = (a: Date, b: Date) =>
        Math.max(0, Math.floor((+new Date(b) - +new Date(a)) / 60000));
      const avg = (xs: number[]) =>
        xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
      const resolved = rows.filter((r) => r.resolved_at);
      return {
        workspace: { id: o.uuid, name: o.name, slug: o.slug },
        stats: {
          total: rows.length,
          open: rows.filter((r) => ['open', 'in_progress', 'pending'].includes(r.status)).length,
          resolved: resolved.length,
          avgFirstResponseMinutes: avg(
            rows
              .filter((r) => r.first_response_at)
              .map((r) => mins(r.created_at, r.first_response_at!)),
          ),
          avgResolutionMinutes: avg(resolved.map((r) => mins(r.created_at, r.resolved_at!))),
        },
        tickets: rows.map((r) => ({
          id: r.uuid,
          ticketNumber: r.ticket_number,
          subject: r.subject,
          openedBy: r.opener ?? r.name,
          status: r.status,
          priority: r.priority,
          assignee: r.assignee,
          createdAt: new Date(r.created_at).toISOString(),
          resolvedInMinutes: r.resolved_at ? mins(r.created_at, r.resolved_at) : null,
        })),
      };
    });
  }
}
