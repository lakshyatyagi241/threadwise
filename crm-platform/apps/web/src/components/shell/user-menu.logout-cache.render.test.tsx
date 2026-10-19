// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { UserMenu, type ShellUser } from './user-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: () => undefined, refresh: () => undefined }),
}));
vi.mock('./actions', () => ({ setTheme: async () => undefined }));

/**
 * D-64-05 (Sheet3 #64): the staff sign-out used `router.replace('/login')`, a navigation that keeps the page's JavaScript running, so
 * the browser's TanStack Query cache (30 s fresh, 5 min kept) survived it. The next person to sign in on the same tab saw the
 * previous person's lists first. A sign-out must leave no client cache of the old account: either a full page navigation (which
 * discards the JavaScript heap) or an explicit `queryClient.clear()`.
 */
const user: ShellUser = { fullName: 'Asha Rao', email: 'asha@acme.test', avatarUrl: null };
let root: Root;
let host: HTMLElement;
const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  replace.mockClear();
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
});

describe('signing out of the staff app', () => {
  it('leaves no client cache of the old account behind', async () => {
    const client = new QueryClient();
    client.setQueryData(['contacts', 'list'], [{ name: 'A customer of the first workspace' }]);

    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <NextIntlClientProvider locale="en" messages={loadMessages('en')}>
            <UserMenu user={user} theme="light" settingsHref="/settings" />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });
    act(() => {
      (host.querySelector('[data-testid="user-menu"]') as HTMLElement).click();
    });
    const logout = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Log out'));
    expect(logout).toBeTruthy();
    await act(async () => {
      logout!.click();
    });

    const fullNavigation = assign.mock.calls.some(([to]) => to === '/login');
    const cacheCleared = client.getQueryData(['contacts', 'list']) === undefined;
    expect(fullNavigation || cacheCleared).toBe(true);
  });
});
