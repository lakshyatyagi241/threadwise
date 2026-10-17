import { createReadStream, createWriteStream } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import {
  EMPTY_SHA256,
  signS3Request,
  type S3SignInput,
  type S3SigningConfig,
} from '../../../infra/net/s3-sigv4';

/**
 * The few S3 calls the off-host backup needs (PUT from a file, HEAD, list, GET to a file, DELETE), signed with AWS Signature V4
 * (the shared signer in infra/net). No SDK: the API image has none and these providers (Cloudflare R2, S3, MinIO, ...) all accept
 * plain SigV4. This client streams files and signs a precomputed payload hash.
 */
export type S3Config = S3SigningConfig;

export interface RemoteObject {
  key: string;
  size: number;
}

export { EMPTY_SHA256 };

/** URL and signed headers for one request (exported for tests). */
export function signRequest(
  c: S3Config,
  i: S3SignInput,
): { url: URL; headers: Record<string, string> } {
  return signS3Request(c, i);
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
    method: S3SignInput['method'],
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
