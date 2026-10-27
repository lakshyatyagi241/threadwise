import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { uploadTemplateMedia } from './media';

afterEach(() => vi.unstubAllGlobals());

describe('uploadTemplateMedia', () => {
  it('sends the number and the file in one multipart form, as the API expects', async () => {
    const reply = {
      handle: '4::abc',
      fileName: 'a.png',
      mimeType: 'image/png',
      mediaKey: 'template-media/7/1700000000_ab.png',
      previewUrl: 'https://cdn.test/template-media/7/1700000000_ab.png',
    };
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(reply), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['png'], 'a.png', { type: 'image/png' });

    const result = await uploadTemplateMedia(file, 'conn-1');

    expect(result).toEqual(reply);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get('connectionId')).toBe('conn-1');
    expect(body.get('file')).toBeInstanceOf(File);
  });

  it('turns a proxy page (a 413 that is not JSON) into an ApiError the screen can name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>413 Request Entity Too Large</html>', {
            status: 413,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    const err = await uploadTemplateMedia(file, 'conn-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(413);
  });

  it('keeps the code and the sentence of a JSON problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Unprocessable',
              status: 422,
              code: 'AUTH_UPLOAD_REJECTED',
              detail: 'The file content does not match its type',
            }),
            { status: 422, headers: { 'content-type': 'application/problem+json' } },
          ),
      ),
    );
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    const err = (await uploadTemplateMedia(file, 'conn-1').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('AUTH_UPLOAD_REJECTED');
    expect(err.message).toBe('The file content does not match its type');
  });
});
