import { defaultHttp, type HttpFetch, type HttpResponse } from '../platform-payment-gateways';

/** Every call the fixture HTTP saw, newest last. Tests read it. */
export const fixtureGatewayCalls: Array<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}> = [];

const ok = (json: unknown): HttpResponse => ({ status: 200, json, text: JSON.stringify(json) });

/**
 * Deterministic stand-in chosen by `STORE_PROVIDER_MODE=fixture` (tests, demos): no network. A Razorpay key id starting `rzp_fail`
 * or a Stripe secret starting `sk_fail` is answered 401 (the provider refusing the keys); a hosted-link creation answers a fixed URL
 * derived from the reference so a test can assert it.
 */
export const fixtureGatewayHttp: HttpFetch = async (url, init) => {
  fixtureGatewayCalls.push({
    url,
    method: init.method,
    headers: init.headers ?? {},
    body: init.body,
  });
  const auth = init.headers?.Authorization ?? '';
  const secret = auth.startsWith('Basic ')
    ? Buffer.from(auth.slice(6), 'base64').toString('utf8')
    : auth.replace(/^Bearer /, '');
  if (secret.startsWith('rzp_fail') || secret.startsWith('sk_fail')) {
    return {
      status: 401,
      json: { error: 'invalid_credentials' },
      text: '{"error":"invalid_credentials"}',
    };
  }
  if (url.includes('/checkout/sessions')) {
    return ok({ id: 'cs_fixture', url: 'https://stripe.fixture.test/pay/cs_fixture' });
  }
  return ok({});
};

/** The real HTTP function (a 45 second timeout, JSON parsed when it is JSON). */
export const liveGatewayHttp: HttpFetch = defaultHttp;
