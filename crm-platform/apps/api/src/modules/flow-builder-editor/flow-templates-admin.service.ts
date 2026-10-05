import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  flbIsFlowType,
  type AdminFlowTemplate,
  type AdminFlowTemplateDetail,
  type AdminFlowTemplatesResponse,
  type CreateAdminFlowTemplateInput,
  type FlowType,
  type ListAdminFlowTemplatesQuery,
  type UpdateAdminFlowTemplateInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService } from '../auth';

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const COLUMNS = sql`
  t.id, t.uuid, t.name, t.description, t.flow_type, t.category, t.clone_count, t.sort_order, t.is_active, t.row_version,
  t.created_at, t.updated_at,
  coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(t.flow_data->'flowNodes') = 'array' THEN t.flow_data->'flowNodes' END), 0) AS steps
`;

const toTemplate = (r: Raw): AdminFlowTemplate => ({
  id: r.uuid as string,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  flowType: (flbIsFlowType(r.flow_type) ? r.flow_type : 'chat') as FlowType,
  category: (r.category as string | null) ?? null,
  steps: Number(r.steps),
  cloneCount: Number(r.clone_count),
  sortOrder: Number(r.sort_order),
  isActive: r.is_active as boolean,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string).toISOString(),
  updatedAt: new Date(r.updated_at as string).toISOString(),
});

/**
 * Unwraps what the form supplied the way Reference's `extractGraph` does: a `flow_data` object inside the export wrapper, else the
 * bare graph when it has a `flowNodes` key, else nothing (null: "no graph supplied", not an error). QUIRK kept: JSON that is
 * neither (`{"hello": 1}`) is treated as "nothing supplied", so a create asks for the flow again and an edit keeps the old one.
 */
function extractGraph(raw: unknown): unknown | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.flow_data) || Array.isArray(raw.flow_data)) return raw.flow_data;
  if (raw.flowNodes !== undefined && raw.flowNodes !== null) return raw;
  return null;
}

/** The stored shape of a template graph: `{ flowNodes, flowEdges (default []), vars }`, plain JSON, not normalised. */
function storedGraph(
  src: unknown,
): { flowNodes: unknown[]; flowEdges: unknown[]; vars: unknown[] } | null {
  if (!isRecord(src) || !Array.isArray(src.flowNodes)) return null;
  return {
    flowNodes: [...src.flowNodes],
    flowEdges: Array.isArray(src.flowEdges) ? [...src.flowEdges] : [],
    vars: Array.isArray(src.vars) ? [...src.vars] : [],
  };
}

/**
 * The platform's starter-template catalogue (TW-FLB-011, 012): list with stats, create / edit from an uploaded or pasted
 * export or by cloning an existing flow, show or hide, delete. Operators only; every write is one privileged transaction
 * that also records the security event.
 *
 * Rules kept from Reference: a create needs a graph (the form's three sources, precedence file, pasted JSON, flow id); an edit
 * keeps the current graph when none is sent; a graph without `flowNodes` is refused; the graph is stored as given (sender
 * ids and other workspace-bound ids inside it are copied into tenants' clones verbatim). Template flow types are the three
 * the form offers.
 */
