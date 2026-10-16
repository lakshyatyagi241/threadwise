import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacebookGraphClients } from '../../../src/infra/providers/channel-facebook/facebook-graph.client';
import type { FacebookGraphFactory } from '../../../src/infra/providers/channel-facebook/facebook.port';
import { MetaLeadAdsGraphClient } from '../../../src/infra/providers/meta-lead-ads/meta-lead-ads-graph.client';

/**
 * The lead ads Graph adapter against a stubbed `fetch`: what it asks Meta for, how it pages, and how it edits the Page's webhook
 * subscription. No request leaves the process.
 */

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | null;
}
let calls: Call[] = [];
let answers: Array<(c: Call) => { status?: number; json: unknown }> = [];

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: URL | string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? 'GET',
        url: new URL(String(url)),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === 'string' ? init.body : null,
      };
      calls.push(call);
      const next = answers.shift();
      const a = next ? next(call) : { json: {} };
      const status = a.status ?? 200;
      return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(a.json) });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const facebook = {
  settings: {
    appId: '222',
    appSecret: 'app-secret',
    configId: null,
    graphVersion: 'v21.0',
    greetingFallbackVersion: '',
    verifyToken: null,
    signingSecrets: [],
  },
} as unknown as FacebookGraphFactory;

const page = () => new MetaLeadAdsGraphClient(facebook).forPage('page-token', '100');

describe('the token', () => {
  it('travels in a header and never in an address', async () => {
    answers.push(() => ({ json: { data: [] } }));
    await page().listForms();
    expect(calls[0]!.headers.Authorization).toBe('Bearer page-token');
    expect(calls[0]!.url.toString()).not.toContain('page-token');
    expect(calls[0]!.url.toString()).not.toContain('app-secret');
  });
});

describe('lead forms', () => {
  it('are listed with their questions and followed through Meta’s paging', async () => {
    answers.push(() => ({
      json: {
        data: [{ id: '1', name: 'A' }],
        paging: { next: 'https://graph.facebook.com/v21.0/100/leadgen_forms?after=x' },
      },
    }));
    answers.push(() => ({ json: { data: [{ id: '2', name: 'B' }] } }));
    const r = await page().listForms();
    expect(r.ok).toBe(true);
    expect(r.data?.map((f) => f.id)).toEqual(['1', '2']);
    expect(calls[0]!.url.pathname).toBe('/v21.0/100/leadgen_forms');
    expect(calls[0]!.url.searchParams.get('fields')).toContain('questions{id,key,label,type}');
    expect(calls[0]!.url.searchParams.get('fields')).toContain('custom_disclaimer');
  });

  it('never follow a paging address that leaves Meta', async () => {
    answers.push(() => ({
      json: { data: [{ id: '1' }], paging: { next: 'https://evil.example/steal' } },
    }));
    const r = await page().listForms();
    expect(r.ok).toBe(false);
    // The token only ever went to Meta; the refused follow-up never became a request.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.hostname).toBe('graph.facebook.com');
  });

  it('carry Meta’s refusal as a plain result, never a throw', async () => {
    answers.push(() => ({
      status: 400,
      json: { error: { code: 190, message: 'Invalid OAuth access token.' } },
    }));
    const r = await page().listForms();
    expect(r).toEqual({ ok: false, error: 'Invalid OAuth access token.', code: 190 });
  });
});

describe('one lead', () => {
  it('is asked for with its form, ad names and answers', async () => {
    answers.push(() => ({
      json: { id: '9', form_id: '5', field_data: [{ name: 'email', values: ['a@b.test'] }] },
    }));
    const r = await page().getLead('9');
    expect(r.data?.id).toBe('9');
    const fields = calls[0]!.url.searchParams.get('fields')!;
    for (const f of [
      'field_data',
      'form_id',
      'ad_name',
      'adset_name',
      'campaign_name',
      'custom_disclaimer_responses',
    ]) {
      expect(fields).toContain(f);
    }
  });

  it('is asked for again without the newer fields when the Graph version does not know them', async () => {
    answers.push(() => ({
      status: 400,
      json: { error: { code: 100, message: 'Tried accessing nonexisting field (platform)' } },
    }));
    answers.push(() => ({ json: { id: '9' } }));
    const r = await page().getLead('9');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url.searchParams.get('fields')).not.toContain('platform');
    expect(calls[1]!.url.searchParams.get('fields')).not.toContain('custom_disclaimer_responses');
  });

  it('is a refusal when Meta answers with something that is not a lead', async () => {
    answers.push(() => ({ json: {} }));
    expect((await page().getLead('9')).ok).toBe(false);
  });
});

