import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ReportsResponse, SuppTicketStatus } from '@crm/contracts';
import { SUPP_TICKET_STATUSES } from '@crm/contracts';
import { AuthAuditService } from '../auth';
import { SupportStore } from './support-store';

const DAY = 86_400_000;

/** CSV cell: quotes when needed, and a leading = + - @ (or tab/CR) is defused so a spreadsheet never runs it as a formula. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'ticket_number',
  'subject',
  'status',
  'priority',
  'workspace_id',
  'assigned_agent_id',
  'created_at',
  'first_response_at',
  'resolved_at',
] as const;

/** Support reports and the CSV export (TW-SUPP-031, 032). */
@Injectable()
export class ReportsService {
  constructor(
    private readonly store: SupportStore,
    private readonly audit: AuthAuditService,
  ) {}

  async report(days: number, now = new Date()): Promise<ReportsResponse> {
    const since = new Date(now.getTime() - days * DAY);
    return this.store.tx(async (tx) => {
      const k = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM support_tickets WHERE created_at >= ${since})::int AS tickets,
          (SELECT count(*) FROM support_tickets WHERE resolved_at >= ${since})::int AS resolved,
          (SELECT avg(extract(epoch FROM (first_response_at - created_at)) / 60) FROM support_tickets
             WHERE first_response_at IS NOT NULL AND created_at >= ${since}) AS avg_first,
          (SELECT avg(extract(epoch FROM (resolved_at - created_at)) / 60) FROM support_tickets
             WHERE resolved_at IS NOT NULL AND created_at >= ${since}) AS avg_res,
          (SELECT count(*) FROM support_tickets t WHERE t.resolved_at >= ${since} AND EXISTS (
             SELECT 1 FROM support_sla_breaches b WHERE b.org_id = t.org_id AND b.ticket_id = t.id))::int AS breached
      `);
      const kk = k.rows[0] as unknown as {
        tickets: number;
        resolved: number;
        avg_first: string | null;
        avg_res: string | null;
        breached: number;
      };
      const vol = await tx.execute(sql`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n
        FROM support_tickets WHERE created_at >= ${since} GROUP BY d
      `);
      const byDay = new Map(
        (vol.rows as unknown as Array<{ d: string; n: number }>).map((r) => [r.d, r.n]),
      );
      const volume: ReportsResponse['volume'] = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
        volume.push({ date, count: byDay.get(date) ?? 0 });
      }
      const st = await tx.execute(
        sql`SELECT status, count(*)::int AS n FROM support_tickets GROUP BY status`,
      );
      const counts = new Map(
        (st.rows as unknown as Array<{ status: SuppTicketStatus; n: number }>).map((r) => [
          r.status,
          r.n,
        ]),
      );
      const byStatus = SUPP_TICKET_STATUSES.filter((s) => counts.has(s)).map((s) => ({
        status: s,
        count: counts.get(s)!,
      }));
      const top = await tx.execute(sql`
        SELECT o.uuid, o.full_name AS name, count(*)::int AS resolved,
               avg(extract(epoch FROM (t.first_response_at - t.created_at)) / 60) AS avg_first,
               avg(extract(epoch FROM (t.resolved_at - t.created_at)) / 60) AS avg_res
        FROM support_tickets t JOIN platform_operators o ON o.id = t.assigned_agent_id
        WHERE t.resolved_at >= ${since} GROUP BY o.id ORDER BY resolved DESC, o.full_name LIMIT 8
      `);
      const round = (v: string | null) => (v === null ? null : Math.round(Number(v)));
      return {
        days,
        kpis: {
          tickets: kk.tickets,
          resolved: kk.resolved,
          avgFirstResponseMinutes: round(kk.avg_first) ?? 0,
          avgResolutionMinutes: round(kk.avg_res) ?? 0,
          compliance:
            kk.resolved === 0
              ? 100
              : Math.max(0, Math.round((100 - (kk.breached / kk.resolved) * 100) * 10) / 10),
        },
        volume,
        byStatus,
        topAgents: (
          top.rows as unknown as Array<{
            uuid: string;
            name: string;
            resolved: number;
            avg_first: string | null;
            avg_res: string | null;
          }>
        ).map((r) => ({
          id: r.uuid,
          name: r.name,
          resolved: r.resolved,
          avgFirstResponseMinutes: round(r.avg_first),
          avgResolutionMinutes: round(r.avg_res),
        })),
      };
    });
  }

  /** The whole ticket table, newest first, in chunks of 500 by keyset (no filters, as in Reference). Audited. */
  async exportCsv(now = new Date()): Promise<{ filename: string; body: string }> {
    const lines: string[] = [CSV_HEADER.join(',')];
    let cursor: { at: string; org: number; id: number } | null = null;
    await this.store.tx(async (tx) => {
      for (;;) {
        const res = await tx.execute(sql`
          SELECT t.org_id, t.id, t.ticket_number, t.subject, t.status, t.priority, o.uuid AS workspace,
                 po.uuid AS agent, t.created_at, to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_iso,
                 t.first_response_at, t.resolved_at
          FROM support_tickets t JOIN organizations o ON o.id = t.org_id
          LEFT JOIN platform_operators po ON po.id = t.assigned_agent_id
          ${cursor ? sql`WHERE (t.created_at, t.org_id, t.id) < (${cursor.at}::timestamptz, ${cursor.org}, ${cursor.id})` : sql``}
          ORDER BY t.created_at DESC, t.org_id DESC, t.id DESC LIMIT 500
        `);
        const rows = res.rows as unknown as Array<{
          org_id: number;
          id: number;
          ticket_number: string;
          subject: string;
          status: string;
          priority: string;
          workspace: string;
          agent: string | null;
          created_iso: string;
          first_response_at: Date | null;
          resolved_at: Date | null;
        }>;
        for (const r of rows) {
          lines.push(
            [
              r.ticket_number,
              r.subject,
              r.status,
              r.priority,
              r.workspace,
              r.agent,
              r.created_iso,
              r.first_response_at ? new Date(r.first_response_at).toISOString() : '',
              r.resolved_at ? new Date(r.resolved_at).toISOString() : '',
            ]
              .map(csvCell)
              .join(','),
          );
        }
        const last = rows[rows.length - 1];
        if (!last || rows.length < 500) break;
        cursor = { at: last.created_iso, org: Number(last.org_id), id: Number(last.id) };
      }
      await this.audit.record(tx, {
        event: 'platform.support.tickets_exported',
        status: 'success',
        payload: { rows: lines.length - 1 },
      });
    });
    return {
      filename: `support-tickets-${now.toISOString().slice(0, 10)}.csv`,
      body: `${lines.join('\n')}\n`,
    };
  }
}
