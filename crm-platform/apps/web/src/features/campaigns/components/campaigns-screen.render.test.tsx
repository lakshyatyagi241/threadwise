// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@crm/ui';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en/campaigns.json';
import { CampaignsScreen } from './campaigns-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/campaigns',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
  useSession: () => ({ org: { name: 'ISKM' }, user: { id: 1 } }),
}));

// The list is still loading: the header, the range controls and the address are what this test is about.
vi.mock('../api/campaigns', async (orig) => ({
  ...(await orig<typeof import('../api/campaigns')>()),
  useCampaignList: () => ({ data: undefined, isLoading: true, error: null }),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  nav.replace.mockClear();
  nav.search = '';
});

async function show(search: string) {
  nav.search = search;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <CampaignsScreen />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
const dayField = (testId: string) =>
  document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null;

/** Types a day the way a browser does for a controlled date input: the native setter, then the events React listens to. */
async function typeDay(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('campaigns list: the custom date range', () => {
  it('offers Custom range after the presets, and shows no day fields until it is picked', async () => {
    await show('');
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([
        'All time',
        'Last 7 days',
        'Last 30 days',
        'Last 90 days',
        'Custom range',
      ]),
    );
    expect(dayField('campaigns-range-from')).toBeNull();
    expect(dayField('campaigns-range-to')).toBeNull();

    await act(async () => button('Custom range').click());
    expect(nav.replace).toHaveBeenLastCalledWith('/campaigns?range=custom', { scroll: false });
  });

  it('shows the two days from the address and writes a day back into it, keeping the other', async () => {
    await show('?range=custom&from=2026-10-01');
    expect(dayField('campaigns-range-from')?.value).toBe('2026-10-01');
    expect(dayField('campaigns-range-to')?.value).toBe('');

    await typeDay(dayField('campaigns-range-to')!, '2026-10-19');
    expect(nav.replace).toHaveBeenLastCalledWith(
      '/campaigns?range=custom&from=2026-10-01&to=2026-10-19',
      { scroll: false },
    );
  });

  it('a preset drops the days from the address', async () => {
    await show('?range=custom&from=2026-10-01&to=2026-10-19');
    await act(async () => button('Last 7 days').click());
    expect(nav.replace).toHaveBeenLastCalledWith('/campaigns?range=7d', { scroll: false });
  });
});
