import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { AppError } from '../../../src/common/errors/app-error';
import {
  ChatMediaStore,
  MediaIntegrityError,
  MediaTooLargeError,
} from '../../../src/infra/providers/chat-conversations/media/chat-media.store';
import { LocalDiskMediaStore } from '../../../src/infra/providers/chat-conversations/media/local-disk-media.store';
import { MediaTokenService } from '../../../src/infra/providers/chat-conversations/media/media-token.service';
import type { ChatMediaObjectGateway } from '../../../src/infra/providers/chat-conversations/media/media.ports';
import { UploadPolicyService } from '../../../src/modules/auth/security/upload-policy.service';
import { pdfBytes, pngBytes, sha256Hex } from './fake-graph';

/**
 * `ChatMediaStore.storeInboundStream`: a provider file that arrives as a stream is spooled inside the store, counted while it flows,
 * cut at its limit, checked against its announced checksum, typed from its bytes, policy-checked, and only then moved to its key.
 */

let dir: string;
let root: string;
let local: LocalDiskMediaStore;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crm-wamedia-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const gateway = (disk: 'local' | 'cloud', extra: Partial<ChatMediaObjectGateway> = {}) => {
  const g = {
    destination: vi.fn(async () => ({ disk })),
    put: vi.fn(async (key: string) => (disk === 'cloud' ? { key } : null)),
    remove: vi.fn(async () => undefined),
    url: vi.fn(
      async (key: string, ttl?: number) => `https://bucket.example/${key}?ttl=${ttl}&sig=abc`,
    ),
    ...extra,
  };
  return g as typeof g & ChatMediaObjectGateway;
};

const build = (g: ChatMediaObjectGateway) =>
  new ChatMediaStore(
    g,
    new UploadPolicyService(),
    local,
    new MediaTokenService(
      new CryptoService(
        new ConfigService({
          CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
        }) as never,
      ),
    ),
  );

beforeEach(async () => {
  root = await mkdtemp(join(dir, 'root-'));
  local = new LocalDiskMediaStore(root);
});
afterEach(() => {
  delete process.env.MEDIA_MAX_BYTES_IMAGE;
  delete process.env.MEDIA_MAX_BYTES_DOCUMENT;
});

const spoolFiles = async (): Promise<string[]> => readdir(join(root, '.spool')).catch(() => []);
const keysUnder = async (org: number): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  };
  await walk(join(root, 'chat', String(org)));
  return out;
};

const reason = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
};

describe('storeInboundStream: the happy path', () => {
  it('stores a streamed file under a generated key, with its real size and sha256, and leaves no spool file', async () => {
    const bytes = pngBytes(50_000);
    const store = build(gateway('local'));
    const chunks = [
      bytes.subarray(0, 10_000),
      bytes.subarray(10_000, 30_000),
      bytes.subarray(30_000),
    ];
    const stored = await store.storeInboundStream({
      orgId: 7,
      stream: Readable.from(chunks),
      declaredMime: 'application/octet-stream',
      filename: '../../evil/../name.png',
      maxBytes: 5 * 1024 * 1024,
    });
    expect(stored).toMatchObject({
      mime: 'image/png',
      size: 50_000,
      kind: 'image',
      sha256: sha256Hex(bytes),
      name: 'name.png',
    });
    expect(stored.key).toMatch(/^chat\/7\/\d{4}\/\d{2}\/\d+_[0-9a-f]{24}\.png$/);
    expect((await readFile(join(root, ...stored.key.split('/')))).equals(bytes)).toBe(true);
    expect(await spoolFiles()).toEqual([]);
  });

  it('the content decides the type, not the declared mime (a PDF declared as an image is stored as a PDF)', async () => {
    const stored = await build(gateway('local')).storeInboundStream({
      orgId: 1,
      stream: Readable.from([pdfBytes(3000)]),
      declaredMime: 'image/jpeg',
      maxBytes: 1024 * 1024,
    });
    expect(stored).toMatchObject({ mime: 'application/pdf', kind: 'document' });
    expect(stored.key.endsWith('.pdf')).toBe(true);
  });

  it('verifies the announced sha256 and stores a file that matches it', async () => {
    const bytes = pngBytes(3000);
    const stored = await build(gateway('local')).storeInboundStream({
      orgId: 1,
      stream: Readable.from([bytes]),
      maxBytes: 1024 * 1024,
      verifySha256Hex: sha256Hex(bytes),
    });
    expect(stored.sha256).toBe(sha256Hex(bytes));
  });
});

