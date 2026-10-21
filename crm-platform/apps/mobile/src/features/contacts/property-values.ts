import {
  emailSchema,
  isStatusValidForStage,
  lifecycleStageSchema,
  phoneSchema,
  type ContactResponse,
  type FieldOptionResponse,
  type FieldResponse,
  type FieldSectionResponse,
  type StatusOptionResponse,
  type StatusScopeRule,
  type UpdateContactInput,
} from '@crm/contracts';
import type { TFunction } from 'i18next';
import { customValueText, formatDate, formatMoment } from './contact-display';
import { normalisePhone } from './contact-validation';

/**
 * Everything the About tab decides without a screen: which rows exist, how a value reads, which editor a property gets, whether
 * a typed value fits the property, and what a lifecycle change sends. The rules of "fits" are the API's own
 * (`contact-property-values.ts` on the server), so a value the phone accepts is a value the API accepts.
 */

/** What a row shows for a value that is not there. */
export const NO_VALUE = '--';
/** What a masked property shows in place of its value. */
export const MASKED = '••••••';

export const STAGE_GROUP = 'lifecycle_stage';
export const STATUS_GROUPS: readonly string[] = ['status', 'contact_status'];
export const LOST_REASON_GROUP = 'lost_reason';
/** The "Other" entry of the lost-reason list. It is never sent as a value. */
export const OTHER_REASON = '__other__';

const TEXT_MAX = 1000;
const LONG_TEXT_MAX = 4000;
const NAME_MAX = 255;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const STORED_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const HTTP_URL = /^https?:\/\/[^\s/?#]+([/?#]\S*)?$/i;

// --- values -----------------------------------------------------------------------------------------------------------------

/** Nothing, blank text or an empty list: a property with such a value counts as empty. `false` and `0` are values. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

const textOrNull = (value: string | null | undefined): string | null => value?.trim() || null;

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && DECIMAL.test(value.trim())) return Number(value.trim());
  return null;
}

/** "application_started" as "Application Started", for a value the workspace has no label for. */
export function titleCaseKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function validDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isDateText(text: string): boolean {
  const m = DATE.exec(text);
  return m !== null && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** A link the API takes: http or https, then a host. Not `new URL`: the phone's URL class does not implement all of it. */
const isHttpUrl = (text: string): boolean => HTTP_URL.test(text);

export interface ValueFormat {
  locale: string;
  yes: string;
  no: string;
}

/** A calendar date has no time zone: "2026-10-12" must read as the 12th everywhere, so it is formatted as local midnight. */
function formatDateOnly(value: string, locale: string): string | null {
  const m = DATE.exec(value.trim());
  return formatDate(m ? `${value.trim()}T00:00:00` : value, locale);
}

function formatNumber(field: FieldResponse, n: number, locale: string, raw: unknown): string {
  try {
    if (field.fieldType === 'currency') {
      const code = field.config.code;
      if (typeof code === 'string' && /^[A-Za-z]{3}$/.test(code)) {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: code.toUpperCase(),
        }).format(n);
      }
    }
    if (field.fieldType === 'big_integer' && !Number.isSafeInteger(n)) return String(raw);
    const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }).format(n);
    return field.fieldType === 'percentage' ? `${text}%` : text;
  } catch {
    return String(raw);
  }
}

/** The label the workspace gave an option, else the stored value itself. */
export function optionLabel(options: readonly FieldOptionResponse[] | undefined, value: unknown) {
  const text = String(value);
  return options?.find((o) => o.value === text)?.label ?? text;
}

/**
 * A property's value as the row shows it, or null when it is empty. Dates and numbers follow the language of the app, a
 * select shows the option's label, a masked property shows dots. A value with no definition (the person may not read the
 * property list) is shown as it is.
 */
