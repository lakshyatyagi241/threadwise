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
  created: [] as unknown[],
  updated: [] as unknown[],
  deleted: [] as string[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/service', () => ({
  inboxApi: {
    labels: async () => ({
      data: [
        {
          id: 'l-1',
          name: 'VIP',
          color: '#5B3D8A',
          description: 'Big spenders',
          conversationCount: 3,
          rowVersion: 2,
        },
        {
          id: 'l-2',
          name: 'Refund',
          color: 'red;x',
          description: null,
          conversationCount: 0,
          rowVersion: 1,
        },
      ],
    }),
    createLabel: async (b: unknown) => {
      state.created.push(b);
      return {};
    },
    updateLabel: async (id: string, b: unknown) => {
      state.updated.push({ id, ...(b as object) });
      return {};
    },
    deleteLabel: async (id: string) => {
      state.deleted.push(id);
    },
  },
}));

import { LabelsScreen } from './labels-screen';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../messages/${locale}/team-inbox-conversations.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  // jsdom has no <dialog> modal support: the confirm dialog needs these two.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  state.created = [];
  state.updated = [];
  state.deleted = [];
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
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
          <ToastProvider>
            <LabelsScreen />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

const type = (testId: string, value: string) =>
  act(() => {
    const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('the labels settings screen', () => {
  it('lists every label with its usage, and never lets a bad stored color reach a style', async () => {
    await render();
    const items = [...host.querySelectorAll('[data-testid="labels-list"] li')];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('VIP');
    expect(items[0]!.textContent).toContain('Big spenders');
    expect(items[0]!.textContent).toContain('3 conversations');
    expect(items[1]!.textContent).toContain('0 conversations');
    expect(host.innerHTML).not.toContain('red;x');
  });

  it('creates a label from the form, and refuses an invalid color or an empty name', async () => {
    await render();
    const save = () => host.querySelector('[data-testid="labels-save"]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    type('labels-name', 'Follow up');
    expect(save().disabled).toBe(false);
    type('labels-color', 'red;x');
    expect(save().disabled).toBe(true);
    type('labels-color', '#7B5A14');
    await act(async () => {
      save().click();
    });
    expect(state.created).toEqual([{ name: 'Follow up', color: '#7B5A14' }]);
  });

  it('edits with the version it read, and asks before deleting, naming how many conversations it is on', async () => {
    await render();
    const row = [...host.querySelectorAll('[data-testid="labels-list"] li')][0]!;
    const buttons = row.querySelectorAll('button');
    await act(async () => {
      (buttons[0] as HTMLButtonElement).click();
    });
    expect((host.querySelector('[data-testid="labels-name"]') as HTMLInputElement).value).toBe(
      'VIP',
    );
    type('labels-name', 'VIP customer');
    await act(async () => {
      (host.querySelector('[data-testid="labels-save"]') as HTMLButtonElement).click();
    });
    expect(state.updated).toEqual([
      {
        id: 'l-1',
        rowVersion: 2,
        name: 'VIP customer',
        color: '#5B3D8A',
        description: 'Big spenders',
      },
    ]);

    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('3 conversations');
    expect(state.deleted).toEqual([]);
  });

  it('reads in Arabic', async () => {
    await render('ar');
    expect(host.textContent).not.toContain('Back to the inbox');
    expect(/[؀-ۿ]/.test(host.querySelector('h1')!.textContent!)).toBe(true);
  });
});
