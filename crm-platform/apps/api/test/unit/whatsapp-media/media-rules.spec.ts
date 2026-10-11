import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WA_MAX_BYTES,
  WA_STATIC_STICKER_MAX_BYTES,
  WA_UPLOAD_REFUSAL,
  WaMediaRefusal,
  classifyForUpload,
  inboundByteCap,
  isAnimatedWebp,
  isOggOpus,
  isSafeMediaId,
  sha256HexFrom,
  type WaMediaKind,
} from '../../../src/infra/providers/whatsapp/media/whatsapp-media-rules';
import { oggOpusBytes, pdfBytes, pngBytes } from './fake-graph';

const KIB = 1024;
const MIB = 1024 * KIB;

const webp = (animated: boolean, size = 64) => {
  const b = Buffer.alloc(size, 0);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b[20] = animated ? 0x02 : 0x00;
  return b;
};

const refusal = (fn: () => unknown): WaMediaRefusal => {
  try {
    fn();
  } catch (err) {
    if (err instanceof WaMediaRefusal) return err;
    throw err;
  }
  throw new Error('expected a refusal');
};

const classify = (
  mediaKind: WaMediaKind,
  mime: string,
  size: number,
  head: Buffer = Buffer.alloc(0),
) => classifyForUpload({ mediaKind, mime, size, head });

describe('limits table (Meta)', () => {
  it('image 5 MB, audio and video 16 MB, document 100 MB, sticker 500 KB (animated) and 100 KB (static)', () => {
    expect(WA_MAX_BYTES).toEqual({
      image: 5 * MIB,
      video: 16 * MIB,
      audio: 16 * MIB,
      document: 100 * MIB,
      sticker: 500 * KIB,
    });
    expect(WA_STATIC_STICKER_MAX_BYTES).toBe(100 * KIB);
  });

  it('an inbound download is capped at the limit of the kind the webhook announced', () => {
    expect(inboundByteCap('image')).toBe(5 * MIB);
    expect(inboundByteCap('document')).toBe(100 * MIB);
    expect(inboundByteCap('sticker')).toBe(500 * KIB);
  });
});

describe('classifyForUpload: what an outbound file is sent as', () => {
  it('accepts the types Meta documents, and says so in the result', () => {
    expect(classify('image', 'image/jpeg', 100).kind).toBe('image');
    expect(classify('image', 'image/png', 100).kind).toBe('image');
    expect(classify('video', 'video/mp4', 100).mime).toBe('video/mp4');
    expect(classify('video', 'video/3gpp', 100).kind).toBe('video');
    for (const mime of ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr']) {
      expect(classify('audio', mime, 100)).toMatchObject({ kind: 'audio', voice: false });
    }
    expect(classify('document', 'application/pdf', 100).kind).toBe('document');
    expect(classify('sticker', 'image/webp', 100, webp(true)).kind).toBe('sticker');
  });

  it('reads the mime without its parameters and in any case', () => {
    expect(classify('audio', 'Audio/OGG; codecs=opus', 100, oggOpusBytes()).mime).toBe('audio/ogg');
    expect(classify('image', 'IMAGE/PNG', 100).mime).toBe('image/png');
  });

  it('Ogg audio is a voice note only when it is Opus; other Ogg audio needs a conversion that is not part of this release', () => {
    expect(classify('audio', 'audio/ogg', 100, oggOpusBytes())).toMatchObject({
      voice: true,
      mime: 'audio/ogg',
    });
    const vorbis = Buffer.concat([
      Buffer.from('OggS'),
      Buffer.alloc(24),
      Buffer.from('\x01vorbis'),
      Buffer.alloc(40),
    ]);
    expect(refusal(() => classify('audio', 'audio/ogg', 100, vorbis)).code).toBe(
      WA_UPLOAD_REFUSAL.TRANSCODE_REQUIRED,
    );
  });

  it('audio containers WhatsApp does not take (wav, webm) are refused with the transcode code, not converted', () => {
    for (const mime of ['audio/wav', 'audio/webm', 'audio/x-wav']) {
      const r = refusal(() => classify('audio', mime, 100));
      expect(r.code).toBe(WA_UPLOAD_REFUSAL.TRANSCODE_REQUIRED);
      expect(r.message).toMatch(/not available yet/i);
    }
  });

  it('an image kind refuses GIF (send an MP4), WebP (only a sticker) and anything that is not JPEG or PNG', () => {
    expect(refusal(() => classify('image', 'image/gif', 100)).message).toMatch(/MP4/);
    expect(refusal(() => classify('image', 'image/webp', 100)).message).toMatch(/sticker/);
    for (const mime of ['image/bmp', 'image/tiff', 'application/pdf']) {
      expect(refusal(() => classify('image', mime, 100)).code).toBe(
        WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
      );
    }
  });

  it('a video kind takes MP4 and 3GPP only', () => {
    for (const mime of ['video/webm', 'video/quicktime', 'video/x-matroska']) {
      expect(refusal(() => classify('video', mime, 100)).code).toBe(
        WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
      );
    }
  });

  it('a sticker kind takes WebP only', () => {
    expect(refusal(() => classify('sticker', 'image/png', 100)).code).toBe(
      WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
    );
  });

  it('a document kind is open: any document the store accepted is tried, and an image sent as a document stays a document', () => {
    expect(classify('document', 'application/zip', 100).kind).toBe('document');
    expect(classify('document', 'text/csv', 100).kind).toBe('document');
    expect(classify('document', 'image/png', 100).kind).toBe('document');
  });

  describe('size limits, at the boundary', () => {
    it.each([
      ['image', 'image/jpeg', 5 * MIB],
      ['video', 'video/mp4', 16 * MIB],
      ['audio', 'audio/mpeg', 16 * MIB],
      ['document', 'application/pdf', 100 * MIB],
    ] as const)('%s: exactly the limit passes, one byte more is refused', (kind, mime, limit) => {
      expect(classify(kind, mime, limit).maxBytes).toBe(limit);
      const r = refusal(() => classify(kind, mime, limit + 1));
      expect(r.code).toBe(WA_UPLOAD_REFUSAL.TOO_LARGE);
      expect(r.message).toMatch(/WhatsApp allows/);
    });

    it('a static sticker is held to 100 KB, an animated one to 500 KB', () => {
      expect(classify('sticker', 'image/webp', 100 * KIB, webp(false)).maxBytes).toBe(100 * KIB);
      expect(
        refusal(() => classify('sticker', 'image/webp', 100 * KIB + 1, webp(false))).code,
      ).toBe(WA_UPLOAD_REFUSAL.TOO_LARGE);
      expect(classify('sticker', 'image/webp', 500 * KIB, webp(true)).maxBytes).toBe(500 * KIB);
      expect(refusal(() => classify('sticker', 'image/webp', 500 * KIB + 1, webp(true))).code).toBe(
        WA_UPLOAD_REFUSAL.TOO_LARGE,
      );
    });
  });
});

