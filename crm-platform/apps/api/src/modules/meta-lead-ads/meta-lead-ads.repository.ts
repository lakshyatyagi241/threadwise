import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type {
  LeadFormCheckbox,
  LeadFormQuestion,
} from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import type { SyncErrorKind } from './meta-lead-rules';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface PageStateRow {
  id: number;
  uuid: string;
  pageId: string;
  enabled: boolean;
  subscribedAt: Date | null;
  verifiedAt: Date | null;
  lastLeadAt: Date | null;
  lastSweepAt: Date | null;
  lastError: string | null;
  lastErrorKind: SyncErrorKind | null;
  rowVersion: number;
}

const toPage = (r: Raw): PageStateRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  pageId: r.page_id as string,
  enabled: r.enabled === true,
  subscribedAt: d(r.subscribed_at),
  verifiedAt: d(r.verified_at),
  lastLeadAt: d(r.last_lead_at),
  lastSweepAt: d(r.last_sweep_at),
  lastError: s(r.last_error),
  lastErrorKind: s(r.last_error_kind) as SyncErrorKind | null,
  rowVersion: Number(r.row_version),
});

export interface FormRow {
  id: number;
  uuid: string;
  pageId: string;
  formId: string;
  name: string;
  status: string | null;
  locale: string | null;
  questions: LeadFormQuestion[];
  checkboxes: LeadFormCheckbox[];
  privacyPolicyUrl: string | null;
  sourceId: number;
  /** The lead source's own uuid and status (read-only join): the form feeds it, and a paused source is not swept. */
  sourceUuid: string;
  sourceStatus: 'active' | 'paused';
  connectedAt: Date;
  lastLeadAt: Date | null;
  lastError: string | null;
  sweepCheckpointAt: Date;
  lastSweepAt: Date | null;
}

const toForm = (r: Raw): FormRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  pageId: r.page_id as string,
  formId: r.form_id as string,
  name: r.name as string,
  status: s(r.status),
  locale: s(r.locale),
  questions: (Array.isArray(r.questions) ? r.questions : []) as LeadFormQuestion[],
  checkboxes: (Array.isArray(r.consent_checkboxes)
    ? r.consent_checkboxes
    : []) as LeadFormCheckbox[],
  privacyPolicyUrl: s(r.privacy_policy_url),
  sourceId: Number(r.source_id),
  sourceUuid: r.source_uuid as string,
  sourceStatus: r.source_status as 'active' | 'paused',
  connectedAt: new Date(r.connected_at as string),
  lastLeadAt: d(r.last_lead_at),
  lastError: s(r.last_error),
  sweepCheckpointAt: new Date(r.sweep_checkpoint_at as string),
  lastSweepAt: d(r.last_sweep_at),
});

/** A form with the lead source it feeds (read only: the lead pipeline owns `lead_sources`). */
const FORM_SELECT = sql`
  SELECT f.*, ls.uuid AS source_uuid, ls.status AS source_status
  FROM meta_lead_forms f
  JOIN lead_sources ls ON ls.org_id = f.org_id AND ls.id = f.source_id`;

export interface FormUpsert {
  pageId: string;
  formId: string;
  name: string;
  status: string | null;
  locale: string | null;
  questions: readonly LeadFormQuestion[];
  checkboxes: readonly LeadFormCheckbox[];
  privacyPolicyUrl: string | null;
  sourceId: number;
  connectedBy: number | null;
}

/** Data access for the Meta lead ads door. Every method runs inside the caller's tenant transaction. */
@Injectable()
export class MetaLeadAdsRepository {
  // --- pages ---------------------------------------------------------------------------------------------------------------

  async listPages(tx: Tx, orgId: number): Promise<PageStateRow[]> {
    const res = await tx.execute(sql`SELECT * FROM meta_lead_pages WHERE org_id = ${orgId}`);
    return (res.rows as Raw[]).map(toPage);
  }

