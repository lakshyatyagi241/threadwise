import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFlowMediaFromUrl } from './upload-media';

afterEach(() => vi.unstubAllGlobals());

describe('copyFlowMediaFromUrl', () => {
  it('posts the address as JSON and returns the copy', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { url: 'https://app.example.com/v2/flow-media/o/1_a.jpg', filename: '1_a.jpg' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const copy = await copyFlowMediaFromUrl('https://photos.example.com/a.jpg');
    expect(copy).toEqual({
      url: 'https://app.example.com/v2/flow-media/o/1_a.jpg',
      filename: '1_a.jpg',
    });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/v2/flows/upload-media/from-url');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://photos.example.com/a.jpg' });
  });

  it('throws the server message when the copy is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ title: 'Unprocessable', detail: 'That address cannot be used.' }),
            {
              status: 422,
              headers: { 'Content-Type': 'application/problem+json' },
            },
          ),
      ),
    );
    await expect(copyFlowMediaFromUrl('http://10.0.0.1/a.jpg')).rejects.toThrow(
      'That address cannot be used.',
    );
  });
});
