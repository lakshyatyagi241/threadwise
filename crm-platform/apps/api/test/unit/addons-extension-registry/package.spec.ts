import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installPackage,
  isProtectedPath,
  isSafeRelative,
  removeFiles,
} from '../../../src/modules/addons-extension-registry/extension-installer';
import { inspectPackage } from '../../../src/modules/addons-extension-registry/package-inspector';
import {
  readEntry,
  readEntryAsync,
  readZip,
} from '../../../src/modules/addons-extension-registry/zip-reader';
import { makeZip, manifestJson } from './zip-fixture';

const OPTS = { coreVersion: '1.0.0', maxEntries: 100, maxUnpackedBytes: 10_000_000 };
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'addons-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { code: string; message: string; getStatus(): number };
  }
  throw new Error('expected a refusal');
};

describe('zip reader', () => {
  it('reads stored and deflated entries and verifies size and checksum', () => {
    const buf = makeZip([
      { name: 'a.txt', data: 'hello', method: 0 },
      { name: 'dir/', data: '' },
      { name: 'dir/b.txt', data: 'world '.repeat(500) },
    ]);
    const entries = readZip(buf, { maxEntries: 10 });
    expect(entries.map((e) => [e.name, e.isDirectory])).toEqual([
      ['a.txt', false],
      ['dir/', true],
      ['dir/b.txt', false],
    ]);
    expect(readEntry(buf, entries[0]!).toString()).toBe('hello');
    expect(readEntry(buf, entries[2]!).toString()).toBe('world '.repeat(500));
  });

  it('the async reader returns the same bytes and refuses the same entries as the sync one (EL-B08)', async () => {
    const buf = makeZip([
      { name: 'a.txt', data: 'hello', method: 0 },
      { name: 'dir/b.txt', data: 'world '.repeat(500) },
    ]);
    const entries = readZip(buf, { maxEntries: 10 });
    for (const e of entries) {
      expect((await readEntryAsync(buf, e)).equals(readEntry(buf, e))).toBe(true);
    }
    const tampered = Buffer.from(buf);
    tampered[30 + 'a.txt'.length] = 0x58;
    await expect(readEntryAsync(tampered, entries[0]!)).rejects.toThrow(/corrupt/);
    await expect(readEntryAsync(buf, { ...entries[0]!, size: 99 })).rejects.toThrow(
      /declared size/,
    );
    await expect(readEntryAsync(buf, { ...entries[1]!, size: 3 })).rejects.toThrow(
      /could not be decompressed|declared size/,
    );
    await expect(readEntryAsync(buf, { ...entries[0]!, method: 99 })).rejects.toThrow(
      /unsupported compression/,
    );
  });

  it('rejects a corrupt entry (checksum mismatch) and a lying size', () => {
    const buf = makeZip([{ name: 'a.txt', data: 'hello', method: 0 }]);
    const entries = readZip(buf, { maxEntries: 10 });
    const tampered = Buffer.from(buf);
    tampered[30 + 'a.txt'.length] = 0x58; // flip the first data byte
    expect(() => readEntry(tampered, entries[0]!)).toThrow(/corrupt/);
    expect(() => readEntry(buf, { ...entries[0]!, size: 99 })).toThrow(/declared size/);
  });

  it('refuses garbage and archives with too many entries', () => {
    expect(() =>
      readZip(Buffer.from('definitely not a zip file at all'), { maxEntries: 5 }),
    ).toThrow();
    const many = makeZip(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, data: 'x' })));
    expect(() => readZip(many, { maxEntries: 5 })).toThrow(/entries/);
  });
});

