// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { UserMenu, type ShellUser } from './user-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const setThemeMock = vi.fn(async (_next: 'light' | 'dark') => undefined);
vi.mock('./actions', () => ({ setTheme: (next: 'light' | 'dark') => setThemeMock(next) }));

const user: ShellUser = { fullName: 'Asha Rao', email: 'asha@acme.test', avatarUrl: null };

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  setThemeMock.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (theme: 'light' | 'dark' = 'light') =>
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')}>
        <UserMenu
          user={user}
          theme={theme}
          settingsHref="/settings"
          profile={{ plan: 'Growth', role: 'Owner', walletLabel: '$42.00' }}
        />
      </NextIntlClientProvider>,
    );
  });

const open = () => {
  act(() => {
    (host.querySelector('[data-testid="user-menu"]') as HTMLElement).click();
  });
};

const rows = () => [
  ...host.querySelectorAll('[role="group"] > div > a, [role="group"] > div > button'),
];

describe('the profile dropdown', () => {
  it('still shows the Wallet row, with the theme toggle directly below it', () => {
    render();
    open();
    const bodies = rows().map((r) => r.textContent ?? '');
    const wallet = bodies.findIndex((t) => t.includes('Wallet'));
    expect(wallet).toBeGreaterThan(-1);
    expect(rows()[wallet + 1]?.getAttribute('data-testid')).toBe('user-menu-theme');
  });

  it('shows the sun icon and "Light" when the theme is light', () => {
    render('light');
    open();
    const row = host.querySelector('[data-testid="user-menu-theme"]') as HTMLButtonElement;
    expect(row.textContent).toContain('Theme');
    expect(row.textContent).toContain('Light');
    expect(row.getAttribute('aria-checked')).toBe('false');
  });

  it('shows the moon icon and "Dark" when the theme is dark', () => {
    render('dark');
    open();
    const row = host.querySelector('[data-testid="user-menu-theme"]') as HTMLButtonElement;
    expect(row.textContent).toContain('Dark');
    expect(row.getAttribute('aria-checked')).toBe('true');
  });

  it('flips the icon/label and calls setTheme with the opposite value, without closing the popover', () => {
    render('light');
    open();
    const row = () => host.querySelector('[data-testid="user-menu-theme"]') as HTMLButtonElement;
    act(() => row().click());
    expect(setThemeMock).toHaveBeenCalledWith('dark');
    expect(row().textContent).toContain('Dark');
    expect(row().getAttribute('aria-checked')).toBe('true');
    // The popover is still open: the group panel (and the Wallet row inside it) is still in the DOM.
    expect(host.querySelector('[role="group"]')).not.toBeNull();
    expect(host.textContent).toContain('Wallet');

    act(() => row().click());
    expect(setThemeMock).toHaveBeenCalledWith('light');
    expect(row().textContent).toContain('Light');
  });

  it('updates the document theme attribute synchronously on click', () => {
    render('light');
    open();
    const row = host.querySelector('[data-testid="user-menu-theme"]') as HTMLButtonElement;
    act(() => row.click());
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
