// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { WorkspaceKeysPage } from './keys-page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => perms.set.has(p),
}));
vi.mock('@/lib/api/client', () => ({
  apiFetch: async () => ({
    data: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        provider: 'openai',
        isActive: true,
        keyLast4: 'ABCD',
        rowVersion: 1,
        updatedAt: '2026-10-28T00:00:00.000Z',
      },
    ],
    byokAllowed: true,
    sources: [{ provider: 'openai', source: 'workspace' }],
  }),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

async function show(can: string[]) {
  perms.set = new Set(can);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ToastProvider>
            <WorkspaceKeysPage />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return { host, root };
}

describe('workspace AI keys page', () => {
  it('with aiadm.keys.manage: the form, the on/off switch and Remove are there', async () => {
    const { host, root } = await show(['aiadm.keys.read', 'aiadm.keys.manage']);
    expect(host.querySelector('#own-key')).not.toBeNull();
    expect(host.querySelector('[role="switch"]')?.hasAttribute('disabled')).toBe(false);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Remove')).toBe(true);
    expect(host.querySelector('[data-testid="keys-read-only"]')).toBeNull();
    act(() => root.unmount());
  });

  it('with only aiadm.keys.read: the keys are listed, but there is no form, no Remove, and the switch is off-limits', async () => {
    const { host, root } = await show(['aiadm.keys.read']);
    expect(host.textContent).toContain('OpenAI');
    expect(host.querySelector('#own-key')).toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Remove')).toBe(
      false,
    );
    expect(host.querySelector('[role="switch"]')?.hasAttribute('disabled')).toBe(true);
    expect(host.querySelector('[data-testid="keys-read-only"]')?.textContent).toContain('cannot');
    act(() => root.unmount());
  });
});
