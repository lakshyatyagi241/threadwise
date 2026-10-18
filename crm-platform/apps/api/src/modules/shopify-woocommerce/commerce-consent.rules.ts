import type { ConsentGateReason, PurposeInput } from '@crm/contracts';
import type { GatedRecipients } from '../contact-consent';

/**
 * The consent rules of the commerce sends (BL-141 follow-up, BL-278): pure, so they are unit tested without a database.
 *
 * What a store message is, for consent: the TEMPLATE decides, exactly as it does for the dispatcher (spec 4.3). A template whose
 * category (Meta's own when it re-classified the template, else the workspace's) is MARKETING is a marketing message and goes through the
 * ConsentGate; a UTILITY or AUTHENTICATION template is a notice the customer needs (order confirmation, shipping and payment status, COD
 * confirmation) and is never asked about. An abandoned-cart reminder is therefore marketing exactly when its template is MARKETING, which
 * is what Meta requires of a reminder that nudges a purchase; a store that has its reminder approved as UTILITY is sending a notice.
 */

/** Every commerce engine (unofficial number, Cloud API, Twilio) messages the customer on WhatsApp: one phone, one consent channel. */
export const COMMERCE_CONSENT_CHANNEL = 'whatsapp';

/** The purpose of sending a template: marketing for a MARKETING template, service otherwise. */
export function commercePurpose(category: string | null | undefined): PurposeInput {
  return (category ?? '').trim().toLowerCase() === 'marketing'
    ? 'marketing_messaging'
    : 'service_messaging';
}

export const isMarketing = (purpose: PurposeInput): boolean => purpose === 'marketing_messaging';

declare const clearanceBrand: unique symbol;

/**
 * Proof that the consent question was settled for one message: asked and answered "allow" (`asked`), a service message that is never
 * asked (`service`), or the merchant's own staff number (`staff`). The commerce sender takes one on every template send, and only
 * `CommerceConsentService` issues them, so a new caller cannot send a template without going through the consent step.
 */
export interface CommerceClearance {
  readonly [clearanceBrand]: true;
  readonly basis: 'asked' | 'service' | 'staff';
}

/** Issued by `CommerceConsentService` and nobody else. */
export function issueClearance(basis: CommerceClearance['basis']): CommerceClearance {
  return { basis } as unknown as CommerceClearance;
}

/**
 * One audience row can stand for several contacts (a number two contacts share). The row may be messaged only when EVERY one of them
 * may be, as the gate itself reads a phone: any withdrawal wins. When more than one refuses, the reason is `withdrawn` if any of them is,
 * else the first.
 */
export function refusalOfRow(reasons: readonly ConsentGateReason[]): ConsentGateReason | null {
  if (reasons.length === 0) return null;
  return reasons.includes('withdrawn') ? 'withdrawn' : (reasons[0] ?? null);
}

/** What `gateRecipients` is asked about: one contact (or none) behind an audience row. */
export interface Probe {
  /** Index of the audience row the probe stands for. */
  rowIndex: number;
  contactId: number | null;
}

/** Folds the per-probe split of `gateRecipients` back to one verdict per audience row, in the audience's order. */
export function foldProbes<R>(
  rows: readonly R[],
  gated: GatedRecipients<Probe>,
): { go: R[]; skipped: Array<{ row: R; reason: ConsentGateReason }> } {
  const refused = new Map<number, ConsentGateReason[]>();
  for (const s of gated.skipped) {
    refused.set(s.row.rowIndex, [...(refused.get(s.row.rowIndex) ?? []), s.reason]);
  }
  const out: { go: R[]; skipped: Array<{ row: R; reason: ConsentGateReason }> } = {
    go: [],
    skipped: [],
  };
  rows.forEach((row, i) => {
    const reason = refusalOfRow(refused.get(i) ?? []);
    if (reason) out.skipped.push({ row, reason });
    else out.go.push(row);
  });
  return out;
}

export interface SkipTally {
  skipped: number;
  skippedReasons: Array<{ reason: ConsentGateReason; count: number }>;
}

/** Adds a run's refusals to the tally carried from an earlier run (a broadcast released from the quiet hours). */
export function addSkips(
  before: Partial<SkipTally> | undefined,
  skipped: ReadonlyArray<{ reason: ConsentGateReason }>,
): SkipTally {
  const counts = new Map<ConsentGateReason, number>();
  for (const r of before?.skippedReasons ?? []) counts.set(r.reason, r.count);
  for (const r of skipped) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const skippedReasons = [...counts].map(([reason, count]) => ({ reason, count }));
  return {
    skipped: skippedReasons.reduce((n, r) => n + r.count, 0),
    skippedReasons,
  };
}
