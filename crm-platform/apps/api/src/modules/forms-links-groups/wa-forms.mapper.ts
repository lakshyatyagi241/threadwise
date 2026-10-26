import type {
  WaForm,
  WaFormAudienceType,
  WaFormDefinition,
  WaFormField,
  WaFormPickerItem,
  WaFormStatus,
  WaFormSubmission,
} from '@crm/contracts';
import { WA_FORM_AUDIENCE_TYPES, WA_FORM_FIELD_KINDS } from '@crm/contracts';
import type { WaFormRow } from './wa-forms.repository';

/** Reference stored `audience_type` as a free string and field kinds under other names; rows seeded or imported from it use those. */
const LEGACY_AUDIENCE: Record<string, WaFormAudienceType> = {
  appointment: 'appointment_booking',
  appointments: 'appointment_booking',
  booking: 'appointment_booking',
  support: 'customer_support',
  signup: 'sign_up',
  lead: 'lead_capture',
};

const LEGACY_FIELD_KIND: Record<string, WaFormField['kind']> = {
  text: 'short_text',
  long_text: 'paragraph',
  textarea: 'paragraph',
  phone: 'phone_number',
  choice: 'radio_buttons',
  radio: 'radio_buttons',
  multi: 'checkbox',
  select: 'dropdown',
};

export function normalizeAudienceType(raw: string | null | undefined): WaFormAudienceType {
  const v = (raw ?? '').trim().toLowerCase();
  if ((WA_FORM_AUDIENCE_TYPES as readonly string[]).includes(v)) return v as WaFormAudienceType;
  return LEGACY_AUDIENCE[v] ?? 'other';
}

function optionText(o: unknown): string {
  if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    return String(r.title ?? r.label ?? r.name ?? r.value ?? r.id ?? '');
  }
  return String(o ?? '');
}

function normalizeField(raw: unknown, index: number): WaFormField {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawKind = String(f.kind ?? f.type ?? 'short_text');
  const kind = (
    (WA_FORM_FIELD_KINDS as readonly string[]).includes(rawKind)
      ? rawKind
      : (LEGACY_FIELD_KIND[rawKind] ?? 'short_text')
  ) as WaFormField['kind'];
  const id = String(f.id ?? f.name ?? `fld_${index + 1}`);
  const field: WaFormField = {
    id,
    kind,
    label: String(f.label ?? f.name ?? f.id ?? id),
    required: Boolean(f.required),
  };
  if (typeof f.placeholder === 'string') field.placeholder = f.placeholder;
  const helper = f.helperText ?? f.helper_text;
  if (typeof helper === 'string') field.helperText = helper;
  if (Array.isArray(f.options))
    field.options = f.options.map(optionText).filter((o) => o.length > 0);
  return field;
}

/** Coerce a stored definition (current or Reference shape) into the contract shape; always at least one screen. */
export function normalizeDefinition(def: unknown): WaFormDefinition {
  const screensRaw = (def as { screens?: unknown } | null)?.screens;
  const screens = (Array.isArray(screensRaw) ? screensRaw : []).map((s, i) => {
    const sc = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const out: WaFormDefinition['screens'][number] = {
      id: String(sc.id ?? `SCREEN_${i + 1}`),
      fields: (Array.isArray(sc.fields) ? sc.fields : []).map(normalizeField),
    };
    if (typeof sc.title === 'string') out.title = sc.title;
    return out;
  });
  return { screens: screens.length > 0 ? screens : [{ id: 'A', fields: [] }] };
}

function countFields(def: WaFormRow['definition_json']): number {
  return normalizeDefinition(def).screens.reduce((n, s) => n + s.fields.length, 0);
}

export function toWaFormResponse(row: WaFormRow): WaForm {
  return {
    id: row.uuid,
    title: row.title,
    purpose: row.purpose,
    slug: row.slug,
    audienceType: normalizeAudienceType(row.audience_type),
    submissionCap: row.submission_cap,
    capReachedNote: row.cap_reached_note,
    sendButtonLabel: row.send_button_label,
    thankYouNote: row.thank_you_note,
    definition: normalizeDefinition(row.definition_json),
    status: row.status as WaFormStatus,
    isLive: row.status === 'published' && Boolean(row.meta_flow_id),
    publishedAt: row.published_at?.toISOString() ?? null,
    publishError: row.publish_error,
    fieldsCount: countFields(row.definition_json),
    submissionCount: row.submission_count,
    createdAt: row.created_at_iso,
    rowVersion: row.row_version,
  };
}

export function toWaFormPickerItem(row: {
  uuid: string;
  title: string;
  status: string;
  meta_flow_id: string | null;
}): WaFormPickerItem {
  return {
    id: row.uuid,
    title: row.title,
    status: row.status as WaFormStatus,
    isPublished: row.status === 'published' && Boolean(row.meta_flow_id),
  };
}

/**
 * Matches `WaFormSubmissionService::flattenAnswer` (TW-WFL-008): title/name/label/value/text/id extraction,
 * arrays joined with ", ". Runs the same way whether the answer came in as a plain string or a structured object.
 */
export function flattenFormAnswer(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(flattenFormAnswer).join(', ');
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const picked = v.title ?? v.name ?? v.label ?? v.value ?? v.text ?? v.id;
    return picked == null ? '' : String(picked);
  }
  return String(value);
}

export function toWaFormSubmissionResponse(row: {
  uuid: string;
  contact_uuid: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  caller_phone: string | null;
  answers_json: Record<string, unknown> | null;
  submitted_at: Date | null;
  created_at_iso: string;
}): WaFormSubmission {
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.answers_json ?? {})) answers[k] = flattenFormAnswer(v);
  return {
    id: row.uuid,
    contactId: row.contact_uuid,
    contactName: row.contact_name,
    contactPhone: row.contact_phone ?? row.caller_phone,
    answers,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    createdAt: row.created_at_iso,
  };
}

/** `{fieldId: label}` for every non-heading field, authoring order — TW-WFL-009. */
export function fieldLabelsOf(definition: WaFormRow['definition_json']): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const screen of normalizeDefinition(definition).screens) {
    for (const field of screen.fields) {
      if (field.kind === 'heading') continue;
      labels[field.id] = field.label;
    }
  }
  return labels;
}
