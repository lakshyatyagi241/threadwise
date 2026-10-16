import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MEDIA_FAILURE,
  MediaFetchError,
} from '../../../src/infra/providers/whatsapp/media/media-fetch-error';
import { WhatsappInboundMediaFetcher } from '../../../src/infra/providers/whatsapp/media/whatsapp-inbound-media.fetcher';
import { FakeGraph, bearer, bspHeaders, pdfBytes, pngBytes, sha256Hex } from './fake-graph';
import {
  BSP_TOKEN,
  TOKEN,
  bspChannel,
  captureLogs,
  channel,
  makeStore,
  wabaHttpFor,
} from './support';

/**
 * The inbound half of the pipeline without a database: lookup -> guarded download -> streamed into the real media store, against a
 * fake Graph/media server. The Postgres-backed end-to-end spec drives the same code through the queue and the message row.
 */

let graph: FakeGraph;
let env: Awaited<ReturnType<typeof makeStore>>;

beforeAll(async () => {
  graph = await new FakeGraph().start();
});
afterAll(() => graph.stop());

beforeEach(async () => {
  env = await makeStore('local');
  graph.requests.length = 0;
  graph.auth = bearer(TOKEN);
  graph.mediaAuth = bearer(TOKEN);
});
afterEach(async () => {
  await env.cleanup();
  delete process.env.WHATSAPP_MEDIA_REQUEST_TIMEOUT_MS;
});

const meta = () => new WhatsappInboundMediaFetcher(env.store, wabaHttpFor(graph));

const request = (id: string, over: Record<string, unknown> = {}) => ({
  channel: channel(),
  mediaId: id,
  mediaKind: 'image' as const,
  declaredMime: 'image/png',
  ref: 'msg-1',
  ...over,
});

const failure = async (p: Promise<unknown>): Promise<MediaFetchError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof MediaFetchError) return err;
    throw err;
  }
  throw new Error('expected a MediaFetchError');
};

