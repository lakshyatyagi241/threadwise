import { afterEach, describe, expect, it, vi } from 'vitest';
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
      async (_url: string, _init?: RequestInit) =>
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
});
