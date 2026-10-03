import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type SlaBoardResponse,
  type SlaPolicy,
  type SlaPolicyInput,
  type TicketSla,
  type UpdateSlaPolicyRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { SupportStore } from './support-store';
import {
  businessHoursFor,
  computeSla,
  type BusinessHours,
  type SlaPolicyTargets,
} from './sla-calculator';

interface PolicyRow {
  id: number;
  uuid: string;
  name: string;
  first_response_minutes: number;
  resolution_minutes: number;
  pause_when_waiting_on_customer: boolean;
  respect_business_hours: boolean;
  is_default: boolean;
  row_version: number;
}

export interface SlaTicketRef {
  org_id: number;
  id: number;
  created_at: Date | string;
  first_response_at: Date | string | null;
  resolved_at: Date | string | null;
}

const toPolicy = (r: PolicyRow): SlaPolicy => ({
  id: r.uuid,
  name: r.name,
  firstResponseMinutes: r.first_response_minutes,
  resolutionMinutes: r.resolution_minutes,
  pauseWhenWaitingOnCustomer: r.pause_when_waiting_on_customer,
  respectBusinessHours: r.respect_business_hours,
  isDefault: r.is_default,
  rowVersion: r.row_version,
});

const date = (d: Date | string | null): Date | null => (d ? new Date(d) : null);
const POLICY_COLS = sql`id, uuid, name, first_response_minutes, resolution_minutes,
  pause_when_waiting_on_customer, respect_business_hours, is_default, row_version`;

/**
 * Helpdesk SLA: the platform policies (TW-SUPP-026..028), the per-ticket snapshot (014, 029), the breach ledger and its
 * scanner (030). Every statement runs on the SupportStore door (policies and breaches span all customers).
 */
@Injectable()
export class SlaService {
  constructor(
    private readonly store: SupportStore,
    private readonly audit: AuthAuditService,
  ) {}

  // --- engine ---------------------------------------------------------------------------------------------------------------------

  /** The platform default policy (the only one ever applied; Reference's tickets never carried their own). */
  async defaultPolicyIn(
    tx: Tx,
  ): Promise<(SlaPolicyTargets & { uuid: string; name: string; id: number }) | null> {
    const res = await tx.execute(
      sql`SELECT ${POLICY_COLS} FROM support_sla_policies WHERE is_default LIMIT 1`,
    );
    const r = res.rows[0] as unknown as PolicyRow | undefined;
    return r
      ? {
          id: r.id,
          uuid: r.uuid,
          name: r.name,
          firstResponseMinutes: r.first_response_minutes,
          resolutionMinutes: r.resolution_minutes,
          respectBusinessHours: r.respect_business_hours,
        }
      : null;
  }

  /** The customer workspace's hours (never the operator's); a missing row or column falls back to Mon-Fri 09-17 UTC. */
  async hoursIn(tx: Tx, orgId: number): Promise<BusinessHours> {
    const res = await tx.execute(
      sql`SELECT timezone, business_hours FROM workspace_settings WHERE org_id = ${orgId} LIMIT 1`,
    );
    const r = res.rows[0] as unknown as
      { timezone: string | null; business_hours: string | null } | undefined;
    return businessHoursFor(r?.business_hours ?? null, r?.timezone ?? null);
  }

  async snapshotIn(tx: Tx, t: SlaTicketRef, now = new Date()): Promise<TicketSla> {
    const policy = await this.defaultPolicyIn(tx);
    if (!policy) return { policy: null, firstResponse: null, resolution: null };
    const bh = policy.respectBusinessHours ? await this.hoursIn(tx, t.org_id) : null;
    const r = computeSla(
      {
        createdAt: new Date(t.created_at),
        firstResponseAt: date(t.first_response_at),
        resolvedAt: date(t.resolved_at),
      },
      policy,
      bh,
      now,
    );
    return { policy: { id: policy.uuid, name: policy.name }, ...r };
  }

