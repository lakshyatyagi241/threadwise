import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { FieldResponse } from '@crm/contracts';
import type { ContactRow } from '../api/schemas';
import { scoreChange, scoreToText } from '@/features/lead-scoring/lib/score';
import { inputToValue, type InputValue } from './field-values';
import { OTHER_REASON, type lostReasonPayload } from './stage-flow';

/**
 * Contact display and form rules (TW-CON-008, 010, 012, 015, 016, 017), kept free of React so they can be tested.
 *
 * Reference keeps title, middle name, language, address, memo, status and source on the contact row or inside its
 * `custom_attributes` JSON. Our contacts table has first/last name, phone, email, status, source and the consent flag;
 * title, middle name, language, address and memo have no column yet, so they are stored in `customFields` under the
 * reserved keys below (the workspace's own attributes use their own keys). `source` is written to its column and
 * mirrored there too until the write contract accepts it. When the API grows columns for the rest, only this file changes.
 */

/** Keys the contact form writes into `customFields` itself. Attribute chips and the attribute inputs skip them. */
export const EXTRA_KEYS = {
  title: 'title',
  middleName: 'middle_name',
  language: 'language',
  address: 'address',
  memo: 'memo',
  source: 'source',
} as const;

export const RESERVED_CUSTOM_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(EXTRA_KEYS),
  'status',
]);

/** Titles offered in the form. There is no default: an empty title stays empty (Reference forced "Mr"). */
export const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr'] as const;

/** Status choices when the workspace has configured none (Reference's fixed list). */
export const FALLBACK_STATUSES = ['active', 'prospect', 'customer', 'vip'] as const;

/** Marketing opt-out (TW-CON-017): broadcasts and campaigns skip these contacts. */
export function isOptedOut(c: Pick<ContactRow, 'isUnsubscribed'>): boolean {
  return c.isUnsubscribed;
}

const clean = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Display name = first + middle + last, skipping empty parts. The title is not part of it (the API's own rule:
 * Reference's "Mr" default turned every UI-created contact, and every {{name}} merge tag, into "Mr Aarav"). A surname
 * already at the end of the first name is not appended twice (Reference imports rebuilt "Aarav Sharma Sharma").
 */
export function composeName(parts: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): string {
  const first = clean(parts.firstName);
  const last = clean(parts.lastName);
  const lastAlreadyThere = last !== '' && first.toLowerCase().endsWith(last.toLowerCase());
  return [first, clean(parts.middleName), lastAlreadyThere ? '' : last].filter(Boolean).join(' ');
}

export function displayName(
  c: Pick<ContactRow, 'name' | 'firstName' | 'lastName' | 'phone' | 'email'>,
): string {
  return (
    clean(c.name) ||
    [clean(c.firstName), clean(c.lastName)].filter(Boolean).join(' ') ||
    clean(c.phone) ||
    clean(c.email)
  );
}

/** One or two letters for the avatar circle: the first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters =
    words.length === 1 ? [...words[0]!].slice(0, 2) : [[...words[0]!][0]!, [...words[1]!][0]!];
  return letters.join('').toLocaleUpperCase();
}

/** Six fixed avatar tints, picked from the contact id so a person keeps the same colour everywhere. */
export const AVATAR_TONES = [
  'bg-rose-100 text-rose-900',
  'bg-emerald-100 text-emerald-900',
  'bg-amber-100 text-amber-900',
  'bg-violet-100 text-violet-900',
  'bg-sky-100 text-sky-900',
  'bg-orange-100 text-orange-900',
] as const;

export function avatarTone(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

/** "+91 98765 43210" for a valid number, the stored text otherwise, "" for none. */
export function formatPhone(phone: string | null | undefined): string {
  const p = clean(phone);
  if (!p) return '';
  return parsePhoneNumberFromString(p)?.formatInternational() ?? p;
}

export function titleCaseKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toLocaleUpperCase());
}

export interface AttributeChip {
  key: string;
  label: string;
  /** Value cut to 18 characters for the chip. */
  text: string;
  /** Full "label: value" for the tooltip. */
  full: string;
}

const scalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * The first four non-empty scalar custom values, minus the keys the form owns (TW-CON-008 rule 1).
 * `labels` maps an attribute key to its display name when the workspace defined one.
 */
export function attributeChips(
  customFields: Record<string, unknown>,
  labels: ReadonlyMap<string, string> = new Map(),
  limit = 4,
): AttributeChip[] {
  const out: AttributeChip[] = [];
  for (const [key, value] of Object.entries(customFields)) {
    if (RESERVED_CUSTOM_KEYS.has(key.toLowerCase())) continue;
    if (!scalar(value) || String(value) === '') continue;
    const label = labels.get(key) ?? titleCaseKey(key);
    const text = String(value);
    out.push({
      key,
      label,
      text: text.length > 18 ? `${text.slice(0, 18)}…` : text,
      full: `${label}: ${text}`,
    });
    if (out.length === limit) break;
  }
  return out;
}

