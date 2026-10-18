import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import type {
  ArchiveResult,
  PartitionArchiver,
} from '../../../src/modules/data-retention/partition-archiver.service';
import { RetentionWorker } from '../../../src/modules/data-retention/retention.worker';
import type { StreamPolicy } from '../../../src/modules/data-retention/retention-policies';

const store = vi.hoisted(() => ({
  loadPolicies: vi.fn(),
  recordRun: vi.fn(),
}));
vi.mock('../../../src/modules/data-retention/retention-store', () => store);

const NOW = new Date('2027-03-15T03:50:00Z');
const policy = (stream: string, over: Partial<StreamPolicy> = {}): StreamPolicy => ({
  stream,
  partitionKey: 'recorded_at',
  idColumn: 'id',
  orgColumn: 'org_id',
  liveDays: 60,
  archiveDays: null,
  omitColumns: [],
  ...over,
});
const saved = (item: string, liveDays: number, archiveDays: number | null) => ({
  item,
  liveDays,
  archiveDays,
  rowVersion: 1,
  updatedAt: NOW,
  updatedBy: 1,
});

function fakeArchiver(results: ArchiveResult[] = []) {
  return {
    existingMonths: vi.fn(async () => ['2026-08']),
    inspect: vi.fn(async () => ({ part: 'x', estimatedRows: 10, bytes: 100 })),
    archiveEligible: vi.fn(async () => results),
  };
}

/** The policies the worker saved by a super admin lay over the registry; an opt-in stream waits for its first saved policy. */
describe('RetentionWorker with saved policies', () => {
  let dir: string;
  let storage: LocalArchiveStorage;
  const db = { privileged: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}) };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'retention-overlay-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(join(dir, 'archive'), { recursive: true, force: true });
    storage = new LocalArchiveStorage(dir);
  });

  const make = (archiver: ReturnType<typeof fakeArchiver>, policies: StreamPolicy[]) =>
    new RetentionWorker(
      archiver as unknown as PartitionArchiver,
      storage,
      undefined,
      policies,
      db as never,
    );

  it('uses the registry as it is for a stream with no saved policy', async () => {
    store.loadPolicies.mockResolvedValue(new Map());
    const worker = make(fakeArchiver(), [policy('an_events', { liveDays: 60, archiveDays: null })]);
    expect(await worker.effectivePolicies()).toEqual([
      policy('an_events', { liveDays: 60, archiveDays: null }),
    ]);
  });

  it('lays the saved live and archive days over the registry', async () => {
    store.loadPolicies.mockResolvedValue(new Map([['an_events', saved('an_events', 30, 120)]]));
    const worker = make(fakeArchiver(), [policy('an_events')]);
    const [p] = await worker.effectivePolicies();
    expect(p).toMatchObject({ stream: 'an_events', liveDays: 30, archiveDays: 120 });
  });

  it('leaves an opt-in stream alone until a policy is saved for it', async () => {
    store.loadPolicies.mockResolvedValue(new Map());
    const worker = make(fakeArchiver(), [
      policy('an_events'),
      policy('audit_log', { optIn: true, partitionKey: 'at' }),
    ]);
    expect((await worker.effectivePolicies()).map((p) => p.stream)).toEqual(['an_events']);

    store.loadPolicies.mockResolvedValue(new Map([['audit_log', saved('audit_log', 400, 900)]]));
    expect((await worker.effectivePolicies()).map((p) => [p.stream, p.liveDays])).toEqual([
      ['an_events', 60],
      ['audit_log', 400],
    ]);
  });

  it('archives an opt-in stream with the saved window and records what the run did', async () => {
    store.loadPolicies.mockResolvedValue(new Map([['audit_log', saved('audit_log', 400, 900)]]));
    const archiver = fakeArchiver([
      {
        status: 'dropped',
        stream: 'audit_log',
        month: '2025-01',
        rows: 12,
        orgs: 2,
        bytes: 340,
        exported: true,
      },
      { status: 'failed', stream: 'audit_log', month: '2025-02', reason: 'store unreachable' },
    ]);
    const worker = make(archiver, [policy('audit_log', { optIn: true, partitionKey: 'at' })]);
    await worker.run({ dryRun: false, now: NOW });

    expect(archiver.archiveEligible).toHaveBeenCalledWith(
      expect.objectContaining({ stream: 'audit_log', liveDays: 400, archiveDays: 900 }),
      { now: NOW },
    );
    expect(store.recordRun).toHaveBeenCalledWith(
      expect.anything(),
      'audit_log',
      expect.objectContaining({
        mode: 'live',
        outcome: 'partial',
        archivedMonths: 1,
        archivedRows: 12,
        archivedBytes: 340,
        error: 'store unreachable',
      }),
      NOW,
    );
  });

  it('records a dry run as a dry run, and still plans without archiving', async () => {
    store.loadPolicies.mockResolvedValue(new Map());
    const archiver = fakeArchiver();
    await make(archiver, [policy('an_events')]).run({ dryRun: true, now: NOW });
    expect(archiver.archiveEligible).not.toHaveBeenCalled();
    expect(store.recordRun).toHaveBeenCalledWith(
      expect.anything(),
      'an_events',
      expect.objectContaining({ mode: 'dry_run', outcome: 'ok' }),
      NOW,
    );
  });

  it('does not fail the run when the last-run note cannot be written', async () => {
    store.loadPolicies.mockResolvedValue(new Map());
    store.recordRun.mockRejectedValue(new Error('db down'));
    const report = await make(fakeArchiver(), [policy('an_events')]).run({
      dryRun: false,
      now: NOW,
    });
    expect(report.streams[0]?.error).toBeUndefined();
  });
});