  async findPage(tx: Tx, orgId: number, pageId: string): Promise<PageStateRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM meta_lead_pages WHERE org_id = ${orgId} AND page_id = ${pageId}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toPage(r) : undefined;
  }

  /** Lead sync on: the subscription Meta confirmed, errors cleared. */
  async enablePage(
    tx: Tx,
    orgId: number,
    pageId: string,
    userId: number | null,
  ): Promise<PageStateRow> {
    const res = await tx.execute(sql`
      INSERT INTO meta_lead_pages (org_id, page_id, enabled, subscribed_at, verified_at, created_by)
      VALUES (${orgId}, ${pageId}, true, now(), now(), ${userId})
      ON CONFLICT (org_id, page_id) DO UPDATE
        SET enabled = true, subscribed_at = now(), verified_at = now(),
            last_error = NULL, last_error_kind = NULL, last_error_at = NULL
      RETURNING *`);
    return toPage((res.rows as Raw[])[0]!);
  }

  async disablePage(tx: Tx, orgId: number, pageId: string): Promise<PageStateRow | undefined> {
    const res = await tx.execute(sql`
      UPDATE meta_lead_pages SET enabled = false, subscribed_at = NULL, verified_at = NULL,
        last_error = NULL, last_error_kind = NULL, last_error_at = NULL
      WHERE org_id = ${orgId} AND page_id = ${pageId}
      RETURNING *`);
    const r = (res.rows as Raw[])[0];
    return r ? toPage(r) : undefined;
  }

  async deletePage(tx: Tx, orgId: number, pageId: string): Promise<void> {
    await tx.execute(
      sql`DELETE FROM meta_lead_pages WHERE org_id = ${orgId} AND page_id = ${pageId}`,
    );
  }

  /** What Meta refused, on a Page that has lead sync on (a Page that is off keeps no error: there is nothing to show). */
  async recordPageError(
    tx: Tx,
    orgId: number,
    pageId: string,
    kind: SyncErrorKind,
    message: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_pages SET last_error = ${message}, last_error_kind = ${kind}, last_error_at = now()
      WHERE org_id = ${orgId} AND page_id = ${pageId} AND enabled`);
  }

  /** A lead came in: the Page proved its token and its permission work, so the error clears. */
  async recordPageLead(tx: Tx, orgId: number, pageId: string, at: Date): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_pages
      SET last_lead_at = GREATEST(coalesce(last_lead_at, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz),
          last_error = NULL, last_error_kind = NULL, last_error_at = NULL
      WHERE org_id = ${orgId} AND page_id = ${pageId}`);
  }

  /** Every form of the Page was read to the end: Meta answered, so whatever it refused before is over. */
  async recordPageSweep(tx: Tx, orgId: number, pageId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_pages SET last_sweep_at = now(), last_error = NULL, last_error_kind = NULL, last_error_at = NULL
      WHERE org_id = ${orgId} AND page_id = ${pageId}`);
  }

  /** Every (workspace, Page) with lead sync on and at least one form picked: the sweep's work list, across tenants. */
  async pagesToSweep(tx: Tx): Promise<Array<{ orgId: number; pageId: string }>> {
    const res = await tx.execute(sql`
      SELECT p.org_id, p.page_id FROM meta_lead_pages p
      WHERE p.enabled AND EXISTS (
        SELECT 1 FROM meta_lead_forms f WHERE f.org_id = p.org_id AND f.page_id = p.page_id)
      ORDER BY p.org_id, p.id`);
    return (res.rows as Array<{ org_id: number | string; page_id: string }>).map((r) => ({
      orgId: Number(r.org_id),
      pageId: r.page_id,
    }));
  }

  // --- forms ---------------------------------------------------------------------------------------------------------------

  async listForms(tx: Tx, orgId: number, pageId?: string): Promise<FormRow[]> {
    const res = await tx.execute(sql`
      ${FORM_SELECT}
      WHERE f.org_id = ${orgId} ${pageId === undefined ? sql`` : sql`AND f.page_id = ${pageId}`}
      ORDER BY f.id`);
    return (res.rows as Raw[]).map(toForm);
  }

  async findForm(
    tx: Tx,
    orgId: number,
    pageId: string,
    formId: string,
  ): Promise<FormRow | undefined> {
    const res = await tx.execute(sql`
      ${FORM_SELECT} WHERE f.org_id = ${orgId} AND f.page_id = ${pageId} AND f.form_id = ${formId}`);
    const r = (res.rows as Raw[])[0];
    return r ? toForm(r) : undefined;
  }

  async findFormBySourceUuid(
    tx: Tx,
    orgId: number,
    sourceUuid: string,
  ): Promise<FormRow | undefined> {
    const res = await tx.execute(sql`
      ${FORM_SELECT} WHERE f.org_id = ${orgId} AND ls.uuid = ${sourceUuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    return r ? toForm(r) : undefined;
  }

  /** Picks a form (or refreshes what is cached of a form already picked: the source and the checkpoint stay). */
  async upsertForm(tx: Tx, orgId: number, v: FormUpsert): Promise<void> {
    await tx.execute(sql`
      INSERT INTO meta_lead_forms
        (org_id, page_id, form_id, name, status, locale, questions, consent_checkboxes, privacy_policy_url, source_id, connected_by)
      VALUES
        (${orgId}, ${v.pageId}, ${v.formId}, ${v.name}, ${v.status}, ${v.locale}, ${JSON.stringify(v.questions)}::jsonb,
         ${JSON.stringify(v.checkboxes)}::jsonb, ${v.privacyPolicyUrl}, ${v.sourceId}, ${v.connectedBy})
      ON CONFLICT (org_id, page_id, form_id) DO UPDATE
        SET name = EXCLUDED.name, status = EXCLUDED.status, locale = EXCLUDED.locale, questions = EXCLUDED.questions,
            consent_checkboxes = EXCLUDED.consent_checkboxes, privacy_policy_url = EXCLUDED.privacy_policy_url`);
  }

  /** Refreshes the cached questions and consent wording after a read of the form from Meta. */
  async refreshForm(
    tx: Tx,
    orgId: number,
    pageId: string,
    formId: string,
    v: Pick<
      FormUpsert,
      'name' | 'status' | 'locale' | 'questions' | 'checkboxes' | 'privacyPolicyUrl'
    >,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_forms
      SET name = ${v.name}, status = ${v.status}, locale = ${v.locale}, questions = ${JSON.stringify(v.questions)}::jsonb,
          consent_checkboxes = ${JSON.stringify(v.checkboxes)}::jsonb, privacy_policy_url = ${v.privacyPolicyUrl}
      WHERE org_id = ${orgId} AND page_id = ${pageId} AND form_id = ${formId}`);
  }

  async deleteForm(tx: Tx, orgId: number, pageId: string, formId: string): Promise<void> {
    await tx.execute(sql`
      DELETE FROM meta_lead_forms WHERE org_id = ${orgId} AND page_id = ${pageId} AND form_id = ${formId}`);
  }

  async recordFormLead(tx: Tx, orgId: number, formRowId: number, at: Date): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_forms
      SET last_lead_at = GREATEST(coalesce(last_lead_at, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz),
          last_error = NULL, last_error_at = NULL
      WHERE org_id = ${orgId} AND id = ${formRowId}`);
  }

  async recordFormError(tx: Tx, orgId: number, formRowId: number, message: string): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_forms SET last_error = ${message}, last_error_at = now()
      WHERE org_id = ${orgId} AND id = ${formRowId}`);
  }

  /** A sweep read the form to the end: the checkpoint moves to where the run started. */
  async recordFormSweep(tx: Tx, orgId: number, formRowId: number, checkpoint: Date): Promise<void> {
    await tx.execute(sql`
      UPDATE meta_lead_forms
      SET sweep_checkpoint_at = GREATEST(sweep_checkpoint_at, ${checkpoint.toISOString()}::timestamptz), last_sweep_at = now(),
          last_error = NULL, last_error_at = NULL
      WHERE org_id = ${orgId} AND id = ${formRowId}`);
  }
}
