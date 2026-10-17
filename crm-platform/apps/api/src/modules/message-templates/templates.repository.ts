import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor } from '../../common/pagination/cursor';

/** A `wa_templates` row with the uuid of the number it is submitted through. */
export interface TemplateRow {
  id: number;
  uuid: string;
  userId: number | null;
  templateName: string;
  language: string;
  header: string | null;
  templateBody: string;
  footer: string | null;
  codeExpirationMinutes: number | null;
  buttons: unknown;
  variableMap: unknown;
  category: string;
  metaCategory: string | null;
  templateType: string;
  attachmentType: string | null;
  /** The Meta media handle of the header example (Reference kept the stored file's path here). */
  attachmentFile: string | null;
  headerSampleUrl: string | null;
  /** The pin of a `location` header (`{latitude, longitude, name, address}`). */
  headerLocation: unknown;
  parameterFormat: string;
  status: string;
  metaStatus: string | null;
  metaTemplateId: string | null;
  qualityScore: string | null;
  rejectionReason: string | null;
  rejectionReasonCode: string | null;
  approvedAt: Date | null;
  submittedAt: Date | null;
  lastSyncedAt: Date | null;
  pausedUntil: Date | null;
  providerConfigId: number | null;
  connectionUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  updatedAt: Date;
}

const SELECT = sql.raw(`
  t.id, t.uuid, t.user_id, t.template_name, t.language, t.header, t.template_body, t.footer, t.code_expiration_minutes,
  t.buttons, t.variable_map, t.category, t.meta_category, t.template_type, t.attachment_type, t.attachment_file,
  t.header_sample_url, t.header_location, t.parameter_format, t.status, t.meta_status, t.meta_template_id, t.quality_score,
  t.rejection_reason, t.rejection_reason_code, t.approved_at, t.submitted_at, t.last_synced_at, t.paused_until,
  t.provider_config_id, c.uuid AS connection_uuid, t.row_version, t.created_at, t.updated_at,
  to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`);

const FROM = sql`wa_templates t LEFT JOIN wa_provider_configs c ON c.org_id = t.org_id AND c.id = t.provider_config_id`;

type Raw = Record<string, unknown>;
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: Raw): TemplateRow {
  return {
    id: Number(r.id),
    uuid: String(r.uuid),
    userId: num(r.user_id),
    templateName: String(r.template_name),
    language: String(r.language),
    header: (r.header as string | null) ?? null,
    templateBody: String(r.template_body),
    footer: (r.footer as string | null) ?? null,
    codeExpirationMinutes: num(r.code_expiration_minutes),
    buttons: r.buttons ?? null,
    variableMap: r.variable_map ?? null,
    category: String(r.category),
    metaCategory: (r.meta_category as string | null) ?? null,
    templateType: String(r.template_type),
    attachmentType: (r.attachment_type as string | null) ?? null,
    attachmentFile: (r.attachment_file as string | null) ?? null,
    headerSampleUrl: (r.header_sample_url as string | null) ?? null,
    headerLocation: r.header_location ?? null,
    parameterFormat: String(r.parameter_format),
    status: String(r.status),
    metaStatus: (r.meta_status as string | null) ?? null,
    metaTemplateId: (r.meta_template_id as string | null) ?? null,
    qualityScore: (r.quality_score as string | null) ?? null,
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    rejectionReasonCode: (r.rejection_reason_code as string | null) ?? null,
    approvedAt: date(r.approved_at),
    submittedAt: date(r.submitted_at),
    lastSyncedAt: date(r.last_synced_at),
    pausedUntil: date(r.paused_until),
    providerConfigId: num(r.provider_config_id),
    connectionUuid: (r.connection_uuid as string | null) ?? null,
    rowVersion: Number(r.row_version),
    createdAt: new Date(r.created_at as string),
    createdAtIso: String(r.created_at_iso),
    updatedAt: new Date(r.updated_at as string),
  };
}

export interface ListFilter {
  limit: number;
  cursor?: string;
  status?: string;
  /** The library's status tab: approved / pending (in review and drafts) / rejected (rejected, paused, disabled). */
  statusGroup?: 'approved' | 'pending' | 'rejected';
  sort?: 'newest' | 'oldest' | 'name-asc' | 'name-desc';
  category?: string;
  connectionUuid?: string;
  /** Internal id of the WhatsApp connection: for a caller that already holds it (the team inbox), instead of its uuid. */
  providerConfigId?: number;
  /** This connection's templates first, then the rest, each group newest first. For a caller whose page is shared with other numbers. */
  preferProviderConfigId?: number;
  q?: string;
}

