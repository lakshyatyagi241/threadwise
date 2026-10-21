import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChatMediaStore,
  MediaTokenService,
  type StoredMedia,
} from '../../../../src/infra/providers/chat-conversations/media';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../../contacts-attributes-tags/support';
import { pngWithText, jpegOfSize } from '../../../support/images';

/**
 * The chat media door end to end: the platform's real storage service and upload policy behind `ChatMediaStore`, local disk as the
 * store (the platform has no bucket configured), and the authenticated media route reading it back. Real Postgres and Redis, the
 * real API.
 */
let h: Harness;
let api: Api;
let root: string;
let store: ChatMediaStore;
let tokens: MediaTokenService;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'crm-media-e2e-'));
  process.env.MEDIA_LOCAL_DIR = root;
  h = await startHarness();
  api = new Api(h);
  store = h.app.get(ChatMediaStore);
  tokens = h.app.get(MediaTokenService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
  await rm(root, { recursive: true, force: true });
  delete process.env.MEDIA_LOCAL_DIR;
});

const PNG = pngWithText('0123456789abcdefghijklmnopqrstuvwxyz');
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('some document bytes')]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(40, 9)]);

/** GET the media route as a person, with the body as raw bytes whatever its type. */
const get = (path: string, token?: string, headers: Record<string, string> = {}) => {
  const req = api
    .http()
    .get(path)
    .set(token ? bearer(token) : {})
    .set(headers)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  return req;
};
const route = (link: string) => link.replace('/api', '');

async function setup(label: string) {
  const t: Tenant = await api.signup(label);
  const member = await api.member(t, 'reader', []);
  return { t, member };
}

