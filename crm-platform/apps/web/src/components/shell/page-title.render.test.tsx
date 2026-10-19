// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { BrandProvider } from './brand';
import { PageTitle } from './page-title';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = '/contacts';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useSession: () => ({ org: { name: 'WABO DEMO' } }),
}));

const nav = [
  {
    id: 'contacts',
    group: 'audience',
    href: '/contacts',
    labelKey: 'nav.contacts',
    locked: false,
    comingSoon: false,
  },
] as ResolvedNavItem[];
const messages = { nav: { contacts: 'Contacts' }, common: { appName: 'Desk' } };

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  document.title = 'Desk';
  host = document.createElement('div');
  host.innerHTML = '<main></main>';
  document.body.appendChild(host);
  root = createRoot(host.firstElementChild as HTMLElement);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (brand = '') =>
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BrandProvider name={brand}>
          <PageTitle nav={nav} tiles={[]} />
        </BrandProvider>
      </NextIntlClientProvider>,
    );
  });

describe('the tab title', () => {
  it('replaces the site title with "<Page> | <Workspace>"', () => {
    pathname = '/contacts';
    render();
    expect(document.title).toBe('Contacts | WABO DEMO');
  });

  it('keeps a page title the page set itself, with the configured product name as the template suffix', () => {
    pathname = '/contacts';
    document.title = 'Asha Verma - Acme Hub';
    render('Acme Hub');
    expect(document.title).toBe('Asha Verma | WABO DEMO');
  });

  it('puts the title back when the server writes a new one after hydration', async () => {
    pathname = '/contacts';
    render();
    document.title = 'Desk';
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.title).toBe('Contacts | WABO DEMO');
  });
});
