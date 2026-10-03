import type {
  MarketOperatorRequest,
  MarketRequestStatus,
  UpdateMarketRequestInput,
} from '@crm/contracts';
import { REQUEST_NOTE_MAX } from './confirmations';

export interface TriageDraft {
  status: MarketRequestStatus;
  note: string;
}

export const triageDraft = (
  r: Pick<MarketOperatorRequest, 'status' | 'operatorNote'>,
): TriageDraft => ({
  status: r.status,
  note: r.operatorNote ?? '',
});

export const noteTooLong = (note: string): boolean => note.trim().length > REQUEST_NOTE_MAX;

/**
 * The PATCH body for a triage: `rowVersion` and the fields that changed, or null when nothing did (the Save button stays off).
 * A blank note clears the stored one.
 */
export function triagePatch(
  r: Pick<MarketOperatorRequest, 'status' | 'operatorNote' | 'rowVersion'>,
  d: TriageDraft,
): UpdateMarketRequestInput | null {
  const body: UpdateMarketRequestInput = { rowVersion: r.rowVersion };
  let changed = false;
  if (d.status !== r.status) {
    body.status = d.status;
    changed = true;
  }
  const note = d.note.trim();
  if (note !== (r.operatorNote ?? '')) {
    body.operatorNote = note === '' ? null : note;
    changed = true;
  }
  return changed ? body : null;
}

/**
 * A request's website is what a workspace typed: it becomes a link only when it is an https address, and never carries credentials
 * (anything else is shown as plain text). Returns the normalised address or null.
 */
export function safeWebsite(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return url.toString();
  } catch {
    return null;
  }
}
