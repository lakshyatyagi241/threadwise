// @vitest-environment jsdom
import { ApiError } from '@/lib/api/errors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { member, summary } from '../lib/fixtures';
import { readMessages } from '../lib/test-support';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  summaryQ: {} as Record<string, unknown>,
  membersQ: {} as Record<string, unknown>,
  teamsQ: {} as Record<string, unknown>,
  invite: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
  useSession: () => ({ org: { name: 'Acme', timezone: 'UTC' } }),
}));
vi.mock('../api/hooks', () => ({
  KEYS: {},
  useMembersSummary: () => state.summaryQ,
  useMembers: () => state.membersQ,
  useAllMembers: () => ({ items: [] }),
  useAllTeams: () => state.teamsQ,
  useRefreshWorkspace: () => vi.fn(),
}));
vi.mock('../api/leave', () => ({ useLeaves: () => ({ data: undefined }) }));
vi.mock('../api/service', () => ({ wspApi: { invite: (i: unknown) => state.invite(i) } }));

import { InviteDialog } from './invite-dialog';
import { MembersScreen } from './members-screen';
import { TeamsScreen } from './teams-screen';

const messages = readMessages('en');
const t = (messages['workspaces-teams-tenancy'] ?? {}) as unknown as Record<string, never>;
const msg = (path: string): string => {
  let cur: unknown = t;
  for (const p of path.split('.')) cur = (cur as Record<string, unknown>)[p];
  if (typeof cur !== 'string') throw new Error(`No message ${path}`);
  return cur;
};

const down = () => new ApiError(500, 'INTERNAL', 'boom', 'req-1');
const ready = (data: unknown) => ({
  isPending: false,
  isError: false,
  error: null,
  data,
  refetch: vi.fn(),
});
const membersPage = (rows: ReturnType<typeof member>[]) => ({
  ...ready({ pages: [{ data: rows }] }),
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
});
const teamsList = (over: Record<string, unknown> = {}) => ({
  items: [],
  isPending: false,
  isError: false,
  error: null,
  hasNextPage: false,
  refetch: vi.fn(),
  ...over,
});

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
async function mount(el: ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>{el}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return host;
}
const buttonByText = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
const click = (el: Element) =>
  act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  state.summaryQ = ready(summary('owner'));
  state.membersQ = membersPage([member(2, 'agent')]);
  state.teamsQ = teamsList();
  state.invite.mockReset();
  // jsdom has no native <dialog> behaviour.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('members screen states', () => {
  it('shows an error state with a retry when the members fail to load', async () => {
    const refetch = vi.fn();
    state.membersQ = { ...membersPage([]), isError: true, error: down(), data: undefined, refetch };
    await mount(<MembersScreen />);
    expect(host.textContent).toContain(msg('errors.unexpected'));
    expect(host.textContent).not.toContain(msg('members.emptyNone'));
    await click(buttonByText(msg('common.retry')));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with the invite action when there are no members yet', async () => {
    state.membersQ = membersPage([]);
    await mount(<MembersScreen />);
    expect(host.textContent).toContain(msg('members.emptyNone'));
    expect(buttonByText(msg('members.emptyInvite'))).toBeTruthy();
    expect(host.textContent).not.toContain(msg('members.emptyFiltered'));
  });

  it('shows no results, not the first-use message, when the filters match nothing', async () => {
    state.membersQ = membersPage([]);
    await mount(<MembersScreen />);
    await click(host.querySelector('[data-testid="role-filter-agent"]')!);
    expect(host.textContent).toContain(msg('members.emptyFiltered'));
    expect(host.textContent).not.toContain(msg('members.emptyNone'));
  });

  it('shows skeleton rows while loading, not the empty state', async () => {
    state.summaryQ = { ...ready(undefined), isPending: true };
    state.membersQ = { ...membersPage([]), isPending: true, data: undefined };
    await mount(<MembersScreen />);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).not.toContain(msg('members.emptyNone'));
    expect(host.textContent).not.toContain(msg('members.emptyFiltered'));
  });
});

describe('teams screen states', () => {
  it('shows an error state with a retry when the teams fail to load', async () => {
    const refetch = vi.fn();
    state.teamsQ = teamsList({ isError: true, error: down(), refetch });
    await mount(<TeamsScreen />);
    expect(host.textContent).toContain(msg('errors.unexpected'));
    expect(host.textContent).not.toContain(msg('teams.emptyTitle'));
    await click(buttonByText(msg('common.retry')));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with the create-team action when there are no teams yet', async () => {
    await mount(<TeamsScreen />);
    expect(host.textContent).toContain(msg('teams.emptyTitle'));
    expect(host.textContent).toContain(msg('teams.emptyMessage'));
    expect(buttonByText(msg('teams.emptyAction'))).toBeTruthy();
  });

  it('shows a skeleton while loading, not the empty state', async () => {
    state.teamsQ = teamsList({ isPending: true });
    await mount(<TeamsScreen />);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).not.toContain(msg('teams.emptyTitle'));
  });
});

describe('invite dialog states', () => {
  it('keeps the typed values and shows the error when the invite send fails', async () => {
    state.invite.mockRejectedValue(down());
    await mount(
      <InviteDialog open roles={summary('owner').roles} onClose={vi.fn()} onInvited={vi.fn()} />,
    );
    await typeInto(
      host.querySelector<HTMLInputElement>('input[name="fullName"], input[type="text"]')!,
      'Riya Shah',
    );
    await typeInto(
      host.querySelector<HTMLInputElement>('input[type="email"]')!,
      'riya@company.com',
    );
    await click(buttonByText(msg('invite.submit')));
    await settle();
    expect(state.invite).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(msg('errors.unexpected'));
    expect(host.querySelector<HTMLInputElement>('input[type="email"]')!.value).toBe(
      'riya@company.com',
    );
    expect(buttonByText(msg('invite.submit')).disabled).toBe(false);
  });
});
