// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPLIANCE_DEFAULTS,
  type ComplianceChecklist,
  type ComplianceSettings,
} from '@crm/contracts';
import { button, click, flush, mount, testid, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  settings: null as unknown,
  checklist: null as unknown,
  subprocessors: [] as unknown[],
  saved: [] as unknown[],
  added: [] as unknown[],
  addError: null as unknown,
  tab: null as string | null,
  replaced: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (u: string) => state.replaced.push(u) }),
  usePathname: () => '/compliance',
  useSearchParams: () => new URLSearchParams(state.tab ? `tab=${state.tab}` : ''),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
  useSession: () => ({ org: { name: 'Acme Ltd', slug: 'acme', timezone: 'Asia/Kolkata' } }),
}));
vi.mock('@/features/contact-consent', () => ({
  ConsentNoticeEditor: ({ refId }: { refId: string }) => <div data-testid={`notice-${refId}`} />,
}));
vi.mock('../api/service', () => ({
  complianceApi: {
    settings: () => Promise.resolve(state.settings),
    checklist: () => Promise.resolve(state.checklist),
    subprocessors: () => Promise.resolve({ data: state.subprocessors }),
    saveSettings: (body: Record<string, unknown>) => {
      state.saved.push(body);
      return Promise.resolve({
        ...(state.settings as object),
        ...body,
        rowVersion: 1,
        regimesConfirmedAt: '2026-10-15T00:00:00.000Z',
        updatedAt: '2026-10-15T00:00:00.000Z',
      });
    },
    addSubprocessor: (body: Record<string, unknown>) => {
      if (state.addError) return Promise.reject(state.addError);
      state.added.push(body);
      return Promise.resolve({ ...body, id: 's1', rowVersion: 1, createdAt: '', updatedAt: '' });
    },
    links: () => Promise.resolve({ privacyUrl: null, termsUrl: null, noticeText: null }),
  },
}));

import { ComplianceScreen } from './compliance-screen';

const base = (over: Partial<ComplianceSettings> = {}): ComplianceSettings => ({
  ...COMPLIANCE_DEFAULTS,
  rowVersion: null,
  updatedAt: null,
  regimesConfirmedAt: null,
  suggestion: { country: 'IN', source: 'onboarding', regimes: ['dpdp_in', 'trai_in'] },
  workspaceTimezone: 'Asia/Kolkata',
  ...over,
});

const checklist: ComplianceChecklist = {
  generatedAt: '2026-10-15T00:00:00.000Z',
  regimes: [],
  items: [
    {
      id: 'lawful_basis',
      scope: 'baseline',
      regimes: [],
      status: 'built',
      detail: 'built',
      params: {},
      href: null,
    },
    {
      id: 'notices',
      scope: 'baseline',
      regimes: [],
      status: 'open',
      detail: 'none',
      params: {},
      href: '/compliance?tab=notices',
    },
  ],
  summary: { built: 1, partial: 0, open: 1 },
};

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['settings.compliance.read', 'settings.compliance.manage']);
  state.settings = base();
  state.checklist = checklist;
  state.subprocessors = [];
  state.saved = [];
  state.added = [];
  state.addError = null;
  state.tab = null;
  state.replaced = [];
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const show = async () => {
  m = await mount(<ComplianceScreen />, { client: client() });
  await flush();
  await flush();
  return m;
};

