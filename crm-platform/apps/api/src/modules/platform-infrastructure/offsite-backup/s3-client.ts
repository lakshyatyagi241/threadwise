import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';

/**
 * The few S3 calls the off-host backup needs (PUT from a file, HEAD, list, GET to a file, DELETE), signed with AWS Signature V4.
 * No SDK: the API image has none and these providers (Cloudflare R2, S3, MinIO, ...) all accept plain SigV4. Mirrors the signer in
 * the platform-settings storage probe on purpose; that one lives in another domain and signs whole in-memory bodies, this one
 * streams files and signs a precomputed payload hash.
 */
export interface S3Config {
  /** Origin, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  /** `auto` for R2. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (`endpoint/bucket/key`): what R2 and MinIO want. */
  pathStyle: boolean;
}

export interface RemoteObject {
  key: string;
  size: number;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const encPath = (key: string) => key.split('/').map(enc).join('/');
export const EMPTY_SHA256 = sha256('');

interface SignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key: string;
  query?: Array<[string, string]>;
  payloadSha256: string;
  now?: Date;
}

/** URL and signed headers for one request (exported for tests). */
export function signRequest(
  c: S3Config,
  i: SignInput,
): { url: URL; headers: Record<string, string> } {
  const base = new URL(c.endpoint);
  const host = c.pathStyle ? base.host : `${c.bucket}.${base.host}`;
  const path =
    (c.pathStyle ? `/${enc(c.bucket)}` : '') + (i.key === '' ? '/' : `/${encPath(i.key)}`);
  const canonicalQuery = (i.query ?? [])
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .sort()
    .join('&');
  const amzDate = (i.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [
    i.method,
    path,
    canonicalQuery,
    `host:${host}\nx-amz-content-sha256:${i.payloadSha256}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    i.payloadSha256,
  ].join('\n');
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${c.secretAccessKey}`, day), c.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    url: new URL(`${base.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`),
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': i.payloadSha256,
      authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export class S3Client {
  constructor(readonly config: S3Config) {}

  private send(
    method: SignInput['method'],
    key: string,
    opts: {
      query?: Array<[string, string]>;
      payloadSha256?: string;
      file?: { path: string; size: number };
      sinkPath?: string;
    } = {},
  ): Promise<RawResponse> {
    const { url, headers } = signRequest(this.config, {
      method,
      key,
      query: opts.query,
      payloadSha256: opts.payloadSha256 ?? EMPTY_SHA256,
    });
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const hdrs: Record<string, string> = { ...headers };
    if (opts.file) hdrs['content-length'] = String(opts.file.size);
    return new Promise<RawResponse>((resolve, reject) => {
      const req = send(url, { method, headers: hdrs, timeout: 120_000 }, (res) => {
        const status = res.statusCode ?? 0;
        if (opts.sinkPath && status >= 200 && status < 300) {
          pipeline(res, createWriteStream(opts.sinkPath)).then(
            () => resolve({ status, headers: res.headers, body: Buffer.alloc(0) }),
            reject,
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      req.on('error', reject);
      if (opts.file) createReadStream(opts.file.path).on('error', reject).pipe(req);
      else req.end();
    });
  }

  private fail(res: RawResponse, what: string): never {
    const code = /<Code>([^<]{1,64})<\/Code>/.exec(res.body.toString('utf8'))?.[1];
    throw new S3Error(res.status, code, `${what}: HTTP ${res.status}${code ? ` ${code}` : ''}`);
  }

  /** Uploads a file. `sha256` is the hex SHA-256 of its bytes (it is part of the signature). */
  async put(key: string, path: string, size: number, sha256Hex: string): Promise<void> {
    const res = await this.send('PUT', key, { file: { path, size }, payloadSha256: sha256Hex });
    if (res.status < 200 || res.status >= 300) this.fail(res, `upload of ${key}`);
  }

  /** Size and ETag of an object, or null if it does not exist. */
  async head(key: string): Promise<{ size: number; etag: string } | null> {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) this.fail(res, `HEAD ${key}`);
    return {
      size: Number(res.headers['content-length'] ?? 0),
      etag: String(res.headers.etag ?? '').replace(/"/g, ''),
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    if (res.status !== 404 && (res.status < 200 || res.status >= 300))
      this.fail(res, `delete of ${key}`);
  }

  async get(key: string, destPath: string): Promise<void> {
    const res = await this.send('GET', key, { sinkPath: destPath });
    if (res.status < 200 || res.status >= 300) this.fail(res, `download of ${key}`);
  }

  /** Every object under `prefix`, following continuation tokens. */
  async list(prefix: string): Promise<RemoteObject[]> {
    const out: RemoteObject[] = [];
    let token: string | undefined;
    do {
      const query: Array<[string, string]> = [
        ['list-type', '2'],
        ['prefix', prefix],
      ];
      if (token) query.push(['continuation-token', token]);
      const res = await this.send('GET', '', { query });
      if (res.status < 200 || res.status >= 300) this.fail(res, `list ${prefix}`);
      const xml = res.body.toString('utf8');
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1];
        const size = /<Size>(\d+)<\/Size>/.exec(m[1]!)?.[1];
        if (key !== undefined) out.push({ key: unescapeXml(key), size: Number(size ?? 0) });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
      if (token) token = unescapeXml(token);
    } while (token);
    return out;
  }
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
