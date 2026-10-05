import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Client-side encryption of a dump before it leaves the host. A dump holds every tenant's contacts, messages and sealed
 * credentials; the bucket provider encrypts at rest, but anyone who gets the bucket keys would read the plaintext. With this,
 * they would also need the backup key, which is kept apart from the bucket keys and from CREDENTIALS_ENCRYPTION_KEY.
 *
 * File layout: `DSK1` | key id (4 bytes) | iv (12) | AES-256-GCM ciphertext | tag (16). The key id lets a rotated key still open
 * its old files.
 */
const MAGIC = Buffer.from('DSK1');
const HEADER = MAGIC.length + 4 + 12;
const TAG = 16;

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== 32)
    throw new Error('the backup key must be 32 bytes, base64 (openssl rand -base64 32)');
  return key;
}
export const keyIdOf = (key: Buffer): Buffer =>
  createHash('sha256').update(key).digest().subarray(0, 4);

export async function sealFile(src: string, dest: string, key: Buffer): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, keyIdOf(key), iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) =>
    out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())),
  );
}

/** Opens a sealed file with whichever of `keys` matches its key id. Writes `dest` only if the tag verifies. */
export async function openFile(src: string, dest: string, keys: Buffer[]): Promise<void> {
  const fh = await open(src, 'r');
  try {
    const { size } = await fh.stat();
    if (size < HEADER + TAG) throw new Error('not a sealed backup (too short)');
    const head = Buffer.alloc(HEADER);
    await fh.read(head, 0, HEADER, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error('not a sealed backup (bad header)');
    const id = head.subarray(MAGIC.length, MAGIC.length + 4);
    const key = keys.find((k) => keyIdOf(k).equals(id));
    if (!key) throw new Error(`no key for this backup (key id ${id.toString('hex')})`);
    const tag = Buffer.alloc(TAG);
    await fh.read(tag, 0, TAG, size - TAG);
    const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length + 4));
    decipher.setAuthTag(tag);
    const part = `${dest}.part`;
    try {
      // an empty plaintext has an empty ciphertext: there is no byte range to read
      const body =
        size === HEADER + TAG
          ? Readable.from([])
          : createReadStream(src, { start: HEADER, end: size - TAG - 1 });
      await pipeline(body, decipher, createWriteStream(part, { mode: 0o600 }));
      await rename(part, dest);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
  } finally {
    await fh.close();
  }
}
