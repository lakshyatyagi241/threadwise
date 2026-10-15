import type {
  WaForm,
  WaFormAudienceType,
  WaFormDefinition,
  WaFormPickerItem,
  WaFormStatus,
  WaFormSubmission,
} from '@crm/contracts';
import type { WaFormRow } from './wa-forms.repository';

function countFields(def: WaFormRow['definition_json']): number {
  if (!def?.screens) return 0;
  return def.screens.reduce((n, s) => n + (Array.isArray(s.fields) ? s.fields.length : 0), 0);
}

export function toWaFormResponse(row: WaFormRow): WaForm {
  return {
    id: row.uuid,
    title: row.title,
    purpose: row.purpose,
    slug: row.slug,
    audienceType: row.audience_type as WaFormAudienceType,
    submissionCap: row.submission_cap,
    capReachedNote: row.cap_reached_note,
    sendButtonLabel: row.send_button_label,
    thankYouNote: row.thank_you_note,
    definition: (row.definition_json ?? { screens: [] }) as WaFormDefinition,
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
  for (const screen of definition?.screens ?? []) {
    for (const field of screen.fields as Array<{ id: string; kind: string; label: string }>) {
      if (field.kind === 'heading') continue;
      labels[field.id] = field.label;
    }
  }
  return labels;
}
