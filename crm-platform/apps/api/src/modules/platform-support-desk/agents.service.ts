import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type AgentsResponse,
  type CreateAgentRequest,
  type SetAgentActiveRequest,
  type SupportAgent,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { ASSIGNABLE_ROLE_SQL } from './ticket-actions.service';
import { SupportStore } from './support-store';

interface AgentRow {
  uuid: string;
  specialty: string | null;
  is_active: boolean;
  row_version: number;
  op_uuid: string;
  op_name: string;
  op_email: string;
  open_count: number;
  resolved_30d: number;
  avg_first: string | null;
}

const toAgent = (r: AgentRow): SupportAgent => ({
  id: r.uuid,
  operator: { id: r.op_uuid, name: r.op_name, email: r.op_email },
  specialty: r.specialty,
  isActive: r.is_active,
  openCount: Number(r.open_count),
  resolved30d: Number(r.resolved_30d),
  avgFirstResponseMinutes: r.avg_first ? Math.round(Number(r.avg_first)) : 0,
  rowVersion: r.row_version,
});

const AGENT_SELECT = sql`
  SELECT r.uuid, r.specialty, r.is_active, r.row_version,
         o.uuid AS op_uuid, o.full_name AS op_name, o.email::text AS op_email,
         (SELECT count(*) FROM support_tickets t WHERE t.assigned_agent_id = o.id
            AND t.status IN ('open', 'in_progress', 'pending'))::int AS open_count,
         (SELECT count(*) FROM support_tickets t WHERE t.assigned_agent_id = o.id
            AND t.resolved_at >= now() - interval '30 days')::int AS resolved_30d,
         (SELECT avg(extract(epoch FROM (t.first_response_at - t.created_at)) / 60) FROM support_tickets t
            WHERE t.assigned_agent_id = o.id AND t.first_response_at IS NOT NULL) AS avg_first
  FROM support_agent_roster r JOIN platform_operators o ON o.id = r.operator_id`;

/** The agent roster (TW-SUPP-017, 018): who can be assigned tickets, with live workload numbers. */
@Injectable()
export class AgentsService {
  constructor(
    private readonly store: SupportStore,
    private readonly audit: AuthAuditService,
  ) {}

  async list(): Promise<AgentsResponse> {
    return this.store.tx(async (tx) => {
      const rows = await tx.execute(
        sql`${AGENT_SELECT} ORDER BY r.is_active DESC, r.current_load DESC, o.full_name`,
      );
      const cand = await tx.execute(sql`
        SELECT o.uuid AS id, o.full_name AS name, o.email::text AS email FROM platform_operators o
        WHERE o.status = 'active' AND o.role IN (${ASSIGNABLE_ROLE_SQL})
          AND NOT EXISTS (SELECT 1 FROM support_agent_roster r WHERE r.operator_id = o.id)
        ORDER BY o.full_name LIMIT 200
      `);
      const k = await tx.execute(sql`
        SELECT (SELECT count(*) FROM support_agent_roster)::int AS total,
               (SELECT count(*) FROM support_agent_roster WHERE is_active)::int AS active,
               count(*) FILTER (WHERE status IN ('open', 'in_progress', 'pending'))::int AS open_total,
               count(*) FILTER (WHERE assigned_agent_id IS NULL AND status IN ('open', 'pending'))::int AS unassigned
        FROM support_tickets
      `);
      const kk = k.rows[0] as unknown as {
        total: number;
        active: number;
        open_total: number;
        unassigned: number;
      };
      return {
        data: (rows.rows as unknown as AgentRow[]).map(toAgent),
        candidates: cand.rows as unknown as AgentsResponse['candidates'],
        kpis: {
          total: kk.total,
          active: kk.active,
          openTotal: kk.open_total,
          unassigned: kk.unassigned,
        },
      };
    });
  }

  private async one(tx: Tx, uuid: string): Promise<SupportAgent> {
    const res = await tx.execute(sql`${AGENT_SELECT} WHERE r.uuid = ${uuid}`);
    const row = res.rows[0] as unknown as AgentRow | undefined;
    if (!row) throw AppError.notFound('Agent', uuid);
    return toAgent(row);
  }

  /** Adding an operator who is already on the roster is a no-op that returns the existing agent (Reference firstOrCreate). */
  async add(input: CreateAgentRequest): Promise<SupportAgent> {
    return this.store.tx(async (tx) => {
      const op = await tx.execute(sql`
        SELECT id FROM platform_operators
        WHERE uuid = ${input.operatorId} AND status = 'active' AND role IN (${ASSIGNABLE_ROLE_SQL})
      `);
      const opRow = op.rows[0] as unknown as { id: number } | undefined;
      if (!opRow) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Only active super admin or support operators can be agents.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const ins = await tx.execute(sql`
        INSERT INTO support_agent_roster (operator_id, specialty) VALUES (${opRow.id}, ${input.specialty ?? null})
        ON CONFLICT (operator_id) DO NOTHING RETURNING uuid
      `);
      let uuid: string;
      if (ins.rows[0]) {
        uuid = (ins.rows[0] as unknown as { uuid: string }).uuid;
        await this.audit.record(tx, {
          event: 'platform.support.agent_added',
          status: 'success',
          payload: { operator: input.operatorId, specialty: input.specialty ?? null },
        });
      } else {
        const ex = await tx.execute(
          sql`SELECT uuid FROM support_agent_roster WHERE operator_id = ${opRow.id}`,
        );
        uuid = (ex.rows[0] as unknown as { uuid: string }).uuid;
      }
      return this.one(tx, uuid);
    });
  }

  async setActive(uuid: string, input: SetAgentActiveRequest): Promise<SupportAgent> {
    return this.store.tx(async (tx) => {
      const cur = await tx.execute(
        sql`SELECT row_version FROM support_agent_roster WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const row = cur.rows[0] as unknown as { row_version: number } | undefined;
      if (!row) throw AppError.notFound('Agent', uuid);
      if (row.row_version !== input.rowVersion) throw AppError.rowVersionConflict('Agent');
      await tx.execute(
        sql`UPDATE support_agent_roster SET is_active = ${input.isActive} WHERE uuid = ${uuid}`,
      );
      await this.audit.record(tx, {
        event: 'platform.support.agent_toggled',
        status: 'success',
        payload: { agent: uuid, isActive: input.isActive },
      });
      return this.one(tx, uuid);
    });
  }

  /** Removing an agent unassigns nothing: their tickets keep the assignee until someone reassigns them (as in Reference). */
  async remove(uuid: string): Promise<void> {
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM support_agent_roster WHERE uuid = ${uuid} RETURNING id`,
      );
      if (!res.rows[0]) throw AppError.notFound('Agent', uuid);
      await this.audit.record(tx, {
        event: 'platform.support.agent_removed',
        status: 'success',
        payload: { agent: uuid },
      });
    });
  }
}
