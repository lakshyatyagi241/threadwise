import { FlutterwaveDriver, PaystackDriver } from './africa.drivers';
import {
  CashfreeDriver,
  InstamojoDriver,
  PaytmDriver,
  PayuDriver,
  PhonePeDriver,
} from './india.drivers';
import { ManualDriver } from './manual.driver';
import { PaddleDriver } from './paddle.driver';
import type { DriverContext, PaymentDriver } from './payment-driver';
import { PayPalDriver } from './paypal.driver';
import { RazorpayDriver } from './razorpay.driver';
import { StripeDriver } from './stripe.driver';

const FACTORIES: Record<string, (ctx: DriverContext) => PaymentDriver> = {
  stripe: (c) => new StripeDriver(c),
  razorpay: (c) => new RazorpayDriver(c),
  paypal: (c) => new PayPalDriver(c),
  paddle: (c) => new PaddleDriver(c),
  paystack: (c) => new PaystackDriver(c),
  flutterwave: (c) => new FlutterwaveDriver(c),
  paytm: (c) => new PaytmDriver(c),
  phonepe: (c) => new PhonePeDriver(c),
  cashfree: (c) => new CashfreeDriver(c),
  payu: (c) => new PayuDriver(c),
  instamojo: (c) => new InstamojoDriver(c),
  bank_transfer: (c) => new ManualDriver('bank_transfer', c),
  offline: (c) => new ManualDriver('offline', c),
};

/** Slugs with a working driver. A gateway outside this list can be configured but never activated (it could not take a payment). */
export const DRIVER_SLUGS: readonly string[] = Object.keys(FACTORIES);
export const hasDriver = (slug: string): boolean => slug in FACTORIES;

/**
 * Builds the driver for a slug from ANY credential source: the platform row for platform billing, a workspace's own keys for
 * merchant checkout (CHK), the same row for booking deposits (APPT). Throws for an unknown slug (a bug, not a user error).
 */
export function createDriver(slug: string, ctx: DriverContext): PaymentDriver {
  const make = FACTORIES[slug];
  if (!make) throw new Error(`no payment driver for "${slug}"`);
  return make(ctx);
}
