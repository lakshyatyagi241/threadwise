import { closeSync, createReadStream, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Doc } from '../util';
import { parseEjsonLine } from './ejson';

export interface BadLine {
  client: string;
  collection: string;
  file: string;
  line: number;
  error: string;
  bytes: number;
}

/** Where documents come from. Everything downstream (coverage, loader, reconcile) talks only to this. */
export interface Source {
  clients(): string[];
  collections(client: string): string[];
  read(client: string, collection: string): AsyncIterable<Doc>;
  /** Absolute path of the raw file when the source is a file (for hashing), else null. */
  fileOf(client: string, collection: string): string | null;
  /** Lines that could not be parsed while reading (deduplicated). The raw text is never kept: it can hold PII. */
  badLines(client: string): BadLine[];
  /**
   * Optional (the inbox step needs it): documents with the byte position of their line, in file order, and a way to read one back.
   * Lines that are not valid JSON objects are skipped silently here (`read` is what records them).
   */
  readIndexed?(
    client: string,
    collection: string,
  ): AsyncIterable<{ doc: Doc; offset: number; length: number }>;
  readAt?(client: string, collection: string, offset: number, length: number): Promise<Doc>;
}

export class NdjsonDirSource implements Source {
  private readonly bad = new Map<string, BadLine>();
  constructor(private readonly dir: string) {}

  clients(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }

  collections(client: string): string[] {
    return readdirSync(join(this.dir, client))
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => f.slice(0, -'.ndjson'.length))
      .sort();
  }

  fileOf(client: string, collection: string): string | null {
    return join(this.dir, client, `${collection}.ndjson`);
  }

  badLines(client: string): BadLine[] {
    return [...this.bad.values()].filter((b) => b.client === client);
  }

  async *readIndexed(
    client: string,
    collection: string,
  ): AsyncIterable<{ doc: Doc; offset: number; length: number }> {
    const file = this.fileOf(client, collection)!;
    let offset = 0; // byte position of the start of the current line
    let pending: Buffer[] = [];
    const out: Array<{ doc: Doc; offset: number; length: number }> = [];
    const take = (parts: Buffer[]): void => {
      let line = parts.length === 1 ? parts[0]! : Buffer.concat(parts);
      let at = offset;
      offset += line.length + 1;
      if (at === 0 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) {
        line = line.subarray(3); // UTF-8 BOM
        at = 3;
      }
      const text = line.toString('utf8');
      if (text.trim() === '') return;
      try {
        const doc = parseEjsonLine(text);
        if (doc !== null && typeof doc === 'object' && !Array.isArray(doc))
          out.push({ doc, offset: at, length: line.length });
      } catch {
        /* recorded by read() */
      }
    };
    for await (const chunk of createReadStream(file)) {
      const buf = chunk as Buffer;
      let start = 0;
      for (;;) {
        const nl = buf.indexOf(0x0a, start);
        if (nl < 0) {
          pending.push(buf.subarray(start));
          break;
        }
        pending.push(buf.subarray(start, nl));
        take(pending);
        pending = [];
        start = nl + 1;
      }
      while (out.length > 0) yield out.shift()!;
    }
    if (pending.some((p) => p.length > 0)) take(pending); // last line without a newline
    while (out.length > 0) yield out.shift()!;
  }

  async readAt(client: string, collection: string, offset: number, length: number): Promise<Doc> {
    const fd = openSync(this.fileOf(client, collection)!, 'r');
    try {
      const buf = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const n = readSync(fd, buf, got, length - got, offset + got);
        if (n === 0) break;
        got += n;
      }
      return parseEjsonLine(buf.subarray(0, got).toString('utf8'));
    } finally {
      closeSync(fd);
    }
  }

  async *read(client: string, collection: string): AsyncIterable<Doc> {
    const file = this.fileOf(client, collection)!;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    let n = 0;
    for await (let line of rl) {
      n++;
      if (n === 1 && line.charCodeAt(0) === 0xfeff) line = line.slice(1); // UTF-8 BOM
      if (line.trim() === '') continue;
      try {
        const doc = parseEjsonLine(line);
        if (doc === null || typeof doc !== 'object' || Array.isArray(doc))
          throw new Error('not a JSON object');
        yield doc;
      } catch (e) {
        this.bad.set(`${file}:${n}`, {
          client,
          collection,
          file,
          line: n,
          // V8's JSON messages quote a piece of the line, which may be personal data: keep the position only
          error: `not valid JSON${/position (\d+)/.exec(e instanceof Error ? e.message : '')?.[0] ? ` (${/position (\d+)/.exec((e as Error).message)![0]})` : ''}`,
          bytes: Buffer.byteLength(line),
        });
      }
    }
  }
}
