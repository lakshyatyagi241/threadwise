import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrgLifecycleLogEntry, OrgLifecycleResponse, WorkspaceHubRow } from '@crm/contracts';
import { ERROR_CODES, WORKSPACE_HUB_COLUMNS } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';
import { CONSOLE_KEYWORDS } from '@/features/admin-console-shell/console-keywords';
import { CONSOLE_LAYOUT } from '@/features/admin-console-shell/console-layout';
import { CONSOLE_NAV_ITEMS, buildConsoleNav } from '@/features/admin-console-shell/console-nav';
import { buildSearchIndex, searchEntries } from '@/features/admin-console-shell/console-search';
import { actionState, actionsFor } from './components/row-actions';
import { WorkspacesTable } from './components/workspaces-table';
import { HUB_DEFAULTS, hasActiveFilter } from './components/workspaces-toolbar';
import {
  DEFAULT_COLUMNS,
  LOCKED_COLUMNS,
  parseStoredColumns,
  toggleColumn,
  visibleColumns,
} from './lib/columns';
import { readRaw, resetColumns, setColumn, type ColumnStorage } from './lib/columns-store';
import { hubError } from './lib/errors';
import { agoParts, capText, endsInfo } from './lib/format';
import { hubAccess, retentionAccess } from './lib/permissions';
import {
  checkExempt,
  checkPolicy,
  hasRetentionFilter,
  policyDraftFor,
  reasonError,
  toLifecycleFilters,
  untilIso,
} from './lib/retention';
import { RetentionTable, retentionActions } from './components/retention-table';
import { detailReason } from './components/retention-history-drawer';
import { impersonationDraft, suspendBody, toListFilters } from './lib/query';
import { hubRedirectPath } from './lib/redirect';
import { WSHUB_OPERATOR_NAV } from './operator-nav';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/admin/workspaces',
  useSearchParams: () => new URLSearchParams(),
}));

const WEB = resolve(__dirname, '../../..');
type Tree = { [key: string]: string | Tree };
const load = (locale: string, file: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, file), 'utf8')) as Tree;
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const messages = {
  ...load('en', 'workspaces-hub.json'),
  ...load('en', 'plans-subscriptions-trials.json'),
} as Tree;
const en = flatten(load('en', 'workspaces-hub.json'));
const ar = flatten(load('ar', 'workspaces-hub.json'));

function memoryStorage(
  initial: Record<string, string> = {},
): ColumnStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const row = (over: Partial<WorkspaceHubRow> = {}): WorkspaceHubRow => ({
  workspaceId: '11111111-1111-4111-8111-111111111111',
  name: 'Acme Traders',
  slug: 'acme',
  status: 'active',
  suspendedBy: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  provider: { key: 'meta_cloud', name: 'Meta Cloud', source: 'default' },
  numbers: 2,
  plan: { slug: 'pro', name: 'Pro', known: true, platformOwned: false },
  validity: {
    state: 'paid_active',
    trialEndsAt: null,
    planEndsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    daysLeft: 2,
    renewalWindow: true,
    graceEndsAt: null,
  },
  limits: { monthlyMessages: null, users: 5, contacts: 1000, devices: 1, overridden: true },
  wallet: { currency: 'INR', balanceMinor: '12345', low: true },
  owner: {
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Asha',
    email: 'asha@acme.test',
    phone: '+911234',
  },
  mrr: '49.00',
  messages7d: 1200,
  lastActiveAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  health: 'good',
  ...over,
});

const everything = {
  dashboard: true,
  editPlan: true,
  planLimits: true,
  provider: true,
  impersonate: true,
  suspend: true,
  unsuspend: true,
};

const wrap = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

