// Sheet3 #34 round 2: polyglots, pixel limits, antivirus hook (fake clamd), cross-tenant key access, CSV formula injection.
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UploadPolicyService,
  scanUpload,
} from '../../../src/modules/auth/security/upload-policy.service';
import { ClamdScanner, scannerFromEnv } from '../../../src/modules/auth/security/upload-scanner';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media/chat-media.store';
import { csvLine, guardFormula } from '../../../src/modules/crm/contact-bulk/csv-writer';

const policy = new UploadPolicyService();
const ok = (name: string, buffer: Buffer) =>
  policy.validate({ filename: name, buffer, allow: ['image'], maxBytes: 5e6 });
const bad = (name: string, buffer: Buffer) => expect(() => ok(name, buffer), name).toThrow();

const png = (w = 1, h = 1, trailer = Buffer.alloc(0)) => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  const iend = Buffer.alloc(12);
  iend.write('IEND', 4, 'latin1');
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), ihdr, iend, trailer]);
};
const gif = (w = 1, h = 1, trailer = Buffer.alloc(0)) => {
  const hd = Buffer.alloc(13);
  hd.write('GIF89a', 0, 'latin1');
  hd.writeUInt16LE(w, 6);
  hd.writeUInt16LE(h, 8);
  return Buffer.concat([hd, Buffer.from([0x3b]), trailer]);
};
const jpeg = (w = 1, h = 1, comment = '', trailer = Buffer.alloc(0)) => {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = 3;
  const com = Buffer.alloc(4 + comment.length);
  com.writeUInt16BE(0xfffe, 0);
  com.writeUInt16BE(2 + comment.length, 2);
  com.write(comment, 4, 'latin1');
  return Buffer.concat([Buffer.from([0xff, 0xd8]), com, sof, Buffer.from([0xff, 0xd9]), trailer]);
};
const webp = (w = 1, h = 1) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('polyglots', () => {
  it('accepts well-formed images', () => {
    expect(ok('a.png', png()).mime).toBe('image/png');
    expect(ok('a.gif', gif()).mime).toBe('image/gif');
    expect(ok('a.jpg', jpeg()).mime).toBe('image/jpeg');
    expect(ok('a.webp', webp()).mime).toBe('image/webp');
  });
  it('refuses GIF+HTML, PNG+HTML, JPEG+PHP, WebP+HTML (trailer)', () => {
    bad('a.gif', gif(1, 1, HTML));
    bad('a.png', png(1, 1, HTML));
    bad('a.jpg', jpeg(1, 1, '', Buffer.from('<?php system($_GET[0]); ?>')));
    bad('a.webp', Buffer.concat([webp(), HTML]));
  });
  it('refuses markup hidden inside the image (comment segment, before the end marker)', () => {
    bad('a.jpg', jpeg(1, 1, '<?php system($_GET[0]); ?>'));
    bad('a.jpg', jpeg(1, 1, '<script>alert(1)</script>'));
  });
  it('refuses a truncated image with no end marker', () => {
    bad('a.png', png().subarray(0, 40));
    bad('a.gif', gif().subarray(0, 12));
  });
});

describe('pixel limits', () => {
  it('refuses decompression-bomb headers (tiny file, huge canvas)', () => {
    bad('a.png', png(60000, 60000));
    bad('a.png', png(100000, 1));
    bad('a.gif', gif(65535, 65535));
    bad('a.jpg', jpeg(65535, 65535));
    bad('a.webp', webp(16385, 1));
    bad('a.png', png(12000, 12000)); // 144 MP within the side cap, over the megapixel cap
  });
  it('accepts a large but sane image and honours the env override', () => {
    expect(ok('a.png', png(4000, 4000)).ext).toBe('png');
    process.env.UPLOAD_MAX_IMAGE_SIDE = '100';
    try {
      bad('a.png', png(200, 10));
    } finally {
      delete process.env.UPLOAD_MAX_IMAGE_SIDE;
    }
  });
});

