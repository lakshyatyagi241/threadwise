// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureAddon } from '@crm/contracts';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { FeatureAddonLock } from './feature-addon-lock';

const ID = '00000000-0000-4000-8000-000000000001';
const addon: FeatureAddon = {
  feature: 'inbox_routing',
  addonSlug: 'smart_routing',
  addonName: 'Smart routing',
  offer: 'disabled',
  amount: '199.00',
  currency: 'INR',
  billingUnit: 'months',
  billingDuration: 1,
};
const list = {
  eligible: true,
  unavailableReason: null,
  canBuy: true,
  owned: [],
  catalog: [
    {
      id: ID,
      slug: 'smart_routing',
      name: 'Smart routing',
      subtitle: null,
      amount: '199.00',
      offerAmount: null,
      currency: 'INR',
      isFree: false,
      isLifetime: false,
      billingUnit: 'months',
      billingDuration: 1,
      billingMode: 'recurring',
      grantBullets: [],
      ownedCount: 0,
      ownedEndsAt: null,
      ownedRenews: false,
      state: 'included',
      includedVia: 'plan',
      kind: 'feature',
      activation: 'disabled',
      canToggle: true,
    },
  ],
};

let host: HTMLElement | undefined;
let root: Root | undefined;
let calls: Array<{ url: string; method: string; headers: Headers }> = [];
let enableStatus = 200;

beforeEach(() => {
  router.refresh.mockClear();
  calls = [];
  enableStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, headers: new Headers(init.headers) });
      const body =
        method === 'GET'
          ? list
          : enableStatus === 200
            ? { addonId: ID, activation: 'active', changedAt: '2026-10-23T10:00:00.000Z' }
            : { type: 'about:blank', title: 'x', status: enableStatus, code: 'INTERNAL_ERROR' };
      return new Response(JSON.stringify(body), {
        status: method === 'GET' ? 200 : enableStatus,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
  vi.unstubAllGlobals();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <PlanFeaturesProvider features={[]} featureAddons={[addon]}>
            <FeatureAddonLock feature="inbox_routing" />
          </PlanFeaturesProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const button = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="feature-addon-lock-turn-on"]')!;

describe('FeatureAddonLock: Turn it on', () => {
  it('finds the add-on by its slug in the workspace list, enables it by id (no body) and refreshes the page', async () => {
    await mount();
    await act(async () => button().click());
    await until(() => router.refresh.mock.calls.length > 0);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v2/addons',
      `POST /api/v2/addons/${ID}/enable`,
    ]);
    expect(calls[1]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a failure is said next to the button and nothing is refreshed', async () => {
    enableStatus = 500;
    await mount();
    await act(async () => button().click());
    expect(
      document.querySelector('[data-testid="feature-addon-lock-error"]')!.textContent,
    ).toContain("We couldn't turn Smart routing on");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });
});
