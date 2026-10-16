import { Inject, Injectable } from '@nestjs/common';
import { graphCall } from '../channel-facebook/facebook-graph.client';
import {
  FACEBOOK_GRAPH,
  FB_SUBSCRIBED_FIELDS,
  type FacebookGraphFactory,
  type GraphResult,
} from '../channel-facebook/facebook.port';
import {
  mergeSubscribedFields,
  normaliseForm,
  normaliseLead,
  subscribedFieldsOf,
} from './meta-lead-ads.parse';
import type {
  FormLeads,
  GraphLead,
  LeadForm,
  MetaLeadAdsGraph,
  MetaLeadAdsPageApi,
} from './meta-lead-ads.port';

const LEADGEN = 'leadgen';
const PAGE_SIZE = 100;
/** `leadgen_forms` and `/leads` are followed at most this many pages of 100 (a guard against a loop in Meta's own paging). */
const MAX_PAGES = 60;

const FORM_FIELDS =
  'id,name,status,locale,leads_count,created_time,questions{id,key,label,type},custom_disclaimer,privacy_policy';

/** What a lead is asked for. `platform` and the disclaimer responses are newer fields: a Graph version without them is retried without. */
const LEAD_FIELDS_CORE =
  'id,created_time,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,is_organic,field_data';
const LEAD_FIELDS_FULL = `${LEAD_FIELDS_CORE},platform,custom_disclaimer_responses`;

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});

/** Meta's code for "a field does not exist on this node / version" (and other malformed requests). */
const INVALID_PARAMETER = 100;

class PageApi implements MetaLeadAdsPageApi {
  constructor(
    private readonly version: string,
    private readonly token: string,
    private readonly pageId: string,
    private readonly appId: string | null,
  ) {}

  private get(path: string, query: Record<string, string> = {}) {
    return graphCall(this.version, 'GET', path, { token: this.token, query });
  }

  /** Reads a Graph list to its end (bounded). `next` addresses are followed only when they stay on Meta, over https (`graphCall` checks). */
  private async readAll(
    path: string,
    query: Record<string, string>,
    max: number,
  ): Promise<GraphResult<{ rows: unknown[]; capped: boolean }>> {
    const rows: unknown[] = [];
    let next: string = path;
    let q: Record<string, string> | undefined = query;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await graphCall(this.version, 'GET', next, { token: this.token, query: q });
      if (!r.ok) return { ok: false, error: r.error, code: r.code };
      const data = r.data?.data;
      if (Array.isArray(data)) rows.push(...data);
      if (rows.length >= max) return { ok: true, data: { rows: rows.slice(0, max), capped: true } };
      const following = obj(r.data?.paging).next;
      if (typeof following !== 'string' || following === '') {
        return { ok: true, data: { rows, capped: false } };
      }
      next = following;
      q = undefined; // the `next` address already carries its query string
    }
    return { ok: true, data: { rows, capped: true } };
  }

  async listForms(): Promise<GraphResult<LeadForm[]>> {
    const r = await this.readAll(
      `${this.pageId}/leadgen_forms`,
      { fields: FORM_FIELDS, limit: String(PAGE_SIZE) },
      2000,
    );
    if (!r.ok || !r.data) return { ok: false, error: r.error, code: r.code };
    const forms = r.data.rows.map(normaliseForm).filter((f): f is LeadForm => f !== null);
    return { ok: true, data: forms };
  }

  async getForm(formId: string): Promise<GraphResult<LeadForm>> {
    const r = await this.get(formId, { fields: FORM_FIELDS });
    const form = r.ok ? normaliseForm(r.data) : null;
    return form
      ? { ok: true, data: form }
      : { ok: false, error: r.error ?? 'Meta returned no form.', code: r.code };
  }

  async getLead(leadgenId: string): Promise<GraphResult<GraphLead>> {
    let r = await this.get(leadgenId, { fields: LEAD_FIELDS_FULL });
    if (!r.ok && r.code === INVALID_PARAMETER) {
      r = await this.get(leadgenId, { fields: LEAD_FIELDS_CORE });
    }
    const lead = r.ok ? normaliseLead(r.data) : null;
    return lead
      ? { ok: true, data: lead }
      : { ok: false, error: r.error ?? 'Meta returned no lead.', code: r.code };
  }

  async listFormLeads(
    formId: string,
    sinceEpochSeconds: number,
    maxLeads: number,
  ): Promise<GraphResult<FormLeads>> {
    const filtering = JSON.stringify([
      { field: 'time_created', operator: 'GREATER_THAN', value: Math.max(0, sinceEpochSeconds) },
    ]);
    const read = (fields: string) =>
      this.readAll(
        `${formId}/leads`,
        { fields, filtering, limit: String(PAGE_SIZE) },
        // Meta lists newest first. One more than asked tells a read that stopped at the cap from one that ended exactly there.
        maxLeads + 1,
      );
    let r = await read(LEAD_FIELDS_FULL);
    if (!r.ok && r.code === INVALID_PARAMETER) r = await read(LEAD_FIELDS_CORE);
    if (!r.ok || !r.data) return { ok: false, error: r.error, code: r.code };
    const leads = r.data.rows.map(normaliseLead).filter((l): l is GraphLead => l !== null);
    const capped = r.data.capped && leads.length > maxLeads;
    // Oldest first, so contacts are created in the order the people applied.
    leads.reverse();
    return { ok: true, data: { leads: capped ? leads.slice(1) : leads, capped } };
  }

  async subscribedFields(): Promise<GraphResult<string[]>> {
    const r = await this.get(`${this.pageId}/subscribed_apps`);
    return r.ok
      ? { ok: true, data: subscribedFieldsOf(r.data, this.appId) }
      : { ok: false, error: r.error, code: r.code };
  }

  private async setFields(add: readonly string[], remove: readonly string[]) {
    const held = await this.subscribedFields();
    if (!held.ok) return held;
    const fields = mergeSubscribedFields(
      held.data ?? [],
      add.length > 0 ? FB_SUBSCRIBED_FIELDS.split(',').concat(add) : [],
      remove,
    );
    const set = await graphCall(this.version, 'POST', `${this.pageId}/subscribed_apps`, {
      token: this.token,
      form: { subscribed_fields: fields.join(',') },
    });
    if (!set.ok) return { ok: false, error: set.error, code: set.code } as GraphResult<string[]>;
    // Trust nothing but a read-back: a success without the field is how a missing permission looks on some Graph versions.
    return this.subscribedFields();
  }

  subscribeLeadgen(): Promise<GraphResult<string[]>> {
    return this.setFields([LEADGEN], []);
  }

  unsubscribeLeadgen(): Promise<GraphResult<string[]>> {
    return this.setFields([], [LEADGEN]);
  }
}

/**
 * The Graph adapter of the lead ads door. It reuses the Facebook channel's Graph settings (the Meta app, the Graph version) and its
 * single request function, so credentials are read from the one place the Facebook channel reads them and a token never leaves a header.
 */
@Injectable()
export class MetaLeadAdsGraphClient implements MetaLeadAdsGraph {
  constructor(@Inject(FACEBOOK_GRAPH) private readonly facebook: FacebookGraphFactory) {}

  forPage(token: string, pageId: string): MetaLeadAdsPageApi {
    const s = this.facebook.settings;
    return new PageApi(s.graphVersion, token, pageId, s.appId);
  }
}
