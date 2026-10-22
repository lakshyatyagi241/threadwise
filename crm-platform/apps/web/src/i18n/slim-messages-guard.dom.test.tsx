// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ path: '/login' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

import { SLIM_MARKER } from './message-profiles';
import { SlimMessagesGuard } from './slim-messages-guard';

let root: Root | undefined;
let host: HTMLElement;
const slim = { common: { ok: 'OK' }, [SLIM_MARKER]: '1' };
const full = { common: { ok: 'OK' }, invoicing: { title: 'Invoices' } };

async function mount(messages: Record<string, unknown>, path: string, reload: () => void) {
  nav.path = path;
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages as never}>
        <SlimMessagesGuard reload={reload} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = undefined;
});

describe('SlimMessagesGuard', () => {
  it('reloads once when the reduced set meets a page that needs the whole catalogue', async () => {
    const reload = vi.fn();
    await mount(slim, '/contacts', reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on a public page with the reduced set', async () => {
    const reload = vi.fn();
    await mount(slim, '/login', reload);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the whole catalogue is there, on any page', async () => {
    const reload = vi.fn();
    await mount(full, '/contacts', reload);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops after one try for a page, so a set that comes back reduced cannot loop', async () => {
    const reload = vi.fn();
    sessionStorage.setItem('crm.slim-messages.reloaded', '/contacts');
    await mount(slim, '/contacts', reload);
    expect(reload).not.toHaveBeenCalled();
  });
});
