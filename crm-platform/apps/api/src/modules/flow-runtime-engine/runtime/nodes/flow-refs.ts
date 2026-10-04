import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infra/db/database.service';

/**
 * Template and AI assistant references a node carries. Reference saved integer ids; the editor on our stack saves UUIDs (and an old flow
 * still holds the integer), so a node's reference is either, and the executors that need the numeric row id resolve it here.
 */
export type FlowRef = { kind: 'id'; id: number } | { kind: 'uuid'; uuid: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive integer (a number or a digits-only string) or a UUID; anything else, a blank or a `0` is no reference. Pure. */
export function parseFlowRef(value: unknown): FlowRef | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? { kind: 'id', id: value } : null;
  }
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) {
    const id = Number(v);
    return Number.isSafeInteger(id) && id > 0 ? { kind: 'id', id } : null;
  }
  return UUID_RE.test(v) ? { kind: 'uuid', uuid: v.toLowerCase() } : null;
}

/** The first of these node fields that holds a usable reference (`assistant_id` the runtime's name, `assistant` the editor's). */
export function firstFlowRef(...values: unknown[]): FlowRef | null {
  for (const v of values) {
    const r = parseFlowRef(v);
    if (r) return r;
  }
  return null;
}

/**
 * Reference to numeric row id, scoped to ONE workspace inside a tenant transaction: a UUID of another workspace's row (or of no row)
 * resolves to 0, which every executor treats as "none chosen". An integer is returned as is (the executors' own reads are org-scoped,
 * so an old flow keeps its exact behaviour and costs no query).
 */
@Injectable()
export class FlowRefResolver {
  constructor(private readonly db: DatabaseService) {}

  assistantId(orgId: number, ref: FlowRef | null): Promise<number> {
    return this.resolve(orgId, ref, 'ai_chat_assistants');
  }

  templateId(orgId: number, ref: FlowRef | null): Promise<number> {
    return this.resolve(orgId, ref, 'wa_templates');
  }

  private async resolve(
    orgId: number,
    ref: FlowRef | null,
    table: 'ai_chat_assistants' | 'wa_templates',
  ): Promise<number> {
    if (!ref) return 0;
    if (ref.kind === 'id') return ref.id;
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(
        table === 'wa_templates'
          ? sql`SELECT id FROM wa_templates WHERE org_id = ${orgId} AND uuid = ${ref.uuid}::uuid`
          : sql`SELECT id FROM ai_chat_assistants WHERE org_id = ${orgId} AND uuid = ${ref.uuid}::uuid`,
      ),
    );
    const row = res.rows[0] as { id: number | string } | undefined;
    return row ? Number(row.id) || 0 : 0;
  }
}
