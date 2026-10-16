import { describe, expect, it, vi } from 'vitest';
import type {
  LeadInboxDetailResponse,
  LeadInboxItem,
  LeadPullSource,
  LeadSyncRun,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { leadKeys } from '../api';
import { opsKeys } from '../api-ops';
import { DEFAULT_INBOX_FILTERS, filterKey } from '../lib/inbox-view';
import { ID, event, source } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/lead-sources',
  useSearchParams: () => new URLSearchParams(),
}));

import { InboxDrawer } from './inbox-drawer';
import { LeadInboxTab, RetryResult } from './lead-inbox-tab';
import { RunLine } from './pull-panel';

/**
 * The lead inbox rendered to static HTML with the real English and Arabic messages: complete text (a missing message throws), what a
 * role may do (a reader sees no checkbox, no Retry, no Open, no Sync now), the states, and that a masked payload is shown as the server
 * sent it. There is no browser here: nothing below says how the screens behave when clicked.
 */

const LOCALES = ['en', 'ar'] as const;
const READ = { 'leads.sources.read': 'all' } as const;
const MANAGE = { ...READ, 'leads.sources.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const item = (n: number, patch: Partial<LeadInboxItem> = {}): LeadInboxItem => ({
  ...event({
    id: ID(100 + n),
    externalId: `lead-${n}`,
    status: 'needs_review',
    reason: 'invalid_phone',
    contactId: null,
  }),
  sourceName: n % 2 ? 'Landing page form' : 'IndiaMART',
  sourceKind: n % 2 ? 'webhook' : 'connector',
  sourceStatus: 'active',
  retryable: true,
  ...patch,
});

const items = [
  item(1),
  item(2, { status: 'failed', reason: 'internal_error', error: 'INTERNAL: boom' }),
  item(3, { status: 'created', reason: null, retryable: false, contactId: ID(200) }),
  item(4, {
    status: 'needs_review',
    retryable: false,
    sourceStatus: 'paused',
    firstReply: null,
  }),
];

const page = (data: LeadInboxItem[]) => ({
  pages: [{ data, page: { nextCursor: null, hasMore: false, limit: 25 } }],
  pageParams: [undefined],
});
const KEY = filterKey(DEFAULT_INBOX_FILTERS);
const counts = {
  counts: { received: 0, created: 7, updated: 1, duplicate: 2, needs_review: 3, failed: 1 },
  attention: 4,
  total: 14,
  from: '2026-09-16T00:00:00.000Z',
  to: null,
};
const run = (patch: Partial<LeadSyncRun> = {}): LeadSyncRun => ({
  id: ID(900),
  sourceId: ID(2),
  sourceName: 'IndiaMART',
  kind: 'backfill',
  status: 'running',
  rangeFrom: '2026-10-01T00:00:00.000Z',
  rangeTo: '2026-10-05T00:00:00.000Z',
  fetched: 6,
  accepted: 4,
  duplicates: 2,
  failed: 0,
  windowsDone: 1,
  windowsTotal: 4,
  error: null,
  requestedAt: '2026-10-16T10:00:00.000Z',
  startedAt: '2026-10-16T10:00:05.000Z',
  finishedAt: null,
  ...patch,
});
const pull = (patch: Partial<LeadPullSource> = {}): LeadPullSource => ({
  sourceId: ID(2),
  sourceName: 'IndiaMART',
  sourceKind: 'connector',
  sourceStatus: 'active',
  canSync: true,
  canBackfill: true,
  minIntervalSeconds: 300,
  maxBackfillDays: 30,
  nextSyncAt: null,
  activeRun: null,
  lastRun: null,
  ...patch,
});

const seedsFor = (
  opts: { items?: LeadInboxItem[]; pull?: LeadPullSource[]; runs?: LeadSyncRun[] } = {},
) => [
  [
    leadKeys.list,
    {
      data: [
        source({ id: ID(1), name: 'Landing page form' }),
        source({ id: ID(2), name: 'IndiaMART', kind: 'connector' }),
      ],
      hookAddress: { baseUrl: 'https://api.acme.test', problem: null },
    },
  ] as const,
  [opsKeys.summary(KEY), counts] as const,
  [opsKeys.list(KEY), page(opts.items ?? items)] as const,
  [opsKeys.pullSources, { data: opts.pull ?? [] }] as const,
  [opsKeys.runs, { data: opts.runs ?? [] }] as const,
];

const tab = (
  perms: Record<string, 'all'>,
  opts: Parameters<typeof seedsFor>[0] = {},
  locale: 'en' | 'ar' = 'en',
) =>
  renderAccount(
    <ToastProvider>
      <LeadInboxTab can={{ read: true, manage: Boolean(perms['leads.sources.manage']) }} />
    </ToastProvider>,
    { locale, ...as(perms), seed: seedsFor(opts) as never },
  );