export function formatPropertyValue(
  field: FieldResponse | undefined,
  value: unknown,
  fmt: ValueFormat,
): string | null {
  if (isEmptyValue(value)) return null;
  if (field?.isMasked) return MASKED;
  switch (field?.fieldType) {
    case 'boolean':
    case 'checkbox': {
      const flag = asBoolean(value);
      return flag === null ? customValueText(value, fmt.yes, fmt.no) : flag ? fmt.yes : fmt.no;
    }
    case 'date':
      return formatDateOnly(String(value), fmt.locale) ?? String(value);
    case 'datetime':
      return formatMoment(String(value), fmt.locale) ?? String(value);
    case 'integer':
    case 'big_integer':
    case 'decimal':
    case 'percentage':
    case 'currency':
    case 'rating': {
      const n = asNumber(value);
      return n === null ? String(value) : formatNumber(field, n, fmt.locale, value);
    }
    case 'select':
    case 'radio':
      return optionLabel(field.options, value);
    case 'multiselect':
      return Array.isArray(value)
        ? value.map((v) => optionLabel(field.options, v)).join(', ')
        : optionLabel(field.options, value);
    default:
      return customValueText(value, fmt.yes, fmt.no);
  }
}

// --- editors ----------------------------------------------------------------------------------------------------------------

export type EditorKind =
  | 'text'
  | 'longText'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'single'
  | 'multi'
  | 'unsupported';

/** Which editor a property type gets. A lookup points at another record and a formula is computed: neither is typed in. */
export function editorKindOf(fieldType: FieldResponse['fieldType']): EditorKind {
  switch (fieldType) {
    case 'long_text':
      return 'longText';
    case 'integer':
    case 'big_integer':
    case 'rating':
      return 'integer';
    case 'decimal':
    case 'percentage':
    case 'currency':
      return 'decimal';
    case 'boolean':
    case 'checkbox':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'select':
    case 'radio':
      return 'single';
    case 'multiselect':
      return 'multi';
    case 'lookup':
    case 'formula':
      return 'unsupported';
    default:
      return 'text';
  }
}

export type KeyboardKind =
  'default' | 'email-address' | 'url' | 'phone-pad' | 'number-pad' | 'decimal-pad';

/** The keyboard that suits a property type: an address, a link, digits. */
export function keyboardFor(fieldType: FieldResponse['fieldType']): KeyboardKind {
  switch (fieldType) {
    case 'email':
      return 'email-address';
    case 'url':
      return 'url';
    case 'phone':
      return 'phone-pad';
    case 'integer':
    case 'big_integer':
    case 'rating':
      return 'number-pad';
    case 'decimal':
    case 'percentage':
    case 'currency':
      return 'decimal-pad';
    default:
      return 'default';
  }
}

export type LockReason = 'readonly' | 'unsupported';

/**
 * Why a property cannot be edited here, or null when it can. Read-only, system, formula and masked properties are not editable
 * (a masked value must not be shown back in an input); a lookup needs a record picker the app does not have yet.
 */
export function lockReasonOf(field: FieldResponse): LockReason | null {
  if (field.isReadOnly || field.isSystem || field.isMasked || field.fieldType === 'formula') {
    return 'readonly';
  }
  return field.fieldType === 'lookup' ? 'unsupported' : null;
}

/** What the editors hold while a person types; each editor uses the part it needs. */
export interface Draft {
  text: string;
  time: string;
  on: boolean;
  picked: string[];
}

export const EMPTY_DRAFT: Draft = { text: '', time: '', on: false, picked: [] };

/** The draft an editor starts from: the stored value, spread over the parts the editor shows. */
export function draftOf(field: FieldResponse, value: unknown): Draft {
  switch (editorKindOf(field.fieldType)) {
    case 'boolean':
      return { ...EMPTY_DRAFT, on: asBoolean(value) ?? false };
    case 'date': {
      const text = isEmptyValue(value) ? '' : String(value).trim().slice(0, 10);
      return { ...EMPTY_DRAFT, text };
    }
    case 'datetime': {
      const m = isEmptyValue(value) ? null : STORED_DATETIME.exec(String(value).trim());
      return m ? { ...EMPTY_DRAFT, text: m[1] ?? '', time: m[2] ?? '' } : EMPTY_DRAFT;
    }
    case 'single':
      return { ...EMPTY_DRAFT, picked: isEmptyValue(value) ? [] : [String(value)] };
    case 'multi':
      return {
        ...EMPTY_DRAFT,
        picked: Array.isArray(value)
          ? value.map(String)
          : isEmptyValue(value)
            ? []
            : [String(value)],
      };
    default:
      return {
        ...EMPTY_DRAFT,
        text: typeof value === 'string' || typeof value === 'number' ? String(value) : '',
      };
  }
}

