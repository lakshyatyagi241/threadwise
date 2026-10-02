import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type DealSource,
  type DealStatus,
  type RecordScope,
  type StageKind,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor } from '../../../common/pagination/cursor';

/** What a deal looks like after the joins every read needs. Ids here are internal and never leave the mapper. */
export interface DealRow {
  id: number;
  uuid: string;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  valueMinor: bigint;
  currency: string;
  status: DealStatus;
  source: DealSource;
  lostReason: string | null;
  lostReasonId: number | null;
  lostReasonUuid: string | null;
  notes: string | null;
  expectedCloseDate: string | null;
  sortOrder: bigint;
  wonAt: Date | null;
  lostAt: Date | null;
  rowVersion: number;
  pipelineId: number;
  pipelineUuid: string;
  pipelineName: string;
  stageId: number;
  stageUuid: string;
  stageName: string;
  stageColor: string;
  stageProbability: number;
  stageKind: StageKind;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  companyId: number | null;
  companyUuid: string | null;
  companyName: string | null;
}

interface RawDeal {
  id: number | string;
  uuid: string;
  created_at_iso: string;
  created_at: Date | string;
  updated_at: Date | string;
  title: string;
  value_minor: string;
  currency: string;
  status: DealStatus;
  source: DealSource;
  lost_reason: string | null;
  lost_reason_id: number | string | null;
  lost_reason_uuid: string | null;
  notes: string | null;
  expected_close_date: string | null;
  sort_order: string;
  won_at: Date | string | null;
  lost_at: Date | string | null;
  row_version: number;
  pipeline_id: number | string;
  pipeline_uuid: string;
  pipeline_name: string;
  stage_id: number | string;
  stage_uuid: string;
  stage_name: string;
  stage_color: string;
  stage_probability: number;
  stage_is_won: boolean;
  stage_is_lost: boolean;
  owner_id: number | string | null;
  owner_uuid: string | null;
  owner_name: string | null;
  contact_id: number | string | null;
  contact_uuid: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  company_id: number | string | null;
  company_uuid: string | null;
  company_name: string | null;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));
const date = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

export function toDealRow(r: RawDeal): DealRow {
  return {
    id: Number(r.id),
    uuid: r.uuid,
    createdAtIso: r.created_at_iso,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    title: r.title,
    valueMinor: BigInt(r.value_minor),
    currency: r.currency,
    status: r.status,
    source: r.source,
    lostReason: r.lost_reason,
    lostReasonId: num(r.lost_reason_id),
    lostReasonUuid: r.lost_reason_uuid,
    notes: r.notes,
    expectedCloseDate: r.expected_close_date,
    sortOrder: BigInt(r.sort_order),
    wonAt: date(r.won_at),
    lostAt: date(r.lost_at),
    rowVersion: Number(r.row_version),
    pipelineId: Number(r.pipeline_id),
    pipelineUuid: r.pipeline_uuid,
    pipelineName: r.pipeline_name,
    stageId: Number(r.stage_id),
    stageUuid: r.stage_uuid,
    stageName: r.stage_name,
    stageColor: r.stage_color,
    stageProbability: Number(r.stage_probability),
    stageKind: r.stage_is_won ? 'won' : r.stage_is_lost ? 'lost' : 'open',
    ownerId: num(r.owner_id),
    ownerUuid: r.owner_uuid,
    ownerName: r.owner_name,
    contactId: num(r.contact_id),
    contactUuid: r.contact_uuid,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    companyId: num(r.company_id),
    companyUuid: r.company_uuid,
    companyName: r.company_name,
  };
}

/** The filters every deal list shares, with every uuid already resolved to the internal id the SQL needs. */
export interface DealFilter {
  q?: string;
  ownerId?: number;
  unassigned?: boolean;
  contactId?: number;
  companyId?: number;
  source?: string;
  pipelineId?: number;
  stageId?: number;
  status?: DealStatus;
  currency?: string;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Record scope as a condition on the deal's owner; 'all' adds nothing. */
export function dealScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  if (scope === 'own') return sql`d.owner_user_id = ${actorUserId}`;
  return sql`d.owner_user_id IN (
    SELECT tm2.user_id FROM team_members tm1
    JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
    WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId}
  )`;
}

