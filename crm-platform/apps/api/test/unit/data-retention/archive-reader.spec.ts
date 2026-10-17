import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import type { ArchiveStorage } from '../../../src/infra/providers/data-retention/archive-storage.port';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import { ArchiveReader } from '../../../src/modules/data-retention/archive-reader.service';

/** The objects the archiver writes (one gzip member per batch is also valid), built by hand so this needs no database. */
const row = (id: number, org: number, at: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, org_id: org, recorded_at: at, n: id, ...extra });

describe('ArchiveReader', () => {
  let dir: string;
  let local: LocalArchiveStorage;
  let opened: string[];
  let lastStream: Readable | null;
  let reader: ArchiveReader;

  /** Wraps the local store so a test can see which objects were opened and whether a stream was closed. */
  const spy: ArchiveStorage = {
    putFile: (k, p) => local.putFile(k, p),
    putBytes: (k, d) => local.putBytes(k, d),
    async openRead(key) {
      opened.push(key);
      lastStream = await local.openRead(key);
      return lastStream;
    },
    list: (p) => local.list(p),
    listDirs: (p) => local.listDirs(p),
    delete: (k) => local.delete(k),
    deletePrefix: (p) => local.deletePrefix(p),
  };

  const put = (month: string, org: number, lines: string[], members = 1) => {
    const per = Math.ceil(lines.length / members);
    const parts: Buffer[] = [];
    for (let i = 0; i < lines.length; i += per) {
      parts.push(gzipSync(Buffer.from(`${lines.slice(i, i + per).join('\n')}\n`, 'utf8')));
    }
    return local.putBytes(`archive/an_events/${month}/${org}.ndjson.gz`, Buffer.concat(parts));
  };
  const collect = async (org: number, from: string, to: string) => {
    const out: Array<Record<string, unknown>> = [];
    for await (const r of reader.stream('an_events', org, new Date(from), new Date(to), {
      trusted: true,
    }))
      out.push(r);
    return out;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reader-'));
    local = new LocalArchiveStorage(dir);
    reader = new ArchiveReader(spy);
    opened = [];
    lastStream = null;

    await put('2026-08', 7, [
      row(1, 7, '2026-08-03T10:00:00.100000+00:00'),
      row(4, 7, '2026-08-20T10:00:00.000000+00:00'),
      row(6, 7, '2026-08-31T23:59:59.999999+00:00'),
    ]);
    await put('2026-08', 9, [row(2, 9, '2026-08-04T10:00:00.000000+00:00')]);
    await put(
      '2026-09',
      7,
      [
        row(10, 7, '2026-09-01T00:00:00.000000+00:00'),
        row(11, 7, '2026-09-15T12:00:00.000000+00:00'),
        row(12, 7, '2026-09-30T23:00:00.000000+00:00'),
      ],
      3, // three gzip members: the format of a file built from several batches
    );
    await put('2026-12', 7, [row(30, 7, '2026-12-31T23:59:59.000000+00:00')]);
    await put('2027-01', 7, [row(31, 7, '2027-01-01T00:00:00.000000+00:00')]);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('yields only that workspace, inside [from, to), in id order across months', async () => {
    opened = [];
    const rows = await collect(7, '2026-08-10T00:00:00Z', '2026-09-30T23:00:00Z');
    expect(rows.map((r) => r.id)).toEqual([4, 6, 10, 11]);
    expect(rows.every((r) => r.org_id === 7)).toBe(true);
  });

  it('includes a row exactly at `from` and excludes one exactly at `to`', async () => {
    expect(
      (await collect(7, '2026-09-01T00:00:00Z', '2026-09-15T12:00:00Z')).map((r) => r.id),
    ).toEqual([10]);
    expect(
      (await collect(7, '2026-09-15T12:00:00Z', '2026-09-15T12:00:00.001Z')).map((r) => r.id),
    ).toEqual([11]);
  });

  it("reads only the requested workspace's objects, one per month in range", async () => {
    opened = [];
    await collect(7, '2026-08-01T00:00:00Z', '2026-10-01T00:00:00Z');
    expect(opened).toEqual([
      'archive/an_events/2026-08/7.ndjson.gz',
      'archive/an_events/2026-09/7.ndjson.gz',
    ]);
    expect(opened.some((k) => k.includes('/9.'))).toBe(false);
  });

  it('yields nothing for a month with no object, and for a workspace that has none', async () => {
    expect(await collect(7, '2026-10-01T00:00:00Z', '2026-11-30T00:00:00Z')).toEqual([]);
    expect(await collect(8, '2026-08-01T00:00:00Z', '2026-09-30T00:00:00Z')).toEqual([]);
  });

  it('crosses a year boundary', async () => {
    const rows = await collect(7, '2026-12-31T00:00:00Z', '2027-01-02T00:00:00Z');
    expect(rows.map((r) => r.id)).toEqual([30, 31]);
  });

  it('keeps microsecond text untouched in the rows it returns', async () => {
    const [first] = await collect(7, '2026-08-03T00:00:00Z', '2026-08-04T00:00:00Z');
    expect(first?.recorded_at).toBe('2026-08-03T10:00:00.100000+00:00');
  });

  it('opens nothing for an empty or reversed range', async () => {
    opened = [];
    expect(await collect(7, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')).toEqual([]);
    expect(await collect(7, '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z')).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('closes the object when the caller stops early', async () => {
    const gen = reader.stream(
      'an_events',
      7,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-10-01T00:00:00Z'),
      { trusted: true },
    );
    const first = await gen.next();
    expect(first.value).toMatchObject({ id: 1 });
    await gen.return(undefined);
    expect(lastStream?.destroyed).toBe(true);
  });

  it('throws on a damaged object instead of returning part of a month', async () => {
    await local.putBytes(
      'archive/an_events/2026-11/7.ndjson.gz',
      gzipSync(Buffer.from(`${row(20, 7, '2026-11-05T00:00:00.000000+00:00')}\n`)).subarray(0, 12),
    );
    await expect(collect(7, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')).rejects.toThrow();
  });

  it('throws on a row whose partition key is not a timestamp', async () => {
    await put('2026-10', 7, [JSON.stringify({ id: 1, org_id: 7, recorded_at: 'tomorrow-ish' })]);
    await expect(collect(7, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).rejects.toThrow(
      /recorded_at/,
    );
  });

  it('refuses a read with no request context unless the caller says it is trusted', async () => {
    opened = [];
    const read = async (opts?: { trusted?: boolean }) => {
      for await (const _ of reader.stream(
        'an_events',
        7,
        new Date('2026-08-01T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
        opts,
      ))
        void _;
    };
    await expect(read()).rejects.toThrow(/needs \{ trusted: true \}/);
    await expect(read({})).rejects.toThrow(/needs \{ trusted: true \}/);
    expect(opened).toEqual([]);
    await expect(read({ trusted: true })).resolves.toBeUndefined();
  });

  describe('inside a request', () => {
    const asUser = <T>(
      orgId: number,
      actorType: 'user' | 'platform_operator',
      fn: () => Promise<T>,
    ) => RequestContextStore.run({ requestId: 'r1', orgId, actorType, actorId: 1, userId: 1 }, fn);

    it('lets a workspace read its own archive', async () => {
      const rows = await asUser(7, 'user', () =>
        collect(7, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      );
      expect(rows.map((r) => r.id)).toEqual([1, 4, 6]);
    });

    it("refuses a workspace id that is not the request's, before opening anything", async () => {
      opened = [];
      await expect(
        asUser(9, 'user', () => collect(7, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')),
      ).rejects.toThrow(/not the one this request belongs to/);
      expect(opened).toEqual([]);
    });

    it('lets a platform operator read any workspace', async () => {
      const rows = await asUser(0, 'platform_operator', () =>
        collect(7, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      );
      expect(rows).toHaveLength(3);
    });
  });

  it('refuses an unknown stream, a bad workspace id and an absurd range', async () => {
    const drain = async (stream: string, org: number, from: Date, to: Date) => {
      for await (const _ of reader.stream(stream, org, from, to, { trusted: true })) void _;
    };
    await expect(
      drain('messages', 7, new Date('2026-01-01'), new Date('2026-02-01')),
    ).rejects.toThrow(/no retention policy/);
    await expect(
      drain('an_events', -1, new Date('2026-01-01'), new Date('2026-02-01')),
    ).rejects.toThrow(/workspace/);
    await expect(
      drain('an_events', 1.5, new Date('2026-01-01'), new Date('2026-02-01')),
    ).rejects.toThrow(/workspace/);
    await expect(
      drain('an_events', 7, new Date('1990-01-01'), new Date('2026-02-01')),
    ).rejects.toThrow(/range/);
  });
});
