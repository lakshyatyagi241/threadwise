import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface PaymentRow {
  id: number;
  uuid: string;
  submissionId: number;
  reference: string;
  gatewaySlug: string;
  amountMinor: bigint;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  settledVia: 'gateway' | 'manual' | null;
  providerRef: string | null;
  linkUrl: string | null;
  paidAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  submission_id: number | string;
  reference: string;
  gateway_slug: string;
  amount_minor: string;
  currency: string;
  status: PaymentRow['status'];
  settled_via: PaymentRow['settledVia'];
  provider_ref: string | null;
  link_url: string | null;
  paid_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
}

const COLS = sql`id, uuid, submission_id, reference, gateway_slug, amount_minor::text AS amount_minor, currency, status, settled_via,
  provider_ref, link_url, paid_at, expires_at, created_at`;

const toRow = (r: Raw): PaymentRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  submissionId: Number(r.submission_id),
  reference: r.reference,
  gatewaySlug: r.gateway_slug,
  amountMinor: BigInt(r.amount_minor),
  currency: r.currency,
  status: r.status,
  settledVia: r.settled_via,
  providerRef: r.provider_ref,
  linkUrl: r.link_url,
  paidAt: r.paid_at ? new Date(r.paid_at) : null,
  expiresAt: new Date(r.expires_at),
  createdAt: new Date(r.created_at),
});

/** The ledger of payment attempts behind a submission (`web_form_payments`). Raw SQL, like the submissions repository: every call is inside the caller's tenant transaction. */
@Injectable()
export class FormPaymentsRepository {
  async insert(
    tx: Tx,
    orgId: number,
    v: {
      uuid: string;
      reference: string;
      submissionId: number;
      gatewaySlug: string;
      amountMinor: bigint;
      currency: string;
      expiresAt: Date;
    },
  ): Promise<PaymentRow> {
    const res = await tx.execute(sql`
      INSERT INTO web_form_payments (org_id, uuid, submission_id, reference, gateway_slug, amount_minor, currency, expires_at)
      VALUES (${orgId}, ${v.uuid}::uuid, ${v.submissionId}, ${v.reference}, ${v.gatewaySlug}, ${v.amountMinor.toString()}::bigint,
        ${v.currency}, ${v.expiresAt.toISOString()}::timestamptz)
      RETURNING ${COLS}`);
    return toRow(res.rows[0] as unknown as Raw);
  }

  /** Locks the attempt: the settler and a staff "mark as paid" serialise on it. */
  async findByUuidForUpdate(tx: Tx, orgId: number, uuid: string): Promise<PaymentRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM web_form_payments WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
    return res.rows[0] ? toRow(res.rows[0] as unknown as Raw) : null;
  }

  async listBySubmission(tx: Tx, orgId: number, submissionId: number): Promise<PaymentRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM web_form_payments WHERE org_id = ${orgId} AND submission_id = ${submissionId} ORDER BY id DESC`);
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async listBySubmissions(
    tx: Tx,
    orgId: number,
    submissionIds: number[],
  ): Promise<Map<number, PaymentRow[]>> {
    const out = new Map<number, PaymentRow[]>();
    if (submissionIds.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT ${COLS} FROM web_form_payments
      WHERE org_id = ${orgId} AND submission_id IN (${sql.join(
        submissionIds.map((i) => sql`${i}`),
        sql`, `,
      )}) ORDER BY id DESC`);
    for (const r of (res.rows as unknown as Raw[]).map(toRow)) {
      out.set(r.submissionId, [...(out.get(r.submissionId) ?? []), r]);
    }
    return out;
  }

  async setLink(tx: Tx, orgId: number, id: number, url: string): Promise<void> {
    await tx.execute(
      sql`UPDATE web_form_payments SET link_url = ${url} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async markPaid(
    tx: Tx,
    orgId: number,
    id: number,
    via: 'gateway' | 'manual',
    providerRef: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE web_form_payments SET status = 'paid', paid_at = now(), settled_via = ${via}, provider_ref = ${providerRef}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Locks the submission a payment belongs to and says whether another attempt already paid it. */
  async lockSubmission(
    tx: Tx,
    orgId: number,
    submissionId: number,
  ): Promise<{
    uuid: string;
    status: string;
    formId: number;
    contactId: number | null;
    alreadyPaid: boolean;
  } | null> {
    const res = await tx.execute(sql`
      SELECT s.uuid, s.status, s.form_id, s.contact_id,
        EXISTS (SELECT 1 FROM web_form_payments p WHERE p.org_id = s.org_id AND p.submission_id = s.id AND p.status = 'paid') AS already_paid
      FROM web_form_submissions s WHERE s.org_id = ${orgId} AND s.id = ${submissionId} FOR UPDATE`);
    const r = res.rows[0] as
      | {
          uuid: string;
          status: string;
          form_id: number | string;
          contact_id: number | string | null;
          already_paid: boolean;
        }
      | undefined;
    return r
      ? {
          uuid: r.uuid,
          status: r.status,
          formId: Number(r.form_id),
          contactId: r.contact_id === null ? null : Number(r.contact_id),
          alreadyPaid: r.already_paid,
        }
      : null;
  }

  async setSubmissionStatus(
    tx: Tx,
    orgId: number,
    submissionId: number,
    status: 'paid' | 'awaiting_payment',
    duplicate?: boolean,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE web_form_submissions SET status = ${status}, reason = NULL,
        duplicate_payment = duplicate_payment OR ${duplicate === true}
      WHERE org_id = ${orgId} AND id = ${submissionId}`);
  }

  /** A submission by its receipt token inside one form (the public status page). */
  async findSubmissionByReceipt(
    tx: Tx,
    orgId: number,
    formId: number,
    token: string,
  ): Promise<{ id: number; status: string; versionId: number } | null> {
    const res = await tx.execute(sql`
      SELECT id, status, version_id FROM web_form_submissions
      WHERE org_id = ${orgId} AND form_id = ${formId} AND receipt_token = ${token}`);
    const r = res.rows[0] as
      { id: number | string; status: string; version_id: number | string } | undefined;
    return r ? { id: Number(r.id), status: r.status, versionId: Number(r.version_id) } : null;
  }

  /** The sweep: every workspace at once (privileged transaction), a batch at a time. Returns how many attempts expired. */
  async expireDue(tx: Tx, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE web_form_payments SET status = 'expired'
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM web_form_payments WHERE status = 'pending' AND expires_at < now()
        ORDER BY expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING 1`);
    return res.rows.length;
  }
}
