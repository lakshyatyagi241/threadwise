// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: api.apiFetch }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
  useSession: () => ({ org: { name: 'Acme' } }),
}));

import { GroupsPanel } from './groups-panel';

const ASHA = { id: '0f4f5c1e-7a1b-4c52-9d1e-2b8f1c3a4d01', name: 'Asha Rao' };
const RAVI = { id: '5b7e2a90-3c4d-4e8f-8a6b-9c0d1e2f3a02', name: 'Ravi Nair' };

const GROUPS = [
  {
    id: '6f1c2c9e-0c1a-4a57-9a55-3d1f7e8a9b10',
    name: 'VIP',
    note: 'Top accounts',
    color: '#7C3AED',
    memberCount: 3,
    rowVersion: 2,
    createdBy: ASHA,
    updatedBy: RAVI,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-02T10:30:00.000Z',
  },
  {
    id: 'a3d9e1f2-4b5c-4d6e-8f70-123456789abc',
    name: 'New signups',
    note: null,
    color: null,
    memberCount: 12,
    rowVersion: 1,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-10-03T08:15:00.000Z',
    updatedAt: '2026-10-03T08:15:00.000Z',
  },
];

/** The list endpoint: a `q` narrows it by name on the server, as the API does. */
function serve(query: Record<string, unknown> | undefined) {
  const q = typeof query?.q === 'string' ? query.q.toLowerCase() : '';
  const data = q ? GROUPS.filter((g) => g.name.toLowerCase().includes(q)) : GROUPS;
  return { data, page: { hasMore: false, nextCursor: null, limit: 200 } };
}

const messages = loadMessages('en') as unknown as Parameters<
  typeof NextIntlClientProvider
>[0]['messages'];

let host: HTMLElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(
    async (_path: string, opts?: { query?: Record<string, unknown> }) => serve(opts?.query),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Waits for the query to answer and React to paint it: the fetch starts in an effect, so it resolves after the act that typed. */
async function waitFor(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for the list');
    await settle(20);
  }
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ToastProvider dismissLabel="Dismiss">
            <GroupsPanel onEdit={() => undefined} />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle(0);
}

const rows = () => [...host!.querySelectorAll('tbody tr')];
const cellsOf = (tr: Element) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
const rowNames = () => rows().map((tr) => cellsOf(tr)[0]?.split('\n')[0]?.trim());

/** Types into a controlled React input the way a person does: the value setter, then an input event. */
function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setValue.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('GroupsPanel: the groups table', () => {
  it('lists name, members, who created and last changed each group, with their dates', async () => {
    await mount();

    const headers = [...host!.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    expect(headers.slice(0, 6)).toEqual([
      'Name',
      'Members',
      'Created by',
      'Created at',
      'Modified by',
      'Updated at',
    ]);

    const [vip, signups] = rows().map(cellsOf);
    expect(vip![0]).toContain('VIP');
    expect(vip![0]).toContain('Top accounts');
    expect(vip![1]).toBe('3');
    expect(vip![2]).toBe('Asha Rao');
    expect(vip![3]).toContain('Oct 1, 2026');
    expect(vip![4]).toBe('Ravi Nair');
    expect(vip![5]).toContain('Oct 2, 2026');

    // A group nobody has changed shows a dash, not an empty cell or a stale name.
    expect(signups![1]).toBe('12');
    expect(signups![2]).toBe('-');
    expect(signups![4]).toBe('-');
  });

  it('narrows the list on the server by name once typing pauses, and says so when nothing matches', async () => {
    await mount();
    const search = host!.querySelector('input[type="search"]') as HTMLInputElement;

    await act(async () => type(search, 'new'));
    await waitFor(() => rowNames().length === 1 && rowNames()[0] === 'New signups');

    const asked = api.apiFetch.mock.calls.map(([, opts]) => opts?.query?.q);
    expect(asked).toContain('new');
    expect(rowNames()).toEqual(['New signups']);

    await act(async () => type(search, 'zzz'));
    await waitFor(() => host!.textContent!.includes('No group name contains what you typed.'));

    expect(rows()).toHaveLength(0);
    // The box keeps what was typed, so a person can correct it without retyping.
    expect((host!.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('zzz');
  });

  it('opens the group from its name, the same contacts view as View contacts', async () => {
    await mount();

    const nameLink = [...host!.querySelectorAll('tbody a')].find((a) => a.textContent === 'VIP');
    expect(nameLink?.getAttribute('href')).toBe(`/contacts?group=${GROUPS[0]!.id}`);
  });
});
