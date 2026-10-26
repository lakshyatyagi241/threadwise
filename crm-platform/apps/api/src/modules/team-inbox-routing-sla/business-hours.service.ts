import { Injectable } from '@nestjs/common';
import type { BusinessHours, UpdateBusinessHoursInput } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  mayEditTimezone,
  mergeBusinessHours,
  readBusinessHoursDays,
  readBusinessHoursHolidays,
  sameDays,
  sameHolidays,
} from './business-hours-rules';
import { RoutingRulesRepository } from './routing-rules.repository';

const MODULE_KEY = 'business_hours';

/**
 * Business hours (TW-TIB2-001): the workspace's weekly schedule and time zone, read and saved by the Auto-assignment screen's
 * "Business hours" dialog. The engine that reads the same schedule (`common/business-hours.ts`) is not changed here.
 *
 * A save is one transaction: the schedule, the owner's time zone when it changed, the audit row and the outbox event. The caller's
 * permission (`inbox.settings.read` to read, `inbox.routing.manage` to write) is enforced by the controller; the plan by `assertPlan`.
 */
@Injectable()
export class BusinessHoursService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RoutingRulesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  /**
   * The workspace's hours are read by the routing rules AND by SLA clocks (`respectBusinessHours`), so either plan feature may edit them:
   * a workspace with SLA policies but no Smart routing must not be left with hours it cannot change. Neither: 422 PLAN_FEATURE_LOCKED for
   * `inbox_routing`.
   */
  async assertPlan(orgId: number): Promise<void> {
    if (await this.entitlements.featureEnabled(orgId, 'inbox_sla')) return;
    await this.entitlements.assertFeature(orgId, 'inbox_routing');
  }

  async get(): Promise<BusinessHours> {
    const { orgId, userId } = RequestContextStore.require();
    await this.assertPlan(orgId);
    return this.db.tx(async (tx) => {
      const row = await this.repo.businessHours(tx, orgId);
      const owner = await this.repo.ownerUuid(tx, orgId);
      const me = userId === null ? null : await this.repo.userUuid(tx, orgId, userId);
      return {
        timezone: row.timezone,
        canEditTimezone: mayEditTimezone(owner, me),
        days: readBusinessHoursDays(row.hours),
        holidays: readBusinessHoursHolidays(row.hours),
      };
    });
  }

  async update(input: UpdateBusinessHoursInput): Promise<BusinessHours> {
    const { orgId, userId } = RequestContextStore.require();
    await this.assertPlan(orgId);
    return this.db.tx(async (tx) => {
      const before = await this.repo.businessHours(tx, orgId);
      const owner = await this.repo.ownerUuid(tx, orgId);
      const me = userId === null ? null : await this.repo.userUuid(tx, orgId, userId);
      const canZone = mayEditTimezone(owner, me);
      const zone = canZone && input.timezone !== undefined ? input.timezone : before.timezone;
      const oldDays = readBusinessHoursDays(before.hours);
      const oldHolidays = readBusinessHoursHolidays(before.hours);
      const holidays = input.holidays ?? oldHolidays;

      await this.repo.setBusinessHours(
        tx,
        orgId,
        mergeBusinessHours(before.hours, input.days, input.holidays),
      );
      if (zone !== before.timezone) await this.repo.setOrgTimezone(tx, orgId, zone);

      const daysChanged = !sameDays(oldDays, input.days);
      const holidaysChanged = !sameHolidays(oldHolidays, holidays);
      if (daysChanged || holidaysChanged || zone !== before.timezone) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: orgId,
          action: 'update',
          delta: {
            ...(daysChanged ? { days: { old: oldDays, new: input.days } } : {}),
            ...(holidaysChanged ? { holidays: { old: oldHolidays, new: holidays } } : {}),
            ...(zone !== before.timezone ? { timezone: { old: before.timezone, new: zone } } : {}),
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: orgId,
          eventType: 'business_hours.updated',
          payload: { timezone: zone, days: input.days, holidays },
        });
      }
      return { timezone: zone, canEditTimezone: canZone, days: input.days, holidays };
    });
  }
}
