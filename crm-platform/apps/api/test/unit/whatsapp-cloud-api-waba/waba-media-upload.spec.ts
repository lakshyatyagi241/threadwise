import { describe, expect, it } from 'vitest';
import { retryOnRateLimit } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-media-upload';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';

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
