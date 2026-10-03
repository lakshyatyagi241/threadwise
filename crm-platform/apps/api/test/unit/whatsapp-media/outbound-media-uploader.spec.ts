import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { ChannelError } from '../../../src/infra/providers/chat-conversations/channel.port';
import { WhatsappOutboundMediaUploader } from '../../../src/infra/providers/whatsapp/media/whatsapp-outbound-media.uploader';
import { FakeGraph, bearer, bspHeaders, pngBytes } from './fake-graph';
import { BSP_TOKEN, TOKEN, bspChannel, channel, makeStore, wabaHttpFor } from './support';

/**
 * The outbound half of the pipeline: a stored file is got to WhatsApp before its message is sent. On the Meta route it is uploaded through
 * `WabaHttp` (a multipart form to `/{phone-number-id}/media`); on the Interakt route, which documents no upload endpoint, the message
 * carries a temporary public link to the stored file when the store can make one.
 */

let graph: FakeGraph;
let env: Awaited<ReturnType<typeof makeStore>>;

beforeAll(async () => {
  graph = await new FakeGraph().start();
});
afterAll(() => graph.stop());

afterEach(async () => {
  await env.cleanup();
});

const uploader = () => new WhatsappOutboundMediaUploader(env.store, wabaHttpFor(graph));
const put = async (name = 'a.png', bytes = pngBytes(3000)) => {
  const stored = await env.store.store({ orgId: 11, filename: name, buffer: bytes });
  return {
    key: stored.key,
    mediaKind: 'image' as const,
    mime: 'image/png',
    name,
    sha256: stored.sha256,
  };
};

describe('the Meta route: an upload through WabaHttp', () => {
  beforeEach(async () => {
    env = await makeStore('local');
    graph.requests.length = 0;
    graph.auth = bearer(TOKEN);
  });

  it("uploads the stored bytes with the connection's token to the number's media endpoint and names the returned id", async () => {
    const file = await put();
    const prepared = await uploader().prepare(channel(), file);
    expect(prepared).toMatchObject({
      via: 'id',
      mediaId: expect.stringMatching(/^uploaded-/),
      cached: false,
      kind: 'image',
      mime: 'image/png',
    });
    const req = graph.of('graph')[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v23.0/1000000001/media');
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.upload!.fields).toEqual({ messaging_product: 'whatsapp', type: 'image/png' });
    expect(req.upload!.bytes.length).toBe(3000);
  });

  it('the same file on the same number is uploaded once: the media id is reused, and `forget` makes the next send upload again', async () => {
    const file = await put('b.png', pngBytes(2500));
    const up = uploader();
    const first = await up.prepare(channel(), file);
    const again = await up.prepare(channel(), file);
    expect(again).toMatchObject({
      via: 'id',
      mediaId: (first as { mediaId: string }).mediaId,
      cached: true,
    });
    expect(graph.of('graph')).toHaveLength(1);
    await up.forget(channel(), file);
    const fresh = await up.prepare(channel(), file);
    expect(fresh).toMatchObject({ cached: false });
    expect(graph.of('graph')).toHaveLength(2);
  });

  it('a refused token is a permanent refusal that needs a new token, and carries no credential', async () => {
    graph.auth = bearer('another-token');
    const file = await put('c.png', pngBytes(2200));
    const err = (await uploader()
      .prepare(channel(), file)
      .catch((e: unknown) => e)) as ChannelError;
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ retryable: false, needsReauth: true });
    expect(err.message).not.toContain(TOKEN);
  });

  it('a connection with no token sends nothing', async () => {
    const file = await put('d.png', pngBytes(2300));
    await expect(uploader().prepare(channel({ credentials: {} }), file)).rejects.toMatchObject({
      code: 'WA_MEDIA_NO_CREDENTIALS',
      needsReauth: true,
    });
    expect(graph.requests).toHaveLength(0);
  });

  it('a file that is not in the store is a permanent refusal before any call', async () => {
    await expect(
      uploader().prepare(channel(), {
        key: 'chat/11/2026/10/missing.png',
        mediaKind: 'image',
        mime: 'image/png',
      }),
    ).rejects.toMatchObject({ retryable: false });
    expect(graph.requests).toHaveLength(0);
  });
});

describe('the Interakt route: no upload endpoint, so the file goes by public link', () => {
  const bytes = pngBytes(2400);
  /** A store whose files are in a bucket: the first bytes can be read, and a signed link can be made (or not, for local disk). */
  const bucketStore = (link: { url: string; expiresAt: Date } | null) =>
    ({
      open: vi.fn(async (_org: number, _key: string, range?: { start: number; end?: number }) => ({
        stream: Readable.from([
          range ? bytes.subarray(range.start, (range.end ?? bytes.length - 1) + 1) : bytes,
        ]),
        size: bytes.length,
        partial: range !== undefined,
      })),
      temporaryPublicLink: vi.fn(async () => link),
    }) as unknown as ChatMediaStore;
  const file = {
    key: 'chat/11/2026/10/e.png',
    mediaKind: 'image' as const,
    mime: 'image/png',
    name: 'e.png',
  };

  beforeEach(() => {
    graph.requests.length = 0;
    graph.auth = bspHeaders(BSP_TOKEN, '555');
  });

  it('with a store that can make a temporary link (a cloud bucket), the message carries the link and nothing is uploaded', async () => {
    const expiresAt = new Date(Date.now() + 900_000);
    const store = bucketStore({
      url: 'https://bucket.example/chat/11/2026/10/e.png?sig=SIGNED',
      expiresAt,
    });
    const prepared = await new WhatsappOutboundMediaUploader(store, wabaHttpFor(graph)).prepare(
      bspChannel(),
      file,
    );
    expect(prepared).toEqual({
      via: 'link',
      link: 'https://bucket.example/chat/11/2026/10/e.png?sig=SIGNED',
      expiresAt,
      kind: 'image',
      mime: 'image/png',
      voice: false,
    });
    expect(graph.requests).toHaveLength(0);
  });

  it('with local disk storage there is no public address to give: a permanent refusal that says why', async () => {
    const up = new WhatsappOutboundMediaUploader(bucketStore(null), wabaHttpFor(graph));
    await expect(up.prepare(bspChannel(), file)).rejects.toMatchObject({
      code: 'WA_MEDIA_UPLOAD_UNSUPPORTED',
      retryable: false,
    });
    expect(graph.requests).toHaveLength(0);
  });
});