describe('package inspection (TW-ADD-004)', () => {
  const m = (extra: Record<string, unknown> = {}) =>
    manifestJson({ slug: 'foo', name: 'Foo', version: '1.2.0', ...extra });

  it('accepts extension.json at the root', () => {
    const r = inspectPackage(
      makeZip([
        { name: 'extension.json', data: m() },
        { name: 'a.txt', data: 'x' },
      ]),
      OPTS,
    );
    expect(r.manifest).toMatchObject({ slug: 'foo', name: 'Foo', version: '1.2.0' });
    expect(r.rootPrefix).toBe('');
  });

  it('accepts one wrapper folder and strips it', () => {
    const r = inspectPackage(makeZip([{ name: 'foo-1.2/extension.json', data: m() }]), OPTS);
    expect(r.rootPrefix).toBe('foo-1.2/');
  });

  it('refuses an unreadable archive, a missing manifest, a malformed manifest', () => {
    expect(refusal(() => inspectPackage(Buffer.from('plain text, not a zip'), OPTS))).toMatchObject(
      {
        code: 'ADD_PACKAGE_INVALID',
        message: expect.stringContaining('not a readable ZIP'),
      },
    );
    expect(
      refusal(() => inspectPackage(makeZip([{ name: 'readme.txt', data: 'x' }]), OPTS)).message,
    ).toMatch(/extension\.json was not found/);
    const bad = refusal(() =>
      inspectPackage(makeZip([{ name: 'extension.json', data: '{"name":"no slug"}' }]), OPTS),
    );
    expect(bad.message).toMatch(/malformed/);
    expect(bad.getStatus()).toBe(422);
    expect(
      refusal(() =>
        inspectPackage(makeZip([{ name: 'extension.json', data: m({ slug: '../../etc' }) }]), OPTS),
      ).message,
    ).toMatch(/malformed/);
  });

  it('refuses a package that needs a newer core, naming both versions (nothing is written)', () => {
    const e = refusal(() =>
      inspectPackage(makeZip([{ name: 'extension.json', data: m({ min_core: '2.0.0' }) }]), OPTS),
    );
    expect(e.code).toBe('ADD_CORE_TOO_OLD');
    expect(e.message).toContain('2.0.0');
    expect(e.message).toContain('1.0.0');
    // equal is fine
    expect(() =>
      inspectPackage(makeZip([{ name: 'extension.json', data: m({ min_core: '1.0.0' }) }]), OPTS),
    ).not.toThrow();
  });

  it('refuses a package that declares it would unpack past the limit', () => {
    const zip = makeZip([
      { name: 'extension.json', data: m() },
      { name: 'big.bin', data: Buffer.alloc(5000) },
    ]);
    expect(refusal(() => inspectPackage(zip, { ...OPTS, maxUnpackedBytes: 1000 })).code).toBe(
      'ADD_PACKAGE_TOO_LARGE',
    );
  });
});

