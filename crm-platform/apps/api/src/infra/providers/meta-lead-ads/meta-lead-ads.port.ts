import type { GraphResult } from '../channel-facebook/facebook.port';

/**
 * Meta lead ads as the lead door needs them (BL-011): a Page's lead forms, one lead by its `leadgen_id`, the leads of a form since a
 * time, and the Page's `leadgen` webhook subscription. Every call returns a plain result and never throws: Meta refusing a token or a
 * permission is an expected outcome. Bound to a Page token, never to a concrete class, so tests use a fake and make no Meta call.
 *
 * The adapter normalises Meta's answers here (`normaliseLead`, `normaliseForm`), so nothing above it knows a Graph field name.
 */

export interface LeadFormQuestion {
  /** The key the answer is filed under in a lead's `field_data` (`full_name`, `phone_number`, `what_is_your_budget`). */
  key: string;
  label: string;
  /** Meta's question type: FULL_NAME, FIRST_NAME, LAST_NAME, EMAIL, PHONE, CUSTOM, CITY, ... */
  type: string;
}

/** A consent checkbox of the form's custom disclaimer: the wording shown beside it, and the key a lead's response names. */
export interface LeadFormCheckbox {
  key: string;
  text: string;
  required: boolean;
}

export interface LeadForm {
  id: string;
  name: string;
  /** ACTIVE, ARCHIVED, DELETED or DRAFT. */
  status: string | null;
  locale: string | null;
  leadsCount: number | null;
  createdTime: string | null;
  questions: LeadFormQuestion[];
  checkboxes: LeadFormCheckbox[];
  privacyPolicyUrl: string | null;
}

export interface GraphLead {
  /** The `leadgen_id`: Meta's id for this lead, the idempotency key. */
  id: string;
  /** ISO 8601. */
  createdTime: string | null;
  formId: string | null;
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** `facebook` or `instagram` when Meta says; null when the field is not available on the Graph version in use. */
  platform: string | null;
  isOrganic: boolean;
  /** The answers, in the order of the form. A multi-answer question holds several values. */
  fieldData: Array<{ name: string; values: string[] }>;
  /** The consent checkboxes the person saw: which key, and whether they ticked it. */
  disclaimerResponses: Array<{ key: string; checked: boolean }>;
  /** Meta's answer as it came, kept with the stored lead so a mapping can be fixed and the lead retried. */
  raw: unknown;
}

export interface FormLeads {
  /** Oldest first. */
  leads: GraphLead[];
  /** True when the read stopped at the cap with more still at Meta: the caller must not treat the window as fully read. */
  capped: boolean;
}

/** Calls made as one Page, with its token. */
export interface MetaLeadAdsPageApi {
  /** Every lead form of the Page, with its questions and consent checkboxes; follows Meta's paging. */
  listForms(): Promise<GraphResult<LeadForm[]>>;
  getForm(formId: string): Promise<GraphResult<LeadForm>>;
  /** One lead by its `leadgen_id`. */
  getLead(leadgenId: string): Promise<GraphResult<GraphLead>>;
  /** The leads of a form created after `sinceEpochSeconds`, oldest first, at most `maxLeads`. */
  listFormLeads(
    formId: string,
    sinceEpochSeconds: number,
    maxLeads: number,
  ): Promise<GraphResult<FormLeads>>;
  /** The webhook fields this app is subscribed to on the Page. */
  subscribedFields(): Promise<GraphResult<string[]>>;
  /**
   * Adds `leadgen` to the Page's subscription WITHOUT dropping the other fields (Meta replaces the whole list on a subscribe), then
   * reads the subscription back. The result is what Meta now holds, so a caller can confirm `leadgen` is in it.
   */
  subscribeLeadgen(): Promise<GraphResult<string[]>>;
  /** Removes `leadgen` and keeps the rest. */
  unsubscribeLeadgen(): Promise<GraphResult<string[]>>;
}

export interface MetaLeadAdsGraph {
  forPage(token: string, pageId: string): MetaLeadAdsPageApi;
}
export const META_LEAD_ADS_GRAPH = Symbol('META_LEAD_ADS_GRAPH');
