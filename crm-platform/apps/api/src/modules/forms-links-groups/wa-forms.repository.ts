import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { Cursor } from '../../common/pagination/cursor';

/** A `wa_forms` row as the authoring/list screens read it. */
export interface WaFormRow {
  id: number;
  uuid: string;
  title: string;
  purpose: string | null;
  slug: string;
  audience_type: string;
  submission_cap: number;
  cap_reached_note: string | null;
  send_button_label: string;
  thank_you_note: string | null;
  definition_json: { screens: Array<{ id: string; title?: string; fields: unknown[] }> } | null;
  status: string;
  meta_flow_id: string | null;
  provider_config_id: number | null;
  published_at: Date | null;
  publish_error: string | null;
  submission_count: number;
  created_at: Date;
  created_at_iso: string;
  row_version: number;
}

const COLUMNS = sql.raw(`id, uuid, title, purpose, slug, audience_type, submission_cap, cap_reached_note,
  send_button_label, thank_you_note, definition_json, status, meta_flow_id, provider_config_id, published_at,
  publish_error, submission_count, created_at, row_version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`);

const toRow = (r: Record<string, unknown>): WaFormRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  title: String(r.title),
  purpose: (r.purpose as string | null) ?? null,
  slug: String(r.slug),
  audience_type: String(r.audience_type),
  submission_cap: Number(r.submission_cap),
  cap_reached_note: (r.cap_reached_note as string | null) ?? null,
  send_button_label: String(r.send_button_label),
  thank_you_note: (r.thank_you_note as string | null) ?? null,
  definition_json:
    (r.definition_json as WaFormRow['definition_json']) ?? { screens: [{ id: 'A', fields: [] }] },
  status: String(r.status),
  meta_flow_id: (r.meta_flow_id as string | null) ?? null,
  provider_config_id: r.provider_config_id == null ? null : Number(r.provider_config_id),
  published_at: r.published_at ? new Date(r.published_at as string) : null,
  publish_error: (r.publish_error as string | null) ?? null,
  submission_count: Number(r.submission_count),
  created_at: new Date(r.created_at as string),
  created_at_iso: String(r.created_at_iso),
  row_version: Number(r.row_version),
});

export interface WaFormStatsRow {
  all: number;
  published: number;
  draft: number;
  submissions: number;
}

/**
 * Tenant-scoped access to `wa_forms` / `wa_form_submissions` (WFL; docs/threadwise-port/inventory/forms-links-groups.md
 * TW-WFL-001..010). Every method runs inside the caller's `DatabaseService.tx`.
 */
