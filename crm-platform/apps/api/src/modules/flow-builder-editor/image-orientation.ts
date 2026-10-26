import sharp from 'sharp';

/** The pictures whose files can carry an EXIF orientation that WhatsApp does not apply. */
const ORIENTED = new Set(['image/jpeg', 'image/webp']);
const QUALITY = 92;

/**
 * A phone saves a picture's pixels as the sensor read them and writes an EXIF "rotate when showing" tag. Browsers turn the picture by
 * the tag, WhatsApp does not, so a bot's image arrived sideways. When the tag asks for any turn, the pixels are turned and the tag is
 * left out; a picture with no tag, or a file that cannot be read, is kept byte for byte. The ICC colour profile stays.
 */
export async function upright(buffer: Buffer, mime: string): Promise<Buffer> {
  if (!ORIENTED.has(mime)) return buffer;
  try {
    const { orientation } = await sharp(buffer).metadata();
    if (!orientation || orientation === 1) return buffer;
    const turned = sharp(buffer).rotate().keepIccProfile();
    return await (
      mime === 'image/webp' ? turned.webp({ quality: QUALITY }) : turned.jpeg({ quality: QUALITY })
    ).toBuffer();
  } catch {
    return buffer;
  }
}