export type PropertyErrorKey =
  | 'required'
  | 'name'
  | 'email'
  | 'phone'
  | 'needPhoneOrEmail'
  | 'text'
  | 'number'
  | 'whole'
  | 'range'
  | 'url'
  | 'date'
  | 'time'
  | 'option';

export type Parsed =
  | { ok: true; value: unknown }
  | { ok: false; error: PropertyErrorKey; params?: Record<string, string | number> };

const good = (value: unknown): Parsed => ({ ok: true, value });
const bad = (error: PropertyErrorKey, params?: Record<string, string | number>): Parsed => ({
  ok: false,
  error,
  params,
});

/** The most a rating can be: the property's `config.max`, else 5. */
export function ratingMax(field: Pick<FieldResponse, 'config'>): number {
  const max = field.config.max;
  return typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : 5;
}

/**
 * What a draft means for a property, held to the property's type: the value to send (null clears it), or the reason it does
 * not fit. An empty draft clears, unless the property is required. `options` are the values a select may take.
 */
export function parseDraft(
  field: FieldResponse,
  draft: Draft,
  options: readonly FieldOptionResponse[] = [],
): Parsed {
  const empty = () => (field.isRequired ? bad('required', { label: field.label }) : good(null));
  const text = draft.text.trim();
  switch (editorKindOf(field.fieldType)) {
    case 'boolean':
      return good(draft.on);
    case 'single': {
      const picked = draft.picked[0];
      if (picked === undefined) return empty();
      return options.some((o) => o.value === picked) ? good(picked) : bad('option');
    }
    case 'multi': {
      if (draft.picked.length === 0) return empty();
      const allowed = draft.picked.every((v) => options.some((o) => o.value === v));
      return allowed ? good([...new Set(draft.picked)]) : bad('option');
    }
    case 'date': {
      if (text === '') return empty();
      return isDateText(text) ? good(text) : bad('date');
    }
    case 'datetime': {
      const time = draft.time.trim();
      if (text === '' && time === '') return empty();
      if (!isDateText(text)) return bad('date');
      return TIME.test(time) ? good(`${text}T${time}`) : bad('time');
    }
    case 'integer': {
      if (text === '') return empty();
      if (!INTEGER.test(text)) return bad(DECIMAL.test(text) ? 'whole' : 'number');
      const n = Number(text);
      if (!Number.isSafeInteger(n)) return bad('number');
      if (field.fieldType === 'rating') {
        const max = ratingMax(field);
        return n >= 0 && n <= max ? good(n) : bad('range', { max });
      }
      return good(n);
    }
    case 'decimal': {
      if (text === '') return empty();
      return DECIMAL.test(text) ? good(Number(text)) : bad('number');
    }
    case 'longText': {
      if (text === '') return empty();
      return text.length > LONG_TEXT_MAX ? bad('text', { max: LONG_TEXT_MAX }) : good(text);
    }
    case 'unsupported':
      return bad('option');
    default: {
      if (text === '') return empty();
      if (text.length > TEXT_MAX) return bad('text', { max: TEXT_MAX });
      if (field.fieldType === 'email' && !EMAIL.test(text)) return bad('email');
      if (field.fieldType === 'url' && !isHttpUrl(text)) return bad('url');
      return good(text);
    }
  }
}

export type StandardKey = 'name' | 'email' | 'phone';

type Identity = Pick<ContactResponse, 'name' | 'firstName' | 'lastName' | 'email' | 'phone'>;

