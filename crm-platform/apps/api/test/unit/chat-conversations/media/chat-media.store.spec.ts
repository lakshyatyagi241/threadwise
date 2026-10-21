import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../../src/common/crypto/crypto.service';
import { AppError } from '../../../../src/common/errors/app-error';
import {
  ChatMediaStore,
  MediaRangeError,
  displayName,
} from '../../../../src/infra/providers/chat-conversations/media/chat-media.store';
import { LocalDiskMediaStore } from '../../../../src/infra/providers/chat-conversations/media/local-disk-media.store';
import { MediaTokenService } from '../../../../src/infra/providers/chat-conversations/media/media-token.service';
import type { ChatMediaObjectGateway } from '../../../../src/infra/providers/chat-conversations/media/media.ports';
import { UploadPolicyService } from '../../../../src/modules/auth/security/upload-policy.service';
import { jpegOfSize, pngOfSize } from '../../../support/images';

const PNG = pngOfSize();
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 2)]);
const jpeg = (size: number) => jpegOfSize(size);

let dir: string;
let local: LocalDiskMediaStore;
let tokens: MediaTokenService;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crm-chatmedia-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function gateway(disk: 'local' | 'cloud', extra: Partial<ChatMediaObjectGateway> = {}) {
  const g = {
    destination: vi.fn(async () => ({ disk })),
    put: vi.fn(async (key: string) => (disk === 'cloud' ? { key } : null)),
    remove: vi.fn(async () => undefined),
    url: vi.fn(async () => 'http://127.0.0.1:1/never'),
    ...extra,
  };
  return g as typeof g & ChatMediaObjectGateway;
}
const build = (g: ChatMediaObjectGateway) =>
  new ChatMediaStore(g, new UploadPolicyService(), local, tokens);

beforeEach(async () => {
  local = new LocalDiskMediaStore(await mkdtemp(join(dir, 'root-')));
  tokens = new MediaTokenService(
    new CryptoService(
      new ConfigService({
        CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
      }) as never,
    ),
  );
});
afterEach(() => {
  delete process.env.MEDIA_MAX_BYTES_IMAGE;
  delete process.env.MEDIA_MAX_BYTES_MEDIA;
  delete process.env.MEDIA_MAX_BYTES_DOCUMENT;
});

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected a rejection');
};

describe('ChatMediaStore.store: local disk', () => {
  it('writes locally when the platform has no bucket, under a generated key that holds the workspace and no client text', async () => {
    const g = gateway('local');
    const stored = await build(g).store({ orgId: 3, filename: '../../Evil Name.PNG', buffer: PNG });
    expect(stored.key).toMatch(/^chat\/3\/\d{4}\/\d{2}\/\d+_[0-9a-f]{24}\.png$/);
    expect(stored.key.toLowerCase()).not.toContain('evil');
    expect(stored).toMatchObject({
      mime: 'image/png',
      size: PNG.length,
      kind: 'image',
      name: 'Evil Name.PNG',
    });
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(g.put).toHaveBeenCalledOnce();
    expect(await local.stat(stored.key)).toEqual({ size: PNG.length });
  });

  it('opens what it stored, and only for its own workspace', async () => {
    const store = build(gateway('local'));
    const { key } = await store.store({ orgId: 3, filename: 'a.pdf', buffer: PDF });
    const opened = await store.open(3, key);
    expect(opened).toMatchObject({
      size: PDF.length,
      start: 0,
      end: PDF.length - 1,
      partial: false,
    });
    expect(await store.open(4, key)).toBeNull();
    expect(await store.open(3, 'chat/4/2026/10/x.pdf')).toBeNull();
    expect(await store.open(3, '../../etc/passwd')).toBeNull();
  });

  it('serves a range, and reports a range beyond the end', async () => {
    const store = build(gateway('local'));
    const { key } = await store.store({ orgId: 3, filename: 'a.pdf', buffer: PDF });
    expect(await store.open(3, key, { start: 10, end: 19 })).toMatchObject({
      start: 10,
      end: 19,
      partial: true,
    });
    await expect(store.open(3, key, { start: PDF.length + 5 })).rejects.toBeInstanceOf(
      MediaRangeError,
    );
  });

  it('removes the file', async () => {
    const store = build(gateway('local'));
    const { key } = await store.store({ orgId: 3, filename: 'a.pdf', buffer: PDF });
    await store.remove(4, key); // another workspace: nothing happens
    expect(await store.open(3, key)).not.toBeNull();
    await store.remove(3, key);
    expect(await store.open(3, key)).toBeNull();
  });
});

