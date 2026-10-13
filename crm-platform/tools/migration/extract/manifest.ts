import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Source } from './source';

export interface ManifestEntry {
  collection: string;
  /** Lines that parse as a JSON object: the documents. */
  docs: number;
  /** Non-empty lines that do not parse (a truncated last line, for example). Reported, never counted as documents. */
  badLines: number;
  bytes: number;
  sha256: string;
}
export interface Manifest {
  client: string;
  generatedAt: string;
  collections: ManifestEntry[];
}

/** One streaming pass: sha256 of the bytes, bytes, documents and unparseable lines. */
export function hashFile(path: string): Promise<Omit<ManifestEntry, 'collection'>> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    let bytes = 0;
    let docs = 0;
    let badLines = 0;
    const input = createReadStream(path);
    input.on('data', (chunk) => {
      h.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
    });
    input.on('error', reject);
    const rl = createInterface({ input, crlfDelay: Infinity });
    let n = 0;
    rl.on('line', (line) => {
      n++;
      const t = (n === 1 && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line).trim();
      if (t === '') return;
      try {
        const v: unknown = JSON.parse(t);
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) docs++;
        else badLines++;
      } catch {
        badLines++;
      }
    });
    rl.on('close', () => resolve({ docs, badLines, bytes, sha256: h.digest('hex') }));
  });
}

export async function buildManifest(source: Source, client: string): Promise<Manifest> {
  const collections: ManifestEntry[] = [];
  for (const collection of source.collections(client)) {
    const f = source.fileOf(client, collection);
    if (!f) throw new Error('manifest needs a file-backed source');
    collections.push({ collection, ...(await hashFile(f)) });
  }
  return { client, generatedAt: new Date().toISOString(), collections };
}

export const manifestPath = (dumpsDir: string, client: string): string =>
  join(dumpsDir, client, 'manifest.json');

export async function writeManifest(
  source: Source,
  dumpsDir: string,
  client: string,
): Promise<Manifest> {
  const m = await buildManifest(source, client);
  writeFileSync(manifestPath(dumpsDir, client), JSON.stringify(m, null, 2));
  return m;
}

export function readManifest(dumpsDir: string, client: string): Manifest | null {
  const p = manifestPath(dumpsDir, client);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Manifest) : null;
}

/** Re-hash the dump and compare with manifest.json. Returns one message per difference (empty = identical). */
export async function verifyDump(
  source: Source,
  dumpsDir: string,
  client: string,
): Promise<string[]> {
  const m = readManifest(dumpsDir, client);
  if (!m)
    return [
      `NO_MANIFEST: run \`manifest --client ${client}\` before migrating so counts are fixed`,
    ];
  const out: string[] = [];
  const known = new Set(m.collections.map((c) => c.collection));
  for (const e of m.collections) {
    const f = source.fileOf(client, e.collection);
    if (!f || !existsSync(f)) {
      out.push(`DUMP_CHANGED: ${e.collection} is in the manifest but its file is gone`);
      continue;
    }
    const h = await hashFile(f);
    if (h.sha256 !== e.sha256) {
      out.push(
        `DUMP_CHANGED: ${e.collection} no longer matches the manifest (docs ${e.docs} -> ${h.docs}, sha256 differs)`,
      );
    }
  }
  for (const name of source.collections(client)) {
    if (!known.has(name))
      out.push(`NOT_IN_MANIFEST: ${name} appeared after the manifest was written`);
  }
  return out;
}
