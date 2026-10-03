import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * A key is a path of lower-case segments joined by `/`, each starting with a letter or digit (so never `.`, `..` or a hidden
 * file) and holding only letters, digits, `.`, `_` and `-`. No backslash, no drive letter, no empty segment, no NUL: nothing
 * that means anything but "a file under the root" on any operating system.
 */
const SEGMENT = '[a-z0-9][a-z0-9._-]{0,127}';
const KEY_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,7}$`);
const KEY_MAX = 512;
/** Where downloads are spooled inside the root. The leading dot keeps it out of the key space. */
const SPOOL_DIR = '.spool';

export function isSafeMediaKey(key: string): boolean {
  return key.length <= KEY_MAX && KEY_RE.test(key);
}

export interface OpenedLocalMedia {
  stream: Readable;
  /** Whole file size. */
  size: number;
  /** The byte range the stream covers (the whole file unless a range was asked for). */
  start: number;
  end: number;
}

/**
 * Media on the local disk: the fallback when no cloud bucket is configured (development, tests, a small self-hosted install).
 *
 * Nothing here is reachable from a URL: files are read only through the authenticated media route. Paths are built from a
 * validated key under one root, and checked a second time against the real (symlink-resolved) root, so neither a crafted key
 * nor a link planted inside the tree can reach a file outside it.
 */
export class LocalDiskMediaStore {
  private realRoot?: Promise<string>;

  constructor(private readonly root: string) {}

  /** Writes the bytes under the key. The write is atomic (a temp file renamed into place): a reader never sees half a file. */
  async put(key: string, body: Buffer): Promise<void> {
    const target = await this.pathFor(key, { create: true });
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temp, body, { flag: 'wx', mode: 0o600 });
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  /**
   * A fresh file path for a download that is still arriving (the bytes of a customer's 80 MB document are never held in memory).
   * It lives in `<root>/.spool`: inside the store, so moving the finished file to its key is one atomic rename on the same disk,
   * and never reachable as a key (a key segment cannot start with a dot). A worker killed mid-download leaves one behind;
   * `sweepSpool` removes those.
   */
  async createSpool(): Promise<{ path: string; remove(): Promise<void> }> {
    const dir = resolve(await this.rootPath(), SPOOL_DIR);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = resolve(dir, `${randomBytes(12).toString('hex')}.part`);
    return { path, remove: () => rm(path, { force: true }) };
  }

  /** Moves a finished spool file to its key (atomic). Only a file this store spooled can be adopted. */
  async adopt(key: string, spoolPath: string): Promise<void> {
    const dir = resolve(await this.rootPath(), SPOOL_DIR);
    if (resolve(spoolPath).startsWith(dir + sep) === false) throw new Error('not a spool file');
    const target = await this.pathFor(key, { create: true });
    await rename(spoolPath, target);
  }

  /** Deletes spool files older than `olderThanMs` (the leftovers of killed workers). Returns how many. */
  async sweepSpool(olderThanMs: number): Promise<number> {
    const dir = resolve(await this.rootPath(), SPOOL_DIR);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith('.part')) continue;
      const path = resolve(dir, name);
      try {
        const info = await lstat(path);
        if (info.isFile() && Date.now() - info.mtimeMs > olderThanMs) {
          await rm(path, { force: true });
          removed += 1;
        }
      } catch {
        // gone already
      }
    }
    return removed;
  }

  /** The size of a stored file, or null when there is none under this key. */
  async stat(key: string): Promise<{ size: number } | null> {
    const target = await this.pathFor(key);
    try {
      const info = await lstat(target);
      // A link is never followed: only regular files this store wrote are served.
      return info.isFile() ? { size: info.size } : null;
    } catch {
      return null;
    }
  }

  /** A stream of the file, or of a byte range of it (`end` inclusive). Null when the file is not there. */
  async open(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<OpenedLocalMedia | null> {
    const info = await this.stat(key);
    if (!info) return null;
    const start = range?.start ?? 0;
    const end = Math.min(range?.end ?? info.size - 1, info.size - 1);
    if (info.size === 0 || start > end) return null;
    const target = await this.pathFor(key);
    return { stream: createReadStream(target, { start, end }), size: info.size, start, end };
  }

  async remove(key: string): Promise<void> {
    await rm(await this.pathFor(key), { force: true });
  }

  /** The absolute path of a key, only ever inside the root; throws for a key that is not a safe one. */
  private async pathFor(key: string, opts: { create?: boolean } = {}): Promise<string> {
    if (!isSafeMediaKey(key)) throw new Error('unsafe media key');
    const root = await this.rootPath();
    const target = resolve(root, ...key.split('/'));
    if (!target.startsWith(root + sep)) throw new Error('unsafe media key');

    if (opts.create) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // A directory inside the tree may itself be a link out of it.
      const dir = await realpath(dirname(target));
      if (dir !== root && !dir.startsWith(root + sep)) throw new Error('unsafe media key');
    }
    return target;
  }

  private rootPath(): Promise<string> {
    this.realRoot ??= mkdir(this.root, { recursive: true, mode: 0o700 }).then(() =>
      realpath(this.root),
    );
    return this.realRoot;
  }
}