@Injectable()
export class WaFormsRepository {
  async list(tx: Tx, orgId: number, limit: number, cursor?: Cursor): Promise<WaFormRow[]> {
    const after = cursor
      ? sql`AND (created_at, id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
      : sql``;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_forms
       WHERE org_id = ${orgId} ${after}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit + 1}`);
    return res.rows.map(toRow);
  }

  async stats(tx: Tx, orgId: number): Promise<WaFormStatsRow> {
    const forms = await tx.execute(sql`
      SELECT count(*)::int AS all,
             (count(*) FILTER (WHERE status = 'published'))::int AS published,
             (count(*) FILTER (WHERE status = 'draft'))::int AS draft
        FROM wa_forms WHERE org_id = ${orgId}`);
    const subs = await tx.execute(
      sql`SELECT count(*)::int AS submissions FROM wa_form_submissions WHERE org_id = ${orgId}`,
    );
    const f = (forms.rows[0] ?? {}) as Record<string, unknown>;
    const s = (subs.rows[0] ?? {}) as Record<string, unknown>;
    return {
      all: Number(f.all ?? 0),
      published: Number(f.published ?? 0),
      draft: Number(f.draft ?? 0),
      submissions: Number(s.submissions ?? 0),
    };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<WaFormRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_forms WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid
      ${lock ? sql`FOR UPDATE` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** Published forms only, for the flow builder's picker — `GET /v2/wa-forms/picker`. */
  async pickable(tx: Tx, orgId: number): Promise<Array<Pick<WaFormRow, 'uuid' | 'title' | 'status' | 'meta_flow_id'>>> {
    const res = await tx.execute(sql`
      SELECT uuid, title, status, meta_flow_id FROM wa_forms WHERE org_id = ${orgId} ORDER BY id DESC`);
    return res.rows.map((r) => ({
      uuid: String((r as Record<string, unknown>).uuid),
      title: String((r as Record<string, unknown>).title),
      status: String((r as Record<string, unknown>).status),
      meta_flow_id: ((r as Record<string, unknown>).meta_flow_id as string | null) ?? null,
    }));
  }

  /** Slug uniqueness is per `(org_id, slug)` — generates `base`, `base-2`, `base-3`, ... until free. */
  async freshSlug(tx: Tx, orgId: number, base: string, excludeId?: number): Promise<string> {
    let candidate = base;
    for (let n = 2; n < 1000; n++) {
      const res = await tx.execute(sql`
        SELECT 1 FROM wa_forms WHERE org_id = ${orgId} AND slug = ${candidate}
        ${excludeId ? sql`AND id <> ${excludeId}` : sql``} LIMIT 1`);
      if (res.rows.length === 0) return candidate;
      candidate = `${base}-${n}`;
    }
    return `${base}-${Date.now()}`;
  }

  async insert(
    tx: Tx,
    orgId: number,
    userId: number | null,
    input: {
      title: string;
      purpose: string | null;
      slug: string;
      audienceType: string;
      submissionCap: number;
      capReachedNote: string | null;
      sendButtonLabel: string;
      thankYouNote: string | null;
      definitionJson: unknown;
    },
  ): Promise<WaFormRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_forms (org_id, user_id, title, purpose, slug, audience_type, submission_cap,
                             cap_reached_note, send_button_label, thank_you_note, definition_json, status)
      VALUES (${orgId}, ${userId}, ${input.title}, ${input.purpose}, ${input.slug}, ${input.audienceType},
              ${input.submissionCap}, ${input.capReachedNote}, ${input.sendButtonLabel}, ${input.thankYouNote},
              ${JSON.stringify(input.definitionJson)}::jsonb, 'draft')
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  /** Dropping a published form back to `draft` on every edit is deliberate Reference parity (TW-WFL-003). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    input: {
      title: string;
      purpose: string | null;
      audienceType: string;
      submissionCap: number;
      capReachedNote: string | null;
      sendButtonLabel: string;
      thankYouNote: string | null;
      definitionJson: unknown;
    },
  ): Promise<WaFormRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_forms SET
        title = ${input.title}, purpose = ${input.purpose}, audience_type = ${input.audienceType},
        submission_cap = ${input.submissionCap}, cap_reached_note = ${input.capReachedNote},
        send_button_label = ${input.sendButtonLabel}, thank_you_note = ${input.thankYouNote},
        definition_json = ${JSON.stringify(input.definitionJson)}::jsonb,
        status = (CASE WHEN status = 'published' THEN 'draft' ELSE status END)
       WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING ${COLUMNS}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /**
   * Persists a newly-minted Meta Flow id as soon as `ensureFlow` returns it — before upload/publish can fail.
   * Without this, a form with `meta_flow_id = NULL` that fails validation on every retry mints a fresh, orphaned
   * Meta Flow object on every attempt instead of reusing the one already created.
   */
  async saveFlowId(tx: Tx, orgId: number, id: number, metaFlowId: string, providerConfigId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_forms SET meta_flow_id = ${metaFlowId}, provider_config_id = ${providerConfigId}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async markPublished(tx: Tx, orgId: number, id: number, metaFlowId: string, providerConfigId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_forms SET status = 'published', meta_flow_id = ${metaFlowId}, provider_config_id = ${providerConfigId},
        published_at = now(), publish_error = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async markPublishFailed(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_forms SET publish_error = ${error.slice(0, 1000)} WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async duplicate(tx: Tx, orgId: number, userId: number | null, source: WaFormRow, newSlug: string): Promise<WaFormRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_forms (org_id, user_id, title, purpose, slug, audience_type, submission_cap, cap_reached_note,
                             send_button_label, thank_you_note, definition_json, status)
      VALUES (${orgId}, ${userId}, ${`${source.title} (copy)`}, ${source.purpose}, ${newSlug}, ${source.audience_type},
              ${source.submission_cap}, ${source.cap_reached_note}, ${source.send_button_label}, ${source.thank_you_note},
              ${JSON.stringify(source.definition_json)}::jsonb, 'draft')
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wa_forms WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- submissions -------------------------------------------------------------------------------

  async submissionsList(
    tx: Tx,
    orgId: number,
    formId: number,
    limit: number,
    cursor?: Cursor,
  ): Promise<
    Array<{
      id: number;
      uuid: string;
      contact_uuid: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      caller_phone: string | null;
      answers_json: Record<string, unknown> | null;
      submitted_at: Date | null;
      created_at: Date;
      created_at_iso: string;
    }>
  > {
    const after = cursor
      ? sql`AND (s.created_at, s.id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
      : sql``;
    const res = await tx.execute(sql`
      SELECT s.id, s.uuid, c.uuid AS contact_uuid, c.name AS contact_name, c.phone AS contact_phone,
             s.caller_phone, s.answers_json, s.submitted_at, s.created_at,
             to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
        FROM wa_form_submissions s
        LEFT JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.form_id = ${formId} ${after}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ${limit + 1}`);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: Number(row.id),
        uuid: String(row.uuid),
        contact_uuid: (row.contact_uuid as string | null) ?? null,
        contact_name: (row.contact_name as string | null) ?? null,
        contact_phone: (row.contact_phone as string | null) ?? null,
        caller_phone: (row.caller_phone as string | null) ?? null,
        answers_json: (row.answers_json as Record<string, unknown> | null) ?? null,
        submitted_at: row.submitted_at ? new Date(row.submitted_at as string) : null,
        created_at: new Date(row.created_at as string),
        created_at_iso: String(row.created_at_iso),
      };
    });
  }

  /** Every submission of the form, unpaged, for CSV export. */
  async submissionsForExport(
    tx: Tx,
    orgId: number,
    formId: number,
  ): Promise<
    Array<{
      answers_json: Record<string, unknown> | null;
      contact_name: string | null;
      contact_phone: string | null;
      submitted_at: Date | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT s.answers_json, c.name AS contact_name, c.phone AS contact_phone, s.submitted_at
        FROM wa_form_submissions s
        LEFT JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.form_id = ${formId}
       ORDER BY s.created_at ASC, s.id ASC`);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        answers_json: (row.answers_json as Record<string, unknown> | null) ?? null,
        contact_name: (row.contact_name as string | null) ?? null,
        contact_phone: (row.contact_phone as string | null) ?? null,
        submitted_at: row.submitted_at ? new Date(row.submitted_at as string) : null,
      };
    });
  }

  // --- credential resolution for publish ----------------------------------------------------------

  /** Candidate WABA provider configs for this org, newest first — publish tries each until one has usable creds. */
  async wabaProviderConfigIds(tx: Tx, orgId: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT id FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba'
       ORDER BY created_at DESC`);
    return res.rows.map((r) => Number((r as Record<string, unknown>).id));
  }
}
