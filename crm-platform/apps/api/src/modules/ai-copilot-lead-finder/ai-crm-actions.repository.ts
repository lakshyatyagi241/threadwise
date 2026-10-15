import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface AiCrmActionRow {
  tool: string;
  result_summary: string;
  created_at: Date;
}

export interface LogAiCrmActionInput {
  userId: number | null;
  channel: string;
  tool: string;
  kind: 'read' | 'write';
  status: 'ok' | 'error' | 'needs_confirm' | 'confirmed' | 'cancelled';
  params: Record<string, unknown>;
  resultSummary: string;
  provider: string | null;
  model: string | null;
  tokens: number;
  subjectType: string | null;
  subjectId: number | null;
}

/**
 * The AI CRM Copilot's audit log (`ai_crm_actions`, TW-AICRM-001). Append-only: every tool call, read or write,
 * writes one row here. The table is a monthly-partitioned stream (see the Drizzle mirror's comment) created in the
 * repo's early bulk Reference-schema port, ahead of this domain's own service/API work.
 */
@Injectable()
export class AiCrmActionsRepository {
  async log(tx: Tx, orgId: number, input: LogAiCrmActionInput): Promise<void> {
    await tx.execute(sql`
      INSERT INTO ai_crm_actions (org_id, user_id, channel, tool, kind, status, params, result_summary, provider, model, tokens, subject_type, subject_id)
      VALUES (${orgId}, ${input.userId}, ${input.channel}, ${input.tool}, ${input.kind}, ${input.status},
              ${JSON.stringify(input.params)}::jsonb, ${input.resultSummary.slice(0, 500)}, ${input.provider}, ${input.model},
              ${input.tokens}, ${input.subjectType}, ${input.subjectId})`);
  }

  async recent(tx: Tx, orgId: number, limit: number): Promise<AiCrmActionRow[]> {
    const res = await tx.execute(sql`
      SELECT tool, result_summary, created_at FROM ai_crm_actions
       WHERE org_id = ${orgId} AND status IN ('ok', 'confirmed')
       ORDER BY created_at DESC LIMIT ${limit}`);
    return res.rows as unknown as AiCrmActionRow[];
  }
}
