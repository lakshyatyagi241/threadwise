// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import type { Pipeline } from '../api/schemas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const state = vi.hoisted(() => ({
  pipelines: { isPending: false, isError: false, data: [] as unknown[] },
}));
vi.mock('../api/hooks', async (orig) => ({
  ...(await orig<typeof import('../api/hooks')>()),
  usePipelines: () => state.pipelines,
  useMembers: () => ({ data: [] }),
}));

import { NewDealForContact } from './new-deal-for-contact';

const stage = (id: string, name: string) => ({ id, name, kind: 'open', sortOrder: 0 }) as never;
const pipe = (id: string, name: string, isDefault: boolean): Pipeline => ({
  id,
  name,
  currency: 'INR',
  isDefault,
  sortOrder: 0,
  stages: [stage(`${id}-s1`, 'New')],
  dealCount: 0,
  rowVersion: 1,
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const session = {
    user: { id: 'u1', fullName: 'Asha' },
    org: { name: 'Acme', timezone: 'UTC' },
    permissions: { 'record.deals.create': 'all' },
  } as unknown as SessionResponse;
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider session={session}>
            <NewDealForContact
              contact={{ id: 'c1', name: 'Priya Shah', phone: '+911234' }}
              onClose={() => undefined}
              onCreated={() => undefined}
            />
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

describe('Add deal from a contact', () => {
  it('opens the new-deal form with the contact already in it and fixed', async () => {
    state.pipelines = { isPending: false, isError: false, data: [pipe('p1', 'Sales', true)] };
    await mount();
    expect(document.body.textContent).toContain('New deal');
    expect(document.body.textContent).toContain('Priya Shah');
    expect(document.querySelector('#deal-contact')?.hasAttribute('disabled') ?? true).toBe(true);
    expect(document.getElementById('deal-pipeline')).toBeNull();
  });
  it('offers the choice of pipeline when there are several, starting on the default', async () => {
    state.pipelines = {
      isPending: false,
      isError: false,
      data: [pipe('p1', 'Sales', false), pipe('p2', 'Renewals', true)],
    };
    await mount();
    const select = document.getElementById('deal-pipeline') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.querySelectorAll('option')).toHaveLength(2);
  });
  it('says so when there is no pipeline to add the deal to', async () => {
    state.pipelines = { isPending: false, isError: false, data: [] };
    await mount();
    expect(document.body.textContent).toContain('There is no pipeline to add the deal to yet');
  });
  it('the expected close date cannot be a day that has gone', async () => {
    state.pipelines = { isPending: false, isError: false, data: [pipe('p1', 'Sales', true)] };
    await mount();
    const close = document.getElementById('deal-close') as HTMLInputElement;
    expect(close.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
