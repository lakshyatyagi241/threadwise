import { Injectable, Logger } from '@nestjs/common';
import { RAZORPAY_API, basicAuthHeader, buildPaymentLinkBody } from './razorpay-payloads';
import type {
  PaymentLink,
  PaymentLinkRequest,
  RazorpayCredentials,
  RazorpayPort,
} from './razorpay.port';

/** Reference gave Razorpay 20 seconds. */
const TIMEOUT_MS = 20_000;

/**
 * The real Razorpay REST API. NOT exercised against Razorpay in this repo's tests (no merchant account): the request body and
 * the signature check are covered by recorded-fixture unit tests, the HTTP call by a local stub.
 */
@Injectable()
export class RazorpayLiveAdapter implements RazorpayPort {
  private readonly logger = new Logger(RazorpayLiveAdapter.name);

  constructor(
    private readonly baseUrl: string = RAZORPAY_API,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createPaymentLink(
    credentials: RazorpayCredentials,
    request: PaymentLinkRequest,
  ): Promise<PaymentLink | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/payment_links`, {
        method: 'POST',
        headers: {
          authorization: basicAuthHeader(credentials.keyId, credentials.keySecret),
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildPaymentLinkBody(request)),
        // A credential must not follow a redirect to another host.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        short_url?: string;
        id?: string;
        error?: { description?: string };
      };
      if (!res.ok) {
        // The description is Razorpay's own text; the credentials are never in it.
        this.logger.warn(
          `[STOREFRONT-PAY] mint failed: ${json.error?.description ?? `HTTP ${res.status}`}`,
        );
        return null;
      }
      return { shortUrl: json.short_url ?? null, id: json.id ?? null };
    } catch (err) {
      this.logger.warn(`[STOREFRONT-PAY] mint exception: ${(err as Error).message}`);
      return null;
    }
  }
}