/** WHERE conditions for a filter, against the `d`, `c` (contact) and `co` (company) aliases of `FROM_JOINS`. */
export function dealConditions(orgId: number, f: DealFilter, scope?: SQL): SQL[] {
  const conds: SQL[] = [sql`d.org_id = ${orgId}`];
  if (scope) conds.push(scope);
  if (f.pipelineId !== undefined) conds.push(sql`d.pipeline_id = ${f.pipelineId}`);
  if (f.stageId !== undefined) conds.push(sql`d.stage_id = ${f.stageId}`);
  if (f.status) conds.push(sql`d.status = ${f.status}`);
  if (f.currency) conds.push(sql`d.currency = ${f.currency}`);
  if (f.source) conds.push(sql`d.source = ${f.source}`);
  if (f.ownerId !== undefined) conds.push(sql`d.owner_user_id = ${f.ownerId}`);
  if (f.unassigned) conds.push(sql`d.owner_user_id IS NULL`);
  if (f.contactId !== undefined) conds.push(sql`d.contact_id = ${f.contactId}`);
  if (f.companyId !== undefined) conds.push(sql`d.company_id = ${f.companyId}`);
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(sql`(d.title ILIKE ${like} OR c.name ILIKE ${like} OR co.name ILIKE ${like})`);
  }
  return conds;
}

const SELECT_COLS = sql`
  d.id, d.uuid,
  to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
  d.created_at, d.updated_at, d.title, d.value_minor::text AS value_minor, d.currency, d.status, d.source,
  d.lost_reason, d.lost_reason_id, lr.uuid AS lost_reason_uuid, d.notes,
  to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date,
  d.sort_order::text AS sort_order, d.won_at, d.lost_at, d.row_version,
  d.pipeline_id, p.uuid AS pipeline_uuid, p.name AS pipeline_name,
  d.stage_id, s.uuid AS stage_uuid, s.name AS stage_name, s.color AS stage_color,
  s.probability AS stage_probability, s.is_won AS stage_is_won, s.is_lost AS stage_is_lost,
  d.owner_user_id AS owner_id, u.uuid AS owner_uuid, u.full_name AS owner_name,
  d.contact_id, c.uuid AS contact_uuid, c.name AS contact_name, c.phone AS contact_phone, c.email::text AS contact_email,
  d.company_id, co.uuid AS company_uuid, co.name AS company_name
`;

const FROM_JOINS = sql`
  FROM deals d
  JOIN pipelines p ON p.org_id = d.org_id AND p.id = d.pipeline_id
  JOIN pipeline_stages s ON s.org_id = d.org_id AND s.id = d.stage_id
  LEFT JOIN users u ON u.org_id = d.org_id AND u.id = d.owner_user_id
  LEFT JOIN contacts c ON c.org_id = d.org_id AND c.id = d.contact_id
  LEFT JOIN companies co ON co.org_id = d.org_id AND co.id = d.company_id
  LEFT JOIN deal_lost_reasons lr ON lr.org_id = d.org_id AND lr.id = d.lost_reason_id
`;

const where = (conds: SQL[]) => sql.join(conds, sql` AND `);

/** Columns a PATCH may set, by their SQL names. */
export interface DealPatch {
  title?: string;
  value_minor?: bigint;
  currency?: string;
  owner_user_id?: number | null;
  contact_id?: number | null;
  company_id?: number | null;
  expected_close_date?: string | null;
  notes?: string | null;
  pipeline_id?: number;
  stage_id?: number;
  status?: DealStatus;
  won_at?: Date | null;
  lost_at?: Date | null;
  lost_reason?: string | null;
  lost_reason_id?: number | null;
  sort_order?: bigint;
}

export interface StageTotalRow {
  stageId: number;
  currency: string;
  count: number;
  sumMinor: bigint;
}

export interface NewDeal {
  pipelineId: number;
  stageId: number;
  contactId: number | null;
  companyId: number | null;
  title: string;
  valueMinor: bigint;
  currency: string;
  ownerUserId: number | null;
  expectedCloseDate: string | null;
  status: DealStatus;
  lostReason: string | null;
  source: DealSource;
  sortOrder: bigint;
  notes: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
}

/**
 * Data access for deals. Raw SQL on purpose: every read is the same wide join (stage, pipeline, owner, contact, company) and
 * the board, list, reports and timeline all build their WHERE from the same condition list, so what the board counts is
 * what the list shows.
 */