describe('storing: the real upload policy and storage settings', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = (await setup('med')).t;
  });

  it('writes under MEDIA_LOCAL_DIR (outside the repository), under the workspace, with a generated name', async () => {
    const stored = await store.store({
      orgId: t.orgId,
      filename: 'Holiday Photo.PNG',
      buffer: PNG,
    });
    expect(stored.key).toMatch(
      new RegExp(`^chat/${t.orgId}/\\d{4}/\\d{2}/\\d+_[0-9a-f]{24}\\.png$`),
    );
    expect(stored).toMatchObject({
      mime: 'image/png',
      kind: 'image',
      size: PNG.length,
      name: 'Holiday Photo.PNG',
    });
    const files = (await readdir(root, { recursive: true })).map(String);
    expect(files.some((f) => f.replace(/\\/g, '/').endsWith(stored.key.split('/').pop()!))).toBe(
      true,
    );
  });

  it.each([
    ['an html page', 'x.html', Buffer.from('<html><script>alert(1)</script></html>')],
    ['an svg', 'x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['php', 'x.php', Buffer.from('<?php echo 1;')],
    ['a PDF renamed .png', 'x.png', PDF],
    ['no extension', 'x', PNG],
  ])('refuses %s', async (_name, filename, buffer) => {
    await expect(store.store({ orgId: t.orgId, filename, buffer })).rejects.toMatchObject({
      code: 'AUTH_UPLOAD_REJECTED',
    });
  });

  it('refuses an image over its 5 MB limit and an inbound file whose bytes are markup', async () => {
    const big = jpegOfSize(5 * 1024 * 1024 + 4);
    await expect(
      store.store({ orgId: t.orgId, filename: 'big.jpg', buffer: big }),
    ).rejects.toMatchObject({ code: 'AUTH_UPLOAD_REJECTED' });
    await expect(
      store.storeInbound({
        orgId: t.orgId,
        buffer: Buffer.from('<html>hi</html>'),
        declaredMime: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_UPLOAD_REJECTED' });
  });
});

describe('GET /v2/media/:token', () => {
  let a: Awaited<ReturnType<typeof setup>>;
  let b: Awaited<ReturnType<typeof setup>>;
  let image: StoredMedia;
  let doc: StoredMedia;
  let archive: StoredMedia;
  const linkFor = (
    m: StoredMedia,
    who: { orgId: number; userId: number },
    name = m.name,
    mime: string | null = m.mime,
  ) => route(store.accessUrl(m.key, who, { name, mime }));

  beforeAll(async () => {
    a = await setup('mea');
    b = await setup('meb');
    image = await store.store({ orgId: a.t.orgId, filename: 'photo.png', buffer: PNG });
    doc = await store.store({ orgId: a.t.orgId, filename: 'terms.pdf', buffer: PDF });
    archive = await store.store({ orgId: a.t.orgId, filename: 'bundle.zip', buffer: ZIP });
  });
  const me = () => ({ orgId: a.t.orgId, userId: a.member.userId });

  it('streams the stored bytes to the person the link was made for, with the headers a customer file needs', async () => {
    const res = await get(linkFor(image, me()), a.member.token);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    expect(res.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(PNG.length),
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'private, max-age=300',
      'content-disposition': "inline; filename*=UTF-8''photo.png",
    });
  });

  it('serves a byte range as 206 with Content-Range, so audio and video can seek', async () => {
    const res = await get(linkFor(image, me()), a.member.token, { range: 'bytes=8-17' });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 8-17/${PNG.length}`);
    expect((res.body as Buffer).toString()).toBe('0123456789');

    const open = await get(linkFor(image, me()), a.member.token, { range: 'bytes=40-' });
    expect(open.status).toBe(206);
    expect(open.headers['content-range']).toBe(`bytes 40-${PNG.length - 1}/${PNG.length}`);

    const beyond = await get(linkFor(image, me()), a.member.token, {
      range: `bytes=${PNG.length + 10}-`,
    });
    expect(beyond.status).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${PNG.length}`);

    // A range it does not understand is answered with the whole file, which the standard allows.
    const odd = await get(linkFor(image, me()), a.member.token, { range: 'bytes=-5' });
    expect(odd.status).toBe(200);
  });

  it('shows images and PDFs inline and offers anything else as a download, never trusting a type it was not given', async () => {
    const pdf = await get(linkFor(doc, me()), a.member.token);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe("inline; filename*=UTF-8''terms.pdf");

    const zip = await get(linkFor(archive, me()), a.member.token);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toBe("attachment; filename*=UTF-8''bundle.zip");

    // A link that claims a dangerous type is served as what the key's extension says, or as bytes.
    const lie = await get(linkFor(image, me(), 'x.png', 'text/html'), a.member.token);
    expect(lie.headers['content-type']).toBe('image/png');
    const bytes = await get(linkFor(archive, me(), 'x.html', 'text/html'), a.member.token);
    expect(bytes.headers['content-type']).toBe('application/octet-stream');
    expect(bytes.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('keeps a hostile file name out of the headers', async () => {
    const res = await get(
      linkFor(image, me(), 'évil"\r\nSet-Cookie: pwned=1; x.png'),
      a.member.token,
    );
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['content-disposition']).toMatch(
      /^inline; filename\*=UTF-8''[A-Za-z0-9%._~!$&+,/:;=@-]+$/,
    );
    expect(decodeURIComponent(res.headers['content-disposition'].split("''")[1]!)).toContain(
      'évil"',
    );
  });

  it('needs a session', async () => {
    expect((await get(linkFor(image, me()))).status).toBe(401);
    expect((await get(linkFor(image, me()), 'garbage')).status).toBe(401);
  });

  it('is a plain 404, the same for every refusal, so it confirms nothing about what exists', async () => {
    const link = linkFor(image, me());
    const refusals = [
      // Someone else in the same workspace holding the link.
      await get(link, (await api.member(a.t, 'nosy', [])).token),
      // The other workspace's admin holding it.
      await get(link, b.t.admin),
      // A link minted for the other workspace's person, naming this workspace's key.
      await get(
        route(store.accessUrl(image.key, { orgId: b.t.orgId, userId: b.member.userId })),
        b.member.token,
      ),
      // Expired.
      await get(
        `/v2/media/${tokens.sign({ key: image.key, ...me() }, 300, Date.now() - 10 * 60_000)}`,
        a.member.token,
      ),
      // Tampered.
      await get(`${link.slice(0, -4)}AAAA`, a.member.token),
      // Not a token at all.
      await get('/v2/media/not-a-token', a.member.token),
      // A key that was never stored.
      await get(
        route(store.accessUrl(`chat/${a.t.orgId}/2026/10/ffffffffffffffffffffffff.png`, me())),
        a.member.token,
      ),
      // Traversal in a sealed key (only the server could make this token; it must still not resolve).
      await get(
        `/v2/media/${tokens.sign({ key: `chat/${a.t.orgId}/../../../etc/passwd`, ...me() })}`,
        a.member.token,
      ),
      await get(
        `/v2/media/${tokens.sign({ key: `../chat/${a.t.orgId}/x.png`, ...me() })}`,
        a.member.token,
      ),
    ];
    for (const res of refusals) {
      expect(res.status).toBe(404);
      expect(res.body.toString()).not.toContain(image.key);
    }
    expect(
      new Set(refusals.map((r) => (r.headers['content-type'] as string).split(';')[0])).size,
    ).toBe(1);
  });

  it("never reads another workspace's file even for a person who is a member of both (key outside the caller's workspace)", async () => {
    const theirs = await store.store({ orgId: b.t.orgId, filename: 'secret.png', buffer: PNG });
    // A token the other workspace's person legitimately holds works for them...
    const own = route(store.accessUrl(theirs.key, { orgId: b.t.orgId, userId: b.member.userId }));
    expect((await get(own, b.member.token)).status).toBe(200);
    // ...and a token for the same key claiming workspace A is refused: the key is not A's.
    const forged = `/v2/media/${tokens.sign({ key: theirs.key, orgId: a.t.orgId, userId: a.member.userId })}`;
    expect((await get(forged, a.member.token)).status).toBe(404);
  });
});
