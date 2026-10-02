import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { StageKind } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface PipelineRow {
  id: number;
  uuid: string;
  name: string;
  currency: string;
  isDefault: boolean;
  sortOrder: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  dealCount: number;
}

export interface StageRow {
  id: number;
  uuid: string;
  pipelineId: number;
  pipelineUuid: string;
  name: string;
  color: string;
  probability: number;
  kind: StageKind;
  sortOrder: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  dealCount: number;
}

export interface LostReasonRow {
  id: number;
  uuid: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  dealCount: number;
}

type Raw = Record<string, unknown>;

const toPipeline = (r: Raw): PipelineRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  currency: r.currency as string,
  isDefault: r.is_default as boolean,
  sortOrder: Number(r.sort_order),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  dealCount: Number(r.deal_count ?? 0),
});

const toStage = (r: Raw): StageRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  pipelineId: Number(r.pipeline_id),
  pipelineUuid: r.pipeline_uuid as string,
  name: r.name as string,
  color: r.color as string,
  probability: Number(r.probability),
  kind: r.is_won ? 'won' : r.is_lost ? 'lost' : 'open',
  sortOrder: Number(r.sort_order),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  dealCount: Number(r.deal_count ?? 0),
});

const toReason = (r: Raw): LostReasonRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  sortOrder: Number(r.sort_order),
  isActive: r.is_active as boolean,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  dealCount: Number(r.deal_count ?? 0),
});

const PIPELINE_SELECT = sql`
  SELECT p.id, p.uuid, p.name, p.currency, p.is_default, p.sort_order, p.row_version, p.created_at, p.updated_at,
         (SELECT count(*) FROM deals d WHERE d.org_id = p.org_id AND d.pipeline_id = p.id)::int AS deal_count
  FROM pipelines p
`;

const STAGE_SELECT = sql`
  SELECT s.id, s.uuid, s.pipeline_id, p.uuid AS pipeline_uuid, s.name, s.color, s.probability, s.is_won, s.is_lost,
         s.sort_order, s.row_version, s.created_at, s.updated_at,
         (SELECT count(*) FROM deals d WHERE d.org_id = s.org_id AND d.stage_id = s.id)::int AS deal_count
  FROM pipeline_stages s
  JOIN pipelines p ON p.org_id = s.org_id AND p.id = s.pipeline_id
`;

export const DEFAULT_LADDER: Array<{
  name: string;
  color: string;
  probability: number;
  kind: StageKind;
}> = [
  { name: 'New Lead', color: '#64748B', probability: 10, kind: 'open' },
  { name: 'Qualified', color: '#0EA5E9', probability: 25, kind: 'open' },
  { name: 'Proposal', color: '#6366F1', probability: 50, kind: 'open' },
  { name: 'Negotiation', color: '#F59E0B', probability: 75, kind: 'open' },
  { name: 'Won', color: '#16A34A', probability: 100, kind: 'won' },
  { name: 'Lost', color: '#DC2626', probability: 0, kind: 'lost' },
];

/** Data access for pipelines, their stages, the lost-reason catalogue and the deal settings. */
@Injectable()
export class PipelinesRepository {
  // --- pipelines -------------------------------------------------------------------------------------------------------

  async listPipelines(tx: Tx, orgId: number): Promise<PipelineRow[]> {
    const res = await tx.execute(
      sql`${PIPELINE_SELECT} WHERE p.org_id = ${orgId} ORDER BY p.sort_order, p.id`,
    );
    return (res.rows as Raw[]).map(toPipeline);
  }

  async pipelineByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<PipelineRow | undefined> {
    const res = await tx.execute(
      sql`${PIPELINE_SELECT} WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE OF p` : sql``}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toPipeline(r) : undefined;
  }

  async pipelineById(tx: Tx, orgId: number, id: number): Promise<PipelineRow | undefined> {
    const res = await tx.execute(
      sql`${PIPELINE_SELECT} WHERE p.org_id = ${orgId} AND p.id = ${id}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toPipeline(r) : undefined;
  }

  async defaultPipeline(tx: Tx, orgId: number): Promise<PipelineRow | undefined> {
    const res = await tx.execute(
      sql`${PIPELINE_SELECT} WHERE p.org_id = ${orgId} ORDER BY p.is_default DESC, p.sort_order, p.id LIMIT 1`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toPipeline(r) : undefined;
  }

  async countPipelines(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM pipelines WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async maxPipelineOrder(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(sort_order), -1)::int AS m FROM pipelines WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { m: number }).m);
  }

  async clearDefault(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE pipelines SET is_default = false WHERE org_id = ${orgId} AND is_default`,
    );
  }

