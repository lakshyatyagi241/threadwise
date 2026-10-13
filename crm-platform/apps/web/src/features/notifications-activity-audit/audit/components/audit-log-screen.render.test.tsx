// @vitest-environment jsdom
import type { AuditLogDetail, AuditLogEntry } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, choose, click, mount, text, type Mounted } from '../../testing';

const state = vi.hoisted(() => ({
  can: { 'audit.log.read': true, 'audit.log.export': true } as Record<string, boolean>,
  search: '',
  replace: vi.fn(),
  entries: {
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    hasNextPage: false,
  } as Record<string, unknown>,
  refetch: vi.fn(),
  fetchNext: vi.fn(),
  detail: { isPending: false, isError: false, data: undefined } as Record<string, unknown>,
  exportList: { isPending: false, isError: false, data: { data: [] } } as Record<string, unknown>,
  settings: { data: { retentionDays: 365, canExport: true, canReveal: false } } as Record<
    string,
    unknown
  >,
  requestExport: vi.fn(),
  lastFilters: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  usePathname: () => '/activity-log',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (k: string) => state.can[k] === true,
  useSession: () => ({ effectiveTimezone: 'Asia/Kolkata' }),
}));
vi.mock('../api/hooks', () => ({
  useAuditEntries: (filters: unknown) => {
    state.lastFilters = filters;
    return {
      ...state.entries,
      refetch: state.refetch,
      fetchNextPage: state.fetchNext,
      isFetchingNextPage: false,
    };
  },
  useAuditFacets: () => ({
    data: {
      modules: ['contacts', 'tags', 'some_new_module'],
      actions: ['insert', 'update', 'weird'],
      actors: [{ id: '3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11', name: 'Sara Ali' }],
    },
  }),
  useAuditSettings: () => state.settings,
  useAuditEntry: () => state.detail,
  useAuditExports: () => state.exportList,
  useRequestExport: () => ({ mutate: state.requestExport, isPending: false, isError: false }),
}));

import { AuditLogScreen } from './audit-log-screen';

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 'e1',
  at: '2026-10-13T09:30:00.000Z',
  actor: { kind: 'user', id: '3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11', name: 'Sara Ali' },
  module: 'contacts',
  action: 'update',
  recordId: '42',
  record: { href: '/contacts/abc' },
  requestId: 'req-abc-123',
  actAs: null,
  changedFields: ['phone', 'email', 'stage', 'notes'],
  ...over,
});
const page = (rows: AuditLogEntry[]) => ({ pages: [{ data: rows }] });

let m: Mounted | undefined;
beforeEach(() => {
  state.can = { 'audit.log.read': true, 'audit.log.export': true };
  state.search = '';
  state.replace = vi.fn();
  state.entries = {
    isPending: false,
    isError: false,
    error: null,
    data: page([entry()]),
    hasNextPage: false,
  };
  state.detail = { isPending: false, isError: false, data: undefined };
  state.exportList = { isPending: false, isError: false, data: { data: [] } };
  state.settings = { data: { retentionDays: 365, canExport: true, canReveal: false } };
  state.requestExport = vi.fn();
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
  document.body.innerHTML = '';
});

describe('access', () => {
  it('shows a plain "no access" panel and loads nothing without audit.log.read', async () => {
    state.can = {};
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).toContain(text('audit-log.forbidden.title'));
    expect(m.host.querySelector('table')).toBeNull();
  });
});

