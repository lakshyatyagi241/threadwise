import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { FormSubmissionStatus, RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface SubmissionRow {
  id: number;
  uuid: string;
  formId: number;
  formUuid: string;
  versionId: number;
  versionNumber: number;
  idempotencyKey: string;
  receiptToken: string;
  status: FormSubmissionStatus;
  reason: string | null;
  error: string | null;
  answers: Record<string, unknown>;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  companyId: number | null;
  companyUuid: string | null;
  companyName: string | null;
  utm: Record<string, string>;
  referrer: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  consent: { given: boolean; text: string; version: number; at: string } | null;
  spamScore: number;
  duplicatePayment: boolean;
  payloadPurgedAt: Date | null;
  erasedAt: Date | null;
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

const toRow = (r: Raw): SubmissionRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  formId: Number(r.form_id),
  formUuid: r.form_uuid as string,
  versionId: Number(r.version_id),
  versionNumber: Number(r.version_number),
  idempotencyKey: r.idempotency_key as string,
  receiptToken: r.receipt_token as string,
  status: r.status as FormSubmissionStatus,
  reason: s(r.reason),
  error: s(r.error),
  answers: (r.answers as Record<string, unknown>) ?? {},
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  companyId: n(r.company_id),
  companyUuid: s(r.company_uuid),
  companyName: s(r.company_name),
  utm: (r.utm as Record<string, string>) ?? {},
  referrer: s(r.referrer),
  pageUrl: s(r.page_url),
  userAgent: s(r.user_agent),
  consent: (r.consent as SubmissionRow['consent']) ?? null,
  spamScore: Number(r.spam_score),
  duplicatePayment: r.duplicate_payment === true,
  payloadPurgedAt: d(r.payload_purged_at),
  erasedAt: d(r.erased_at),
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const SELECT = sql`
  SELECT x.*, to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
         f.uuid AS form_uuid, v.version AS version_number,
         c.uuid AS contact_uuid, c.name AS contact_name, co.uuid AS company_uuid, co.name AS company_name
  FROM web_form_submissions x
  JOIN web_forms f ON f.org_id = x.org_id AND f.id = x.form_id
  JOIN web_form_versions v ON v.org_id = x.org_id AND v.id = x.version_id
  LEFT JOIN contacts c ON c.org_id = x.org_id AND c.id = x.contact_id
  LEFT JOIN companies co ON co.org_id = x.org_id AND co.id = x.company_id`;

/**
 * The record scope of a submission: it is visible to whoever may see its form (`own`: created by me) or owns the contact it made. The
 * submissions list always joins the form (`f`) and the contact (`c`).
 */
export function submissionScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  if (scope === 'own') return sql`(f.created_by = ${actorUserId} OR c.owner_id = ${actorUserId})`;
  const peers = sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId})`;
  return sql`(f.created_by = ${actorUserId} OR c.owner_id = ${actorUserId} OR f.created_by IN ${peers} OR c.owner_id IN ${peers})`;
}

export interface ClaimInput {
  formId: number;
  versionId: number;
  idempotencyKey: string;
  receiptToken: string;
  status: 'received' | 'spam';
  reason?: string | null;
  answers: Record<string, unknown>;
  utm: Record<string, string>;
  referrer: string | null;
  pageUrl: string | null;
  ipHash: string | null;
  userAgent: string | null;
  consent: unknown;
  spamScore: number;
  answersExpiresAt: Date | null;
}

export type Claim =
  /** A new submission: this call owns it. */
  | { kind: 'claimed'; row: SubmissionRow }
  /** The same submission was received before: its stored outcome is the answer. */
  | { kind: 'repeat'; row: SubmissionRow }
  /** A `failed` (or abandoned, still `received`) submission delivered again: this call takes it over and processes it. */
  | { kind: 'reclaimed'; row: SubmissionRow };

/** A `received` submission older than this is taken to be abandoned by a crashed process (the pipeline finishes in well under a second). */
const STALE_RECEIVED_MS = 5 * 60_000;

const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface ListFilter {
  status?: FormSubmissionStatus;
  tab?: 'all' | 'needs_attention' | 'spam';
  from?: Date;
  to?: Date;
  q?: string;
  contactId?: number;
  scope?: SQL;
}

@Injectable()
export class FormSubmissionsRepository {
  /**
   * Stores a submission before anything else happens to it: idempotency is the unique key, not a check-then-insert. The conflict path
   * locks the existing row so two simultaneous repeats count correctly and only one can take over a failed submission.
   */
  async claim(tx: Tx, orgId: number, input: ClaimInput): Promise<Claim> {
    const inserted = await tx.execute(sql`
      INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status, reason, answers, utm, referrer,
                                        page_url, ip_hash, user_agent, consent, spam_score, answers_expires_at)
      VALUES (${orgId}, ${input.formId}, ${input.versionId}, ${input.idempotencyKey}, ${input.receiptToken}, ${input.status},
              ${input.reason ?? null}, ${JSON.stringify(input.answers)}::jsonb, ${JSON.stringify(input.utm)}::jsonb, ${input.referrer},
              ${input.pageUrl}, ${input.ipHash}, ${input.userAgent}, ${input.consent === null ? null : JSON.stringify(input.consent)}::jsonb,
              ${input.spamScore}, ${input.answersExpiresAt?.toISOString() ?? null}::timestamptz)
      ON CONFLICT (org_id, form_id, idempotency_key) DO NOTHING
      RETURNING id`);
    const insertedId = (inserted.rows[0] as { id: number | string } | undefined)?.id;
    if (insertedId !== undefined) {
      return { kind: 'claimed', row: (await this.findById(tx, orgId, Number(insertedId)))! };
    }
    const existing = await tx.execute(sql`
      SELECT id, status, updated_at FROM web_form_submissions
      WHERE org_id = ${orgId} AND form_id = ${input.formId} AND idempotency_key = ${input.idempotencyKey}
      FOR UPDATE`);
    const e = existing.rows[0] as
      { id: number | string; status: string; updated_at: string } | undefined;
    // The row can only vanish between the two statements if its form was deleted meanwhile.
    if (!e) return this.claimAfterVanish(tx, orgId, input);
    const id = Number(e.id);
    const stale =
      e.status === 'received' && Date.now() - new Date(e.updated_at).getTime() > STALE_RECEIVED_MS;
    if (e.status === 'failed' || stale) {
      await tx.execute(sql`
        UPDATE web_form_submissions SET status = 'received', reason = NULL, error = NULL,
          answers = ${JSON.stringify(input.answers)}::jsonb, utm = ${JSON.stringify(input.utm)}::jsonb, referrer = ${input.referrer},
          page_url = ${input.pageUrl}, version_id = ${input.versionId}, payload_purged_at = NULL
        WHERE org_id = ${orgId} AND id = ${id}`);
      return { kind: 'reclaimed', row: (await this.findById(tx, orgId, id))! };
    }
    return { kind: 'repeat', row: (await this.findById(tx, orgId, id))! };
  }

  private async claimAfterVanish(tx: Tx, orgId: number, input: ClaimInput): Promise<Claim> {
    const res = await tx.execute(sql`
      INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status, reason, answers, utm, referrer,
                                        page_url, ip_hash, user_agent, consent, spam_score, answers_expires_at)
      VALUES (${orgId}, ${input.formId}, ${input.versionId}, ${input.idempotencyKey}, ${input.receiptToken}, ${input.status},
              ${input.reason ?? null}, ${JSON.stringify(input.answers)}::jsonb, ${JSON.stringify(input.utm)}::jsonb, ${input.referrer},
              ${input.pageUrl}, ${input.ipHash}, ${input.userAgent}, ${input.consent === null ? null : JSON.stringify(input.consent)}::jsonb,
              ${input.spamScore}, ${input.answersExpiresAt?.toISOString() ?? null}::timestamptz)
      RETURNING id`);
    return {
      kind: 'claimed',
      row: (await this.findById(tx, orgId, Number((res.rows[0] as { id: number | string }).id)))!,
    };
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<SubmissionRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE x.org_id = ${orgId} AND x.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    formId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<SubmissionRow | undefined> {
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM web_form_submissions WHERE org_id = ${orgId} AND form_id = ${formId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    }
    const res = await tx.execute(
      sql`${SELECT} WHERE x.org_id = ${orgId} AND x.form_id = ${formId} AND x.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** Does the caller's record scope let them see this submission? `scope` undefined (= `all`) always does. */
  async visible(tx: Tx, orgId: number, id: number, scope: SQL | undefined): Promise<boolean> {
    if (!scope) return true;
    const res = await tx.execute(sql`
      SELECT 1 FROM web_form_submissions x
      JOIN web_forms f ON f.org_id = x.org_id AND f.id = x.form_id
      LEFT JOIN contacts c ON c.org_id = x.org_id AND c.id = x.contact_id
      WHERE x.org_id = ${orgId} AND x.id = ${id} AND ${scope} LIMIT 1`);
    return res.rows.length > 0;
  }

  private where(orgId: number, formId: number, f: ListFilter): SQL[] {
    const where: SQL[] = [sql`x.org_id = ${orgId}`, sql`x.form_id = ${formId}`];
    if (f.status) where.push(sql`x.status = ${f.status}`);
    if (f.tab === 'needs_attention') where.push(sql`x.status IN ('needs_review', 'failed')`);
    else if (f.tab === 'spam') where.push(sql`x.status = 'spam'`);
    else if ((f.tab === undefined || f.tab === 'all') && !f.status)
      where.push(sql`x.status <> 'spam'`);
    if (f.from) where.push(sql`x.created_at >= ${f.from.toISOString()}::timestamptz`);
    if (f.to) where.push(sql`x.created_at < ${f.to.toISOString()}::timestamptz`);
    if (f.contactId !== undefined) where.push(sql`x.contact_id = ${f.contactId}`);
    if (f.q) {
      const like = `%${escapeLike(f.q)}%`;
      // The answers are searched as text: the name, email and phone a visitor typed are all in there. Erased and purged rows have none.
      where.push(
        sql`(x.answers::text ILIKE ${like} OR c.name ILIKE ${like} OR c.email::text ILIKE ${like})`,
      );
    }
    if (f.scope) where.push(f.scope);
    return where;
  }

  /** Newest first, keyset on (created_at, id). */
  async list(
    tx: Tx,
    orgId: number,
    formId: number,
    f: ListFilter & { limit: number; cursor?: string; order: 'asc' | 'desc' },
  ): Promise<SubmissionRow[]> {
    const where = this.where(orgId, formId, f);
    if (f.cursor) {
      const c = decodeCursor(f.cursor);
      const bound = c.createdAtIso ?? c.createdAt.toISOString();
      where.push(
        f.order === 'asc'
          ? sql`(x.created_at, x.id) > (${bound}::timestamptz, ${c.id})`
          : sql`(x.created_at, x.id) < (${bound}::timestamptz, ${c.id})`,
      );
    }
    const order =
      f.order === 'asc' ? sql`x.created_at ASC, x.id ASC` : sql`x.created_at DESC, x.id DESC`;
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** The newest rows for an export, capped. */
  async listForExport(
    tx: Tx,
    orgId: number,
    formId: number,
    f: ListFilter,
    cap: number,
  ): Promise<SubmissionRow[]> {
    const where = this.where(orgId, formId, f);
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY x.created_at DESC, x.id DESC LIMIT ${cap + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: FormSubmissionStatus;
      reason?: string | null;
      error?: string | null;
      contactId?: number | null;
      companyId?: number | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE web_form_submissions SET status = ${v.status}, reason = ${v.reason ?? null}, error = ${v.error ?? null},
        contact_id = ${v.contactId ?? null}, company_id = ${v.companyId ?? null}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The submission's re-run: back to `received` so a concurrent delivery treats it as in flight. */
  async markRetry(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE web_form_submissions SET status = 'received', reason = NULL, error = NULL WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The "not spam" action: a spam submission goes back to `received` to be processed. */
  async markNotSpam(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE web_form_submissions SET status = 'received', reason = NULL, spam_score = 0 WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Erase (GDPR): the answers and everything that identifies the visitor go; the row stays as a tombstone with its outcome and links,
   * and the consent evidence stays. The contact is an ordinary CRM record and is never touched here.
   */
  async erase(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE web_form_submissions SET answers = '{}'::jsonb, utm = '{}'::jsonb, referrer = NULL, page_url = NULL, user_agent = NULL,
        ip_hash = NULL, erased_at = now(), payload_purged_at = coalesce(payload_purged_at, now())
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Accepted submissions in `[from, to)`: the number the monthly cap is compared with. Spam is not accepted. */
  async countAccepted(tx: Tx, orgId: number, from: Date, to: Date): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM web_form_submissions
      WHERE org_id = ${orgId} AND status <> 'spam' AND NOT (status = 'needs_review' AND reason = 'submissions_cap')
        AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz`);
    return Number((res.rows[0] as { n: number | string }).n);
  }

  /** The definitions of a page of versions, keyed by version id: what the labels and the preview of a list are read from. */
  async versionDefinitions(
    tx: Tx,
    orgId: number,
    ids: number[],
  ): Promise<Map<number, Record<string, unknown>>> {
    const out = new Map<number, Record<string, unknown>>();
    if (ids.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT id, definition FROM web_form_versions
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        [...new Set(ids)].map((i) => sql`${i}`),
        sql`, `,
      )})`);
    for (const r of res.rows as Array<{
      id: number | string;
      definition: Record<string, unknown>;
    }>) {
      out.set(Number(r.id), r.definition);
    }
    return out;
  }

  /** The failure record of a submission whose transaction rolled back: its own row, so the visitor's retry with the same key finds it. */
  async recordFailure(tx: Tx, orgId: number, input: ClaimInput & { error: string }): Promise<void> {
    await tx.execute(sql`
      INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status, reason, error, answers, utm,
                                        referrer, page_url, ip_hash, user_agent, consent, spam_score, answers_expires_at)
      VALUES (${orgId}, ${input.formId}, ${input.versionId}, ${input.idempotencyKey}, ${input.receiptToken}, 'failed', 'internal_error',
              ${input.error.slice(0, 500)}, ${JSON.stringify(input.answers)}::jsonb, ${JSON.stringify(input.utm)}::jsonb, ${input.referrer},
              ${input.pageUrl}, ${input.ipHash}, ${input.userAgent}, ${input.consent === null ? null : JSON.stringify(input.consent)}::jsonb,
              ${input.spamScore}, ${input.answersExpiresAt?.toISOString() ?? null}::timestamptz)
      ON CONFLICT (org_id, form_id, idempotency_key) DO UPDATE
        SET status = 'failed', reason = 'internal_error', error = EXCLUDED.error`);
  }
}
