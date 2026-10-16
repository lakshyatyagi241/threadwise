import {
  META_LEAD_PLATFORM_FACEBOOK,
  META_LEAD_PLATFORM_INSTAGRAM,
  META_LEAD_REQUIRED_SCOPES,
  META_LEAD_SOURCE_REF_PREFIX,
  type MetaLeadAccess,
  type MetaLeadSyncState,
  type MetaQuestionTarget,
} from '@crm/contracts';
import type {
  GraphLead,
  LeadFormCheckbox,
} from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import type { LeadConsent, NormalisedLead } from '../leads/lead-ingest.port';

/** The pure rules of the Meta lead ads door: no database, no Meta call, so each is unit-tested alone. */

// --- scopes and state -----------------------------------------------------------------------------------------------------------

/** Whether the permissions a Page was connected with include the lead ones, and which are missing. */
export function leadAccessOf(granted: readonly string[]): {
  access: MetaLeadAccess;
  missing: string[];
} {
  const have = new Set(granted);
  const missing = META_LEAD_REQUIRED_SCOPES.filter((s) => !have.has(s));
  return { access: missing.length === 0 ? 'granted' : 'missing', missing };
}

export type SyncErrorKind = 'token' | 'permission' | 'other';

/**
 * What a Graph error means for the Page. 190 and its relatives are a token that was revoked or expired (reconnect); 10 and the 200s are a
 * permission Meta withheld (re-consent); 4, 17, 32, 341, 613 and 80000-80014 are Meta slowing us down, and 1 and 2 are Meta failing:
 * both are worth another try, so they are `transient`, not an error to show.
 */
export function classifyGraphError(code: number | undefined): SyncErrorKind | 'transient' {
  if (code === undefined) return 'transient';
  if (code === 190 || code === 102 || code === 463 || code === 467) return 'token';
  if (code === 10 || (code >= 200 && code <= 299)) return 'permission';
  if (
    code === 1 ||
    code === 2 ||
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 341 ||
    code === 613 ||
    (code >= 80000 && code <= 80014)
  ) {
    return 'transient';
  }
  return 'other';
}

/** Errors are kept to 490 characters on the row, like the Facebook channel's. */
export const clipError = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 490) : null;

export interface SyncStateInput {
  enabled: boolean;
  /** The Facebook channel's Page status: connected, expired, error, disconnected. */
  pageStatus: string;
  access: MetaLeadAccess;
  lastError: string | null;
  lastErrorKind: SyncErrorKind | null;
}

/** The one word the screen shows for a Page, in order of what the person has to do first. */
export function syncStateOf(i: SyncStateInput): MetaLeadSyncState {
  if (!i.enabled) return 'off';
  if (i.pageStatus !== 'connected' || i.lastErrorKind === 'token') return 'needs_reconnect';
  if (i.access === 'missing' || i.lastErrorKind === 'permission') return 'needs_lead_access';
  if (i.lastError) return 'error';
  return 'subscribed';
}

// --- the form's questions -------------------------------------------------------------------------------------------------------

const TYPE_TARGETS: Record<string, MetaQuestionTarget> = {
  FULL_NAME: 'name',
  FIRST_NAME: 'firstName',
  LAST_NAME: 'lastName',
  EMAIL: 'email',
  WORK_EMAIL: 'email',
  PHONE: 'phone',
  WORK_PHONE_NUMBER: 'phone',
};

/** Keys Meta uses for its standard questions, for a form whose question types came back as CUSTOM. */
const KEY_TARGETS: Record<string, MetaQuestionTarget> = {
  full_name: 'name',
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  work_email: 'email',
  phone_number: 'phone',
  work_phone_number: 'phone',
};

/** The contact field a question fills by itself (the pipeline's own aliases read the same keys); null for a question the admin maps. */
export function suggestTarget(type: string, key: string): MetaQuestionTarget | null {
  return TYPE_TARGETS[type.toUpperCase()] ?? KEY_TARGETS[key.toLowerCase()] ?? null;
}

// --- the lead -------------------------------------------------------------------------------------------------------------------

/** The platform label: Instagram placements arrive through the same Page and form, and say so in `platform`. */
export function platformOf(lead: Pick<GraphLead, 'platform'>): string {
  const p = (lead.platform ?? '').toLowerCase();
  return p === 'ig' || p.startsWith('instagram')
    ? META_LEAD_PLATFORM_INSTAGRAM
    : META_LEAD_PLATFORM_FACEBOOK;
}

/** Meta writes a phone as `p:+919876543210`; the prefix is Meta's marker, not part of the number. */
export function cleanAnswer(value: string): string {
  const v = value.trim();
  return /^p:\s*\+?[\d\s().-]{5,}$/i.test(v) ? v.replace(/^p:\s*/i, '') : v;
}

const MAX_CONSENT_TEXT = 2000;

/**
 * The consent proof a lead carries, or undefined. Only a ticked checkbox of the form's own custom disclaimer counts, and only when
 * the wording shown beside it is known: a bare "yes" with no words a person can read later is a label, not proof (the pipeline's
 * policy). A question the form's author wrote as an ordinary question ("I agree to be messaged") is NOT read as consent: nothing
 * marks it as consent, and guessing from a label is how a person gets messaged who never agreed.
 */
