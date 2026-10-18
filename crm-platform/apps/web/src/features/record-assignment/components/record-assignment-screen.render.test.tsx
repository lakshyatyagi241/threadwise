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

const U1 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const U2 = '1c9a5f0e-5a6e-4d4e-9d58-5b0f1c1a6a11';
const REC = '5d8e6a54-1d36-4f3b-9f5c-7a6a1f1c2b33';

const state = vi.hoisted(() => ({
  can: true,
  enabled: false,
  locked: false,
  calls: [] as Array<[string, unknown]>,
}));

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r-1',
  name: 'India leads',
  description: '',
  subject: 'contact',
  rules: {
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'name', operator: 'contains', value: 'Asha' }],
  },
  strategy: 'round_robin',
  userIds: [U1, U2],
  teamIds: [],
  skipOffline: true,
  reassignOnUpdate: false,
  isActive: true,
  isFallback: false,
  position: 1,
  priority: 1,
  firedCount: 7,
  lastFiredAt: null,
  brokenConditions: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  lastModifiedBy: { id: U1, name: 'Asha' },
  rowVersion: 3,
  ...over,
});

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/record-assignment',
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
  useSession: () => ({ permissions: {}, org: {} }),
}));
vi.mock('@/features/plans-subscriptions-trials/components/plan-paywall', () => ({
  PlanPaywall: () => <div data-testid="paywall" />,
}));
vi.mock('@/features/persona-vocabulary', () => ({
  useVocabulary: () => ({
    noun: (k: string) =>
      k === 'contact'
        ? {
            singular: 'Patient',
            plural: 'Patients',
            singularLower: 'patient',
            pluralLower: 'patients',
          }
        : { singular: 'Deal', plural: 'Deals', singularLower: 'deal', pluralLower: 'deals' },
  }),
}));
vi.mock('@/features/contacts-attributes-tags', () => ({
  useModuleFields: () => ({ data: [], isSuccess: true, isError: false }),
  isUsableProperty: () => true,
}));
vi.mock('@/features/segments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/segments')>();
  return {
    ...actual,
    usePeople: () => ({
      data: [
        { id: U1, fullName: 'Asha' },
        { id: U2, fullName: 'Ravi' },
      ],
    }),
    useTeams: () => ({ data: [] }),
    useSegmentCatalog: () => ({
      ready: true,
      failed: false,
      lookups: {},
      personName: () => undefined,
      catalog: [
        {
          id: 'name',
          group: 'who',
          kind: 'text',
          label: { key: 'name' },
          operators: ['equals', 'contains'],
        },
      ],
    }),
  };
});
vi.mock('../api/assignment', async () => {
  const actual = await vi.importActual<typeof import('../api/assignment')>('../api/assignment');
  const { ApiError } = await vi.importActual<typeof import('@/lib/api/errors')>('@/lib/api/errors');
  return {
    ...actual,
    useAssignmentSettings: () =>
      state.locked
        ? {
            isPending: false,
            isError: true,
            error: new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'),
          }
        : {
            isPending: false,
            isError: false,
            error: null,
            data: { enabled: state.enabled, applyToImports: false },
          },
    useAssignmentRules: () => ({
      isPending: false,
      isError: false,
      data: {
        data: [
          rule({ id: 'r-paused', name: 'Old rule', isActive: false, priority: null, position: 1 }),
          rule({
            id: 'r-fb',
            name: 'Everyone else',
            rules: null,
            isFallback: true,
            priority: 2,
            position: 2,
          }),
          rule({ id: 'r-1', name: 'India leads', priority: 1, position: 3 }),
          rule({ id: 'r-2', name: 'Big accounts', priority: 2, position: 4 }),
        ],
      },
    }),
    useAssignmentRuns: () => ({
      isPending: false,
      isError: false,
      data: {
        pages: [
          {
            data: [
              {
                id: 'run-1',
                subject: 'contact',
                record: { id: REC, label: 'Meera' },
                ruleId: 'r-1',
                ruleName: 'India leads',
                outcome: 'assigned',
                reason: 'matched',
                owner: { id: U2, name: 'Ravi' },
                method: 'round_robin',
                origin: 'form',
                trigger: 'created',
                trace: [
                  {
                    ruleId: 'r-1',
                    name: 'India leads',
                    matched: true,
                    nobody: false,
                    broken: false,
                  },
                ],
                createdAt: '2026-10-03T10:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
    }),
    useRecordSearch: () => ({
      isFetching: false,
      isError: false,
      data: [{ id: REC, label: 'Meera' }],
    }),
    assignmentApi: {
      saveSettings: async (b: unknown) => void state.calls.push(['settings', b]),
      create: async (b: unknown) => void state.calls.push(['create', b]),
      update: async (id: string, b: unknown) =>
        void state.calls.push(['update', { id, ...(b as object) }]),
      remove: async (id: string) => void state.calls.push(['remove', id]),
      clone: async (id: string) => void state.calls.push(['clone', id]),
      setActive: async (id: string, on: boolean) => void state.calls.push(['active', { id, on }]),
      reorder: async (b: unknown) => void state.calls.push(['reorder', b]),
      test: async (b: unknown) => {
        state.calls.push(['test', b]);
        return {
          enabled: false,
          outcome: 'would_assign',
          record: { id: REC, label: 'Meera' },
          rule: { id: 'r-1', name: 'India leads' },
          owner: { id: U2, name: 'Ravi' },
          trace: [
            { ruleId: 'r-2', name: 'Big accounts', matched: false, nobody: false, broken: false },
            { ruleId: 'r-1', name: 'India leads', matched: true, nobody: false, broken: false },
          ],
          skipped: [],
        };
      },
    },
  };
});

import { RecordAssignmentScreen } from './record-assignment-screen';

const read = (locale: string, file: string) =>
  JSON.parse(
    readFileSync(join(__dirname, `../../../../messages/${locale}/${file}.json`), 'utf8'),
  ) as Record<string, unknown>;
const messages = (locale: string) => ({
  ...read(locale, 'record-assignment'),
  ...read(locale, 'segments'),
  ...read(locale, 'companies'),
});

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
  state.locked = false;
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
            <RecordAssignmentScreen />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
};
const button = (text: string | RegExp) =>
  [...host.querySelectorAll('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? ''),
  ) as HTMLButtonElement;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const setInput = (el: Element, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const setSelect = (el: Element, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('the record assignment rules screen', () => {
  it('names the tabs and sentences with the workspace words, and links both ways to Auto-assignment', async () => {
    await render();
    const tabs = [...host.querySelector('[role="tablist"]')!.querySelectorAll('[role="tab"]')].map(
      (t) => t.textContent,
    );
    expect(tabs).toEqual(['Patients', 'Companies', 'Deals']);
    expect(host.querySelector('[data-testid="ra-cross-note"]')!.textContent).toContain('patients');
    expect(host.querySelector('[data-testid="ra-cross-note"] a')!.getAttribute('href')).toBe(
      '/auto-assignment',
    );
  });

  it('lists the rules by priority, fallbacks after, paused last, with the fallback explained', async () => {
    await render();
    const rows = [...host.querySelectorAll('[data-testid^="ra-rule-"]')];
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'ra-rule-r-1',
      'ra-rule-r-2',
      'ra-rule-r-fb',
      'ra-rule-r-paused',
    ]);
    const fb = host.querySelector('[data-testid="ra-rule-r-fb"]')!.textContent!;
    expect(fb).toContain('Fallback');
    expect(fb).toContain('No conditions: matches every record');
    const first = host.querySelector('[data-testid="ra-rule-r-1"]')!.textContent!;
    expect(first).toContain('Asha, Ravi');
    expect(first).toContain('Round robin');
    expect(first).toContain('Used 7 times');
  });

  it('the master switch is off by default and turning it on saves it', async () => {
    await render();
    const sw = host.querySelector(
      '[data-testid="ra-settings"] [role="switch"]',
    ) as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await click(sw);
    expect(state.calls).toEqual([['settings', { enabled: true }]]);
  });

  it('moves a rule with the arrow buttons and sends the whole order', async () => {
    await render();
    await click(host.querySelector('[aria-label="Move Big accounts up"]')!);
    expect(state.calls).toEqual([
      ['reorder', { subject: 'contact', ids: ['r-2', 'r-1', 'r-fb', 'r-paused'] }],
    ]);
  });

  it('a fallback cannot be moved above the rules with conditions', async () => {
    await render();
    const up = host.querySelector('[aria-label="Move Everyone else up"]') as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it('pauses an active rule through the switch', async () => {
    await render();
    await click(host.querySelector('[aria-label="Rule India leads is active"]')!);
    expect(state.calls).toEqual([['active', { id: 'r-1', on: false }]]);
  });

  it('creates a specific-user rule with no conditions as an active fallback', async () => {
    await render();
    await click(host.querySelector('[data-testid="ra-create"]')!);
    expect(host.querySelector('[data-testid="ra-editor"]')).not.toBeNull();
    expect(host.textContent).toContain('No conditions: matches every record, runs last (fallback)');
    // refused without a name and a person
    await click(button('Save and activate'));
    expect(state.calls).toEqual([]);
    expect(host.textContent).toContain('Give the rule a name.');
    await setInput(host.querySelector('#ra-name')!, 'Everyone to Asha');
    await setSelect(host.querySelector('#ra-method')!, 'fixed');
    await setSelect(host.querySelector('#ra-person')!, U1);
    await click(button('Save and activate'));
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]![0]).toBe('create');
    expect(state.calls[0]![1]).toMatchObject({
      name: 'Everyone to Asha',
      subject: 'contact',
      rules: null,
      strategy: 'fixed',
      userIds: [U1],
      teamIds: [],
      isActive: true,
    });
  });

  it('saves as paused', async () => {
    await render();
    await click(host.querySelector('[data-testid="ra-create"]')!);
    await setInput(host.querySelector('#ra-name')!, 'Draft');
    await setSelect(host.querySelector('#ra-method')!, 'fixed');
    await setSelect(host.querySelector('#ra-person')!, U2);
    await click(button('Save as paused'));
    expect(state.calls[0]![1]).toMatchObject({ isActive: false, userIds: [U2] });
  });

  it('edits a rule: the module is fixed and the saved row version travels with the change', async () => {
    await render();
    const menu = host.querySelector('[aria-label="Actions for India leads"]')!;
    await click(menu);
    await click(
      [...host.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === 'Edit')!,
    );
    expect((host.querySelector('#ra-module') as HTMLSelectElement).disabled).toBe(true);
    expect(host.textContent).toContain("A rule's module cannot be changed");
    await setInput(host.querySelector('#ra-name')!, 'India leads v2');
    await click(button('Save changes'));
    expect(state.calls[0]![0]).toBe('update');
    expect(state.calls[0]![1]).toMatchObject({ id: 'r-1', rowVersion: 3, name: 'India leads v2' });
    expect('subject' in (state.calls[0]![1] as object)).toBe(false);
  });

  it('asks before deleting a rule', async () => {
    await render();
    await click(host.querySelector('[aria-label="Actions for Big accounts"]')!);
    await click(
      [...host.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === 'Delete')!,
    );
    expect(state.calls).toEqual([]);
    expect(host.textContent).toContain('The rule Big accounts will stop assigning');
    const confirm = [...host.querySelectorAll('dialog button')].find(
      (b) => b.textContent === 'Delete',
    )!;
    await click(confirm);
    expect(state.calls).toEqual([['remove', 'r-2']]);
  });

  it('shows the rules read-only without the manage permission', async () => {
    state.can = false;
    await render();
    expect(host.querySelector('[data-testid="ra-create"]')).toBeNull();
    expect(host.querySelector('[aria-label="Move Big accounts up"]')).toBeNull();
    expect(
      (host.querySelector('[aria-label="Rule India leads is active"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(host.textContent).toContain('You can see these rules but not change them');
  });

  it('tests a real record and lists every rule that was tried', async () => {
    await render();
    const input = host.querySelector('[data-testid="ra-test"] input')!;
    await act(async () => (input as HTMLInputElement).focus());
    await click(
      [...host.querySelectorAll('[role="option"] button')].find((b) => b.textContent === 'Meera')!,
    );
    await click(button('Test'));
    expect(state.calls).toEqual([['test', { subject: 'contact', recordId: REC }]]);
    const result = host.querySelector('[data-testid="ra-test-result"]')!.textContent!;
    expect(result).toContain('Meera would go to Ravi through the rule India leads.');
    expect(result).toContain('Record assignment is off');
    const trace = [...host.querySelectorAll('[data-testid="ra-trace"] li')].map(
      (l) => l.textContent,
    );
    expect(trace[0]).toContain('Did not match');
    expect(trace[1]).toContain('Matched and takes the record');
  });

  it('shows the run log with a link to the record and the way it arrived', async () => {
    await render();
    await click(
      [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Run log')!,
    );
    const log = host.querySelector('[data-testid="ra-log"]')!;
    expect(log.textContent).toContain('90 days');
    expect(log.querySelector('a')!.getAttribute('href')).toBe(`/contacts/${REC}`);
    expect(log.textContent).toContain('Assigned');
    expect(log.textContent).toContain('A rule matched');
    expect(log.textContent).toContain('Form');
    await click(button('Show how it was decided'));
    expect(log.querySelector('[data-testid="ra-trace"]')).not.toBeNull();
  });

  it('shows the paywall when the plan lacks the feature, and no rules', async () => {
    state.locked = true;
    await render();
    expect(host.querySelector('[data-testid="paywall"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="ra-rules"]')).toBeNull();
  });

  it('renders in Arabic', async () => {
    await render('ar');
    expect(host.querySelector('h1')!.textContent).not.toBe('Record assignment rules');
    expect(host.querySelectorAll('[data-testid^="ra-rule-"]')).toHaveLength(4);
  });
});
