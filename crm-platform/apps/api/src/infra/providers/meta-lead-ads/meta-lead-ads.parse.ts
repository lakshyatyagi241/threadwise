import type { GraphLead, LeadForm, LeadFormCheckbox, LeadFormQuestion } from './meta-lead-ads.port';

/** Reading Meta's answers into the port's shapes. Pure: no network, so every rule is unit-tested alone. */

type Dict = Record<string, unknown>;

const dict = (x: unknown): Dict => (typeof x === 'object' && x !== null ? (x as Dict) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : null;
const text = (x: unknown): string | null => {
  const s = str(x);
  return s === null || s.trim() === '' ? null : s;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Meta writes times as `2026-10-16T08:30:00+0000` (no colon in the offset), which `Date` does not always read. Returns ISO 8601 UTC or
 * null when the value is not a time.
 */
export function isoTime(x: unknown): string | null {
  const s = text(x);
  if (s === null) return null;
  const fixed = ISO_RE.test(s) ? s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : s;
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normaliseQuestions(raw: unknown): LeadFormQuestion[] {
  const out: LeadFormQuestion[] = [];
  const seen = new Set<string>();
  for (const q of list(raw).map(dict)) {
    const key = text(q.key);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: text(q.label) ?? key, type: (text(q.type) ?? 'CUSTOM').toUpperCase() });
  }
  return out;
}

/** The custom disclaimer's checkboxes. Only a box with wording is kept: a consent proof needs the words the person saw. */
export function normaliseCheckboxes(disclaimer: unknown): LeadFormCheckbox[] {
  const out: LeadFormCheckbox[] = [];
  for (const c of list(dict(disclaimer).checkboxes).map(dict)) {
    const key = text(c.key);
    const wording = text(c.text);
    if (key === null || wording === null) continue;
    out.push({ key, text: wording.slice(0, 2000), required: c.is_required === true });
  }
  return out;
}

export function normaliseForm(raw: unknown): LeadForm | null {
  const f = dict(raw);
  const id = text(f.id);
  if (id === null) return null;
  const count = typeof f.leads_count === 'number' ? f.leads_count : Number(f.leads_count);
  return {
    id,
    name: text(f.name) ?? id,
    status: text(f.status),
    locale: text(f.locale),
    leadsCount: Number.isFinite(count) && count >= 0 ? Math.trunc(count) : null,
    createdTime: isoTime(f.created_time),
    questions: normaliseQuestions(dict(f.questions).data ?? f.questions),
    checkboxes: normaliseCheckboxes(f.custom_disclaimer),
    privacyPolicyUrl: text(dict(f.privacy_policy).url),
  };
}

export function normaliseLead(raw: unknown): GraphLead | null {
  const l = dict(raw);
  const id = text(l.id);
  if (id === null) return null;
  const fieldData: GraphLead['fieldData'] = [];
  for (const row of list(l.field_data).map(dict)) {
    const name = text(row.name);
    if (name === null) continue;
    const values = list(row.values)
      .map((v) => str(v))
      .filter((v): v is string => v !== null && v.trim() !== '');
    fieldData.push({ name, values });
  }
  const responses: GraphLead['disclaimerResponses'] = [];
  for (const r of list(l.custom_disclaimer_responses).map(dict)) {
    const key = text(r.checkbox_key);
    if (key !== null) responses.push({ key, checked: r.is_checked === true });
  }
  return {
    id,
    createdTime: isoTime(l.created_time),
    formId: text(l.form_id),
    adId: text(l.ad_id),
    adName: text(l.ad_name),
    adsetId: text(l.adset_id),
    adsetName: text(l.adset_name),
    campaignId: text(l.campaign_id),
    campaignName: text(l.campaign_name),
    platform: text(l.platform),
    isOrganic: l.is_organic === true,
    fieldData,
    disclaimerResponses: responses,
    raw,
  };
}

/** The webhook fields of this app's entry in `GET /{page}/subscribed_apps`. With no app id the only entry is taken. */
export function subscribedFieldsOf(data: unknown, appId: string | null): string[] {
  const rows = list(dict(data).data).map(dict);
  const mine = appId
    ? rows.find((r) => str(r.id) === appId)
    : rows.length === 1
      ? rows[0]
      : undefined;
  return list(mine?.subscribed_fields)
    .map((f) => str(f))
    .filter((f): f is string => f !== null);
}

/** The fields to subscribe: what is held, plus `add`, minus `remove`, each once, in a stable order. */
export function mergeSubscribedFields(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[] = [],
): string[] {
  const gone = new Set(remove);
  return [...new Set([...current, ...add])].filter((f) => !gone.has(f));
}
