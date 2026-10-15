// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  manage: true,
  overview: null as unknown,
  batches: [] as unknown[],
  calls: [] as Array<[string, unknown]>,
}));

const leaveOf = (over: Record<string, unknown> = {}) => ({
  id: 'l-1',
  memberId: 'm-1',
  memberName: 'Asha',
  startsOn: '2026-10-13',
  endsOn: '2026-10-20',
  reason: 'Surgery',
  status: 'active',
  onLeaveNow: true,
  startedAt: null,
  endedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});

vi.mock('../api/hooks', () => ({
  useAllMembers: () => ({
    isPending: false,
    data: {
      pages: [
        {
          data: [
            { id: 'm-1', fullName: 'Asha', status: 'active' },
            { id: 'm-2', fullName: 'Ravi', status: 'active' },
          ],
        },
      ],
    },
  }),
  useTeams: () => ({
    data: { pages: [{ data: [{ id: 't-1', name: 'Desk' }] }] },
  }),
  useRefreshWorkspace: () => async () => undefined,
}));
vi.mock('../api/leave', async () => {
  const actual = await vi.importActual<typeof import('../api/leave')>('../api/leave');
  return {
    ...actual,
    useLeaveOverview: () => ({
      isPending: false,
      isError: false,
      data: state.overview,
      refetch: vi.fn(),
    }),
    useBatches: () => ({
      isPending: false,
      data: { data: state.batches },
      refetch: async () => undefined,
    }),
    leaveApi: {
      create: async (m: string, b: unknown) => void state.calls.push(['create', { m, b }]),
      update: async () => ({}),
      end: async (id: string) => void state.calls.push(['end', id]),
      setDelegate: async (m: string, d: unknown) => void state.calls.push(['delegate', { m, d }]),
      previewReassign: async () => ({ contacts: 120, openDeals: 4, runMax: 50000 }),
      reassign: async (b: unknown) => {
        state.calls.push(['reassign', b]);
        return { movedContacts: 120, movedDeals: 4 };
      },
      restore: async (id: string) => {
        state.calls.push(['restore', id]);
        return { restoredContacts: 5, restoredDeals: 1, notRestored: 2 };
      },
    },
  };
});

import { MemberLeaveDialog } from './member-leave-dialog';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../messages/${locale}/workspaces-teams-tenancy.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  state.manage = true;
  state.calls = [];
  state.batches = [];
  state.overview = {
    memberId: 'm-1',
    memberName: 'Asha',
    today: '2026-10-13',
    timezone: 'Asia/Kolkata',
    current: leaveOf(),
    upcoming: [
      leaveOf({
        id: 'l-2',
        startsOn: '2026-11-02',
        endsOn: '2026-11-04',
        status: 'scheduled',
        onLeaveNow: false,
        reason: null,
      }),
    ],
    delegate: { id: 'm-2', name: 'Ravi', onLeaveNow: false },
    workload: { ownedContacts: 120, openConversations: 3 },
    can: { manage: true, seeReason: true },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (locale = 'en') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
          <ToastProvider>
            <MemberLeaveDialog memberId="m-1" memberName="Asha" open onClose={() => undefined} />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
};