describe('an image, a document and a voice note go end to end into the store', () => {
  it('image: looked up, downloaded, verified against the announced hex sha256, stored under a generated key', async () => {
    const bytes = pngBytes(30_000);
    graph.add({ id: 'img-1', bytes, mime: 'image/png' });
    const stored = await meta().fetchAndStore(request('img-1', { sha256: sha256Hex(bytes) }));
    expect(stored).toMatchObject({
      mime: 'image/png',
      size: 30_000,
      kind: 'image',
      sha256: sha256Hex(bytes),
    });
    expect(stored.key).toMatch(/^chat\/11\/\d{4}\/\d{2}\/\d+_[0-9a-f]{24}\.png$/);
    expect((await readFile(join(env.dir, ...stored.key.split('/')))).equals(bytes)).toBe(true);

    // what Meta was asked: a lookup with the token and the phone number id, then a download with the token
    const [lookup] = graph.of('graph');
    expect(lookup!.path).toBe('/v23.0/img-1');
    expect(lookup!.query).toEqual({ phone_number_id: '1000000001' });
    expect(lookup!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(graph.of('media')[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('document: a PDF with its file name, kept for display only', async () => {
    const bytes = pdfBytes(300_000);
    graph.add({ id: 'doc-1', bytes, mime: 'application/pdf' });
    const stored = await meta().fetchAndStore(
      request('doc-1', {
        mediaKind: 'document',
        declaredMime: 'application/pdf',
        filename: 'Quote Q4.pdf',
      }),
    );
    expect(stored).toMatchObject({
      mime: 'application/pdf',
      kind: 'document',
      name: 'Quote Q4.pdf',
      size: 300_000,
    });
  });

  it("audio: an Ogg voice note keeps its Ogg type (the lookup's mime and the declared one only decide shared signatures)", async () => {
    const { oggOpusBytes } = await import('./fake-graph');
    const bytes = oggOpusBytes(9000);
    graph.add({ id: 'aud-1', bytes, mime: 'audio/ogg; codecs=opus' });
    const stored = await meta().fetchAndStore(
      request('aud-1', { mediaKind: 'audio', declaredMime: 'audio/ogg; codecs=opus' }),
    );
    expect(stored).toMatchObject({ mime: 'audio/ogg', kind: 'media', size: 9000 });
    expect(stored.key.endsWith('.ogg')).toBe(true);
  });
});

describe('the announced sha256', () => {
  it('base64 is read as well as hex', async () => {
    const bytes = pngBytes(4000);
    graph.add({ id: 'sha-b64', bytes, mime: 'image/png', sha256: 'auto-base64' });
    await expect(meta().fetchAndStore(request('sha-b64'))).resolves.toMatchObject({ size: 4000 });
  });

  it('a mismatch is refused, retryable (a cut transfer), and stores nothing', async () => {
    graph.add({
      id: 'sha-bad',
      bytes: pngBytes(4000),
      mime: 'image/png',
      sha256: sha256Hex(Buffer.from('another file')),
    });
    const e = await failure(meta().fetchAndStore(request('sha-bad')));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.SHA256_MISMATCH, retryable: true });
    expect(await env.local.stat('chat')).toBeNull();
  });

  it("the webhook's digest wins over the lookup's: that is the one that was signed", async () => {
    const bytes = pngBytes(4000);
    graph.add({ id: 'sha-w', bytes, mime: 'image/png' }); // the lookup announces the true digest
    const e = await failure(
      meta().fetchAndStore(
        request('sha-w', { sha256: sha256Hex(Buffer.from('what the webhook claimed')) }),
      ),
    );
    expect(e.code).toBe(MEDIA_FAILURE.SHA256_MISMATCH);
  });

  it('a digest in a format nobody knows does not block the file', async () => {
    graph.add({
      id: 'sha-odd',
      bytes: pngBytes(4000),
      mime: 'image/png',
      sha256: 'something-weird',
    });
    await expect(meta().fetchAndStore(request('sha-odd'))).resolves.toMatchObject({ size: 4000 });
  });

  it('no digest at all is fine', async () => {
    graph.add({ id: 'sha-none', bytes: pngBytes(4000), mime: 'image/png', sha256: null });
    await expect(meta().fetchAndStore(request('sha-none'))).resolves.toMatchObject({ size: 4000 });
  });
});

describe('size limits are enforced before and while the file streams', () => {
  it('a size the lookup announces over the limit for the kind refuses the file without downloading it', async () => {
    graph.add({ id: 'big-1', bytes: pngBytes(1000), mime: 'image/png', fileSize: 6 * 1024 * 1024 });
    const e = await failure(meta().fetchAndStore(request('big-1')));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.TOO_LARGE, retryable: false });
    expect(graph.downloads('big-1')).toBe(0);
  });

  it('a content length over the limit stops the download at the headers', async () => {
    graph.add({
      id: 'big-2',
      bytes: Buffer.concat([pngBytes(100), Buffer.alloc(5 * 1024 * 1024 + 10)]),
      mime: 'image/png',
      fileSize: null,
    });
    const e = await failure(meta().fetchAndStore(request('big-2')));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.TOO_LARGE, retryable: false });
  });

  it('a body that never says how long it is is counted as it flows and cut at the limit', async () => {
    graph.add({
      id: 'big-3',
      bytes: pngBytes(1000),
      mime: 'image/png',
      download: ['huge'],
      fileSize: null,
    });
    const e = await failure(meta().fetchAndStore(request('big-3', { mediaKind: 'sticker' }))); // sticker: 500 KB
    expect(e).toMatchObject({ code: MEDIA_FAILURE.TOO_LARGE, retryable: false });
    expect(await env.local.stat('chat')).toBeNull();
  });

  it('the kind decides the limit: the same size passes as a document', async () => {
    const bytes = pdfBytes(6 * 1024 * 1024);
    graph.add({ id: 'big-4', bytes, mime: 'application/pdf' });
    await expect(
      meta().fetchAndStore(
        request('big-4', { mediaKind: 'document', declaredMime: 'application/pdf' }),
      ),
    ).resolves.toMatchObject({ size: bytes.length });
  });
});

