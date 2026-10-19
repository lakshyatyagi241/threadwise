// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DpdpAttestationView,
  DpdpCheckView,
  DpdpItemView,
  DpdpRegisterResponse,
  OperatorRole,
  OperatorSessionResponse,
} from '@crm/contracts';
import { OperatorProvider } from '@/features/auth-registration-security/platform/operator-context';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { DpdpRegisterPage } from './dpdp-register-page';

const fetchMock = vi.fn();
vi.mock('@/features/auth-registration-security/platform/operator-fetch', () => ({
  operatorFetch: (path: string, req?: unknown) => fetchMock(path, req),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The real English messages of the whole app: the page also uses the console's shared loading and error texts. */
const messages = loadMessages('en');

const DISCLAIMER =
  'Tracks what the platform does today against the DPDP Act and Rules. It is not a compliance certificate.';
const PENTEST = 'An external penetration test report is on file with no open critical finding';
const COUNSEL = 'Indian data-protection counsel is engaged';

const tier = (notFollowing = 0, partial = 0, unverified = 0) => ({
  notFollowing,
  partial,
  unverified,
});

function item(over: Partial<DpdpItemView> & Pick<DpdpItemView, 'id' | 'group' | 'status'>) {
  return {
    citation: 's4',
    owner: 'both',
    penaltyTier: '50',
    planItems: ['DP-32'],
    conditional: false,
    checks: [],
    ...over,
  } as DpdpItemView;
}

const lapsed: DpdpAttestationView = {
  result: 'pass',
  note: 'Counsel engaged, letter on file',
  evidenceUrl: 'https://example.com/letter.pdf',
  byName: 'Priya Shah',
  at: '2026-06-01T10:00:00.000Z',
  expiresAt: '2026-09-01T10:00:00.000Z',
};

const pentestMissing: DpdpCheckView = {
  key: 'security.pentest_report',
  source: 'attested',
  result: 'unknown',
  detail: 'attestation_missing',
};

function register(): DpdpRegisterResponse {
  return {
    generatedAt: '2026-10-17T09:00:00.000Z',
    milestones: [
      { id: 'consent_managers', date: '2026-11-14', daysLeft: 28, passed: false },
      { id: 'main_duties', date: '2027-05-14', daysLeft: 209, passed: false },
    ],
    summary: {
      total: 47,
      following: 1,
      partial: 26,
      notFollowing: 19,
      unverified: 1,
      byTier: {
        '250': tier(5, 7, 1),
        '200': tier(3, 0, 0),
        '150': tier(1, 0, 0),
        '50': tier(10, 19, 0),
        none: tier(),
      },
    },
    groups: [
      {
        id: 'A',
        items: [
          item({
            id: 'r01',
            group: 'A',
            status: 'not_following',
            citation: 's4',
            planItems: ['DP-32', 'DP-33'],
            checks: [
              {
                key: 'consent.default_opt_in',
                source: 'live',
                result: 'fail',
                detail: 'default_opt_out',
                params: { on: 3, total: 10 },
              },
              {
                key: 'consent.lawful_basis_dpdp',
                source: 'code',
                result: 'fail',
                detail: 'code_declared',
              },
            ],
          }),
          item({
            id: 'r02',
            group: 'A',
            status: 'following',
            citation: 's5(1), rule 3',
            owner: 'tenant',
            planItems: ['DP-30'],
          }),
        ],
      },
      {
        id: 'B',
        items: [
          item({ id: 'r16', group: 'B', status: 'not_following', citation: 's13, rule 14(3)' }),
          item({ id: 'r13', group: 'B', status: 'partial', citation: 's11', owner: 'tenant' }),
          item({ id: 'r20', group: 'B', status: 'following', citation: 'ss11 to 15, rule 14' }),
        ],
      },
      {
        id: 'D',
        items: [
          item({
            id: 'r28',
            group: 'D',
            status: 'partial',
            penaltyTier: '250',
            citation: 's8(5), rule 6(1)(b)',
            planItems: ['DP-11', 'DP-16'],
            checks: [
              { key: 'mfa.operators', source: 'live', result: 'pass', detail: 'mfa_on' },
              { key: 'mfa.workspace_admins', source: 'live', result: 'fail', detail: 'mfa_off' },
              {
                key: 'rls.privileged_guc_fixed',
                source: 'code',
                result: 'fail',
                detail: 'code_declared',
              },
            ],
          }),
          item({
            id: 'r33',
            group: 'D',
            status: 'partial',
            penaltyTier: '250',
            citation: 'rule 6(1)(g), s8(4)',
            planItems: ['DP-16', 'DP-90'],
            checks: [
              pentestMissing,
              {
                key: 'ci.security_jobs_scheduled',
                source: 'code',
                result: 'fail',
                detail: 'code_declared',
              },
            ],
          }),
        ],
      },
      {
        id: 'F',
        items: [item({ id: 'r41', group: 'F', status: 'not_applicable', owner: 'tenant' })],
      },
      {
        id: 'H',
        items: [
          item({
            id: 'r44',
            group: 'H',
            status: 'not_following',
            penaltyTier: '150',
            citation: 's10, rule 13',
            planItems: ['DP-80'],
            conditional: true,
          }),
        ],
      },
      {
        id: 'I',
        items: [
          item({
            id: 'r45',
            group: 'I',
            status: 'unverified',
            citation: 'ss27 to 33, rule 19',
            planItems: ['DP-90'],
            checks: [
              {
                key: 'legal.counsel_engaged',
                source: 'attested',
                result: 'unknown',
                detail: 'attestation_expired',
                attestation: lapsed,
              },
            ],
          }),
        ],
      },
    ],
  };
}

/** The register after a super admin attested the penetration test report as in place. */
function afterAttest(): DpdpRegisterResponse {
  const r = register();
  const r33 = r.groups.find((g) => g.id === 'D')!.items.find((i) => i.id === 'r33')!;
  r33.checks[0] = {
    key: 'security.pentest_report',
    source: 'attested',
    result: 'pass',
    detail: 'attested_pass',
    attestation: {
      result: 'pass',
      note: 'Report on file, no open critical',
      evidenceUrl: null,
      byName: 'Sam Ops',
      at: '2026-10-17T09:30:00.000Z',
      expiresAt: '2027-01-15T09:30:00.000Z',
    },
  };
  return r;
}

let root: Root;
let host: HTMLElement;
let current: DpdpRegisterResponse;
let history: { data: DpdpAttestationView[] };
let missing: string[];

/** Routes the mocked API: GET /dpdp-register, GET .../checks/:key/history, POST .../checks/:key/attest. */
function serve() {
  fetchMock.mockImplementation(async (path: string, req?: { method?: string }) => {
    if (path === '/dpdp-register' && !req?.method) return current;
    if (/^\/dpdp-register\/checks\/[\w.]+\/history$/.test(path)) return history;
    if (/^\/dpdp-register\/checks\/[\w.]+\/attest$/.test(path) && req?.method === 'POST') {
      return afterAttest();
    }
    throw new Error(`unexpected ${path}`);
  });
}

async function mount(role: OperatorRole = 'super_admin') {
  const session = {
    operator: { id: 'x', email: 'a@b.c', fullName: 'A', role, mfaEnabled: true },
    mfaEnrolmentRequired: false,
    sessionId: 'y',
  } as unknown as OperatorSessionResponse;
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="UTC"
        onError={(e) => void missing.push(e.message)}
        getMessageFallback={({ namespace, key }) => `[[${namespace ?? ''}.${key}]]`}
      >
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ToastProvider>
            <OperatorProvider session={session}>
              <DpdpRegisterPage />
            </OperatorProvider>
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await flush();
  await flush();
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const text = () => host.textContent ?? '';
const click = (el: Element) => act(async () => void (el as HTMLElement).click());
const byText = (selector: string, label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === label);
const button = (label: string) => byText('button', label) as HTMLButtonElement;
const buttonByName = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === name,
  )!;
const ids = () => [...host.querySelectorAll('li[id^="r"]')].map((el) => el.id);
const row = (id: string) => host.querySelector<HTMLElement>(`li[id="${id}"]`)!;
const openDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]');
const summary = () => host.querySelector('section[aria-label="Register summary"]')!;
/** The number shown under a label in the summary strip. */
const stat = (label: string) => {
  const dt = byText('dt', label, summary());
  return dt?.parentElement?.querySelector('dd')?.textContent;
};
const callsTo = (path: string, method?: string) =>
  fetchMock.mock.calls.filter(
    ([p, r]) => p === path && (method ? r?.method === method : !r?.method),
  );

async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement
        : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
/** A control of the open dialog, found by its label text. */
function field<T extends HTMLElement>(label: string): T {
  const dialog = openDialog()!;
  const labelEl = [...dialog.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(label),
  )!;
  return dialog.querySelector<T>(`#${CSS.escape(labelEl.htmlFor)}`)!;
}

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  fetchMock.mockReset();
  current = register();
  history = { data: [lapsed] };
  missing = [];
  serve();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  // A message key the page asked for that the English file lacks fails the test that rendered it.
  expect(missing).toEqual([]);
});

