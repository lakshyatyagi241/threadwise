import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import type {
  ArchiveResult,
  PartitionArchiver,
} from '../../../src/modules/data-retention/partition-archiver.service';
import { RetentionWorker } from '../../../src/modules/data-retention/retention.worker';
import type { StreamPolicy } from '../../../src/modules/data-retention/retention-policies';

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

/** Just the archiver calls the worker makes. */
function fakeArchiver(partitions: Record<string, string[]>) {
  return {
    existingMonths: vi.fn(async (p: StreamPolicy) => partitions[p.stream] ?? []),
    inspect: vi.fn(async (p: StreamPolicy, month: string) => ({
      part: `${p.stream}_${month.replace('-', '')}`,
      estimatedRows: 1000,
      bytes: 4096,
    })),
    archiveEligible: vi.fn(async (p: StreamPolicy): Promise<ArchiveResult[]> =>
      (partitions[p.stream] ?? [])
        .filter((m) => m < '2027-01')
        .map((month) => ({
          status: 'dropped' as const,
          stream: p.stream,
          month,
          rows: 10,
          orgs: 1,
          bytes: 100,
          exported: true,
        })),
    ),
  };
}
type Fake = ReturnType<typeof fakeArchiver>;

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<never, true>;

describe('RetentionWorker', () => {
  let dir: string;
  let storage: LocalArchiveStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'retention-worker-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    // `nightly()` reads the clock; pin it so "past the live window" means the same on every day the test runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await rm(join(dir, 'archive'), { recursive: true, force: true });
    storage = new LocalArchiveStorage(dir);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (archiver: Fake, values: Record<string, unknown>, policies: StreamPolicy[]) =>
    new RetentionWorker(
      archiver as unknown as PartitionArchiver,
      storage,
      config(values),
      policies,
    );

  describe('nightly', () => {
    it('does nothing unless RETENTION_ENABLED is true', async () => {
      const archiver = fakeArchiver({ an_events: ['2026-08'] });
      const worker = make(archiver, { RETENTION_ENABLED: false, RETENTION_DRY_RUN: false }, [
        policy('an_events'),
      ]);
      expect(await worker.nightly()).toBeNull();
      expect(archiver.existingMonths).not.toHaveBeenCalled();
      expect(archiver.archiveEligible).not.toHaveBeenCalled();
    });

    it('is off when the setting is missing altogether', async () => {
      const archiver = fakeArchiver({ an_events: ['2026-08'] });
      const worker = new RetentionWorker(
        archiver as unknown as PartitionArchiver,
        storage,
        undefined,
        [policy('an_events')],
      );
      expect(await worker.nightly()).toBeNull();
      expect(archiver.archiveEligible).not.toHaveBeenCalled();
    });

    it('runs as a dry run by default: reports the plan and changes nothing', async () => {
      const archiver = fakeArchiver({ an_events: ['2026-08', '2027-03'] });
      const worker = make(archiver, { RETENTION_ENABLED: true }, [policy('an_events')]);
      const report = await worker.nightly();
      expect(report?.dryRun).toBe(true);
      expect(archiver.archiveEligible).not.toHaveBeenCalled();
      expect(report?.streams[0]?.wouldArchive?.map((m) => m.month)).toEqual(['2026-08']);
    });

    it('archives for real only when both flags say so', async () => {
      const archiver = fakeArchiver({ an_events: ['2026-08', '2026-09', '2027-03'] });
      const worker = make(archiver, { RETENTION_ENABLED: true, RETENTION_DRY_RUN: false }, [
        policy('an_events'),
      ]);
      const report = await worker.nightly();
      expect(report?.dryRun).toBe(false);
      expect(archiver.archiveEligible).toHaveBeenCalledTimes(1);
      expect(report?.streams[0]?.archived?.map((r) => [r.month, r.status])).toEqual([
        ['2026-08', 'dropped'],
        ['2026-09', 'dropped'],
      ]);
    });

    it('refuses to drop partitions into the local archive in production', async () => {
      const archiver = fakeArchiver({ an_events: ['2026-08'] });
      const values = {
        RETENTION_ENABLED: true,
        RETENTION_DRY_RUN: false,
        ARCHIVE_DRIVER: 'local',
        NODE_ENV: 'production',
      };
      const worker = make(archiver, values, [policy('an_events')]);
      expect(await worker.nightly()).toBeNull();
      expect(archiver.archiveEligible).not.toHaveBeenCalled();
      // A dry run is harmless there, and the same settings on a laptop (or with the bucket) are allowed.
      expect(
        (
          await make(archiver, { ...values, RETENTION_DRY_RUN: true }, [
            policy('an_events'),
          ]).nightly()
        )?.dryRun,
      ).toBe(true);
      expect(
        (
          await make(archiver, { ...values, NODE_ENV: 'development' }, [
            policy('an_events'),
          ]).nightly()
        )?.dryRun,
      ).toBe(false);
      expect(
        (await make(archiver, { ...values, ARCHIVE_DRIVER: 's3' }, [policy('an_events')]).nightly())
          ?.dryRun,
      ).toBe(false);
    });

    it('a failing stream is reported and does not stop the others', async () => {
      const archiver = fakeArchiver({ a: ['2026-08'], b: ['2026-08'] });
      archiver.archiveEligible.mockImplementationOnce(async () => {
        throw new Error('storage unreachable');
      });
      const worker = make(archiver, { RETENTION_ENABLED: true, RETENTION_DRY_RUN: false }, [
        policy('a'),
        policy('b'),
      ]);
      const report = await worker.nightly();
      expect(report?.streams[0]).toMatchObject({ stream: 'a', error: 'storage unreachable' });
      expect(report?.streams[1]?.archived).toHaveLength(1);
    });

    it('does not start a second run while one is in progress', async () => {
      const archiver = fakeArchiver({ an_events: ['2026-08'] });
      let release!: () => void;
      archiver.archiveEligible.mockImplementationOnce(
        () => new Promise<ArchiveResult[]>((resolve) => (release = () => resolve([]))),
      );
      const worker = make(archiver, { RETENTION_ENABLED: true, RETENTION_DRY_RUN: false }, [
        policy('an_events'),
      ]);
      const first = worker.nightly();
      await vi.waitFor(() => expect(archiver.archiveEligible).toHaveBeenCalled());
      expect(await worker.nightly()).toBeNull();
      release();
      expect((await first)?.streams).toHaveLength(1);
      expect(archiver.archiveEligible).toHaveBeenCalledTimes(1);
    });
  });

  describe('expireArchive', () => {
    const seed = async (stream: string, months: string[]) => {
      for (const m of months) {
        await storage.putBytes(`archive/${stream}/${m}/7.ndjson.gz`, Buffer.from('x'));
        await storage.putBytes(`archive/${stream}/${m}/9.ndjson.gz`, Buffer.from('x'));
        await storage.putBytes(`archive/${stream}/${m}/_manifest.json`, Buffer.from('{}'));
      }
    };
    const monthsLeft = async (stream: string) =>
      [
        ...new Set((await storage.list(`archive/${stream}/`)).map((o) => o.key.split('/')[2])),
      ].sort();

    it('keeps everything when the archive is kept forever', async () => {
      await seed('an_events', ['2020-01', '2026-08']);
      const worker = make(fakeArchiver({}), {}, []);
      const result = await worker.expireArchive(policy('an_events', { archiveDays: null }), NOW);
      expect(result).toEqual({ months: [], objects: 0 });
      expect(await monthsLeft('an_events')).toEqual(['2020-01', '2026-08']);
    });

    it('deletes whole months older than live + archive days, and only for that stream', async () => {
      // 60 live + 365 archive = 425 days before 2027-03-15 is 2026-01-14: a month ending on or before that goes.
      await seed('s', ['2025-11', '2025-12', '2026-01', '2026-02', '2026-08']);
      await seed('other', ['2025-11']);
      const worker = make(fakeArchiver({}), {}, []);
      const result = await worker.expireArchive(policy('s', { archiveDays: 365 }), NOW);
      expect(result).toEqual({ months: ['2025-11', '2025-12'], objects: 6 });
      expect(await monthsLeft('s')).toEqual(['2026-01', '2026-02', '2026-08']);
      expect(await monthsLeft('other')).toEqual(['2025-11']);
    });

    it('only reports in a dry run', async () => {
      await seed('s', ['2025-11']);
      const worker = make(fakeArchiver({}), {}, []);
      const result = await worker.expireArchive(policy('s', { archiveDays: 365 }), NOW, true);
      expect(result).toEqual({ months: ['2025-11'], objects: 3 });
      expect(await monthsLeft('s')).toEqual(['2025-11']);
    });

    it('runs after archiving in a real nightly run', async () => {
      await seed('s', ['2025-11']);
      const archiver = fakeArchiver({ s: [] });
      const worker = make(archiver, { RETENTION_ENABLED: true, RETENTION_DRY_RUN: false }, [
        policy('s', { archiveDays: 365 }),
      ]);
      const report = await worker.run({ now: NOW, dryRun: false });
      expect(report.streams[0]?.expired).toEqual({ months: ['2025-11'], objects: 3 });
      expect(await monthsLeft('s')).toEqual([]);
    });
  });
});