@Injectable()
export class DealsRepository {
  // --- reads -----------------------------------------------------------------------------------------------------------

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<DealRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${SELECT_COLS} ${FROM_JOINS}
      WHERE d.org_id = ${orgId} AND d.uuid = ${uuid}::uuid
      ${forUpdate ? sql`FOR UPDATE OF d` : sql``}
    `);
    const row = (res.rows as unknown as RawDeal[])[0];
    return row ? toDealRow(row) : undefined;
  }

  async findById(
    tx: Tx,
    orgId: number,
    id: number,
    forUpdate = false,
  ): Promise<DealRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${SELECT_COLS} ${FROM_JOINS}
      WHERE d.org_id = ${orgId} AND d.id = ${id}
      ${forUpdate ? sql`FOR UPDATE OF d` : sql``}
    `);
    const row = (res.rows as unknown as RawDeal[])[0];
    return row ? toDealRow(row) : undefined;
  }

  /** `limit + 1` rows, newest first (or oldest), keyset over (created_at, id) at microsecond precision. */
  async list(
    tx: Tx,
    orgId: number,
    input: {
      filter: DealFilter;
      scope?: SQL;
      cursor?: string;
      limit: number;
      order: 'asc' | 'desc';
    },
  ): Promise<DealRow[]> {
    const conds = dealConditions(orgId, input.filter, input.scope);
    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      const bound = sql`${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz`;
      conds.push(
        input.order === 'desc'
          ? sql`(d.created_at < ${bound} OR (d.created_at = ${bound} AND d.id < ${c.id}))`
          : sql`(d.created_at > ${bound} OR (d.created_at = ${bound} AND d.id > ${c.id}))`,
      );
    }
    const dir = input.order === 'desc' ? sql`DESC` : sql`ASC`;
    const res = await tx.execute(sql`
      SELECT ${SELECT_COLS} ${FROM_JOINS}
      WHERE ${where(conds)}
      ORDER BY d.created_at ${dir}, d.id ${dir}
      LIMIT ${input.limit + 1}
    `);
    return (res.rows as unknown as RawDeal[]).map(toDealRow);
  }

  /**
   * One column of the board, in manual order (sort_order, then newest). The cursor is `sort_order|id`, a pair with no ties,
   * so a page boundary never repeats or drops a card. `limit + 1` rows.
   */
  async stagePage(
    tx: Tx,
    orgId: number,
    input: { stageId: number; filter: DealFilter; scope?: SQL; cursor?: string; limit: number },
  ): Promise<DealRow[]> {
    const conds = dealConditions(orgId, { ...input.filter, stageId: input.stageId }, input.scope);
    if (input.cursor) {
      const [so, id] = decodeStageCursor(input.cursor);
      conds.push(
        sql`(d.sort_order > ${so.toString()}::bigint OR (d.sort_order = ${so.toString()}::bigint AND d.id < ${id}))`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${SELECT_COLS} ${FROM_JOINS}
      WHERE ${where(conds)}
      ORDER BY d.sort_order ASC, d.id DESC
      LIMIT ${input.limit + 1}
    `);
    return (res.rows as unknown as RawDeal[]).map(toDealRow);
  }

  /** Count and value per stage and currency for a whole pipeline, with the board's filters. */
  async stageTotals(
    tx: Tx,
    orgId: number,
    input: { pipelineId: number; filter: DealFilter; scope?: SQL },
  ): Promise<StageTotalRow[]> {
    const conds = dealConditions(
      orgId,
      { ...input.filter, pipelineId: input.pipelineId },
      input.scope,
    );
    const res = await tx.execute(sql`
      SELECT d.stage_id, d.currency, count(*)::int AS n, sum(d.value_minor)::text AS total
      FROM deals d
      LEFT JOIN contacts c ON c.org_id = d.org_id AND c.id = d.contact_id
      LEFT JOIN companies co ON co.org_id = d.org_id AND co.id = d.company_id
      WHERE ${where(conds)}
      GROUP BY d.stage_id, d.currency
    `);
    return (
      res.rows as unknown as Array<{
        stage_id: number | string;
        currency: string;
        n: number;
        total: string;
      }>
    ).map((r) => ({
      stageId: Number(r.stage_id),
      currency: r.currency,
      count: Number(r.n),
      sumMinor: BigInt(r.total),
    }));
  }

  /** A contact's deals, open first then newest, at most `limit`. */
  async forContact(tx: Tx, orgId: number, contactId: number, limit: number): Promise<DealRow[]> {
    const res = await tx.execute(sql`
      SELECT ${SELECT_COLS} ${FROM_JOINS}
      WHERE d.org_id = ${orgId} AND d.contact_id = ${contactId}
      ORDER BY (d.status = 'open') DESC, d.created_at DESC, d.id DESC
      LIMIT ${limit}
    `);
    return (res.rows as unknown as RawDeal[]).map(toDealRow);
  }

  /** Open and won counts and sums per currency for a contact (the contact 360 rollup). */
  async contactRollup(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<Array<{ status: string; currency: string; n: number; total: bigint }>> {
    const res = await tx.execute(sql`
      SELECT status, currency, count(*)::int AS n, sum(value_minor)::text AS total
      FROM deals
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status IN ('open', 'won')
      GROUP BY status, currency
    `);
    return (
      res.rows as unknown as Array<{ status: string; currency: string; n: number; total: string }>
    ).map((r) => ({
      status: r.status,
      currency: r.currency,
      n: Number(r.n),
      total: BigInt(r.total),
    }));
  }

  // --- writes ----------------------------------------------------------------------------------------------------------

  async insert(tx: Tx, orgId: number, v: NewDeal): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO deals (org_id, pipeline_id, stage_id, contact_id, company_id, title, value_minor, currency,
                         owner_user_id, expected_close_date, status, lost_reason, source, sort_order, notes, won_at, lost_at)
      VALUES (${orgId}, ${v.pipelineId}, ${v.stageId}, ${v.contactId}, ${v.companyId}, ${v.title},
              ${v.valueMinor.toString()}::bigint, ${v.currency}, ${v.ownerUserId}, ${v.expectedCloseDate}::date,
              ${v.status}, ${v.lostReason}, ${v.source}, ${v.sortOrder.toString()}::bigint, ${v.notes},
              ${v.wonAt}, ${v.lostAt})
      RETURNING id, uuid
    `);
    const row = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(row.id), uuid: row.uuid };
  }

  /**
   * Optimistic update. With `expectedVersion`, zero rows means somebody else committed first; without it the write is
   * unconditional (a server-side move that has just locked the row).
   */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number | undefined,
    patch: DealPatch,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    const add = (col: string, value: unknown, cast = '') =>
      sets.push(sql`${sql.raw(col)} = ${value}${cast ? sql.raw(cast) : sql``}`);
    if (patch.title !== undefined) add('title', patch.title);
    if (patch.value_minor !== undefined)
      add('value_minor', patch.value_minor.toString(), '::bigint');
    if (patch.currency !== undefined) add('currency', patch.currency);
    if (patch.owner_user_id !== undefined) add('owner_user_id', patch.owner_user_id);
    if (patch.contact_id !== undefined) add('contact_id', patch.contact_id);
    if (patch.company_id !== undefined) add('company_id', patch.company_id);
    if (patch.expected_close_date !== undefined)
      add('expected_close_date', patch.expected_close_date, '::date');
    if (patch.notes !== undefined) add('notes', patch.notes);
    if (patch.pipeline_id !== undefined) add('pipeline_id', patch.pipeline_id);
    if (patch.stage_id !== undefined) add('stage_id', patch.stage_id);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.won_at !== undefined) add('won_at', patch.won_at);
    if (patch.lost_at !== undefined) add('lost_at', patch.lost_at);
    if (patch.lost_reason !== undefined) add('lost_reason', patch.lost_reason);
    if (patch.lost_reason_id !== undefined) add('lost_reason_id', patch.lost_reason_id);
    if (patch.sort_order !== undefined) add('sort_order', patch.sort_order.toString(), '::bigint');
    // an empty patch still has to be a valid UPDATE: it just touches the row
    if (sets.length === 0) sets.push(sql`updated_at = now()`);

    const res = await tx.execute(sql`
      UPDATE deals SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
      ${expectedVersion !== undefined ? sql`AND row_version = ${expectedVersion}` : sql``}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM deals WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  // --- order inside a column -------------------------------------------------------------------------------------------

  async minOrder(
    tx: Tx,
    orgId: number,
    stageId: number,
    excludeId?: number,
  ): Promise<bigint | null> {
    const res = await tx.execute(sql`
      SELECT min(sort_order)::text AS m FROM deals
      WHERE org_id = ${orgId} AND stage_id = ${stageId}
      ${excludeId !== undefined ? sql`AND id <> ${excludeId}` : sql``}
    `);
    const m = (res.rows[0] as { m: string | null }).m;
    return m === null ? null : BigInt(m);
  }

  /** A card of the column (any status) for use as a drop anchor. */
  async anchor(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; stageId: number; sortOrder: bigint } | undefined> {
    const res = await tx.execute(sql`
      SELECT id, stage_id, sort_order::text AS sort_order FROM deals WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid
    `);
    const r = res.rows[0] as
      { id: number | string; stage_id: number | string; sort_order: string } | undefined;
    return r
      ? { id: Number(r.id), stageId: Number(r.stage_id), sortOrder: BigInt(r.sort_order) }
      : undefined;
  }

  /** The card directly above `anchor` in column order, ignoring the card being moved. */
  async cardAbove(
    tx: Tx,
    orgId: number,
    stageId: number,
    anchor: { id: number; sortOrder: bigint },
    excludeId: number,
  ): Promise<bigint | null> {
    const so = anchor.sortOrder.toString();
    const res = await tx.execute(sql`
      SELECT sort_order::text AS so FROM deals
      WHERE org_id = ${orgId} AND stage_id = ${stageId} AND id <> ${excludeId}
        AND (sort_order < ${so}::bigint OR (sort_order = ${so}::bigint AND id > ${anchor.id}))
      ORDER BY sort_order DESC, id ASC LIMIT 1
    `);
    const r = res.rows[0] as { so: string } | undefined;
    return r ? BigInt(r.so) : null;
  }

  /** The card directly below `anchor` in column order, ignoring the card being moved. */
  async cardBelow(
    tx: Tx,
    orgId: number,
    stageId: number,
    anchor: { id: number; sortOrder: bigint },
    excludeId: number,
  ): Promise<bigint | null> {
    const so = anchor.sortOrder.toString();
    const res = await tx.execute(sql`
      SELECT sort_order::text AS so FROM deals
      WHERE org_id = ${orgId} AND stage_id = ${stageId} AND id <> ${excludeId}
        AND (sort_order > ${so}::bigint OR (sort_order = ${so}::bigint AND id < ${anchor.id}))
      ORDER BY sort_order ASC, id DESC LIMIT 1
    `);
    const r = res.rows[0] as { so: string } | undefined;
    return r ? BigInt(r.so) : null;
  }

  /** Space the column out again (1024 apart, current order kept) when a gap has closed. */
  async renumber(tx: Tx, orgId: number, stageId: number, excludeId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE deals d SET sort_order = r.rn * 1024
      FROM (
        SELECT id, row_number() OVER (ORDER BY sort_order ASC, id DESC) AS rn
        FROM deals WHERE org_id = ${orgId} AND stage_id = ${stageId} AND id <> ${excludeId}
      ) r
      WHERE d.org_id = ${orgId} AND d.id = r.id
    `);
  }

  // --- references ------------------------------------------------------------------------------------------------------

  async resolveContact(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; companyId: number | null } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, company_id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      { id: number | string; company_id: number | string | null } | undefined;
    return r ? { id: Number(r.id), companyId: num(r.company_id) } : undefined;
  }

  async resolveCompanyId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM companies WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** An ACTIVE member of this workspace by uuid: the only kind of user a deal or task can be assigned to. */
  async resolveActiveUser(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'active'`,
    );
    const r = res.rows[0] as { id: number | string; full_name: string } | undefined;
    return r ? { id: Number(r.id), name: r.full_name } : undefined;
  }

  /** Any user (active or not) by uuid, for filters: an ex-member's old deals are still filterable. */
  async resolveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  async resolveContactId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    return (await this.resolveContact(tx, orgId, uuid))?.id;
  }

  /** True if `ownerId` is on a team `actorUserId` is also on: the 'team' record-scope check for one deal. */
  async isOwnerInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    ownerId: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId} AND tm2.user_id = ${ownerId}
      LIMIT 1
    `);
    return res.rows.length > 0;
  }

  /** The workspace's own currency for a pipeline that does not say, and its time zone for reports. */
  async orgSettings(
    tx: Tx,
    orgId: number,
  ): Promise<{ currency: string | null; timezone: string | null }> {
    const res = await tx.execute(
      sql`SELECT settings ->> 'currency' AS currency, settings ->> 'timezone' AS timezone FROM organizations WHERE id = ${orgId}`,
    );
    const r = res.rows[0] as { currency: string | null; timezone: string | null } | undefined;
    return { currency: r?.currency ?? null, timezone: r?.timezone ?? null };
  }

  /** Exchange rates by currency code (the currency table is global, not tenant data). */
  async rates(tx: Tx): Promise<Array<{ code: string; exchange_rate: string }>> {
    const res = await tx.execute(
      sql`SELECT code, exchange_rate::text AS exchange_rate FROM currencies WHERE is_active`,
    );
    return res.rows as unknown as Array<{ code: string; exchange_rate: string }>;
  }
}

export function encodeStageCursor(sortOrder: bigint, id: number): string {
  return Buffer.from(`${sortOrder.toString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeStageCursor(raw: string): [bigint, number] {
  try {
    const [so, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!so || !id || !/^-?\d+$/.test(so) || !/^\d+$/.test(id)) throw new Error('malformed');
    return [BigInt(so), Number(id)];
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}
