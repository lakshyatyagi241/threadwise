// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/saved-replies', () => ({
  refreshSavedReplies: () => Promise.resolve(),
  useSavedReplyList: () => ({
    isPending: false,
    isError: false,
    refetch: () => undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
    data: {
      pages: [
        {
          data: [],
          counts: { all: 0, shared: 0, mine: 0 },
          categories: [],
          total: 0,
          limit: null,
          page: { nextCursor: null, hasMore: false, limit: 50 },
        },
      ],
    },
  }),
  savedRepliesApi: { create: api.create },
}));

import { SavedRepliesScreen } from './saved-replies-screen';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.create.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const set = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('saved reply form', () => {
  it('keeps the typed values and shows the error when save fails', async () => {
    api.create.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <ToastProvider dismissLabel="x">
              <SavedRepliesScreen />
            </ToastProvider>
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-new"]')!.click(),
    );
    const inputs = [
      ...host.querySelectorAll<HTMLInputElement>(
        'dialog input[type="text"], dialog input:not([type])',
      ),
    ];
    await act(async () => set(inputs[0]!, 'thanks'));
    await act(async () => set(inputs[1]!, 'Thank you'));
    const area = host.querySelector<HTMLTextAreaElement>('dialog textarea')!;
    await act(async () => set(area, 'Thanks for writing in'));
    const save = host.querySelector<HTMLButtonElement>('[data-testid="saved-reply-save"]')!;
    await act(async () => save.click());

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Something went wrong. Try again.');
    expect(inputs[1]!.value).toBe('Thank you');
    expect(area.value).toBe('Thanks for writing in');
    expect(save.disabled).toBe(false);
  });
});
