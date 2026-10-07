import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ObjectStorageProbe,
  resolveStorageTarget,
  signS3Request,
  type StorageSettingsInput,
} from '../../../src/infra/providers/platform-settings-branding-storage/object-storage.probe';

const base = (over: Partial<StorageSettingsInput> = {}): StorageSettingsInput => ({
  provider: 's3',
  basePath: '',
  accessKeyId: 'AKIDEXAMPLE',
  region: '',
  bucket: 'media',
  endpoint: '',
  pathStyle: true,
  storageZone: '',
  secret: 'sekret',
  storagePassword: null,
  ...over,
});

describe('storage presets (WD-SET-039, 040)', () => {
  it('is incomplete without key, secret and bucket (bunny: zone and password)', () => {
    expect(resolveStorageTarget(base({ secret: null }))).toBeNull();
    expect(resolveStorageTarget(base({ bucket: '' }))).toBeNull();
    expect(resolveStorageTarget(base({ provider: 'bunny', storageZone: 'z' }))).toBeNull();
  });

  it('S3 and Wasabi derive their host from the region; Spaces, R2 and MinIO need an endpoint', () => {
    expect(resolveStorageTarget(base({ region: 'eu-west-1' }))!.endpoint).toBe(
      'https://s3.eu-west-1.amazonaws.com',
    );
    expect(resolveStorageTarget(base({ provider: 'wasabi', region: 'us-east-2' }))!.endpoint).toBe(
      'https://s3.us-east-2.wasabisys.com',
    );
    expect(resolveStorageTarget(base({ provider: 'r2' }))).toBeNull();
    expect(
      resolveStorageTarget(base({ provider: 'minio', endpoint: 'http://minio:9000' })),
    ).not.toBeNull();
  });

  it('strips a trailing /<bucket> from the endpoint (R2 shows it that way)', () => {
    const t = resolveStorageTarget(
      base({ provider: 'r2', endpoint: 'https://acct.r2.cloudflarestorage.com/media/' }),
    )!;
    expect(t.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
  });

  it('Bunny uses the storage zone as key and bucket and the zone region for the host', () => {
    const t = resolveStorageTarget(
      base({ provider: 'bunny', storageZone: 'zone1', storagePassword: 'pw', region: 'ny' }),
    )!;
    expect(t).toMatchObject({
      endpoint: 'https://ny.storage.bunnycdn.com',
      bucket: 'zone1',
      accessKeyId: 'zone1',
      secret: 'pw',
    });
    expect(
      resolveStorageTarget(base({ provider: 'bunny', storageZone: 'z', storagePassword: 'p' }))!
        .endpoint,
    ).toBe('https://storage.bunnycdn.com');
  });
});

describe('SigV4 signing', () => {
  const target = resolveStorageTarget(
    base({ provider: 'minio', endpoint: 'http://127.0.0.1:9000' }),
  )!;

  it('is deterministic and puts the key under the bucket (path style) or the host (virtual style)', () => {
    const at = new Date('2026-01-02T03:04:05Z');
    const a = signS3Request(target, 'PUT', 'a/b c.txt', Buffer.from('x'), at);
    const b = signS3Request(target, 'PUT', 'a/b c.txt', Buffer.from('x'), at);
    expect(a).toEqual(b);
    expect(a.url).toBe('http://127.0.0.1:9000/media/a/b%20c.txt');
    expect(a.headers['x-amz-date']).toBe('20260102T030405Z');
    expect(a.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    const virtual = signS3Request(
      { ...target, pathStyle: false },
      'PUT',
      'k',
      Buffer.from('x'),
      at,
    );
    expect(virtual.url).toBe('http://media.127.0.0.1:9000/k');
  });

  it('the signature depends on the secret, the body and the date', () => {
    const at = new Date('2026-01-02T03:04:05Z');
    const sig = (t = target, body = 'x', d = at) =>
      signS3Request(t, 'PUT', 'k', Buffer.from(body), d).headers.authorization;
    expect(sig()).not.toBe(sig({ ...target, secret: 'other' }));
    expect(sig()).not.toBe(sig(target, 'y'));
    expect(sig()).not.toBe(sig(target, 'x', new Date('2026-01-02T03:04:06Z')));
  });
});

let server: Server | undefined;
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = undefined;
});

async function stub(
  handler: (
    method: string,
    url: string,
    headers: Record<string, unknown>,
    body: string,
  ) => [number, string],
) {
  const seen: Array<{ method: string; url: string; headers: Record<string, unknown> }> = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers });
      const [status, text] = handler(req.method!, req.url!, req.headers, body);
      res.writeHead(status).end(text);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe('ObjectStorageProbe', () => {
  it('writes a probe object under the base path, deletes it, and says so', async () => {
    const { url, seen } = await stub((m) => [m === 'PUT' ? 200 : 204, '']);
    const r = await new ObjectStorageProbe().probe(
      base({ provider: 'minio', endpoint: url, basePath: '/platform/' }),
    );
    expect(r).toEqual({
      ok: true,
      message: 'Connection successful - the bucket is reachable and writable.',
    });
    expect(seen.map((s) => s.method)).toEqual(['PUT', 'DELETE']);
    expect(seen[0]!.url).toMatch(/^\/media\/platform\/connection-tests\/[0-9a-f]{12}\.txt$/);
    expect(seen[0]!.url).toBe(seen[1]!.url);
    expect(String(seen[0]!.headers.authorization)).toContain('AWS4-HMAC-SHA256');
  });

  it('reports the provider error code, not the response body, when the keys are wrong', async () => {
    const { url } = await stub(() => [
      403,
      '<Error><Code>SignatureDoesNotMatch</Code><Message>secret=zzz</Message></Error>',
    ]);
    const r = await new ObjectStorageProbe().probe(base({ provider: 'minio', endpoint: url }));
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Connection failed: HTTP 403 SignatureDoesNotMatch');
    expect(r.message).not.toContain('zzz');
  });

  it('refuses an incomplete configuration without calling out', async () => {
    const r = await new ObjectStorageProbe().probe(base({ secret: null }));
    expect(r).toEqual({
      ok: false,
      message: 'Storage configuration is incomplete - fill in every required field first.',
    });
  });

  it('reports an unreachable host', async () => {
    const r = await new ObjectStorageProbe().probe(
      base({ provider: 'minio', endpoint: 'http://127.0.0.1:1' }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^Connection failed: /);
  });
});
