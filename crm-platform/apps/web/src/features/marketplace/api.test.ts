import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  cancelSubscription,
  fetchSubscriptions,
  mktKeys,
  resumeSubscription,
  subscribeToApp,
  syncSubscription,
} from './api';
import { ID, PACK_PATH, detail, installation, paidPricing, subscription } from './test-fixtures';

/** The workspace calls of a paid app, with `fetch` standing in for the API: which address, which method, which body, what is parsed. */

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
  headers: { get: () => null },
});

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => reply(status, body));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastCall = (fn: ReturnType<typeof stubFetch>) => {
  const [url, init] = fn.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

afterEach(() => vi.unstubAllGlobals());

describe('subscribe, cancel, resume and the list of subscriptions', () => {
  it('subscribes with a plain POST, the trial flag as the body, and parses the checkout answer', async () => {
    const fn = stubFetch(200, {
      outcome: 'checkout',
      checkout: { packSlug: 'mkt_0123456789abcdef0123', path: PACK_PATH },
      subscription: null,
    });
    const out = await subscribeToApp('webhook', { startTrial: false });
    const { url, init, headers } = lastCall(fn);
    expect(url).toBe('/api/v2/marketplace/apps/webhook/subscribe');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ startTrial: false }));
    expect(headers['Content-Type']).toBe('application/json');
    expect(out.outcome).toBe('checkout');
    expect(out.checkout?.path).toBe(PACK_PATH);
  });

  it('starts the trial and parses the subscription it answers', async () => {
    const trial = subscription({
      status: 'trialing',
      source: 'trial',
      amount: null,
      currency: null,
    });
    const fn = stubFetch(200, { outcome: 'trial_started', checkout: null, subscription: trial });
    const out = await subscribeToApp('webhook', { startTrial: true });
    expect(lastCall(fn).init.body).toBe(JSON.stringify({ startTrial: true }));
    expect(out.outcome).toBe('trial_started');
    expect(out.subscription?.status).toBe('trialing');
  });

  it('encodes the app reference into the path', async () => {
    const fn = stubFetch(200, { outcome: 'free', checkout: null, subscription: null });
    await subscribeToApp('a b/c', { startTrial: false });
    expect(lastCall(fn).url).toBe('/api/v2/marketplace/apps/a%20b%2Fc/subscribe');
  });

  it('cancels and resumes with a POST that has no body, and parses the new subscription', async () => {
    const canceling = subscription({
      status: 'canceling',
      actions: { canCancel: false, canResume: true, canRenew: false },
    });
    const fn = stubFetch(200, { subscription: canceling });
    const cancelled = await cancelSubscription('webhook');
    expect(lastCall(fn)).toMatchObject({
      url: '/api/v2/marketplace/apps/webhook/subscription/cancel',
      init: { method: 'POST' },
    });
    expect(lastCall(fn).init.body).toBeUndefined();
    expect(cancelled.subscription.status).toBe('canceling');
    const resumed = await resumeSubscription('webhook');
    expect(lastCall(fn).url).toBe('/api/v2/marketplace/apps/webhook/subscription/resume');
    expect(resumed.subscription.actions.canResume).toBe(true);
  });

  it('reads the workspace subscriptions with their app and installation', async () => {
    const fn = stubFetch(200, {
      data: [
        {
          ...subscription(),
          app: { id: ID(1), slug: 'webhook', name: 'Webhook', kind: 'integration', logo: null },
          installationId: ID(50),
        },
      ],
    });
    const out = await fetchSubscriptions();
    expect(lastCall(fn)).toMatchObject({
      url: '/api/v2/marketplace/subscriptions',
      init: { method: 'GET' },
    });
    expect(out.data[0]?.app.slug).toBe('webhook');
    expect(out.data[0]?.installationId).toBe(ID(50));
  });

  it('refuses an answer that is not the contract', async () => {
    stubFetch(200, { outcome: 'surprise', checkout: null, subscription: null });
    await expect(subscribeToApp('webhook', { startTrial: false })).rejects.toThrow();
  });

  it('throws the problem with its code, for the screens to branch on', async () => {
    stubFetch(409, {
      type: 'about:blank',
      code: 'MKT_NOT_FOR_SALE',
      title: 'x',
      status: 409,
      detail: 'x',
    });
    const error = await subscribeToApp('webhook', { startTrial: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('MKT_NOT_FOR_SALE');
  });
});