export interface NewTemplate {
  userId: number | null;
  templateName: string;
  language: string;
  header: string | null;
  templateBody: string;
  footer: string | null;
  codeExpirationMinutes: number | null;
  buttons: unknown[];
  variableMap: unknown;
  category: string;
  metaCategory: string | null;
  templateType: string;
  attachmentType: string | null;
  attachmentFile: string | null;
  headerSampleUrl: string | null;
  headerLocation?: unknown;
  parameterFormat: string;
  status: string;
  metaStatus?: string | null;
  metaTemplateId?: string | null;
  qualityScore?: string | null;
  rejectionReasonCode?: string | null;
  approvedAt?: Date | null;
  pausedUntil?: Date | null;
  submittedAt?: Date | null;
  lastSyncedAt?: Date | null;
  providerConfigId: number;
}

export type TemplatePatch = Partial<Omit<NewTemplate, 'userId'>> & {
  rejectionReason?: string | null;
  pausedUntil?: Date | null;
};

const COLUMN: Record<keyof TemplatePatch, string> = {
  templateName: 'template_name',
  language: 'language',
  header: 'header',
  templateBody: 'template_body',
  footer: 'footer',
  codeExpirationMinutes: 'code_expiration_minutes',
  buttons: 'buttons',
  variableMap: 'variable_map',
  category: 'category',
  metaCategory: 'meta_category',
  templateType: 'template_type',
  attachmentType: 'attachment_type',
  attachmentFile: 'attachment_file',
  headerSampleUrl: 'header_sample_url',
  headerLocation: 'header_location',
  parameterFormat: 'parameter_format',
  status: 'status',
  metaStatus: 'meta_status',
  metaTemplateId: 'meta_template_id',
  qualityScore: 'quality_score',
  rejectionReason: 'rejection_reason',
  rejectionReasonCode: 'rejection_reason_code',
  approvedAt: 'approved_at',
  submittedAt: 'submitted_at',
  lastSyncedAt: 'last_synced_at',
  pausedUntil: 'paused_until',
  providerConfigId: 'provider_config_id',
};
const JSON_COLUMNS = new Set<string>(['buttons', 'variableMap', 'headerLocation']);

/** The library's status tabs as Reference reads them: a draft is "in review", a paused or disabled template is "rejected". */
const GROUP_WHERE = {
  approved: sql`t.status IN ('approved', 'public')`,
  pending: sql`t.status IN ('pending', 'draft')`,
  rejected: sql`t.status IN ('rejected', 'paused', 'disabled')`,
} as const;

/** Keyset cursor of the two name sorts: the last name and id of the page. */
export function encodeNameCursor(name: string, id: number): string {
  return Buffer.from(JSON.stringify({ n: name, i: id }), 'utf8').toString('base64url');
}
function decodeNameCursor(raw: string): { name: string; id: number } {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      n?: unknown;
      i?: unknown;
    };
    if (typeof v.n !== 'string' || typeof v.i !== 'number') throw new Error('malformed');
    return { name: v.n, id: v.i };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Tenant-scoped access to `wa_templates`. Every method runs inside the caller's `DatabaseService.tx`. */
