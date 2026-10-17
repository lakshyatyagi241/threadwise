import { randomBytes } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  assertArchiveKey,
  assertArchivePrefix,
  type ArchiveObject,
  type ArchiveStorage,
} from './archive-storage.port';

/** Archive objects as files under one directory. For development and tests; production uses the bucket. */
export class LocalArchiveStorage implements ArchiveStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    assertArchiveKey(key);
    const path = resolve(this.root, ...key.split('/'));
    // The key check already rules out `..`; this is the belt to its braces.
    if (!path.startsWith(this.root + sep))
      throw new Error(`invalid archive key: ${JSON.stringify(key)}`);
    return path;
  }

  /** Writes next to the target and renames, so a reader never sees half an object and a crash leaves no truncated one. */
  private async place(key: string, write: (tmp: string) => Promise<void>): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(4).toString('hex')}.part`;
    try {
      await write(tmp);
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  putFile(key: string, path: string): Promise<void> {
    return this.place(key, (tmp) => copyFile(path, tmp));
  }

  putBytes(key: string, data: Buffer): Promise<void> {
    return this.place(key, (tmp) => writeFile(tmp, data));
  }

  async openRead(key: string): Promise<Readable | null> {
    const path = this.pathOf(key);
    try {
      if (!(await stat(path)).isFile()) return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    return createReadStream(path);
  }

  async list(prefix: string): Promise<ArchiveObject[]> {
    assertArchivePrefix(prefix);
    const out: ArchiveObject[] = [];
    const walk = async (dirKey: string): Promise<void> => {
      const dir = this.pathOf(dirKey.slice(0, -1));
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return;
        throw err;
      }
      for (const e of entries) {
        if (e.name.endsWith('.part')) continue; // an upload in flight
        if (e.isDirectory()) await walk(`${dirKey}${e.name}/`);
        else if (e.isFile())
          out.push({ key: `${dirKey}${e.name}`, bytes: (await stat(join(dir, e.name))).size });
      }
    };
    await walk(prefix);
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /** Empty directories are left behind: harmless, and removing them could race an upload that is placing a file there. */
  async deletePrefix(prefix: string): Promise<number> {
    const objects = await this.list(prefix);
    await Promise.all(objects.map((o) => this.delete(o.key)));
    return objects.length;
  }
}
