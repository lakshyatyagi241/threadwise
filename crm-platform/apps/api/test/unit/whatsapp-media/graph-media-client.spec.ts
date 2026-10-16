import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GraphMediaClient,
  classifyGraphFailure,
  downloadHeadersFor,
  graphFailureOf,
} from '../../../src/infra/providers/whatsapp/media/graph-media.client';
import {
  MEDIA_FAILURE,
  MediaFetchError,
  redact,
  safeUrlForLog,
} from '../../../src/infra/providers/whatsapp/media/media-fetch-error';
import type { MediaProviderProfile } from '../../../src/infra/providers/whatsapp/media/media-provider';
import { whatsappMediaConfig } from '../../../src/infra/providers/whatsapp/media/whatsapp-media.config';
import { FakeGraph, bearer, bspHeaders, pngBytes, pdfBytes } from './fake-graph';
import {
  BSP_TOKEN,
  TOKEN,
  bspCtx,
  bspProfile as bspProfileOf,
  metaCtx,
  metaProfile as metaProfileOf,
  wabaHttpFor,
} from './support';

let graph: FakeGraph;
beforeAll(async () => {
  graph = await new FakeGraph().start();
});
afterAll(() => graph.stop());

const cfg = whatsappMediaConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const client = () => new GraphMediaClient(cfg, wabaHttpFor(graph));

/** Direct Meta, pointed at the fake: Authorization: Bearer from the connection's own token. */
const metaProfile = (): MediaProviderProfile => metaProfileOf(graph);
/** An Interakt-shaped route: the partner key in custom headers, no Authorization, no upload endpoint unless asked. */
const bspProfile = (upload = false): MediaProviderProfile => bspProfileOf(graph, upload);
const ctx = metaCtx;
const bsp = bspCtx;

beforeEach(() => {
  graph.requests.length = 0;
  graph.auth = bearer(TOKEN);
  graph.mediaAuth = null;
  graph.noUploadEndpoint = false;
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

const drain = async (s: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};

describe('lookup: GET {root}/{media-id}', () => {
  it('direct Meta: Authorization: Bearer with the channel token, phone_number_id on the query, the versioned path', async () => {
    graph.add({ id: 'L1', bytes: pngBytes(), mime: 'image/png' });
    const found = await client().lookup(metaProfile(), ctx, 'L1');
    expect(found).toMatchObject({
      mime: 'image/png',
      fileSize: 2048,
      url: `${graph.mediaUrl}/files/L1`,
    });
    expect(found.sha256).toMatch(/^[0-9a-f]{64}$/);
    const req = graph.of('graph')[0]!;
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/v23.0/L1');
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers['x-access-token']).toBeUndefined();
  });

  it('the Interakt route: its own headers, no Authorization at all, its own version, and no Meta-only query parameter', async () => {
    graph.auth = bspHeaders(BSP_TOKEN, '555');
    graph.add({ id: 'L2', bytes: pngBytes(), mime: 'image/png' });
    await client().lookup(bspProfile(), bsp, 'L2');
    const req = graph.of('graph')[0]!;
    expect(req.path).toBe('/v24.0/L2');
    expect(req.headers['x-access-token']).toBe(BSP_TOKEN);
    expect(req.headers['x-waba-id']).toBe('555');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.query).toEqual({});
  });

  it('refuses without sending anything when the provider builds no headers (no credentials)', async () => {
    const e = await failure(
      client().lookup(metaProfile(), { route: 'meta', phoneNumberId: '1' }, 'L1'),
    );
    expect(e.code).toBe(MEDIA_FAILURE.NO_CREDENTIALS);
    expect(e.retryable).toBe(false);
    expect(graph.requests).toHaveLength(0);
  });

  it('refuses a media id that could change the path, before any request', async () => {
    for (const id of ['../../x', '12/34', '12?x', '']) {
      expect((await failure(client().lookup(metaProfile(), ctx, id))).code).toBe(
        MEDIA_FAILURE.UNEXPECTED,
      );
    }
    expect(graph.requests).toHaveLength(0);
  });

  it('classifies the answers: rejected token, expired id, rate limit, server error', async () => {
    graph.auth = bearer('another-token');
    graph.add({ id: 'L3', bytes: pngBytes(), mime: 'image/png' });
    const auth = await failure(client().lookup(metaProfile(), ctx, 'L3'));
    expect(auth).toMatchObject({ code: MEDIA_FAILURE.AUTH, retryable: false });

    graph.auth = bearer(TOKEN);
    const gone = await failure(client().lookup(metaProfile(), ctx, 'never-existed'));
    expect(gone).toMatchObject({ code: MEDIA_FAILURE.EXPIRED, retryable: false });

    graph.add({ id: 'L4', bytes: pngBytes(), mime: 'image/png', lookup: ['429', '500'] });
    expect(await failure(client().lookup(metaProfile(), ctx, 'L4'))).toMatchObject({
      code: MEDIA_FAILURE.DOWNLOAD_FAILED,
      retryable: true,
    });
    expect(await failure(client().lookup(metaProfile(), ctx, 'L4'))).toMatchObject({
      code: MEDIA_FAILURE.DOWNLOAD_FAILED,
      retryable: true,
    });
  });

  it('a lookup answer that is not JSON, or has no address, is an unexpected (retryable) answer', async () => {
    graph.add({ id: 'L5', bytes: pngBytes(), mime: 'image/png', lookup: ['bad-json', 'no-url'] });
    expect((await failure(client().lookup(metaProfile(), ctx, 'L5'))).code).toBe(
      MEDIA_FAILURE.UNEXPECTED,
    );
    expect((await failure(client().lookup(metaProfile(), ctx, 'L5'))).code).toBe(
      MEDIA_FAILURE.UNEXPECTED,
    );
  });

  it('no credential value is ever in an error message', async () => {
    graph.auth = bearer('another-token');
    graph.add({ id: 'L6', bytes: pngBytes(), mime: 'image/png' });
    const e1 = await failure(client().lookup(metaProfile(), ctx, 'L6'));
    graph.auth = bspHeaders('different-token', '555');
    const e2 = await failure(client().lookup(bspProfile(), bsp, 'L6'));
    for (const e of [e1, e2]) {
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toContain(BSP_TOKEN);
      expect(JSON.stringify(e)).not.toContain(TOKEN);
    }
  });
});