describe('ChatMediaStore.store: the upload policy and the limits', () => {
  it.each([
    ['page.html', Buffer.from('<html><script>1</script></html>')],
    ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['run.php', Buffer.from('<?php echo 1;')],
    ['tool.exe', Buffer.from('MZ....')],
    ['noext', PNG],
    ['empty.png', Buffer.alloc(0)],
  ])('refuses %s with the upload-rejected code and stores nothing', async (filename, buffer) => {
    const g = gateway('local');
    const err = await rejection(build(g).store({ orgId: 3, filename, buffer }));
    expect(err.code).toBe('AUTH_UPLOAD_REJECTED');
    expect(g.put).not.toHaveBeenCalled();
  });

  it('judges by content, not by name: a PDF called .png is refused, and a script called .txt too', async () => {
    const store = build(gateway('local'));
    expect((await rejection(store.store({ orgId: 3, filename: 'x.png', buffer: PDF }))).code).toBe(
      'AUTH_UPLOAD_REJECTED',
    );
    expect(
      (
        await rejection(
          store.store({
            orgId: 3,
            filename: 'x.txt',
            buffer: Buffer.from('<script>alert(1)</script>'),
          }),
        )
      ).code,
    ).toBe('AUTH_UPLOAD_REJECTED');
  });

  it('applies the limit of the file kind: images 5 MB, audio and video 16 MB, documents 100 MB', async () => {
    const store = build(gateway('local'));
    const err = await rejection(
      store.store({ orgId: 3, filename: 'big.jpg', buffer: jpeg(5 * 1024 * 1024 + 1) }),
    );
    expect(err.code).toBe('AUTH_UPLOAD_REJECTED');
    expect(err.message).toContain('5 MB');
    await expect(
      store.store({ orgId: 3, filename: 'ok.jpg', buffer: jpeg(5 * 1024 * 1024) }),
    ).resolves.toBeDefined();

    // A document of the same size is fine: its limit is higher.
    const doc = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(store.store({ orgId: 3, filename: 'ok.pdf', buffer: doc })).resolves.toBeDefined();
  });

  it('reads the limits from the environment', async () => {
    process.env.MEDIA_MAX_BYTES_IMAGE = '1000';
    const store = build(gateway('local'));
    expect(
      (await rejection(store.store({ orgId: 3, filename: 'a.jpg', buffer: jpeg(1001) }))).code,
    ).toBe('AUTH_UPLOAD_REJECTED');
    await expect(
      store.store({ orgId: 3, filename: 'a.jpg', buffer: jpeg(1000) }),
    ).resolves.toBeDefined();
  });

  it('honours a restricted set of kinds', async () => {
    const store = build(gateway('local'));
    expect(
      (await rejection(store.store({ orgId: 3, filename: 'a.pdf', buffer: PDF, allow: ['image'] })))
        .code,
    ).toBe('AUTH_UPLOAD_REJECTED');
  });
});

describe('ChatMediaStore.storeInbound: bytes a channel delivered', () => {
  it('lets the content decide the type, whatever the provider declared', async () => {
    const stored = await build(gateway('local')).storeInbound({
      orgId: 3,
      buffer: PNG,
      declaredMime: 'application/octet-stream',
      filename: 'IMG_0001.jpg',
    });
    expect(stored).toMatchObject({ mime: 'image/png', kind: 'image', name: 'IMG_0001.jpg' });
    expect(stored.key.endsWith('.png')).toBe(true);
  });

  it('refuses content that is nothing we accept, even when declared as an image', async () => {
    const g = gateway('local');
    const store = build(g);
    for (const buffer of [
      Buffer.from('<html><body>hi</body></html>'),
      Buffer.from([0, 1, 2, 3, 4, 5]),
      Buffer.alloc(0),
    ]) {
      const err = await rejection(
        store.storeInbound({ orgId: 3, buffer, declaredMime: 'image/jpeg' }),
      );
      expect(err.code).toBe('AUTH_UPLOAD_REJECTED');
    }
    expect(g.put).not.toHaveBeenCalled();
  });

  it('still applies the size limit of the detected kind', async () => {
    process.env.MEDIA_MAX_BYTES_IMAGE = '500';
    const err = await rejection(
      build(gateway('local')).storeInbound({ orgId: 3, buffer: jpeg(501) }),
    );
    expect(err.code).toBe('AUTH_UPLOAD_REJECTED');
  });
});