  /**
   * Records a breach row for every clock of the ticket that is already past its deadline. Idempotent in the database
   * (unique per ticket and type). Called by the scanner, and at the moment a ticket is first answered or resolved, so a
   * late answer is not lost just because no scan ran in between (Reference never scanned resolved tickets).
   */
  async recordBreachesIn(tx: Tx, t: SlaTicketRef, now = new Date()): Promise<number> {
    const policy = await this.defaultPolicyIn(tx);
    if (!policy) return 0;
    const bh = policy.respectBusinessHours ? await this.hoursIn(tx, t.org_id) : null;
    const r = computeSla(
      {
        createdAt: new Date(t.created_at),
        firstResponseAt: date(t.first_response_at),
        resolvedAt: date(t.resolved_at),
      },
      policy,
      bh,
      now,
    );
    let inserted = 0;
    for (const [type, timer] of [
      ['first_response', r.firstResponse],
      ['resolution', r.resolution],
    ] as const) {
      if (!timer.breached) continue;
      const res = await tx.execute(sql`
        INSERT INTO support_sla_breaches (org_id, ticket_id, policy_id, breach_type, severity, over_by_minutes)
        VALUES (${t.org_id}, ${t.id}, ${policy.id}, ${type}, 'breach', ${timer.minutesOver ?? 0})
        ON CONFLICT (org_id, ticket_id, breach_type) DO NOTHING
        RETURNING id
      `);
      inserted += res.rows.length;
    }
    return inserted;
  }

