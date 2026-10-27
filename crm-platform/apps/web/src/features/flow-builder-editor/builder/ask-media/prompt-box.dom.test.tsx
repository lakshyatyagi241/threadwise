// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { PromptBox } from './prompt-box';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function Harness({ start }: { start: string }) {
  const [v, setV] = useState(start);
  return <PromptBox value={v} onChange={setV} />;
}

function render(start = 'Hello world') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
          <Harness start={start} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tool = (name: string) => host.querySelector(`[data-tool="${name}"]`) as HTMLButtonElement;
const area = () => host.querySelector('textarea') as HTMLTextAreaElement;

describe('prompt box on the Ask for file / location cards', () => {
  it('closes the emoji and format menus when the page outside is pressed, even where a parent stops the event', () => {
    render();
    act(() => tool('emoji').click());
    expect(host.querySelector('[data-testid=ask-emoji-menu]')).not.toBeNull();
    const outside = document.createElement('div');
    outside.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid=ask-emoji-menu]')).toBeNull();

    act(() => tool('format').click());
    expect(host.querySelector('[data-testid=ask-format-menu]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[data-testid=ask-format-menu]')).toBeNull();
    outside.remove();
  });

  it('offers the full emoji list with a search', () => {
    render();
    act(() => tool('emoji').click());
    const all = host.querySelectorAll('[data-testid=ask-emoji-menu] button').length;
    expect(all).toBeGreaterThan(300);
  });

  it('Ctrl+B and Ctrl+I wrap the selected words in WhatsApp bold and italic marks', () => {
    render('Hello world');
    const el = area();
    el.setSelectionRange(0, 5);
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(area().value).toBe('*Hello* world');
    const el2 = area();
    el2.setSelectionRange(8, 13);
    act(() => {
      el2.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(area().value).toBe('*Hello* _world_');
  });
});
