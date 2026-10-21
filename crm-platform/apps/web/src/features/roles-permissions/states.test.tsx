// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en/roles-permissions.json';
import { ApiError } from '@/lib/api/errors';
import { ToastProvider } from '../auth-registration-security/platform/ui/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  fetchMyPermissions: vi.fn(),
  fetchPermissions: vi.fn(),
  fetchRoles: vi.fn(),
  createPermission: vi.fn(),
  deletePermission: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock('./lib/api', async (orig) => ({ ...(await orig<typeof import('./lib/api')>()), ...api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PermissionCreatePage } from './permission-create';
import { PermissionsPage } from './permissions-page';
import { RolesPage } from './roles-page';

const t = messages['roles-permissions'];
const ALL = {
  'platform.permission.manage': true,
  'platform.role.manage': true,
};
const permKpis = { total: 0, modules: 0, usedInRoles: 0, orphans: 0, lastAdded: null };
const roleKpis = {
  totalRoles: 3,
  systemRoles: 1,
  customRoles: 2,
  totalPermissions: 10,
  usersWithRole: 4,
  rolesWithoutUsers: 0,
};
const serverDown = () => new ApiError(500, 'INTERNAL', 'boom', 'req-1');

let host: HTMLElement | null = null;
let unmount: (() => Promise<void>) | null = null;
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
};
async function mount(el: ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={client}>
          <ToastProvider>{el}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
  unmount = async () => {
    await act(async () => root.unmount());
    host?.remove();
  };
  return host;
}
const buttonByText = (h: HTMLElement, label: string) =>
  [...h.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
const click = (el: Element) =>
  act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchMyPermissions.mockResolvedValue({ permissions: ALL });
});
afterEach(async () => {
  await unmount?.();
  unmount = null;
});

describe('permissions catalogue states', () => {
  it('shows an error state with a retry when the permissions fail to load', async () => {
    api.fetchPermissions.mockRejectedValueOnce(serverDown());
    const h = await mount(<PermissionsPage />);
    expect(h.textContent).toContain(t.common.errors.unexpected);
    expect(h.textContent).not.toContain(t.permissions.empty.none.slice(0, 20));
    api.fetchPermissions.mockResolvedValue({ data: [], kpis: permKpis });
    await click(buttonByText(h, t.common.retry));
    await settle();
    expect(api.fetchPermissions).toHaveBeenCalledTimes(2);
    expect(h.textContent).toContain('No permissions defined yet.');
  });

  it('shows the empty state with a link to create the first permission when there are none yet', async () => {
    api.fetchPermissions.mockResolvedValue({ data: [], kpis: permKpis });
    const h = await mount(<PermissionsPage />);
    expect(h.textContent).toContain('No permissions defined yet.');
    expect(h.querySelector('a[href="/admin/permissions/new"]')).not.toBeNull();
    expect(h.textContent).not.toContain(t.permissions.empty.noMatch);
  });

  it('shows no results, not the first-use message, when the filters match nothing', async () => {
    api.fetchPermissions.mockResolvedValue({
      data: [{ id: 'p1', name: 'crm.read', module: 'crm', isSystem: false, roleCount: 1 }],
      kpis: { ...permKpis, total: 1, modules: 1, usedInRoles: 1 },
    });
    const h = await mount(<PermissionsPage />);
    await typeInto(h.querySelector<HTMLInputElement>('input[type="search"]')!, 'zzz-nothing');
    expect(h.textContent).toContain(t.permissions.empty.noMatch);
    expect(h.textContent).not.toContain('No permissions defined yet.');
  });

  it('shows a spinner while loading, not the empty state', async () => {
    api.fetchPermissions.mockReturnValue(new Promise(() => undefined));
    const h = await mount(<PermissionsPage />);
    expect(h.textContent).toContain(t.common.loading);
    expect(h.textContent).not.toContain('No permissions defined yet.');
  });
});

describe('create permission states', () => {
  it('keeps the typed values and shows the error when create fails', async () => {
    api.createPermission.mockRejectedValue(serverDown());
    const h = await mount(<PermissionCreatePage />);
    const name = h.querySelector<HTMLInputElement>('#name')!;
    await typeInto(name, 'crm.export');
    await click(buttonByText(h, t.permissionNew.create));
    await settle();
    expect(api.createPermission).toHaveBeenCalledWith({ name: 'crm.export' });
    expect(h.querySelector('[role="alert"]')?.textContent).toContain(t.common.errors.unexpected);
    expect(h.querySelector<HTMLInputElement>('#name')!.value).toBe('crm.export');
    expect(buttonByText(h, t.permissionNew.create).disabled).toBe(false);
  });
});

describe('roles list states', () => {
  it('shows an error state with a retry when the roles fail to load', async () => {
    api.fetchRoles.mockRejectedValueOnce(serverDown());
    const h = await mount(<RolesPage />);
    expect(h.textContent).toContain(t.common.errors.unexpected);
    api.fetchRoles.mockResolvedValue({ data: [], kpis: { ...roleKpis, totalRoles: 0 } });
    await click(buttonByText(h, t.common.retry));
    await settle();
    expect(api.fetchRoles).toHaveBeenCalledTimes(2);
    expect(h.textContent).toContain('No roles defined yet.');
  });

  it('shows the empty state with a link to create the first role when there are no roles yet', async () => {
    api.fetchRoles.mockResolvedValue({ data: [], kpis: { ...roleKpis, totalRoles: 0 } });
    const h = await mount(<RolesPage />);
    expect(h.textContent).toContain('No roles defined yet.');
    expect(h.querySelector('a[href="/admin/roles/new"]')).not.toBeNull();
    expect(h.textContent).not.toContain(t.list.empty.noMatch);
  });

  it('shows no results with a way to clear the filters when the filters match nothing', async () => {
    // Three roles exist (kpis), the chosen filter returns none of them.
    api.fetchRoles.mockResolvedValue({ data: [], kpis: roleKpis });
    const h = await mount(<RolesPage />);
    await click(buttonByText(h, t.list.filter.system));
    await settle();
    expect(h.textContent).toContain(t.list.empty.noMatch);
    expect(h.textContent).not.toContain('No roles defined yet.');
    await click(buttonByText(h, t.list.empty.clear));
    await settle();
    expect(h.querySelector('[aria-pressed="true"]')?.textContent).toContain(t.list.filter.all);
  });
});
