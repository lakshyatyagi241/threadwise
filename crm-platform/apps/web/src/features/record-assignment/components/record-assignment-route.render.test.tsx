// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The page the way the app mounts it: `app/(app)/(record-assignment)/layout.tsx` around `page.tsx`, with NO test-supplied toast host,
 * and the real hooks over a stubbed `fetch` (so the real schemas and error mapping run). The first version of the screen crashed into
 * the app-wide "Something went wrong" page on every workspace because nothing above it provided the toast context; its render test
 * wrapped the screen in its own provider and could not see that. These cases pin the route frame, the paywall gate and every failing
 * answer of the API.
 */

const state = vi.hoisted(() => ({ can: true }));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/record-assignment',
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
  useSession: () => ({ permissions: {}, org: {} }),
}));
vi.mock('@/features/plans-subscriptions-trials/components/plan-paywall', () => ({
  PlanPaywall: () => <div data-testid="paywall" />,
}));
vi.mock('@/features/persona-vocabulary', () => ({
  useVocabulary: () => ({
    noun: (k: string) =>
      k === 'contact'
        ? {
            singular: 'Contact',
            plural: 'Contacts',
            singularLower: 'contact',
            pluralLower: 'contacts',
          }
        : { singular: 'Deal', plural: 'Deals', singularLower: 'deal', pluralLower: 'deals' },
  }),
}));
vi.mock('@/features/contacts-attributes-tags', () => ({
  useModuleFields: () => ({ data: [], isSuccess: true, isError: false }),
  isUsableProperty: () => true,
}));
vi.mock('@/features/segments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/segments')>();
  return {
    ...actual,
    usePeople: () => ({ data: [] }),
    useTeams: () => ({ data: [] }),
    useSegmentCatalog: () => ({
      ready: true,
      failed: false,
      lookups: {},
      personName: () => undefined,
      catalog: [],
    }),
  };
});

import RecordAssignmentDomainLayout from '@/app/(app)/(record-assignment)/layout';
import RecordAssignmentPage from '@/app/(app)/(record-assignment)/record-assignment/page';
import { RecordAssignmentRouteError } from './route-error';

const read = (file: string) =>
  JSON.parse(
    readFileSync(join(__dirname, `../../../../messages/en/${file}.json`), 'utf8'),
  ) as Record<string, unknown>;
const messages = { ...read('record-assignment'), ...read('segments'), ...read('companies') };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const problem = (status: number, code: string) =>
  json(status, { type: 'about:blank', title: code, status, code, detail: code });

type Answer = () => Response;
const answer: { settings: Answer; rules: Answer } = {
  settings: () => json(200, {}),
  rules: () => json(200, {}),
};
const calls: string[] = [];
const settingsCalls = () => calls.filter((c) => c.includes('/assignment/settings')).length;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  state.can = true;
  calls.length = 0;
  answer.settings = () => json(200, { enabled: false, applyToImports: false });
  answer.rules = () => json(200, { data: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/assignment/settings')) return answer.settings();
      if (url.includes('/assignment/rules')) return answer.rules();
      if (url.includes('/assignment/runs')) return json(200, { data: [], nextCursor: null });
      return json(200, []);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const frame = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  </QueryClientProvider>
);
// A 5xx is retried with a growing wait (about 15 s in all) before the screen calls it an error.
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
const mount = async () => {
  await act(async () => {
    root.render(
      frame(
        <RecordAssignmentDomainLayout>
          <RecordAssignmentPage />
        </RecordAssignmentDomainLayout>,
      ),
    );
  });
  await settle();
};
const text = () => host.textContent ?? '';
const retryButtons = () =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Try again');

describe('the Record assignment rules route', () => {
  it('renders inside its own layout without any toast host from the test (the crash on every workspace)', async () => {
    await mount();
    expect(host.querySelector('[data-testid="record-assignment"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="ra-settings"] [role="switch"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="paywall"]')).toBeNull();
  });

  it('a plan with the feature: no paywall, the master switch and the rules load', async () => {
    await mount();
    expect(settingsCalls()).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes('/assignment/rules'))).toBe(true);
    expect(text()).toContain('Turn on record assignment');
  });

  for (const status of [402, 422]) {
    it(`a plan without the feature (${status} PLAN_FEATURE_LOCKED): the paywall, and none of the controls`, async () => {
      answer.settings = () => problem(status, 'PLAN_FEATURE_LOCKED');
      await mount();
      expect(host.querySelector('[data-testid="paywall"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="ra-settings"]')).toBeNull();
      expect(text()).toContain('Record assignment rules');
    });
  }

  for (const [status, code] of [
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [500, 'INTERNAL'],
  ] as const) {
    it(`API answers ${status}: an inline message with Try again, never the error page`, async () => {
      answer.settings = () => problem(status, code);
      answer.rules = () => problem(status, code);
      await mount();
      expect(host.querySelector('[data-testid="record-assignment"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="paywall"]')).toBeNull();
      expect(text()).toContain('The rules did not load.');
      expect(retryButtons().length).toBeGreaterThanOrEqual(2);
    });
  }

  it('an answer the contract does not know (migration or version skew) is an inline error too', async () => {
    answer.settings = () => json(200, { unexpected: true });
    answer.rules = () => json(200, null);
    await mount();
    expect(host.querySelector('[data-testid="record-assignment"]')).not.toBeNull();
    expect(text()).toContain('The rules did not load.');
  });

  it('Try again asks the API again and recovers when it answers', async () => {
    answer.settings = () => problem(500, 'INTERNAL');
    await mount();
    const before = settingsCalls();
    answer.settings = () => json(200, { enabled: true, applyToImports: false });
    await act(async () => retryButtons()[0]!.click());
    await settle();
    expect(settingsCalls()).toBeGreaterThan(before);
    expect(host.querySelector('[data-testid="ra-settings"] [role="switch"]')).not.toBeNull();
  });
});

describe('the route error boundary', () => {
  it('shows the failure inside the page frame with a retry that calls reset', async () => {
    const reset = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      root.render(frame(<RecordAssignmentRouteError error={new Error('boom')} reset={reset} />));
    });
    expect(host.querySelector('[data-testid="record-assignment-error"]')).not.toBeNull();
    expect(text()).toContain('The rules did not load.');
    await act(async () => retryButtons()[0]!.click());
    expect(reset).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