describe('sniffing helpers', () => {
  it('isOggOpus needs an Ogg page that names OpusHead', () => {
    expect(isOggOpus(oggOpusBytes())).toBe(true);
    expect(isOggOpus(Buffer.from('OggS and nothing else'))).toBe(false);
    expect(isOggOpus(pngBytes())).toBe(false);
    expect(isOggOpus(Buffer.alloc(0))).toBe(false);
  });

  it('isAnimatedWebp reads the animation flag of the VP8X chunk', () => {
    expect(isAnimatedWebp(webp(true))).toBe(true);
    expect(isAnimatedWebp(webp(false))).toBe(false);
    expect(isAnimatedWebp(pdfBytes())).toBe(false);
    expect(isAnimatedWebp(Buffer.alloc(5))).toBe(false);
  });
});

describe('sha256HexFrom: Meta announces the digest in hex or base64', () => {
  const digest = createHash('sha256').update('hello').digest();
  it('reads hex, base64 and url-safe base64 to the same digest', () => {
    expect(sha256HexFrom(digest.toString('hex'))).toBe(digest.toString('hex'));
    expect(sha256HexFrom(digest.toString('hex').toUpperCase())).toBe(digest.toString('hex'));
    expect(sha256HexFrom(digest.toString('base64'))).toBe(digest.toString('hex'));
    expect(sha256HexFrom(digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'))).toBe(
      digest.toString('hex'),
    );
  });

  it('is null for anything else, so an unreadable announcement never blocks a file', () => {
    expect(sha256HexFrom('not a digest')).toBeNull();
    expect(sha256HexFrom('')).toBeNull();
    expect(sha256HexFrom(undefined)).toBeNull();
    expect(sha256HexFrom('abc123')).toBeNull();
  });
});

describe('isSafeMediaId: the id goes into a url path', () => {
  it('accepts the characters Meta issues and nothing that could change the path', () => {
    expect(isSafeMediaId('1234567890123456')).toBe(true);
    expect(isSafeMediaId('abc_DEF-1')).toBe(true);
    for (const bad of ['', '../x', '12/34', '12?x=1', '12#', '12 34', 'a'.repeat(129), '%2e%2e']) {
      expect(isSafeMediaId(bad)).toBe(false);
    }
  });
});
