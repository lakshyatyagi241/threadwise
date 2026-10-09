import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createECDH } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SET_GROUP_SCHEMAS } from '@crm/contracts';
import {
  BrandAssetsService,
  sniffImage,
} from '../../../src/modules/platform-settings-branding-storage/brand-assets.service';
import {
  MediaStorageService,
  normaliseKey,
} from '../../../src/modules/platform-settings-branding-storage/media-storage.service';
import { generateVapidKeyPair } from '../../../src/modules/platform-settings-branding-storage/vapid.service';
import { presignS3Get } from '../../../src/infra/providers/platform-settings-branding-storage/object-storage.probe';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);

describe('image sniffing (TW-SET-010)', () => {
  it('reads the type from the bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('RIFF....WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('00000100010001', 'hex'))).toBe('image/x-icon');
    expect(sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'))).toBe(
      'image/svg+xml',
    );
    expect(sniffImage(Buffer.from('<svg viewBox="0 0 1 1"/>'))).toBe('image/svg+xml');
  });
  it('refuses a script or an HTML page dressed as an image', () => {
    expect(sniffImage(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><body><svg></svg></body></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('brand asset limits (TW-SET-010 rule 1)', () => {
  const svc = new BrandAssetsService({} as never, {} as never);
  const reject = async (slot: string, file: Buffer | undefined) => {
    await expect(svc.upload(slot, file, 1)).rejects.toMatchObject({ status: 422 });
  };

  it('an unknown slot, an empty upload and a wrong type are refused', async () => {
    await reject('nope', PNG);
    await reject('favicon', undefined);
    await reject('favicon', Buffer.from('not an image'));
  });

  it('a 600 KB favicon is refused (limit 512 KB) but a 900 KB logo is accepted by the size rule', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    await reject('favicon', big);
    // The logo passes validation and reaches the (absent) store: a TypeError here, not a validation error.
    const logo = Buffer.concat([PNG, Buffer.alloc(900 * 1024)]);
    await expect(svc.upload('logo-paper', logo, 1)).rejects.not.toMatchObject({ status: 422 });
  });

  it('an app icon takes png or webp only', async () => {
    await reject('pwa-192', Buffer.from('<svg viewBox="0 0 1 1"/>'));
  });
});

describe('VAPID key pair (TW-SET-038)', () => {
  it('is a P-256 pair in Web Push form and the halves belong together', () => {
    const { publicKey, privateKey } = generateVapidKeyPair();
    const pub = Buffer.from(publicKey, 'base64url');
    const priv = Buffer.from(privateKey, 'base64url');
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(0x04);
    expect(priv).toHaveLength(32);
    const check = createECDH('prime256v1');
    check.setPrivateKey(priv);
    expect(check.getPublicKey().toString('base64url')).toBe(publicKey);
    expect(generateVapidKeyPair().publicKey).not.toBe(publicKey);
  });
});

describe('media destination and URLs (TW-SET-040)', () => {
  const make = (storage: Record<string, unknown>, secrets: Record<string, string> = {}) =>
    new MediaStorageService({
      values: async () => SET_GROUP_SCHEMAS.storage.parse(storage),
      secret: async (_g: string, f: string) => secrets[f] ?? null,
    } as never);
  const complete = {
    enabled: true,
    provider: 'minio',
    endpoint: 'http://minio.test:9000',
    bucket: 'media',
    accessKeyId: 'AK',
    visibility: 'public',
  };

  it('a disabled or incomplete provider keeps media on the local disk', async () => {
    expect((await make({ ...complete, enabled: false }, { secret: 's' }).destination()).disk).toBe(
      'local',
    );
    expect((await make(complete, {}).destination()).disk).toBe('local'); // no secret saved
    const local = make({ enabled: false });
    expect(await local.url('chat-media/a.png')).toBe('/storage/chat-media/a.png');
    expect(await local.url('storage/chat-media/a.png')).toBe('/storage/chat-media/a.png');
    expect(await local.url('')).toBe('');
    expect(await local.put('a', Buffer.from('x'), 'text/plain')).toBeNull();
  });

  it('a complete provider is the cloud; the CDN URL wins for public links', async () => {
    const m = make(
      { ...complete, cdnUrl: 'https://cdn.test/', basePath: 'threadwise' },
      { secret: 's' },
    );
    expect((await m.destination()).disk).toBe('cloud');
    expect(await m.url('chat-media/a.png')).toBe('https://cdn.test/threadwise/chat-media/a.png');
  });

  it('without a CDN a public bucket is addressed on its endpoint, and a pasted R2 bucket suffix appears once', async () => {
    const m = make(
      { ...complete, provider: 'r2', endpoint: 'https://acct.r2.test/media' },
      { secret: 's' },
    );
    expect(await m.url('x/y.png')).toBe('https://acct.r2.test/media/x/y.png');
  });

  it('a private bucket without a CDN gets a time-limited signed link', async () => {
    const m = make({ ...complete, visibility: 'private' }, { secret: 's' });
    const url = await m.url('x/y.png', 600);
    expect(url).toContain('http://minio.test:9000/media/x/y.png?');
    expect(url).toContain('X-Amz-Expires=600');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('writes to the bucket under the base folder, signed, and deletes the same key', async () => {
    const seen: Array<{ method: string; url: string; auth: string; type: string }> = [];
    const stub: Server = createServer((req, res) => {
      seen.push({
        method: req.method!,
        url: req.url!,
        auth: String(req.headers.authorization),
        type: String(req.headers['content-type']),
      });
      req.resume();
      req.on('end', () => res.writeHead(200).end());
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    try {
      const port = (stub.address() as AddressInfo).port;
      const m = make(
        { ...complete, endpoint: `http://127.0.0.1:${port}`, basePath: '/threadwise/' },
        { secret: 's' },
      );
      expect(await m.put('chat-media/a.png', Buffer.from('x'), 'image/png')).toEqual({
        key: 'threadwise/chat-media/a.png',
      });
      await m.remove('chat-media/a.png');
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
        'PUT /media/threadwise/chat-media/a.png',
        'DELETE /media/threadwise/chat-media/a.png',
      ]);
      expect(seen[0]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
      expect(seen[0]!.type).toBe('image/png');
    } finally {
      await new Promise((r) => stub.close(r));
    }
  });

  it('a bucket that refuses the write surfaces as an error the caller can fall back from', async () => {
    const stub = createServer((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(403).end());
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    try {
      const m = make(
        { ...complete, endpoint: `http://127.0.0.1:${(stub.address() as AddressInfo).port}` },
        { secret: 's' },
      );
      await expect(m.put('a', Buffer.from('x'), 'text/plain')).rejects.toThrow(/HTTP 403/);
    } finally {
      await new Promise((r) => stub.close(r));
    }
  });

  it('normaliseKey strips a leading slash and a stray storage/ prefix', () => {
    expect(normaliseKey('/storage/a/b.png')).toBe('a/b.png');
    expect(normaliseKey(' a/b ')).toBe('a/b');
  });
});

describe('presigned GET', () => {
  it('is deterministic for a fixed clock and carries the SigV4 query parameters', () => {
    const t = {
      endpoint: 'https://s3.example.test',
      region: 'us-east-1',
      bucket: 'b',
      accessKeyId: 'AK',
      secret: 'S',
      pathStyle: true,
      prefix: '',
    };
    const at = new Date('2026-01-01T00:00:00Z');
    const a = presignS3Get(t, 'k/f.png', 300, at);
    expect(a).toBe(presignS3Get(t, 'k/f.png', 300, at));
    expect(a).toContain('X-Amz-Date=20260101T000000Z');
    expect(a).toContain('X-Amz-SignedHeaders=host');
    expect(presignS3Get(t, 'k/g.png', 300, at)).not.toBe(a);
  });
});

afterEach(() => undefined);

describe('media destination env fallback', () => {
  const settings = {
    values: async () => SET_GROUP_SCHEMAS.storage.parse({ enabled: false }),
    secret: async () => null,
  } as never;
  const env = (driver: string): Record<string, unknown> => ({
    MEDIA_STORAGE_DRIVER: driver,
    S3_ENDPOINT: 'http://minio:9000/',
    S3_REGION: 'us-east-1',
    S3_BUCKET_MEDIA: 'crm-media',
    S3_ACCESS_KEY_ID: 'AK',
    S3_SECRET_ACCESS_KEY: 'SK',
    S3_FORCE_PATH_STYLE: true,
  });
  const config = (e: Record<string, unknown>) => ({ get: (k: string) => e[k] }) as never;

  it('uses the deployment bucket only when the driver is s3 and nothing is saved', async () => {
    const on = await new MediaStorageService(settings, config(env('s3'))).destination();
    expect(on.disk).toBe('cloud');
    expect(on.target?.bucket).toBe('crm-media');
    expect(on.target?.endpoint).toBe('http://minio:9000');
    expect(on.visibility).toBe('private');
    const off = await new MediaStorageService(settings, config(env('local'))).destination();
    expect(off.disk).toBe('local');
  });

  it('creates a missing bucket once and retries the write', async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: { method: string }) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      const first = calls.length === 1;
      return new Response(null, { status: first ? 404 : 200 });
    }) as never;
    try {
      const svc = new MediaStorageService(settings, config(env('s3')));
      await expect(svc.put('chat/1/a.png', Buffer.from('x'), 'image/png')).resolves.toEqual({
        key: 'chat/1/a.png',
      });
      expect(calls).toEqual([
        'PUT /crm-media/chat/1/a.png',
        'PUT /crm-media/',
        'PUT /crm-media/chat/1/a.png',
      ]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
