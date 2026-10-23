// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: api.apiFetch }));

import { ModuleActivityDialog } from './module-activity-dialog';

const entry = (id: string, name: string, action: string, changedFields: string[], at: string) => ({
  id,
  at,
  actor: { kind: 'user', id: null, name },
  module: 'contact_groups',
  action,
  recordId: '7',
  record: { href: null },
  requestId: null,
  actAs: null,
  changedFields,
});

const PAGE = {
  data: [
    entry('e1', 'Asha Rao', 'update', ['name', 'note'], '2026-10-02T10:30:00.000Z'),
    entry('e2', 'Ravi Nair', 'insert', [], '2026-10-01T09:00:00.000Z'),
  ],
  page: { nextCursor: null, hasMore: false, limit: 50 },
  range: { from: '2026-09-23T00:00:00.000Z', to: '2026-10-23T00:00:00.000Z' },
};

const messages = loadMessages('en') as unknown as Parameters<
  typeof NextIntlClientProvider
>[0]['messages'];

let host: HTMLElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  // jsdom has no modal dialogs: the dialog only needs these two to exist.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  api.apiFetch.mockReset();
  api.apiFetch.mockResolvedValue(PAGE);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ModuleActivityDialog
            open
            onClose={() => undefined}
            module="contact_groups"
            title="Group activity"
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle(0);
}

function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setValue.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const bodyRows = () => [...host!.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '');

describe('ModuleActivityDialog: the audit trail of one module', () => {
  it('reads the workspace log for this module and lists who did what, newest first', async () => {
    await mount();

    expect(api.apiFetch.mock.calls[0]?.[1]?.query).toMatchObject({ module: 'contact_groups' });
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Asha Rao');
    expect(rows[0]).toContain('name, note');
    expect(rows[1]).toContain('Ravi Nair');
  });

  it('filters the loaded entries by person, by action or by changed field', async () => {
    await mount();
    const search = host!.querySelector('input[type="search"]') as HTMLInputElement;

    await act(async () => type(search, 'ravi'));
    await settle(0);
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toContain('Ravi Nair');

    await act(async () => type(search, 'name'));
    await settle(0);
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toContain('Asha Rao');

    await act(async () => type(search, 'nothing like this'));
    await settle(0);
    expect(bodyRows()).toHaveLength(0);
    expect(host!.textContent).toContain('No entry has that person, action or field.');
  });
});