describe('DPDP register page', () => {
  it('opens with the disclaimer and never says compliant or certified', async () => {
    await mount();
    expect(text()).toContain(DISCLAIMER);
    expect(text()).not.toMatch(/\bcompliant\b|\bcertified\b/i);
  });

  it('shows the counts of the five statuses, taken from the payload', async () => {
    await mount();
    expect(stat('Not following')).toBe('19');
    expect(stat('Partial')).toBe('26');
    expect(stat('Unverified')).toBe('1');
    expect(stat('Following')).toBe('1');
    // r41 is the one item the payload marks not applicable; the API leaves it out of the 47
    expect(stat('Not applicable')).toBe('1');
    expect(summary().textContent).toContain('47 obligations counted');
  });

  it('draws a stacked bar of the four counted statuses in proportion', async () => {
    await mount();
    const segments = [...summary().querySelectorAll<HTMLElement>('[data-bar-status]')];
    expect(segments.map((s) => s.dataset.barStatus)).toEqual([
      'not_following',
      'partial',
      'unverified',
      'following',
    ]);
    const widths = segments.map((s) => parseFloat(s.style.width));
    [19, 26, 1, 1].forEach((count, i) => expect(widths[i]).toBeCloseTo((count / 47) * 100, 3));
  });

  it('shows the days to each milestone as "about", from the payload', async () => {
    await mount();
    const s = summary().textContent!;
    expect(s).toContain('Consent Manager registration (rule 4)');
    expect(s).toContain('About 28 days to go');
    expect(s).toContain('Nov 14, 2026');
    expect(s).toContain('About 209 days to go');
    expect(s).toContain('May 14, 2027');
  });

  it('says a date has passed instead of counting down', async () => {
    current.milestones[0] = { ...current.milestones[0]!, daysLeft: 0, passed: true };
    await mount();
    expect(summary().textContent).toContain('This date has passed');
  });

  it('shows the penalty-tier strip: not following, partial and unverified per tier', async () => {
    await mount();
    const table = summary().querySelector('table')!;
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [
      tr.querySelector('th')!.textContent,
      ...[...tr.querySelectorAll('td')].map((td) => td.textContent),
    ]);
    expect(rows).toEqual([
      ['Rs 250 crore', '5', '7', '1'],
      ['Rs 200 crore', '3', '0', '0'],
      ['Rs 150 crore', '1', '0', '0'],
      ['Rs 50 crore', '10', '19', '0'],
      ['No penalty tier', '0', '0', '0'],
    ]);
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Penalty tier',
      'Not following',
      'Partial',
      'Unverified',
    ]);
  });

  it('lists the groups with the plan headings and the rows in the order the server sent', async () => {
    await mount();
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toContain('Grounds, notice, consent (ss4 to 7, rule 3)');
    expect(headings).toContain('Rights and grievance (ss11 to 15, rule 14)');
    expect(headings).toContain('Significant Data Fiduciary (s10, rule 13)');
    // a not following row comes before a following row, and nothing is sorted again
    expect(ids()).toEqual(['r01', 'r02', 'r16', 'r13', 'r20', 'r28', 'r33', 'r41', 'r44', 'r45']);
    expect(ids().indexOf('r16')).toBeLessThan(ids().indexOf('r20'));
  });

  it('shows on a row the status as text, the id, citation, title, owner, penalty tier and plan items', async () => {
    await mount();
    const r28 = row('r28');
    expect(r28.querySelector('[data-status-chip]')!.textContent).toBe('Partial');
    expect(r28.textContent).toContain('r28');
    expect(r28.textContent).toContain('s8(5), rule 6(1)(b)');
    expect(r28.textContent).toContain('Control access to computer resources');
    expect(r28.textContent).toContain('Workspace and platform');
    expect(r28.textContent).toContain('Rs 250 crore');
    expect(r28.textContent).toContain('DP-11');
    expect(r28.textContent).toContain('DP-16');
    expect(row('r16').textContent).toContain(
      'Run a published grievance mechanism, answering within 90 days',
    );
    expect(row('r02').querySelector('[data-status-chip]')!.textContent).toBe('Following');
    expect(row('r41').querySelector('[data-status-chip]')!.textContent).toBe('Not applicable');
    expect(row('r02').textContent).toContain('Workspace');
  });

  it('marks the Significant Data Fiduciary row as only if notified', async () => {
    await mount();
    expect(row('r44').textContent).toContain('Only if notified');
    expect(row('r01').textContent).not.toContain('Only if notified');
  });

  it('lists the checks of a row with a text mark, the source and the detail', async () => {
    await mount();
    const checks = [...row('r28').querySelectorAll('[data-check]')];
    expect(checks.map((c) => (c as HTMLElement).dataset.check)).toEqual([
      'mfa.operators',
      'mfa.workspace_admins',
      'rls.privileged_guc_fixed',
    ]);
    expect(checks[0]!.textContent).toContain('Pass');
    expect(checks[0]!.textContent).toContain('Read live');
    expect(checks[0]!.textContent).toContain(
      'Super admins must sign in with two-factor authentication',
    );
    expect(checks[0]!.textContent).toContain('Two-factor sign-in is required for super admins.');
    expect(checks[1]!.textContent).toContain('Fail');
    expect(checks[1]!.textContent).toContain(
      'Not required: workspace admins can sign in without a second factor.',
    );
  });

  it('labels a code check as declared by the code and gives it no Attest action', async () => {
    await mount();
    const code = row('r28').querySelector('[data-check="rls.privileged_guc_fixed"]')!;
    expect(code.textContent).toContain('Declared by the code');
    expect(code.textContent).toContain(
      'Declared in the code, not measured at run time. The change that closes the gap updates it.',
    );
    expect(code.querySelector('button')).toBeNull();
  });

  it('fills the params of a detail text', async () => {
    await mount();
    const live = row('r01').querySelector('[data-check="consent.default_opt_in"]')!;
    expect(live.textContent).toContain(
      'New workspaces start without requiring recorded consent for marketing. 3 of 10 workspaces require it now.',
    );
  });

  it('says a row has no check behind it when the status is only declared', async () => {
    await mount();
    expect(row('r02').textContent).toContain('Declared status. No check reads this yet.');
  });

  it('shows a lapsed attestation from its detail: who recorded it, when, and that it lapsed', async () => {
    await mount();
    const c = row('r45').querySelector('[data-check="legal.counsel_engaged"]')!;
    expect(c.textContent).toContain('Unknown');
    expect(c.textContent).toContain('Lapsed');
    expect(c.textContent).toContain(
      'The statement recorded by Priya Shah on Jun 1, 2026 lapsed on Sep 1, 2026. It no longer counts.',
    );
    expect(c.textContent).toContain('Counsel engaged, letter on file');
    const link = c.querySelector<HTMLAnchorElement>('a[href="https://example.com/letter.pdf"]')!;
    expect(link.rel).toContain('noopener');
    expect(link.target).toBe('_blank');
  });

  it('does not call a check lapsed because an attestation is attached', async () => {
    current.groups.find((g) => g.id === 'I')!.items[0]!.checks[0] = {
      key: 'legal.counsel_engaged',
      source: 'attested',
      result: 'pass',
      detail: 'attested_pass',
      attestation: { ...lapsed, expiresAt: '2027-01-01T00:00:00.000Z' },
    };
    await mount();
    const c = row('r45').querySelector('[data-check="legal.counsel_engaged"]')!;
    expect(c.textContent).not.toContain('Lapsed');
    expect(c.textContent).toContain('Recorded as in place by Priya Shah on Jun 1, 2026.');
    expect(c.textContent).toContain('Counts until Jan 1, 2027.');
  });

  it('does not render an evidence link that is not https', async () => {
    current.groups.find((g) => g.id === 'I')!.items[0]!.checks[0]!.attestation = {
      ...lapsed,
      evidenceUrl: 'javascript:alert(1)',
    };
    await mount();
    expect(row('r45').querySelector('a')).toBeNull();
  });
});