  async insertPipeline(
    tx: Tx,
    orgId: number,
    v: { name: string; currency: string; isDefault: boolean; sortOrder: number },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO pipelines (org_id, name, currency, is_default, sort_order)
      VALUES (${orgId}, ${v.name}, ${v.currency}, ${v.isDefault}, ${v.sortOrder})
      RETURNING id, uuid
    `);
    const r = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(r.id), uuid: r.uuid };
  }

  async updatePipeline(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: { name?: string; currency?: string; isDefault?: boolean },
  ): Promise<boolean> {
    const sets = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.currency !== undefined) sets.push(sql`currency = ${patch.currency}`);
    if (patch.isDefault !== undefined) sets.push(sql`is_default = ${patch.isDefault}`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE pipelines SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async setPipelineOrder(tx: Tx, orgId: number, ids: number[]): Promise<void> {
    await tx.execute(sql`
      UPDATE pipelines p SET sort_order = o.ord
      FROM unnest(${sql.raw(`ARRAY[${ids.map(Number).join(',')}]::bigint[]`)}) WITH ORDINALITY AS o(id, ord)
      WHERE p.org_id = ${orgId} AND p.id = o.id
    `);
  }

  async deletePipeline(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM pipelines WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- stages ----------------------------------------------------------------------------------------------------------

  async stagesOf(tx: Tx, orgId: number, pipelineIds: number[]): Promise<StageRow[]> {
    if (pipelineIds.length === 0) return [];
    const res = await tx.execute(sql`
      ${STAGE_SELECT}
      WHERE s.org_id = ${orgId} AND s.pipeline_id IN (${sql.join(
        pipelineIds.map((i) => sql`${i}`),
        sql`, `,
      )})
      ORDER BY s.pipeline_id, s.sort_order, s.id
    `);
    return (res.rows as Raw[]).map(toStage);
  }

  async stageByUuid(tx: Tx, orgId: number, uuid: string): Promise<StageRow | undefined> {
    const res = await tx.execute(
      sql`${STAGE_SELECT} WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toStage(r) : undefined;
  }