/** The name as one string: the display name, else first and last. */
export function nameOf(contact: Identity): string {
  return contact.name?.trim() || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
}

/** What the editor of a standard field starts with. */
export function standardText(contact: Identity, key: StandardKey): string {
  return key === 'name' ? nameOf(contact) : (contact[key] ?? '');
}

/**
 * A typed name, email or phone as the update takes it: the API's own email and phone shapes, and a contact is never left
 * with neither a phone nor an email. An empty name or contact point is null, which clears it.
 */
export function parseStandard(key: StandardKey, raw: string, contact: Identity): Parsed {
  if (key === 'name') {
    const name = raw.trim();
    return name.length > NAME_MAX ? bad('name') : good(name || null);
  }
  const value = key === 'phone' ? normalisePhone(raw) : raw.trim();
  if (value === '') {
    const other = key === 'phone' ? contact.email : contact.phone;
    return other ? good(null) : bad('needPhoneOrEmail');
  }
  if (key === 'phone') return phoneSchema.safeParse(value).success ? good(value) : bad('phone');
  return emailSchema.safeParse(value).success ? good(value) : bad('email');
}

/** Whether saving would change nothing: the same value, or empty either way. */
export function sameValue(before: unknown, after: unknown): boolean {
  if (isEmptyValue(before) && isEmptyValue(after)) return true;
  return JSON.stringify(before) === JSON.stringify(after);
}

// --- rows -------------------------------------------------------------------------------------------------------------------

export type RowEdit =
  | { kind: 'standard'; key: StandardKey }
  | { kind: 'owner' }
  | { kind: 'custom'; field: FieldResponse }
  | { kind: 'locked'; reason: LockReason };

export type Editable = Extract<RowEdit, { kind: 'standard' | 'custom' }>;

/** The value the contact holds now for the property being edited (text for a standard field). */
export function currentValueOf(edit: Editable, contact: ContactResponse): unknown {
  return edit.kind === 'custom'
    ? contact.customFields[edit.field.key]
    : standardText(contact, edit.key);
}

/** The draft the editor of this property starts from. */
export function initialDraftOf(edit: Editable, contact: ContactResponse): Draft {
  return edit.kind === 'custom'
    ? draftOf(edit.field, contact.customFields[edit.field.key])
    : { ...EMPTY_DRAFT, text: standardText(contact, edit.key) };
}

/** A draft held to the property it edits: the value to send, or why it does not fit. */
export function parseEdit(
  edit: Editable,
  draft: Draft,
  options: readonly FieldOptionResponse[],
  contact: ContactResponse,
): Parsed {
  return edit.kind === 'custom'
    ? parseDraft(edit.field, draft, options)
    : parseStandard(edit.key, draft.text, contact);
}

/** The update that sets one property: a custom property goes under `customFields` (the API merges it), a standard one by name. */
export function updateBodyFor(
  edit: Editable,
  value: unknown,
): Omit<UpdateContactInput, 'rowVersion'> {
  if (edit.kind === 'custom') return { customFields: { [edit.field.key]: value } };
  const text = typeof value === 'string' ? value : null;
  if (edit.key === 'name') return { name: text };
  return edit.key === 'email' ? { email: text } : { phone: text };
}

export interface PropertyRow {
  id: string;
  label: string;
  /** The value as text; null when the property is empty (the row shows `NO_VALUE`). */
  text: string | null;
  edit: RowEdit;
}

/** What the All sections screen adds so a standard property shows the contact's own value: how to name a built-in stage. */
export interface StandardValues {
  stageLabel: (value: string) => string;
  /** The workspace's words for a lost-reason value. */
  lostReasonLabel: (value: string) => string;
}

