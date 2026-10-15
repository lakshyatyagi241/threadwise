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
  enabled: false,
  calls: [] as Array<[string, unknown]>,
}));

const U1 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const U2 = '1c9a5f0e-5a6e-4d4e-9d58-5b0f1c1a6a11';
const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r-1',
  name: 'India leads',
  subject: 'contact',
  conditions: {
    sources: [],
    countryCodes: [],
    phonePrefixes: ['91'],
    lifecycleStages: [],
    tagIds: [],
    origins: [],
    properties: [],
    pipelineIds: [],
    valueMin: null,
    valueMax: null,
  },
  strategy: 'round_robin',
  userIds: [U1, U2],
  teamIds: [],
  skipOffline: true,
  isActive: true,
  position: 1,
  firedCount: 7,
  lastFiredAt: null,
  rowVersion: 3,
  ...over,
});

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/contact-assignment' }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('@/features/plans-subscriptions-trials/components/plan-paywall', () => ({
  PlanPaywall: () => null,
}));
vi.mock('../api/routing', () => ({
  useAssignees: () => ({
    data: {
      users: [
        {
          id: U1,
          name: 'Asha',
          email: 'a@x.test',
          onLeave: { until: '2026-10-24', delegateId: null },
        },
        { id: U2, name: 'Ravi', email: 'r@x.test', onLeave: null },
      ],
      teams: [],
    },
  }),
}));
vi.mock('../api/contact-assignment', async () => {
  const actual = await vi.importActual<typeof import('../api/contact-assignment')>(
    '../api/contact-assignment',
  );
  return {
    ...actual,
    useAssignmentSettings: () => ({
      isPending: false,
      error: null,
      data: { enabled: state.enabled, applyToImports: false },
    }),
    useAssignmentRules: () => ({
      isPending: false,
      error: null,
      data: {
        data: [
          rule(),
          rule({ id: 'r-2', name: 'Big deals', subject: 'deal', isActive: false, position: 1 }),
        ],
      },
    }),
    usePipelineChoices: () => ({ data: [{ id: 'p-1', name: 'Sales' }] }),
    contactAssignmentApi: {
      saveSettings: async (b: unknown) => void state.calls.push(['settings', b]),
      create: async (b: unknown) => void state.calls.push(['create', b]),
      update: async (id: string, b: unknown) =>
        void state.calls.push(['update', { id, ...(b as object) }]),
      remove: async (id: string) => void state.calls.push(['remove', id]),
      reorder: async (b: unknown) => void state.calls.push(['reorder', b]),
      test: async (b: unknown) => {
        state.calls.push(['test', b]);
        return {
          enabled: false,
          outcome: 'would_assign',
          rule: { id: 'r-1', name: 'India leads' },
          owner: { id: U2, name: 'Ravi' },
          skipped: [],
        };
      },
    },
  };
});

import { ContactAssignmentScreen } from './contact-assignment-screen';

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
  state.enabled = false;
  state.calls = [];
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
            <ContactAssignmentScreen />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
};
const setValue = (el: Element, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const byText = (text: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;

describe('the contact assignment screen', () => {
  it('lists contact and deal rules with who they use, the conditions and how often they fired', async () => {
    await render();
    const contacts = host.querySelector('[data-testid="ca-list-contact"]')!.textContent!;
    expect(contacts).toContain('India leads');
    expect(contacts).toContain('Round robin: Asha, Ravi');
    expect(contacts).toContain('phone prefix');
    expect(contacts).toContain('Used 7 times');
    const deals = host.querySelector('[data-testid="ca-list-deal"]')!.textContent!;
    expect(deals).toContain('Big deals');
    expect(deals).toContain('Off');
  });

  it('the switch is off by default and turning it on saves it', async () => {
    await render();
    const sw = host.querySelector(
      '[data-testid="ca-settings"] [role="switch"]',
    ) as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => sw.click());
    expect(state.calls).toEqual([['settings', { enabled: true }]]);
  });

  it('refuses a rule without a name or people, then creates one with the typed conditions', async () => {
    await render();
    await act(async () =>
      (host.querySelector('[data-testid="ca-new-contact"]') as HTMLButtonElement).click(),
    );
    await act(async () => byText('Save rule').click());
    expect(host.textContent).toContain('Give the rule a name.');
    expect(state.calls).toEqual([]);

    setValue(host.querySelector('[data-testid="ca-name"]')!, 'Web');
    await act(async () => byText('Save rule').click());
    expect(host.textContent).toContain('Choose at least one person or team.');

    const boxes = host.querySelectorAll('[data-testid="ca-form"] fieldset input[type="checkbox"]');
    await act(async () => (boxes[1] as HTMLInputElement).click());
    const sources = [...host.querySelectorAll('[data-testid="ca-form"] input')].find((i) =>
      i.closest('div')?.textContent?.startsWith('Source is one of'),
    ) as HTMLInputElement;
    setValue(sources, 'Website');
    await act(async () => byText('Save rule').click());
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]![0]).toBe('create');
    expect(state.calls[0]![1]).toMatchObject({
      name: 'Web',
      subject: 'contact',
      strategy: 'round_robin',
      userIds: [U2],
      skipOffline: true,
    });
  });

  it('marks a person who is on leave in the picker', async () => {
    await render();
    await act(async () =>
      (host.querySelector('[data-testid="ca-new-contact"]') as HTMLButtonElement).click(),
    );
    expect(host.querySelector('[data-testid="ca-form"]')!.textContent).toContain('on leave');
  });

  it('edits with the version it read, reorders within its subject and deletes after a confirmation', async () => {
    await render();
    await act(async () => byText('Edit').click());
    expect((host.querySelector('[data-testid="ca-name"]') as HTMLInputElement).value).toBe(
      'India leads',
    );
    setValue(host.querySelector('[data-testid="ca-name"]')!, 'India');
    await act(async () => byText('Save rule').click());
    expect(state.calls[0]).toEqual([
      'update',
      expect.objectContaining({ id: 'r-1', rowVersion: 3, name: 'India' }),
    ]);

    state.calls = [];
    await act(async () => byText('Delete').click());
    const confirm = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent === 'Delete')
      .pop()!;
    await act(async () => confirm.click());
    expect(state.calls).toEqual([['remove', 'r-1']]);
  });

  it('tests a described contact and shows who would get it, and that the switch is off', async () => {
    await render();
    const box = host.querySelector('[data-testid="ca-test"]')!;
    await act(async () => (box.querySelector('button') as HTMLButtonElement).click());
    expect(state.calls[0]![0]).toBe('test');
    const result = host.querySelector('[data-testid="ca-test-result"]')!.textContent!;
    expect(result).toContain('The rule India leads would give it to Ravi.');
    expect(result).toContain('The switch above is off');
  });

  it('hides every control from someone who can read but not manage', async () => {
    state.can = false;
    await render();
    expect(host.querySelector('[data-testid="ca-new-contact"]')).toBeNull();
    expect(host.querySelector('[data-testid="ca-rule-r-1"] button')).toBeNull();
    expect(
      (host.querySelector('[data-testid="ca-settings"] [role="switch"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(host.querySelectorAll('[data-testid^="ca-rule-"]')).toHaveLength(2);
  });

  it('reads in Arabic', async () => {
    await render('ar');
    expect(host.textContent).not.toContain('Contact assignment');
    expect(/[؀-ۿ]/.test(host.querySelector('h1')!.textContent!)).toBe(true);
  });
});
