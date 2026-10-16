import type { GraphResult } from '../../src/infra/providers/channel-facebook/facebook.port';
import { MetaLeadAdsGraphClient } from '../../src/infra/providers/meta-lead-ads/meta-lead-ads-graph.client';
import type {
  FormLeads,
  GraphLead,
  LeadForm,
  MetaLeadAdsPageApi,
} from '../../src/infra/providers/meta-lead-ads/meta-lead-ads.port';

/**
 * A stand-in for Meta's lead ads Graph (the port's fake): forms, leads and a webhook subscription held in memory, a call log, and a
 * switch to make any method answer with a Graph error. Nothing here touches the network. `install()` swaps it in for every instance of
 * the real adapter, in the HTTP app and in a worker module loaded next to it.
 */
export type FakeMethod =
  | 'listForms'
  | 'getForm'
  | 'getLead'
  | 'listFormLeads'
  | 'subscribedFields'
  | 'subscribeLeadgen'
  | 'unsubscribeLeadgen';

export interface FakeCall {
  method: FakeMethod;
  token: string;
  pageId: string;
  args: unknown[];
}

const ok = <T>(data: T): GraphResult<T> => ({ ok: true, data });

export class FakeMetaLeadAds {
  calls: FakeCall[] = [];
  forms = new Map<string, LeadForm[]>();
  /** Leads by form id, in any order. */
  leads = new Map<string, GraphLead[]>();
  /** Webhook fields held per Page. */
  fields = new Map<string, string[]>();
  /** A method that answers with a Graph error instead of its data, until cleared. */
  failures = new Map<FakeMethod, { code: number; error: string }>();
  /** When true, a subscribe is accepted but the field never shows up (what a silent permission refusal looks like). */
  swallowSubscribe = false;
  private original: MetaLeadAdsGraphClient['forPage'] | null = null;

  reset(): void {
    this.calls = [];
    this.forms.clear();
    this.leads.clear();
    this.fields.clear();
    this.failures.clear();
    this.swallowSubscribe = false;
  }

  fail(method: FakeMethod, code: number, error = 'Graph said no'): void {
    this.failures.set(method, { code, error });
  }

  callsTo(method: FakeMethod): FakeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  install(): void {
    this.original = MetaLeadAdsGraphClient.prototype.forPage;
    MetaLeadAdsGraphClient.prototype.forPage = (token: string, pageId: string) =>
      this.page(token, pageId);
  }

  uninstall(): void {
    if (this.original) MetaLeadAdsGraphClient.prototype.forPage = this.original;
  }

  private page(token: string, pageId: string): MetaLeadAdsPageApi {
    const run = <T>(
      method: FakeMethod,
      args: unknown[],
      fn: () => GraphResult<T>,
    ): GraphResult<T> => {
      this.calls.push({ method, token, pageId, args });
      const f = this.failures.get(method);
      return f ? { ok: false, code: f.code, error: f.error } : fn();
    };
    return {
      listForms: () =>
        Promise.resolve(run('listForms', [], () => ok([...(this.forms.get(pageId) ?? [])]))),
      getForm: (formId) =>
        Promise.resolve(
          run('getForm', [formId], () => {
            const f = (this.forms.get(pageId) ?? []).find((x) => x.id === formId);
            return f ? ok(f) : { ok: false, code: 100, error: 'Unsupported get request.' };
          }),
        ),
      getLead: (leadgenId) =>
        Promise.resolve(
          run('getLead', [leadgenId], () => {
            const all = [...this.leads.values()].flat();
            const l = all.find((x) => x.id === leadgenId);
            return l ? ok(l) : { ok: false, code: 100, error: 'Object does not exist.' };
          }),
        ),
      listFormLeads: (formId, since, max) =>
        Promise.resolve(
          run<FormLeads>('listFormLeads', [formId, since, max], () => {
            const all = (this.leads.get(formId) ?? [])
              .filter((l) => (l.createdTime ? Date.parse(l.createdTime) / 1000 > since : true))
              .sort((a, b) => Date.parse(a.createdTime ?? '') - Date.parse(b.createdTime ?? ''));
            return ok({ leads: all.slice(-max), capped: all.length > max });
          }),
        ),
      subscribedFields: () =>
        Promise.resolve(
          run('subscribedFields', [], () => ok([...(this.fields.get(pageId) ?? [])])),
        ),
      subscribeLeadgen: () =>
        Promise.resolve(
          run('subscribeLeadgen', [], () => {
            const held = this.fields.get(pageId) ?? ['feed', 'messages'];
            if (!this.swallowSubscribe) this.fields.set(pageId, [...new Set([...held, 'leadgen'])]);
            else this.fields.set(pageId, held);
            return ok([...(this.fields.get(pageId) ?? [])]);
          }),
        ),
      unsubscribeLeadgen: () =>
        Promise.resolve(
          run('unsubscribeLeadgen', [], () => {
            const held = (this.fields.get(pageId) ?? []).filter((f) => f !== 'leadgen');
            this.fields.set(pageId, held);
            return ok(held);
          }),
        ),
    };
  }
}

/** A form as Meta lists it, with the usual three questions and (optionally) one consent checkbox. */
export function aForm(id: string, name: string, over: Partial<LeadForm> = {}): LeadForm {
  return {
    id,
    name,
    status: 'ACTIVE',
    locale: 'en_US',
    leadsCount: 0,
    createdTime: '2026-10-01T10:00:00.000Z',
    questions: [
      { key: 'full_name', label: 'Full name', type: 'FULL_NAME' },
      { key: 'email', label: 'Email', type: 'EMAIL' },
      { key: 'phone_number', label: 'Phone', type: 'PHONE' },
      { key: 'what_is_your_budget', label: 'Budget?', type: 'CUSTOM' },
    ],
    checkboxes: [],
    privacyPolicyUrl: null,
    ...over,
  };
}

let seq = 0;
/** A lead as Meta returns it. */
export function aLead(formId: string, over: Partial<GraphLead> = {}): GraphLead {
  const n = ++seq;
  const id = over.id ?? `9${String(1000 + n)}${Date.now() % 100000}`;
  return {
    id,
    createdTime: new Date(Date.now() - 60_000).toISOString(),
    formId,
    adId: 'ad-77',
    adName: 'Diwali offer',
    adsetId: 'adset-77',
    adsetName: 'Mumbai 25-40',
    campaignId: 'camp-77',
    campaignName: 'Diwali 2026',
    platform: 'facebook',
    isOrganic: false,
    fieldData: [
      { name: 'full_name', values: [`Lead Person ${n}`] },
      { name: 'email', values: [`lead.person.${n}.${id}@example.test`] },
      { name: 'phone_number', values: [`p:+91${String(9000000000 + n * 7)}`] },
      { name: 'what_is_your_budget', values: ['10k'] },
    ],
    disclaimerResponses: [],
    raw: { id },
    ...over,
  };
}