describe('states', () => {
  it('loading', async () => {
    state.entries = { isPending: true, isError: false, data: undefined };
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).toContain(text('audit-log.states.loading'));
    expect(m.host.querySelector('table')).toBeNull();
  });

  it('error, with a retry that asks again', async () => {
    state.entries = { isPending: false, isError: true, error: new Error('x'), data: undefined };
    m = await mount(<AuditLogScreen />);
    expect(m.host.querySelector('[data-testid="audit-error"]')?.textContent).toContain(
      text('audit-log.errors.network'),
    );
    await click(button(m.host, text('audit-log.states.retry')));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('empty with no filters', async () => {
    state.entries = { isPending: false, isError: false, data: page([]), hasNextPage: false };
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).toContain(text('audit-log.states.empty'));
    expect(m.host.textContent).not.toContain(text('audit-log.states.emptyFiltered'));
  });

  it('empty with a filter offers Reset, which clears the URL', async () => {
    state.search = 'module=contacts';
    state.entries = { isPending: false, isError: false, data: page([]), hasNextPage: false };
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).toContain(text('audit-log.states.emptyFiltered'));
    const resets = [...m.host.querySelectorAll('button')].filter(
      (b) => b.textContent === text('audit-log.filters.reset'),
    );
    expect(resets.length).toBeGreaterThan(0);
    await click(resets[resets.length - 1]!);
    expect(state.replace).toHaveBeenCalledWith('/activity-log', { scroll: false });
  });

  it('says how many are loaded and offers Load more while there is a next page', async () => {
    state.entries = {
      isPending: false,
      isError: false,
      data: page([entry(), entry({ id: 'e2' })]),
      hasNextPage: true,
    };
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).toContain('2 entries loaded');
    await click(button(m.host, text('audit-log.states.loadMore')));
    expect(state.fetchNext).toHaveBeenCalledTimes(1);
  });
});

describe('the table', () => {
  it('shows who, what, the record link, the request and the field names (never values)', async () => {
    m = await mount(<AuditLogScreen />);
    const row = m.host.querySelector('[data-testid="audit-row"]')!;
    expect(row.textContent).toContain('Sara Ali');
    expect(row.textContent).toContain(text('audit-log.actions.update'));
    expect(row.textContent).toContain(text('audit-log.modules.contacts'));
    expect(row.textContent).toContain('req-abc-123');
    expect(row.textContent).toContain('phone, email, stage');
    expect(row.textContent).toContain('+1');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/contacts/abc');
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-13T09:30:00.000Z');
    expect(m.host.textContent).toContain(
      text('audit-log.table.zone').replace('{zone}', 'Asia/Kolkata'),
    );
  });

  it('flags a platform support row and says whose account it acted as', async () => {
    state.entries = {
      isPending: false,
      isError: false,
      hasNextPage: false,
      data: page([entry({ actAs: { reason: 'Ticket 1', readOnly: false, startedAt: null } })]),
    };
    m = await mount(<AuditLogScreen />);
    const row = m.host.querySelector('[data-testid="audit-row"]')!;
    expect(row.textContent).toContain(text('audit-log.actors.support'));
    expect(row.textContent).toContain('acting as Sara Ali');
  });

  it('names system and API key actors, and a record with no screen is plain text', async () => {
    state.entries = {
      isPending: false,
      isError: false,
      hasNextPage: false,
      data: page([
        entry({ id: 'a', actor: { kind: 'system', id: null, name: null }, record: { href: null } }),
        entry({ id: 'b', actor: { kind: 'api_key', id: null, name: 'Zapier' } }),
      ]),
    };
    m = await mount(<AuditLogScreen />);
    const rows = m.host.querySelectorAll('[data-testid="audit-row"]');
    expect(rows[0]!.textContent).toContain('System');
    expect(rows[0]!.querySelector('a')).toBeNull();
    expect(rows[1]!.textContent).toContain('API key: Zapier');
  });

  it('opens an entry by writing it into the URL', async () => {
    m = await mount(<AuditLogScreen />);
    await click(
      button(m.host, text('audit-log.table.openDetails').replace('{what}', 'Updated Contacts')),
    );
    expect(state.replace).toHaveBeenCalledWith('/activity-log?entry=e1', { scroll: false });
  });
});

