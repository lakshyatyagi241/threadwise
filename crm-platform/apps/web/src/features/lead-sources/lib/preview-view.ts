import type { LeadMappingPreviewResponse } from '@crm/contracts';
import { ATTRIBUTION_FIELDS, type AttributionField } from './draft';

/**
 * The mapping preview as the screen shows it: what the draft mapping makes of a payload, field by field, and whether the lead would
 * be processed. Pure, so each state (nothing received yet, an event, a pasted payload, an unreadable phone) has a test.
 */

/** The reason codes `POST /mapping-preview` answers today (docs/api/leads.md); another one is shown as the server wrote it. */
export const PREVIEW_REASON_CODES = [
  'no_payload',
  'no_contact_point',
  'invalid_phone',
  'phone_unreadable',
  'email_invalid',
] as const;
const REASON_SET: ReadonlySet<string> = new Set(PREVIEW_REASON_CODES);

export type PhoneState = 'none' | 'ok' | 'unreadable';

export interface PreviewReason {
  code: string;
  known: boolean;
}

export interface PreviewView {
  /** `none`: the source has received nothing it still holds and no sample was pasted. */
  state: 'none' | 'ready';
  basedOn: LeadMappingPreviewResponse['basedOn'];
  eventId: string | null;
  externalId: string | null;
  contact: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phoneRaw: string | null;
    phone: string | null;
    phoneState: PhoneState;
  };
  customFields: Array<{ key: string; value: string }>;
  attribution: Array<{ field: AttributionField; value: string | null }>;
  availablePaths: string[];
  usable: boolean;
  reasons: PreviewReason[];
}

/** A custom value is a string, a number, a boolean, a list: shown as text. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function previewView(res: LeadMappingPreviewResponse): PreviewView {
  const phoneState: PhoneState =
    res.contact.phoneRaw === null || res.contact.phoneRaw.trim() === ''
      ? res.contact.phone
        ? 'ok'
        : 'none'
      : res.contact.phone
        ? 'ok'
        : 'unreadable';
  return {
    state: res.basedOn === 'none' ? 'none' : 'ready',
    basedOn: res.basedOn,
    eventId: res.eventId,
    externalId: res.externalId,
    contact: { ...res.contact, phoneState },
    customFields: Object.entries(res.customFields).map(([key, value]) => ({
      key,
      value: valueText(value),
    })),
    attribution: ATTRIBUTION_FIELDS.map((field) => ({ field, value: res.attribution[field] })),
    // The paths are offered as they came, once each, in the payload's own order.
    availablePaths: [...new Set(res.availablePaths)],
    usable: res.usable,
    reasons: res.reasons.map((code) => ({ code, known: REASON_SET.has(code) })),
  };
}

/**
 * The key the live preview refetches on: it changes when the draft or the chosen payload changes, so a settled draft is one request.
 * The pasted text is part of it through the parsed payload, never through the raw text, so a typo mid-edit does not trigger a call.
 */
export function previewKey(body: unknown): string {
  return JSON.stringify(body);
}

/** Which payload the preview reads. Reading a stored one writes an audit row, so it is always an explicit choice. */
export type PreviewSource =
  | { kind: 'paste'; payload: Record<string, unknown> | null }
  | { kind: 'last' }
  | { kind: 'event'; eventId: string };

/** The preview is not called until there is something to read: a payload, the last lead, or an event the person picked. */
export const previewIsReady = (s: PreviewSource | null): boolean =>
  s !== null && (s.kind !== 'paste' || s.payload !== null);
