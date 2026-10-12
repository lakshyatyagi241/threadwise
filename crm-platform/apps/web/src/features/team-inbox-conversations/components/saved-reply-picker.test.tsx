// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedReply } from '@crm/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  can: true,
  used: [] as string[],
  filled: {} as Record<string, { text: string; issues: unknown[] }>,
  fail: null as Error | null,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Composer } from './composer';

const rep = (
  shortcut: string,
  title: string,
  body: string,
  over: Partial<SavedReply> = {},
): SavedReply => ({
  id: `id-${shortcut}`,
  shortcut,
  title,
  body,
  category: null,
  language: null,
  channelKinds: [],
  scope: 'shared',
  usedCount: 0,
  lastUsedAt: null,
  createdByName: null,
  canEdit: true,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const LIST = [
  rep('thanks', 'Thank you', 'Thanks, {{first_name}}!', { usedCount: 3 }),
  rep('hello', 'Greeting', 'Hello there'),
  rep('refund', 'Refunds', 'We refund within 5 days'),
];

vi.mock('../api/saved-replies', () => ({
  usePickerReplies: (_kind: string | undefined, q: string) => ({
    isPending: false,
    isError: false,
    refetch: () => undefined,
    data: {
      data: LIST.filter(
        (r) => !q || `${r.shortcut} ${r.title} ${r.body}`.toLowerCase().includes(q.toLowerCase()),
      ),
      counts: { all: LIST.length, shared: LIST.length, mine: 0 },
    },
  }),
  refreshSavedReplies: () => Promise.resolve(),
  savedRepliesApi: {
    use: async (id: string) => {
      if (state.fail) throw state.fail;
      state.used.push(id);
      return {
        id,
        usedCount: 1,
        ...(state.filled[id] ?? { text: LIST.find((r) => r.id === id)!.body, issues: [] }),
      };
    },
  },
}));

const read = (lang: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', lang, 'team-inbox-conversations.json'), 'utf8'),
  ) as Record<string, unknown>;

let host: HTMLElement;
let root: Root;
const sent: string[] = [];

async function mount(
  lang = 'en',
  max?: { savedReplies?: { channelKind?: string } | undefined; email?: boolean },
) {
  const qc = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale={lang} messages={read(lang)} timeZone="UTC">
          <Composer
            conversationId={`c-${Math.random()}`}
            mode="reply"
            onMode={() => undefined}
            replyDisabled={false}
            canReply
            canNote
            canAttach={false}
            savedReplies={
              max && 'savedReplies' in max ? max.savedReplies : { channelKind: 'whatsapp_cloud' }
            }
            onSend={(d) => sent.push(d.body)}
            onNote={async () => true}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

const box = () => host.querySelector<HTMLTextAreaElement>('[data-testid="inbox-composer"]')!;
const options = () => [...host.querySelectorAll<HTMLElement>('[data-testid="saved-reply-option"]')];

async function type(value: string) {
  const el = box();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(k: string) {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.can = true;
  state.used = [];
  state.filled = {};
  state.fail = null;
  sent.length = 0;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('composer saved-reply picker', () => {
  it('has the button only when the agent may reply, and no list until asked', async () => {
    await mount();
    expect(host.querySelector('[data-testid="inbox-saved-replies-button"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="saved-reply-picker"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount('en', { savedReplies: undefined });
    expect(host.querySelector('[data-testid="inbox-saved-replies-button"]')).toBeNull();
  });

  it('typing / opens an accessible listbox filtered as you type', async () => {
    await mount();
    await type('/');
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    expect(options()).toHaveLength(3);
    expect(box().getAttribute('role')).toBe('combobox');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    await type('/ref');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('/refund')]);
  });

  it('arrow keys move the highlight and wrap; Enter inserts the filled text without sending', async () => {
    state.filled['id-hello'] = { text: 'Hello there', issues: [] };
    await mount();
    await type('/');
    await key('ArrowDown');
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    await key('ArrowUp');
    await key('ArrowUp');
    expect(options()[2]!.getAttribute('aria-selected')).toBe('true');
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter');
    await flush();
    expect(state.used).toEqual(['id-hello']);
    expect(box().value).toBe('Hello there');
    expect(sent).toEqual([]);
    expect(host.querySelector('[data-testid="saved-reply-picker"]')).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it('inserts in place of the /query after other text, and Tab also picks', async () => {
    state.filled['id-thanks'] = { text: 'Thanks, Amira!', issues: [] };
    await mount();
    await type('Hi /tha');
    await key('Tab');
    await flush();
    expect(box().value).toBe('Hi Thanks, Amira!');
    expect(box().selectionStart).toBe('Hi Thanks, Amira!'.length);
  });

  it('Escape closes and keeps the typed text; Enter with no match is used up and sends nothing', async () => {
    await mount();
    await type('/zzz');
    expect(options()).toHaveLength(0);
    expect(host.querySelector('[data-testid="saved-reply-empty"]')).not.toBeNull();
    await key('Enter');
    expect(sent).toEqual([]);
    await key('Escape');
    expect(host.querySelector('[data-testid="saved-reply-picker"]')).toBeNull();
    expect(box().value).toBe('/zzz');
    await key('Enter');
    expect(sent).toEqual(['/zzz']);
  });

  it('flags a variable that could not be filled and leaves it in the text', async () => {
    state.filled['id-thanks'] = {
      text: 'Thanks, {{first_name}}!',
      issues: [{ token: '{{first_name}}', key: 'first_name', reason: 'empty' }],
    };
    await mount();
    await type('/thanks');
    await key('Enter');
    await flush();
    expect(box().value).toBe('Thanks, {{first_name}}!');
    expect(host.querySelector('[data-testid="inbox-saved-reply-notice"]')?.textContent).toContain(
      '{{first_name}}',
    );
    await type('Thanks, Amira!');
    expect(host.querySelector('[data-testid="inbox-saved-reply-notice"]')).toBeNull();
  });

  it('refuses a reply that would pass the channel limit and leaves the text alone', async () => {
    state.filled['id-hello'] = { text: 'x'.repeat(5000), issues: [] };
    await mount();
    await type('/hello');
    await key('Enter');
    await flush();
    expect(box().value).toBe('/hello');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('too long');
  });

  it('shows the server problem and keeps the list open when the use fails', async () => {
    state.fail = new Error('boom');
    await mount();
    await type('/hello');
    await key('Enter');
    await flush();
    expect(host.querySelector('[data-testid="saved-reply-picker"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(box().value).toBe('/hello');
  });

  it('the button opens a list with its own search box; clicking a row inserts it at the caret', async () => {
    state.filled['id-refund'] = { text: 'We refund within 5 days', issues: [] };
    await mount();
    await type('Re: ');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="inbox-saved-replies-button"]')!.click();
    });
    const search = host.querySelector<HTMLInputElement>('[data-testid="saved-reply-search"]')!;
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'refund',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(options()).toHaveLength(1);
    await act(async () => options()[0]!.click());
    await flush();
    expect(box().value).toBe('Re: We refund within 5 days');
  });

  it('a slash inside a word or a URL does not open it', async () => {
    await mount();
    await type('see https://x.test/a');
    expect(host.querySelector('[data-testid="saved-reply-picker"]')).toBeNull();
  });

  it('works in Arabic with the translated labels', async () => {
    await mount('ar');
    await type('/');
    expect(host.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'الردود المحفوظة',
    );
    expect(host.textContent).toContain('إدارة الردود المحفوظة');
  });
});