describe('the Compliance center', () => {
  it('is closed to people without the permission', async () => {
    state.perms = new Set();
    await show();
    expect(m!.host.textContent).toContain(text('errors.forbidden'));
    expect(testid(m!.host, 'compliance-center')).toBeNull();
  });

  it('says what it is and what it is not, and that health information does not belong here', async () => {
    await show();
    const host = m!.host;
    expect(host.textContent).toContain(text('subtitle'));
    expect(testid(host, 'phi-notice')?.textContent).toContain(text('phi.title'));
    expect(host.textContent).not.toMatch(/\bis compliant\b/i);
  });

  it('shows the checklist with its status and the disclaimer', async () => {
    await show();
    const host = m!.host;
    expect(testid(host, 'status-lawful_basis')?.textContent).toBe(text('checklist.status.built'));
    expect(testid(host, 'status-notices')?.textContent).toBe(text('checklist.status.open'));
    expect(host.textContent).toContain(text('checklist.disclaimer'));
    expect(host.textContent).toContain(text('checklist.noProfiles'));
  });

  it('an Open button on a row moves to the tab that fixes it', async () => {
    await show();
    await click(button(testid(m!.host, 'row-notices')!, text('checklist.open')));
    expect(state.replaced.at(-1)).toBe('/compliance?tab=notices');
  });

  it('suggests profiles from the country, applies them on request, and saves a confirmed choice without a version', async () => {
    state.tab = 'profiles';
    await show();
    const host = m!.host;
    expect(testid(host, 'suggestion')?.textContent).toContain('IN');
    expect(testid(host, 'not-confirmed')).not.toBeNull();
    expect((host.querySelector('#regime-dpdp_in') as HTMLInputElement).checked).toBe(false);
    expect(testid(host, 'save-bar')).toBeNull();

    await click(testid(host, 'use-suggestion')!);
    expect((host.querySelector('#regime-dpdp_in') as HTMLInputElement).checked).toBe(true);
    expect((host.querySelector('#regime-trai_in') as HTMLInputElement).checked).toBe(true);
    expect(testid(host, 'dpdp-extras')).not.toBeNull();
    expect(testid(host, 'effective')?.textContent).toContain('09:00 - 21:00');

    await click(testid(host, 'save-settings')!);
    await flush();
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({ regimes: ['dpdp_in', 'trai_in'], privacyUrl: null });
    expect('rowVersion' in (state.saved[0] as object)).toBe(false);
  });

  it('a read-only role can look but not change: no save bar, disabled choices', async () => {
    state.perms = new Set(['settings.compliance.read']);
    state.tab = 'profiles';
    await show();
    const host = m!.host;
    expect(host.textContent).toContain(text('readOnly'));
    expect(testid(host, 'use-suggestion')).toBeNull();
    expect((host.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });

  it('blocks saving while a link is not https and shows the problem', async () => {
    state.tab = 'links';
    await show();
    const host = m!.host;
    await type(host.querySelector('#privacy-url') as HTMLInputElement, 'http://acme.test/privacy');
    expect(host.textContent).toContain(text('problems.httpsOnly'));
    expect((testid(host, 'save-settings') as HTMLButtonElement).disabled).toBe(true);
    await type(host.querySelector('#privacy-url') as HTMLInputElement, 'https://acme.test/privacy');
    expect((testid(host, 'save-settings') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the windows tab says in plain words what is held and what is not', async () => {
    state.tab = 'windows';
    await show();
    expect(testid(m!.host, 'enforced-note')?.textContent).toContain(text('windows.enforcedNote'));
  });

  it('asks the children question and shows the parental switch only when minors may be included', async () => {
    state.tab = 'contacts';
    await show();
    const host = m!.host;
    expect(host.querySelector('#parental')).toBeNull();
    const select = host.querySelector('#children-policy') as HTMLSelectElement;
    await import('react').then(({ act }) =>
      act(async () => {
        select.value = 'may_include_minors';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    );
    expect(host.querySelector('#parental')).not.toBeNull();
  });
});

describe('the sub-processor tab', () => {
  it('lists the vendors, adds one with trimmed values and nulls for the empty ones', async () => {
    state.tab = 'subprocessors';
    state.subprocessors = [
      {
        id: 's0',
        name: 'Mailer Co',
        purpose: 'Email',
        dataCategories: 'Emails',
        location: 'Ireland',
        websiteUrl: null,
        dpaUrl: null,
        status: 'active',
        addedOn: null,
        noticeSentOn: null,
        rowVersion: 1,
        createdAt: '',
        updatedAt: '',
      },
    ];
    await show();
    const host = m!.host;
    expect(testid(host, 'subprocessor-list')?.textContent).toContain('Mailer Co');
    expect(testid(host, 'subprocessor-list')?.textContent).toContain(
      text('subprocessors.status.active'),
    );

    await click(testid(host, 'add-subprocessor')!);
    const save = () =>
      document.querySelector('[data-testid="save-subprocessor"]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await type(document.querySelector('#sp-name') as HTMLInputElement, '  SMS Gateway ');
    await type(document.querySelector('#sp-location') as HTMLInputElement, 'India');
    expect(save().disabled).toBe(false);
    await click(save());
    await flush();
    expect(state.added).toEqual([
      expect.objectContaining({
        name: 'SMS Gateway',
        location: 'India',
        websiteUrl: null,
        dpaUrl: null,
        status: 'active',
      }),
    ]);
  });

  it('the public page switch is saved with the settings, not on its own', async () => {
    state.tab = 'subprocessors';
    await show();
    const host = m!.host;
    await click(host.querySelector('#public-page')!);
    expect(testid(host, 'save-bar')).not.toBeNull();
    await click(testid(host, 'save-settings')!);
    await flush();
    expect(state.saved[0]).toMatchObject({ subprocessorsPublic: true });
  });

  it('offers the DPA template download', async () => {
    state.tab = 'subprocessors';
    await show();
    expect(testid(m!.host, 'dpa-card')?.textContent).toContain(text('subprocessors.dpa.hint'));
  });
});