describe('the leads of a form since a time', () => {
  it('are filtered by creation time on Meta’s side and returned oldest first', async () => {
    answers.push(() => ({ json: { data: [{ id: '3' }, { id: '2' }, { id: '1' }] } }));
    const r = await page().listFormLeads('5', 1_700_000_000, 50);
    expect(r.data?.leads.map((l) => l.id)).toEqual(['1', '2', '3']);
    expect(r.data?.capped).toBe(false);
    const filtering = JSON.parse(calls[0]!.url.searchParams.get('filtering')!);
    expect(filtering).toEqual([
      { field: 'time_created', operator: 'GREATER_THAN', value: 1_700_000_000 },
    ]);
  });

  it('say when they stopped at the cap, and keep the newest', async () => {
    answers.push(() => ({ json: { data: [{ id: '4' }, { id: '3' }, { id: '2' }] } }));
    const r = await page().listFormLeads('5', 0, 2);
    expect(r.data?.capped).toBe(true);
    expect(r.data?.leads.map((l) => l.id)).toEqual(['3', '4']);
  });
});

describe('the Page’s webhook subscription', () => {
  const held = (fields: string[]) => ({
    json: { data: [{ id: '222', subscribed_fields: fields }] },
  });

  it('gets leadgen added WITHOUT dropping the fields the Facebook channel needs', async () => {
    answers.push(() => held(['feed', 'messages']));
    answers.push(() => ({ json: { success: true } }));
    answers.push(() => held(['feed', 'messages', 'leadgen']));
    const r = await page().subscribeLeadgen();
    expect(r.data).toContain('leadgen');
    const post = calls.find((c) => c.method === 'POST')!;
    const sent = new URLSearchParams(post.body ?? '').get('subscribed_fields')!.split(',');
    expect(sent).toContain('leadgen');
    expect(sent).toContain('feed');
    expect(sent).toContain('messages');
    expect(sent).toContain('messaging_postbacks');
    expect(new Set(sent).size).toBe(sent.length);
  });

  it('answers with what Meta holds afterwards, so a silent refusal shows', async () => {
    answers.push(() => held(['feed']));
    answers.push(() => ({ json: { success: true } }));
    answers.push(() => held(['feed']));
    expect((await page().subscribeLeadgen()).data).not.toContain('leadgen');
  });

  it('removes leadgen and keeps the rest', async () => {
    answers.push(() => held(['feed', 'leadgen']));
    answers.push(() => ({ json: { success: true } }));
    answers.push(() => held(['feed']));
    await page().unsubscribeLeadgen();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(new URLSearchParams(post.body ?? '').get('subscribed_fields')).toBe('feed');
  });

  it('stops at a refusal to read the subscription', async () => {
    answers.push(() => ({ status: 400, json: { error: { code: 190, message: 'expired' } } }));
    const r = await page().subscribeLeadgen();
    expect(r.ok).toBe(false);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});

describe('the Facebook channel’s own subscribe', () => {
  it('keeps leadgen when the Page has lead ads on, so "Fix inbound" never switches them off', async () => {
    const config = {
      get: (k: string) =>
        ({
          FB_APP_ID: '222',
          FB_APP_SECRET: 's',
          META_GRAPH_VERSION: 'v21.0',
          FB_GREETING_GRAPH_VERSION: '',
        })[k],
    };
    const clients = new FacebookGraphClients(config as never);
    answers.push(() => ({
      json: { data: [{ id: '222', subscribed_fields: ['feed', 'leadgen'] }] },
    }));
    answers.push(() => ({ json: { success: true } }));
    await clients.forPage('t', '100').subscribeWebhooks();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(new URLSearchParams(post.body ?? '').get('subscribed_fields')).toMatch(/,leadgen$/);
  });

  it('is unchanged for a Page without lead ads', async () => {
    const config = {
      get: (k: string) =>
        ({
          FB_APP_ID: '222',
          FB_APP_SECRET: 's',
          META_GRAPH_VERSION: 'v21.0',
          FB_GREETING_GRAPH_VERSION: '',
        })[k],
    };
    const clients = new FacebookGraphClients(config as never);
    answers.push(() => ({ json: { data: [{ id: '222', subscribed_fields: ['feed'] }] } }));
    answers.push(() => ({ json: { success: true } }));
    await clients.forPage('t', '100').subscribeWebhooks();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(new URLSearchParams(post.body ?? '').get('subscribed_fields')).not.toContain('leadgen');
  });
});