export function consentOf(
  lead: Pick<GraphLead, 'disclaimerResponses' | 'createdTime' | 'formId' | 'adId'>,
  checkboxes: readonly LeadFormCheckbox[],
  formId: string,
): LeadConsent | undefined {
  const ticked = lead.disclaimerResponses
    .filter((r) => r.checked)
    .map((r) => checkboxes.find((c) => c.key === r.key))
    .filter((c): c is LeadFormCheckbox => c !== undefined);
  if (ticked.length === 0) return undefined;
  const consent: LeadConsent = {
    given: true,
    text: ticked
      .map((c) => c.text)
      .join('\n')
      .slice(0, MAX_CONSENT_TEXT),
    formId: lead.formId ?? formId,
  };
  if (lead.createdTime) consent.at = lead.createdTime;
  if (lead.adId) consent.adId = lead.adId;
  return consent;
}

/** What the pipeline's mapping can point at besides the form's own questions: ids Meta sends with every lead. */
export const META_FIELD_KEYS = {
  leadId: 'meta_lead_id',
  formId: 'meta_form_id',
  formName: 'meta_form_name',
  pageId: 'meta_page_id',
  adId: 'meta_ad_id',
  adsetId: 'meta_adset_id',
  campaignId: 'meta_campaign_id',
} as const;

/**
 * A Graph lead as the pipeline takes it. The answers are filed under the form's own question keys (so a mapping points at
 * `phone_number`), several answers to one question joined with ", ". Meta's ids ride along as `meta_*` fields, never under a name the
 * pipeline's aliases would take for a campaign or a form. The campaign, ad set and ad NAMES are the attribution; their ids stay in the
 * stored payload. `externalId` is Meta's `leadgen_id`, the idempotency key.
 */
export function toNormalisedLead(
  lead: GraphLead,
  form: { formId: string; name: string; pageId: string; checkboxes: readonly LeadFormCheckbox[] },
): NormalisedLead {
  const fields: NormalisedLead['fields'] = {};
  for (const row of lead.fieldData) {
    if (row.values.length === 0) continue;
    fields[row.name] = row.values.map(cleanAnswer).join(', ');
  }
  const set = (key: string, value: string | null) => {
    if (value !== null) fields[key] = value;
  };
  set(META_FIELD_KEYS.leadId, lead.id);
  set(META_FIELD_KEYS.formId, lead.formId ?? form.formId);
  set(META_FIELD_KEYS.formName, form.name);
  set(META_FIELD_KEYS.pageId, form.pageId);
  set(META_FIELD_KEYS.adId, lead.adId);
  set(META_FIELD_KEYS.adsetId, lead.adsetId);
  set(META_FIELD_KEYS.campaignId, lead.campaignId);

  const attribution: NonNullable<NormalisedLead['attribution']> = {
    platform: platformOf(lead),
    form: form.name,
  };
  if (lead.campaignName) attribution.campaign = lead.campaignName;
  if (lead.adsetName) attribution.adset = lead.adsetName;
  if (lead.adName) attribution.ad = lead.adName;

  const out: NormalisedLead = {
    externalId: lead.id,
    fields,
    attribution,
    raw: lead.raw,
  };
  if (lead.createdTime) out.receivedAt = lead.createdTime;
  const consent = consentOf(lead, form.checkboxes, form.formId);
  if (consent) out.consent = consent;
  return out;
}

// --- the source -----------------------------------------------------------------------------------------------------------------

/** The stable reference of a form's lead source: unique per workspace, the same on every reconnect. */
export const sourceRefOf = (pageId: string, formId: string): string =>
  `${META_LEAD_SOURCE_REF_PREFIX}${pageId}:${formId}`;

/** "Page name - Form name", cut to the source name limit. */
export function sourceNameOf(pageName: string | null, formName: string): string {
  const name = pageName ? `${pageName} - ${formName}` : formName;
  return name.length > 120 ? name.slice(0, 119) + '…' : name;
}

// --- the sweep ------------------------------------------------------------------------------------------------------------------

/** Re-read this much before the checkpoint: a lead whose webhook was missed an instant before the last sweep is still inside the window. */
export const SWEEP_OVERLAP_MS = 2 * 3_600_000;
/** Meta keeps a lead about 90 days; reading further back finds nothing. */
export const SWEEP_MAX_LOOKBACK_MS = 80 * 86_400_000;
/** Leads read from one form in one run. A run that hits it does not move the checkpoint, so the next run reads the window again. */
export const SWEEP_MAX_LEADS = 2000;

/** The `time_created` bound (epoch seconds) for the next read of a form. */
export function sweepSince(checkpoint: Date, now: Date): number {
  const from = Math.max(
    checkpoint.getTime() - SWEEP_OVERLAP_MS,
    now.getTime() - SWEEP_MAX_LOOKBACK_MS,
  );
  return Math.floor(from / 1000);
}