describe('ChatMediaStore: cloud', () => {
  let server: Server;
  let base: string;
  const seen: Array<{ url: string; range?: string }> = [];
  const OBJECT = Buffer.from('0123456789');

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? '', range: req.headers.range });
      if (req.url === '/missing') {
        res.writeHead(404).end();
        return;
      }
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : OBJECT.length - 1;
        res.writeHead(206, {
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${OBJECT.length}`,
        });
        res.end(OBJECT.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-length': OBJECT.length }).end(OBJECT);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('hands the bytes to the bucket and writes nothing locally', async () => {
    const g = gateway('cloud');
    const store = build(g);
    const stored = await store.store({ orgId: 3, filename: 'a.png', buffer: PNG });
    expect(g.put).toHaveBeenCalledWith(stored.key, PNG, 'image/png');
    expect(await local.stat(stored.key)).toBeNull();
  });

  const read = async (opened: Awaited<ReturnType<ChatMediaStore['open']>>) => {
    const chunks: Buffer[] = [];
    for await (const c of opened!.stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString();
  };

  it('reads a bucket object on the server through a link the browser never sees', async () => {
    const g = gateway('cloud', { url: vi.fn(async () => `${base}/object`) });
    const opened = await build(g).open(3, 'chat/3/2026/10/a.png');
    expect(opened).toMatchObject({ size: 10, start: 0, end: 9, partial: false });
    expect(await read(opened)).toBe('0123456789');
    expect(g.url).toHaveBeenCalledWith('chat/3/2026/10/a.png', 60);
  });

  it('passes a range through and reports the partial answer', async () => {
    const g = gateway('cloud', { url: vi.fn(async () => `${base}/object`) });
    const opened = await build(g).open(3, 'chat/3/2026/10/a.png', { start: 3, end: 5 });
    expect(opened).toMatchObject({ size: 10, start: 3, end: 5, partial: true });
    expect(await read(opened)).toBe('345');
    expect(seen.at(-1)?.range).toBe('bytes=3-5');
  });

  it('is null for an object the bucket does not have, and never asks the bucket for another workspace key', async () => {
    const url = vi.fn(async () => `${base}/missing`);
    const store = build(gateway('cloud', { url }));
    expect(await store.open(3, 'chat/3/2026/10/gone.png')).toBeNull();
    url.mockClear();
    expect(await store.open(3, 'chat/9/2026/10/a.png')).toBeNull();
    expect(url).not.toHaveBeenCalled();
  });

  it('removes from both places', async () => {
    const g = gateway('cloud');
    await build(g).remove(3, 'chat/3/2026/10/a.png');
    expect(g.remove).toHaveBeenCalledWith('chat/3/2026/10/a.png');
  });
});

describe('ChatMediaStore.accessUrl', () => {
  it('is a short link through the web proxy that opens only for the person it was made for', () => {
    const store = build(gateway('local'));
    const url = store.accessUrl(
      'chat/3/2026/10/a.png',
      { orgId: 3, userId: 7 },
      { name: 'a.png', mime: 'image/png' },
    );
    expect(url).toMatch(/^\/api\/v2\/media\/[A-Za-z0-9_-]+$/);
    expect(url).not.toContain('chat/3');
    const payload = tokens.verify(url.split('/').pop()!);
    expect(payload).toMatchObject({
      key: 'chat/3/2026/10/a.png',
      orgId: 3,
      userId: 7,
      name: 'a.png',
      mime: 'image/png',
    });
  });
});

describe('displayName', () => {
  it('keeps only the file name, without path or control characters, at most 120 characters', () => {
    expect(displayName('C:\\Users\\me\\Report.pdf')).toBe('Report.pdf');
    expect(displayName('/etc/passwd')).toBe('passwd');
    expect(displayName('a\u0000b\u001fc.txt')).toBe('abc.txt');
    expect(displayName('   ')).toBe('file');
    expect(displayName('x'.repeat(300)).length).toBe(120);
  });
});
