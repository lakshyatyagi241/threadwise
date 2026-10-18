import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';
import { EMPTY_SHA256, signS3Request, type S3SigningConfig } from '../../net/s3-sigv4';
import {
  assertArchiveKey,
  assertArchivePrefix,
  isArchivePrefix,
  type ArchiveObject,
  type ArchiveStorage,
} from './archive-storage.port';

/** Where the bucket is and how to sign for it. `pathStyle` is `endpoint/bucket/key` (some S3-compatible stores) rather than `bucket.endpoint/key`. */
export type S3ArchiveConfig = S3SigningConfig;

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const LIST_PAGE = 1000;
const DELETE_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 120_000;

export class S3ArchiveError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

type Body =
  { kind: 'none' } | { kind: 'bytes'; data: Buffer } | { kind: 'file'; path: string; size: number };

/** Archive objects in an S3-compatible bucket (S3, R2), signed with SigV4 and no SDK. The bucket is created on first write. */
export class S3ArchiveStorage implements ArchiveStorage {
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly config: S3ArchiveConfig) {}

  private raw(
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    key: string,
    opts: { query?: Array<[string, string]>; body?: Body; payloadSha256?: string } = {},
  ): Promise<IncomingMessage> {
    const body = opts.body ?? { kind: 'none' };
    const payload =
      opts.payloadSha256 ?? (body.kind === 'bytes' ? sha256(body.data) : EMPTY_SHA256);
    const { url, headers } = signS3Request(this.config, {
      method,
      key,
      query: opts.query,
      payloadSha256: payload,
    });
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const hdrs: Record<string, string> = { ...headers };
    if (body.kind === 'bytes') hdrs['content-length'] = String(body.data.length);
    if (body.kind === 'file') hdrs['content-length'] = String(body.size);
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = send(url, { method, headers: hdrs, timeout: REQUEST_TIMEOUT_MS }, resolve);
      req.on('timeout', () => req.destroy(new Error('archive storage request timed out')));
      req.on('error', reject);
      if (body.kind === 'file')
        createReadStream(body.path)
          .on('error', (e) => req.destroy(e))
          .pipe(req);
      else if (body.kind === 'bytes') req.end(body.data);
      else req.end();
    });
  }

  private async drain(res: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private async fail(res: IncomingMessage, what: string): Promise<never> {
    const code = /<Code>([^<]{1,64})<\/Code>/.exec((await this.drain(res)).toString('utf8'))?.[1];
    throw new S3ArchiveError(
      res.statusCode ?? 0,
      code,
      `${what}: HTTP ${res.statusCode}${code ? ` ${code}` : ''}`,
    );
  }

  /** Creates the bucket once per process. A 409 means it already exists (or is being created) and is fine. */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const res = await this.raw('PUT', '');
      const status = res.statusCode ?? 0;
      if ((status >= 200 && status < 300) || status === 409) {
        res.resume();
        return;
      }
      await this.fail(res, `create bucket ${this.config.bucket}`);
    })().catch((err) => {
      this.bucketReady = null;
      throw err;
    });
    return this.bucketReady;
  }

  /** PUT, creating the bucket and retrying once when the server says it does not exist. */
  private async write(key: string, body: Body, payloadSha256: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.raw('PUT', key, { body, payloadSha256 });
      const status = res.statusCode ?? 0;
      if (status >= 200 && status < 300) {
        res.resume();
        return;
      }
      const code = /<Code>([^<]{1,64})<\/Code>/.exec((await this.drain(res)).toString('utf8'))?.[1];
      if (attempt === 0 && status === 404 && code === 'NoSuchBucket') {
        this.bucketReady = null;
        await this.ensureBucket();
        continue;
      }
      throw new S3ArchiveError(
        status,
        code,
        `upload of ${key}: HTTP ${status}${code ? ` ${code}` : ''}`,
      );
    }
  }

  async putFile(key: string, path: string): Promise<void> {
    assertArchiveKey(key);
    const size = (await stat(path)).size;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    await this.write(key, { kind: 'file', path, size }, hash.digest('hex'));
  }

  async putBytes(key: string, data: Buffer): Promise<void> {
    assertArchiveKey(key);
    await this.write(key, { kind: 'bytes', data }, sha256(data));
  }

  async openRead(key: string): Promise<Readable | null> {
    assertArchiveKey(key);
    const res = await this.raw('GET', key);
    const status = res.statusCode ?? 0;
    if (status >= 200 && status < 300) return res;
    if (status === 404) {
      res.resume();
      return null;
    }
    return this.fail(res, `download of ${key}`);
  }

  /**
   * One listing under `prefix`, following continuation tokens. With a delimiter the server groups keys by the next `/` and
   * returns the groups as `dirs` instead of the keys inside them, so a directory is one entry however many objects it holds.
   */
  private async listPages(
    prefix: string,
    delimiter?: string,
  ): Promise<{ objects: ArchiveObject[]; dirs: string[] }> {
    const objects: ArchiveObject[] = [];
    const dirs: string[] = [];
    let token: string | undefined;
    do {
      const query: Array<[string, string]> = [
        ['list-type', '2'],
        ['max-keys', String(LIST_PAGE)],
        ['prefix', prefix],
      ];
      if (delimiter) query.push(['delimiter', delimiter]);
      if (token) query.push(['continuation-token', token]);
      const res = await this.raw('GET', '', { query });
      const status = res.statusCode ?? 0;
      if (status === 404) {
        res.resume();
        return { objects: [], dirs: [] }; // no bucket yet, so nothing archived
      }
      if (status < 200 || status >= 300) return this.fail(res, `list ${prefix}`);
      const xml = (await this.drain(res)).toString('utf8');
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1];
        const size = /<Size>(\d+)<\/Size>/.exec(m[1]!)?.[1];
        if (key !== undefined) objects.push({ key: unescapeXml(key), bytes: Number(size ?? 0) });
      }
      for (const m of xml.matchAll(
        /<CommonPrefixes>\s*<Prefix>([\s\S]*?)<\/Prefix>\s*<\/CommonPrefixes>/g,
      )) {
        dirs.push(unescapeXml(m[1]!));
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
      if (token) token = unescapeXml(token);
    } while (token);
    return { objects, dirs };
  }

  async list(prefix: string): Promise<ArchiveObject[]> {
    assertArchivePrefix(prefix);
    const { objects } = await this.listPages(prefix);
    return objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async listDirs(prefix: string): Promise<string[]> {
    assertArchivePrefix(prefix);
    const { dirs } = await this.listPages(prefix, '/');
    return dirs
      .filter((dir) => dir.startsWith(prefix) && dir.endsWith('/') && isArchivePrefix(dir))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Looks first, because a bucket answers DELETE the same way whether or not the object was there. */
  async delete(key: string): Promise<boolean> {
    assertArchiveKey(key);
    const head = await this.raw('HEAD', key);
    const status = head.statusCode ?? 0;
    if (status === 404) {
      head.resume();
      return false;
    }
    if (status < 200 || status >= 300) return this.fail(head, `look up ${key}`);
    head.resume();
    await this.remove(key);
    return true;
  }

  private async remove(key: string): Promise<void> {
    const res = await this.raw('DELETE', key);
    const status = res.statusCode ?? 0;
    if (status === 404 || (status >= 200 && status < 300)) {
      res.resume();
      return;
    }
    await this.fail(res, `delete of ${key}`);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const objects = await this.list(prefix);
    for (let i = 0; i < objects.length; i += DELETE_CONCURRENCY) {
      await Promise.all(objects.slice(i, i + DELETE_CONCURRENCY).map((o) => this.remove(o.key)));
    }
    return objects.length;
  }
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