export interface RowContext {
  contact: ContactResponse;
  /** The workspace's properties; undefined while loading or when the person may not read them. */
  fields: readonly FieldResponse[] | undefined;
  /** The owner's name, when it could be resolved. */
  ownerName: string | null;
  locale: string;
  t: TFunction;
  /**
   * Set where every property of the workspace is listed (the All sections screen): a standard property (email, mobile phone number,
   * lifecycle stage, the subscription statuses...) whose own value is empty then shows what the contact holds in its own column. The
   * About tab leaves it out: it already has a fixed row for each of those.
   */
  standard?: StandardValues;
}

/** The property keys that are really columns of the contact, and the column each one reads. */
const COLUMN_KEYS = [
  'email',
  'mobile_phone_number',
  'phone_number',
  'phone',
  'first_name',
  'last_name',
  'lifecycle_stage',
  'lifecycle_stage_status',
  'lifecycle_stage_date',
  'previous_lifecycle_stage',
  'previous_lifecycle_stage_date',
  'lost_reason',
  'other_lost_reason',
  'contact_owner',
  'created_time',
  'modified_time',
  'status',
  'source',
  'whatsapp_subscription_status',
  'email_subscription_status',
  'sms_subscription_status',
] as const;

/** The contact's own value for a standard property key, as words; null when it has none or the key is not a standard one. */
export function columnTextOf(
  contact: ContactResponse,
  key: string,
  { t, standard, ownerName, locale }: Pick<RowContext, 't' | 'standard' | 'ownerName' | 'locale'>,
): string | null {
  if (!standard || !(COLUMN_KEYS as readonly string[]).includes(key)) return null;
  const subscription = (status: string | null) =>
    status
      ? t(`contactProps.subscription.${status}`, { defaultValue: titleCaseKey(status) })
      : null;
  switch (key) {
    case 'email':
      return textOrNull(contact.email);
    case 'mobile_phone_number':
    case 'phone_number':
    case 'phone':
      return textOrNull(contact.phone);
    case 'first_name':
      return textOrNull(contact.firstName);
    case 'last_name':
      return textOrNull(contact.lastName);
    case 'lifecycle_stage':
      return contact.lifecycleStage ? standard.stageLabel(contact.lifecycleStage) : null;
    case 'status':
    case 'lifecycle_stage_status':
      return textOrNull(contact.status);
    case 'lifecycle_stage_date':
      return contact.lifecycleStageDate ? formatMoment(contact.lifecycleStageDate, locale) : null;
    case 'previous_lifecycle_stage':
      return contact.previousLifecycleStage
        ? standard.stageLabel(contact.previousLifecycleStage)
        : null;
    case 'previous_lifecycle_stage_date':
      return contact.previousLifecycleStageDate
        ? formatMoment(contact.previousLifecycleStageDate, locale)
        : null;
    case 'lost_reason':
      return contact.lostReason ? standard.lostReasonLabel(contact.lostReason) : null;
    case 'other_lost_reason':
      return textOrNull(contact.otherLostReason);
    case 'contact_owner':
      return textOrNull(ownerName);
    case 'created_time':
      return formatMoment(contact.createdAt, locale);
    case 'modified_time':
      return formatMoment(contact.updatedAt, locale);
    case 'source':
      return textOrNull(contact.source);
    case 'whatsapp_subscription_status':
      return subscription(contact.whatsappSubscriptionStatus);
    case 'email_subscription_status':
      return subscription(contact.emailSubscriptionStatus);
    default:
      return subscription(contact.smsSubscriptionStatus);
  }
}

/**
 * The rows of the About tab: the fixed ones first, then the workspace's custom properties. A property that is switched off or
 * hidden has no row. A value whose key has no definition at all is shown read-only under its key.
 */