describe('column choice', () => {
  it('shows every column by default and keeps the workspace column locked', () => {
    expect(visibleColumns(null)).toEqual([...WORKSPACE_HUB_COLUMNS]);
    expect(DEFAULT_COLUMNS).toEqual(WORKSPACE_HUB_COLUMNS);
    expect(LOCKED_COLUMNS).toEqual(['workspace']);
    expect(toggleColumn([...DEFAULT_COLUMNS], 'workspace', false)).toEqual([...DEFAULT_COLUMNS]);
  });

  it('hides a column and remembers it for the next visit', () => {
    const store = memoryStorage();
    setColumn(store, 'plan', false);
    setColumn(store, 'mrr', false);
    const next = visibleColumns(parseStoredColumns(readRaw(store)));
    expect(next).not.toContain('plan');
    expect(next).not.toContain('mrr');
    expect(next).toContain('workspace');
    // a later visit reads the same choice; bringing one back keeps the canonical order
    setColumn(store, 'plan', true);
    expect(visibleColumns(parseStoredColumns(readRaw(store))).indexOf('plan')).toBe(3);
  });

  it('resets to every column and tolerates junk or blocked storage', () => {
    const store = memoryStorage();
    setColumn(store, 'owner', false);
    resetColumns(store);
    expect(visibleColumns(parseStoredColumns(readRaw(store)))).toEqual([...WORKSPACE_HUB_COLUMNS]);
    expect(parseStoredColumns('{nope')).toBeNull();
    expect(parseStoredColumns('["plan","bogus"]')).toEqual(['plan']);
    const blocked: ColumnStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => setColumn(blocked, 'plan', false)).not.toThrow();
    expect(() => resetColumns(blocked)).not.toThrow();
    expect(readRaw(blocked)).toBeNull();
  });
});

