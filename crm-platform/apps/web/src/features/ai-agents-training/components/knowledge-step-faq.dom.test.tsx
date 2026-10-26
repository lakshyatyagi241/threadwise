// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const addSource = vi.hoisted(() => vi.fn());
vi.mock('../api/training', async (orig) => ({
  ...(await orig<typeof import('../api/training')>()),
  addSource,
}));

import { KnowledgeStep } from './knowledge-step';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  addSource.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (text: string): HTMLButtonElement => {
  const found = Array.from(host.querySelectorAll('button')).find((b) =>
    b.textContent?.trim().startsWith(text),
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
};

// React listens to the native input event, so set the value the way a keyboard would.
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const questions = () =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[id^="aiag-src-question-"]')).map(
    (i) => i.value,
  );

describe('FAQ rows leave the form as they are saved (row 311)', () => {
  it('a save that fails part-way keeps only the rows not yet saved, so a retry cannot save one twice', async () => {
    addSource
      .mockResolvedValueOnce({ id: 'k1' })
      .mockRejectedValueOnce(new Error('network dropped'))
      .mockResolvedValue({ id: 'k3' });

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
            <ToastProvider>
              <KnowledgeStep assistantId="a1" canEdit />
            </ToastProvider>
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });

    await act(async () => button('Add FAQ').click());
    const fill = async (index: number, q: string, a: string) => {
      const qi = host.querySelector<HTMLInputElement>(`#aiag-src-question-${index}`)!;
      const ai = host.querySelector<HTMLTextAreaElement>(`#aiag-src-answer-${index}`)!;
      await act(async () => type(qi, q));
      await act(async () => type(ai, a));
    };
    await fill(0, 'Q1', 'A1');
    await act(async () => button('Add another question').click());
    await fill(1, 'Q2', 'A2');
    await act(async () => button('Add another question').click());
    await fill(2, 'Q3', 'A3');

    await act(async () => button('Save FAQ').click());
    await act(async () => {});

    // the first row was saved and left the form; the second failed and stays; the third was never sent
    expect(addSource).toHaveBeenCalledTimes(2);
    expect(questions()).toEqual(['Q2', 'Q3']);

    // a retry saves only what is left
    await act(async () => button('Save FAQ').click());
    await act(async () => {});
    expect(addSource).toHaveBeenCalledTimes(4);
    expect(addSource.mock.calls.slice(2).map((c) => c[1].question)).toEqual(['Q2', 'Q3']);
  });
});
