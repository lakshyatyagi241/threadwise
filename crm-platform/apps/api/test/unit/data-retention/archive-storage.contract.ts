import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readAll,
  readBytes,
  type ArchiveStorage,
} from '../../../src/infra/providers/data-retention/archive-storage.port';

/**
 * The behaviour every ArchiveStorage adapter must have. Run against the local adapter in a unit test and against the S3 adapter in an
 * integration test with a real MinIO, so the two cannot drift apart.
 */
export function archiveStorageContract(
  name: string,
  setup: () => Promise<{ storage: ArchiveStorage; cleanup?: () => Promise<void> }>,
  opts: { manyKeys?: number } = {},
): void {
  describe(`ArchiveStorage contract: ${name}`, () => {
    let storage: ArchiveStorage;
    let cleanup: (() => Promise<void>) | undefined;
    let tmp: string;
    // Each test works under its own prefix so tests never see each other's objects.
    let n = 0;
    const fresh = () => `t${(n += 1)}-${randomBytes(3).toString('hex')}`;

    beforeAll(async () => {
      ({ storage, cleanup } = await setup());
      tmp = await mkdtemp(join(tmpdir(), 'archive-contract-'));
    }, 180_000);

    afterAll(async () => {
      await cleanup?.();
      await rm(tmp, { recursive: true, force: true });
    });

    it('round-trips bytes, including binary and empty', async () => {
      const p = fresh();
      const bin = randomBytes(5000);
      await storage.putBytes(`${p}/bin`, bin);
      await storage.putBytes(`${p}/empty`, Buffer.alloc(0));
      expect(await readBytes(storage, `${p}/bin`)).toEqual(bin);
      expect((await readBytes(storage, `${p}/empty`))?.length).toBe(0);
    });

    it('uploads a file and streams it back byte for byte', async () => {
      const p = fresh();
      const big = randomBytes(3 * 1024 * 1024 + 17);
      const file = join(tmp, `${p}.bin`);
      await writeFile(file, big);
      await storage.putFile(`${p}/2026-08/7.ndjson.gz`, file);
      const stream = await storage.openRead(`${p}/2026-08/7.ndjson.gz`);
      expect(stream).not.toBeNull();
      expect((await readAll(stream!, 8 * 1024 * 1024)).equals(big)).toBe(true);
    });

    it('replaces an object that already exists', async () => {
      const p = fresh();
      await storage.putBytes(`${p}/a`, Buffer.from('first version, longer'));
      await storage.putBytes(`${p}/a`, Buffer.from('second'));
      expect((await readBytes(storage, `${p}/a`))?.toString()).toBe('second');
      expect(await storage.list(`${p}/`)).toEqual([{ key: `${p}/a`, bytes: 6 }]);
    });

    it('returns null for a missing object', async () => {
      const p = fresh();
      expect(await storage.openRead(`${p}/nope`)).toBeNull();
      expect(await readBytes(storage, `${p}/nope`)).toBeNull();
    });

    it('lists only keys under the prefix, sorted, with sizes, and not a sibling prefix', async () => {
      const p = fresh();
      await storage.putBytes(`${p}/b/2`, Buffer.from('22'));
      await storage.putBytes(`${p}/b/1`, Buffer.from('1'));
      await storage.putBytes(`${p}/b/deep/3`, Buffer.from('333'));
      await storage.putBytes(`${p}/bb/9`, Buffer.from('9'));
      await storage.putBytes(`${p}/a/0`, Buffer.from('0'));
      expect(await storage.list(`${p}/b/`)).toEqual([
        { key: `${p}/b/1`, bytes: 1 },
        { key: `${p}/b/2`, bytes: 2 },
        { key: `${p}/b/deep/3`, bytes: 3 },
      ]);
      expect(await storage.list(`${p}/nothing/`)).toEqual([]);
    });

    it('lists more objects than one page holds', async () => {
      const count = opts.manyKeys ?? 30;
      const p = fresh();
      const keys = Array.from({ length: count }, (_, i) => `${p}/k${String(i).padStart(5, '0')}`);
      for (let i = 0; i < keys.length; i += 20) {
        await Promise.all(keys.slice(i, i + 20).map((k) => storage.putBytes(k, Buffer.from('x'))));
      }
      const listed = await storage.list(`${p}/`);
      expect(listed.map((o) => o.key)).toEqual(keys);
    }, 120_000);

    it('deletes one object and says whether it existed; a missing one is not an error', async () => {
      const p = fresh();
      await storage.putBytes(`${p}/x`, Buffer.from('x'));
      await storage.putBytes(`${p}/y`, Buffer.from('y'));
      expect(await storage.delete(`${p}/x`)).toBe(true);
      expect(await storage.delete(`${p}/x`)).toBe(false);
      expect(await storage.delete(`${p}/never`)).toBe(false);
      expect((await storage.list(`${p}/`)).map((o) => o.key)).toEqual([`${p}/y`]);
    });

    it('lists the immediate sub-directories of a prefix, sorted, without looking inside them', async () => {
      const p = fresh();
      for (const k of ['b/1', 'b/deep/2', 'a/3', 'ab/4', 'top']) {
        await storage.putBytes(`${p}/${k}`, Buffer.from(k));
      }
      expect(await storage.listDirs(`${p}/`)).toEqual([`${p}/a/`, `${p}/ab/`, `${p}/b/`]);
      expect(await storage.listDirs(`${p}/b/`)).toEqual([`${p}/b/deep/`]);
      expect(await storage.listDirs(`${p}/a/`)).toEqual([]);
      expect(await storage.listDirs(`${p}/nothing/`)).toEqual([]);
    });

    it('deletes exactly the objects under a prefix and says how many', async () => {
      const p = fresh();
      for (const k of ['a/1', 'a/2', 'a/sub/3', 'ab/4', 'b/5']) {
        await storage.putBytes(`${p}/${k}`, Buffer.from(k));
      }
      expect(await storage.deletePrefix(`${p}/a/`)).toBe(3);
      expect((await storage.list(`${p}/`)).map((o) => o.key)).toEqual([`${p}/ab/4`, `${p}/b/5`]);
      expect(await storage.deletePrefix(`${p}/a/`)).toBe(0);
    });

    it('refuses keys that could escape the archive or confuse a signature', async () => {
      const bad = [
        '',
        '/abs',
        '../up',
        'a/../b',
        'a/./b',
        'a//b',
        'a/b/',
        'a\\b',
        'a b',
        'a%2Fb',
        'a?b',
        '.hidden',
        'a/.hidden',
        'ä/b',
        'a\0b',
      ];
      for (const key of bad) {
        await expect(storage.putBytes(key, Buffer.from('x'))).rejects.toThrow(
          /invalid archive key/,
        );
        await expect(storage.openRead(key)).rejects.toThrow(/invalid archive key/);
        await expect(storage.delete(key)).rejects.toThrow(/invalid archive key/);
      }
    });

    it('refuses a prefix that is empty, not a directory, or unsafe', async () => {
      for (const prefix of ['', '/', 'a', 'a/b', '../', 'a/../', '/a/']) {
        await expect(storage.list(prefix)).rejects.toThrow(/archive (prefix|key)/);
        await expect(storage.listDirs(prefix)).rejects.toThrow(/archive (prefix|key)/);
        await expect(storage.deletePrefix(prefix)).rejects.toThrow(/archive (prefix|key)/);
      }
    });
  });
}
