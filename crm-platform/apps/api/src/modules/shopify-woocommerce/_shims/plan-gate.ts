import { Injectable } from '@nestjs/common';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import type { StoreKind } from '../mirror-rules';
import type { EcomPlanGate } from './tokens';

/** The plan flags `shopify` and `woocommerce` (both default to on, so a plan that predates them keeps the integration). */
@Injectable()
export class PlanEcomGate implements EcomPlanGate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  assertIntegration(orgId: number, kind: StoreKind): Promise<void> {
    return this.entitlements.assertFeature(
      orgId,
      kind,
      `Your plan does not include the ${kind === 'shopify' ? 'Shopify' : 'WooCommerce'} integration. Upgrade to unlock it.`,
    );
  }
}
