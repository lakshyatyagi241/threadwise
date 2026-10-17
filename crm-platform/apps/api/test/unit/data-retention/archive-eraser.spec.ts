import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import {
  archiveEraseMarker,
  archiveEraseMarkerOrg,
  parseObjectKey,
} from '../../../src/modules/data-retention/archive-keys';
import { ArchiveEraser } from '../../../src/modules/data-retention/archive-eraser.service';
import { storageKeyIsOwnedBy } from '../../../src/common/storage-key-owner';

describe('ArchiveEraser', () => {
  let dir: string;
  let storage: LocalArchiveStorage;
  let eraser: ArchiveEraser;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eraser-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await rm(join(dir, 'archive'), { recursive: true, force: true });
    storage = new LocalArchiveStorage(dir);
    eraser = new ArchiveEraser(storage);
  });

  const put = async (key: string) => storage.putBytes(key, Buffer.from('x'));
  const keys = async () => (await storage.list('archive/')).map((o) => o.key);

  it("deletes exactly that workspace's objects in every stream and month", async () => {
    for (const k of [
      'archive/an_events/2026-08/7.ndjson.gz',
      'archive/an_events/2026-09/7.ndjson.gz',
      'archive/message_events/2026-08/7.ndjson.gz',
      'archive/an_events/2026-08/9.ndjson.gz',
      'archive/an_events/2026-08/_manifest.json',
    ]) {
      await put(k);
    }
    expect(await eraser.eraseOrg(7)).toBe(3);
    expect(await keys()).toEqual([
      'archive/an_events/2026-08/9.ndjson.gz',
      'archive/an_events/2026-08/_manifest.json',
    ]);
  });

  it('does not touch a workspace whose id merely ends with or contains the same digits', async () => {
    for (const org of [7, 17, 70, 77, 107]) await put(`archive/an_events/2026-08/${org}.ndjson.gz`);
    expect(await eraser.eraseOrg(7)).toBe(1);
    expect((await keys()).map((k) => parseObjectKey(k)?.org)).toEqual(['107', '17', '70', '77']);
  });

  it('also covers a stream that is no longer in the registry', async () => {
    await put('archive/retired_stream/2025-01/7.ndjson.gz');
    expect(await eraser.eraseOrg(7)).toBe(1);
    expect(await keys()).toEqual([]);
  });

  it('is safe to repeat and says zero when there is nothing', async () => {
    await put('archive/an_events/2026-08/7.ndjson.gz');
    expect(await eraser.eraseOrg(7)).toBe(1);
    expect(await eraser.eraseOrg(7)).toBe(0);
    expect(await eraser.eraseOrg(8)).toBe(0);
  });

  it('refuses ids that are not a tenant: zero, negative, fractional', async () => {
    await put('archive/an_events/2026-08/0.ndjson.gz');
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(eraser.eraseOrg(bad)).rejects.toThrow(/workspace id/);
    }
    expect(await keys()).toEqual(['archive/an_events/2026-08/0.ndjson.gz']);
  });
});

describe('archive erase marker', () => {
  it('round-trips the workspace id', () => {
    expect(archiveEraseMarkerOrg(archiveEraseMarker(42))).toBe(42);
  });

  it("passes the purge queue's own workspace ownership check", () => {
    expect(storageKeyIsOwnedBy(42, archiveEraseMarker(42))).toBe(true);
    expect(storageKeyIsOwnedBy(43, archiveEraseMarker(42))).toBe(false);
  });

  it('is not recognised in anything else', () => {
    for (const key of [
      'archive-erase/42',
      'archive-erase/x/all',
      'archive/an_events/2026-08/42.ndjson.gz',
      'k/ok.pdf',
      '',
    ]) {
      expect(archiveEraseMarkerOrg(key)).toBeNull();
    }
  });
});

describe('parseObjectKey', () => {
  it('reads stream, month and workspace from an object key and ignores manifests', () => {
    expect(parseObjectKey('archive/an_events/2026-08/7.ndjson.gz')).toEqual({
      stream: 'an_events',
      month: '2026-08',
      org: '7',
    });
    expect(parseObjectKey('archive/an_events/2026-08/_manifest.json')).toBeNull();
    expect(parseObjectKey('archive/an_events/2026-13/7.ndjson.gz')).toBeNull();
    expect(parseObjectKey('other/an_events/2026-08/7.ndjson.gz')).toBeNull();
  });
});
