import { Inject, Injectable } from '@nestjs/common';
import {
  RAZORPAY_PORT,
  type RazorpayPort,
} from '../../../infra/providers/storefront-builder/razorpay.port';
import { RAZORPAY_MIN_AMOUNT_MINOR } from '../../../infra/providers/storefront-builder/razorpay-payloads';
import { minorToMajor } from '@crm/contracts';
import { supportsPaymentLinks } from './gateway-rules';
import { WorkspaceGatewayResolver, type ResolvedGateway } from './workspace-gateway.resolver';

/** What a hosted payment link is made for. `reference` is OUR id for the payment (`WAORD-<order>`, `INV-<attempt>`): the provider echoes it back. */
export interface HostedLinkRequest {
  reference: string;
  amountMinor: bigint;
  currency: string;
  description: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  /** Where the buyer lands after paying (display only: money is confirmed by the gateway's own notification). */
  callbackUrl: string;
  /** Extra notes Razorpay echoes in its notification (the store's own webhook finds the shop through them). */
  notes?: Record<string, string>;
}

export interface HostedLink {
  url: string;
  /** The provider's id of the link or checkout. */
  id: string | null;
}

/**
 * One way to make a link a buyer opens from WhatsApp or an invoice page, on whichever gateway the workspace resolved (the store
 * checkout and Sales invoices both use it). Razorpay goes through its Payment Links API (its checkout driver answers a widget, not
 * a page); every other gateway through its driver's hosted checkout, accepted only when it answers a redirect (a widget or an
 * auto-posting form cannot be sent as a link). Null when the gateway cannot make one or the provider refused. Never throws for a
 * provider failure. Runs outside any transaction: the provider call can take seconds.
 */
@Injectable()
export class GatewayLinkService {
  constructor(
    private readonly resolver: WorkspaceGatewayResolver,
    @Inject(RAZORPAY_PORT) private readonly razorpay: RazorpayPort,
  ) {}

  async mint(gateway: ResolvedGateway, req: HostedLinkRequest): Promise<HostedLink | null> {
    if (!supportsPaymentLinks(gateway.slug)) return null;
    if (gateway.slug === 'razorpay') {
      if (req.amountMinor < BigInt(RAZORPAY_MIN_AMOUNT_MINOR)) return null;
      const link = await this.razorpay.createPaymentLink(
        {
          keyId: gateway.credentials.key_id ?? '',
          keySecret: gateway.credentials.key_secret ?? '',
        },
        {
          amountMinor: Number(req.amountMinor),
          currency: req.currency || 'INR',
          referenceId: req.reference,
          description: req.description,
          customer: {
            name: req.customerName || null,
            contact: req.customerPhone || null,
            email: req.customerEmail || null,
          },
          notes: req.notes ?? {},
          callbackUrl: req.callbackUrl,
        },
      );
      return link?.shortUrl ? { url: link.shortUrl, id: link.id } : null;
    }
    const result = await this.resolver.driverFor(gateway).initiate(
      {
        orderNumber: req.reference,
        amountMinor: req.amountMinor,
        amountMajor: minorToMajor(req.amountMinor, req.currency),
        currency: req.currency.toUpperCase(),
        description: req.description,
        customerName: req.customerName,
        customerEmail: req.customerEmail,
      },
      {
        returnUrl: req.callbackUrl,
        notifyUrl: gateway.gatewayUuid
          ? this.resolver.webhookUrl(gateway.gatewayUuid)
          : req.callbackUrl,
      },
    );
    return result.redirectUrl
      ? { url: result.redirectUrl, id: result.gatewayOrderId ?? null }
      : null;
  }
}
