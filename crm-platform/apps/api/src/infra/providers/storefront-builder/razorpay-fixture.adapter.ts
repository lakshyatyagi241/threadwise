import { Injectable } from '@nestjs/common';
import type {
  PaymentLink,
  PaymentLinkRequest,
  RazorpayCredentials,
  RazorpayPort,
} from './razorpay.port';

/** Every request the fixture adapter saw, newest last. Tests read it. */
export const fixtureRazorpayCalls: Array<{
  credentials: RazorpayCredentials;
  request: PaymentLinkRequest;
}> = [];

/**
 * Deterministic stand-in chosen by `STORE_PROVIDER_MODE=fixture`: the same input always yields the same link, and a key id
 * starting with `rzp_fail` simulates Razorpay rejecting the keys.
 */
@Injectable()
export class RazorpayFixtureAdapter implements RazorpayPort {
  async createPaymentLink(
    credentials: RazorpayCredentials,
    request: PaymentLinkRequest,
  ): Promise<PaymentLink | null> {
    fixtureRazorpayCalls.push({ credentials, request });
    if (credentials.keyId.startsWith('rzp_fail')) return null;
    return {
      shortUrl: `https://rzp.fixture.test/l/${request.referenceId}`,
      id: `plink_${request.referenceId}`,
    };
  }
}
