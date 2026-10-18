import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature V4 for the S3 calls made with plain HTTP and no SDK (the API image has none; Cloudflare R2 and AWS S3 both accept
 * plain SigV4). One implementation shared by the off-host backup client and the cold-archive adapter, so a fix to canonical-request or
 * encoding rules lands in both. The platform storage probe signs whole in-memory bodies with its own header set and is separate.
 */
export interface S3SigningConfig {
  /** Origin, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  /** `auto` for R2. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (`endpoint/bucket/key`): what some S3-compatible stores want. */
  pathStyle: boolean;
}

export interface S3SignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** Object key; `''` addresses the bucket itself. */
  key: string;
  query?: Array<[string, string]>;
  /** Hex SHA-256 of the body (it is part of the signature). */
  payloadSha256: string;
  now?: Date;
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

/** URL and signed headers for one request. */
export function signS3Request(
  c: S3SigningConfig,
  i: S3SignInput,
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
