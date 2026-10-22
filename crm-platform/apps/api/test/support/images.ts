// Structurally valid tiny images of an exact byte size, for specs that exercise the upload policy (it checks the whole file).
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
export function pngOfSize(size = 67): Buffer {
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.concat([
    u32(13),
    Buffer.from('IHDR'),
    u32(1),
    u32(1),
    Buffer.from([8, 2, 0, 0, 0]),
    u32(0),
  ]);
  const iend = Buffer.concat([u32(0), Buffer.from('IEND'), u32(0)]);
  const fixed = sig.length + ihdr.length + iend.length;
  if (size <= fixed) return Buffer.concat([sig, ihdr, iend]);
  const padLen = size - fixed - 12;
  const pad =
    padLen >= 0
      ? Buffer.concat([u32(padLen), Buffer.from('tEXt'), Buffer.alloc(padLen), u32(0)])
      : Buffer.alloc(0);
  return Buffer.concat([sig, ihdr, pad, iend]);
}
export function jpegOfSize(size = 40): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(1, 5);
  sof.writeUInt16BE(1, 7);
  sof[9] = 3;
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let left = Math.max(0, size - 2 - 19 - 2);
  while (left >= 4) {
    // comment segments of at most 60000 bytes each carry the padding
    const n = Math.min(left, 60000);
    const c = Buffer.alloc(n);
    c.writeUInt16BE(0xfffe, 0);
    c.writeUInt16BE(n - 2, 2);
    parts.push(c);
    left -= n;
  }
  parts.push(Buffer.alloc(left), sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
export function gifOfSize(size = 14): Buffer {
  const h = Buffer.alloc(13);
  h.write('GIF89a', 0, 'latin1');
  h.writeUInt16LE(1, 6);
  h.writeUInt16LE(1, 8);
  return Buffer.concat([h, Buffer.from([0x3b]), Buffer.alloc(Math.max(0, size - 14))]);
}
export function webpOfSize(): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUInt32LE(10, 16);
  return b;
}
/** A valid PNG whose tEXt chunk carries `text` (distinct bytes per fixture). */
export function pngWithText(text: string): Buffer {
  const u = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const ihdr = Buffer.concat([u(13), Buffer.from('IHDR'), u(1), u(1), Buffer.from([8, 2, 0, 0, 0]), u(0)]);
  const t = Buffer.from(text);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), ihdr, u(t.length), Buffer.from('tEXt'), t, u(0), u(0), Buffer.from('IEND'), u(0)]);
}
