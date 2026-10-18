import type { LegalHold, LegalHoldHistoryEntry } from '@crm/contracts';
import type { HistoryRow, HoldRow } from './legal-holds.repository';

/** The wire shape of a hold. The note is part of it: only readers of the register (`privacy.requests.read`) ever receive it. */
export function toLegalHold(r: HoldRow, now: Date = new Date()): LegalHold {
  return {
    id: r.uuid,
    scope: r.scope,
    subjectId: r.scope === 'contact' ? r.contactUuid : r.scope === 'lead' ? r.leadUuid : null,
    subjectLabel: r.subjectLabel,
    reasonCategory: r.reasonCategory as LegalHold['reasonCategory'],
    caseRef: r.caseRef,
    note: r.note,
    reviewAt: r.reviewAt ? r.reviewAt.toISOString() : null,
    reviewDue: r.status === 'active' && r.reviewAt !== null && r.reviewAt.getTime() < now.getTime(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    status: r.status,
    placedBy: r.placedByName,
    placedAt: r.placedAt.toISOString(),
    lastReviewedBy: r.lastReviewedByName,
    lastReviewedAt: r.lastReviewedAt ? r.lastReviewedAt.toISOString() : null,
    releasedBy: r.releasedByName,
    releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
    releaseNote: r.releaseNote,
    restrictedCases: r.restrictedCases,
    rowVersion: r.rowVersion,
  };
}

/** The register's history: field names and values of the hold (category, dates, status); the note and the case wording never appear in an audit delta. */
export function toHistoryEntry(h: HistoryRow): LegalHoldHistoryEntry {
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h.delta ?? {})) changes[k] = v.new;
  return { at: h.at.toISOString(), action: h.action, actor: h.actor, changes };
}
