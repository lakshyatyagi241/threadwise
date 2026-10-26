/**
 * Whole-file checks for raster images (SEC-UPLOAD-3 polyglots, SEC-UPLOAD-5 decompression bombs). The signature alone says how a file
 * STARTS; this also reads the declared pixel size from the header, requires the format's end marker with nothing after it, and refuses
 * script or markup anywhere in the first and last 64 KB. Returns a reason string, or null when the file is fine (or not one of the
 * four formats handled here, which other checks cover).
 * shortcut: animated GIF/WebP frame counts and PNG chunk CRCs are not verified; upgrade if an image is ever decoded server side.
 */
const MARKUP = /<\s*(script|html|\?php|iframe|object|embed|svg|body|img\s)|<\?=|javascript\s*:/i;
const WINDOW = 65536;

const envInt = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

function trimZeros(b: Buffer): Buffer {
  let e = b.length;
  while (e > 0 && b[e - 1] === 0) e--;
  return b.subarray(0, e);
}

function dimensions(b: Buffer): { w: number; h: number } | 'bad' | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    if (b.toString('latin1', 12, 16) !== 'IHDR') return 'bad';
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.toString('latin1', 0, 4) === 'GIF8') {
    return b.length >= 10 ? { w: b.readUInt16LE(6), h: b.readUInt16LE(8) } : 'bad';
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    for (let i = 0; i < 512 && p + 4 <= b.length; i++) {
      if (b[p] !== 0xff) return 'bad';
      const m = b[p + 1]!;
      if (m === 0xff) {
        p++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return p + 9 <= b.length ? { w: b.readUInt16BE(p + 7), h: b.readUInt16BE(p + 5) } : 'bad';
      }
      if (m === 0xda || m === 0xd9) return 'bad'; // image data before any frame header
      p += 2 + b.readUInt16BE(p + 2);
    }
    return 'bad';
  }
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const t = b.toString('latin1', 12, 16);
    if (t === 'VP8X' && b.length >= 30)
      return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8 ' && b.length >= 30)
      return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L' && b.length >= 25) {
      const v = b.readUInt32LE(21);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    return 'bad';
  }
  return null;
}

function endsCleanly(b: Buffer): boolean {
  if (b.readUInt32BE(0) === 0x89504e47) {
    let p = 8;
    for (let i = 0; i < 100000 && p + 12 <= b.length; i++) {
      const len = b.readUInt32BE(p);
      const type = b.toString('latin1', p + 4, p + 8);
      p += 12 + len;
      if (type === 'IEND') return p === b.length;
    }
    return false;
  }
  if (b.toString('latin1', 0, 4) === 'GIF8') {
    const t = trimZeros(b);
    return t[t.length - 1] === 0x3b;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // an end-of-image marker must exist; bytes after it are allowed because phone photos append a second image (MPF) or a video, so
    // for JPEG the trailer is only screened for markup below
    return b.lastIndexOf(Buffer.from([0xff, 0xd9])) > 2;
  }
  // WebP: the RIFF size must account for every byte
  const size = b.readUInt32LE(4) + 8;
  return size === b.length || size + 1 === b.length;
}

export function imageProblem(b: Buffer): string | null {
  const d = dimensions(b);
  if (d === null) return null;
  if (d === 'bad') return 'unreadable image header';
  const side = envInt('UPLOAD_MAX_IMAGE_SIDE', 16384);
  const mp = envInt('UPLOAD_MAX_IMAGE_MEGAPIXELS', 100);
  if (d.w < 1 || d.h < 1) return 'empty image';
  if (d.w > side || d.h > side || (d.w * d.h) / 1e6 > mp)
    return `image too large in pixels (${d.w}x${d.h})`;
  if (!endsCleanly(b)) return 'data after the end of the image';
  if (
    MARKUP.test(b.subarray(0, WINDOW).toString('latin1')) ||
    MARKUP.test(b.subarray(-WINDOW).toString('latin1'))
  )
    return 'script or markup inside the image';
  return null;
}