describe('antivirus hook (fake clamd)', () => {
  let srv: Server | undefined;
  const fake = (reply: string | null): Promise<number> =>
    new Promise((res) => {
      srv = createServer((s) => {
        let n = 0;
        s.on('data', (d) => {
          n += d.length;
          if (d.subarray(-4).equals(Buffer.alloc(4)) && reply !== null) {
            s.end(reply);
          }
        });
        s.on('error', () => undefined);
      }).listen(0, '127.0.0.1', () => res((srv!.address() as { port: number }).port));
    });
  afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

  it('clean', async () => {
    const p = await fake('stream: OK\0');
    expect(await new ClamdScanner('127.0.0.1', p, 2000).scan(Buffer.from('hello'))).toEqual({
      status: 'clean',
    });
    await expect(
      scanUpload(Buffer.from('x'), new ClamdScanner('127.0.0.1', p, 2000), true),
    ).resolves.toBeUndefined();
  });
  it('infected is refused whatever the fail mode', async () => {
    const p = await fake('stream: Win.Test.EICAR_HDB-1 FOUND\0');
    const sc = new ClamdScanner('127.0.0.1', p, 2000);
    expect(await sc.scan(Buffer.from('x'))).toEqual({
      status: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
    await expect(scanUpload(Buffer.from('x'), sc, false)).rejects.toMatchObject({
      details: [{ message: 'infected' }],
    });
  });
  it('timeout: fail-open lets it through, fail-closed refuses', async () => {
    const p = await fake(null);
    const sc = new ClamdScanner('127.0.0.1', p, 150);
    await expect(scanUpload(Buffer.from('x'), sc, false)).resolves.toBeUndefined();
    await expect(scanUpload(Buffer.from('x'), sc, true)).rejects.toMatchObject({
      details: [{ message: 'scan_unavailable' }],
    });
  });
  it('unreachable scanner follows the same fail mode', async () => {
    const sc = new ClamdScanner('127.0.0.1', 1, 500);
    await expect(scanUpload(Buffer.from('x'), sc, false)).resolves.toBeUndefined();
    await expect(scanUpload(Buffer.from('x'), sc, true)).rejects.toThrow();
  });
  it('is off by default and enabled by env', () => {
    expect(scannerFromEnv({}).scanner).toBeNull();
    expect(
      scannerFromEnv({ UPLOAD_SCAN_MODE: 'clamd', UPLOAD_SCAN_FAIL_CLOSED: 'true' }),
    ).toMatchObject({ failClosed: true });
    expect(scannerFromEnv({ UPLOAD_SCAN_MODE: 'clamd' }).scanner).toBeInstanceOf(ClamdScanner);
  });
  it('validateScanned runs the scanner after the content checks', async () => {
    const p = await fake('stream: Bad.Thing FOUND\0');
    await expect(
      policy.validateScanned(
        { filename: 'a.png', buffer: png(), allow: ['image'], maxBytes: 1e6 },
        new ClamdScanner('127.0.0.1', p, 2000),
      ),
    ).rejects.toThrow();
    await expect(
      policy.validateScanned(
        { filename: 'a.html', buffer: HTML, allow: ['image'], maxBytes: 1e6 },
        null,
      ),
    ).rejects.toThrow();
  });
});

describe('cross-tenant access to stored upload keys (representative: chat media store)', () => {
  const own = (org: number, key: string) =>
    (ChatMediaStore.prototype as any).ownsKey.call({}, org, key) as boolean;
  it('an org owns only its own prefix', () => {
    expect(own(1, 'chat/1/2026/a.png')).toBe(true);
    expect(own(2, 'chat/1/2026/a.png')).toBe(false);
    expect(own(1, 'chat/10/a.png')).toBe(false);
  });
  it('traversal and odd keys are never owned', () => {
    for (const k of [
      'chat/1/../2/a.png',
      'chat/1/..%2f2/a.png',
      'chat/1//etc/passwd',
      '/chat/1/a.png',
      'chat/1/a\0.png',
      'chat/1/..\\2\\a.png',
    ])
      expect(own(1, k), k).toBe(false);
  });
  it('read and remove of another org key do nothing (no storage touched)', async () => {
    const self = { ownsKey: (ChatMediaStore.prototype as any).ownsKey };
    expect(
      await (ChatMediaStore.prototype as any).remove.call(self, 2, 'chat/1/a.png'),
    ).toBeUndefined();
  });
});

describe('CSV formula injection (cells that leave the system)', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(1)', '\t=1', '\r=1', '=HYPERLINK("http://evil","x")'])(
    'guards %j',
    (v) => {
      expect(guardFormula(v).startsWith("'")).toBe(true);
      expect(csvLine([guardFormula(v)])).not.toMatch(/^"?[=+\-@]/);
    },
  );
  it('leaves normal text alone', () => expect(guardFormula('hello =x')).toBe('hello =x'));
});