const setValue = (el: Element, value: string) =>
  act(() => {
    const proto =
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
const buttonByText = (text: string) =>
  [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement;

describe('the leave dialog', () => {
  it('shows the leave now with its range, the reason for a manager, the coming leave and the workspace calendar note', async () => {
    await render();
    const text = host.textContent!;
    expect(text).toContain('Oct 13, 2026 to Oct 20, 2026');
    expect(text).toContain('Reason (only managers see it): Surgery');
    expect(text).toContain('Nov 2, 2026 to Nov 4, 2026');
    expect(text).toContain('Dates are days in your workspace calendar (Asia/Kolkata).');
    expect(text).toContain('Asha owns 120 contacts and 3 open chats.');
  });

  it('refuses a past first day and a last day before the first without calling the server, then saves a valid range', async () => {
    await render();
    const form = host.querySelector('[data-testid="leave-form"]')!;
    const [from, to] = form.querySelectorAll('input[type="date"]');
    setValue(from!, '2026-10-10');
    await act(async () => buttonByText('Save leave').click());
    expect(host.textContent).toContain('The first day cannot be in the past.');
    expect(state.calls).toEqual([]);

    setValue(from!, '2026-12-01');
    setValue(to!, '2026-11-30');
    await act(async () => buttonByText('Save leave').click());
    expect(host.textContent).toContain('The last day cannot be before the first day.');
    expect(state.calls).toEqual([]);

    setValue(to!, '2026-12-05');
    await act(async () => buttonByText('Save leave').click());
    expect(state.calls).toEqual([
      ['create', { m: 'm-1', b: { startsOn: '2026-12-01', endsOn: '2026-12-05', reason: null } }],
    ]);
  });

  it('ends a leave only after a confirmation', async () => {
    await render();
    await act(async () => buttonByText('End leave now').click());
    expect(state.calls).toEqual([]);
    const confirm = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent === 'End leave now')
      .pop()!;
    await act(async () => confirm.click());
    expect(state.calls).toEqual([['end', 'l-1']]);
  });

  it('changes and removes the delegate', async () => {
    await render();
    const select = host.querySelector('select[aria-label="Delegate"]')!;
    setValue(select, '');
    await act(async () => undefined);
    expect(state.calls).toEqual([['delegate', { m: 'm-1', d: null }]]);
  });

  it('reassigns after a preview and a confirmation, asking to bring the work back on the return day only when ticked', async () => {
    await render();
    const section = host.querySelector('[data-testid="reassign-section"]')!;
    const kind = section.querySelector('select')!;
    expect((kind as HTMLSelectElement).value).toBe('delegate');
    const checks = section.querySelectorAll('input[type="checkbox"]');
    const planReturn = checks[1] as HTMLInputElement;
    expect(planReturn.disabled).toBe(false);
    expect(section.textContent).toContain(
      'Bring them back on Oct 21, 2026, when the person returns',
    );
    await act(async () => planReturn.click());
    await act(async () => buttonByText('Review and reassign').click());
    expect(document.body.textContent).toContain('120 contacts and 4 open deals');
    const go = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent === 'Reassign')
      .pop()!;
    await act(async () => go.click());
    expect(state.calls).toEqual([
      [
        'reassign',
        {
          fromUserId: 'm-1',
          target: { kind: 'delegate' },
          includeDeals: true,
          restoreOn: '2026-10-21',
          reason: null,
        },
      ],
    ]);
  });

  it('lists earlier reassignments and undoes one after a confirmation', async () => {
    state.batches = [
      {
        id: 'b-1',
        status: 'applied',
        movedContacts: 10,
        movedDeals: 2,
        restoredContacts: 0,
        restoredDeals: 0,
        notRestored: 0,
        remaining: 0,
        restoreOn: null,
        target: { kind: 'user', userName: 'Ravi', teamName: null },
        canRestore: true,
      },
    ];
    await render();
    expect(host.querySelector('[data-testid="batch-b-1"]')!.textContent).toContain(
      '10 contacts and 2 deals to Ravi',
    );
    await act(async () => buttonByText('Undo').click());
    const yes = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent === 'Undo')
      .pop()!;
    await act(async () => yes.click());
    expect(state.calls).toEqual([['restore', 'b-1']]);
  });

  it('is read-only for someone who may not manage this person', async () => {
    (state.overview as { can: unknown; workload: unknown }).can = {
      manage: false,
      seeReason: false,
    };
    (state.overview as { workload: unknown }).workload = null;
    await render();
    expect(host.querySelector('[data-testid="leave-form"]')).toBeNull();
    expect(host.querySelector('[data-testid="reassign-section"]')).toBeNull();
    expect(host.textContent).toContain('Only the person themselves and managers can change leave.');
    expect(buttonByText('End leave now')).toBeUndefined();
  });

  it('reads in Arabic', async () => {
    await render('ar');
    expect(host.textContent).not.toContain('Leave now');
    expect(/[؀-ۿ]/.test(host.querySelector('h3')!.textContent!)).toBe(true);
  });
});