describe('the table', () => {
  const draw = (columns: readonly (typeof WORKSPACE_HUB_COLUMNS)[number][], rows = [row()]) =>
    wrap(
      <WorkspacesTable
        rows={rows}
        columns={columns}
        currency="USD"
        access={everything}
        onAction={() => undefined}
      />,
    );

  it('draws only the chosen columns, then the action menu', () => {
    const html = draw(['workspace', 'plan']);
    expect(html).toContain('data-col="workspace"');
    expect(html).toContain('data-col="plan"');
    expect(html).not.toContain('data-col="owner"');
    expect(html).not.toContain('data-col="mrr"');
    expect(html).toContain('Actions for Acme Traders');
  });

  it('shows every fact an operator acts on', () => {
    const html = draw([...WORKSPACE_HUB_COLUMNS]);
    expect(html).toContain('href="/admin/workspaces/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('Meta Cloud');
    expect(html).toContain('2 numbers');
    expect(html).toContain('Pro');
    expect(html).toContain('2 days left');
    expect(html).toContain('text-danger');
    expect(html).toContain('∞ msgs/mo');
    expect(html).toContain('Override');
    expect(html).toContain('123.45');
    expect(html).toContain('Low');
    expect(html).toContain('mailto:asha@acme.test');
    expect(html).toContain('49.00');
    expect(html).toContain('3 hours ago');
  });

  it('tints and badges a suspended workspace, and says Expired for a past end date', () => {
    const html = draw(
      ['workspace', 'ends'],
      [
        row({
          status: 'suspended',
          suspendedBy: ['fraud'],
          validity: { ...row().validity, planEndsAt: '2020-01-01T00:00:00.000Z', daysLeft: null },
        }),
      ],
    );
    expect(html).toContain('bg-danger/5');
    expect(html).toContain('Suspended');
    expect(html).toContain('Fraud');
    expect(html).toContain('Expired');
  });
});

describe('row actions by permission', () => {
  it('offers the six actions, with Reactivate replacing Suspend on a suspended workspace', () => {
    expect(actionsFor({ status: 'active' })).toEqual([
      'dashboard',
      'editPlan',
      'planLimits',
      'provider',
      'impersonate',
      'suspend',
    ]);
    expect(actionsFor({ status: 'suspended' }).at(-1)).toBe('unsuspend');
  });

  it('greys out what the role may not do and nothing else', () => {
    const support = hubAccess({ 'platform.workspace.impersonate': true }, 'support');
    const enabled = actionState({ status: 'active' }, support)
      .filter((a) => a.enabled)
      .map((a) => a.id);
    expect(enabled).toEqual(['dashboard', 'impersonate']);
    const sa = hubAccess(
      {
        'platform.workspace.suspend': true,
        'platform.workspace.unsuspend': true,
        'platform.workspace.impersonate': true,
        'platform.whatsapp_providers.manage': true,
      },
      'super_admin',
    );
    expect(actionState({ status: 'active' }, sa).every((a) => a.enabled)).toBe(true);
  });

  it('offers only the dashboard until the permission map is known', () => {
    const none = hubAccess(undefined, undefined);
    expect(
      actionState({ status: 'active' }, none)
        .filter((a) => a.enabled)
        .map((a) => a.id),
    ).toEqual(['dashboard']);
  });
});

describe('forms', () => {
  it('needs a reason of 8 characters to log in as the owner', () => {
    expect(impersonationDraft('short', false)).toBeNull();
    expect(impersonationDraft('1234567', false)).toBeNull();
    expect(impersonationDraft('   1234567   ', false)).toBeNull();
    expect(impersonationDraft('12345678', false)).toEqual({ reason: '12345678', readOnly: false });
    expect(impersonationDraft('  checking invoice  ', true)).toEqual({
      reason: 'checking invoice',
      readOnly: true,
    });
  });

  it('sends a suspend reason only when one was typed', () => {
    expect(suspendBody('')).toEqual({});
    expect(suspendBody('   ')).toEqual({});
    expect(suspendBody(' chargeback ')).toEqual({ reason: 'chargeback' });
  });

  it('turns the address filters into the API query and drops unknown values', () => {
    expect(
      toListFilters({
        ...HUB_DEFAULTS,
        q: 'acme',
        status: 'suspended',
        state: 'paid_grace',
        low: 'true',
        sort: 'name',
      }),
    ).toMatchObject({
      q: 'acme',
      status: 'suspended',
      state: 'paid_grace',
      lowBalanceOnly: true,
      sort: 'name',
    });
    expect(toListFilters({ ...HUB_DEFAULTS, status: 'x', state: 'x', sort: 'x' })).toMatchObject({
      status: 'all',
      state: undefined,
      sort: 'created',
    });
    expect(hasActiveFilter(HUB_DEFAULTS)).toBe(false);
    expect(hasActiveFilter({ ...HUB_DEFAULTS, plan: 'pro' })).toBe(true);
    expect(hasActiveFilter({ ...HUB_DEFAULTS, sort: 'name' })).toBe(false);
  });
});

describe('formatting and errors', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const v = (iso: string | null, state: WorkspaceHubRow['validity']['state'] = 'paid_active') => ({
    ...row().validity,
    state,
    trialEndsAt: state === 'free_trial' ? iso : null,
    planEndsAt: state === 'free_trial' ? null : iso,
  });

  it('colours the end date coral within 3 days, amber within 7, and says expired afterwards', () => {
    const at = (days: number) => new Date(now + days * 86_400_000 - 1000).toISOString();
    expect(endsInfo(v(at(3)), now)).toMatchObject({ days: 3, tone: 'danger' });
    expect(endsInfo(v(at(7)), now)).toMatchObject({ days: 7, tone: 'warning' });
    expect(endsInfo(v(at(20)), now)).toMatchObject({ days: 20, tone: 'neutral' });
    expect(endsInfo(v(at(-1)), now)).toMatchObject({ expired: true, tone: 'danger' });
    expect(endsInfo(v(null), now).iso).toBeNull();
    expect(endsInfo(v(at(2), 'free_trial'), now).days).toBe(2);
  });

  it('writes limits with the infinity sign and ages in whole units', () => {
    expect(capText(null, 'en')).toBe('∞');
    expect(capText(1500, 'en')).toBe('1,500');
    expect(agoParts('2026-09-30T23:59:40Z', now)).toEqual({ unit: 'now', count: 0 });
    expect(agoParts('2026-09-30T23:30:00Z', now)).toEqual({ unit: 'minutes', count: 30 });
    expect(agoParts('2026-09-30T20:00:00Z', now)).toEqual({ unit: 'hours', count: 4 });
    expect(agoParts('2026-09-20T00:00:00Z', now)).toEqual({ unit: 'days', count: 11 });
  });

  it('names a failure by its code, never its message', () => {
    expect(
      hubError(new ApiError(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED, 'x', 'req-1')),
    ).toEqual({
      key: 'forbidden',
      requestId: 'req-1',
    });
    expect(hubError(new ApiError(409, ERROR_CODES.ROW_VERSION_CONFLICT, 'whatever')).key).toBe(
      'conflict',
    );
    expect(
      hubError(new ApiError(400, ERROR_CODES.WSP_IMPERSONATION_REASON_REQUIRED, 'x')).key,
    ).toBe('reasonRequired');
    expect(hubError(new ApiError(409, ERROR_CODES.WSP_IMPERSONATION_NO_OWNER, 'x')).key).toBe('noOwner');
    expect(hubError(new ApiError(500, 'SOMETHING', 'Forbidden')).key).toBe('unexpected');
    expect(hubError(new Error('x')).key).toBe('unexpected');
  });
});

