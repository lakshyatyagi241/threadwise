// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ add: vi.fn(async (_id: string, _body: unknown) => ({})) }));
vi.mock('../api/training', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/training')>()),
  addSource: (id: string, body: unknown) => state.add(id, body),
}));

import { AddPanel } from './knowledge-step';
import { PlanPaywall } from './plan-paywall';

const messages = loadMessages('en');

let host: HTMLDivElement | undefined;
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!;
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the upgrade sheet of AI Training', () => {
  it('takes keyboard focus when it opens and keeps Tab on its own control', async () => {
    await mount(<PlanPaywall />);
    const link = document.querySelector('[role="dialog"] a') as HTMLAnchorElement;
    expect(document.activeElement).toBe(link);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      document.querySelector('[role="dialog"]')!.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link);
  });
});

describe('adding several FAQs when one of them fails', () => {
  it('leaves only the rows that are not saved, so Add again does not save a row twice', async () => {
    state.add.mockReset();
    state.add
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({});
    const done = vi.fn();
    await mount(<AddPanel kind="faq" assistantId="a1" onDone={done} onCancel={() => undefined} />);
    const addRow = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add another question',
    )!;
    await act(async () => addRow.click());
    await act(async () => addRow.click());
    for (let i = 0; i < 3; i++) {
      await type(
        document.getElementById(`aiag-src-question-${i}`) as HTMLInputElement,
        `Q${i + 1}`,
      );
      await type(
        document.getElementById(`aiag-src-answer-${i}`) as HTMLTextAreaElement,
        `A${i + 1}`,
      );
    }
    const form = document.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(state.add).toHaveBeenCalledTimes(3);
    expect(done).not.toHaveBeenCalled();
    // only the third is left in the form
    expect((document.getElementById('aiag-src-question-0') as HTMLInputElement).value).toBe('Q3');
    expect(document.getElementById('aiag-src-question-1')).toBeNull();

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(state.add).toHaveBeenCalledTimes(4);
    const labels = state.add.mock.calls.map((c) => (c[1] as { question: string }).question);
    expect(labels).toEqual(['Q1', 'Q2', 'Q3', 'Q3']);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
