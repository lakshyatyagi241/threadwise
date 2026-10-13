import { createHash } from 'node:crypto';
import { CONSENT_EVIDENCE_KEYS } from '@crm/contracts';

/** What a new event does to the stored state. Pure, so the rule is unit tested without a database. */
export interface Transition {
  /** The state to store, or null when the event is history only (older than the stored state). */
  nextState: 'granted' | 'withdrawn' | null;
  /** The stored state really changed (drives the outbox event and the contact flag). */
  stateChanged: boolean;
}

export function transition(
  prior: { state: string; lastOccurredAt: string } | null,
  action: 'granted' | 'withdrawn',
  occurredAt: Date,
): Transition {
  if (prior && new Date(prior.lastOccurredAt).getTime() > occurredAt.getTime()) {
    return { nextState: null, stateChanged: false };
  }
  return { nextState: action, stateChanged: prior?.state !== action };
}

/**
 * The contact flag after an event. A withdrawal always sets it. A grant clears it only when it reverses a withdrawal that the ledger
 * knows about and no other channel is still withdrawn: a legacy flag with no ledger row is never cleared by an unrelated grant.
 */
export function flagAfter(
  action: 'granted' | 'withdrawn',
  priorState: string | undefined,
  anyOtherWithdrawn: boolean,
): boolean | null {
  if (action === 'withdrawn') return true;
  if (priorState === 'withdrawn' && !anyOtherWithdrawn) return false;
  return null;
}

const ALLOWED = new Set<string>(CONSENT_EVIDENCE_KEYS);

/** Only the known evidence keys, short strings; nothing else is stored (no IP, no free text). */
export function cleanEvidence(input: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (!ALLOWED.has(k) || v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s !== '') out[k] = s.slice(0, 300);
  }
  return out;
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A CSV cell that a spreadsheet will not run as a formula, quoted when it needs it. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** The fields of a ledger event that the proof CSV carries (the repository's `EventRow` has them all). */
export interface ProofRow {
  contactUuid: string | null;
  channel: string;
  purpose: string;
  action: string;
  source: string;
  occurredAt: string;
  recordedAt: string;
  actorName: string | null;
  note: string | null;
  evidence: Record<string, unknown>;
}

/** One line of the proof CSV (no line break); shared by the direct download and the asynchronous export, so they can never differ. */
export function proofCsvLine(r: ProofRow): string {
  return csvLine([
    r.contactUuid ?? '(erased)',
    r.channel,
    r.purpose,
    r.action,
    r.source,
    r.occurredAt,
    r.recordedAt,
    r.actorName ?? '',
    r.note ?? '',
    JSON.stringify(r.evidence),
  ]);
}

export const CONSENT_CSV_HEADER = [
  'contact_id',
  'channel',
  'purpose',
  'action',
  'source',
  'occurred_at',
  'recorded_at',
  'recorded_by',
  'note',
  'evidence',
];