describe('menu and redirects', () => {
  it('has one Workspaces entry that replaces the four old lists', () => {
    const ids = OPERATOR_NAV.map((i) => i.id);
    expect(ids.filter((i) => i === 'workspaces')).toHaveLength(1);
    expect(WSHUB_OPERATOR_NAV[0]!.href).toBe('/admin/workspaces');
    for (const old of [
      'wallet-workspaces',
      'workspace-plans',
      'support-customers',
      'wap-assignments',
    ]) {
      expect(ids).not.toContain(old);
    }
    for (const kept of ['wap-switch', 'wap-providers', 'wallet-logs', 'support-inbox']) {
      expect(ids).toContain(kept);
    }
  });

  it('puts Workspaces first in the hub it opens', () => {
    const hub = CONSOLE_LAYOUT.find((h) => h.tabs.includes('workspaces'));
    expect(hub?.tabs[0]).toBe('workspaces');
  });

  it('is found by the words of the pages it replaced', () => {
    const index = buildSearchIndex(
      buildConsoleNav(CONSOLE_NAV_ITEMS),
      (k) => k,
      (id) => CONSOLE_KEYWORDS[id] ?? '',
    );
    for (const phrase of ['wallet workspaces', 'workspace plans', 'customers', 'assignments']) {
      expect(
        searchEntries(index, phrase).map((e) => e.id),
        phrase,
      ).toContain('workspaces');
    }
  });

  it('sends the old list addresses to the hub and keeps a search', () => {
    expect(hubRedirectPath()).toBe('/admin/workspaces');
    expect(hubRedirectPath({ q: ' acme ' })).toBe('/admin/workspaces?q=acme');
    expect(hubRedirectPath({ search: ['a b', 'c'] })).toBe('/admin/workspaces?q=a%20b');
    expect(hubRedirectPath({ q: '   ' })).toBe('/admin/workspaces');
  });
});