describe('filter chips', () => {
  it('shows every row under All, which is the default', async () => {
    await mount();
    expect(button('All').getAttribute('aria-pressed')).toBe('true');
    expect(ids()).toHaveLength(10);
  });

  it('hides everything but the not following rows, and the groups left empty, under Not following', async () => {
    await mount();
    await click(button('Not following'));
    expect(button('Not following').getAttribute('aria-pressed')).toBe('true');
    expect(button('All').getAttribute('aria-pressed')).toBe('false');
    expect(ids()).toEqual(['r01', 'r16', 'r44']);
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toContain('Grounds, notice, consent (ss4 to 7, rule 3)');
    expect(headings).not.toContain('Security (s8(4), (5), rule 6)');
    await click(button('All'));
    expect(ids()).toHaveLength(10);
  });

  it('filters by Partial, Unverified and Following the same way', async () => {
    await mount();
    await click(button('Partial'));
    expect(ids()).toEqual(['r13', 'r28', 'r33']);
    await click(button('Unverified'));
    expect(ids()).toEqual(['r45']);
    await click(button('Following'));
    expect(ids()).toEqual(['r02', 'r20']);
  });

  it('shows an empty result with a way back when nothing matches', async () => {
    current.groups = current.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.status !== 'following') }))
      .filter((g) => g.items.length > 0);
    await mount();
    await click(button('Following'));
    expect(ids()).toEqual([]);
    expect(text()).toContain('No obligations match this filter');
    await click(button('Show all'));
    expect(ids().length).toBeGreaterThan(0);
  });
});