describe('the lead inbox', () => {
  for (const locale of LOCALES) {
    it(`lists every source's leads with their status, reason and counts in ${locale}`, () => {
      const out = tab(MANAGE, {}, locale);
      expect(out).toContain('data-testid="lead-inbox"');
      expect(out.match(/data-testid="inbox-row"/g)).toHaveLength(4);
      for (const chip of [
        'all',
        'attention',
        'needs_review',
        'failed',
        'created',
        'updated',
        'duplicate',
      ]) {
        expect(out).toContain(`data-testid="chip-${chip}"`);
      }
      expect(out).toContain('Landing page form');
      expect(out).toContain('IndiaMART');
      expect(out).toContain('lead-1');
    });
  }

  it('shows each chip its count and marks the one that is on', () => {
    const out = tab(MANAGE);
    expect(out).toMatch(/data-testid="chip-attention"[^>]*>[^<]*Needs attention[^<]*<span[^>]*>4</);
    expect(out).toMatch(
      /aria-pressed="true"[^>]*data-testid="chip-attention"|data-testid="chip-attention"[^>]*aria-pressed="true"/,
    );
    expect(out).toMatch(/data-testid="chip-all"[^>]*>[^<]*All[^<]*<span[^>]*>14</);
  });

  it('a manager can select, retry and open only the leads that can be retried', () => {
    const out = tab(MANAGE);
    expect(out).toContain('data-testid="bulk-bar"');
    // two of the four rows can be retried: two checkboxes and, with the select-all box, three in the table and bar
    expect(out.match(/aria-label="Select lead lead-/g)).toHaveLength(2);
    expect(out).toContain('Retry selected');
    expect(out).toContain('Up to 100 at a time.');
    expect((out.match(/>Retry</g) ?? []).length).toBe(2);
    expect((out.match(/>Open</g) ?? []).length).toBe(4);
  });

  it('a reader sees the leads but cannot select, retry, open or pull', () => {
    const out = tab(READ, { pull: [pull()] });
    expect(out.match(/data-testid="inbox-row"/g)).toHaveLength(4);
    expect(out).not.toContain('data-testid="bulk-bar"');
    expect(out).not.toContain('Select lead');
    expect(out).not.toContain('>Retry<');
    expect(out).not.toContain('>Open<');
    expect(out).not.toContain('>Sync now<');
    expect(out).not.toContain('Backfill...');
  });

  it('says that nothing waits when nothing does, and offers the whole list', () => {
    const out = tab(MANAGE, { items: [] });
    expect(out).toContain('Nothing waits for you');
    expect(out).toContain('Show everything');
    expect(out).not.toContain('data-testid="inbox-row"');
  });

  it('marks a test lead, and shows a lead of a paused source as not retryable', () => {
    const out = tab(MANAGE, { items: [item(5, { isTest: true, retryable: false })] });
    expect(out).toContain('>Test<');
    expect(out).not.toContain('Select lead');
  });

  it('the filters offer the sources, the reasons, the time and the test leads', () => {
    const out = tab(MANAGE);
    for (const id of ['li-source', 'li-reason', 'li-range', 'li-tests', 'li-q']) {
      expect(out).toContain(`id="${id}"`);
    }
    expect(out).toContain('Last 7 days');
    expect(out).toContain('Only test leads');
    // a custom range asks for its two days; only then
    expect(out).not.toContain('id="li-from"');
  });
});

describe('sync and backfill', () => {
  it('is not there when no source can be pulled', () => {
    expect(tab(MANAGE, { pull: [] })).not.toContain('data-testid="pull-panel"');
  });

  it('lists the sources that can be pulled with Sync now, the rate limit, and a Backfill button for a manager', () => {
    const out = tab(MANAGE, { pull: [pull()] });
    expect(out).toContain('data-testid="pull-panel"');
    expect(out).toContain('>Sync now<');
    expect(out).toContain('At least 300 seconds between requests');
    expect(out).toContain('Backfill reaches back 30 days');
    expect(out).toContain('Backfill...');
    expect(out).toContain('Not pulled yet.');
  });

  it('shows the progress of a run that is going, and disables Sync now while it does', () => {
    const active = run();
    const out = tab(MANAGE, { pull: [pull({ activeRun: active })] });
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="25"');
    expect(out).toContain('6 fetched, 4 new, 2 already known, 0 not handed over');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>(<[^>]*>)*\s*Sync now/);
  });

  it('a source that cannot backfill has no Backfill button, a paused one cannot be synced', () => {
    const noBackfill = tab(MANAGE, { pull: [pull({ canBackfill: false, maxBackfillDays: null })] });
    expect(noBackfill).not.toContain('Backfill...');
    const paused = tab(MANAGE, { pull: [pull({ sourceStatus: 'paused' })] });
    expect(paused).toContain('This source is paused');
  });

  for (const locale of LOCALES) {
    it(`has text for every state of a run in ${locale}`, () => {
      for (const status of ['queued', 'running', 'done', 'partial', 'failed'] as const) {
        for (const kind of ['sync', 'backfill'] as const) {
          expect(() =>
            renderAccount(
              <RunLine
                run={run({
                  status,
                  kind,
                  error: status === 'failed' ? 'credentials_refused' : null,
                })}
                withSource
              />,
              { locale },
            ),
          ).not.toThrow();
        }
      }
    });
  }

  it('says why a run stopped in words, and shows no code it does not know', () => {
    const known = renderAccount(
      <RunLine run={run({ status: 'failed', error: 'credentials_refused' })} />,
    );
    expect(known).toContain('The source refused the credentials');
    const unknown = renderAccount(
      <RunLine run={run({ status: 'failed', error: 'portal said no' })} />,
    );
    expect(unknown).not.toContain('portal said no');
  });
});

describe('the result of a retry', () => {
  for (const locale of LOCALES) {
    it(`has text for every outcome in ${locale}`, () => {
      const summary = {
        retried: 3,
        fixed: 2,
        stillWaiting: 1,
        skipped: { not_found: 1, not_retryable: 2, payload_purged: 1, source_paused: 1, error: 1 },
      };
      expect(() => renderAccount(<RetryResult summary={summary} />, { locale })).not.toThrow();
    });
  }

  it('is a success when everything became a contact, a warning when something did not', () => {
    const ok = renderAccount(
      <RetryResult summary={{ retried: 2, fixed: 2, stillWaiting: 0, skipped: {} }} />,
    );
    expect(ok).toContain('2 leads were retried.');
    expect(ok).toContain('2 became contacts.');
    const warn = renderAccount(
      <RetryResult
        summary={{ retried: 1, fixed: 0, stillWaiting: 1, skipped: { not_retryable: 1 } }}
      />,
    );
    expect(warn).toContain('1 still needs review.');
    expect(warn).toContain('1 lead is not waiting any more.');
  });
});

describe('the lead panel', () => {
  const detail = (patch: Partial<LeadInboxDetailResponse> = {}): LeadInboxDetailResponse => ({
    ...item(1),
    payload: { fields: { 'lead.mobile': '+91 ******210', 'lead.email': 'a***@example.test' } },
    payloadMasked: true,
    ...patch,
  });
  const drawer = (
    d: LeadInboxDetailResponse,
    perms: Record<string, 'all'> = MANAGE,
    locale: 'en' | 'ar' = 'en',
  ) =>
    renderAccount(
      <InboxDrawer
        item={item(1)}
        canManage
        onClose={() => undefined}
        onRetried={() => undefined}
      />,
      { locale, ...as(perms), seed: [[opsKeys.item(ID(101)), d]] as never },
    );

  for (const locale of LOCALES) {
    it(`shows the masked payload as the server sent it, and says it is masked in ${locale}`, () => {
      const out = drawer(detail(), MANAGE, locale);
      expect(out).toContain('data-testid="inbox-payload"');
      expect(out).toContain('+91 ******210');
      expect(out).toContain('a***@example.test');
      expect(out).toContain('data-testid="payload-note"');
    });
  }

  it('offers the original only through its own audited route, and Retry only for a lead that can be retried', () => {
    const out = drawer(detail());
    expect(out).toContain('Show the original');
    expect(out).toContain(
      'Phone numbers, email addresses, names, addresses and free text are hidden',
    );
    expect(out).toContain('>Retry<');
    const done = drawer(detail({ retryable: false, status: 'created' }));
    expect(done).not.toContain('>Retry<');
  });

  it('a payload that was deleted says so and offers nothing to show', () => {
    const out = drawer(
      detail({ payload: null, payloadMasked: false, hasPayload: false, retryable: false }),
    );
    expect(out).toContain('data-testid="payload-purged"');
    expect(out).not.toContain('Show the original');
    expect(out).not.toContain('data-testid="inbox-payload"');
  });

  it('says there was nothing to hide when there was not', () => {
    const out = drawer(
      detail({ payloadMasked: false, payload: { fields: { campaign: 'Spring' } } }),
    );
    expect(out).toContain('There is nothing personal to hide in this lead.');
  });

  it('shows where the first message stands', () => {
    const out = drawer(
      detail({
        firstReply: {
          channel: 'email',
          status: 'blocked',
          reason: 'no_consent',
          dueAt: '2026-10-16T10:00:00.000Z',
          sentAt: null,
          attempts: 1,
        },
      }),
    );
    expect(out).toContain('data-testid="first-reply"');
    expect(out).toContain('No recorded consent');
  });
});
