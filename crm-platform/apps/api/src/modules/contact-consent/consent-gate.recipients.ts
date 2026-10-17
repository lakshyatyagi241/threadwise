import type { ConsentGateReason, ConsentGateResult, PurposeInput } from '@crm/contracts';
import type { ConsentGate } from './consent-gate.service';

/**
 * What the broadcast senders of the social and messaging channels (Messenger, Telegram, Viber, LINE, WeChat, Instagram) share to put every
 * recipient of a MARKETING message through the ConsentGate before the message leaves (BL-141 follow-up, BL-191). The gate is asked for the
 * whole claimed slice in ONE call, on the first send and on a send released from the quiet hours alike, so a STOP that arrived while the
 * message waited still stops it.
 *
 * The rule is the gate's own and is not repeated here: a withdrawal always denies; a flagged minor or a Do-Not-Call number is held back
 * when the workspace says so; with the workspace switch "Require recorded consent for marketing sends" ON a recorded grant on the channel
 * is also needed, with it OFF (the default) everyone else goes. Service and utility messages are never asked about here (a broadcast is
 * marketing by nature; a reply typed in the inbox is a person answering a person and goes through the dispatcher).
 */

export interface SkippedRecipient<T> {
  row: T;
  /** The closed-set reason of the gate (`CONSENT_GATE_REASONS`), the stable code kept on the recipient and counted on the result. */
  reason: ConsentGateReason;
}

export interface GatedRecipients<T> {
  /** The recipients that may be messaged. */
  go: T[];
  /** The recipients that must not be messaged, each with the reason. */
  skipped: Array<SkippedRecipient<T>>;
}

/** The text a skipped recipient keeps: the stable reason code is in the brackets, so a list or a report can read it back. */
export function consentSkipNote(reason: ConsentGateReason): string {
  return `Not messaged: consent (${reason})`;
}

/** The reason out of a note written by `consentSkipNote`, or null for any other text. */
export function consentSkipReason(note: string | null | undefined): string | null {
  const m = /^Not messaged: consent \(([a-z_]+)\)$/.exec(note ?? '');
  return m ? (m[1] ?? null) : null;
}

/**
 * Splits a claimed slice into who may be messaged and who is skipped. A recipient that is a known contact is read by one statement for the
 * whole slice (`checkMany`); one that is not (a group, a person who never became a contact) has nothing on record, so it is asked as an
 * anonymous subject: allowed while the switch is off, `no_consent_recorded` while it is on. A gate that cannot decide denies marketing
 * (`gate_unavailable_closed`), so nobody is messaged unchecked.
 */
export async function gateRecipients<T extends { contactId: number | null }>(
  gate: ConsentGate,
  orgId: number,
  rows: readonly T[],
  channel: string,
  purpose: PurposeInput = 'marketing_messaging',
): Promise<GatedRecipients<T>> {
  const out: GatedRecipients<T> = { go: [], skipped: [] };
  if (rows.length === 0) return out;

  const ids = rows.flatMap((r) => (r.contactId === null ? [] : [r.contactId]));
  const many = ids.length > 0 ? await gate.checkMany(orgId, ids, channel, purpose) : null;
  const anonymous: ConsentGateResult | null = rows.some((r) => r.contactId === null)
    ? await gate.check(orgId, { type: 'anonymous' }, channel, purpose)
    : null;

  for (const row of rows) {
    const verdict = row.contactId === null ? anonymous : many?.decisions.get(row.contactId);
    // No answer for a contact is a gate that did not decide: marketing is refused, never sent unchecked.
    if (!verdict) out.skipped.push({ row, reason: 'gate_unavailable_closed' });
    else if (verdict.decision === 'allow') out.go.push(row);
    else out.skipped.push({ row, reason: verdict.reason });
  }
  return out;
}

/** How many recipients were skipped for each reason, in the order the reasons first appear. */
export function countSkipReasons(
  skipped: ReadonlyArray<{ reason: ConsentGateReason }>,
): Array<{ reason: ConsentGateReason; count: number }> {
  const counts = new Map<ConsentGateReason, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count }));
}
