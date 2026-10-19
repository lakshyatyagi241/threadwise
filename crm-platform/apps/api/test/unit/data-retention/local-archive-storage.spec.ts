import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import { archiveStorageContract } from './archive-storage.contract';

archiveStorageContract('local directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'archive-local-'));
  return {
    storage: new LocalArchiveStorage(dir),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
});

describe('LocalArchiveStorage specifics', () => {
  it('leaves no partial file behind when an upload fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archive-local-'));
    try {
      const storage = new LocalArchiveStorage(dir);
      await expect(storage.putFile('a/b', join(dir, 'does-not-exist'))).rejects.toThrow();
      expect(await storage.list('a/')).toEqual([]);
      expect(await readdir(join(dir, 'a'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores files that are not archive objects and in-flight parts when listing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archive-local-'));
    try {
      const storage = new LocalArchiveStorage(dir);
      await storage.putBytes('a/real', Buffer.from('1'));
      await writeFile(join(dir, 'a', 'real.deadbeef.part'), 'x');
      expect((await storage.list('a/')).map((o) => o.key)).toEqual(['a/real']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