describe('the cache after a subscription answer', () => {
  const key = mktKeys.app('webhook');
  const withApp = (app = detail({ pricing: paidPricing() })) => {
    const qc = new QueryClient();
    qc.setQueryData(key, app);
    return qc;
  };

  it('puts the answer in the cached app page and entitles the workspace at once', () => {
    const qc = withApp();
    const trial = subscription({ status: 'trialing', source: 'trial' });
    syncSubscription(qc, 'webhook', trial);
    const app = qc.getQueryData<ReturnType<typeof detail>>(key)!;
    expect(app.subscription?.status).toBe('trialing');
    expect(app.pricing.access).toBe('entitled');
    expect(app.pricing.trialAvailable).toBe(false);
    // Everything that derives from it is read again.
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('does not entitle for an ended subscription', () => {
    const qc = withApp();
    syncSubscription(qc, 'webhook', subscription({ status: 'ended' }));
    expect(qc.getQueryData<ReturnType<typeof detail>>(key)!.pricing.access).toBe(
      'subscription_required',
    );
  });

  it('keeps the access an app already had (an included app stays included)', () => {
    const qc = withApp(
      detail({ pricing: paidPricing({ access: 'included', includedBy: 'min_plan' }) }),
    );
    syncSubscription(qc, 'webhook', subscription());
    expect(qc.getQueryData<ReturnType<typeof detail>>(key)!.pricing.access).toBe('included');
  });

  it('replaces the subscription of the cached installation of that app, and only that app', () => {
    const qc = withApp();
    qc.setQueryData(mktKeys.installation(ID(50)), installation({ subscription: subscription() }));
    const other = installation({
      id: ID(51),
      app: { ...installation().app, slug: 'other', name: 'Other' },
      subscription: subscription(),
    });
    qc.setQueryData(mktKeys.installation(ID(51)), other);
    syncSubscription(
      qc,
      'webhook',
      subscription({
        status: 'canceling',
        actions: { canCancel: false, canResume: true, canRenew: false },
      }),
    );
    expect(
      qc.getQueryData<ReturnType<typeof installation>>(mktKeys.installation(ID(50)))?.subscription
        ?.status,
    ).toBe('canceling');
    expect(
      qc.getQueryData<ReturnType<typeof installation>>(mktKeys.installation(ID(51)))?.subscription
        ?.status,
    ).toBe('active');
    expect(qc.getQueryState(mktKeys.installation(ID(50)))?.isInvalidated).toBe(true);
  });

  it('marks the lists, the shelves and the subscriptions stale', () => {
    const qc = withApp();
    qc.setQueryData(mktKeys.installations('all', 'all'), {
      data: [],
      usage: { installed: 0, limit: 0 },
    });
    qc.setQueryData(mktKeys.subscriptions, { data: [] });
    qc.setQueryData(['marketplace', 'shelves', 'integration'], {});
    qc.setQueryData([...mktKeys.apps('integration'), {}], {});
    syncSubscription(qc, 'webhook', subscription());
    for (const k of [
      mktKeys.installations('all', 'all'),
      mktKeys.subscriptions,
      ['marketplace', 'shelves', 'integration'],
      [...mktKeys.apps('integration'), {}],
    ]) {
      expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
    }
  });

  it('changes nothing in the cached app when there is no subscription to put there', () => {
    const qc = withApp();
    syncSubscription(qc, 'webhook', null);
    expect(qc.getQueryData<ReturnType<typeof detail>>(key)?.subscription).toBeNull();
  });
});
