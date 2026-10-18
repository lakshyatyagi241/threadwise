// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { UncontactedMarker } from './uncontacted-marker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

function mount(since: string | null | undefined, variant?: 'dot' | 'chip', locale = 'en') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
        <UncontactedMarker since={since} variant={variant} />
      </NextIntlClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the Uncontacted marker', () => {
  it('draws nothing for a contacted contact, so a workspace that never uses it sees no chrome', () => {
    mount(null);
    expect(host.textContent).toBe('');
    expect(host.children).toHaveLength(0);
  });

  it('the chip says the word and, on hover, since when', () => {
    mount('2026-10-03T10:00:00.000Z');
    expect(host.textContent).toBe('Uncontacted');
    expect(host.querySelector('[title]')?.getAttribute('title')).toBe('Waiting since Oct 3, 2026');
  });

  it('the dot beside a name has the word only for screen readers', () => {
    mount('2026-10-03T10:00:00.000Z', 'dot');
    expect(host.querySelector('.sr-only')?.textContent).toBe('Uncontacted');
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('is translated', () => {
    mount('2026-10-03T10:00:00.000Z', 'chip', 'ar');
    expect(host.textContent).not.toBe('Uncontacted');
    expect(host.textContent?.length).toBeGreaterThan(0);
  });
});
