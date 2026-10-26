// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { makeSession } from '@/features/auth-registration-security/account/render-test-utils';
import { KEYS } from '../api';
import { AdjustDialog } from './admin/adjust-dialog';
import { LogsPage } from './admin/logs-page';
import { StatementPage } from './customer/statement-page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({ logs: vi.fn(), adjust: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    operatorApi: { ...actual.operatorApi, logs: apiMocks.logs, adjust: apiMocks.adjust },
  };
});

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(search),
}));

const messages = loadMessages('en');
const WS = '11111111-1111-4111-8111-111111111111';

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  search = '';
  // jsdom has no <dialog> methods; the Modal calls them from an effect.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  apiMocks.logs.mockReset();
  apiMocks.adjust.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type Seed = { key: readonly unknown[]; data?: unknown; error?: Error };

/** Mounts a screen with the real English messages; a seed is either loaded data or a failed read. */
function mount(el: ReactElement, seeds: Seed[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  for (const s of seeds) {
    if (s.error) {
      client
        .getQueryCache()
        .build(client, { queryKey: [...s.key] })
        .setState({ status: 'error', error: s.error, fetchStatus: 'idle', errorUpdateCount: 1 });
    } else client.setQueryData([...s.key], s.data);
  }
  const session = makeSession({
    permissions: { 'wallet.statement.read': 'all', 'wallet.statement.export': 'all' },
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <SessionProvider session={session}>{el}</SessionProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
}

const text = () => host.textContent ?? '';
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

function type(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: Element | undefined) => act(() => (el as HTMLElement).click());
const flush = () => act(async () => void (await Promise.resolve()));

describe('wallet logs page states', () => {
  const appliedEmpty = {
    scope: 'all',
    event: '',
    severity: '',
    workspaceId: '',
    q: '',
    from: '',
    to: '',
  };

  it('shows an error state with a retry when the log list fails to load', async () => {
    apiMocks.logs.mockResolvedValue({ data: [], page: { hasMore: false, nextCursor: null } });
    mount(<LogsPage />, [
      { key: [...KEYS.logs, appliedEmpty], error: new ApiError(500, 'INTERNAL', 'boom') },
    ]);
    expect(text()).toContain('Something went wrong. Try again.');
    expect(text()).not.toContain('boom');
    expect(text()).not.toContain('No log entries');
    const retry = button('Try again');
    expect(retry).toBeDefined();
    click(retry);
    await flush();
    expect(apiMocks.logs).toHaveBeenCalledTimes(1);
  });

  it('says the server could not be reached when the log request fails without a response', () => {
    mount(<LogsPage />, [{ key: [...KEYS.logs, appliedEmpty], error: new TypeError('offline') }]);
    expect(text()).toContain('The server could not be reached. Check your connection');
    expect(button('Try again')).toBeDefined();
  });
});

describe('wallet statement states', () => {
  const emptyStatement = {
    currency: 'USD',
    summary: {
      currentBalanceMinor: 0,
      moneyInMinor: 0,
      moneyOutMinor: 0,
      netMinor: 0,
      count: 0,
    },
    data: [],
    page: { hasMore: false, nextCursor: null },
  };
  const filters = (q: string) => ({ type: 'all', from: '', to: '', q });

  it('shows no results with a way to clear the filters when the filters match nothing', () => {
    search = '?q=zzz';
    mount(<StatementPage />, [
      { key: KEYS.statement(filters('zzz') as never, undefined), data: emptyStatement },
    ]);
    expect(text()).toContain('Nothing matches these filters. Change or reset them.');
    expect(text()).not.toContain('Movements on your wallet will be listed here.');
    expect(button('Reset')).toBeDefined();
  });

  it('shows the empty state, not the filtered message, when there are no transactions yet', () => {
    mount(<StatementPage />, [
      { key: KEYS.statement(filters('') as never, undefined), data: emptyStatement },
    ]);
    expect(text()).toContain('Movements on your wallet will be listed here.');
    expect(text()).not.toContain('Nothing matches these filters');
  });

  it('shows an error state with a retry when the statement fails to load', () => {
    mount(<StatementPage />, [
      {
        key: KEYS.statement(filters('') as never, undefined),
        error: new ApiError(503, 'UNAVAILABLE', 'down'),
      },
    ]);
    expect(text()).toContain('Something went wrong. Try again.');
    expect(text()).not.toContain('Movements on your wallet');
    expect(button('Try again')).toBeDefined();
  });
});

describe('adjust dialog', () => {
  it('keeps the typed values and shows the error when save fails, and the button works again', async () => {
    apiMocks.adjust.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const onDone = vi.fn();
    mount(
      <AdjustDialog
        workspaceId={WS}
        workspaceName="Acme"
        currency="USD"
        balanceMinor={10_000}
        onClose={() => undefined}
        onDone={onDone}
      />,
    );
    type('#adj-amount', '25.00');
    type('#adj-note', 'Goodwill credit after outage');
    click(button('Review'));
    click(button('Add money'));
    await flush();
    await flush();

    expect(apiMocks.adjust).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(text()).toContain('Something went wrong. Try again.');
    // back on the form, with what the person typed still there
    expect((host.querySelector('#adj-amount') as HTMLInputElement).value).toBe('25.00');
    expect((host.querySelector('#adj-note') as HTMLTextAreaElement).value).toBe(
      'Goodwill credit after outage',
    );
    expect((button('Review') as HTMLButtonElement).disabled).toBe(false);
  });

  it('names the stale row when the save fails with a version conflict', async () => {
    apiMocks.adjust.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    mount(
      <AdjustDialog
        workspaceId={WS}
        workspaceName="Acme"
        currency="USD"
        balanceMinor={10_000}
        onClose={() => undefined}
        onDone={() => undefined}
      />,
    );
    type('#adj-amount', '5');
    type('#adj-note', 'Correction for invoice 12');
    click(button('Review'));
    click(button('Add money'));
    await flush();
    await flush();
    expect(text()).toContain('Someone else changed this. Reload and try again.');
  });
});
