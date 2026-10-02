import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalDiskMediaStore,
  isSafeMediaKey,
} from '../../../../src/infra/providers/chat-conversations/media/local-disk-media.store';

let sandbox: string;
let root: string;
let store: LocalDiskMediaStore;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'crm-media-'));
});
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await mkdtemp(join(sandbox, 'root-'));
  store = new LocalDiskMediaStore(root);
});

const read = async (key: string) => {
  const opened = await store.open(key);
  if (!opened) return null;
  const chunks: Buffer[] = [];
  for await (const c of opened.stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};

describe('isSafeMediaKey', () => {
  it.each([
    'chat/3/2026/10/1790000000_ab12cd34ef56.png',
    'a',
    'chat/7/2026/10/file.name-with_dots.pdf',
  ])('accepts %s', (key) => expect(isSafeMediaKey(key)).toBe(true));

  it.each([
    '',
    '/etc/passwd',
    '../x',
    'chat/../x',
    'chat/./x',
    'chat//x',
    'chat/x/',
    '.hidden',
    'chat/.hidden/x',
    'chat\\x',
    'C:/x',
    'c:\\x',
    'chat/%2e%2e/x',
    'chat/UPPER/x',
    'chat/with space/x',
    'chat/x\u0000.png',
    'a/b/c/d/e/f/g/h/i',
    `chat/${'a'.repeat(200)}`,
  ])('refuses %j', (key) => expect(isSafeMediaKey(key)).toBe(false));
});

describe('LocalDiskMediaStore', () => {
  it('stores and reads back the same bytes', async () => {
    const bytes = Buffer.from('hello media');
    await store.put('chat/3/2026/10/a.txt', bytes);
    expect(await read('chat/3/2026/10/a.txt')).toEqual(bytes);
    expect(await store.stat('chat/3/2026/10/a.txt')).toEqual({ size: bytes.length });
  });

  it('leaves no temp file behind after a write', async () => {
    await store.put('chat/3/a.bin', Buffer.alloc(10, 1));
    expect(await readdir(join(root, 'chat', '3'))).toEqual(['a.bin']);
  });

  it('answers null for a file that is not there, and for a directory', async () => {
    await store.put('chat/3/a.bin', Buffer.alloc(1));
    expect(await store.stat('chat/3/missing.bin')).toBeNull();
    expect(await store.open('chat/3/missing.bin')).toBeNull();
    expect(await store.stat('chat/3')).toBeNull();
  });

  it('serves a byte range, end inclusive, and clamps an end beyond the file', async () => {
    await store.put('chat/3/r.bin', Buffer.from('0123456789'));
    const part = await store.open('chat/3/r.bin', { start: 2, end: 4 });
    expect([part?.start, part?.end, part?.size]).toEqual([2, 4, 10]);
    const chunks: Buffer[] = [];
    for await (const c of part!.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('234');

    const tail = await store.open('chat/3/r.bin', { start: 7, end: 999 });
    expect([tail?.start, tail?.end]).toEqual([7, 9]);
    expect(await store.open('chat/3/r.bin', { start: 10 })).toBeNull();
  });

  it('removes a file, and removing a missing one is fine', async () => {
    await store.put('chat/3/d.bin', Buffer.alloc(1));
    await store.remove('chat/3/d.bin');
    expect(await store.stat('chat/3/d.bin')).toBeNull();
    await expect(store.remove('chat/3/d.bin')).resolves.toBeUndefined();
  });

  describe('path traversal', () => {
    it('refuses every unsafe key on every operation, and writes nothing outside the root', async () => {
      const outside = join(sandbox, 'outside.txt');
      for (const key of [
        '../outside.txt',
        'chat/../../outside.txt',
        '/outside.txt',
        'chat\\..\\outside.txt',
      ]) {
        await expect(store.put(key, Buffer.from('x'))).rejects.toThrow('unsafe media key');
        await expect(store.stat(key)).rejects.toThrow('unsafe media key');
        await expect(store.open(key)).rejects.toThrow('unsafe media key');
        await expect(store.remove(key)).rejects.toThrow('unsafe media key');
      }
      await expect(readFile(outside)).rejects.toThrow();
    });

    it('does not follow a link planted inside the tree', async () => {
      await writeFile(join(sandbox, 'secret.txt'), 'top secret');
      await mkdir(join(root, 'chat'), { recursive: true });
      try {
        await symlink(join(sandbox, 'secret.txt'), join(root, 'chat', 'link.txt'));
        await symlink(sandbox, join(root, 'escape'), 'junction');
      } catch {
        return; // This machine does not allow links for this user: nothing to prove.
      }
      expect(await store.stat('chat/link.txt')).toBeNull();
      await expect(store.put('escape/x.txt', Buffer.from('x'))).rejects.toThrow('unsafe media key');
      await expect(readFile(join(sandbox, 'x.txt'))).rejects.toThrow();
    });
  });
});
