// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedReply } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no <dialog> methods
HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const state = vi.hoisted(() => ({
  can: true,
  rows: [] as unknown[],
  limit: null as number | null,
  total: 0,
  status: 'ok' as 'ok' | 'pending' | 'error',
  created: [] as unknown[],
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/saved-replies', () => ({
  refreshSavedReplies: () => Promise.resolve(),
  useSavedReplyList: () => ({
    isPending: state.status === 'pending',
    isError: state.status === 'error',
    refetch: () => undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
    data: {
      pages: [
        {
          data: state.rows,
          counts: { all: state.rows.length, shared: state.rows.length, mine: 0 },
          categories: ['Billing'],
          total: state.total,
          limit: state.limit,
          page: { nextCursor: null, hasMore: false, limit: 50 },
        },
      ],
    },
  }),
  savedRepliesApi: {
    create: async (input: unknown) => {
      state.created.push(input);
      return { ...(input as object), id: 'new', shortcut: 'thanks' };
    },
  },
}));

import { SavedRepliesScreen } from './saved-replies-screen';

const reply = (over: Partial<SavedReply> = {}): SavedReply => ({
  id: 'r1',
  shortcut: 'thanks',
  title: 'Thank you',
  body: 'Thanks, {{first_name}}!',
  category: 'Billing',
  language: 'en',
  channelKinds: ['email'],
  scope: 'shared',
  usedCount: 3,
  lastUsedAt: '2026-10-01T10:00:00.000Z',
  createdByName: 'Sam',
  canEdit: true,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const read = (lang: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', lang, 'team-inbox-conversations.json'), 'utf8'),
  ) as Record<string, unknown>;

let host: HTMLElement;
let root: Root;
async function mount(lang = 'en') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale={lang} messages={read(lang)} timeZone="UTC">
          <ToastProvider dismissLabel="x">
            <SavedRepliesScreen />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.assign(state, {
    can: true,
    rows: [reply()],
    limit: null,
    total: 1,
    status: 'ok',
    created: [],
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const text = () => host.textContent ?? '';

describe('SavedRepliesScreen', () => {
  it('lists replies with shortcut, scope, channels, usage and the row actions', async () => {
    await mount();
    expect(text()).toContain('/thanks');
    expect(text()).toContain('Thank you');
    expect(text()).toContain('Shared');
    expect(text()).toContain('Email');
    expect(text()).toContain('Used 3 times');
    expect(text()).toContain('Created by Sam');
    expect(host.querySelector('[data-testid="saved-reply-meter"]')).toBeNull();
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Edit', 'Duplicate', 'Delete']),
    );
  });

  it('hides the actions of a reply the caller cannot change', async () => {
    state.rows = [reply({ canEdit: false })];
    await mount();
    expect(text()).toContain('Only people who manage saved replies');
    expect(
      host.querySelector('[data-testid="saved-reply-row"]')!.querySelectorAll('button'),
    ).toHaveLength(0);
  });

  it('shows the plan meter, warns near the limit and blocks creating at it with an upgrade link', async () => {
    state.limit = 10;
    state.total = 8;
    await mount();
    expect(text()).toContain('8 of 10 saved replies used');
    expect(text()).toContain('close to your plan');
    expect(host.querySelector('a[href="/account/plans"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-new"]')!.disabled).toBe(
      false,
    );
    await act(async () => root.unmount());
    root = createRoot(host);
    state.total = 10;
    await mount();
    expect(text()).toContain('reached your plan');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-new"]')!.disabled).toBe(
      true,
    );
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('10');
  });

  it('has an empty state, a loading state, an error state and a no-access state', async () => {
    state.rows = [];
    state.total = 0;
    await mount();
    expect(text()).toContain('No saved replies yet');
    await act(async () => root.unmount());
    root = createRoot(host);
    state.status = 'pending';
    await mount();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    state.status = 'error';
    await mount();
    expect(text()).toContain('could not be loaded');
    await act(async () => root.unmount());
    root = createRoot(host);
    state.can = false;
    await mount();
    expect(text()).toContain('do not have permission');
  });

  it('the form previews with sample data, adds a variable chip at the caret and validates before saving', async () => {
    await mount();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-new"]')!.click(),
    );
    const save = host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-save"]')!;
    await act(async () => save.click());
    expect(text()).toContain('Enter a shortcut');
    expect(text()).toContain('Enter a title');
    expect(state.created).toEqual([]);

    const set = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [
      ...host.querySelectorAll<HTMLInputElement>(
        'dialog input[type="text"], dialog input:not([type])',
      ),
    ];
    await act(async () => set(inputs[0]!, 'Thank You'));
    expect(text()).toContain('Agents type /thank_you');
    await act(async () => set(inputs[1]!, 'Thanks'));
    const area = host.querySelector<HTMLTextAreaElement>('dialog textarea')!;
    await act(async () => set(area, 'Hi !'));
    area.setSelectionRange(3, 3);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-var-first_name"]')!.click(),
    );
    expect(area.value).toBe('Hi {{first_name}}!');
    expect(host.querySelector('[data-testid="saved-reply-preview"]')?.textContent).toContain(
      'Hi Amira!',
    );
    await act(async () => set(area, 'Hi {{first_name}} {{city}}'));
    expect(host.querySelector('[data-testid="saved-reply-preview-issues"]')?.textContent).toContain(
      '{{city}}',
    );
    await act(async () => save.click());
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      shortcut: 'thank_you',
      title: 'Thanks',
      scope: 'shared',
    });
  });

  it('renders in Arabic, right to left friendly', async () => {
    await mount('ar');
    expect(text()).toContain('الردود المحفوظة');
    expect(text()).toContain('مشترك');
  });
});