describe('filters', () => {
  it('write to the URL and send the same filters to the API', async () => {
    state.search = 'module=contacts&actAs=1&range=30d';
    m = await mount(<AuditLogScreen />);
    const f = state.lastFilters as Record<string, unknown>;
    expect(f).toMatchObject({ module: 'contacts', actAs: true });
    expect(typeof f.from).toBe('string');

    await choose(m.host.querySelector<HTMLSelectElement>('#audit-action')!, 'update');
    expect(state.replace).toHaveBeenLastCalledWith(
      '/activity-log?range=30d&module=contacts&action=update&actAs=1',
      { scroll: false },
    );
  });

  it('offers the people, areas and actions that exist, and an area this build has no word for as it is', async () => {
    m = await mount(<AuditLogScreen />);
    const options = (id: string) =>
      [...m!.host.querySelectorAll(`#${id} option`)].map((o) => o.textContent);
    expect(options('audit-actor')).toEqual([text('audit-log.filters.allActors'), 'Sara Ali']);
    expect(options('audit-module')).toContain('some_new_module');
    expect(options('audit-module')).toContain(text('audit-log.modules.contacts'));
    expect(options('audit-action')).toContain('weird');
  });

  it('shows the custom dates only for a custom range', async () => {
    m = await mount(<AuditLogScreen />);
    expect(m.host.querySelector('#audit-from')).toBeNull();
    await m.unmount();
    state.search = 'range=custom&from=2026-09-01&to=2026-09-30';
    m = await mount(<AuditLogScreen />);
    expect(m.host.querySelector<HTMLInputElement>('#audit-from')?.value).toBe('2026-09-01');
  });
});

describe('retention note', () => {
  it.each([
    [365, 'Entries are kept for 365 days'],
    [1, 'Entries are kept for 1 day,'],
    [0, 'without an end date'],
  ])('%s days', async (days, expected) => {
    state.settings = { data: { retentionDays: days, canExport: true, canReveal: false } };
    m = await mount(<AuditLogScreen />);
    expect(m.host.querySelector('[data-testid="audit-retention"]')?.textContent).toContain(
      expected,
    );
  });
  it('a neutral note when the policy cannot be read', async () => {
    state.settings = { data: { retentionDays: null, canExport: true, canReveal: false } };
    m = await mount(<AuditLogScreen />);
    expect(m.host.querySelector('[data-testid="audit-retention"]')?.textContent).toBe(
      text('audit-log.retention.unknown'),
    );
  });
});

describe('export', () => {
  it('is hidden without audit.log.export', async () => {
    state.can = { 'audit.log.read': true };
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).not.toContain(text('audit-log.export.button'));
  });

  it('sends the current filters, without a cursor', async () => {
    state.search = 'module=contacts';
    m = await mount(<AuditLogScreen />);
    await click(button(m.host, text('audit-log.export.button')));
    expect(state.requestExport).toHaveBeenCalledTimes(1);
    expect(state.requestExport.mock.calls[0]![0]).toMatchObject({ module: 'contacts' });
    expect(JSON.stringify(state.requestExport.mock.calls[0]![0])).not.toContain('cursor');
  });

  it('lists the files with their status and a download link for a ready one', async () => {
    state.exportList = {
      isPending: false,
      isError: false,
      data: {
        data: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            status: 'ready',
            rowCount: 1200,
            fileBytes: 10,
            error: null,
            requestedAt: '2026-10-13T08:00:00.000Z',
            completedAt: '2026-10-13T08:01:00.000Z',
            expiresAt: '2026-10-20T08:01:00.000Z',
            emailedTo: 'a@example.com',
            filters: {},
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            status: 'failed',
            rowCount: null,
            fileBytes: null,
            error: 'x',
            requestedAt: '2026-10-12T08:00:00.000Z',
            completedAt: null,
            expiresAt: null,
            emailedTo: null,
            filters: {},
          },
        ],
      },
    };
    m = await mount(<AuditLogScreen />);
    const rows = m.host.querySelectorAll('[data-testid="audit-exports"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(text('audit-log.export.status.ready'));
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe(
      '/api/v2/audit-log/exports/11111111-1111-4111-8111-111111111111/download',
    );
    expect(rows[1]!.textContent).toContain(text('audit-log.export.status.failed'));
    expect(rows[1]!.querySelector('a')).toBeNull();
  });
});

