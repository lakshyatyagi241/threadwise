import { describe, expect, it } from 'vitest';
import { buildZip } from '../../../src/modules/privacy/engine/zip';
import {
  readEntry,
  readEntryAsync,
  readZip,
} from '../../../src/modules/addons-extension-registry/zip-reader';

// EL-B08: the data-subject export zip deflates on the thread pool and checksums with zlib's native crc32. The reader in the add-ons
// module is an independent implementation that verifies size and CRC of every entry, so a zip it accepts is a valid zip.
describe('privacy export zip', () => {
  const entries = [
    { name: 'README.txt', data: Buffer.from('hello'.repeat(2_000)) }, // compresses
    { name: 'data/ünïcode ✓.json', data: Buffer.from('{"a":1}') }, // UTF-8 name, tiny
    { name: 'empty.txt', data: Buffer.alloc(0) },
    {
      name: 'random.bin',
      data: Buffer.from(Array.from({ length: 4_096 }, (_, i) => (i * 2654435761) & 0xff)),
    },
  ];

  it('builds an archive the independent reader accepts, byte for byte', async () => {
    const zip = await buildZip(entries, new Date('2026-10-18T10:00:00Z'));
    const read = readZip(zip, { maxEntries: 10 });
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, e] of read.entries()) {
      expect((await readEntryAsync(zip, e)).equals(entries[i]!.data), e.name).toBe(true);
      expect(readEntry(zip, e).equals(entries[i]!.data), e.name).toBe(true);
    }
  });

  it('stores what does not shrink and deflates what does', async () => {
    const read = readZip(await buildZip(entries), { maxEntries: 10 });
    const method = Object.fromEntries(read.map((e) => [e.name, e.method]));
    expect(method['README.txt']).toBe(8);
    expect(method['data/ünïcode ✓.json']).toBe(0);
  });

  it('is deterministic for the same input and clock', async () => {
    const now = new Date('2026-10-18T10:00:00Z');
    expect((await buildZip(entries, now)).equals(await buildZip(entries, now))).toBe(true);
  });

  it('refuses more entries than a plain zip can hold', async () => {
    const many = Array.from({ length: 65_536 }, (_, i) => ({
      name: `f${i}`,
      data: Buffer.alloc(0),
    }));
    await expect(buildZip(many)).rejects.toThrow('too many entries');
  });
});
