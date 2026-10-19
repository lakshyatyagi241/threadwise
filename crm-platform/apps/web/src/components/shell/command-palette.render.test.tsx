// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { loadMessages } from '@/i18n/messages';
import { CommandPalette } from './command-palette';
import { SEARCH_EVENT } from './command-palette-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const nav = [
  {
    id: 'contacts',
    group: 'audience',
    href: '/contacts',
    labelKey: 'common.appName',
    locked: false,
    comingSoon: false,
  },
] as ResolvedNavItem[];
const tiles = [] as ResolvedSettingsTile[];

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  push.mockClear();
  host = document.createElement('div');
  host.innerHTML = '<div id="palette"></div><main></main>';
  document.body.appendChild(host);
  root = createRoot(host.querySelector('#palette') as HTMLElement);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')}>
        <CommandPalette nav={nav} tiles={tiles} />
      </NextIntlClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const press = (init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    document.body.dispatchEvent(e);
  });
  return e;
};
const dialog = () => document.querySelector('[role="dialog"]');

describe('the Ctrl K palette', () => {
  it('opens on Ctrl K and on Cmd K, lists the pages and closes on Escape', () => {
    expect(dialog()).toBeNull();
    press();
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Desk');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(dialog()).toBeNull();
    press({ ctrlKey: false, metaKey: true });
    expect(dialog()).not.toBeNull();
  });

  it('opens from the header search button too', () => {
    act(() => {
      window.dispatchEvent(new CustomEvent(SEARCH_EVENT));
    });
    expect(dialog()).not.toBeNull();
  });

  it('leaves the key to a screen that already uses it for its own search box', () => {
    const onPage = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', onPage);
    press();
    document.removeEventListener('keydown', onPage);
    expect(dialog()).toBeNull();
  });

  it("falls back to the screen's own search box when nothing matches", () => {
    const box = document.createElement('input');
    box.type = 'search';
    host.querySelector('main')!.appendChild(box);
    const seen = vi.fn();
    box.addEventListener('input', () => seen(box.value));
    press();
    const field = dialog()!.querySelector('input') as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(field, 'zzz-nothing');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(dialog()!.textContent).toContain('Search this page for "zzz-nothing"');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(seen).toHaveBeenCalledWith('zzz-nothing');
    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
