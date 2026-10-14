import {
  PRIVACY_OPEN_STATUSES,
  type PrivacyExport,
  type PrivacyProof,
  type PrivacyRequest,
  type PrivacyRequestEvent,
  type PrivacyRequestStatus,
} from '@crm/contracts';
import type { EventRow, ExportRow, RequestRow } from './privacy-requests.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `DSR-3F9A12BC`: short, readable aloud, derived from the uuid (the internal id never leaves the system). */
export const referenceOf = (uuid: string): string =>
  `DSR-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

const isOpen = (status: string): boolean =>
  (PRIVACY_OPEN_STATUSES as readonly string[]).includes(status);

/**
 * A text safe to show and to store beside a request: initials and the last digits, never the person's name, number or address.
 * Example: `R•••• · ••••4821`, `a•••@e•••.com`.
 */
export function maskSubject(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  const parts: string[] = [];
  const name = (input.name ?? '').trim();
  if (name) parts.push(`${[...name][0]!.toUpperCase()}••••`);
  const digits = (input.phone ?? '').replace(/\D/g, '');
  if (digits.length >= 4) parts.push(`••••${digits.slice(-4)}`);
  const email = (input.email ?? '').trim();
  if (email.includes('@')) {
    const [local, domain] = email.split('@') as [string, string];
    parts.push(`${[...local][0] ?? ''}•••@${[...domain][0] ?? ''}•••`);
  }
  return parts.length ? parts.join(' · ') : '••••';
}

export function toPrivacyRequest(r: RequestRow, now: Date = new Date()): PrivacyRequest {
  const open = isOpen(r.status);
  const msLeft = r.dueAt.getTime() - now.getTime();
  return {
    id: r.uuid,
    reference: referenceOf(r.uuid),
    requestType: r.requestType as PrivacyRequest['requestType'],
    status: r.status as PrivacyRequestStatus,
    subjectKind: r.subjectKind as PrivacyRequest['subjectKind'],
    contactId: r.contactUuid,
    leadId: r.leadUuid,
    subjectLabel: r.subjectLabel,
    requesterChannel: r.requesterChannel as PrivacyRequest['requesterChannel'],
    internalNote: r.internalNote,
    receivedAt: r.receivedAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    daysLeft: open ? Math.ceil(msLeft / DAY_MS) : null,
    overdue: open && msLeft < 0,
    verificationMethod: r.verificationMethod as PrivacyRequest['verificationMethod'],
    verificationEvidenceRef: r.verificationEvidenceRef,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    legalHold: r.legalHold,
    legalHoldReason: r.legalHoldReason,
    historyMode: r.historyMode as PrivacyRequest['historyMode'],
    rejectionReason: r.rejectionReason,
    dryRun: r.dryRunSummary,
    result: r.resultSummary,
    proof: (r.proof as PrivacyProof | null) ?? null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    rowVersion: r.rowVersion,
    allowed: {
      verify: r.status === 'received' || r.status === 'verifying',
      export: r.status === 'in_progress',
      erase: r.status === 'in_progress' && r.requestType === 'erasure' && !r.legalHold,
      hold: open,
      reject: open,
    },
  };
}

export function toPrivacyEvent(e: EventRow): PrivacyRequestEvent {
  return {
    id: e.uuid,
    eventType: e.eventType,
    fromStatus: e.fromStatus as PrivacyRequestStatus | null,
    toStatus: e.toStatus as PrivacyRequestStatus | null,
    actor: e.actorName,
    detail: e.detail,
    at: e.createdAt.toISOString(),
  };
}

export function toPrivacyExport(x: ExportRow, now: Date = new Date()): PrivacyExport {
  const expired =
    x.status === 'ready' && x.expiresAt !== null && x.expiresAt.getTime() <= now.getTime();
  return {
    id: x.uuid,
    status: expired ? 'expired' : (x.status as PrivacyExport['status']),
    fileBytes: x.fileBytes,
    sections: x.sectionCounts,
    error: x.error,
    requestedAt: x.requestedAt.toISOString(),
    completedAt: x.completedAt ? x.completedAt.toISOString() : null,
    expiresAt: x.expiresAt ? x.expiresAt.toISOString() : null,
  };
}