export interface ContactFormValues {
  title: string;
  firstName: string;
  middleName: string;
  lastName: string;
  /** E.164 or null; the phone field reports validity separately. */
  phone: string | null;
  email: string;
  language: string;
  address: string;
  memo: string;
  status: string;
  lifecycleStage: string;
  /** Why the contact was lost: a lost-reason option's value, OTHER_REASON (then `lostText` holds the words), or ''. */
  lostReason: string;
  lostText: string;
  source: string;
  /** The owner's id (uuid); '' = nobody. A new contact starts as the person creating it (the form sets that). */
  ownerId: string;
  /** Group ids (uuid). Empty array = no groups, which clears them on save. */
  groupIds: string[];
  /**
   * Property key -> what the form holds: text for most types (a number, a date, 'true' for a ticked checkbox) and a
   * list for a multi-select. `customFieldsFromForm` converts back to the stored type.
   */
  attributes: Record<string, InputValue>;
  optedOut: boolean;
  /** The lead score as typed ('' = none). Typing one makes it a manual score; see `features/lead-scoring`. */
  leadScore: string;
}

export const EMPTY_FORM: ContactFormValues = {
  title: '',
  firstName: '',
  middleName: '',
  lastName: '',
  phone: null,
  email: '',
  language: '',
  address: '',
  memo: '',
  status: '',
  lifecycleStage: '',
  lostReason: '',
  lostText: '',
  source: '',
  ownerId: '',
  groupIds: [],
  attributes: {},
  optedOut: false,
  leadScore: '',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Fills the edit form from a contact. Contacts captured with only a display name open with it as the first name. */
export function contactToForm(
  c: ContactRow,
  groupIds: readonly string[] = (c.groups ?? []).map((g) => g.id),
): ContactFormValues {
  const cf = c.customFields;
  // Every custom value the contact holds; only the keys of the workspace's active attributes are shown and written back.
  const attributes: Record<string, InputValue> = {};
  for (const [key, value] of Object.entries(cf)) {
    if (RESERVED_CUSTOM_KEYS.has(key.toLowerCase())) continue;
    if (scalar(value)) attributes[key] = str(value);
    else if (Array.isArray(value) && value.every(scalar)) attributes[key] = value.map(String);
  }
  const hasParts = Boolean(clean(c.firstName) || clean(c.lastName));
  return {
    title: str(cf[EXTRA_KEYS.title]),
    firstName: hasParts ? clean(c.firstName) : clean(c.name),
    middleName: str(cf[EXTRA_KEYS.middleName]),
    lastName: clean(c.lastName),
    phone: c.phone,
    email: clean(c.email),
    language: str(cf[EXTRA_KEYS.language]),
    address: str(cf[EXTRA_KEYS.address]),
    memo: str(cf[EXTRA_KEYS.memo]),
    status: clean(c.status),
    lifecycleStage: clean(c.lifecycleStage),
    lostReason: c.lostReason ? c.lostReason : c.otherLostReason ? OTHER_REASON : '',
    lostText: c.otherLostReason ?? '',
    source: c.source ?? str(cf[EXTRA_KEYS.source]),
    ownerId: c.ownerId ?? '',
    groupIds: [...groupIds],
    attributes,
    optedOut: isOptedOut(c),
    leadScore: scoreToText(c.leadScore),
  };
}

const orNull = (v: string): string | null => (clean(v) === '' ? null : clean(v));

/**
 * `customFields` for a write: extras plus the workspace's properties. Blank values are sent as null so they clear.
 * `fields` (the registry rows by key) turns each form value into its stored type; a key with no row is text.
 */
export function customFieldsFromForm(
  v: ContactFormValues,
  attributeKeys: readonly string[],
  fields: ReadonlyMap<string, Pick<FieldResponse, 'fieldType'>> = new Map(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [EXTRA_KEYS.title]: orNull(v.title),
    [EXTRA_KEYS.middleName]: orNull(v.middleName),
    [EXTRA_KEYS.language]: orNull(v.language),
    [EXTRA_KEYS.address]: orNull(v.address),
    [EXTRA_KEYS.memo]: orNull(v.memo),
    [EXTRA_KEYS.source]: orNull(v.source),
  };
  for (const key of attributeKeys) {
    const input = v.attributes[key];
    const field = fields.get(key);
    if (field) out[key] = inputToValue(field, input);
    else out[key] = Array.isArray(input) ? (input.length ? input : null) : orNull(input ?? '');
  }
  return out;
}

/** The same, for create: keys with nothing in them are left out instead of sent as null. */
function withoutNulls(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null));
}