export function buildRows({
  contact,
  fields,
  ownerName,
  locale,
  t,
  standard,
}: RowContext): PropertyRow[] {
  const yes = t('contactProps.yes');
  const no = t('contactProps.no');
  const readonly: RowEdit = { kind: 'locked', reason: 'readonly' };
  const subscription = (status: string | null) =>
    status
      ? t(`contactProps.subscription.${status}`, { defaultValue: titleCaseKey(status) })
      : null;
  const rows: PropertyRow[] = [
    {
      id: 'email',
      label: t('contactProps.fields.email'),
      text: textOrNull(contact.email),
      edit: { kind: 'standard', key: 'email' },
    },
    {
      id: 'phone',
      label: t('contactProps.fields.phone'),
      text: textOrNull(contact.phone),
      edit: { kind: 'standard', key: 'phone' },
    },
    {
      id: 'owner',
      label: t('contactProps.fields.owner'),
      text: contact.ownerId ? (ownerName ?? NO_VALUE) : null,
      edit: { kind: 'owner' },
    },
    {
      id: 'name',
      label: t('contactProps.fields.name'),
      text: textOrNull(nameOf(contact)),
      edit: { kind: 'standard', key: 'name' },
    },
    {
      id: 'source',
      label: t('contactProps.fields.source'),
      text: textOrNull(contact.source),
      edit: readonly,
    },
    {
      id: 'whatsapp',
      label: t('contactProps.fields.whatsapp'),
      text: subscription(contact.whatsappSubscriptionStatus),
      edit: readonly,
    },
    {
      id: 'emailSubscription',
      label: t('contactProps.fields.emailSubscription'),
      text: subscription(contact.emailSubscriptionStatus),
      edit: readonly,
    },
    {
      id: 'smsSubscription',
      label: t('contactProps.fields.smsSubscription'),
      text: subscription(contact.smsSubscriptionStatus),
      edit: readonly,
    },
    {
      id: 'marketing',
      label: t('contactProps.fields.marketing'),
      text: contact.isUnsubscribed ? yes : no,
      edit: readonly,
    },
    {
      id: 'leadScore',
      label: t('contactProps.fields.leadScore'),
      text: contact.leadScore === null ? null : String(contact.leadScore),
      edit: readonly,
    },
    {
      id: 'created',
      label: t('contactProps.fields.created'),
      text: formatDate(contact.createdAt, locale),
      edit: readonly,
    },
    {
      id: 'modified',
      label: t('contactProps.fields.modified'),
      text: formatMoment(contact.updatedAt, locale),
      edit: readonly,
    },
    {
      id: 'lastActivity',
      label: t('contactProps.fields.lastActivity'),
      text: formatMoment(contact.lastActivityAt, locale),
      edit: readonly,
    },
  ];

  const fmt: ValueFormat = { locale, yes, no };
  const values = contact.customFields;
  const known = new Set<string>();
  for (const field of fields ?? []) {
    known.add(field.key);
    if (!field.isActive || field.isHidden) continue;
    const lock = lockReasonOf(field);
    rows.push({
      id: `field:${field.key}`,
      label: field.label,
      text:
        (isEmptyValue(values[field.key])
          ? columnTextOf(contact, field.key, { t, standard, ownerName, locale })
          : null) ?? formatPropertyValue(field, values[field.key], fmt),
      edit: lock ? { kind: 'locked', reason: lock } : { kind: 'custom', field },
    });
  }
  // Values nobody defined a property for (or all of them, when the definitions cannot be read): shown as they are, under their key.
  for (const [key, value] of Object.entries(values)) {
    if (known.has(key) || isEmptyValue(value)) continue;
    rows.push({
      id: `field:${key}`,
      label: key,
      text: customValueText(value, yes, no),
      edit: readonly,
    });
  }
  return rows;
}

/** The rows to draw: all of them, or only those that have a value. */
export const visibleRows = (rows: readonly PropertyRow[], showEmpty: boolean): PropertyRow[] =>
  showEmpty ? [...rows] : rows.filter((row) => row.text !== null);

// --- lifecycle --------------------------------------------------------------------------------------------------------------

/** The active options of a group, in the order the workspace set. */
export function optionsOfGroup(
  options: readonly StatusOptionResponse[] | undefined,
  groups: readonly string[],
): StatusOptionResponse[] {
  return (options ?? [])
    .filter((o) => o.isActive && groups.includes(o.optionGroup))
    .sort((a, b) => a.position - b.position);
}

