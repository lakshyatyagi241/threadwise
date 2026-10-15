import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * A click-to-WhatsApp ad as evidence of how a person reached us (BL-169, privacy spec 4.3.2).
 *
 * POLICY: a first inbound message permits replying only. Clicking an ad and writing is not an agreement to marketing, so this never
 * touches the consent ledger: it is one append-only attribution touch on the contact (`contact_attributions`, first touch = earliest),
 * with the referral fields as its evidence. The gate, the ledger state and the subscription labels stay exactly as they were.
 */

/** The label a touch from a click-to-WhatsApp ad carries (the platform and the source label shown on the contact). */
export const CTWA_PLATFORM = 'click_to_whatsapp';
export const CTWA_LABEL = 'Click to WhatsApp ad';

const FIELD_MAX = {
  sourceType: 40,
  sourceId: 100,
  sourceUrl: 500,
  headline: 200,
  body: 300,
  ctwaClid: 300,
};

export interface AdReferral {
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  ctwaClid: string | null;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

/** The referral an adapter left on a message's meta, cleaned and bounded; null when there is nothing worth keeping. */
export function referralOf(meta: unknown): AdReferral | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const r = (meta as Record<string, unknown>).referral;
  if (typeof r !== 'object' || r === null) return null;
  const o = r as Record<string, unknown>;
  const out: AdReferral = {
    sourceType: text(o.sourceType, FIELD_MAX.sourceType),
    sourceId: text(o.sourceId, FIELD_MAX.sourceId),
    sourceUrl: text(o.sourceUrl, FIELD_MAX.sourceUrl),
    headline: text(o.headline, FIELD_MAX.headline),
    body: text(o.body, FIELD_MAX.body),
    ctwaClid: text(o.ctwaClid, FIELD_MAX.ctwaClid),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** The evidence object stored on the touch: only the fields that have a value. */
export function referralEvidence(r: AdReferral): Record<string, string> {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) as Record<
    string,
    string
  >;
}

/**
 * Appends the touch for one message. Idempotent per provider message (`external_ref`): a redelivery writes nothing. An ad's id is also
 * the touch's `ad`, so a report by ad finds it; a post or a plain link keeps its id in the evidence only.
 */
export async function recordAdReferral(
  tx: Tx,
  orgId: number,
  v: { contactId: number; referral: AdReferral; providerMessageId: string; at: Date },
): Promise<boolean> {
  const ad = v.referral.sourceType === 'ad' ? v.referral.sourceId : null;
  const res = await tx.execute(sql`
    INSERT INTO contact_attributions
      (org_id, contact_id, platform, source_label, ad, evidence, external_ref, captured_at)
    VALUES (${orgId}, ${v.contactId}, ${CTWA_PLATFORM}, ${CTWA_LABEL}, ${ad},
            ${JSON.stringify(referralEvidence(v.referral))}::jsonb,
            ${`ctwa:${v.providerMessageId}`.slice(0, 200)}, ${v.at.toISOString()}::timestamptz)
    ON CONFLICT (org_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
    RETURNING id`);
  return res.rows.length > 0;
}