export function toCreatePayload(
  v: ContactFormValues,
  attributeKeys: readonly string[],
  fields?: ReadonlyMap<string, Pick<FieldResponse, 'fieldType'>>,
  /** The lost reason, when the chosen stage is a lost one (see `lostReasonPayload`). */
  lost?: ReturnType<typeof lostReasonPayload>,
) {
  const name = composeName(v);
  const newScore = scoreChange(v.leadScore, null);
  return {
    ...(name ? { name } : {}),
    ...(clean(v.firstName) ? { firstName: clean(v.firstName) } : {}),
    ...(clean(v.lastName) ? { lastName: clean(v.lastName) } : {}),
    ...(clean(v.email) ? { email: clean(v.email) } : {}),
    ...(v.phone ? { phone: v.phone } : {}),
    ...(clean(v.lifecycleStage) ? { lifecycleStage: clean(v.lifecycleStage) } : {}),
    ...lost,
    ...(clean(v.status) ? { status: clean(v.status) } : {}),
    ...(clean(v.source) ? { source: clean(v.source) } : {}),
    // Always explicit: '' is "nobody" (null), not "the creator" which is what omitting it would mean.
    ownerId: v.ownerId || null,
    ...(v.optedOut ? { isUnsubscribed: true } : {}),
    ...(typeof newScore === 'number' ? { leadScore: newScore } : {}),
    customFields: withoutNulls(customFieldsFromForm(v, attributeKeys, fields)),
  };
}

/** PATCH semantics: every editable field is sent, with null clearing it (Reference could never clear a field). */
export function toUpdatePayload(
  v: ContactFormValues,
  attributeKeys: readonly string[],
  rowVersion: number,
  wasOptedOut: boolean,
  previous: Record<string, unknown> = {},
  fields?: ReadonlyMap<string, Pick<FieldResponse, 'fieldType'>>,
  lost?: ReturnType<typeof lostReasonPayload>,
  /** The score the contact has now: the typed score is sent only when it differs (undefined = unchanged, null = cleared). */
  previousLeadScore: number | null = null,
  /** The owner the contact has now: sent only when the form changed it, so saving an unrelated field never re-assigns. */
  previousOwnerId: string | null = null,
) {
  const name = composeName(v);
  const lead = scoreChange(v.leadScore, previousLeadScore);
  return {
    ...(name ? { name } : {}),
    firstName: orNull(v.firstName),
    lastName: orNull(v.lastName),
    email: orNull(v.email),
    phone: v.phone,
    ...(clean(v.lifecycleStage) ? { lifecycleStage: clean(v.lifecycleStage) } : {}),
    ...lost,
    status: orNull(v.status),
    source: orNull(v.source),
    ...(v.ownerId !== (previousOwnerId ?? '') ? { ownerId: v.ownerId || null } : {}),
    // Only a change to the switch touches the consent flag; saving an unrelated field must not flip it.
    ...(v.optedOut !== wasOptedOut ? { isUnsubscribed: v.optedOut } : {}),
    // Only a typed change touches the score: saving an unrelated field must not turn an AI score into a manual one.
    ...(lead !== undefined ? { leadScore: lead } : {}),
    // A blank value clears a key the contact had; a key that was empty and still is stays out of the write
    // (it would only add a null to the stored values).
    customFields: Object.fromEntries(
      Object.entries(customFieldsFromForm(v, attributeKeys, fields)).filter(([key, value]) => {
        const had = (previous[key] ?? null) !== null;
        // an unticked checkbox on a contact that never had a value is not a change
        return value === false ? had : value !== null || had;
      }),
    ),
    rowVersion,
  };
}

/** Client-side checks that mirror the API's create rule: someone with neither phone nor email cannot be reached. */
export type FormProblem =
  'firstNameRequired' | 'contactPointRequired' | 'emailInvalid' | 'phoneInvalid';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateForm(
  v: ContactFormValues,
  phoneInvalid: boolean,
): Partial<Record<'firstName' | 'phone' | 'email', FormProblem>> {
  const out: Partial<Record<'firstName' | 'phone' | 'email', FormProblem>> = {};
  if (!clean(v.firstName)) out.firstName = 'firstNameRequired';
  if (phoneInvalid) out.phone = 'phoneInvalid';
  if (clean(v.email) && !EMAIL.test(clean(v.email))) out.email = 'emailInvalid';
  if (!out.phone && !out.email && !v.phone && !clean(v.email)) out.phone = 'contactPointRequired';
  return out;
}
