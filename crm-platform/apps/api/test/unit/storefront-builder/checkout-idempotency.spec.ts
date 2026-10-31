import { describe, expect, it, vi } from 'vitest';
import { CheckoutService } from '../../../src/modules/storefront-builder/public/checkout.service';

/**
 * A checkout that placed its order must replay that order to a retry with the same Idempotency-Key, even when the first write of the
 * replay record fails. Otherwise the marker stays in flight and the buyer is refused for the rest of the key's life.
 */
describe('CheckoutService idempotency', () => {
  function build() {
    const store = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && store.has(key)) return null;
        // The replay record is the JSON response; the first write of it fails once.
        if (value.startsWith('{') && !redis.failedOnce) {
          redis.failedOnce = true;
          throw new Error('redis blip');
        }
        store.set(key, value);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      failedOnce: false,
    };
    const svc = new CheckoutService(
      {} as never,
      { resolve: vi.fn(async () => ({ orgId: 1, storefrontId: 2 })) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      redis as never,
    );
    const place = vi.fn(async () => ({
      orderNo: 'ord-1',
      waUrl: null,
      trackUrl: '/t/1',
      message: 'ok',
    }));
    (svc as unknown as { place: typeof place }).place = place;
    return { svc, place };
  }

  const input = { phone: '+919811100001' } as never;

  it('replays the placed order to a retry with the same key, not 409', async () => {
    const t = build();
    const first = await t.svc.checkout('shop', input, 'key-1');
    expect(first.orderNo).toBe('ord-1');
    const retry = await t.svc.checkout('shop', input, 'key-1');
    expect(retry).toEqual(first);
    expect(t.place).toHaveBeenCalledTimes(1);
  });
});