describe('storeInboundStream: what it refuses, and what it leaves behind when it does', () => {
  it('cuts the stream at the limit while it is still flowing, and stores nothing', async () => {
    const source = new PassThrough();
    const destroyed = vi.fn();
    source.on('close', destroyed);
    let written = 0;
    const feed = setInterval(() => {
      if (source.destroyed) return;
      source.write(Buffer.alloc(16 * 1024, 9));
      written += 16 * 1024;
    }, 1);

    const err = await reason(
      build(gateway('local')).storeInboundStream({
        orgId: 3,
        stream: source,
        maxBytes: 100 * 1024,
      }),
    );
    clearInterval(feed);
    expect(err).toBeInstanceOf(MediaTooLargeError);
    expect((err as MediaTooLargeError).limitBytes).toBe(100 * 1024);
    expect(source.destroyed).toBe(true); // the upstream download is cut, not drained
    expect(written).toBeLessThan(2 * 1024 * 1024); // it stopped within a few chunks of the limit
    expect(destroyed).toHaveBeenCalled();
    expect(await spoolFiles()).toEqual([]);
    expect(await keysUnder(3)).toEqual([]);
  });

  it('exactly the limit is accepted, one byte over is refused', async () => {
    const store = build(gateway('local'));
    const exact = pngBytes(5000);
    await expect(
      store.storeInboundStream({ orgId: 1, stream: Readable.from([exact]), maxBytes: 5000 }),
    ).resolves.toMatchObject({ size: 5000 });
    expect(
      await reason(
        store.storeInboundStream({ orgId: 1, stream: Readable.from([exact]), maxBytes: 4999 }),
      ),
    ).toBeInstanceOf(MediaTooLargeError);
  });

  it('applies the store\'s per-type limit once the real type is known (a "document" that is really a big image)', async () => {
    process.env.MEDIA_MAX_BYTES_IMAGE = '4000';
    const err = await reason(
      build(gateway('local')).storeInboundStream({
        orgId: 1,
        stream: Readable.from([pngBytes(10_000)]),
        declaredMime: 'application/pdf',
        maxBytes: 100 * 1024 * 1024,
      }),
    );
    expect(err).toBeInstanceOf(MediaTooLargeError);
    expect((err as MediaTooLargeError).limitBytes).toBe(4000);
    expect(await keysUnder(1)).toEqual([]);
  });

  it('refuses a file whose bytes do not match the announced sha256, and stores nothing', async () => {
    const err = await reason(
      build(gateway('local')).storeInboundStream({
        orgId: 1,
        stream: Readable.from([pngBytes(3000)]),
        maxBytes: 1024 * 1024,
        verifySha256Hex: sha256Hex(Buffer.from('some other file')),
      }),
    );
    expect(err).toBeInstanceOf(MediaIntegrityError);
    expect(await keysUnder(1)).toEqual([]);
    expect(await spoolFiles()).toEqual([]);
  });

  it.each([
    [
      'an HTML page declared as an image',
      Buffer.from('<html><script>alert(1)</script></html>'),
      'image/png',
    ],
    [
      'a script declared as a document',
      Buffer.from('<?php system($_GET["c"]); ?>'),
      'application/pdf',
    ],
    [
      'an SVG declared as an image',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      'image/svg+xml',
    ],
    [
      'binary nobody knows',
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x00, 0x00]),
      'application/octet-stream',
    ],
  ])('refuses %s (content mismatch), stores nothing', async (_why, bytes, declared) => {
    const err = await reason(
      build(gateway('local')).storeInboundStream({
        orgId: 1,
        stream: Readable.from([bytes]),
        declaredMime: declared,
        maxBytes: 1024 * 1024,
      }),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('AUTH_UPLOAD_REJECTED');
    expect(await keysUnder(1)).toEqual([]);
    expect(await spoolFiles()).toEqual([]);
  });

  it('refuses an empty body', async () => {
    const err = await reason(
      build(gateway('local')).storeInboundStream({
        orgId: 1,
        stream: Readable.from([]),
        maxBytes: 1024,
      }),
    );
    expect((err as AppError).code).toBe('AUTH_UPLOAD_REJECTED');
    expect(await spoolFiles()).toEqual([]);
  });

  it('a source that fails half way leaves nothing behind', async () => {
    // One chunk, then the failure. `read()` runs again for every chunk the consumer wants, so pushing on each call raced the 1 MB limit
    // against the timer on a fast machine and failed with "file is larger" instead of the reset.
    let sent = false;
    const source = new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(pngBytes(4000));
        setTimeout(() => this.destroy(new Error('connection reset')), 5);
      },
    });
    const err = await reason(
      build(gateway('local')).storeInboundStream({
        orgId: 1,
        stream: source,
        maxBytes: 1024 * 1024,
      }),
    );
    expect((err as Error).message).toMatch(/connection reset|premature/i);
    expect(await spoolFiles()).toEqual([]);
    expect(await keysUnder(1)).toEqual([]);
  });

  it('never writes outside the store: the key is generated, whatever the sender called the file', async () => {
    const stored = await build(gateway('local')).storeInboundStream({
      orgId: 9,
      stream: Readable.from([pngBytes()]),
      filename: 'C:\\Windows\\..\\..\\boot.ini\u0000.png',
      maxBytes: 1024 * 1024,
    });
    expect(stored.key.startsWith('chat/9/')).toBe(true);
    expect(stored.key).not.toMatch(/boot|\.\.|\\/);
    // eslint-disable-next-line no-control-regex -- the point is that a NUL byte never survives into the stored name
    expect(stored.name).not.toMatch(/[\\/\u0000]/);
    expect((await keysUnder(9)).length).toBe(1);
  });
});

