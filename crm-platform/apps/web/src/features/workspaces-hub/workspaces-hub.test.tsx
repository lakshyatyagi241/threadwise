import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceHubRow } from '@crm/contracts';
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
import { hubAccess } from './lib/permissions';
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