  /** The worker's scan (TW-SUPP-030): every unresolved ticket, in chunks of 200 by id. Returns the rows inserted. */
  async scan(now = new Date()): Promise<number> {
    let inserted = 0;
    let lastOrg = 0;
    let lastId = 0;
    for (;;) {
      const chunk = await this.store.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT org_id, id, created_at, first_response_at, resolved_at FROM support_tickets
          WHERE status NOT IN ('resolved', 'closed') AND (org_id, id) > (${lastOrg}, ${lastId})
          ORDER BY org_id, id LIMIT 200
        `);
        const rows = res.rows as unknown as SlaTicketRef[];
        let n = 0;
        for (const t of rows) n += await this.recordBreachesIn(tx, t, now);
        return { rows, n };
      });
      inserted += chunk.n;
      const last = chunk.rows[chunk.rows.length - 1];
      if (!last) break;
      lastOrg = Number(last.org_id);
      lastId = Number(last.id);
      if (chunk.rows.length < 200) break;
    }
    return inserted;
  }

  // --- board ----------------------------------------------------------------------------------------------------------------------

  async board(now = new Date()): Promise<SlaBoardResponse> {
    return this.store.tx(async (tx) => {
      const pol = await tx.execute(
        sql`SELECT ${POLICY_COLS} FROM support_sla_policies ORDER BY id`,
      );
      const br = await tx.execute(sql`
        SELECT b.uuid, b.breached_at, b.breach_type, b.severity, b.over_by_minutes,
               t.uuid AS ticket_uuid, t.ticket_number, t.subject
        FROM support_sla_breaches b JOIN support_tickets t ON t.org_id = b.org_id AND t.id = b.ticket_id
        ORDER BY b.breached_at DESC, b.id DESC LIMIT 50
      `);
      // At risk: an open ticket whose running clock is inside its last quarter or already overdue.
      const open = await tx.execute(sql`
        SELECT org_id, id, created_at, first_response_at, resolved_at FROM support_tickets
        WHERE status IN ('open', 'in_progress', 'pending') ORDER BY created_at LIMIT 500
      `);
      let atRisk = 0;
      for (const t of open.rows as unknown as SlaTicketRef[]) {
        const s = await this.snapshotIn(tx, t, now);
        const running = [s.firstResponse, s.resolution].filter(
          (x) => x && x.severity !== 'met' && x.severity !== 'ok',
        );
        if (running.length) atRisk++;
      }
      // Compliance on ONE cohort: tickets resolved in the last 7 days that never breached.
      const comp = await tx.execute(sql`
        SELECT count(*)::int AS resolved,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM support_sla_breaches b WHERE b.org_id = t.org_id AND b.ticket_id = t.id))::int AS breached
        FROM support_tickets t WHERE t.resolved_at >= ${new Date(now.getTime() - 7 * 86_400_000)}
      `);
      const c = comp.rows[0] as unknown as { resolved: number; breached: number };
      const compliance7d =
        c.resolved === 0 ? 100 : Math.round((100 - (c.breached / c.resolved) * 100) * 10) / 10;
      const breaches = (
        br.rows as unknown as Array<{
          uuid: string;
          breached_at: Date;
          breach_type: 'first_response' | 'resolution';
          severity: 'warn' | 'breach' | 'hard_breach';
          over_by_minutes: number;
          ticket_uuid: string;
          ticket_number: string;
          subject: string;
        }>
      ).map((b) => ({
        id: b.uuid,
        breachedAt: new Date(b.breached_at).toISOString(),
        ticketId: b.ticket_uuid,
        ticketNumber: b.ticket_number,
        subject: b.subject,
        breachType: b.breach_type,
        overByMinutes: b.over_by_minutes,
        severity: b.severity,
      }));
      const policies = (pol.rows as unknown as PolicyRow[]).map(toPolicy);
      return {
        policies,
        breaches,
        kpis: {
          policies: policies.length,
          openBreaches: breaches.length,
          atRisk,
          compliance7d: Math.max(0, compliance7d),
        },
      };
    });
  }

  // --- policies -------------------------------------------------------------------------------------------------------------------

  private async event(tx: Tx, event: string, payload: Record<string, unknown>) {
    await this.audit.record(tx, { event, status: 'success', payload });
  }

  async createPolicy(input: SlaPolicyInput): Promise<SlaPolicy> {
    return this.store.tx(async (tx) => {
      if (input.isDefault)
        await tx.execute(sql`UPDATE support_sla_policies SET is_default = false WHERE is_default`);
      const res = await tx.execute(sql`
        INSERT INTO support_sla_policies (name, first_response_minutes, resolution_minutes,
          pause_when_waiting_on_customer, respect_business_hours, is_default)
        VALUES (${input.name}, ${input.firstResponseMinutes}, ${input.resolutionMinutes},
          ${input.pauseWhenWaitingOnCustomer}, ${input.respectBusinessHours}, ${input.isDefault})
        RETURNING ${POLICY_COLS}
      `);
      await this.event(tx, 'platform.support.sla_policy_created', {
        name: input.name,
        isDefault: input.isDefault,
      });
      return toPolicy(res.rows[0] as unknown as PolicyRow);
    });
  }

  async updatePolicy(uuid: string, input: UpdateSlaPolicyRequest): Promise<SlaPolicy> {
    return this.store.tx(async (tx) => {
      const cur = await tx.execute(
        sql`SELECT id, row_version FROM support_sla_policies WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const row = cur.rows[0] as unknown as { id: number; row_version: number } | undefined;
      if (!row) throw AppError.notFound('SLA policy', uuid);
      if (row.row_version !== input.rowVersion) throw AppError.rowVersionConflict('SLA policy');
      if (input.isDefault) {
        await tx.execute(
          sql`UPDATE support_sla_policies SET is_default = false WHERE is_default AND id <> ${row.id}`,
        );
      }
      const res = await tx.execute(sql`
        UPDATE support_sla_policies SET name = ${input.name}, first_response_minutes = ${input.firstResponseMinutes},
          resolution_minutes = ${input.resolutionMinutes},
          pause_when_waiting_on_customer = ${input.pauseWhenWaitingOnCustomer},
          respect_business_hours = ${input.respectBusinessHours}, is_default = ${input.isDefault}
        WHERE id = ${row.id} RETURNING ${POLICY_COLS}
      `);
      await this.event(tx, 'platform.support.sla_policy_updated', {
        policy: uuid,
        name: input.name,
      });
      return toPolicy(res.rows[0] as unknown as PolicyRow);
    });
  }

  /**
   * Deletes a policy. Deleting the default switches SLA math off platform-wide (Reference did it silently); the audit row names
   * it so the change is visible. Breach rows keep existing (their policy reference becomes null).
   */
  async deletePolicy(uuid: string): Promise<void> {
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM support_sla_policies WHERE uuid = ${uuid} RETURNING name, is_default`,
      );
      const row = res.rows[0] as unknown as { name: string; is_default: boolean } | undefined;
      if (!row) throw AppError.notFound('SLA policy', uuid);
      await this.event(tx, 'platform.support.sla_policy_deleted', {
        name: row.name,
        wasDefault: row.is_default,
      });
    });
  }
}

export const slaConflict = (message: string) =>
  new AppError(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT);
