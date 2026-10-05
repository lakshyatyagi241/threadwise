import { basicAuth, bearer, type HttpFetch } from '../platform-payment-gateways';

export interface ProbeResult {
  /** `verified`: the provider answered the call with these keys. */
  verdict: 'accepted' | 'rejected' | 'unreachable';
}

/**
 * A harmless authenticated read that proves a set of keys is accepted by the provider, for the gateways that have one. Only
 * Razorpay and Stripe do here (an authenticated list call that moves no money); the others are checked for completeness only, and
 * the screen says so rather than claiming they were verified. Null when this gateway has no probe.
 */
export async function probeCredentials(
  slug: string,
  creds: Record<string, string>,
  mode: 'live' | 'test',
  http: HttpFetch,
): Promise<ProbeResult | null> {
  let url: string;
  let authorization: string;
  if (slug === 'razorpay') {
    url = 'https://api.razorpay.com/v1/payments?count=1';
    authorization = basicAuth(creds.key_id ?? '', creds.key_secret ?? '');
  } else if (slug === 'stripe') {
    url = 'https://api.stripe.com/v1/balance';
    authorization = bearer(creds.secret_key ?? '');
  } else {
    return null;
  }
  void mode;
  try {
    const res = await http(url, { method: 'GET', headers: { Authorization: authorization } });
    if (res.status === 401 || res.status === 403) return { verdict: 'rejected' };
    return { verdict: res.status >= 200 && res.status < 300 ? 'accepted' : 'unreachable' };
  } catch {
    return { verdict: 'unreachable' };
  }
}
