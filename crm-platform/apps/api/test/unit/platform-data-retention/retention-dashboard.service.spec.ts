import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RETENTION_AUDIT_EVENTS, RETENTION_GROUPS } from '@crm/contracts';
import { RetentionDashboardService } from '../../../src/modules/platform-data-retention/retention-dashboard.service';

const store = vi.hoisted(() => ({
  loadPolicies: vi.fn(),
  loadRuns: vi.fn(),
  liveStats: vi.fn(),
  savePolicy: vi.fn(),
  deletePolicy: vi.fn(),
  partitionSizes: vi.fn(),
  countOlderThan: vi.fn(),
  countArchiveDaysOlderThan: vi.fn(),
  dbArchiveStats: vi.fn(),
}));
vi.mock('../../../src/modules/data-retention', async (orig) => ({
  ...(await orig<typeof import('../../../src/modules/data-retention')>()),
  ...store,
}));

const NOW = new Date('2027-03-15T12:00:00Z');
const stored = (item: string, liveDays: number, archiveDays: number | null, rowVersion = 1) => ({
  item,
  liveDays,
  archiveDays,
  rowVersion,
  updatedAt: NOW,
  updatedBy: 9,
});
const LIVE = { bytes: 1000, rows: 50, partitions: 3, oldestMonth: '2026-12' };

function build(env: Record<string, unknown> = {}, policyDays: number | undefined = undefined) {
  const tx = {
    execute: vi.fn(async () => ({ rows: policyDays === undefined ? [] : [{ days: policyDays }] })),
  };
  const db = { privileged: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const config = { get: (k: string) => env[k] };
  const archive = { listDirs: vi.fn(async () => [] as string[]) };
  const svc = new RetentionDashboardService(
    db as never,
    audit as never,
    config as never,
    archive as never,
  );
  return { svc, audit, archive };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  store.loadPolicies.mockResolvedValue(new Map());
  store.loadRuns.mockResolvedValue(new Map());
  store.liveStats.mockResolvedValue(LIVE);
  store.dbArchiveStats.mockResolvedValue(null);
});

describe('overview', () => {
  it('shows today’s behaviour for every item while nothing is saved', async () => {
    const { svc } = build();
    const o = await svc.overview();
    expect(o.items.map((i) => [i.id, i.source, i.liveDays, i.archiveDays])).toEqual([
      ['an_events', 'default', 60, null],
      ['audit_log', 'default', 365, null],
      ['security_events', 'default', 365, null],
      ['audit_log_exports', 'default', 7, null],
      ['message_log', 'default', 90, 275],
      ['notifications_read', 'default', 90, null],
      ['notifications_unread', 'default', 180, null],
      ['push_devices_revoked', 'default', 30, null],
      ['faq_match_log', 'default', 90, null],
      ['assignment_runs', 'default', 90, null],
      ['form_events', 'default', 90, null],
      ['lead_sync_runs', 'default', 90, null],
      ['lead_scoring_runs', 'default', 90, null],
      ['api_library_logs', 'default', 30, null],
      ['flow_run_logs', 'default', 30, null],
      ['webhook_forward_failures', 'default', 14, null],
      ['click_calls', 'default', 2, null],
      ['call_recordings', 'default', 90, null],
    ]);
    // Every item sits in a group the page shows.
    expect(o.items.every((i) => RETENTION_GROUPS.includes(i.group))).toBe(true);
    expect(o.items.every((i) => i.rowVersion === null && i.applied)).toBe(true);
  });

  it('takes the audit log and security log defaults from the platform security policy, 0 meaning for ever', async () => {
    const { svc } = build({}, 90);
    const o = await svc.overview();
    expect(o.items.find((i) => i.id === 'audit_log')).toMatchObject({
      liveDays: 90,
      source: 'default',
    });
    expect(o.items.find((i) => i.id === 'security_events')?.liveDays).toBe(90);
    expect(o.items.find((i) => i.id === 'an_events')?.liveDays).toBe(60);
    expect(
      (await build({}, 0).svc.overview()).items.find((i) => i.id === 'audit_log')?.liveDays,
    ).toBe(0);
  });

  it('marks a saved partitioned policy as not applied while the archive job is off or only logging', async () => {
    store.loadPolicies.mockResolvedValue(new Map([['audit_log', stored('audit_log', 120, 245)]]));
    const off = (await build().svc.overview()).items.find((i) => i.id === 'audit_log')!;
    expect(off).toMatchObject({
      source: 'custom',
      liveDays: 120,
      archiveDays: 245,
      deleteAfterDays: 365,
      applied: false,
    });

    const dry = build({ RETENTION_ENABLED: true });
    expect((await dry.svc.overview()).items.find((i) => i.id === 'audit_log')?.applied).toBe(false);

    const live = build({ RETENTION_ENABLED: true, RETENTION_DRY_RUN: false });
    expect((await live.svc.overview()).items.find((i) => i.id === 'audit_log')?.applied).toBe(true);
  });

  it('applies a saved policy of a plain table or a file without the archive job', async () => {
    store.loadPolicies.mockResolvedValue(
      new Map([['security_events', stored('security_events', 90, null)]]),
    );
    const item = (await build().svc.overview()).items.find((i) => i.id === 'security_events')!;
    expect(item.applied).toBe(true);
  });

  it('reports the engine state and the last run', async () => {
    store.loadRuns.mockResolvedValue(
      new Map([
        [
          'an_events',
          {
            item: 'an_events',
            at: '2027-03-15T03:50:00Z',
            mode: 'live',
            outcome: 'ok',
            archivedMonths: 2,
            archivedRows: 10,
            archivedBytes: 99,
            expiredItems: 0,
            deletedRows: 0,
            error: null,
            archive: { objects: 7, bytes: 4096, measuredAt: '2027-03-15T03:50:00Z' },
          },
        ],
      ]),
    );
    const o = await build({ RETENTION_ENABLED: true, ARCHIVE_DRIVER: 's3' }).svc.overview();
    expect(o.engine).toEqual({
      enabled: true,
      dryRun: true,
      archiveDriver: 's3',
      archiveDurable: true,
    });
    const item = o.items.find((i) => i.id === 'an_events')!;
    expect(item.lastRun).toMatchObject({ mode: 'live', archivedMonths: 2 });
    expect(item.archive).toEqual({ objects: 7, bytes: 4096, measuredAt: '2027-03-15T03:50:00Z' });
    // Items that cannot be archived never show an archive.
    expect(o.items.find((i) => i.id === 'security_events')?.archive).toBeNull();
  });
});

