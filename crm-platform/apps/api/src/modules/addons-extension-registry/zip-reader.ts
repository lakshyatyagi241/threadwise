import { crc32, inflateRawSync } from 'node:zlib';

/**
 * A small read-only ZIP reader (no dependency): central directory, stored and deflated entries, nothing else.
 *
 * Hostile input is the normal case here, so every length is bounds-checked, an entry is only inflated up to its
 * declared size (a lying header cannot expand past it), and the CRC is verified. Encrypted archives, ZIP64 and
 * multi-disk archives are refused, not guessed at.
 */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  compressedSize: number;
  method: number;
  crc: number;
  offset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function readZip(buf: Buffer, limits: { maxEntries: number }): ZipEntry[] {
  if (buf.length < 22) throw new ZipError('too small to be a ZIP archive');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('end of central directory not found');
  const disk = buf.readUInt16LE(eocd + 4);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || buf.readUInt16LE(eocd + 6) !== 0)
    throw new ZipError('multi-disk archives are not supported');
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }
  if (total > limits.maxEntries) throw new ZipError(`more than ${limits.maxEntries} entries`);
  if (cdOffset + cdSize > buf.length) throw new ZipError('central directory is out of bounds');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG)
      throw new ZipError('bad central directory entry');
    const flags = buf.readUInt16LE(p + 8);
    if (flags & 0x1) throw new ZipError('encrypted archives are not supported');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > buf.length) throw new ZipError('entry name is out of bounds');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry, verified against its declared size and CRC. */
export function readEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const o = entry.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== LOC_SIG)
    throw new ZipError(`bad local header for ${entry.name}`);
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ZipError(`${entry.name} runs past the end of the archive`);
  const raw = buf.subarray(start, end);

  let data: Buffer;
  if (entry.method === 0) data = Buffer.from(raw);
  else if (entry.method === 8) {
    try {
      // one byte of headroom: an entry that inflates past its declared size fails instead of truncating silently
      data = inflateRawSync(raw, { maxOutputLength: entry.size + 1 });
    } catch {
      throw new ZipError(`${entry.name} could not be decompressed`);
    }
  } else throw new ZipError(`${entry.name} uses an unsupported compression method`);

  if (data.length !== entry.size)
    throw new ZipError(`${entry.name} does not match its declared size`);
  if (crc32(data) !== entry.crc) throw new ZipError(`${entry.name} is corrupt (checksum mismatch)`);
  return data;
}
