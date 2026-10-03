import { Injectable } from '@nestjs/common';
import type { PlanFeatureKey } from '@crm/contracts';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import type { WidgetPlanGate } from './_shims/tokens';

/** WaDesk's `access_chatbot_widgets` package flag, in the plan registry as `chatbot_widgets` (WD-WGT-027). */
export const WIDGET_FEATURE = 'chatbot_widgets' satisfies PlanFeatureKey;

/**
 * The plan side of the widgets: the admin pages need the flag, the public routes never check it (a downgraded workspace keeps
 * serving the widgets it already embedded). Platform-owned and plan-less organizations are never locked out. The numeric
 * `chatbot_widgets_limit` exists as a plan column but, as in WaDesk, nothing compares against it.
 */
@Injectable()
export class EntitlementWidgetPlanGate implements WidgetPlanGate {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  isEnabled(orgId: number): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, WIDGET_FEATURE);
  }
}