@Injectable()
export class TemplatesRepository {
  async list(tx: Tx, orgId: number, f: ListFilter): Promise<TemplateRow[]> {
    const where = this.filters(orgId, f);
    const sort = f.sort ?? 'newest';
    let order: SQL = sql`t.created_at DESC, t.id DESC`;
    if (f.cursor) {
      if (sort === 'name-asc' || sort === 'name-desc') {
        const c = decodeNameCursor(f.cursor);
        where.push(
          sort === 'name-asc'
            ? sql`(lower(t.template_name), t.id) > (${c.name.toLowerCase()}, ${c.id})`
            : sql`(lower(t.template_name), t.id) < (${c.name.toLowerCase()}, ${c.id})`,
        );
      } else {
        const c = decodeCursor(f.cursor);
        const at = c.createdAtIso ?? c.createdAt.toISOString();
        where.push(
          sort === 'oldest'
            ? sql`(t.created_at, t.id) > (${at}::timestamptz, ${c.id})`
            : sql`(t.created_at, t.id) < (${at}::timestamptz, ${c.id})`,
        );
      }
    }
    if (sort === 'oldest') order = sql`t.created_at ASC, t.id ASC`;
    else if (sort === 'name-asc') order = sql`lower(t.template_name) ASC, t.id ASC`;
    else if (sort === 'name-desc') order = sql`lower(t.template_name) DESC, t.id DESC`;
    if (f.preferProviderConfigId !== undefined && !f.cursor && sort === 'newest') {
      order = sql`(t.provider_config_id = ${f.preferProviderConfigId}) DESC, t.created_at DESC, t.id DESC`;
    }
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM ${FROM}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${order}
      LIMIT ${f.limit + 1}`);
    return res.rows.map(toRow);
  }

  /** The WHERE of a library query, without the keyset bound. */
  private filters(orgId: number, f: ListFilter): SQL[] {
    const where: SQL[] = [sql`t.org_id = ${orgId}`];
    if (f.status) {
      // Reference's `public` (a global starter) reads as approved.
      where.push(
        f.status === 'approved'
          ? sql`t.status IN ('approved', 'public')`
          : sql`t.status = ${f.status}`,
      );
    }
    if (f.statusGroup) where.push(GROUP_WHERE[f.statusGroup]);
    if (f.category)
      where.push(sql`upper(coalesce(t.meta_category, t.category)) = ${f.category.toUpperCase()}`);
    if (f.connectionUuid) where.push(sql`c.uuid = ${f.connectionUuid}::uuid`);
    if (f.providerConfigId !== undefined)
      where.push(sql`t.provider_config_id = ${f.providerConfigId}`);
    if (f.q) {
      const like = `%${escapeLike(f.q)}%`;
      where.push(
        sql`(t.template_name ILIKE ${like} OR t.meta_template_id ILIKE ${like} OR t.template_body ILIKE ${like})`,
      );
    }
    return where;
  }

  /**
   * The numbers on the library's tabs. Tab counts cover the whole library (Reference counts everything it can show); `filtered` is
   * the size of the current result, for "Showing N of M".
   */
  async counts(
    tx: Tx,
    orgId: number,
    f: Omit<ListFilter, 'limit' | 'cursor' | 'sort'>,
  ): Promise<{
    categories: Record<string, number>;
    statuses: Record<string, number>;
    filtered: number;
  }> {
    const tabs = await tx.execute(sql`
      SELECT upper(coalesce(t.meta_category, t.category)) AS cat,
        count(*)::int AS n,
        count(*) FILTER (WHERE ${GROUP_WHERE.approved})::int AS approved,
        count(*) FILTER (WHERE ${GROUP_WHERE.pending})::int AS pending,
        count(*) FILTER (WHERE ${GROUP_WHERE.rejected})::int AS rejected
      FROM wa_templates t
      WHERE t.org_id = ${orgId}
      GROUP BY 1`);
    const categories: Record<string, number> = { all: 0 };
    const statuses: Record<string, number> = { all: 0, approved: 0, pending: 0, rejected: 0 };
    for (const r of tabs.rows as Array<Record<string, unknown>>) {
      const n = Number(r.n);
      categories.all += n;
      statuses.all += n;
      statuses.approved += Number(r.approved);
      statuses.pending += Number(r.pending);
      statuses.rejected += Number(r.rejected);
      if (r.cat) categories[String(r.cat)] = (categories[String(r.cat)] ?? 0) + n;
    }
    const filtered = await tx.execute(sql`
      SELECT count(*)::int AS n FROM ${FROM} WHERE ${sql.join(this.filters(orgId, { ...f, limit: 0 }), sql` AND `)}`);
    return { categories, statuses, filtered: Number((filtered.rows[0] as { n: number }).n) };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<TemplateRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM ${FROM}
      WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF t` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** Several templates by uuid in one query (the thread draws the template of every message of a page); an unknown or foreign uuid is simply absent. */
  async findManyByUuids(tx: Tx, orgId: number, uuids: readonly string[]): Promise<TemplateRow[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM ${FROM}
      WHERE t.org_id = ${orgId} AND t.uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    return res.rows.map(toRow);
  }

  /** A flow node names a template by its name: an approved one wins, then the newest (TW-FLR-026). */
  async findByName(tx: Tx, orgId: number, name: string): Promise<TemplateRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM ${FROM}
      WHERE t.org_id = ${orgId} AND lower(t.template_name) = lower(${name})
      ORDER BY (t.status IN ('approved', 'public')) DESC, t.id DESC LIMIT 1`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<TemplateRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM ${FROM} WHERE t.org_id = ${orgId} AND t.id = ${id}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async insert(tx: Tx, orgId: number, v: NewTemplate): Promise<TemplateRow> {
    const id = await this.insertRow(tx, orgId, v, false);
    return (await this.findById(tx, orgId, id!))!;
  }

  /** A template Meta lists that we do not hold. `null` when its Meta id already belongs to a row (another workspace's). */
  async insertImported(tx: Tx, orgId: number, v: NewTemplate): Promise<TemplateRow | null> {
    const id = await this.insertRow(tx, orgId, v, true);
    return id === null ? null : this.findById(tx, orgId, id);
  }

  private async insertRow(
    tx: Tx,
    orgId: number,
    v: NewTemplate,
    skipOnConflict: boolean,
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      INSERT INTO wa_templates (org_id, user_id, template_name, language, header, template_body, footer,
        code_expiration_minutes, buttons, variable_map, category, meta_category, template_type, attachment_type,
        attachment_file, header_sample_url, header_location, parameter_format, status, meta_status, meta_template_id, quality_score,
        rejection_reason_code, approved_at, paused_until, submitted_at, last_synced_at, provider_config_id, channel)
      VALUES (${orgId}, ${v.userId}, ${v.templateName}, ${v.language}, ${v.header}, ${v.templateBody}, ${v.footer},
        ${v.codeExpirationMinutes}, ${JSON.stringify(v.buttons)}::jsonb, ${JSON.stringify(v.variableMap ?? {})}::jsonb,
        ${v.category}, ${v.metaCategory}, ${v.templateType}, ${v.attachmentType}, ${v.attachmentFile},
        ${v.headerSampleUrl}, ${v.headerLocation == null ? null : JSON.stringify(v.headerLocation)}::jsonb, ${v.parameterFormat}, ${v.status}, ${v.metaStatus ?? null}, ${v.metaTemplateId ?? null},
        ${v.qualityScore ?? null}, ${v.rejectionReasonCode ?? null}, ${v.approvedAt ?? null}, ${v.pausedUntil ?? null},
        ${v.submittedAt ?? null},
        ${v.lastSyncedAt ?? null}, ${v.providerConfigId}, 'waba')
      ${skipOnConflict ? sql`ON CONFLICT (meta_template_id) DO NOTHING` : sql``}
      RETURNING id`);
    const row = res.rows[0] as { id: number | string } | undefined;
    return row ? Number(row.id) : null;
  }

  /** Optimistic when `expectedVersion` is given; a stale version updates nothing and returns null. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    patch: TemplatePatch,
    expectedVersion?: number,
  ): Promise<TemplateRow | null> {
    const sets: SQL[] = [];
    for (const [key, value] of Object.entries(patch) as Array<[keyof TemplatePatch, unknown]>) {
      if (value === undefined) continue;
      const column = sql.raw(COLUMN[key]);
      sets.push(
        JSON_COLUMNS.has(key)
          ? sql`${column} = ${JSON.stringify(value ?? null)}::jsonb`
          : sql`${column} = ${value}`,
      );
    }
    if (sets.length === 0) return this.findById(tx, orgId, id);
    const version =
      expectedVersion === undefined ? sql`` : sql` AND row_version = ${expectedVersion}`;
    const res = await tx.execute(sql`
      UPDATE wa_templates SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}${version}
      RETURNING id`);
    return res.rows[0] ? this.findById(tx, orgId, id) : null;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM wa_templates WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  /** The same name and language already on this number. Meta keys templates by name + language, case-folded to lowercase. */
  async nameTaken(
    tx: Tx,
    orgId: number,
    connectionId: number,
    name: string,
    language: string,
    exceptId?: number,
  ): Promise<boolean> {
    // Nothing in the schema makes name + language unique on a number, so two creates in flight serialise here instead.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${orgId}::int, hashtext(${`${connectionId}:${name.toLowerCase()}:${language}`}))`,
    );
    const res = await tx.execute(sql`
      SELECT 1 FROM wa_templates
      WHERE org_id = ${orgId} AND provider_config_id = ${connectionId}
        AND lower(template_name) = lower(${name}) AND language = ${language}
        ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Broadcasts that would still send this template: running or waiting for their time (TW-TPL-020 port note). */
  async activeBroadcasts(tx: Tx, orgId: number, templateId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM broadcasts
      WHERE org_id = ${orgId} AND template_id = ${templateId} AND status IN ('processing', 'scheduled')`);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Every row of one number (the sync matches Meta's list against these). */
  async listForConnection(tx: Tx, orgId: number, connectionId: number): Promise<TemplateRow[]> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM ${FROM}
      WHERE t.org_id = ${orgId} AND t.provider_config_id = ${connectionId}
      ORDER BY t.id`);
    return res.rows.map(toRow);
  }

  /**
   * PENDING templates Meta may have decided on without our webhook hearing (TW-TPL-004 rule 6): on Meta, submitted more than
   * an hour ago, not checked in the last half hour. Across tenants (the sweeper runs privileged); oldest first.
   */
  async staleTargets(
    tx: Tx,
    limit: number,
    now: Date,
  ): Promise<Array<{ orgId: number; id: number }>> {
    const submittedBefore = new Date(now.getTime() - 60 * 60_000);
    const syncedBefore = new Date(now.getTime() - 30 * 60_000);
    const res = await tx.execute(sql`
      SELECT org_id, id FROM wa_templates
      WHERE meta_status = 'PENDING' AND meta_template_id IS NOT NULL AND provider_config_id IS NOT NULL
        AND submitted_at < ${submittedBefore}
        AND (last_synced_at IS NULL OR last_synced_at < ${syncedBefore})
      ORDER BY submitted_at, id
      LIMIT ${limit}`);
    return (res.rows as Array<{ org_id: number | string; id: number | string }>).map((r) => ({
      orgId: Number(r.org_id),
      id: Number(r.id),
    }));
  }
}
