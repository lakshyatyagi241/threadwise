// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  can: true,
  created: [] as unknown[],
  updated: [] as unknown[],
  deleted: [] as string[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/sla-policies' }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('@/features/plans-subscriptions-trials/components/plan-paywall', () => ({
  PlanPaywall: () => null,
}));
vi.mock('../api/sla', async () => {
  const actual = await vi.importActual<typeof import('../api/sla')>('../api/sla');
  return {
    ...actual,
    useSlaPolicies: () => ({
      isPending: false,
      isError: false,
      error: null,
      data: {
        data: [
          {
            id: 'p-1',
            name: 'Standard',
            firstResponseMinutes: 30,
            resolutionMinutes: 1440,
            pauseWhenWaitingOnCustomer: true,
            respectBusinessHours: true,
            priorityOverrides: {},
            isDefault: true,
            conversationCount: 4,
            rowVersion: 2,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
          {
            id: 'p-2',
            name: 'No targets',
            firstResponseMinutes: null,
            resolutionMinutes: null,
            pauseWhenWaitingOnCustomer: false,
            respectBusinessHours: false,
            priorityOverrides: {},
            isDefault: false,
            conversationCount: 0,
            rowVersion: 1,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    }),
    slaApi: {
      create: async (b: unknown) => {
        state.created.push(b);
        return {};
      },
      update: async (id: string, b: unknown) => {
        state.updated.push({ id, ...(b as object) });
        return {};
      },
      remove: async (id: string) => {
        state.deleted.push(id);
      },
    },
  };
});

import { SlaPoliciesScreen } from './sla-policies-screen';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../messages/${locale}/team-inbox-routing-sla.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  state.can = true;
  state.created = [];
  state.updated = [];
  state.deleted = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (locale = 'en') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
          <ToastProvider>
            <SlaPoliciesScreen />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
};

const type = (testId: string, value: string) =>
  act(() => {
    const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('the response targets screen', () => {
  it('lists the policies with their targets, the default chip and how many conversations use each', async () => {
    await render();
    const items = [...host.querySelectorAll('[data-testid="sla-list"] li')];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Standard');
    expect(items[0]!.textContent).toContain('Default');
    expect(items[0]!.textContent).toContain('First reply: 30 min');
    expect(items[0]!.textContent).toContain('Resolve: 1440 min');
    expect(items[0]!.textContent).toContain('4 conversations');
    expect(items[1]!.textContent).toContain('No targets');
  });

  it('creates a policy from the form and refuses bad minutes without calling the server', async () => {
    await render();
    const save = () => host.querySelector('[data-testid="sla-save"]') as HTMLButtonElement;
    type('sla-name', 'VIP');
    type('sla-first', '0');
    await act(async () => {
      save().click();
    });
    expect(host.querySelector('[data-testid="sla-minutes-error"]')).not.toBeNull();
    expect(state.created).toEqual([]);

    type('sla-first', '15');
    type('sla-resolution', '240');
    await act(async () => {
      save().click();
    });
    expect(state.created).toEqual([
      {
        name: 'VIP',
        firstResponseMinutes: 15,
        resolutionMinutes: 240,
        pauseWhenWaitingOnCustomer: true,
        respectBusinessHours: true,
        priorityOverrides: {},
        isDefault: false,
      },
    ]);
  });

  it('edits with the version it read', async () => {
    await render();
    const edit = [...host.querySelectorAll('[data-testid="sla-list"] li')][0]!.querySelectorAll(
      'button',
    )[0]!;
    await act(async () => {
      edit.click();
    });
    expect((host.querySelector('[data-testid="sla-name"]') as HTMLInputElement).value).toBe(
      'Standard',
    );
    type('sla-first', '20');
    await act(async () => {
      (host.querySelector('[data-testid="sla-save"]') as HTMLButtonElement).click();
    });
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]).toMatchObject({ id: 'p-1', rowVersion: 2, firstResponseMinutes: 20 });
  });

  it('hides the form and the row buttons from someone who can read but not manage', async () => {
    state.can = false;
    await render();
    expect(host.querySelector('[data-testid="sla-form"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="sla-list"] button')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="sla-list"] li')).toHaveLength(2);
  });

  it('reads in Arabic', async () => {
    await render('ar');
    expect(host.textContent).not.toContain('Back to Settings');
    expect(/[؀-ۿ]/.test(host.querySelector('h1')!.textContent!)).toBe(true);
  });
});