describe('storeInboundStream: a cloud bucket', () => {
  it('hands the finished file to the bucket in one piece and writes nothing to local disk', async () => {
    const bytes = pdfBytes(8000);
    const g = gateway('cloud');
    const stored = await build(g).storeInboundStream({
      orgId: 2,
      stream: Readable.from([bytes]),
      maxBytes: 1024 * 1024,
    });
    expect(g.put).toHaveBeenCalledTimes(1);
    const [key, body, mime] = vi.mocked(g.put).mock.calls[0] as unknown as [string, Buffer, string];
    expect(key).toBe(stored.key);
    expect(Buffer.isBuffer(body) && body.equals(bytes)).toBe(true);
    expect(mime).toBe('application/pdf');
    expect(await keysUnder(2)).toEqual([]);
    expect(await spoolFiles()).toEqual([]);
  });
});

describe('the spool: leftovers of killed workers', () => {
  it('sweepSpool removes old spool files and keeps recent ones and anything that is not a spool file', async () => {
    const spool = join(root, '.spool');
    await mkdir(spool, { recursive: true });
    const old = join(spool, 'old.part');
    const fresh = join(spool, 'fresh.part');
    const other = join(spool, 'notes.txt');
    for (const p of [old, fresh, other]) await writeFile(p, 'x');
    const longAgo = new Date(Date.now() - 3 * 3600_000);
    await utimes(old, longAgo, longAgo);
    await utimes(other, longAgo, longAgo);

    expect(await local.sweepSpool(60 * 60_000)).toBe(1);
    expect((await spoolFiles()).sort()).toEqual(['fresh.part', 'notes.txt']);
    await expect(stat(old)).rejects.toBeTruthy();
  });

  it('sweeping a store that never spooled is a no-op', async () => {
    expect(await local.sweepSpool(1)).toBe(0);
  });

  it('a spool path can never be a key: the directory name starts with a dot, which no key segment may', async () => {
    const { isSafeMediaKey } =
      await import('../../../src/infra/providers/chat-conversations/media/local-disk-media.store');
    expect(isSafeMediaKey('.spool/abc.part')).toBe(false);
    await expect(local.adopt('chat/1/2026/10/a.png', join(root, 'chat', 'x.part'))).rejects.toThrow(
      'not a spool file',
    );
  });
});

describe('temporaryPublicLink: the privacy trade is explicit and only a bucket can make one', () => {
  it('a bucket object gets a signed link with the asked lifetime', async () => {
    const g = gateway('cloud');
    const link = await build(g).temporaryPublicLink(5, 'chat/5/2026/10/abc.png', 900);
    expect(link?.url).toBe('https://bucket.example/chat/5/2026/10/abc.png?ttl=900&sig=abc');
    expect(link!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
    expect(link!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 900_000 + 1000);
  });

  it("local storage cannot make one (nothing is public), another workspace's key is refused, a file on disk is not linked", async () => {
    expect(
      await build(gateway('local')).temporaryPublicLink(5, 'chat/5/2026/10/abc.png', 900),
    ).toBeNull();
    expect(
      await build(gateway('cloud')).temporaryPublicLink(6, 'chat/5/2026/10/abc.png', 900),
    ).toBeNull();
    const onDisk = await build(gateway('cloud')).storeInboundStream({
      orgId: 5,
      stream: Readable.from([pngBytes()]),
      maxBytes: 1024 * 1024,
    });
    // the cloud gateway "put" it, so it is not on disk: link works; a key that IS on disk (stored while storage was local) is not
    await local.put('chat/5/2026/10/ondisk.png', pngBytes());
    expect(
      await build(gateway('cloud')).temporaryPublicLink(5, 'chat/5/2026/10/ondisk.png', 900),
    ).toBeNull();
    expect(onDisk.key).toBeTruthy();
  });
});
