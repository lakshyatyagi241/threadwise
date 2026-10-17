import type { Readable } from 'node:stream';

/**
 * Where cold event archives live: one gzipped NDJSON object per workspace per month plus a manifest, written by the retention job when a
 * partition is closed and read back for drill-downs and exports (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md,
 * section 6). The retention module is written against this port; `local` (a directory, for development and tests) and `s3` (the
 * MinIO / S3 / R2 bucket) are its adapters.
 *
 * Objects can be larger than memory (one busy workspace for one month), so file and stream calls are the primary surface; `putBytes`
 * and `readBytes` exist for the small manifest.
 */
export interface ArchiveObject {
  key: string;
  bytes: number;
}

export interface ArchiveStorage {
  /** Uploads a local file, replacing any object at `key`. */
  putFile(key: string, path: string): Promise<void>;
  /** Writes a small object, replacing any object at `key`. */
  putBytes(key: string, data: Buffer): Promise<void>;
  /** Streams an object, or null when it does not exist. The caller must consume or destroy the stream. */
  openRead(key: string): Promise<Readable | null>;
  /** Every object under a directory prefix (`a/b/`), sorted by key. */
  list(prefix: string): Promise<ArchiveObject[]>;
  /** Removes one object. A missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Removes every object under a directory prefix and returns how many. */
  deletePrefix(prefix: string): Promise<number>;
}

/** Nest injection token. Bind it to an adapter; never inject an adapter class directly. */
export const ARCHIVE_STORAGE = Symbol('ARCHIVE_STORAGE');

const SEGMENT = /^[A-Za-z0-9_=-][A-Za-z0-9._=-]*$/;

/**
 * Keys are built by this code from stream names, months and workspace ids, never from request input. They are still checked, so a
 * bug cannot turn into a path traversal on the local adapter or a signing surprise on the S3 one: segments of letters, digits and
 * `_ . = -`, no empty segment, no segment starting with a dot.
 */
export function assertArchiveKey(key: string): void {
  const segments = key.split('/');
  if (key === '' || segments.some((s) => !SEGMENT.test(s))) {
    throw new Error(`invalid archive key: ${JSON.stringify(key)}`);
  }
}

/** A prefix is a non-empty directory path ending in `/`, so `a/b-1/` never matches `a/b-10/`. */
export function assertArchivePrefix(prefix: string): void {
  if (!prefix.endsWith('/'))
    throw new Error(`archive prefix must end with "/": ${JSON.stringify(prefix)}`);
  assertArchiveKey(prefix.slice(0, -1));
}

/** Reads a whole stream into memory. For manifests; never for archive objects. */
export async function readAll(stream: Readable, maxBytes = 16 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error(`archive object larger than ${maxBytes} bytes read into memory`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** The whole object, or null when it does not exist. For manifests. */
export async function readBytes(
  storage: ArchiveStorage,
  key: string,
  maxBytes?: number,
): Promise<Buffer | null> {
  const stream = await storage.openRead(key);
  return stream ? readAll(stream, maxBytes) : null;
}
