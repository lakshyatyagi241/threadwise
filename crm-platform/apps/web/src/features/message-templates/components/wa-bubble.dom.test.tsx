// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { PreviewModel } from '../lib/form-model';
import { MessageBubble } from './wa-bubble';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
});

const model = (over: Partial<PreviewModel>): PreviewModel =>
  ({
    auth: false,
    cards: [],
    offer: null,
    language: 'en_US',
    headerKind: 'none',
    headerText: '',
    headerImageUrl: null,
    body: 'Swipe through our collection',
    footer: '',
    buttons: [],
    expiry: null,
    ...over,
  }) as PreviewModel;

function mount(m: PreviewModel) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <MessageBubble model={m} />
      </NextIntlClientProvider>,
    ),
  );
}

describe('the bubble of the library and the detail page', () => {
  it('shows the cards of a carousel template under the message', () => {
    mount(
      model({
        cards: [
          { format: 'image', imageUrl: 'https://x.test/a.png', body: 'Winter sale', buttons: [] },
          {
            format: 'image',
            imageUrl: null,
            body: 'Summer sale',
            buttons: [{ kind: 'url', text: 'Shop' }],
          },
        ],
      }),
    );
    expect(host.querySelectorAll('[data-testid="bubble-card"]')).toHaveLength(2);
    expect(host.textContent).toContain('Winter sale');
    expect(host.textContent).toContain('Shop');
  });

  it('shows no card strip for a template without cards', () => {
    mount(model({}));
    expect(host.querySelector('[data-testid="bubble-cards"]')).toBeNull();
  });
});