describe('failures are classified for the worker', () => {
  it('a 5xx from the lookup, then success, is the retry the worker performs', async () => {
    const bytes = pngBytes(4000);
    graph.add({ id: 'retry-1', bytes, mime: 'image/png', lookup: ['500', 'ok'] });
    const first = await failure(meta().fetchAndStore(request('retry-1')));
    expect(first).toMatchObject({ code: MEDIA_FAILURE.DOWNLOAD_FAILED, retryable: true });
    await expect(meta().fetchAndStore(request('retry-1'))).resolves.toMatchObject({ size: 4000 });
    expect(graph.lookups('retry-1')).toBe(2);
  });

  it('a 500 on the download is retryable; a truncated body too, and neither leaves a file', async () => {
    graph.add({
      id: 'retry-2',
      bytes: pngBytes(50_000),
      mime: 'image/png',
      download: ['500', 'truncate', 'ok'],
    });
    expect(await failure(meta().fetchAndStore(request('retry-2')))).toMatchObject({
      retryable: true,
    });
    expect(await failure(meta().fetchAndStore(request('retry-2')))).toMatchObject({
      code: MEDIA_FAILURE.DOWNLOAD_FAILED,
      retryable: true,
    });
    expect(await env.local.stat('chat')).toBeNull();
    await expect(meta().fetchAndStore(request('retry-2'))).resolves.toMatchObject({ size: 50_000 });
  });

  it('an id Meta no longer has (they expire after about 30 days) is permanent', async () => {
    const e = await failure(meta().fetchAndStore(request('expired-id')));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.EXPIRED, retryable: false });
  });

  it('a token Meta refuses is permanent and says to reconnect', async () => {
    graph.auth = bearer('a-different-token');
    graph.add({ id: 'auth-1', bytes: pngBytes(), mime: 'image/png' });
    const e = await failure(meta().fetchAndStore(request('auth-1')));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.AUTH, retryable: false });
  });

  it('bytes the platform does not accept are permanent (a script sent as an image)', async () => {
    graph.add({
      id: 'bad-1',
      bytes: Buffer.from('<html><script>steal()</script></html>'),
      mime: 'image/png',
    });
    const e = await failure(meta().fetchAndStore(request('bad-1')));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.REJECTED, retryable: false });
  });

  it('a channel with no credentials never reaches the network', async () => {
    const e = await failure(
      meta().fetchAndStore(request('x', { channel: channel({ credentials: {} }) })),
    );
    expect(e).toMatchObject({ code: MEDIA_FAILURE.NO_CREDENTIALS, retryable: false });
    expect(graph.requests).toHaveLength(0);
  });

  it('a download that is slow to start is cut at the request timeout and is retryable', async () => {
    process.env.WHATSAPP_MEDIA_REQUEST_TIMEOUT_MS = '1000';
    graph.slowMs = 4000;
    graph.add({ id: 'slow-1', bytes: pngBytes(), mime: 'image/png', download: ['slow'] });
    const started = Date.now();
    const e = await failure(meta().fetchAndStore(request('slow-1')));
    expect(Date.now() - started).toBeLessThan(3500);
    expect(e).toMatchObject({ code: MEDIA_FAILURE.DOWNLOAD_FAILED, retryable: true });
  });

  it('a worker that is being stopped cancels the transfer', async () => {
    graph.add({
      id: 'abort-1',
      bytes: pngBytes(1000),
      mime: 'image/png',
      download: ['huge'],
      fileSize: null,
    });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 150);
    const e = await failure(
      meta().fetchAndStore(request('abort-1', { mediaKind: 'document', signal: ctl.signal })),
    );
    expect(e.retryable).toBe(true);
  });
});

