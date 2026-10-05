import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  downloadProviderAvatar,
  isPublicHttpsUrl,
  sniffImage,
} from '../../../src/infra/providers/auth-registration-security/avatar-download';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

const respond = (body: Buffer | string, init: ResponseInit = {}) =>
  (async () => new Response(body, { status: 200, ...init })) as unknown as typeof fetch;

describe('provider profile picture download (WD-AUTH-004 rule 4)', () => {
  it('stores a real image: type from its bytes, never from the header', async () => {
    const got = await downloadProviderAvatar('https://lh3.googleusercontent.example.com/a.png', {
      fetchImpl: respond(PNG, { headers: { 'content-type': 'text/html' } }),
    });
    expect(got).toMatchObject({ mime: 'image/png' });
    expect(got!.bytes.equals(PNG)).toBe(true);
    expect(got!.etag).toMatch(/^[0-9a-f]{16}$/);
    const jpeg = await downloadProviderAvatar('https://cdn.example.com/p', {
      fetchImpl: respond(JPEG),
    });
    expect(jpeg?.mime).toBe('image/jpeg');
  });

  it('sniffs the four formats the avatar column accepts and nothing else', () => {
    expect(sniffImage(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(
      sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])),
    ).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html></html>'))).toBeNull();
  });

  it('refuses anything but a public https address, without calling out', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(PNG);
    }) as unknown as typeof fetch;
    for (const url of [
      'http://cdn.example.com/a.png',
      'https://127.0.0.1/a.png',
      'https://10.0.0.5/a.png',
      'https://[::1]/a.png',
      'https://localhost/a.png',
      'https://intranet/a.png',
      'https://metadata.internal/a.png',
      'https://user:pw@cdn.example.com/a.png',
      'file:///etc/passwd',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(await downloadProviderAvatar(url, { fetchImpl })).toBeNull();
    }
    expect(calls).toBe(0);
    expect(isPublicHttpsUrl('https://cdn.example.com/a.png')).toBe(true);
  });

  it('is null for a refusal, a redirect, a non-image, an oversized body or a failure', async () => {
    const url = 'https://cdn.example.com/a.png';
    expect(
      await downloadProviderAvatar(url, { fetchImpl: respond('nope', { status: 404 }) }),
    ).toBeNull();
    expect(await downloadProviderAvatar(url, { fetchImpl: respond('<html></html>') })).toBeNull();
    expect(
      await downloadProviderAvatar(url, {
        fetchImpl: respond(PNG, { headers: { 'content-length': String(AVATAR_MAX_BYTES + 1) } }),
      }),
    ).toBeNull();
    // no content-length, but the stream goes past the limit
    const big = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES, 3)]);
    expect(await downloadProviderAvatar(url, { fetchImpl: respond(big) })).toBeNull();
    const boom = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    expect(await downloadProviderAvatar(url, { fetchImpl: boom })).toBeNull();
  });

  it('does not follow a redirect to somewhere else', async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_u: unknown, i?: RequestInit) => {
      init = i;
      return new Response(PNG);
    }) as unknown as typeof fetch;
    await downloadProviderAvatar('https://cdn.example.com/a.png', { fetchImpl });
    expect(init?.redirect).toBe('error');
  });
});