describe('who sees Attest and History', () => {
  it('shows Attest to a super admin on the attested checks only', async () => {
    await mount('super_admin');
    const attest = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Attest');
    expect(attest.map((b) => b.getAttribute('aria-label'))).toEqual([
      `Attest: ${PENTEST}`,
      `Attest: ${COUNSEL}`,
    ]);
  });

  it.each(['auditor', 'support'] as const)(
    'shows no Attest to %s, but still History',
    async (role) => {
      await mount(role);
      expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Attest')).toBe(
        false,
      );
      const history = [...host.querySelectorAll('button')].filter(
        (b) => b.textContent === 'History',
      );
      expect(history.map((b) => b.getAttribute('aria-label'))).toEqual([
        `History: ${PENTEST}`,
        `History: ${COUNSEL}`,
      ]);
      // the register itself is still readable
      expect(ids()).toHaveLength(10);
    },
  );

  it('offers neither on a live or a code check', async () => {
    await mount();
    expect(row('r28').querySelector('button')).toBeNull();
    expect(row('r01').querySelector('button')).toBeNull();
  });
});

describe('the Attest dialog', () => {
  const open = async () => {
    await mount();
    await click(buttonByName(`Attest: ${PENTEST}`));
  };

  it('opens on the check with a result, a note, an evidence link and an expiry of 90 days', async () => {
    await open();
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain('Record a statement');
    expect(dialog.textContent).toContain(PENTEST);
    expect(field<HTMLSelectElement>('Result').value).toBe('pass');
    expect(field<HTMLTextAreaElement>('Note').value).toBe('');
    expect(field<HTMLInputElement>('Evidence link').value).toBe('');
    expect(field<HTMLInputElement>('Counts for').value).toBe('90');
  });

  it('blocks submit while the note is under 10 characters', async () => {
    await open();
    await type(field('Note'), '123456789');
    await click(button('Record statement'));
    expect(callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST')).toHaveLength(0);
    expect(field<HTMLTextAreaElement>('Note').getAttribute('aria-invalid')).toBe('true');
    expect(openDialog()!.textContent).toContain('Write at least 10 characters.');
    expect(openDialog()).not.toBeNull();
  });

  it('counts the trimmed note, so spaces do not make it long enough', async () => {
    await open();
    await type(field('Note'), '   123456789   ');
    await click(button('Record statement'));
    expect(callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST')).toHaveLength(0);
  });

  it('sends the statement without an evidence link when the box is blank, then shows the new register', async () => {
    await open();
    await type(field('Note'), 'Report on file, no open critical');
    await click(button('Record statement'));
    await flush();
    const [post] = callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST');
    const body = (post![1] as { body: Record<string, unknown> }).body;
    expect(body).toEqual({
      result: 'pass',
      note: 'Report on file, no open critical',
      expiresInDays: 90,
    });
    expect('evidenceUrl' in body).toBe(false);
    expect(openDialog()).toBeNull();
    expect(text()).toContain('Statement recorded.');
    const c = row('r33').querySelector('[data-check="security.pentest_report"]')!;
    expect(c.textContent).toContain('Recorded as in place by Sam Ops on Oct 17, 2026.');
    expect(c.textContent).toContain('Report on file, no open critical');
  });

  it('sends the result, the link and the expiry that were picked', async () => {
    await open();
    await type(field('Result'), 'fail');
    await type(field('Note'), '  Test is booked for December  ');
    await type(field('Evidence link'), ' https://example.com/booking ');
    await type(field('Counts for'), '30');
    await click(button('Record statement'));
    await flush();
    const [post] = callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST');
    expect((post![1] as { body: unknown }).body).toEqual({
      result: 'fail',
      note: 'Test is booked for December',
      evidenceUrl: 'https://example.com/booking',
      expiresInDays: 30,
    });
  });

  it('marks a link that is not https and an expiry out of range, and sends nothing', async () => {
    await open();
    await type(field('Note'), 'Report on file, no open critical');
    await type(field('Evidence link'), 'http://example.com');
    await type(field('Counts for'), '400');
    await click(button('Record statement'));
    expect(callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST')).toHaveLength(0);
    expect(field('Evidence link').getAttribute('aria-invalid')).toBe('true');
    expect(field('Counts for').getAttribute('aria-invalid')).toBe('true');
    expect(openDialog()!.textContent).toContain('Use a full https link, or leave this empty.');
    expect(openDialog()!.textContent).toContain('Enter a whole number of days from 1 to 365.');
  });

  it('forgets the draft when it is closed and opened again', async () => {
    await open();
    await type(field('Note'), 'Half-written note');
    await click(button('Cancel'));
    expect(openDialog()).toBeNull();
    await click(buttonByName(`Attest: ${PENTEST}`));
    expect(field<HTMLTextAreaElement>('Note').value).toBe('');
  });

  /** The sentences a failed Attest can show, by what went wrong. */
  const FAILURES: ReadonlyArray<readonly [string, Error, string]> = [
    [
      'a refusal (403)',
      new ApiError(403, 'FORBIDDEN', 'x', 'req-3'),
      'You do not have permission to do this.',
    ],
    [
      'a server error (500)',
      new ApiError(500, 'INTERNAL', 'x', 'req-4'),
      'Something went wrong on our side. Try again in a moment.',
    ],
    [
      'a rejected body (422)',
      new ApiError(422, 'UNPROCESSABLE', 'x', 'req-5'),
      'Some values are not valid. Check the highlighted fields.',
    ],
    [
      'no connection',
      new Error('offline'),
      'Could not reach the server. Check your connection and try again.',
    ],
  ];
  /** The text of the toast region: the corner live region of the ToastProvider, which is not in the top layer. */
  const toastText = () => host.querySelector('[aria-live="polite"]')?.textContent ?? '';
  const failAttest = (error: Error) =>
    fetchMock.mockImplementation(async (path: string, req?: { method?: string }) => {
      if (req?.method === 'POST') throw error;
      if (path === '/dpdp-register') return current;
      throw new Error(`unexpected ${path}`);
    });

  it.each(FAILURES)(
    'keeps the dialog open and shows %s inside it, as an alert, not as a toast',
    async (_name, error, message) => {
      await open();
      failAttest(error);
      await type(field('Note'), 'Report on file, no open critical');
      await click(button('Record statement'));
      await flush();
      const dialog = openDialog();
      expect(dialog).not.toBeNull();
      const alerts = [...dialog!.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
      expect(alerts).toContain(message);
      // nothing is left in the toast region, which paints under the modal backdrop
      expect(toastText()).toBe('');
      expect(text()).not.toContain('req-');
      // the draft is kept, so the person can try again
      expect(field<HTMLTextAreaElement>('Note').value).toBe('Report on file, no open critical');
    },
  );

  it('clears the failure when a field is edited', async () => {
    await open();
    failAttest(new ApiError(403, 'FORBIDDEN', 'x'));
    await type(field('Note'), 'Report on file, no open critical');
    await click(button('Record statement'));
    await flush();
    expect(openDialog()!.textContent).toContain('You do not have permission to do this.');
    await type(field('Note'), 'Report on file, no open critical finding');
    expect(openDialog()!.textContent).not.toContain('You do not have permission to do this.');
    await click(button('Record statement'));
    await flush();
    expect(openDialog()!.textContent).toContain('You do not have permission to do this.');
    await type(field('Counts for'), '30');
    expect(openDialog()!.textContent).not.toContain('You do not have permission to do this.');
  });

  it('clears the failure when the button is pressed again, and closes when the retry works', async () => {
    await open();
    failAttest(new ApiError(500, 'INTERNAL', 'x'));
    await type(field('Note'), 'Report on file, no open critical');
    await click(button('Record statement'));
    await flush();
    expect(openDialog()!.textContent).toContain('Something went wrong on our side.');
    serve();
    await click(button('Record statement'));
    await flush();
    expect(openDialog()).toBeNull();
    expect(callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST')).toHaveLength(2);
    // success still uses the toast, which shows once the dialog has closed
    expect(toastText()).toContain('Statement recorded.');
  });

  it('sends only once when the button is pressed twice', async () => {
    await open();
    await type(field('Note'), 'Report on file, no open critical');
    const submit = button('Record statement');
    await act(async () => {
      submit.click();
      submit.click();
    });
    await flush();
    expect(callsTo('/dpdp-register/checks/security.pentest_report/attest', 'POST')).toHaveLength(1);
  });
});

describe('the History link', () => {
  it('loads the attestations of the check and lists who recorded each and when', async () => {
    history = {
      data: [
        {
          ...lapsed,
          result: 'fail',
          note: 'Letter not signed yet',
          byName: 'Sam Ops',
          at: '2026-09-02T08:15:00.000Z',
          expiresAt: '2026-12-01T08:15:00.000Z',
          evidenceUrl: null,
        },
        lapsed,
      ],
    };
    await mount('auditor');
    await click(buttonByName(`History: ${COUNSEL}`));
    await flush();
    expect(callsTo('/dpdp-register/checks/legal.counsel_engaged/history')).toHaveLength(1);
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain('History');
    expect(dialog.textContent).toContain(COUNSEL);
    const entries = [...dialog.querySelectorAll('li')].map((li) => li.textContent!);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain('Sam Ops');
    expect(entries[0]).toContain('Sep 2, 2026');
    expect(entries[0]).toContain('Not in place (fail)');
    expect(entries[0]).toContain('Letter not signed yet');
    expect(entries[1]).toContain('Priya Shah');
    expect(entries[1]).toContain('Jun 1, 2026');
    expect(entries[1]).toContain('In place (pass)');
    expect(entries[1]).toContain('Valid until Sep 1, 2026');
    expect(dialog.querySelector('a[href="https://example.com/letter.pdf"]')).not.toBeNull();
  });

  it('does not call the history until it is opened', async () => {
    await mount();
    expect(callsTo('/dpdp-register/checks/legal.counsel_engaged/history')).toHaveLength(0);
    expect(callsTo('/dpdp-register/checks/security.pentest_report/history')).toHaveLength(0);
  });

  it('says so when nothing has been recorded', async () => {
    history = { data: [] };
    await mount();
    await click(buttonByName(`History: ${PENTEST}`));
    await flush();
    expect(openDialog()!.textContent).toContain('Nothing has been recorded for this check yet.');
  });

  it('shows an error with a retry inside the dialog when the history fails', async () => {
    await mount();
    fetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/history')) throw new ApiError(500, 'INTERNAL', 'x', 'req-5');
      return current;
    });
    await click(buttonByName(`History: ${PENTEST}`));
    await flush();
    expect(openDialog()!.textContent).not.toContain('req-5');
    expect(byText('button', 'Try again', openDialog()!)).toBeDefined();
  });

  it('closes with the Close button', async () => {
    await mount();
    await click(buttonByName(`History: ${PENTEST}`));
    await flush();
    await click(byText('button', 'Close', openDialog()!)!);
    expect(openDialog()).toBeNull();
  });
});

describe('loading, failure and refresh', () => {
  it('shows a loading state until the register arrives', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    await mount();
    expect(text()).toContain('Loading');
    expect(ids()).toEqual([]);
  });

  it('shows an error with a retry that calls the API again', async () => {
    fetchMock.mockImplementation(async () => {
      throw new ApiError(500, 'INTERNAL', 'x', 'req-7');
    });
    await mount();
    expect(text()).not.toContain('req-7');
    expect(text()).toContain('Something went wrong on our side.');
    const before = fetchMock.mock.calls.length;
    serve();
    await click(button('Try again'));
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(ids()).toHaveLength(10);
  });

  it('shows when the register was checked and reloads it on Refresh', async () => {
    await mount();
    expect(text().replace(/\s+/g, ' ')).toContain('Checked Oct 17, 2026, 9:00 AM');
    await click(button('Refresh'));
    await flush();
    expect(callsTo('/dpdp-register')).toHaveLength(2);
  });
});