  async stageById(tx: Tx, orgId: number, id: number): Promise<StageRow | undefined> {
    const res = await tx.execute(sql`${STAGE_SELECT} WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toStage(r) : undefined;
  }

  /** The pipeline's stage of a kind: the first open one by order, or its single won / lost stage. */
  async stageOfKind(
    tx: Tx,
    orgId: number,
    pipelineId: number,
    kind: StageKind,
  ): Promise<StageRow | undefined> {
    const cond =
      kind === 'won'
        ? sql`s.is_won`
        : kind === 'lost'
          ? sql`s.is_lost`
          : sql`NOT s.is_won AND NOT s.is_lost`;
    const res = await tx.execute(sql`
      ${STAGE_SELECT} WHERE s.org_id = ${orgId} AND s.pipeline_id = ${pipelineId} AND ${cond}
      ORDER BY s.sort_order, s.id LIMIT 1
    `);
    const r = (res.rows as Raw[])[0];
    return r ? toStage(r) : undefined;
  }

  /** The first open stage, else the first stage of any kind (a pipeline made only of won/lost). */
  async firstStage(tx: Tx, orgId: number, pipelineId: number): Promise<StageRow | undefined> {
    return (
      (await this.stageOfKind(tx, orgId, pipelineId, 'open')) ??
      (await this.stagesOf(tx, orgId, [pipelineId]))[0]
    );
  }

  async insertStage(
    tx: Tx,
    orgId: number,
    v: {
      pipelineId: number;
      name: string;
      color: string;
      probability: number;
      kind: StageKind;
      sortOrder: number;
    },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO pipeline_stages (org_id, pipeline_id, name, sort_order, color, is_won, is_lost, probability)
      VALUES (${orgId}, ${v.pipelineId}, ${v.name}, ${v.sortOrder}, ${v.color}, ${v.kind === 'won'}, ${v.kind === 'lost'}, ${v.probability})
      RETURNING id, uuid
    `);
    const r = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(r.id), uuid: r.uuid };
  }

  async updateStage(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: { name?: string; color?: string; probability?: number; kind?: StageKind },
  ): Promise<boolean> {
    const sets = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.color !== undefined) sets.push(sql`color = ${patch.color}`);
    if (patch.probability !== undefined) sets.push(sql`probability = ${patch.probability}`);
    if (patch.kind !== undefined) {
      sets.push(sql`is_won = ${patch.kind === 'won'}`, sql`is_lost = ${patch.kind === 'lost'}`);
    }
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE pipeline_stages SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  /** Renumbers a whole ladder 0..n-1 in the given order. */
  async setStageOrder(tx: Tx, orgId: number, pipelineId: number, ids: number[]): Promise<void> {
    await tx.execute(sql`
      UPDATE pipeline_stages s SET sort_order = o.ord - 1
      FROM unnest(${sql.raw(`ARRAY[${ids.map(Number).join(',')}]::bigint[]`)}) WITH ORDINALITY AS o(id, ord)
      WHERE s.org_id = ${orgId} AND s.pipeline_id = ${pipelineId} AND s.id = o.id
    `);
  }

  async deleteStage(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM pipeline_stages WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async dealIdsInStage(tx: Tx, orgId: number, stageId: number): Promise<number[]> {
    const res = await tx.execute(
      sql`SELECT id FROM deals WHERE org_id = ${orgId} AND stage_id = ${stageId} ORDER BY sort_order, id DESC`,
    );
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  // --- lost reasons ----------------------------------------------------------------------------------------------------

  private readonly reasonSelect = sql`
    SELECT r.id, r.uuid, r.name, r.sort_order, r.is_active, r.row_version, r.created_at, r.updated_at,
           (SELECT count(*) FROM deals d WHERE d.org_id = r.org_id AND d.lost_reason_id = r.id)::int AS deal_count
    FROM deal_lost_reasons r
  `;

  async listReasons(tx: Tx, orgId: number, activeOnly: boolean): Promise<LostReasonRow[]> {
    const res = await tx.execute(sql`
      ${this.reasonSelect} WHERE r.org_id = ${orgId} ${activeOnly ? sql`AND r.is_active` : sql``}
      ORDER BY r.sort_order, r.id
    `);
    return (res.rows as Raw[]).map(toReason);
  }

  async reasonByUuid(tx: Tx, orgId: number, uuid: string): Promise<LostReasonRow | undefined> {
    const res = await tx.execute(
      sql`${this.reasonSelect} WHERE r.org_id = ${orgId} AND r.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toReason(r) : undefined;
  }

  async reasonByName(tx: Tx, orgId: number, name: string): Promise<LostReasonRow | undefined> {
    const res = await tx.execute(
      sql`${this.reasonSelect} WHERE r.org_id = ${orgId} AND lower(btrim(r.name)) = lower(btrim(${name}))`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toReason(r) : undefined;
  }

  async maxReasonOrder(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(sort_order), -1)::int AS m FROM deal_lost_reasons WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { m: number }).m);
  }

  async insertReason(
    tx: Tx,
    orgId: number,
    v: { name: string; isActive: boolean; sortOrder: number },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO deal_lost_reasons (org_id, name, is_active, sort_order)
      VALUES (${orgId}, ${v.name}, ${v.isActive}, ${v.sortOrder}) RETURNING id, uuid
    `);
    const r = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(r.id), uuid: r.uuid };
  }

  async updateReason(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: { name?: string; isActive?: boolean },
  ): Promise<boolean> {
    const sets = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.isActive !== undefined) sets.push(sql`is_active = ${patch.isActive}`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE deal_lost_reasons SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion} RETURNING id
    `);
    return res.rows.length > 0;
  }

  async setReasonOrder(tx: Tx, orgId: number, ids: number[]): Promise<void> {
    await tx.execute(sql`
      UPDATE deal_lost_reasons r SET sort_order = o.ord
      FROM unnest(${sql.raw(`ARRAY[${ids.map(Number).join(',')}]::bigint[]`)}) WITH ORDINALITY AS o(id, ord)
      WHERE r.org_id = ${orgId} AND r.id = o.id
    `);
  }

  async deleteReason(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM deal_lost_reasons WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- settings --------------------------------------------------------------------------------------------------------

  async settings(
    tx: Tx,
    orgId: number,
  ): Promise<{ lostReasonRequired: boolean; rowVersion: number }> {
    const res = await tx.execute(
      sql`SELECT lost_reason_required, row_version FROM deal_settings WHERE org_id = ${orgId}`,
    );
    const r = res.rows[0] as { lost_reason_required: boolean; row_version: number } | undefined;
    return {
      lostReasonRequired: r?.lost_reason_required ?? false,
      rowVersion: Number(r?.row_version ?? 0),
    };
  }

  async saveSettings(tx: Tx, orgId: number, lostReasonRequired: boolean): Promise<void> {
    await tx.execute(sql`
      INSERT INTO deal_settings (org_id, lost_reason_required) VALUES (${orgId}, ${lostReasonRequired})
      ON CONFLICT (org_id) DO UPDATE SET lost_reason_required = EXCLUDED.lost_reason_required
    `);
  }
}