describe('install (TW-ADD-005)', () => {
  const manifest = manifestJson({ slug: 'foo', version: '1.0.0' });

  it('extracts under <dir>/<slug>/ only and tracks exactly the files it wrote', async () => {
    const zip = makeZip([
      { name: 'wrap/extension.json', data: manifest },
      { name: 'wrap/app/Controller.txt', data: 'code' },
      { name: 'wrap/assets/', data: '' },
      { name: 'outside.txt', data: 'not in the wrapper' },
    ]);
    const res = await installPackage(zip, inspectPackage(zip, OPTS), dir);
    expect(res.files.sort()).toEqual(['foo/app/Controller.txt', 'foo/extension.json']);
    expect(res).toMatchObject({ written: 2, skipped: 1 });
    expect(await readFile(join(dir, 'foo/app/Controller.txt'), 'utf8')).toBe('code');
    expect(await readdir(dir)).toEqual(['foo']); // nothing outside foo/
  });

  it('skips and counts traversal, absolute and protected entries (including ../../.env)', async () => {
    const zip = makeZip([
      { name: 'extension.json', data: manifest },
      { name: '../../.env', data: 'SECRET=1' },
      { name: 'a/../../escape.txt', data: 'x' },
      { name: '/abs.txt', data: 'x' },
      { name: 'C:/win.txt', data: 'x' },
      { name: 'back\\slash.txt', data: 'x' },
      { name: '.env', data: 'x' },
      { name: '.env.production', data: 'x' },
      { name: 'composer.json', data: '{}' },
      { name: 'vendor/lib/x.php', data: 'x' },
      { name: 'node_modules/y/index.js', data: 'x' },
      { name: 'config/license.php', data: 'x' },
      { name: '.disabled', data: 'x' },
      { name: 'ok.txt', data: 'fine' },
    ]);
    const res = await installPackage(zip, inspectPackage(zip, OPTS), dir);
    expect(res.files.sort()).toEqual(['foo/extension.json', 'foo/ok.txt']);
    expect(res.skipped).toBe(12);
    expect(await exists(join(dir, '..', '.env'))).toBe(false);
    expect(await exists(join(dir, 'escape.txt'))).toBe(false);
    expect(await exists(join(dir, 'foo/.disabled'))).toBe(false);
  });

  it('fails with no files written when the package holds nothing installable', async () => {
    const zip = makeZip([{ name: 'extension.json', data: manifest }]);
    const inspection = inspectPackage(zip, OPTS);
    // the manifest alone is installable; an inspection whose every entry is protected is not
    const hollow = {
      ...inspection,
      entries: inspection.entries.map((e) => ({ ...e, name: '.env' })),
    };
    await expect(installPackage(zip, hollow, dir)).rejects.toMatchObject({
      message: 'The ZIP contained no installable files.',
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it('a second install of the same slug overwrites in place', async () => {
    const v1 = makeZip([
      { name: 'extension.json', data: manifest },
      { name: 'a.txt', data: 'one' },
    ]);
    const v2 = makeZip([
      { name: 'extension.json', data: manifestJson({ slug: 'foo', version: '2.0.0' }) },
      { name: 'a.txt', data: 'two' },
    ]);
    await installPackage(v1, inspectPackage(v1, OPTS), dir);
    const res = await installPackage(v2, inspectPackage(v2, OPTS), dir);
    expect(res.written).toBe(2);
    expect(await readFile(join(dir, 'foo/a.txt'), 'utf8')).toBe('two');
  });

  it('path predicates', () => {
    expect(isSafeRelative('a/b.txt')).toBe(true);
    for (const bad of ['', '../a', 'a/../b', '/a', 'C:/a', 'a\\b', 'a\0b'])
      expect(isSafeRelative(bad), bad).toBe(false);
    expect(isProtectedPath('vendor')).toBe(true);
    expect(isProtectedPath('vendor/x')).toBe(true);
    expect(isProtectedPath('vendors/x')).toBe(false);
    expect(isProtectedPath('config/license.php')).toBe(true);
    expect(isProtectedPath('config/other.php')).toBe(false);
  });
});

describe('uninstall (TW-ADD-008)', () => {
  const manifest = manifestJson({ slug: 'foo' });

  it('deletes only tracked files, keeps hand-added ones, prunes empty folders', async () => {
    const zip = makeZip([
      { name: 'extension.json', data: manifest },
      { name: 'a/b/c.txt', data: 'x' },
      { name: 'keep/d.txt', data: 'x' },
    ]);
    const { files } = await installPackage(zip, inspectPackage(zip, OPTS), dir);
    await writeFile(join(dir, 'foo/keep/hand-added.txt'), 'mine');

    const removed = await removeFiles(dir, files);
    expect(removed).toBe(3);
    expect(await exists(join(dir, 'foo/a'))).toBe(false); // emptied and pruned upward
    expect(await exists(join(dir, 'foo/keep/hand-added.txt'))).toBe(true); // untracked: survives
    expect(await exists(join(dir, 'foo/keep/d.txt'))).toBe(false);
    expect(await exists(join(dir, 'foo/extension.json'))).toBe(false); // so the leftover is no longer a module
    expect(await exists(dir)).toBe(true); // never at or above the modules directory
  });

  it('ignores tracked entries that climb out or are protected', async () => {
    const outside = join(dir, '..', `outside-${Date.now()}.txt`);
    await writeFile(outside, 'precious');
    await mkdir(join(dir, 'foo/vendor'), { recursive: true });
    await writeFile(join(dir, 'foo/vendor/lib.txt'), 'protected');
    await writeFile(join(dir, 'foo/.env'), 'secret');

    const removed = await removeFiles(dir, [
      `foo/../../${outside.split(/[\\/]/).pop()}`,
      'foo/vendor/lib.txt',
      'foo/.env',
      '../etc/passwd',
    ]);
    expect(removed).toBe(0);
    expect(await readFile(outside, 'utf8')).toBe('precious');
    expect(await exists(join(dir, 'foo/vendor/lib.txt'))).toBe(true);
    expect(await exists(join(dir, 'foo/.env'))).toBe(true);
    await rm(outside);
  });
});
