import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { FormStatus, RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/** One form as the SQL returns it: the row, the live version and the counts the list shows. */
export interface FormRow {
  id: number;
  uuid: string;
  name: string;
  publicKey: string;
  status: FormStatus;
  draftDefinition: Record<string, unknown>;
  publishedVersionId: number | null;
  publishedVersion: number | null;
  publishedAt: Date | null;
  hasUnpublishedChanges: boolean;
  allowedOrigins: string[];
  captchaMode: 'inherit' | 'on' | 'off';
  honeypot: boolean;
  notify: Record<string, unknown>;
  retentionDays: number | null;
  ownerRule: Record<string, unknown>;
  rateLimits: Record<string, unknown>;
  rrCursor: number;
  createdBy: number | null;
  views: number;
  submissions: number;
  needsReview: number;
  lastSubmissionAt: Date | null;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

export interface VersionRow {
  id: number;
  uuid: string;
  formId: number;
  version: number;
  definition: Record<string, unknown>;
  publishedBy: number | null;
  publishedByUuid: string | null;
  publishedByName: string | null;
  publishedAt: Date;
}

const toRow = (r: Raw): FormRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  publicKey: r.public_key as string,
  status: r.status as FormStatus,
  draftDefinition: r.draft_definition as Record<string, unknown>,
  publishedVersionId: n(r.published_version_id),
  publishedVersion: n(r.published_version),
  publishedAt: d(r.published_at),
  hasUnpublishedChanges: r.has_unpublished_changes === true,
  allowedOrigins: (r.allowed_origins as string[] | null) ?? [],
  captchaMode: r.captcha_mode as FormRow['captchaMode'],
  honeypot: r.honeypot as boolean,
  notify: r.notify as Record<string, unknown>,
  retentionDays: n(r.retention_days),
  ownerRule: r.owner_rule as Record<string, unknown>,
  rateLimits: r.rate_limits as Record<string, unknown>,
  rrCursor: Number(r.rr_cursor),
  createdBy: n(r.created_by),
  views: Number(r.views ?? 0),
  submissions: Number(r.submissions ?? 0),
  needsReview: Number(r.needs_review ?? 0),
  lastSubmissionAt: d(r.last_submission_at),
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const SELECT = sql`
  SELECT f.*, to_char(f.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
         v.version AS published_version, v.published_at,
         (v.id IS NULL OR v.definition IS DISTINCT FROM f.draft_definition) AS has_unpublished_changes,
         (SELECT count(*) FROM web_form_events e WHERE e.org_id = f.org_id AND e.form_id = f.id AND e.kind = 'view')::int AS views,
         (SELECT count(*) FROM web_form_submissions x WHERE x.org_id = f.org_id AND x.form_id = f.id AND x.status <> 'spam')::int AS submissions,
         (SELECT count(*) FROM web_form_submissions x WHERE x.org_id = f.org_id AND x.form_id = f.id AND x.status IN ('needs_review', 'failed'))::int AS needs_review,
         (SELECT max(x.created_at) FROM web_form_submissions x WHERE x.org_id = f.org_id AND x.form_id = f.id AND x.status <> 'spam') AS last_submission_at
  FROM web_forms f
  LEFT JOIN web_form_versions v ON v.org_id = f.org_id AND v.id = f.published_version_id`;

/**
 * The record scope of a form is a condition on who made it: `own` is "created by me", `team` adds everyone who shares a team with me,
 * `all` adds nothing. (Forms have no owner column: the creator is the owner a workspace sees.)
 */
export function formScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  if (scope === 'own') return sql`f.created_by = ${actorUserId}`;
  return sql`(f.created_by = ${actorUserId} OR f.created_by IN (SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId}))`;
}

const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface InsertForm {
  name: string;
  publicKey: string;
  definition: Record<string, unknown>;
  createdBy: number | null;
  settings: {
    allowedOrigins: string[];
    captchaMode: string;
    honeypot: boolean;
    notify: unknown;
    retentionDays: number | null;
    ownerRule: unknown;
    rateLimits: unknown;
  };
}

@Injectable()
export class FormsRepository {
  async list(
    tx: Tx,
    orgId: number,
    f: {
      status?: FormStatus;
      includeArchived: boolean;
      q?: string;
      scope?: SQL;
      cursor?: string;
      limit: number;
    },
  ): Promise<FormRow[]> {
    const where: SQL[] = [sql`f.org_id = ${orgId}`];
    if (f.status) where.push(sql`f.status = ${f.status}`);
    else if (!f.includeArchived) where.push(sql`f.status <> 'archived'`);
    if (f.q) where.push(sql`f.name ILIKE ${`%${escapeLike(f.q)}%`}`);
    if (f.scope) where.push(f.scope);
    if (f.cursor) {
      const c = decodeCursor(f.cursor);
      where.push(
        sql`(f.created_at, f.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id})`,
      );
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(where, sql` AND `)}
      ORDER BY f.created_at DESC, f.id DESC LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<FormRow | undefined> {
    // FOR UPDATE cannot lock the outer-joined side: lock the form alone, then read the joined shape.
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM web_forms WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    }
    const res = await tx.execute(
      sql`${SELECT} WHERE f.org_id = ${orgId} AND f.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(
    tx: Tx,
    orgId: number,
    id: number,
    forUpdate = false,
  ): Promise<FormRow | undefined> {
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM web_forms WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`,
      );
    }
    const res = await tx.execute(sql`${SELECT} WHERE f.org_id = ${orgId} AND f.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** Is an active (not archived) form already called this, in any case? */
  async nameTaken(tx: Tx, orgId: number, name: string, exceptId?: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM web_forms
      WHERE org_id = ${orgId} AND lower(name) = lower(${name}) AND status <> 'archived'
        ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Forms that count against the plan's cap: every one that is not archived. */
  async countActive(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM web_forms WHERE org_id = ${orgId} AND status <> 'archived'`,
    );
    return Number((res.rows[0] as { n: number | string }).n);
  }

  async insert(tx: Tx, orgId: number, v: InsertForm): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO web_forms (org_id, name, public_key, draft_definition, created_by, allowed_origins, captcha_mode, honeypot, notify,
                             retention_days, owner_rule, rate_limits)
      VALUES (${orgId}, ${v.name}, ${v.publicKey}, ${JSON.stringify(v.definition)}::jsonb, ${v.createdBy},
              ${textArray(v.settings.allowedOrigins)}, ${v.settings.captchaMode}, ${v.settings.honeypot},
              ${JSON.stringify(v.settings.notify)}::jsonb, ${v.settings.retentionDays},
              ${JSON.stringify(v.settings.ownerRule)}::jsonb, ${JSON.stringify(v.settings.rateLimits)}::jsonb)
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** The optimistic lock is the `row_version` in the WHERE: false means somebody else wrote first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: {
      name?: string;
      definition?: Record<string, unknown>;
      allowedOrigins?: string[];
      captchaMode?: string;
      honeypot?: boolean;
      notify?: unknown;
      retentionDays?: number | null;
      ownerRule?: unknown;
      rateLimits?: unknown;
      status?: FormStatus;
      publicKey?: string;
      publishedVersionId?: number | null;
    },
  ): Promise<boolean> {
    const sets: SQL[] = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.definition !== undefined)
      sets.push(sql`draft_definition = ${JSON.stringify(patch.definition)}::jsonb`);
    if (patch.allowedOrigins !== undefined)
      sets.push(sql`allowed_origins = ${textArray(patch.allowedOrigins)}`);
    if (patch.captchaMode !== undefined) sets.push(sql`captcha_mode = ${patch.captchaMode}`);
    if (patch.honeypot !== undefined) sets.push(sql`honeypot = ${patch.honeypot}`);
    if (patch.notify !== undefined) sets.push(sql`notify = ${JSON.stringify(patch.notify)}::jsonb`);
    if (patch.retentionDays !== undefined) sets.push(sql`retention_days = ${patch.retentionDays}`);
    if (patch.ownerRule !== undefined)
      sets.push(sql`owner_rule = ${JSON.stringify(patch.ownerRule)}::jsonb`);
    if (patch.rateLimits !== undefined)
      sets.push(sql`rate_limits = ${JSON.stringify(patch.rateLimits)}::jsonb`);
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
    if (patch.publicKey !== undefined) sets.push(sql`public_key = ${patch.publicKey}`);
    if (patch.publishedVersionId !== undefined)
      sets.push(sql`published_version_id = ${patch.publishedVersionId}`);
    if (sets.length === 0) return true;
    const res = await tx.execute(sql`
      UPDATE web_forms SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** The events stream has no foreign key, so a form's events are deleted with it. */
  async deleteEvents(tx: Tx, orgId: number, formId: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM web_form_events WHERE org_id = ${orgId} AND form_id = ${formId}`,
    );
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM web_forms WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  // --- versions ----------------------------------------------------------------------------------------------------------------------

  async nextVersion(tx: Tx, orgId: number, formId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(version), 0) + 1 AS next FROM web_form_versions WHERE org_id = ${orgId} AND form_id = ${formId}`,
    );
    return Number((res.rows[0] as { next: number | string }).next);
  }

  async insertVersion(
    tx: Tx,
    orgId: number,
    v: {
      formId: number;
      version: number;
      definition: Record<string, unknown>;
      publishedBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO web_form_versions (org_id, form_id, version, definition, published_by)
      VALUES (${orgId}, ${v.formId}, ${v.version}, ${JSON.stringify(v.definition)}::jsonb, ${v.publishedBy})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  private versionSelect(): SQL {
    return sql`
      SELECT v.id, v.uuid, v.form_id, v.version, v.definition, v.published_by, v.published_at,
             u.uuid AS published_by_uuid, u.full_name AS published_by_name
      FROM web_form_versions v LEFT JOIN users u ON u.org_id = v.org_id AND u.id = v.published_by`;
  }

  private toVersion(r: Raw): VersionRow {
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      formId: Number(r.form_id),
      version: Number(r.version),
      definition: r.definition as Record<string, unknown>,
      publishedBy: n(r.published_by),
      publishedByUuid: s(r.published_by_uuid),
      publishedByName: s(r.published_by_name),
      publishedAt: new Date(r.published_at as string),
    };
  }

  async listVersions(tx: Tx, orgId: number, formId: number): Promise<VersionRow[]> {
    const res = await tx.execute(
      sql`${this.versionSelect()} WHERE v.org_id = ${orgId} AND v.form_id = ${formId} ORDER BY v.version DESC LIMIT 200`,
    );
    return (res.rows as Raw[]).map((r) => this.toVersion(r));
  }

  async findVersion(
    tx: Tx,
    orgId: number,
    formId: number,
    version: number,
  ): Promise<VersionRow | undefined> {
    const res = await tx.execute(
      sql`${this.versionSelect()} WHERE v.org_id = ${orgId} AND v.form_id = ${formId} AND v.version = ${version}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? this.toVersion(r) : undefined;
  }

  async findVersionById(tx: Tx, orgId: number, id: number): Promise<VersionRow | undefined> {
    const res = await tx.execute(
      sql`${this.versionSelect()} WHERE v.org_id = ${orgId} AND v.id = ${id}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? this.toVersion(r) : undefined;
  }

  // --- references ----------------------------------------------------------------------------------------------------------------------

  /** The listed users that are active members, in the order given (a round robin is a rotation over the admin's list). */
  async activeUsers(
    tx: Tx,
    orgId: number,
    uuids: string[],
  ): Promise<Array<{ id: number; uuid: string }>> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT id, uuid FROM users
      WHERE org_id = ${orgId} AND status = 'active'
        AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
    const byUuid = new Map(
      (res.rows as Array<{ id: number | string; uuid: string }>).map((r) => [
        r.uuid,
        { id: Number(r.id), uuid: r.uuid },
      ]),
    );
    return uuids.flatMap((u) => {
      const hit = byUuid.get(u);
      return hit ? [hit] : [];
    });
  }

  /** The round-robin turn, consumed only when a user can take it. Bookkeeping: does not bump the form's row_version. */
  async takeTurn(tx: Tx, orgId: number, id: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE web_forms SET rr_cursor = rr_cursor + 1 WHERE org_id = ${orgId} AND id = ${id} RETURNING rr_cursor - 1 AS turn`);
    return Number((res.rows[0] as { turn: number | string } | undefined)?.turn ?? 0);
  }

  /** The contact columns the contact row type does not carry and a form fills when blank. */
  async contactExtras(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{
    title: string | null;
    address: string | null;
    message: string | null;
    middleName: string | null;
  }> {
    const res = await tx.execute(
      sql`SELECT title, address, message, middle_name FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as
      | {
          title: string | null;
          address: string | null;
          message: string | null;
          middle_name: string | null;
        }
      | undefined;
    return r
      ? { title: r.title, address: r.address, message: r.message, middleName: r.middle_name }
      : { title: null, address: null, message: null, middleName: null };
  }

  /** One attribution touch for a contact: where a submission came from (platform `form`). Append-only, like the lead pipeline's. */
  async insertAttribution(
    tx: Tx,
    orgId: number,
    v: {
      contactId: number;
      label: string;
      campaign: string | null;
      form: string;
      capturedAt: Date;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO contact_attributions (org_id, contact_id, platform, source_label, campaign, form, captured_at)
      VALUES (${orgId}, ${v.contactId}, 'form', ${v.label}, ${v.campaign}, ${v.form}, ${v.capturedAt.toISOString()}::timestamptz)`);
  }

  /** True when `userId` is on a team `actorUserId` is also on: the `team` record-scope check for one form. */
  async isTeammate(tx: Tx, orgId: number, actorUserId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId} AND tm2.user_id = ${userId}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async userUuid(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM users WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
  }

  async userIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** A lifecycle stage that exists, is active and is not a lost stage (a lost stage demands a reason nobody is here to give). */
  async stageUsable(tx: Tx, orgId: number, stage: string): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM status_options
      WHERE org_id = ${orgId} AND module_key = 'contacts' AND option_group = 'lifecycle_stage' AND value = ${stage}
        AND is_active AND NOT is_lost LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Active, writable properties of a module's registry by key: the ones a field may be bound to. */
  async registryProperties(
    tx: Tx,
    orgId: number,
    moduleKey: 'contacts' | 'companies',
  ): Promise<
    Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
      options: Array<{ value: string; label: string }>;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT f.key, f.label, f.field_type, f.is_required,
             coalesce((SELECT jsonb_agg(jsonb_build_object('value', o.value, 'label', o.label) ORDER BY o.position, o.id)
                         FROM field_options o WHERE o.org_id = f.org_id AND o.field_id = f.id AND NOT o.is_hidden), '[]'::jsonb) AS options
      FROM fields f
      WHERE f.org_id = ${orgId} AND f.module_key = ${moduleKey} AND f.is_active AND NOT f.is_system
        AND NOT f.is_hidden AND NOT f.is_read_only
        AND f.field_type NOT IN ('formula', 'lookup', 'datetime')
      ORDER BY f.position, f.id`);
    return (res.rows as Raw[]).map((r) => ({
      key: r.key as string,
      label: r.label as string,
      type: r.field_type as string,
      required: r.is_required === true,
      options: r.options as Array<{ value: string; label: string }>,
    }));
  }

  /** Types of the named active custom properties of a module: how a mapped value is coerced. */
  async propertyTypes(
    tx: Tx,
    orgId: number,
    moduleKey: 'contacts' | 'companies',
    keys: string[],
  ): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT key, field_type FROM fields
      WHERE org_id = ${orgId} AND module_key = ${moduleKey} AND is_active AND NOT is_system
        AND key IN (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`);
    return new Map(
      (res.rows as Array<{ key: string; field_type: string }>).map((r) => [r.key, r.field_type]),
    );
  }

  /** One analytics beacon of the public page: a visit id (random per page load, no cookie), a kind, a step. No personal data. */
  async insertEvent(
    tx: Tx,
    orgId: number,
    v: {
      formId: number;
      versionId: number | null;
      visitId: string;
      kind: string;
      step: number | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO web_form_events (org_id, form_id, version_id, visit_id, kind, step_index)
      VALUES (${orgId}, ${v.formId}, ${v.versionId}, ${v.visitId}, ${v.kind}, ${v.step})`);
  }

  /** Bots the hidden trap field dropped this month, and the submissions currently held as spam, for the Protection section. */
  async protectionCounts(
    tx: Tx,
    orgId: number,
    now: Date,
  ): Promise<{ blockedThisMonth: number; heldAsSpam: number }> {
    const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const res = await tx.execute(sql`
      SELECT
        COALESCE((SELECT spam_blocked FROM web_form_usage_monthly WHERE org_id = ${orgId} AND period = ${period}::date), 0)::int AS blocked,
        (SELECT count(*) FROM web_form_submissions WHERE org_id = ${orgId} AND status = 'spam' AND erased_at IS NULL)::int AS held`);
    const r = res.rows[0] as { blocked: number | string; held: number | string };
    return { blockedThisMonth: Number(r.blocked), heldAsSpam: Number(r.held) };
  }

  /** Adds one view of the monthly spam counter (nothing is stored for a submission the honeypot dropped). */
  async bumpSpamBlocked(tx: Tx, orgId: number, now: Date): Promise<void> {
    const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    await tx.execute(sql`
      INSERT INTO web_form_usage_monthly (org_id, period, spam_blocked) VALUES (${orgId}, ${period}::date, 1)
      ON CONFLICT (org_id, period) DO UPDATE SET spam_blocked = web_form_usage_monthly.spam_blocked + 1, updated_at = now()`);
  }
}

/** A Postgres text[] from a list of strings, bound as one JSON parameter (no value is ever spliced into the SQL text). */
function textArray(values: readonly string[]): SQL {
  return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
}
