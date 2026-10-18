import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

export interface AttributionRow {
  id: number;
  uuid: string;
  contactId: number;
  platform: string | null;
  sourceLabel: string;
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  form: string | null;
  /** `evidence`: the touch's own record (a migrated Waboo touch keeps its channel and module type here). */
  evidence: Record<string, unknown>;
  leadSourceUuid: string | null;
  capturedAt: Date;
}

const toRow = (r: Raw): AttributionRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  contactId: Number(r.contact_id),
  platform: s(r.platform),
  sourceLabel: r.source_label as string,
  campaign: s(r.campaign),
  adset: s(r.adset),
  ad: s(r.ad),
  form: s(r.form),
  evidence:
    r.evidence && typeof r.evidence === 'object' ? (r.evidence as Record<string, unknown>) : {},
  leadSourceUuid: s(r.lead_source_uuid),
  capturedAt: new Date(r.captured_at as string),
});

const SELECT = sql`
  SELECT a.*, ls.uuid AS lead_source_uuid
  FROM contact_attributions a
  LEFT JOIN lead_sources ls ON ls.org_id = a.org_id AND ls.id = a.source_id`;

export interface NewAttribution {
  contactId: number;
  leadEventId: number;
  sourceId: number;
  platform: string | null;
  sourceLabel: string;
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  form: string | null;
  capturedAt: Date;
}

/** Append-only touches of a contact. Nothing here updates or deletes a row: the table refuses it too. */
@Injectable()
export class LeadAttributionsRepository {
  /** One touch per lead event: a retried event finds its touch already there and writes nothing. */
  async insert(tx: Tx, orgId: number, v: NewAttribution): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO contact_attributions
        (org_id, contact_id, lead_event_id, source_id, platform, source_label, campaign, adset, ad, form, captured_at)
      VALUES (${orgId}, ${v.contactId}, ${v.leadEventId}, ${v.sourceId}, ${v.platform}, ${v.sourceLabel}, ${v.campaign},
              ${v.adset}, ${v.ad}, ${v.form}, ${v.capturedAt.toISOString()}::timestamptz)
      ON CONFLICT (org_id, lead_event_id) WHERE lead_event_id IS NOT NULL DO NOTHING
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** Newest first. */
  async listForContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    limit: number,
  ): Promise<AttributionRow[]> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE a.org_id = ${orgId} AND a.contact_id = ${contactId}
      ORDER BY a.captured_at DESC, a.id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async firstForContact(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<AttributionRow | undefined> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE a.org_id = ${orgId} AND a.contact_id = ${contactId}
      ORDER BY a.captured_at ASC, a.id ASC LIMIT 1`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async countForContact(tx: Tx, orgId: number, contactId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM contact_attributions WHERE org_id = ${orgId} AND contact_id = ${contactId}`);
    return Number((res.rows[0] as { n: number }).n);
  }
}