describe('save', () => {
  it('refuses values outside the item’s limits and writes nothing', async () => {
    const { svc, audit } = build();
    await expect(
      svc.save('an_events', { liveDays: 2, archiveDays: null, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      svc.save('security_events', { liveDays: 90, archiveDays: 30, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.savePolicy).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('writes the policy and an audit event with the values before and after', async () => {
    store.savePolicy.mockResolvedValue(stored('audit_log', 120, 245, 1));
    const { svc, audit } = build();
    await svc.save('audit_log', { liveDays: 120, archiveDays: 245, rowVersion: null }, 9);
    expect(store.savePolicy).toHaveBeenCalledWith(
      expect.anything(),
      'audit_log',
      { liveDays: 120, archiveDays: 245 },
      null,
      9,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: RETENTION_AUDIT_EVENTS.updated,
        actorType: 'platform_operator',
        actorId: 9,
        payload: expect.objectContaining({
          item: 'audit_log',
          before: { liveDays: 365, archiveDays: null, source: 'default' },
          after: { liveDays: 120, archiveDays: 245, source: 'custom' },
        }),
      }),
    );
  });

  it('is a version conflict, and writes nothing, when the client and the server disagree about whether a policy exists', async () => {
    const { svc, audit } = build();
    // The client never saw a policy (null) but one exists now.
    store.loadPolicies.mockResolvedValue(
      new Map([['an_events', stored('an_events', 30, null, 4)]]),
    );
    await expect(
      svc.save('an_events', { liveDays: 40, archiveDays: null, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'ROW_VERSION_CONFLICT' });
    // The client holds a version but the policy was reset meanwhile.
    store.loadPolicies.mockResolvedValue(new Map());
    await expect(
      svc.save('an_events', { liveDays: 40, archiveDays: null, rowVersion: 4 }, 9),
    ).rejects.toMatchObject({ code: 'ROW_VERSION_CONFLICT' });
    expect(store.savePolicy).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('reset', () => {
  it('removes the policy and audits it', async () => {
    store.deletePolicy.mockResolvedValue(stored('an_events', 30, 10));
    const { svc, audit } = build();
    await svc.reset('an_events', 9);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: RETENTION_AUDIT_EVENTS.reset,
        payload: expect.objectContaining({
          before: { liveDays: 30, archiveDays: 10, source: 'custom' },
          after: { source: 'default' },
        }),
      }),
    );
  });

  it('writes no audit event when there was nothing to reset', async () => {
    store.deletePolicy.mockResolvedValue(null);
    const { svc, audit } = build();
    await svc.reset('an_events', 9);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('preview', () => {
  it('lists the months that would leave the database and the archived months that would be deleted', async () => {
    store.partitionSizes.mockResolvedValue([
      { month: '2026-10', estimatedRows: 100, bytes: 1 },
      { month: '2026-11', estimatedRows: 150, bytes: 2 },
      { month: '2026-12', estimatedRows: 200, bytes: 2 },
      { month: '2027-03', estimatedRows: 300, bytes: 3 },
    ]);
    const { svc, archive } = build();
    archive.listDirs.mockResolvedValue([
      'archive/audit_log/2024-01/',
      'archive/audit_log/2026-09/',
      'archive/audit_log/_junk/',
    ]);
    const p = await svc.preview('audit_log', { liveDays: 90, archiveDays: 365 });
    // On 15 March 2027 a month leaves once it ended 90 days ago (before 15 December): October and November are out, December is not.
    expect(p.toArchive.map((m) => m.month)).toEqual(['2026-10', '2026-11']);
    // 90 + 365 days: only January 2024 is older than that.
    expect(p.toDeleteFromArchive).toEqual(['2024-01']);
    expect(archive.listDirs).toHaveBeenCalledWith('archive/audit_log/');
  });

  it('does not look at the archive when it keeps everything for ever', async () => {
    store.partitionSizes.mockResolvedValue([]);
    const { svc, archive } = build();
    const p = await svc.preview('an_events', { liveDays: 60, archiveDays: null });
    expect(p.toDeleteFromArchive).toEqual([]);
    expect(archive.listDirs).not.toHaveBeenCalled();
  });

  it('counts the rows or files that would be deleted for an item that is not archived', async () => {
    store.countOlderThan.mockResolvedValue(42);
    const { svc } = build();
    const p = await svc.preview('security_events', { liveDays: 60, archiveDays: null });
    expect(p.rowsToDelete).toBe(42);
    expect(store.countOlderThan).toHaveBeenCalledWith(expect.anything(), 'security_events', 60);
  });

  it('refuses invalid values', async () => {
    const { svc } = build();
    await expect(
      svc.preview('audit_log_exports', { liveDays: 400, archiveDays: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('every sweep is covered', () => {
  it('shows the message log with its archive measured from the database archive', async () => {
    store.dbArchiveStats.mockImplementation(async (_tx: unknown, id: string) =>
      id === 'message_log' ? { objects: 12, bytes: 4096 } : null,
    );
    const o = await build().svc.overview();
    const log = o.items.find((i) => i.id === 'message_log')!;
    expect(log).toMatchObject({ kind: 'daily_archive', canArchive: true, deleteAfterDays: 365 });
    expect(log.archive).toMatchObject({ objects: 12, bytes: 4096 });
    expect(o.items.find((i) => i.id === 'faq_match_log')?.archive).toBeNull();
  });

  it('refuses unread notifications that would go before the read ones, either way round', async () => {
    const { svc } = build();
    await expect(
      svc.save('notifications_unread', { liveDays: 60, archiveDays: null, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // Read days above the unread days saved earlier.
    store.loadPolicies.mockResolvedValue(
      new Map([['notifications_unread', stored('notifications_unread', 100, null)]]),
    );
    await expect(
      svc.save('notifications_read', { liveDays: 120, archiveDays: null, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.savePolicy).not.toHaveBeenCalled();
  });

  it('accepts equal read and unread days', async () => {
    store.savePolicy.mockResolvedValue(stored('notifications_unread', 90, null, 1));
    await build().svc.save(
      'notifications_unread',
      { liveDays: 90, archiveDays: null, rowVersion: null },
      9,
    );
    expect(store.savePolicy).toHaveBeenCalled();
  });

  it('counts events that would move into the archive and archived days that would be deleted for the message log', async () => {
    store.countOlderThan.mockResolvedValue(500);
    store.countArchiveDaysOlderThan.mockResolvedValue(8);
    const p = await build().svc.preview('message_log', { liveDays: 30, archiveDays: 60 });
    expect(p).toMatchObject({ rowsToArchive: 500, rowsToDelete: 8 });
    expect(store.countOlderThan).toHaveBeenCalledWith(expect.anything(), 'message_log', 30);
    expect(store.countArchiveDaysOlderThan).toHaveBeenCalledWith(expect.anything(), 90);
  });

  it('deletes nothing from an archive that is kept for ever', async () => {
    store.countOlderThan.mockResolvedValue(5);
    const p = await build().svc.preview('message_log', { liveDays: 30, archiveDays: null });
    expect(p.rowsToDelete).toBe(0);
    expect(store.countArchiveDaysOlderThan).not.toHaveBeenCalled();
  });

  it('previews any plain table by its id', async () => {
    store.countOlderThan.mockResolvedValue(77);
    const p = await build().svc.preview('faq_match_log', { liveDays: 30, archiveDays: null });
    expect(p.rowsToDelete).toBe(77);
    expect(store.countOlderThan).toHaveBeenCalledWith(expect.anything(), 'faq_match_log', 30);
  });

  it('refuses an archive on a plain table and values outside the limits for the new items', async () => {
    const { svc } = build();
    await expect(
      svc.preview('faq_match_log', { liveDays: 30, archiveDays: 10 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      svc.save('click_calls', { liveDays: 31, archiveDays: null, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      svc.save('call_recordings', { liveDays: 6, archiveDays: null, rowVersion: null }, 9),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
