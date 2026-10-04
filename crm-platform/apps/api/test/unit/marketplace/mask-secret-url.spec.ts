import { describe, expect, it } from 'vitest';
import { stdSerializers } from 'pino';
import { maskSecretUrl } from '../../../src/common/logging/mask-secret-url';

const KEY = '0123456789abcdef0123456789abcdef';

describe("a push portal's secret never reaches a log line", () => {
  it('masks the last segment of a connection address, with or without a query string', () => {
    expect(maskSecretUrl(`/v2/public/marketplace/hooks/${KEY}/mkt_SeCrEt-token_123`)).toBe(
      `/v2/public/marketplace/hooks/${KEY}/[secret]`,
    );
    expect(
      maskSecretUrl(`/v2/public/marketplace/hooks/${KEY}/mkt_SeCrEt-token_123?leadid=1&name=A`),
    ).toBe(`/v2/public/marketplace/hooks/${KEY}/[secret]?leadid=1&name=A`);
  });

  it('leaves an address with no secret, and every other address, as it is', () => {
    const plain = `/v2/public/marketplace/hooks/${KEY}`;
    expect(maskSecretUrl(plain)).toBe(plain);
    expect(maskSecretUrl(`${plain}?a=1`)).toBe(`${plain}?a=1`);
    expect(maskSecretUrl('/v2/marketplace/apps/indiamart')).toBe('/v2/marketplace/apps/indiamart');
    expect(maskSecretUrl(undefined)).toBeUndefined();
  });

  it('the request serializer of the access log carries the masked address, and nothing else is lost', () => {
    const req = {
      id: 'r1',
      method: 'GET',
      url: `/v2/public/marketplace/hooks/${KEY}/mkt_SeCrEt?leadid=1`,
      headers: { 'user-agent': 'portal-sender' },
      remoteAddress: '203.0.113.9',
      remotePort: 4000,
    };
    const out = stdSerializers.req(req as never);
    const masked = { ...out, url: maskSecretUrl(out.url) };
    expect(masked.url).toBe(`/v2/public/marketplace/hooks/${KEY}/[secret]?leadid=1`);
    expect(masked.method).toBe('GET');
    expect(JSON.stringify(masked)).not.toContain('mkt_SeCrEt');
  });
});
