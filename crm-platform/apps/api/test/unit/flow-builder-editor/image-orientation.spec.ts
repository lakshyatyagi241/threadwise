import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { upright } from '../../../src/modules/flow-builder-editor/image-orientation';

/** A 40 wide, 20 high picture saved the way a phone does it: the pixels as read, plus an EXIF turn tag. */
const photo = (orientation?: number) =>
  sharp({ create: { width: 40, height: 20, channels: 3, background: '#c33' } })
    .jpeg()
    .withMetadata(orientation ? { orientation } : {})
    .toBuffer();

describe('upright', () => {
  it('turns the pixels of a picture that carries an EXIF turn and leaves the tag out', async () => {
    const out = await upright(await photo(6), 'image/jpeg');
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.orientation).toBeUndefined();
  });

  it('turns a PNG that carries the tag too', async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#33c' } })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await upright(png, 'image/png');
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.format).toBe('png');
  });

  it('keeps a picture with no tag byte for byte', async () => {
    const src = await photo();
    expect(await upright(src, 'image/jpeg')).toBe(src);
  });

  it('keeps a picture that is already upright byte for byte', async () => {
    const src = await photo(1);
    expect(await upright(src, 'image/jpeg')).toBe(src);
  });

  it('leaves other kinds of file alone', async () => {
    const src = Buffer.from('not a picture');
    expect(await upright(src, 'application/pdf')).toBe(src);
    expect(await upright(src, 'image/jpeg')).toBe(src);
  });
});
