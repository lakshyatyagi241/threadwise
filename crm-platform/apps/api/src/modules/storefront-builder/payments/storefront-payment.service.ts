import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto/crypto.service';
import {
  RAZORPAY_PORT,
  type PaymentLink,
  type RazorpayPort,
} from '../../../infra/providers/storefront-builder/razorpay.port';
import {
  RAZORPAY_MIN_AMOUNT_MINOR,
  verifyRazorpaySignature,
} from '../../../infra/providers/storefront-builder/razorpay-payloads';
import {
  readRazorpayConfig,
  supportsLinks,
  type RazorpayCredentialsPlain,
} from '../rules/payment-config';

/** What link minting needs of a shop. CHK passes the shop row it read; only these fields are used. */
export interface PaymentShopRef {
  id: number;
  orgId: number;
  shopName: string | null;
  paymentProvider: string | null;
  paymentConfig: Record<string, unknown> | null;
}

/** What link minting needs of an order (the CHK order the merchant is charging). */
export interface PaymentOrderRef {
  id: number;
  totalMinor: number;
  currencyCode: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}

/**
 * Payment links with the MERCHANT's own Razorpay keys (WD-STORE-008, 018). Exported from the barrel: CHK's order page calls
 * `mintLink` and puts the link on the order. The keys are per shop, encrypted at rest, and never leave this service in clear
 * except to Razorpay.
 */
@Injectable()
export class StorefrontPaymentService {
  constructor(
    private readonly crypto: CryptoService,
    @Inject(RAZORPAY_PORT) private readonly razorpay: RazorpayPort,
  ) {}

  /** The shop has API link minting configured: provider `razorpay_api` with a key id and a key secret. */
  supportsLinks(shop: PaymentShopRef): boolean {
    return supportsLinks(shop.paymentProvider, this.credentials(shop));
  }

  /**
   * Creates a payment link for the order. Null when the shop is not set up for it, the total is under Razorpay's minimum
   * (100 minor units), or Razorpay refused (the caller answers "Could not create the payment link").
   * `callbackUrl` is where the buyer lands after paying: the order's tracking page.
   */
  async mintLink(
    shop: PaymentShopRef,
    order: PaymentOrderRef,
    callbackUrl: string,
  ): Promise<PaymentLink | null> {
    const creds = this.credentials(shop);
    if (!supportsLinks(shop.paymentProvider, creds)) return null;
    if (order.totalMinor < RAZORPAY_MIN_AMOUNT_MINOR) return null;
    return this.razorpay.createPaymentLink(
      { keyId: creds.keyId, keySecret: creds.keySecret },
      {
        amountMinor: order.totalMinor,
        currency: order.currencyCode || 'INR',
        referenceId: `WAORD-${order.id}`,
        description: `Order #${order.id} · ${shop.shopName || 'Store'}`,
        customer: {
          name: order.customerName || null,
          contact: order.customerPhone || null,
          email: order.customerEmail || null,
        },
        notes: {
          wa_order_id: String(order.id),
          storefront_id: String(shop.id),
          workspace_id: String(shop.orgId),
        },
        callbackUrl,
      },
    );
  }

  /** HMAC-SHA256 of the raw body with the shop's webhook secret; a shop with no secret verifies nothing (fail closed). */
  verifyWebhook(shop: PaymentShopRef, rawBody: Buffer, signature: string | undefined): boolean {
    return this.verifyWebhookWith(this.credentials(shop).webhookSecret, rawBody, signature);
  }

  /** The same check with the secret the caller resolved (the shared gateway of the shop). */
  verifyWebhookWith(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
    return verifyRazorpaySignature(rawBody, signature, secret);
  }

  credentials(shop: Pick<PaymentShopRef, 'paymentConfig'>): RazorpayCredentialsPlain {
    return readRazorpayConfig(shop.paymentConfig, (c) => this.crypto.decrypt(c));
  }
}
