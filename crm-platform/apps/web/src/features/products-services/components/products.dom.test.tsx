// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesItem, SessionResponse } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../api/service', () => ({ productsApi: api }));

import { ProductsScreen } from './products-screen';

const item = (over: Partial<SalesItem> = {}): SalesItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'product',
  name: 'Widget',
  sku: 'W-1',
  description: null,
  unit: 'pcs',
  unitPriceMinor: 125000,
  currency: 'USD',
  taxRatePercent: 18,
  isActive: true,
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});
const listOf = (
  data: SalesItem[],
  counts = { all: data.length, active: data.length, inactive: 0 },
) => ({
  data,
  total: data.length,
  page: 1,
  limit: 25,
  counts,
});

let root: Root | undefined;
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

async function mount(
  perms: string[] = [
    'record.sales-items.create',
    'record.sales-items.update',
    'record.sales-items.delete',
  ],
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const session = {
    user: { id: 'u1', fullName: 'Asha' },
    org: { name: 'Acme', timezone: 'UTC' },
    permissions: Object.fromEntries(perms.map((p) => [p, 'all'])),
  } as unknown as SessionResponse;
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SessionProvider session={session}>
            <ToastProvider dismissLabel="x">
              <ProductsScreen />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

const button = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement;
const submit = () => button('Add', document.querySelector('dialog[open]')!);
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the Products and services list', () => {
  it('shows each item with its price, unit, tax and status, and the tab counts', async () => {
    api.list.mockResolvedValue(listOf([item()], { all: 3, active: 2, inactive: 1 }));
    await mount();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Widget');
    expect(text).toContain('W-1');
    expect(text).toContain('$1,250.00');
    expect(text).toContain('/ pcs');
    expect(text).toContain('18%');
    expect(text).toContain('Active');
    expect(text).toContain('All3');
    expect(text).toContain('Inactive1');
  });

  it('says so when the list is empty, and offers Add only to a person who may add', async () => {
    api.list.mockResolvedValue(listOf([], { all: 0, active: 0, inactive: 0 }));
    await mount();
    expect(document.body.textContent).toContain('Nothing on the list yet');
    expect(button('Add')).toBeDefined();
    act(() => root?.unmount());
    document.body.innerHTML = '';
    await mount(['record.sales-items.read']);
    expect(button('Add')).toBeUndefined();
  });

  it('adds an item: refuses an empty name, then sends the typed values in minor units', async () => {
    api.list.mockResolvedValue(listOf([]));
    api.create.mockResolvedValue(item({ name: 'Consulting' }));
    await mount();
    await act(async () => button('Add').click());
    await act(async () => submit().click());
    expect(document.body.textContent).toContain('Enter a name.');
    expect(api.create).not.toHaveBeenCalled();
    await type(document.getElementById('item-name') as HTMLInputElement, 'Consulting');
    await type(document.getElementById('item-price') as HTMLInputElement, '1250.50');
    await type(document.getElementById('item-tax') as HTMLInputElement, '18');
    await act(async () => submit().click());
    await settle();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0]![0]).toMatchObject({
      name: 'Consulting',
      unitPriceMinor: 125050,
      taxRatePercent: 18,
      isActive: true,
      kind: 'product',
    });
  });

  it('says a SKU is taken when the server refuses it', async () => {
    api.list.mockResolvedValue(listOf([]));
    api.create.mockRejectedValue(new ApiError(409, 'PRD_SKU_TAKEN', 'taken'));
    await mount();
    await act(async () => button('Add').click());
    await type(document.getElementById('item-name') as HTMLInputElement, 'Widget');
    await act(async () => submit().click());
    await settle();
    expect(document.body.textContent).toContain('Another item already has this SKU.');
  });

  it('deactivates an item with the version it was read at', async () => {
    api.list.mockResolvedValue(listOf([item({ rowVersion: 4 })]));
    api.update.mockResolvedValue(item({ isActive: false, rowVersion: 5 }));
    await mount();
    await act(async () => button('Deactivate').click());
    await settle();
    expect(api.update).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
      isActive: false,
      rowVersion: 4,
    });
  });
});