describe('download: GET <url>', () => {
  it("streams the body, with the token to the provider's own host (here the fake is both Graph and media host)", async () => {
    const bytes = pdfBytes(10_000);
    graph.add({ id: 'D1', bytes, mime: 'application/pdf' });
    const d = await client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D1`);
    expect(d.contentLength).toBe(10_000);
    expect(d.contentType).toBe('application/pdf');
    expect((await drain(d.stream)).equals(bytes)).toBe(true);
    expect(graph.of('media')[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('a BSP profile sends its custom headers to its own host and never an Authorization header', async () => {
    graph.add({ id: 'D2', bytes: pngBytes(), mime: 'image/png' });
    const d = await client().download(bspProfile(), bsp, `${graph.mediaUrl}/files/D2`);
    await drain(d.stream);
    const req = graph.of('media')[0]!;
    expect(req.headers['x-access-token']).toBe(BSP_TOKEN);
    expect(req.headers.authorization).toBeUndefined();
  });

  it('a non-200 answer is a classified failure: 404 is gone, 500 is retryable', async () => {
    graph.add({ id: 'D3', bytes: pngBytes(), mime: 'image/png', download: ['404', '500'] });
    expect(
      await failure(client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D3`)),
    ).toMatchObject({
      code: MEDIA_FAILURE.EXPIRED,
      retryable: false,
    });
    expect(
      await failure(client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D3`)),
    ).toMatchObject({
      code: MEDIA_FAILURE.DOWNLOAD_FAILED,
      retryable: true,
    });
  });

  it('a bare 403 from the file host is a refused link, not a rejected token: retryable, never AUTH', async () => {
    graph.add({ id: 'D3b', bytes: pngBytes(), mime: 'image/png', download: ['403'] });
    const e = await failure(client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D3b`));
    expect(e).toMatchObject({ code: MEDIA_FAILURE.DOWNLOAD_FAILED, retryable: true });
    expect(e.message).toContain('HTTP 403');
  });

  it('a Meta file host with no business token to send is a missing credential, sent to no one', async () => {
    const e = await failure(
      client().download(bspProfile(), bspCtx, 'https://lookaside.fbsbx.com/files/NOTOKEN'),
    );
    expect(e).toMatchObject({ code: MEDIA_FAILURE.NO_CREDENTIALS, retryable: false });
    expect(graph.of('media')).toHaveLength(0);
  });

  it('follows a redirect on the same host and keeps the credentials; each hop is checked', async () => {
    graph.add({
      id: 'D4a',
      bytes: pngBytes(),
      mime: 'image/png',
      download: [`redirect:${graph.mediaUrl}/files/D4b`],
    });
    graph.add({ id: 'D4b', bytes: pngBytes(4096), mime: 'image/png' });
    const d = await client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D4a`);
    expect((await drain(d.stream)).length).toBe(4096);
    const hops = graph.of('media');
    expect(hops).toHaveLength(2);
    expect(hops[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ['the metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a private address over https', 'https://10.0.0.5/x'],
    ['localhost over http', 'http://localhost:1/x'],
    ["a host that is not Meta's", 'https://evil.example.com/x'],
    ['another loopback address literal', 'https://127.0.0.2/x'],
    ['a different scheme', 'ftp://127.0.0.1/x'],
  ])('a redirect to %s is refused, not followed', async (_why, target) => {
    graph.add({ id: 'D5', bytes: pngBytes(), mime: 'image/png', download: [`redirect:${target}`] });
    const e = await failure(client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D5`));
    expect(e.code).toBe(MEDIA_FAILURE.URL_REJECTED);
    expect(e.retryable).toBe(false);
    expect(graph.of('media')).toHaveLength(1); // nothing was requested at the target
  });

  it('a redirect loop ends after the limit', async () => {
    graph.add({
      id: 'D6',
      bytes: pngBytes(),
      mime: 'image/png',
      download: [`redirect:${graph.mediaUrl}/files/D6`],
    });
    const e = await failure(client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/D6`));
    expect(e.code).toBe(MEDIA_FAILURE.URL_REJECTED);
    expect(e.message).toMatch(/too many redirects/);
    expect(graph.of('media')).toHaveLength(cfg.maxRedirects + 1);
  });

  it('refuses a download address that is not https and not the fake (the guard runs before any connection)', async () => {
    const e = await failure(client().download(metaProfile(), ctx, 'http://lookaside.fbsbx.com/x'));
    expect(e.code).toBe(MEDIA_FAILURE.URL_REJECTED);
    expect(graph.requests).toHaveLength(0);
  });

  it('a name that resolves to a private address is refused at connection time', async () => {
    const guarded = new GraphMediaClient(cfg, wabaHttpFor(graph), (_h, cb) =>
      cb(null, [{ address: '10.1.2.3', family: 4 }]),
    );
    const profile: MediaProviderProfile = {
      ...metaProfile(),
      baseUrl: 'https://graph.facebook.com',
    };
    const e = await failure(
      guarded.download(
        profile,
        ctx,
        'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
      ),
    );
    expect(e.code).toBe(MEDIA_FAILURE.URL_REJECTED);
    expect(e.message).toMatch(/non-public address/);
  });
});

describe('downloadHeadersFor', () => {
  const partnerHeaders = { 'x-access-token': BSP_TOKEN };
  const bearerHeaders = { Authorization: `Bearer ${TOKEN}` };

  it("an Interakt-route number sends the business token as Bearer to Meta's file host, not the partner key", () => {
    const h = downloadHeadersFor(
      'lookaside.fbsbx.com',
      bspProfile(),
      partnerHeaders,
      bearerHeaders,
    );
    expect(h).toEqual(bearerHeaders);
  });

  it("the partner key still goes to the provider's own host, and nothing goes to another host", () => {
    const own = new URL(bspProfile().baseUrl).hostname;
    expect(downloadHeadersFor(own, bspProfile(), partnerHeaders, bearerHeaders)).toEqual(
      partnerHeaders,
    );
    expect(
      downloadHeadersFor('cdn.example.com', bspProfile(), partnerHeaders, bearerHeaders),
    ).toEqual({});
  });

  it('without a business token, Meta file host gets nothing on a BSP route', () => {
    expect(downloadHeadersFor('lookaside.fbsbx.com', bspProfile(), partnerHeaders, null)).toEqual(
      {},
    );
  });
});

describe('download: size is enforced by whoever reads the stream, and the stream can be cut', () => {
  it('announces nothing it cannot be held to: chunked bodies have no content length', async () => {
    const bytes = pngBytes(5000);
    graph.add({ id: 'S1', bytes, mime: 'image/png', chunked: true });
    const d = await client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/S1`);
    expect(d.contentLength).toBeNull();
    expect((await drain(d.stream)).equals(bytes)).toBe(true);
  });

  it('a connection cut half way surfaces as a read error on the stream, not a hang', async () => {
    graph.add({ id: 'S2', bytes: pngBytes(100_000), mime: 'image/png', download: ['truncate'] });
    const d = await client().download(metaProfile(), ctx, `${graph.mediaUrl}/files/S2`);
    await expect(drain(d.stream)).rejects.toBeTruthy();
  });
});