/** The status options as the stage rules read them (`@crm/contracts`: the API enforces the same rules). */
export function statusScope(
  options: readonly StatusOptionResponse[] | undefined,
): StatusScopeRule[] {
  const all = options ?? [];
  const stageValueById = new Map(
    all.filter((o) => o.optionGroup === STAGE_GROUP).map((o) => [o.id, o.value]),
  );
  return all
    .filter((o) => STATUS_GROUPS.includes(o.optionGroup))
    .map((o) => ({
      value: o.value,
      stageValue: o.stageOptionId ? (stageValueById.get(o.stageOptionId) ?? null) : null,
      isDefault: o.isDefault,
      isActive: o.isActive,
    }));
}

/** The statuses that may be chosen in a stage: the unscoped ones and those scoped to it. */
export function statusesForStage(
  options: readonly StatusOptionResponse[] | undefined,
  stage: StatusOptionResponse | undefined,
): StatusOptionResponse[] {
  return optionsOfGroup(options, STATUS_GROUPS).filter(
    (o) => o.stageOptionId === null || stage === undefined || o.stageOptionId === stage.id,
  );
}

/** The statuses offered when the workspace has configured none: the web's own four (Reference's fixed list), which the API accepts in every stage. */
export const FALLBACK_STATUSES = ['active', 'prospect', 'customer', 'vip'] as const;

/** One entry of the stage or status dropdown. */
export interface LifecycleChoice {
  value: string;
  label: string;
  /** A status scoped to a stage that is that stage's default: where a contact lands when it enters the stage. */
  isDefault?: boolean;
}

/**
 * The stages to offer, as the web does: the workspace's own when it has any, otherwise the platform's built-in ones. A stage the
 * contact already holds but the list lacks (the platform default `new` in a workspace with its own stages, or a removed option) is put
 * first, so the dropdown never shows "Select…" for a stage the contact has.
 */
export function stageChoices(
  options: readonly StatusOptionResponse[] | undefined,
  label: (value: string) => string,
  current: string | null,
): LifecycleChoice[] {
  const configured = optionsOfGroup(options, [STAGE_GROUP]).map((o) => ({
    value: o.value,
    label: o.label,
  }));
  const base =
    configured.length > 0
      ? configured
      : lifecycleStageSchema.options.map((value) => ({ value, label: label(value) }));
  return current !== null && !base.some((c) => c.value === current)
    ? [{ value: current, label: label(current) }, ...base]
    : base;
}

/**
 * The statuses to offer in `stage` (a stage option, or undefined for any): the workspace's own that are valid there, or the four
 * built-in ones when it configured none (a workspace that did is never shown the four, even when none fits the stage). A status the
 * contact already holds but the list lacks is put first.
 */
export function statusChoices(
  options: readonly StatusOptionResponse[] | undefined,
  stage: StatusOptionResponse | undefined,
  label: (value: string) => string,
  current: string | null,
): LifecycleChoice[] {
  const base: LifecycleChoice[] =
    optionsOfGroup(options, STATUS_GROUPS).length > 0
      ? statusesForStage(options, stage).map((o) => ({
          value: o.value,
          label: o.label,
          isDefault: o.isDefault && o.stageOptionId !== null,
        }))
      : FALLBACK_STATUSES.map((value) => ({ value, label: label(value) }));
  return current !== null && current !== '' && !base.some((c) => c.value === current)
    ? [{ value: current, label: label(current) }, ...base]
    : base;
}

/** The status a contact gets on entering a stage: the stage's own default, else the first one it may have (the Geta app picks the first). */
export const firstStatusOf = (choices: readonly LifecycleChoice[]): string | null =>
  (choices.find((c) => c.isDefault) ?? choices[0])?.value ?? null;

/** Whether a status may stay on a contact moved to `stageValue` (the API resets it when it may not). */
export const statusFitsStage = (
  options: readonly StatusOptionResponse[] | undefined,
  status: string | null,
  stageValue: string,
): boolean => isStatusValidForStage(statusScope(options), status, stageValue);