describe('messages', () => {
  it('has a label for every column, sort, status, action and health the code names', () => {
    const need = [
      ...WORKSPACE_HUB_COLUMNS.map((c) => `workspaces-hub.list.columns.${c}`),
      'workspaces-hub.list.columns.actions',
      ...['created', 'last_active', 'name'].map((s) => `workspaces-hub.list.sort.${s}`),
      ...['all', 'active', 'suspended'].map((s) => `workspaces-hub.list.status.${s}`),
      ...[
        'dashboard',
        'editPlan',
        'planLimits',
        'provider',
        'impersonate',
        'suspend',
        'unsuspend',
        'denied',
      ].map((a) => `workspaces-hub.actions.${a}`),
      ...['suspended', 'good', 'active', 'low', 'new', 'idle'].map(
        (h) => `workspaces-hub.cell.health.${h}`,
      ),
      ...['override', 'default', 'platform_setting'].map(
        (s) => `workspaces-hub.cell.providerSource.${s}`,
      ),
      ...[
        'unexpected',
        'forbidden',
        'conflict',
        'notFound',
        'reasonRequired',
        'orgSuspended',
        'validation',
      ].map((k) => `workspaces-hub.errors.${k}`),
      ...['overview', 'plan', 'wallet', 'provider', 'support'].map(
        (t) => `workspaces-hub.detail.tabs.${t}`,
      ),
    ];
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });

  it('keeps Arabic keys a subset of English with the same placeholders', () => {
    const vars = (m: string) => [...m.matchAll(/\{\s*(\w+)/g)].map((x) => x[1]).sort();
    for (const [k, v] of Object.entries(ar)) {
      expect(k in en, k).toBe(true);
      expect(vars(v), k).toEqual(vars(en[k]!));
    }
  });
});

const life = (over: Partial<OrgLifecycleResponse> = {}): OrgLifecycleResponse => ({
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Idle Co',
  slug: 'idle-co',
  status: 'active',
  lastActivityAt: '2026-06-01T00:00:00.000Z',
  daysInactive: 120,
  archivedAt: null,
  archiveAfterDays: 90,
  deleteAfterDays: 180,
  archiveOverride: null,
  deleteOverride: null,
  scheduledArchiveAt: '2026-10-20T00:00:00.000Z',
  scheduledDeleteAt: '2027-02-01T00:00:00.000Z',
  retentionExempt: false,
  retentionExemptReason: null,
  retentionExemptUntil: null,
  retentionExemptBy: null,
  legalHold: false,
  exemptByPlan: false,
  remindersSent: { archive: 2, delete: 0 },
  ...over,
});

const none = { view: true, manage: false, legalHold: false };

describe('retention permissions', () => {
  it('reads each key on its own and offers nothing while the map is unknown', () => {
    expect(retentionAccess(undefined)).toEqual({ view: false, manage: false, legalHold: false });
    expect(
      retentionAccess({
        'platform.workspace.view_all': true,
        'platform.workspace.retention': true,
      }),
    ).toEqual({ view: true, manage: true, legalHold: false });
    expect(retentionAccess({ 'platform.workspace.legal_hold': true }).legalHold).toBe(true);
  });

  it('shows only the actions the keys allow, and Restore only for an archived row', () => {
    expect(retentionActions(life(), none)).toEqual([]);
    expect(retentionActions(life(), { ...none, manage: true })).toEqual(['policy', 'exempt']);
    expect(retentionActions(life({ status: 'archived' }), { ...none, manage: true })).toEqual([
      'policy',
      'exempt',
      'restore',
    ]);
    expect(retentionActions(life(), { ...none, legalHold: true })).toEqual(['legalHold']);
  });
});

describe('retention table', () => {
  const render = (rows: OrgLifecycleResponse[], access = none) =>
    wrap(
      <RetentionTable
        rows={rows}
        access={access}
        onAction={() => undefined}
        onHistory={() => undefined}
      />,
    );

  it('renders the columns, reminders and the three badges', () => {
    const html = render([
      life({
        retentionExempt: true,
        retentionExemptReason: 'Key customer',
        legalHold: true,
        exemptByPlan: true,
      }),
    ]);
    for (const k of ['Days inactive', 'Archive on', 'Erase on', 'Reminders sent']) {
      expect(html).toContain(k);
    }
    expect(html).toContain('Archive 2/3');
    expect(html).toContain('Erase 0/3');
    expect(html).toContain('Never delete');
    expect(html).toContain('Key customer');
    expect(html).toContain('Legal hold');
    expect(html).toContain('Paid plan (exempt)');
  });

  it('renders no action menu without a key, and one with it', () => {
    expect(render([life()])).not.toContain('Retention actions for');
    expect(render([life()], { ...none, manage: true })).toContain('Retention actions for Idle Co');
    expect(render([life()])).toContain('History');
  });
});

describe('timings dialog validation', () => {
  const row = life();
  const draft = (p: Partial<ReturnType<typeof policyDraftFor>>) => ({
    ...policyDraftFor(row),
    ...p,
  });
  const custom = (days: string) => ({ mode: 'custom' as const, days });
  const dflt = { mode: 'default' as const, days: '' };

  it('needs a change and a reason', () => {
    expect(checkPolicy(row, draft({ reason: 'long enough' })).errors).toContain('noChange');
    const ok = checkPolicy(row, draft({ archive: custom('100'), reason: 'ok reason' }));
    expect(ok.errors).toEqual([]);
    expect(ok.body).toEqual({ archiveAfterDays: 100, reason: 'ok reason' });
    expect(checkPolicy(row, draft({ archive: custom('100'), reason: 'abc' })).body).toBeNull();
  });

  it('enforces 60 and 120 minimums and the maximums', () => {
    expect(
      checkPolicy(row, draft({ archive: custom('59'), reason: 'ok reason' })).errors,
    ).toContain('archiveMin');
    expect(
      checkPolicy(row, draft({ archive: custom('3651'), reason: 'ok reason' })).errors,
    ).toContain('archiveMax');
    expect(checkPolicy(row, draft({ erase: custom('119'), reason: 'ok reason' })).errors).toContain(
      'eraseMin',
    );
    expect(
      checkPolicy(row, draft({ erase: custom('7301'), reason: 'ok reason' })).errors,
    ).toContain('eraseMax');
    expect(
      checkPolicy(row, draft({ archive: custom('1.5'), reason: 'ok reason' })).errors,
    ).toContain('archiveWhole');
  });

  it('enforces the 60-day gap on effective values, defaults included', () => {
    // archive 150 against the default erase of 180 leaves 30 days
    expect(
      checkPolicy(row, draft({ archive: custom('150'), reason: 'ok reason' })).errors,
    ).toContain('gap');
    expect(
      checkPolicy(row, draft({ archive: custom('120'), erase: custom('180'), reason: 'ok reason' }))
        .errors,
    ).toEqual([]);
    expect(
      checkPolicy(row, draft({ archive: custom('100'), erase: custom('150'), reason: 'ok reason' }))
        .errors,
    ).toContain('gap');
  });

  it('sends null to go back to the platform default', () => {
    const withOverride = life({ archiveOverride: 100, deleteOverride: 200 });
    const r = checkPolicy(withOverride, {
      archive: dflt,
      erase: { mode: 'custom', days: '200' },
      reason: 'back to default',
    });
    expect(r.body).toEqual({ archiveAfterDays: null, reason: 'back to default' });
  });
});

describe('never delete, reasons and filters', () => {
  it('needs a 5 to 500 character reason', () => {
    expect(reasonError('abcd')).toBe('reasonShort');
    expect(reasonError('    a   ')).toBe('reasonShort');
    expect(reasonError('x'.repeat(501))).toBe('reasonLong');
    expect(reasonError('valid')).toBeNull();
  });

  it('builds the on and off bodies and rejects an expiry in the past', () => {
    const now = Date.parse('2026-10-11T00:00:00Z');
    expect(checkExempt(true, 'key account', '', now).body).toEqual({
      exempt: true,
      reason: 'key account',
    });
    expect(checkExempt(true, 'key account', '2026-12-31', now).body).toEqual({
      exempt: true,
      reason: 'key account',
      until: untilIso('2026-12-31'),
    });
    expect(checkExempt(true, 'key account', '2026-01-01', now)).toMatchObject({
      until: 'untilPast',
      body: null,
    });
    expect(checkExempt(false, 'review done', '2026-01-01', now).body).toEqual({
      exempt: false,
      reason: 'review done',
    });
    expect(checkExempt(false, 'no', '', now).body).toBeNull();
  });

  it('turns the address into a list query and drops unknown values', () => {
    expect(toLifecycleFilters({ status: 'archived', min: '30', exempt: 'true' })).toEqual({
      status: 'archived',
      minDaysInactive: 30,
      exempt: 'true',
    });
    expect(toLifecycleFilters({ status: 'weird', min: '-3', exempt: '' })).toEqual({
      status: undefined,
      minDaysInactive: undefined,
      exempt: undefined,
    });
    expect(hasRetentionFilter({ status: '', min: '', exempt: '' })).toBe(false);
    expect(hasRetentionFilter({ status: '', min: '5', exempt: '' })).toBe(true);
  });
});

describe('retention errors and history', () => {
  it('maps a problem+json code to the inline message key', () => {
    expect(
      hubError(new ApiError(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED, 'x')).key,
    ).toBe('forbidden');
    expect(hubError(new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x')).key).toBe('validation');
  });

  it('shows the reason only when the log details carry a text one', () => {
    const e = (details: Record<string, unknown>): Pick<OrgLifecycleLogEntry, 'details'> => ({
      details,
    });
    expect(detailReason(e({ reason: 'legal request' }))).toBe('legal request');
    expect(detailReason(e({ reason: 5 }))).toBeNull();
    expect(detailReason(e({}))).toBeNull();
  });

  it('has every retention message the code names', () => {
    const need = [
      'retention.title',
      'retention.status.archived',
      'retention.badge.paidPlan',
      'retention.actions.holdOff',
      'retention.event.reminder_sent',
      'retention.dialog.errors.gap',
      'retention.dialog.policyConfirm',
      'list.retentionLink',
    ].map((k) => `workspaces-hub.${k}`);
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });
});