describe('upload: POST {root}/{phone-number-id}/media', () => {
  it("sends a multipart form through WabaHttp with the provider's headers and returns the media id", async () => {
    const bytes = pdfBytes(20_000);
    graph.mediaAuth = null;
    const id = await client().upload(metaProfile(), ctx, {
      stream: Readable.from([bytes.subarray(0, 7000), bytes.subarray(7000)]),
      size: bytes.length,
      mime: 'application/pdf',
      filename: 'report "final".pdf',
    });
    expect(id).toBe('uploaded-1');
    const req = graph.of('graph')[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v23.0/1000000001/media');
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(req.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/);
    expect(req.upload!.fields).toEqual({ messaging_product: 'whatsapp', type: 'application/pdf' });
    expect(req.upload!.bytes.equals(bytes)).toBe(true);
    expect(req.upload!.fileType).toBe('application/pdf');
    expect(req.upload!.filename).toBe('report _final_.pdf'); // quotes never reach the header
  });

  it('a BSP profile uploads with its own headers', async () => {
    graph.auth = bspHeaders(BSP_TOKEN, '555');
    const id = await client().upload(bspProfile(true), bsp, {
      stream: Readable.from([pngBytes()]),
      size: 2048,
      mime: 'image/png',
      filename: 'a.png',
    });
    expect(id).toBe('uploaded-2');
    const req = graph.of('graph')[0]!;
    expect(req.path).toBe('/v24.0/1000000001/media');
    expect(req.headers['x-access-token']).toBe(BSP_TOKEN);
    expect(req.headers.authorization).toBeUndefined();
  });

  it('a refusal by the provider keeps its code, is permanent, and carries no credential', async () => {
    graph.uploadAnswer = () => ({
      status: 400,
      body: { error: { message: `Media upload error ${TOKEN}`, code: 131053 } },
    });
    const e = await failure(
      client().upload(metaProfile(), ctx, {
        stream: Readable.from([pngBytes()]),
        size: 2048,
        mime: 'image/png',
        filename: 'a.png',
      }),
    );
    expect(graphFailureOf(e)).toMatchObject({ code: '131053', retryable: false });
    expect(e.retryable).toBe(false);
    expect(e.message).not.toContain(TOKEN);
    graph.uploadAnswer = (n) => ({ status: 200, body: { id: `uploaded-${n}` } });
  });

  it('a 5xx is retryable; an answer without an id is an unexpected (retryable) answer', async () => {
    graph.uploadAnswer = () => ({ status: 503, body: { error: { message: 'down', code: 2 } } });
    expect(
      (
        await failure(
          client().upload(metaProfile(), ctx, {
            stream: Readable.from([pngBytes()]),
            size: 2048,
            mime: 'image/png',
            filename: 'a.png',
          }),
        )
      ).retryable,
    ).toBe(true);
    graph.uploadAnswer = () => ({ status: 200, body: {} });
    expect(
      (
        await failure(
          client().upload(metaProfile(), ctx, {
            stream: Readable.from([pngBytes()]),
            size: 2048,
            mime: 'image/png',
            filename: 'a.png',
          }),
        )
      ).code,
    ).toBe(MEDIA_FAILURE.UNEXPECTED);
    graph.uploadAnswer = (n) => ({ status: 200, body: { id: `uploaded-${n}` } });
  });

  it('refuses a channel with no phone number id before sending anything', async () => {
    const e = await failure(
      client().upload(
        metaProfile(),
        { route: 'meta', channelToken: TOKEN },
        { stream: Readable.from([pngBytes()]), size: 2048, mime: 'image/png', filename: 'a.png' },
      ),
    );
    expect(e.code).toBe(MEDIA_FAILURE.UNEXPECTED);
    expect(graph.requests).toHaveLength(0);
  });
});

describe('classifyGraphFailure and the text helpers', () => {
  it('maps Meta codes to a decision', () => {
    expect(
      classifyGraphFailure(400, JSON.stringify({ error: { code: 190, message: 'x' } })),
    ).toMatchObject({ auth: true, retryable: false });
    expect(
      classifyGraphFailure(403, JSON.stringify({ error: { code: 200, message: 'x' } })),
    ).toMatchObject({ auth: true });
    expect(
      classifyGraphFailure(
        400,
        JSON.stringify({ error: { code: 100, error_subcode: 33, message: 'x' } }),
      ),
    ).toMatchObject({ gone: true, retryable: false });
    expect(
      classifyGraphFailure(200, JSON.stringify({ error: { code: 80007, message: 'x' } })),
    ).toMatchObject({ retryable: true });
    expect(classifyGraphFailure(502, 'bad gateway')).toMatchObject({
      retryable: true,
      code: '502',
    });
    expect(
      classifyGraphFailure(400, JSON.stringify({ error: { code: 131053, message: 'x' } })),
    ).toMatchObject({ retryable: false, auth: false, gone: false });
  });

  it('redact removes every secret and any bearer token; safeUrlForLog drops the query', () => {
    expect(redact('failed with abcdef123456 and Bearer EAAB.xyz-123', 'abcdef123456')).toBe(
      'failed with [redacted] and Bearer [redacted]',
    );
    expect(redact('keep this', '')).toBe('keep this');
    expect(redact('short ab', 'ab')).toBe('short ab'); // too short to be a secret: not worth mangling text over
    expect(
      safeUrlForLog('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&hash=SECRET'),
    ).toBe('https://lookaside.fbsbx.com/whatsapp_business/attachments/');
    expect(safeUrlForLog('garbage')).toBe('[unparseable url]');
  });
});
