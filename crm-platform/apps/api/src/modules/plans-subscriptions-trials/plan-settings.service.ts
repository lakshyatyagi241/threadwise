import { Injectable } from '@nestjs/common';
import type { PlanSettings } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformSettingsService } from '../auth';

export const YEARLY_TOGGLE_KEY = 'pricing.yearly_toggle_enabled';
export const YEARLY_DISCOUNT_KEY = 'pricing.yearly_discount_pct';

/**
 * The platform-wide pricing settings the super admin controls: whether the Monthly/Yearly switch exists and how much a year saves. They are the
 * same keys checkout, the plan picker and the public pricing page already read (Reference's names), so one edit changes all three at once.
 * Defaults match Reference: switch on, 20 percent.
 */
@Injectable()
export class PlanSettingsService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  async get(): Promise<PlanSettings> {
    const [toggle, pct] = await Promise.all([
      this.settings.get<unknown>(YEARLY_TOGGLE_KEY),
      this.settings.get<unknown>(YEARLY_DISCOUNT_KEY),
    ]);
    return {
      yearlyToggleEnabled: toggle !== false,
      yearlyDiscountPct:
        typeof pct === 'number' && Number.isInteger(pct) && pct >= 0 && pct <= 90 ? pct : 20,
    };
  }

  async update(next: PlanSettings): Promise<PlanSettings> {
    const operatorId = RequestContextStore.require().actorId;
    if (!operatorId) throw AppError.unauthenticated();
    const before = await this.get();
    await this.settings.set(YEARLY_TOGGLE_KEY, next.yearlyToggleEnabled, operatorId);
    await this.settings.set(YEARLY_DISCOUNT_KEY, next.yearlyDiscountPct, operatorId);
    await this.audit.recordStandalone({
      event: 'platform.plan.settings_updated',
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: { from: before, to: next },
    });
    return this.get();
  }
}