/** What the lifecycle sheet holds: the chosen stage and status, and the lost-reason answer. */
export interface LifecycleDraft {
  stage: string | null;
  status: string | null;
  /** A lost-reason option's value, `OTHER_REASON`, or null for nothing chosen. */
  reason: string | null;
  reasonText: string;
}

export type LifecycleChanges = Pick<
  UpdateContactInput,
  'lifecycleStage' | 'status' | 'lostReason' | 'otherLostReason'
>;

/**
 * The fields to send for a lifecycle change: only what differs from the contact. A stage move into a lost stage needs a
 * reason (`askReason`): a picked reason goes in `lostReason`, written words in `otherLostReason`. The status is left out
 * when the stage moves and the person did not pick one: the API then keeps or resets it by its own rule.
 */
export function lifecycleChanges(
  contact: Pick<ContactResponse, 'lifecycleStage' | 'status'>,
  draft: LifecycleDraft,
  askReason: boolean,
  hasReasonOptions: boolean,
): { ok: true; changes: LifecycleChanges } | { ok: false } {
  const changes: LifecycleChanges = {};
  if (draft.stage !== null && draft.stage !== contact.lifecycleStage) {
    changes.lifecycleStage = draft.stage;
  }
  if (draft.status !== null && draft.status !== contact.status) changes.status = draft.status;
  if (askReason && changes.lifecycleStage !== undefined) {
    const words = draft.reasonText.trim();
    if (!hasReasonOptions || draft.reason === OTHER_REASON) {
      if (words === '') return { ok: false };
      changes.otherLostReason = words;
      changes.lostReason = null;
    } else {
      if (draft.reason === null) return { ok: false };
      changes.lostReason = draft.reason;
      changes.otherLostReason = null;
    }
  }
  return { ok: true, changes };
}

// --- sections ---------------------------------------------------------------------------------------------------------------

export interface RowGroup {
  /** The workspace's name for the group; null for the rows that belong to none (the fixed ones, and values without a definition). */
  title: string | null;
  rows: PropertyRow[];
}

/**
 * The rows under the workspace's section headers: the fixed rows first with no header, then one group per section in the
 * order the workspace set (a section with no row to show is left out), then the properties that sit in no section.
 */
export function groupRows(
  rows: readonly PropertyRow[],
  fields: readonly FieldResponse[] | undefined,
  sections: readonly FieldSectionResponse[] | undefined,
): RowGroup[] {
  const sectionOfKey = new Map<string, string>();
  for (const field of fields ?? []) {
    if (field.sectionId) sectionOfKey.set(`field:${field.key}`, field.sectionId);
  }
  const ordered = [...(sections ?? [])]
    .filter((s) => s.isActive)
    .sort((a, b) => a.position - b.position);
  const known = new Set(ordered.map((s) => s.id));

  const fixed: PropertyRow[] = [];
  const loose: PropertyRow[] = [];
  const bySection = new Map<string, PropertyRow[]>();
  for (const row of rows) {
    if (!row.id.startsWith('field:')) {
      fixed.push(row);
      continue;
    }
    const sectionId = sectionOfKey.get(row.id);
    if (sectionId && known.has(sectionId)) {
      bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), row]);
    } else {
      loose.push(row);
    }
  }

  const groups: RowGroup[] = [];
  if (fixed.length > 0) groups.push({ title: null, rows: fixed });
  for (const section of ordered) {
    const inSection = bySection.get(section.id);
    if (inSection && inSection.length > 0) groups.push({ title: section.name, rows: inSection });
  }
  if (loose.length > 0) groups.push({ title: null, rows: loose });
  return groups;
}

/** The rows whose name or value contains what was typed, ignoring case; an empty search keeps every row. */
export function searchRows(rows: readonly PropertyRow[], query: string): PropertyRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter(
    (row) =>
      row.label.toLowerCase().includes(needle) || (row.text ?? '').toLowerCase().includes(needle),
  );
}
