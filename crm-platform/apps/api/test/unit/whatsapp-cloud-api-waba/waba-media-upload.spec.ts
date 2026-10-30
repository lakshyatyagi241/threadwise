import { describe, expect, it, vi } from 'vitest';
import {
  RATE_LIMIT_RETRY_WAITS_MS,
  retryOnRateLimit,
  uploadMediaHandle,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-media-upload';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { WabaHttp } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';

/** Meta's code 4 as the Interakt media_handle call returns it (HTTP 403, transient). */
const throttled = () =>
  WabaApiError.fromResponse(403, {
    error: {
      message: 'Application request limit reached',
      type: 'OAuthException',
      code: 4,
      is_transient: true,
      fbtrace_id: 'AAA',
    },
  });

describe('retryOnRateLimit', () => {
  it('waits four times, about 27 seconds in all, before the throttle reaches the user', () => {
    expect(RATE_LIMIT_RETRY_WAITS_MS).toHaveLength(4);
    expect(RATE_LIMIT_RETRY_WAITS_MS.reduce((a, b) => a + b, 0)).toBe(27000);
  });

  it('returns the first answer when nothing is throttled', async () => {
    let calls = 0;
    const out = await retryOnRateLimit(async () => ++calls, [0, 0]);
    expect(out).toBe(1);
    expect(calls).toBe(1);
  });

  it('retries a throttle and returns the answer once Meta accepts the call', async () => {
    let calls = 0;
    const out = await retryOnRateLimit(async () => {
      calls += 1;
      if (calls < 3) throw throttled();
      return 'handle';
    }, [0, 0]);
    expect(out).toBe('handle');
    expect(calls).toBe(3);
  });

  it('gives up after the last wait and throws the throttle', async () => {
    let calls = 0;
    await expect(
      retryOnRateLimit(async () => {
        calls += 1;
        throw throttled();
      }, [0, 0]),
    ).rejects.toMatchObject({ code: 4, status: 403 });
    expect(calls).toBe(3);
  });

  it('throws a refusal at once, without retrying', async () => {
    let calls = 0;
    const refusal = WabaApiError.fromResponse(400, {
      error: { message: 'Invalid parameter', code: 100, fbtrace_id: 'BBB' },
    });
    await expect(
      retryOnRateLimit(async () => {
        calls += 1;
        throw refusal;
      }, [0, 0]),
    ).rejects.toBe(refusal);
    expect(calls).toBe(1);
  });

  it('throws a non-provider error at once', async () => {
    let calls = 0;
    await expect(
      retryOnRateLimit(async () => {
        calls += 1;
        throw new Error('boom');
      }, [0, 0]),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});

describe('the Meta header upload (uploadMediaHandle)', () => {
  const env = { META_APP_ID: 'app-1' } as never;
  const conn = { provider: 'waba', accessToken: 'tok' } as never;
  const media = { bytes: Buffer.from('png'), fileName: 'a.png', mimeType: 'image/png' };

  it('sends the upload again when Meta throttles its session call, and returns the handle', async () => {
    let sessions = 0;
    const graph = vi.fn(async (_conn: unknown, opts: { path: string }) => {
      if (opts.path === '/app-1/uploads') {
        sessions += 1;
        if (sessions === 1) throw throttled();
        return { id: 'upload:1' };
      }
      return { h: 'handle-1' };
    });
    const http = { graph } as unknown as WabaHttp;
    await expect(
      uploadMediaHandle(http, env, conn, media, 'a template header example'),
    ).resolves.toBe('handle-1');
    expect(sessions).toBe(2);
  });

  it('does not send a refused upload again', async () => {
    const refusal = WabaApiError.fromResponse(400, {
      error: { message: 'Invalid parameter', code: 100, fbtrace_id: 'CCC' },
    });
    const graph = vi.fn(async () => {
      throw refusal;
    });
    const http = { graph } as unknown as WabaHttp;
    await expect(
      uploadMediaHandle(http, env, conn, media, 'a template header example'),
    ).rejects.toBe(refusal);
    expect(graph).toHaveBeenCalledTimes(1);
  });
});
