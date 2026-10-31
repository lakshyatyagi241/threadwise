import { describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ guardedRequest: vi.fn() }));
vi.mock('../../../src/infra/net/guarded-http', () => http);
vi.mock('../../../src/config/domains/ecom.env', () => ({
  ecomConfig: () => ({ ECOM_ALLOW_PRIVATE_STORE_URLS: false }),
}));

import { HttpWooFactory } from '../../../src/infra/providers/ecom/woocommerce-rest.client';
import { MAX_PAGES } from '../../../src/infra/providers/ecom/ecom.port';

/** Answers each request with a page of `size` orders, so the paging rule is the only thing under test. */
function answer(size: (page: number) => number) {
  http.guardedRequest.mockReset();
  http.guardedRequest.mockImplementation(async (req: { url: URL }) => {
    const page = Number(req.url.searchParams.get('page'));
    const body = Array.from({ length: size(page) }, (_, i) => ({ id: page * 1000 + i }));
    return { status: 200, body: JSON.stringify(body), headers: {} };
  });
}

const store = () => new HttpWooFactory().store('https://shop.example', 'ck', 'cs');

/**
 * The WooCommerce order read stops after MAX_PAGES pages per call and says where the next call should start, so a store with
 * more orders than the cap resumes instead of losing the oldest ones.
 */
describe('WooCommerce order paging', () => {
  it('reads at most MAX_PAGES pages from the first page, then names the next page', async () => {
    answer(() => 100);
    const out = await store().orders();
    expect(http.guardedRequest).toHaveBeenCalledTimes(MAX_PAGES);
    expect(out).toMatchObject({ complete: false, nextPage: MAX_PAGES + 1 });
    expect(out.items).toHaveLength(MAX_PAGES * 100);
  });

  it('resumes from the given page and completes on a short page', async () => {
    answer((page) => (page < 13 ? 100 : 5));
    const out = await store().orders(11);
    const pages = http.guardedRequest.mock.calls.map((c) =>
      Number((c[0] as { url: URL }).url.searchParams.get('page')),
    );
    expect(pages).toEqual([11, 12, 13]);
    expect(out).toMatchObject({ complete: true });
    expect(out.items).toHaveLength(205);
  });
});
