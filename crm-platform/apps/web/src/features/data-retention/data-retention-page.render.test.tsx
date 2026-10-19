import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RETENTION_ITEMS, type RetentionItemView, type RetentionOverview } from '@crm/contracts';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { DataRetentionPage, engineBanner } from './data-retention-page';
import { DATA_RETENTION_QUERY_KEY } from './queries';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/data-retention',
  useSearchParams: () => new URLSearchParams(),
}));

const item = (
  id: RetentionItemView['id'],
  over: Partial<RetentionItemView> = {},
): RetentionItemView => {
  const spec = RETENTION_ITEMS.find((i) => i.id === id)!;
  return {
    id,
    kind: spec.kind,
    group: spec.group,
    canArchive: spec.canArchive,
    source: 'default',
    liveDays: spec.defaults.liveDays,
    archiveDays: spec.defaults.archiveDays,
    deleteAfterDays: null,
    defaults: spec.defaults,
    limits: { live: spec.live, archive: spec.archive },
    rowVersion: null,
    updatedAt: null,
    applied: true,
    live: { bytes: 2_621_440, rows: 12_345, partitions: 4, oldestMonth: '2026-08' },
    archive: null,
    lastRun: null,
    ...over,
  };
};

const overview = (
  engine: Partial<RetentionOverview['engine']> = {},
  items: RetentionItemView[] = RETENTION_ITEMS.map((i) => item(i.id)),
): RetentionOverview => ({
  engine: { enabled: false, dryRun: true, archiveDriver: 'local', archiveDurable: true, ...engine },
  items,
});

const page = (
  data: RetentionOverview,
  locale: 'en' | 'ar' = 'en',
  role?: 'super_admin' | 'admin',
) =>
  renderWithMessages(createElement(DataRetentionPage), {
    locale,
    ...(role ? { role: role as never } : {}),
    seed: [[DATA_RETENTION_QUERY_KEY, data]],
  });

describe('engineBanner', () => {
  it('tells which state the archive job is in', () => {
    const e = (over: Partial<RetentionOverview['engine']>) => overview(over).engine;
    expect(engineBanner(e({}))).toBe('off');
    expect(engineBanner(e({ enabled: true }))).toBe('dryRun');
    expect(engineBanner(e({ enabled: true, dryRun: false }))).toBe('live');
    expect(engineBanner(e({ enabled: true, dryRun: false, archiveDurable: false }))).toBe(
      'notDurable',
    );
    // A dry run never drops anything, so a non-durable archive is not a problem yet.
    expect(engineBanner(e({ enabled: true, dryRun: true, archiveDurable: false }))).toBe('dryRun');
  });
});

describe.each(['en', 'ar'] as const)('Data retention page (%s)', (locale) => {
  it('lists every data item with its two numbers and what they mean', () => {
    const html = page(overview(), locale);
    for (const spec of RETENTION_ITEMS)
      expect(html).toContain(`data-testid="retention-${spec.id}"`);
    // Items that can be archived have an archive field and the "for ever" switch; the others do not.
    const archivable = RETENTION_ITEMS.filter((i) => i.canArchive).length;
    expect(html.match(/type="number"/g)).toHaveLength(RETENTION_ITEMS.length + archivable);
    expect(html).toContain('data-testid="retention-deleted-an_events"');
  });

  it('covers every item the platform deletes on a schedule, in both kinds of retention', () => {
    const ids = RETENTION_ITEMS.map((i) => i.id);
    for (const id of [
      'an_events',
      'audit_log',
      'security_events',
      'audit_log_exports',
      'message_log',
      'notifications_read',
      'notifications_unread',
      'push_devices_revoked',
      'faq_match_log',
      'assignment_runs',
      'form_events',
      'lead_sync_runs',
      'lead_scoring_runs',
      'api_library_logs',
      'flow_run_logs',
      'webhook_forward_failures',
      'click_calls',
      'call_recordings',
    ] as const) {
      expect(ids).toContain(id);
    }
    // Database cleanup (days in the database) and archival (days in the archive) are both editable.
    expect(RETENTION_ITEMS.some((i) => i.canArchive && i.kind === 'partitioned')).toBe(true);
    expect(RETENTION_ITEMS.some((i) => i.canArchive && i.kind === 'daily_archive')).toBe(true);
  });

  it('shows every item as one editable row of a single table', () => {
    const html = page(
      overview({}, [
        item('an_events', { source: 'custom', liveDays: 30, archiveDays: 120, rowVersion: 1 }),
        item('faq_match_log'),
        item('audit_log', { liveDays: 365, archiveDays: null }),
      ]),
      locale,
    );
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('data-testid="retention-input-live-an_events"');
    expect(html).toContain('data-testid="retention-input-archive-an_events"');
    // A table that cannot be archived has no archive field.
    expect(html).not.toContain('data-testid="retention-input-archive-faq_match_log"');
    // 30 days live + 120 archived = deleted for good after 150 days; a database-only item is deleted after its live days.
    expect(html).toMatch(/retention-deleted-an_events"[^>]*>[^<]*150/);
    expect(html).toMatch(/retention-deleted-faq_match_log"[^>]*>[^<]*90/);
    // An archive kept for ever is never deleted.
    expect(html).toMatch(/retention-deleted-audit_log"[^>]*>(?!\s*\d)/);
  });

  it('shows the archive job state above the items', () => {
    expect(page(overview(), locale)).toContain('data-state="off"');
    expect(page(overview({ enabled: true }), locale)).toContain('data-state="dryRun"');
    expect(page(overview({ enabled: true, dryRun: false }), locale)).toContain('data-state="live"');
  });

  it('shows size, archive size and what the last run did', () => {
    const html = page(
      overview({}, [
        item('an_events', {
          source: 'custom',
          liveDays: 30,
          archiveDays: 120,
          rowVersion: 2,
          updatedAt: '2027-03-01T10:00:00Z',
          archive: { objects: 7, bytes: 5_000_000, measuredAt: '2027-03-15T03:55:00Z' },
          lastRun: {
            at: '2027-03-15T03:50:00Z',
            mode: 'live',
            outcome: 'partial',
            archivedMonths: 2,
            archivedRows: 900,
            archivedBytes: 4096,
            expiredItems: 1,
            deletedRows: 0,
            error: 'store unreachable',
          },
        }),
      ]),
      locale,
    );
    expect(html).toContain('data-testid="retention-live-an_events"');
    expect(html).toContain('2.5 MB');
    expect(html).toContain('data-testid="retention-archive-an_events"');
    expect(html).toContain('4.8 MB');
    expect(html).toContain('store unreachable');
  });

  it('marks a saved item whose values are not carried out yet', () => {
    const html = page(
      overview({}, [
        item('audit_log', {
          source: 'custom',
          liveDays: 120,
          archiveDays: 245,
          rowVersion: 1,
          applied: false,
        }),
      ]),
      locale,
    );
    expect(html).toContain('120');
    expect(html).toContain('245');
    expect(html).toMatch(/badge|rounded-full/);
  });

  it('leaves the numbers read-only for an operator who is not a super admin, and says why', () => {
    const html = page(overview(), locale, 'admin');
    expect(html).not.toContain('data-testid="retention-save-');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('offers save to a super admin', () => {
    expect(page(overview(), locale)).toContain('data-testid="retention-save-an_events"');
  });
});