describe('the entry panel', () => {
  const detail = (over: Partial<AuditLogDetail> = {}): AuditLogDetail => ({
    ...entry(),
    delta: {
      phone: { old: '+91 ******210', new: '+97 ******567', masked: true },
      stage: { old: 'new', new: 'won', masked: false },
      smtp_password: { old: '[REDACTED]', new: '[REDACTED]', masked: true },
    },
    canReveal: false,
    ...over,
  });

  it('shows the masked changes old to new, a secret as hidden, and the masking note', async () => {
    state.search = 'entry=e1';
    state.detail = { isPending: false, isError: false, data: detail() };
    m = await mount(<AuditLogScreen />);
    const rows = [...m.host.querySelectorAll('[data-testid="audit-change"]')];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('+91 ******210');
    expect(rows[0]!.textContent).toContain('+97 ******567');
    expect(rows[1]!.textContent).toContain('won');
    expect(rows[2]!.textContent).toContain(text('audit-log.detail.secret'));
    expect(rows[2]!.textContent).not.toContain('REDACTED');
    expect(m.host.querySelector('[data-testid="audit-masked-note"]')?.textContent).toBe(
      text('audit-log.detail.maskedNote'),
    );
    expect(m.host.textContent).toContain(text('audit-log.detail.audited'));
  });

  it('says only secrets are hidden for the Owner', async () => {
    state.search = 'entry=e1';
    state.detail = { isPending: false, isError: false, data: detail({ canReveal: true }) };
    m = await mount(<AuditLogScreen />);
    expect(m.host.querySelector('[data-testid="audit-masked-note"]')?.textContent).toBe(
      text('audit-log.detail.maskedNoteOwner'),
    );
  });

  it('explains a platform support session with its reason', async () => {
    state.search = 'entry=e1';
    state.detail = {
      isPending: false,
      isError: false,
      data: detail({
        actAs: { reason: 'Ticket 4411: help with the import', readOnly: true, startedAt: null },
      }),
    };
    m = await mount(<AuditLogScreen />);
    const note = m.host.querySelector('[data-testid="audit-support-note"]')!;
    expect(note.textContent).toContain('Sara Ali');
    expect(note.textContent).toContain('Ticket 4411: help with the import');
    expect(note.textContent).toContain(text('audit-log.detail.supportReadOnly'));
  });

  it('an entry that is gone, or a failure, shows an error', async () => {
    state.search = 'entry=e1';
    state.detail = { isPending: false, isError: true, error: new Error('x'), data: undefined };
    m = await mount(<AuditLogScreen />);
    expect(m.host.textContent).toContain(text('audit-log.errors.network'));
  });

  it('closing writes the URL without the entry', async () => {
    state.search = 'module=contacts&entry=e1';
    state.detail = { isPending: false, isError: false, data: detail() };
    m = await mount(<AuditLogScreen />);
    await click(
      m.host.querySelector<HTMLButtonElement>(
        `button[aria-label="${text('audit-log.common.close')}"]`,
      )!,
    );
    expect(state.replace).toHaveBeenCalledWith('/activity-log?module=contacts', { scroll: false });
  });
});

describe('Arabic', () => {
  it('is worded in Arabic with no message key showing', async () => {
    m = await mount(<AuditLogScreen />, { locale: 'ar' });
    expect(m.host.textContent).toContain(text('audit-log.title', 'ar'));
    expect(m.host.textContent).toContain(text('audit-log.table.time', 'ar'));
    expect(m.host.textContent).not.toMatch(/audit-log\.[a-z]/);
    expect(text('audit-log.title', 'ar')).not.toBe(text('audit-log.title', 'en'));
  });
});