describe("providers: the headers and the host come from the channel's provider, never from a constant", () => {
  it('the Interakt route: custom headers on the lookup and the download, no Authorization anywhere, its own version', async () => {
    graph.auth = bspHeaders(BSP_TOKEN, '555');
    graph.mediaAuth = bspHeaders(BSP_TOKEN, '555');
    const bytes = pngBytes(7000);
    graph.add({ id: 'bsp-1', bytes, mime: 'image/png' });
    const stored = await meta().fetchAndStore(request('bsp-1', { channel: bspChannel() }));
    expect(stored.size).toBe(7000);
    for (const r of graph.requests) {
      expect(r.headers['x-access-token']).toBe(BSP_TOKEN);
      expect(r.headers['x-waba-id']).toBe('555');
      expect(r.headers.authorization).toBeUndefined();
    }
    expect(graph.of('graph')[0]!.path).toBe('/v24.0/bsp-1');
    expect(graph.of('graph')[0]!.query).toEqual({}); // the Meta-only ownership parameter is not sent to a proxy
  });

  it("the provider's credential failure is not the customer's token problem: no channel token is needed in platform mode", async () => {
    graph.auth = bspHeaders(BSP_TOKEN, '555');
    graph.mediaAuth = bspHeaders(BSP_TOKEN, '555');
    graph.add({ id: 'bsp-2', bytes: pngBytes(), mime: 'image/png' });
    await expect(
      meta().fetchAndStore(request('bsp-2', { channel: bspChannel() })),
    ).resolves.toBeTruthy();
  });
});

describe('credentials and signed addresses never reach a log or an error', () => {
  it('across success, failure and refusal, the logs and errors hold no token and no signed query', async () => {
    const logs = captureLogs(Logger);
    try {
      const bytes = pngBytes(5000);
      graph.add({
        id: 'log-ok',
        bytes,
        mime: 'image/png',
        downloadUrl: `${graph.mediaUrl}/files/log-ok?hash=SIGNEDQUERY&ext=1`,
      });
      await meta().fetchAndStore(request('log-ok'));

      graph.auth = bearer('another');
      const errors: string[] = [];
      for (const id of ['log-ok', 'log-missing']) {
        const e = await failure(meta().fetchAndStore(request(id)));
        errors.push(e.message, JSON.stringify(e), e.stack ?? '');
      }
      graph.auth = bearer(TOKEN);
      graph.add({
        id: 'log-5xx',
        bytes,
        mime: 'image/png',
        download: ['500'],
        downloadUrl: `${graph.mediaUrl}/files/log-5xx?hash=SIGNEDQUERY`,
      });
      const e500 = await failure(meta().fetchAndStore(request('log-5xx')));
      errors.push(e500.message, e500.stack ?? '');

      const everything = [...logs.lines, ...errors].join('\n');
      expect(everything).not.toContain(TOKEN);
      expect(everything).not.toContain('SIGNEDQUERY');
      expect(everything).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
      expect(logs.lines.length).toBeGreaterThan(0); // the logger really was captured (the success path logs a line)
    } finally {
      logs.restore();
    }
  });

  it('the fake server saw the token (it is sent), so the assertion above is not vacuous', async () => {
    graph.add({ id: 'log-seen', bytes: pngBytes(1000), mime: 'image/png' });
    await meta().fetchAndStore(request('log-seen'));
    expect(graph.dump()).toContain(TOKEN);
  });
});

describe('an Interakt number with its business token looks the file up on Meta', () => {
  it('the lookup and the download carry the business token; the partner key never goes to Meta', async () => {
    const bytes = pngBytes(20_000);
    graph.add({ id: 'ik-1', bytes, mime: 'image/png' });
    const interaktWithToken = channel({
      credentials: { route: 'interakt', authKey: BSP_TOKEN, businessAccountId: '555', accessToken: TOKEN },
    });
    const stored = await meta().fetchAndStore(request('ik-1', { channel: interaktWithToken }));
    expect(stored).toMatchObject({ kind: 'image', size: 20_000 });

    const lookups = graph.of('graph').filter((r) => r.path.includes('/ik-1'));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(lookups[0]!.headers['x-access-token']).toBeUndefined();

    const media = graph.of('media');
    expect(media).toHaveLength(1);
    expect(media[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(media[0]!.headers['x-access-token']).toBeUndefined();
  });
});
