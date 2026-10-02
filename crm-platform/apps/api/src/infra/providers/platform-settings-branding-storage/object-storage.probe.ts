import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Connection check for an S3-compatible bucket (TW-SET-039): write a small probe object, then delete it.
 *
 * No SDK: requests are signed here (AWS Signature V4), which every provider the settings page offers
 * (S3, Wasabi, Bunny, Spaces, R2, MinIO) accepts. Only the probe lives here; serving real uploads is the
 * file module's job and will reuse `resolveStorageTarget`.
 */

export interface StorageSettingsInput {
  provider: 's3' | 'wasabi' | 'bunny' | 'spaces' | 'r2' | 'minio';
  basePath: string;
  accessKeyId: string;
  region: string;
  bucket: string;
  endpoint: string;
  pathStyle: boolean;
  storageZone: string;
  secret: string | null;
  storagePassword: string | null;
}

export interface StorageTarget {
  /** Origin without a trailing slash, e.g. https://s3.eu-west-1.wasabisys.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secret: string;
  pathStyle: boolean;
  prefix: string;
}

const INCOMPLETE = 'Storage configuration is incomplete - fill in every required field first.';

/** Presets per provider, as the settings page describes them. Null when a required field is missing. */
export function resolveStorageTarget(s: StorageSettingsInput): StorageTarget | null {
  const prefix = s.basePath.replace(/^\/+|\/+$/g, '');
  if (s.provider === 'bunny') {
    if (!s.storageZone || !s.storagePassword) return null;
    const region = s.region && s.region !== 'de' ? `${s.region}.` : '';
    return {
      endpoint: s.endpoint
        ? stripBucket(s.endpoint, s.storageZone)
        : `https://${region}storage.bunnycdn.com`,
      region: 'auto',
      bucket: s.storageZone,
      accessKeyId: s.storageZone,
      secret: s.storagePassword,
      pathStyle: true,
      prefix,
    };
  }
  if (!s.accessKeyId || !s.secret || !s.bucket) return null;
  const region = s.region || 'us-east-1';
  let endpoint = s.endpoint;
  if (!endpoint) {
    if (s.provider === 'wasabi') endpoint = `https://s3.${region}.wasabisys.com`;
    else if (s.provider === 's3') endpoint = `https://s3.${region}.amazonaws.com`;
    else return null; // spaces, r2 and minio have no default host
  }
  return {
    endpoint: stripBucket(endpoint, s.bucket),
    region,
    bucket: s.bucket,
    accessKeyId: s.accessKeyId,
    secret: s.secret,
    pathStyle: s.pathStyle,
    prefix,
  };
}

/** R2 shows the S3 API URL with the bucket on the end; keeping it would double the bucket in every key URL. */
function stripBucket(endpoint: string, bucket: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith(`/${bucket}`) ? trimmed.slice(0, -(bucket.length + 1)) : trimmed;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();
const encodeSegment = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Builds the URL and the signed headers for one request (exported for the unit test). */
export function signS3Request(
  t: StorageTarget,
  method: 'PUT' | 'DELETE',
  key: string,
  body: Buffer,
  now: Date = new Date(),
): { url: string; headers: Record<string, string> } {
  const base = new URL(t.endpoint);
  const host = t.pathStyle ? base.host : `${t.bucket}.${base.host}`;
  const path =
    (t.pathStyle ? `/${encodeSegment(t.bucket)}` : '') +
    '/' +
    key.split('/').map(encodeSegment).join('/');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [
    method,
    path,
    '',
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${t.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${t.secret}`, day), t.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    url: `${base.protocol}//${host}${path}`,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/**
 * A time-limited GET link for a private object (query-string SigV4). Reference labelled private mode "signed URLs" but never
 * made one, so private media broke; this is the real thing (TW-SET-040 rule 5).
 */
export function presignS3Get(
  t: StorageTarget,
  key: string,
  ttlSeconds: number,
  now: Date = new Date(),
): string {
  const base = new URL(t.endpoint);
  const host = t.pathStyle ? base.host : `${t.bucket}.${base.host}`;
  const path =
    (t.pathStyle ? `/${encodeSegment(t.bucket)}` : '') +
    '/' +
    key.split('/').map(encodeSegment).join('/');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${t.region}/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${t.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.min(604800, Math.max(1, Math.floor(ttlSeconds))))],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = query
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
    .sort()
    .join('&');
  const canonical = [
    'GET',
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${t.secret}`, day), t.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `${base.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

@Injectable()
export class ObjectStorageProbe {
  async probe(s: StorageSettingsInput): Promise<{ ok: boolean; message: string }> {
    const target = resolveStorageTarget(s);
    if (!target) return { ok: false, message: INCOMPLETE };
    const key = [target.prefix, 'connection-tests', `${randomBytes(6).toString('hex')}.txt`]
      .filter(Boolean)
      .join('/');
    const body = Buffer.from('Connection test from the platform settings page. Safe to delete.');
    try {
      const put = signS3Request(target, 'PUT', key, body);
      const putRes = await fetch(put.url, {
        method: 'PUT',
        headers: put.headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!putRes.ok) return { ok: false, message: `Connection failed: ${await describe(putRes)}` };
      const del = signS3Request(target, 'DELETE', key, Buffer.alloc(0));
      const delRes = await fetch(del.url, {
        method: 'DELETE',
        headers: del.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!delRes.ok) {
        return {
          ok: false,
          message: `Connection failed: written but not deletable (${await describe(delRes)})`,
        };
      }
      return { ok: true, message: 'Connection successful - the bucket is reachable and writable.' };
    } catch (err) {
      return { ok: false, message: `Connection failed: ${(err as Error).message}` };
    }
  }
}

/** "HTTP 403 SignatureDoesNotMatch": the status and the provider's error code, never the response body. */
async function describe(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  const code = /<Code>([^<]{1,64})<\/Code>/.exec(text)?.[1];
  return code ? `HTTP ${res.status} ${code}` : `HTTP ${res.status}`;
}