@Injectable()
export class FlowTemplatesAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuthAuditService,
  ) {}

  async list(query: ListAdminFlowTemplatesQuery): Promise<AdminFlowTemplatesResponse> {
    return this.db.privileged(async (tx) => {
      const cur = query.cursor ? decodeCursor(query.cursor) : null;
      const res = await tx.execute(sql`
        SELECT ${COLUMNS} FROM flow_templates t
        ${cur ? sql`WHERE (t.sort_order > ${cur.sortOrder} OR (t.sort_order = ${cur.sortOrder} AND t.id < ${cur.id}))` : sql``}
        ORDER BY t.sort_order ASC, t.id DESC LIMIT ${query.limit + 1}
      `);
      const rows = res.rows as Raw[];
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const lastKey = items[items.length - 1];
      const stats = await tx.execute(sql`
        SELECT count(*) AS total, count(*) FILTER (WHERE is_active) AS visible, coalesce(sum(clone_count), 0) AS cloned
        FROM flow_templates
      `);
      const s = stats.rows[0] as Raw;
      return {
        data: items.map(toTemplate),
        page: {
          nextCursor:
            hasMore && lastKey
              ? encodeCursor(Number(lastKey.sort_order), Number(lastKey.id))
              : null,
          hasMore,
          limit: query.limit,
        },
        stats: { total: Number(s.total), visible: Number(s.visible), cloned: Number(s.cloned) },
      };
    });
  }

  async get(uuid: string): Promise<AdminFlowTemplateDetail> {
    return this.db.privileged(async (tx) => this.detail(tx, uuid));
  }

  async create(input: CreateAdminFlowTemplateInput): Promise<AdminFlowTemplateDetail> {
    const operator = this.operatorId();
    return this.db.privileged(async (tx) => {
      const graph = await this.graphFrom(tx, input.payload, input.sourceFlowId);
      if (!graph) {
        throw new AppError(
          ERROR_CODES.FLB_TEMPLATE_GRAPH_REQUIRED,
          'Provide the flow — upload an exported .json, paste the JSON, or enter an existing flow id to clone.',
          422,
          [
            {
              path: 'flow_json',
              message:
                'Provide the flow — upload an exported .json, paste the JSON, or enter an existing flow id to clone.',
            },
          ],
        );
      }
      const res = await tx.execute(sql`
        INSERT INTO flow_templates (name, description, flow_type, category, flow_data, is_active, sort_order, created_by)
        VALUES (${input.name}, ${input.description?.trim() || null}, ${input.flowType}, ${input.category?.trim() || null},
          ${JSON.stringify(graph)}::jsonb, ${input.isActive}, ${input.sortOrder}, ${operator})
        RETURNING uuid
      `);
      const uuid = (res.rows[0] as Raw).uuid as string;
      await this.record(tx, 'platform.flow_template.created', uuid, { name: input.name });
      return this.detail(tx, uuid);
    });
  }

  async update(
    uuid: string,
    input: UpdateAdminFlowTemplateInput,
  ): Promise<AdminFlowTemplateDetail> {
    return this.db.privileged(async (tx) => {
      const cur = await tx.execute(
        sql`SELECT id, row_version FROM flow_templates WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const row = cur.rows[0] as Raw | undefined;
      if (!row) throw AppError.notFound('Template', uuid);
      if (Number(row.row_version) !== input.rowVersion)
        throw AppError.rowVersionConflict('Template');
      // On edit the graph is optional: nothing sent keeps the current one.
      const graph = await this.graphFrom(tx, input.payload, input.sourceFlowId);
      await tx.execute(sql`
        UPDATE flow_templates SET name = ${input.name}, description = ${input.description?.trim() || null},
          flow_type = ${input.flowType}, category = ${input.category?.trim() || null},
          sort_order = ${input.sortOrder}, is_active = ${input.isActive}
          ${graph ? sql`, flow_data = ${JSON.stringify(graph)}::jsonb` : sql``}
        WHERE id = ${Number(row.id)}
      `);
      await this.record(tx, 'platform.flow_template.updated', uuid, {
        name: input.name,
        graphReplaced: !!graph,
      });
      return this.detail(tx, uuid);
    });
  }

  async toggle(uuid: string): Promise<AdminFlowTemplate> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`UPDATE flow_templates SET is_active = NOT is_active WHERE uuid = ${uuid} RETURNING is_active`,
      );
      const row = res.rows[0] as Raw | undefined;
      if (!row) throw AppError.notFound('Template', uuid);
      await this.record(tx, 'platform.flow_template.toggled', uuid, { isActive: row.is_active });
      return (await this.detail(tx, uuid)) as AdminFlowTemplate;
    });
  }

  /** Hard delete; tenants who already cloned it keep their copy (a clone is an ordinary flow). */
  async remove(uuid: string): Promise<void> {
    await this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM flow_templates WHERE uuid = ${uuid} RETURNING uuid`,
      );
      if (res.rows.length === 0) throw AppError.notFound('Template', uuid);
      await this.record(tx, 'platform.flow_template.deleted', uuid, {});
    });
  }

  // --- internals -----------------------------------------------------------------------------------------------------

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  private async detail(tx: Tx, uuid: string): Promise<AdminFlowTemplateDetail> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS}, t.flow_data FROM flow_templates t WHERE t.uuid = ${uuid}`,
    );
    const r = res.rows[0] as Raw | undefined;
    if (!r) throw AppError.notFound('Template', uuid);
    const g = (r.flow_data ?? {}) as Partial<Record<'flowNodes' | 'flowEdges' | 'vars', Raw[]>>;
    return {
      ...toTemplate(r),
      graph: {
        flowNodes: Array.isArray(g.flowNodes) ? g.flowNodes : [],
        flowEdges: Array.isArray(g.flowEdges) ? g.flowEdges : [],
        vars: Array.isArray(g.vars) ? g.vars : [],
      },
    };
  }

  /**
   * Graph source precedence: the uploaded or pasted payload, then a flow to clone (any workspace: the operator is
   * platform-wide). Null when neither was supplied or what was supplied cannot be read as a graph at all; throws when it is a
   * graph without a `flowNodes` array.
   */
  private async graphFrom(
    tx: Tx,
    payload: Record<string, unknown> | undefined,
    sourceFlowId: string | undefined,
  ) {
    const invalid = () =>
      new AppError(
        ERROR_CODES.FLB_IMPORT_INVALID,
        "That doesn't look like a valid flow (missing flowNodes).",
        422,
        [
          {
            path: 'flow_json',
            message: "That doesn't look like a valid flow (missing flowNodes).",
          },
        ],
      );
    if (payload !== undefined) {
      const src = extractGraph(payload);
      if (src === null) return null;
      const g = storedGraph(src);
      if (!g) throw invalid();
      return g;
    }
    if (sourceFlowId) {
      const res = await tx.execute(sql`SELECT flow_data FROM flows WHERE uuid = ${sourceFlowId}`);
      const row = res.rows[0] as Raw | undefined;
      // A flow id that matches nothing is "no graph supplied" (Reference's `Flow::find` returned null).
      if (!row) return null;
      const g = storedGraph(row.flow_data);
      if (!g) throw invalid();
      return g;
    }
    return null;
  }

  private async record(
    tx: Tx,
    event: string,
    uuid: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      event,
      status: 'success',
      payload: { template: uuid, ...payload },
    });
  }
}

const encodeCursor = (sortOrder: number, id: number) =>
  Buffer.from(`${sortOrder}|${id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): { sortOrder: number; id: number } {
  const [a, b] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!a || !b || !/^\d+$/.test(a) || !/^\d+$/.test(b)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
  return { sortOrder: Number(a), id: Number(b) };
}
