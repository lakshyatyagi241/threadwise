// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { SessionResponse, TaskResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../api/service', () => ({ tasksApi: { create: api.create } }));
vi.mock('../api/hooks', async (orig) => ({
  ...(await orig<typeof import('../api/hooks')>()),
  useMembers: () => ({
    data: [
      { id: '11111111-1111-4111-8111-111111111111', fullName: 'Asha Rao' },
      { id: '22222222-2222-4222-8222-222222222222', fullName: 'Vikram Shah' },
    ],
  }),
}));

import { KEYS } from '../api/hooks';
import { InlineTaskAdd } from './inline-task-add';

const ME = '11111111-1111-4111-8111-111111111111';
const CONTACT = '294dca7c-5806-4548-9035-dcca9befc7b1';
const source = { kind: 'contact', id: CONTACT } as const;
const session = {
  user: { id: ME, email: 'asha@x.test', fullName: 'Asha Rao', displayName: null },
  org: { timezone: 'UTC' },
  permissions: { 'record.tasks.create': 'all' },
} as unknown as SessionResponse;

let host: HTMLElement;
let root: Root;
let qc: QueryClient;
const openKey = [...KEYS.list, source, { status: 'open' }];

const saved = (over: Partial<TaskResponse> = {}): TaskResponse =>
  ({
    id: '5b0d0f6e-0000-4000-8000-0000000000aa',
    title: 'Send the quote',
    notes: null,
    priority: 'medium',
    status: 'open',
    dueAt: '2026-10-17T17:00:00.000Z',
    doneAt: null,
    remindedAt: null,
    bucket: 'upcoming',
    overdue: false,
    assignee: { id: ME, name: 'Asha Rao' },
    createdBy: { id: ME, name: 'Asha Rao' },
    contact: { id: CONTACT, name: 'Aarav' },
    deal: null,
    company: null,
    source: 'manual',
    rowVersion: 1,
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    ...over,
  }) as TaskResponse;

const openTitles = () =>
  (
    qc.getQueryData(openKey) as { pages: Array<{ tasks: TaskResponse[] }> } | undefined
  )?.pages[0]?.tasks.map((t) => t.title) ?? [];

function mount(ui: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <SessionProvider session={session}>
            <ToastProvider dismissLabel="Dismiss">{ui}</ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const byText = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === text)!;
const form = () => host.querySelector<HTMLFormElement>('form')!;
const titleInput = () =>
  host.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!;
const submit = async () => {
  await act(async () => {
    form().requestSubmit();
  });
};

beforeEach(() => {
  api.create.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(openKey, {
    pages: [
      {
        tasks: [saved({ id: 'existing', title: 'Already there' })],
        nextCursor: null,
        hasMore: false,
      },
    ],
    pageParams: [undefined],
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the inline task row', () => {
  it('is a quiet row until asked for, then opens in place with the cursor in the title (no dialog)', () => {
    mount(<InlineTaskAdd source={source} label="Aarav" />);
    expect(form()).toBeNull();
    expect(host.textContent).toContain('Add task');
    act(() => byText('Add task').click());
    expect(form()).not.toBeNull();
    expect(host.querySelector('dialog, [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(titleInput());
    // due date prefilled, assignee is me, priority is medium
    expect(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value).not.toBe(
      '',
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Assign to"]')!.value).toBe(ME);
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Priority (optional)"]')!.value,
    ).toBe('medium');
  });

  it("opens and focuses when something outside asks (the action bar's Task button)", () => {
    mount(<InlineTaskAdd source={source} label="Aarav" focusSignal={0} />);
    expect(form()).toBeNull();
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
          <QueryClientProvider client={qc}>
            <SessionProvider session={session}>
              <ToastProvider dismissLabel="Dismiss">
                <InlineTaskAdd source={source} label="Aarav" focusSignal={7} />
              </ToastProvider>
            </SessionProvider>
          </QueryClientProvider>
        </NextIntlClientProvider>,
      );
    });
    expect(form()).not.toBeNull();
  });

  it('saves on Enter: the task shows in the list at once, the title clears and the row stays for the next one', async () => {
    let resolve!: (t: TaskResponse) => void;
    api.create.mockReturnValue(new Promise<TaskResponse>((r) => (resolve = r)));
    mount(<InlineTaskAdd source={source} label="Aarav" />);
    act(() => byText('Add task').click());
    type(titleInput(), 'Send the quote');
    await submit();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0]![0]).toMatchObject({
      title: 'Send the quote',
      priority: 'medium',
      assigneeId: ME,
      contactId: CONTACT,
    });
    expect(typeof api.create.mock.calls[0]![0].dueAt).toBe('string');
    // before the server has answered the task is already in the list
    expect(openTitles()).toEqual(['Send the quote', 'Already there']);
    expect(titleInput().value).toBe('');
    await act(async () => resolve(saved()));
    expect(form()).not.toBeNull();
    expect(openTitles()).toContain('Send the quote');
  });

  it('puts the list and the typed title back, with the reason, when the server refuses', async () => {
    api.create.mockRejectedValue(new Error('boom'));
    mount(<InlineTaskAdd source={source} label="Aarav" />);
    act(() => byText('Add task').click());
    type(titleInput(), 'Send the quote');
    await submit();
    await act(async () => undefined);
    expect(openTitles()).toEqual(['Already there']);
    expect(titleInput().value).toBe('Send the quote');
    expect(host.textContent).toContain(
      'The task could not be saved. Your text is back in the box.',
    );
  });

  it('asks for a due date instead of saving without one', async () => {
    mount(<InlineTaskAdd source={source} label="Aarav" />);
    act(() => byText('Add task').click());
    type(titleInput(), 'No date');
    type(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, '');
    await submit();
    expect(api.create).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Choose a due date and time.');
  });

  it('does not submit an empty title', async () => {
    mount(<InlineTaskAdd source={source} label="Aarav" />);
    act(() => byText('Add task').click());
    expect(byText('Add task') as HTMLButtonElement).toHaveProperty('disabled', true);
    await submit();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('closes on Escape without letting the key reach what is around it (a drawer)', () => {
    const outer = vi.fn();
    mount(
      <div onKeyDown={outer}>
        <InlineTaskAdd source={source} label="Aarav" />
      </div>,
    );
    act(() => byText('Add task').click());
    act(() => {
      titleInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(form()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });
});
