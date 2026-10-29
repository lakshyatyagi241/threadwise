// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { BulkPickers } from './bulk-bar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG = 'AI · Likely to convert, 88, '.repeat(12).trim();

vi.mock('../api/groups', () => ({
  useGroups: () => ({
    data: [
      { id: 'g1', name: 'VIP' },
      { id: 'g2', name: LONG },
    ],
    isPending: false,
    isError: false,
  }),
}));
vi.mock('../api/tags', () => ({
  sameTagName: () => false,
  TAG_NAME_MAX: 64,
  useTags: () => ({ data: [], isPending: false }),
}));

let root: Root | null = null;
let host: HTMLElement;

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
});

describe('bulk group picker', () => {
  it.each(['groupAdd', 'groupRemove'] as const)(
    'cuts a very long group name in the %s menu and keeps the full name as the title',
    (picker) => {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => {
        root!.render(
          <QueryClientProvider client={new QueryClient()}>
            <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
              <BulkPickers
                picker={picker}
                canCreateTags={false}
                onClose={() => {}}
                onGroup={async () => true}
                onTag={async () => true}
              />
            </NextIntlClientProvider>
          </QueryClientProvider>,
        );
      });
      const options = [...document.body.querySelectorAll<HTMLOptionElement>('select option')];
      expect(options.map((o) => o.value)).toEqual(['g1', 'g2']);
      expect(options[0]!.textContent).toBe('VIP');
      expect(Array.from(options[1]!.textContent ?? '').length).toBeLessThanOrEqual(48);
      expect(options[1]!.textContent!.endsWith('…')).toBe(true);
      expect(options[1]!.title).toBe(LONG);
    },
  );
});
